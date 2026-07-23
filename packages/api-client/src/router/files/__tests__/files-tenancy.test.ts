/**
 * files-tenancy.test.ts — cross-tenant proofs for the files router
 * (Phase 66 Plan 02 Task 2, D-66-07 / T-66-02 / T-66-04).
 *
 * Mirrors `knowledge-user-scoping.test.ts`'s caller idiom
 * (`createCaller({ db, headers, user })`) — its SHAPE, not its assertions.
 *
 * The fake adapter RECORDS every `(userId, segments, name)` it is handed, so
 * these tests assert what the storage layer actually RECEIVED rather than what
 * the procedure returned. That distinction is the entire point: "the call
 * errored" and "the call never touched storage" are different claims, and only
 * the second one is a tenancy guarantee.
 *
 * `ctx.db` is `{} as never` — and it STAYS uninvoked, because a fake
 * `VaultVersionStore` is injected (DR-02 added a metadata table, through the
 * migrations queue; the router reaches it only via that injectable seam). The
 * fake store RECORDS every insert/read the same way the fake adapter records
 * storage calls, so a version/trash procedure's tenancy is asserted on what the
 * store actually RECEIVED — the acting user is `ctx.user.id`, never input.
 */

import { describe, expect, it } from "vitest";

import type { VaultAdapter } from "../storage-adapter";
import type { SessionUser } from "../../../trpc";
import type {
  NewVaultVersion,
  VaultVersionRecord,
  VaultVersionStore,
} from "../version-store";
import { createCallerFactory } from "../../../trpc";
import { createTRPCRouter } from "../../../trpc";
import { createFilesRouter } from "../index";
import { VaultStorageError } from "../storage-adapter";

const USER_A: SessionUser = { id: "user-a" };
const USER_B_ID = "user-b";

type Recorded = {
  op: string;
  userId: string;
  segments: readonly string[];
  name?: string;
  toSegments?: readonly string[];
  toName?: string;
  isFolder?: boolean;
  offset?: number;
  snapshotId?: string;
};

function createFakeAdapter(behavior?: { throwOn?: string }) {
  const calls: Recorded[] = [];

  const maybeThrow = (op: string) => {
    if (behavior?.throwOn === op) {
      // The internal text names a key and a bucket on purpose — the storage
      // -failure test asserts it does NOT reach the client.
      throw new VaultStorageError(op, "bucket user-files key user-b/secret.pdf denied");
    }
  };

  const adapter: VaultAdapter = {
    listFolder: async (userId, segments, offset) => {
      calls.push({ op: "listFolder", userId, segments, offset });
      maybeThrow("listFolder");
      return {
        entries: [
          {
            name: "a.txt",
            kind: "text",
            isFolder: false,
            size: 1,
            updatedAt: null,
            contentType: "text/plain",
          },
        ],
        nextCursor: null,
      };
    },
    signedDownloadUrl: async (userId, segments, name) => {
      calls.push({ op: "signedDownloadUrl", userId, segments, name });
      maybeThrow("signedDownloadUrl");
      return { url: "https://fake/dl" };
    },
    signedUploadUrl: async (userId, segments, name) => {
      calls.push({ op: "signedUploadUrl", userId, segments, name });
      maybeThrow("signedUploadUrl");
      return { url: "https://fake/up", token: "T", key: `${userId}/${name}` };
    },
    createFolder: async (userId, segments, name) => {
      calls.push({ op: "createFolder", userId, segments, name });
      maybeThrow("createFolder");
    },
    removeEntry: async (userId, segments, name, isFolder) => {
      calls.push({ op: "removeEntry", userId, segments, name, isFolder });
      maybeThrow("removeEntry");
    },
    statEntry: async (userId, segments, name) => {
      calls.push({ op: "statEntry", userId, segments, name });
      maybeThrow("statEntry");
      // Default: nothing there (first-time upload). Overridden per-test where a
      // pre-existing object matters (versioning-on-overwrite).
      return null;
    },
    moveEntry: async (userId, fromSegments, name, toSegments, toName, isFolder) => {
      calls.push({
        op: "moveEntry",
        userId,
        segments: fromSegments,
        name,
        toSegments,
        toName,
        isFolder,
      });
      maybeThrow("moveEntry");
    },
    trashEntry: async (userId, segments, name, isFolder, snapshotId) => {
      calls.push({ op: "trashEntry", userId, segments, name, isFolder, snapshotId });
      maybeThrow("trashEntry");
      return { sizeBytes: 7, contentType: "text/plain" };
    },
    restoreFromTrash: async (userId, toSegments, name, isFolder, snapshotId) => {
      calls.push({ op: "restoreFromTrash", userId, segments: toSegments, name, isFolder, snapshotId });
      maybeThrow("restoreFromTrash");
    },
    snapshotVersion: async (userId, segments, name, snapshotId) => {
      calls.push({ op: "snapshotVersion", userId, segments, name, snapshotId });
      maybeThrow("snapshotVersion");
      return { sizeBytes: 5, contentType: "text/plain" };
    },
    restoreVersion: async (userId, toSegments, name, snapshotId) => {
      calls.push({ op: "restoreVersion", userId, segments: toSegments, name, snapshotId });
      maybeThrow("restoreVersion");
    },
    folderSizeRollup: async (userId, segments) => {
      calls.push({ op: "folderSizeRollup", userId, segments });
      maybeThrow("folderSizeRollup");
      return { total: 0, children: [] };
    },
  };

  return { adapter, calls };
}

/**
 * A Map-backed `VaultVersionStore` that records the acting user on every write
 * — the DR-02 analogue of the fake adapter's `calls`. `getById`/`listVersions`
 * are already owner-scoped here, so a cross-user read comes back empty exactly
 * as the Drizzle store's `where user_id = ...` would return no row.
 */
function createFakeVersionStore() {
  const rows = new Map<string, VaultVersionRecord & { userId: string }>();
  const inserts: (NewVaultVersion & { userId: string })[] = [];

  const store: VaultVersionStore = {
    insert: async (userId, record) => {
      inserts.push({ userId, ...record });
      const row: VaultVersionRecord & { userId: string } = {
        userId,
        id: record.id,
        objectPath: record.objectPath,
        state: record.state,
        versionKey: record.versionKey,
        isFolder: record.isFolder,
        sizeBytes: record.sizeBytes,
        contentType: record.contentType,
        createdAt: new Date("2026-07-23T00:00:00Z"),
        expiresAt: record.expiresAt,
      };
      rows.set(record.id, row);
      return row;
    },
    listVersions: async (userId, objectPath) =>
      [...rows.values()].filter(
        (r) => r.userId === userId && r.objectPath === objectPath && r.state === "version",
      ),
    listTrash: async (userId) =>
      [...rows.values()].filter((r) => r.userId === userId && r.state === "trashed"),
    getById: async (userId, id) => {
      const row = rows.get(id);
      return row && row.userId === userId ? row : null;
    },
    deleteById: async (userId, id) => {
      const row = rows.get(id);
      if (row && row.userId === userId) rows.delete(id);
    },
  };

  return { store, inserts, rows };
}

function callerFor(
  user: SessionUser | null,
  adapter: VaultAdapter,
  versionStore?: VaultVersionStore,
) {
  const appRouter = createTRPCRouter({
    files: createFilesRouter({
      adapter,
      versionStore: versionStore ?? createFakeVersionStore().store,
    }),
  });
  const createCaller = createCallerFactory(appRouter);
  return createCaller({ db: {} as never, headers: new Headers(), user });
}

/**
 * Assert a rejection carries a specific tRPC error CODE.
 *
 * Not a message match: when zod rejects an input, tRPC throws a TRPCError
 * whose `code` is BAD_REQUEST but whose `message` is the serialized zod issue
 * list. Matching the message would therefore pass or fail on the shape of
 * zod's JSON — which is not the contract, and would rot on a zod upgrade. The
 * code IS the contract.
 */
async function expectRejectionCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

// ---------------------------------------------------------------------------
// Signed out — one test per procedure, written out
// ---------------------------------------------------------------------------

describe("a signed-out caller reaches nothing", () => {
  // WRITTEN OUT, NOT LOOPED. This is the assertion most likely to be quietly
  // wrong for exactly ONE procedure, and a loop over a list that someone later
  // forgets to extend would skip the new one in silence (T-66-04).

  it("list -> UNAUTHORIZED", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(callerFor(null, adapter).files.list({ path: [] }), "UNAUTHORIZED");
    expect(calls).toHaveLength(0);
  });

  it("createFolder -> UNAUTHORIZED", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(
      callerFor(null, adapter).files.createFolder({ path: [], name: "x" }),
      "UNAUTHORIZED",
    );
    expect(calls).toHaveLength(0);
  });

  it("requestUpload -> UNAUTHORIZED", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(
      callerFor(null, adapter).files.requestUpload({ path: [], name: "x.txt", size: 10 }),
      "UNAUTHORIZED",
    );
    expect(calls).toHaveLength(0);
  });

  it("requestDownload -> UNAUTHORIZED", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(
      callerFor(null, adapter).files.requestDownload({ path: [], name: "x.txt" }),
      "UNAUTHORIZED",
    );
    expect(calls).toHaveLength(0);
  });

  it("remove -> UNAUTHORIZED", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(
      callerFor(null, adapter).files.remove({ path: [], name: "x.txt", isFolder: false }),
      "UNAUTHORIZED",
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The acting user is ctx.user.id — on every procedure
// ---------------------------------------------------------------------------

describe("the acting user comes from the auth context", () => {
  it("list acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.list({ path: ["docs"] });
    expect(calls[0]).toMatchObject({ userId: "user-a", segments: ["docs"], offset: 0 });
  });

  it("list with a cursor STILL acts as ctx.user.id — an offset moves down a page, never across a tenant", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.list({ path: ["docs"], cursor: 500 });
    expect(calls[0]).toMatchObject({ userId: "user-a", segments: ["docs"], offset: 500 });
  });

  it("list rejects a negative or non-integer cursor before storage is touched", async () => {
    const { adapter, calls } = createFakeAdapter();
    await expectRejectionCode(
      callerFor(USER_A, adapter).files.list({ path: [], cursor: -500 }),
      "BAD_REQUEST",
    );
    await expectRejectionCode(
      callerFor(USER_A, adapter).files.list({ path: [], cursor: 1.5 }),
      "BAD_REQUEST",
    );
    expect(calls).toHaveLength(0);
  });

  it("createFolder acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.createFolder({ path: ["docs"], name: "2026" });
    expect(calls[0]).toMatchObject({ userId: "user-a", name: "2026" });
  });

  it("requestUpload acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.requestUpload({
      path: ["docs"],
      name: "new.pdf",
      size: 1024,
    });
    // requestUpload now checks quota (folderSizeRollup) and existence
    // (statEntry) before signing — every touch still acts as ctx.user.id.
    expect(calls.every((c) => c.userId === "user-a")).toBe(true);
    expect(calls.find((c) => c.op === "signedUploadUrl")).toMatchObject({
      userId: "user-a",
      name: "new.pdf",
    });
  });

  it("requestDownload acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.requestDownload({ path: [], name: "a.txt" });
    expect(calls[0]).toMatchObject({ userId: "user-a", name: "a.txt" });
  });

  it("remove acts as ctx.user.id (soft-delete → trash)", async () => {
    const { adapter, calls } = createFakeAdapter();
    const { store, inserts } = createFakeVersionStore();
    await callerFor(USER_A, adapter, store).files.remove({
      path: [],
      name: "a.txt",
      isFolder: false,
    });
    // remove no longer hard-deletes — it trashes, and records a file_versions
    // row. Both the storage move and the DB write act as ctx.user.id.
    expect(calls.find((c) => c.op === "trashEntry")).toMatchObject({
      userId: "user-a",
      isFolder: false,
    });
    expect(inserts[0]).toMatchObject({ userId: "user-a", state: "trashed" });
  });
});

// ---------------------------------------------------------------------------
// DR-01/02/04 — the new verbs act as ctx.user.id, and a signed-out caller
// reaches none of them
// ---------------------------------------------------------------------------

describe("the DR-01/02/04 procedures are protected and self-scoped", () => {
  it("rename acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.rename({
      path: ["docs"],
      name: "a.txt",
      newName: "b.txt",
      isFolder: false,
    });
    expect(calls.find((c) => c.op === "moveEntry")).toMatchObject({
      userId: "user-a",
      name: "a.txt",
      toName: "b.txt",
    });
  });

  it("move acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.move({
      path: [],
      name: "a.txt",
      toPath: ["archive"],
      isFolder: false,
    });
    expect(calls.find((c) => c.op === "moveEntry")).toMatchObject({
      userId: "user-a",
      toSegments: ["archive"],
    });
  });

  it("restoreFromTrash reads and restores only the caller's own trash row", async () => {
    const { adapter } = createFakeAdapter();
    const { store } = createFakeVersionStore();
    // Seed a trashed row owned by USER_A.
    const seeded = await store.insert(USER_A.id, {
      id: "33333333-3333-4333-8333-333333333333",
      objectPath: "docs/a.txt",
      state: "trashed",
      versionKey: ".trash/33333333-3333-4333-8333-333333333333",
      isFolder: false,
      sizeBytes: 3,
      contentType: null,
      expiresAt: null,
    });

    await callerFor(USER_A, adapter, store).files.restoreFromTrash({ id: seeded.id });

    // And user-b cannot restore user-a's row — fail-closed to NOT_FOUND.
    await expectRejectionCode(
      callerFor({ id: USER_B_ID }, adapter, store).files.restoreFromTrash({ id: seeded.id }),
      "NOT_FOUND",
    );
  });

  it("usageSummary rolls up the caller's own vault", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.usageSummary();
    expect(calls.find((c) => c.op === "folderSizeRollup")).toMatchObject({
      userId: "user-a",
    });
  });

  it("signed-out callers reach none of the new procedures", async () => {
    const { adapter, calls } = createFakeAdapter();
    const caller = callerFor(null, adapter);
    await expectRejectionCode(
      caller.files.rename({ path: [], name: "a", newName: "b", isFolder: false }),
      "UNAUTHORIZED",
    );
    await expectRejectionCode(
      caller.files.move({ path: [], name: "a", toPath: ["x"], isFolder: false }),
      "UNAUTHORIZED",
    );
    await expectRejectionCode(caller.files.usageSummary(), "UNAUTHORIZED");
    await expectRejectionCode(
      caller.files.restoreVersion({ id: "44444444-4444-4444-8444-444444444444" }),
      "UNAUTHORIZED",
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Impersonation — the input lies, and it is ignored
// ---------------------------------------------------------------------------

describe("an input that claims to be someone else is ignored", () => {
  // zod strips unknown keys BY DEFAULT. These tests are what turn that default
  // into a guarantee — without them, a later `.passthrough()` (added for some
  // unrelated convenience) silently opens every one of these procedures.

  const IMPERSONATION = {
    userId: USER_B_ID,
    key: "user-b/secret.pdf",
    bucket: "user-files",
    prefix: "user-b/",
  };

  it("list ignores a userId/key in the input", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.list({ path: [], ...IMPERSONATION } as never);
    expect(calls[0]?.userId).toBe("user-a");
  });

  it("createFolder ignores a userId/key in the input", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.createFolder({
      path: [],
      name: "x",
      ...IMPERSONATION,
    } as never);
    expect(calls[0]?.userId).toBe("user-a");
  });

  it("requestUpload ignores a userId/key in the input", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.requestUpload({
      path: [],
      name: "x.txt",
      size: 5,
      ...IMPERSONATION,
    } as never);
    expect(calls[0]?.userId).toBe("user-a");
  });

  it("requestDownload ignores a userId/key in the input", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.requestDownload({
      path: [],
      name: "x.txt",
      ...IMPERSONATION,
    } as never);
    expect(calls[0]?.userId).toBe("user-a");
  });

  it("remove ignores a userId/key in the input", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.remove({
      path: [],
      name: "x.txt",
      isFolder: false,
      ...IMPERSONATION,
    } as never);
    expect(calls[0]?.userId).toBe("user-a");
  });
});

// ---------------------------------------------------------------------------
// Traversal at the transport edge
// ---------------------------------------------------------------------------

describe("traversal is rejected before storage is touched", () => {
  it("list({ path: ['..','user-b'] }) -> BAD_REQUEST, adapter never called", async () => {
    const { adapter, calls } = createFakeAdapter();

    await expectRejectionCode(
      callerFor(USER_A, adapter).files.list({ path: ["..", USER_B_ID] }),
      "BAD_REQUEST",
    );

    // The half that matters. "It errored" is a weaker claim than "it never
    // touched storage" — an error raised AFTER a listing would still have
    // leaked the listing.
    expect(calls).toHaveLength(0);
  });

  it("remove({ name: '../../user-b/x' }) -> BAD_REQUEST, adapter never called", async () => {
    const { adapter, calls } = createFakeAdapter();

    await expectRejectionCode(
      callerFor(USER_A, adapter).files.remove({
        path: [],
        name: "../../user-b/x",
        isFolder: false,
      }),
      "BAD_REQUEST",
    );

    expect(calls).toHaveLength(0);
  });

  it("requestUpload with a crafted name -> BAD_REQUEST, adapter never called", async () => {
    const { adapter, calls } = createFakeAdapter();

    await expectRejectionCode(
      callerFor(USER_A, adapter).files.requestUpload({
        path: [],
        name: "../user-b/evil.pdf",
        size: 10,
      }),
      "BAD_REQUEST",
    );

    expect(calls).toHaveLength(0);
  });

  it("requestUpload above the size cap -> BAD_REQUEST, adapter never called", async () => {
    const { adapter, calls } = createFakeAdapter();

    await expectRejectionCode(
      callerFor(USER_A, adapter).files.requestUpload({
        path: [],
        name: "huge.bin",
        size: 100 * 1024 * 1024 + 1,
      }),
      "BAD_REQUEST",
    );

    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A storage failure is never an empty folder
// ---------------------------------------------------------------------------

describe("a storage failure raises, and says nothing", () => {
  it("list throws instead of returning []", async () => {
    // The lie this prevents: an empty array here renders as "your vault is
    // empty" on top of the user's real files.
    const { adapter } = createFakeAdapter({ throwOn: "listFolder" });

    await expect(callerFor(USER_A, adapter).files.list({ path: [] })).rejects.toThrow();
  });

  it("the client-facing message leaks no key or bucket name (T-66-07)", async () => {
    const { adapter } = createFakeAdapter({ throwOn: "listFolder" });

    // `unknown` and narrowed, not typed as `Error` at the boundary — a thrown
    // value genuinely can be anything, and asserting on `err.message` after a
    // cast would be a claim about a shape nobody checked.
    await expect(
      callerFor(USER_A, adapter).files.list({ path: [] }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        !message.includes("user-b/secret.pdf") &&
        !message.includes("user-files") &&
        !message.includes("denied")
      );
    });
  });
});
