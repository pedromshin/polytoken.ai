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
 * `ctx.db` is `{} as never`. The files router touches no table (D-66-01), and
 * this is what proves it: the day someone adds a metadata table without going
 * through the migrations queue, these tests throw. That alarm is deliberate.
 */

import { describe, expect, it } from "vitest";

import type { VaultAdapter } from "../storage-adapter";
import type { SessionUser } from "../../../trpc";
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
  isFolder?: boolean;
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
    listFolder: async (userId, segments) => {
      calls.push({ op: "listFolder", userId, segments });
      maybeThrow("listFolder");
      return [
        {
          name: "a.txt",
          kind: "text",
          isFolder: false,
          size: 1,
          updatedAt: null,
          contentType: "text/plain",
        },
      ];
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
  };

  return { adapter, calls };
}

function callerFor(user: SessionUser | null, adapter: VaultAdapter) {
  const appRouter = createTRPCRouter({ files: createFilesRouter({ adapter }) });
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
    expect(calls[0]).toMatchObject({ userId: "user-a", segments: ["docs"] });
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
    expect(calls[0]).toMatchObject({ userId: "user-a", name: "new.pdf" });
  });

  it("requestDownload acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.requestDownload({ path: [], name: "a.txt" });
    expect(calls[0]).toMatchObject({ userId: "user-a", name: "a.txt" });
  });

  it("remove acts as ctx.user.id", async () => {
    const { adapter, calls } = createFakeAdapter();
    await callerFor(USER_A, adapter).files.remove({
      path: [],
      name: "a.txt",
      isFolder: false,
    });
    expect(calls[0]).toMatchObject({ userId: "user-a", isFolder: false });
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
