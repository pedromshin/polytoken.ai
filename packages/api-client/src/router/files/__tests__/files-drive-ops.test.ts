/**
 * files-drive-ops.test.ts — DR-01/02/04 router behaviour end-to-end over the
 * REAL storage adapter (Map-backed fake client) + a Map-backed version store.
 *
 * files-tenancy.test.ts proves WHO each procedure acts as; this file proves
 * WHAT the DR verbs actually do: the soft-delete round-trip, versioning-on-
 * overwrite and its key-suffix scheme, the version list, restore, and the
 * quota soft-block. Wiring the real adapter (not the recording fake) is the
 * point — the storage moves/copies really happen against the in-memory bucket,
 * so the park keys and the round-trip are asserted, not mocked.
 */

import { describe, expect, it } from "vitest";

import type { RawFileObject, VaultStorageClient } from "../vault-types";
import type { SessionUser } from "../../../trpc";
import type {
  NewVaultVersion,
  VaultVersionRecord,
  VaultVersionStore,
} from "../version-store";
import { createCallerFactory, createTRPCRouter } from "../../../trpc";
import { createFilesRouter } from "../index";
import { createVaultAdapter, VAULT_QUOTA_BYTES } from "../storage-adapter";

const BUCKET = "user-files";
const USER_A: SessionUser = { id: "user-a" };

type FakeObject = { size: number; mimetype: string; updated_at: string };
const FILE = (size = 100, mimetype = "text/plain"): FakeObject => ({
  size,
  mimetype,
  updated_at: "2026-07-12T10:00:00Z",
});

/** Same one-level tree derivation Supabase Storage does. */
function createFakeClient(initial: Record<string, FakeObject> = {}) {
  const objects = new Map<string, FakeObject>(Object.entries(initial));

  const client: VaultStorageClient = {
    list: async (prefix, opts) => {
      const base = prefix === "" ? "" : `${prefix}/`;
      const files: RawFileObject[] = [];
      const folders = new Set<string>();
      for (const [key, meta] of objects) {
        if (!key.startsWith(base)) continue;
        const rest = key.slice(base.length);
        if (rest.length === 0) continue;
        const slash = rest.indexOf("/");
        if (slash === -1) {
          files.push({
            name: rest,
            id: `id-${key}`,
            updated_at: meta.updated_at,
            metadata: { size: meta.size, mimetype: meta.mimetype },
          });
        } else {
          folders.add(rest.slice(0, slash));
        }
      }
      const folderEntries: RawFileObject[] = [...folders].map((name) => ({
        name,
        id: null,
        updated_at: null,
        metadata: null,
      }));
      const all = [...folderEntries, ...files].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
    },
    createSignedUrl: async (path) => ({
      data: { signedUrl: `https://fake/${path}` },
      error: null,
    }),
    createSignedUploadUrl: async (path) => ({
      data: { signedUrl: `https://fake/up/${path}`, token: "T", path },
      error: null,
    }),
    upload: async (path, _body, opts) => {
      objects.set(path, {
        size: 0,
        mimetype: opts?.contentType ?? "application/octet-stream",
        updated_at: "2026-07-12T10:00:00Z",
      });
      return { data: { path }, error: null };
    },
    remove: async (paths) => {
      for (const p of paths) objects.delete(p);
      return { data: null, error: null };
    },
    move: async (fromPath, toPath) => {
      const obj = objects.get(fromPath);
      if (!obj) return { data: null, error: { message: "not found" } };
      objects.set(toPath, obj);
      objects.delete(fromPath);
      return { data: { message: "ok" }, error: null };
    },
    copy: async (fromPath, toPath) => {
      const obj = objects.get(fromPath);
      if (!obj) return { data: null, error: { message: "not found" } };
      if (objects.has(toPath)) return { data: null, error: { message: "exists" } };
      objects.set(toPath, { ...obj });
      return { data: { path: toPath }, error: null };
    },
  };

  return { client, objects, keys: () => [...objects.keys()].sort() };
}

function createFakeVersionStore() {
  const rows = new Map<string, VaultVersionRecord & { userId: string }>();
  const store: VaultVersionStore = {
    insert: async (userId, r: NewVaultVersion) => {
      const row = {
        userId,
        ...r,
        createdAt: new Date(`2026-07-2${rows.size + 1}T00:00:00Z`),
      };
      rows.set(r.id, row);
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
  return { store, rows };
}

function harness(initial: Record<string, FakeObject> = {}) {
  const fake = createFakeClient(initial);
  const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });
  const versions = createFakeVersionStore();
  const appRouter = createTRPCRouter({
    files: createFilesRouter({ adapter, versionStore: versions.store }),
  });
  const caller = createCallerFactory(appRouter)({
    db: {} as never,
    headers: new Headers(),
    user: USER_A,
  });
  return { fake, versions, caller };
}

// ---------------------------------------------------------------------------
// DR-02 — soft-delete round-trip
// ---------------------------------------------------------------------------

describe("remove is a soft-delete round-trip (DR-02)", () => {
  it("parks the blob in .trash, records a trashed row, then restores both", async () => {
    const { fake, versions, caller } = harness({ "user-a/docs/a.txt": FILE(120) });

    const { id } = await caller.files.remove({
      path: ["docs"],
      name: "a.txt",
      isFolder: false,
    });

    // The live blob is gone from its path and parked under the key-suffix.
    expect(fake.keys()).toEqual([`user-a/.trash/${id}`]);
    const row = versions.rows.get(id)!;
    expect(row).toMatchObject({
      state: "trashed",
      objectPath: "docs/a.txt",
      versionKey: `.trash/${id}`,
      sizeBytes: 120,
    });
    expect(row.expiresAt).toBeInstanceOf(Date);

    // It shows up in the trash listing…
    const trash = await caller.files.listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ id, name: "a.txt", objectPath: "docs/a.txt" });

    // …and restore lands it back and clears the row.
    await caller.files.restoreFromTrash({ id });
    expect(fake.keys()).toEqual(["user-a/docs/a.txt"]);
    expect(versions.rows.get(id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DR-02 — versioning-on-overwrite + the key-suffix scheme
// ---------------------------------------------------------------------------

describe("requestUpload versions the prior blob on overwrite (DR-02)", () => {
  it("snapshots the current blob into .versions/<id> before signing", async () => {
    const { fake, versions, caller } = harness({ "user-a/a.txt": FILE(50, "text/plain") });

    await caller.files.requestUpload({ path: [], name: "a.txt", size: 10 });

    // A version row was written, keyed on the object, with the key-SUFFIX scheme.
    const rows = [...versions.rows.values()];
    expect(rows).toHaveLength(1);
    const v = rows[0]!;
    expect(v).toMatchObject({ state: "version", objectPath: "a.txt", sizeBytes: 50 });
    expect(v.versionKey).toBe(`.versions/${v.id}`);
    // The snapshot blob really exists at that suffix, and the live file remains.
    expect(fake.objects.has(`user-a/.versions/${v.id}`)).toBe(true);
    expect(fake.objects.has("user-a/a.txt")).toBe(true);
  });

  it("a FIRST-TIME upload snapshots nothing", async () => {
    const { versions, caller } = harness({});
    await caller.files.requestUpload({ path: [], name: "new.txt", size: 10 });
    expect(versions.rows.size).toBe(0);
  });

  it("listVersions returns the object's history without leaking the park key", async () => {
    const { versions, caller } = harness({ "user-a/a.txt": FILE(50) });
    await caller.files.requestUpload({ path: [], name: "a.txt", size: 10 });

    const list = await caller.files.listVersions({ path: [], name: "a.txt" });
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(
      ["contentType", "createdAt", "id", "sizeBytes"].sort(),
    );
    const stored = [...versions.rows.values()][0]!;
    expect(list[0]!.id).toBe(stored.id);
  });
});

describe("restoreVersion (DR-02)", () => {
  it("snapshots the current content, then restores the chosen version's blob", async () => {
    const { fake, versions, caller } = harness({ "user-a/a.txt": FILE(50, "v1") });

    // Overwrite once → creates version #1 (the v1 blob). Simulate the PUT.
    await caller.files.requestUpload({ path: [], name: "a.txt", size: 10 });
    fake.objects.set("user-a/a.txt", FILE(20, "v2"));
    const v1 = [...versions.rows.values()].find((r) => r.state === "version")!;

    await caller.files.restoreVersion({ id: v1.id });

    // The live file now carries v1's content again…
    expect(fake.objects.get("user-a/a.txt")?.mimetype).toBe("v1");
    // …and a NEW version (the superseded v2) was recorded — restore is undoable.
    const versionRows = [...versions.rows.values()].filter((r) => r.state === "version");
    expect(versionRows.length).toBe(2);
  });

  it("a version id that is not the caller's is NOT_FOUND", async () => {
    const { caller } = harness({});
    await expect(
      caller.files.restoreVersion({ id: "55555555-5555-4555-8555-555555555555" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// DR-04 — usage + quota soft-block
// ---------------------------------------------------------------------------

describe("usage + quota (DR-04)", () => {
  it("usageSummary reports LIVE bytes against the quota, parks excluded", async () => {
    const { caller } = harness({
      "user-a/a.txt": FILE(100),
      "user-a/docs/b.txt": FILE(200),
      "user-a/.trash/abc": FILE(9999),
    });

    const usage = await caller.files.usageSummary();
    expect(usage.usedBytes).toBe(300);
    expect(usage.quotaBytes).toBe(VAULT_QUOTA_BYTES);
    expect(usage.availableBytes).toBe(VAULT_QUOTA_BYTES - 300);
  });

  it("folderSizeRollup is the reusable per-folder aggregate (TM-04 substrate)", async () => {
    const { caller } = harness({
      "user-a/a.txt": FILE(100),
      "user-a/docs/b.txt": FILE(200),
    });
    const rollup = await caller.files.folderSizeRollup({ path: [] });
    expect(rollup.total).toBe(300);
    // Name-sorted, as storage returns them.
    expect(rollup.children).toEqual([
      { name: "a.txt", isFolder: false, size: 100 },
      { name: "docs", isFolder: true, size: 200 },
    ]);
  });

  it("requestUpload SOFT-BLOCKS once the vault is at quota", async () => {
    // Seed usage right at the ceiling; a further upload must be refused BEFORE a
    // URL is minted.
    const { caller } = harness({ "user-a/huge.bin": FILE(VAULT_QUOTA_BYTES) });

    await expect(
      caller.files.requestUpload({ path: [], name: "one-more.txt", size: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an upload that fits under the quota", async () => {
    const { caller } = harness({ "user-a/small.txt": FILE(100) });
    await expect(
      caller.files.requestUpload({ path: [], name: "ok.txt", size: 100 }),
    ).resolves.toMatchObject({ url: expect.stringContaining("http") });
  });
});

// ---------------------------------------------------------------------------
// DR-01 — move guards (skeptic findings, 2026-07-23)
// ---------------------------------------------------------------------------

describe("move rejects a folder into itself or a descendant (DR-01)", () => {
  it("rejects moving folder docs into docs/inner (its own subtree)", async () => {
    const { caller } = harness();
    await expect(
      caller.files.move({ path: [], name: "docs", toPath: ["docs", "inner"], isFolder: true }),
    ).rejects.toThrow(/itself or one of its own/);
  });

  it("rejects moving folder docs into docs itself", async () => {
    const { caller } = harness();
    await expect(
      caller.files.move({ path: [], name: "docs", toPath: ["docs"], isFolder: true }),
    ).rejects.toThrow(/itself or one of its own/);
  });

  it("allows moving folder docs into an unrelated folder", async () => {
    const { caller } = harness();
    const res = await caller.files.move({
      path: [],
      name: "docs",
      toPath: ["archive"],
      isFolder: true,
    });
    expect(res.ok).toBe(true);
  });
});
