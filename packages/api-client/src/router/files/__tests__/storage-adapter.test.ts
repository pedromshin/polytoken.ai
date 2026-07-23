/**
 * storage-adapter.test.ts — the adapter's every branch, against a hand-written
 * in-memory fake (Phase 66 Plan 01 Task 2).
 *
 * NO `vi.mock` of Supabase, no network, no env. `VaultStorageClient`
 * (vault-types.ts) is a STRUCTURAL type, so a ~60-line Map-backed fake
 * satisfies it — which is the entire reason the seam exists. The payoff is
 * that the ERROR branches, which a live bucket would never produce on demand,
 * are as cheap to assert as the happy ones. That matters more than it sounds:
 * `listFolder` swallowing an error renders as "empty vault" over the user's
 * real files, and it is the worst lie this surface could tell.
 *
 * The most important test in this file is the last one: the recursive folder
 * delete NEVER touches a key outside `{userId}/`, proven against a fake that
 * is holding another user's objects at the same time.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { RawFileObject, VaultStorageClient } from "../vault-types";
import { EMPTY_FOLDER_PLACEHOLDER } from "../vault-keys";
import {
  createVaultAdapter,
  VAULT_LIST_PAGE_SIZE,
  VAULT_MAX_UPLOAD_BYTES,
  VaultStorageError,
} from "../storage-adapter";

const BUCKET = "user-files";
const USER_A = "user-a";
const USER_B = "user-b";

// ---------------------------------------------------------------------------
// The fake — an in-memory bucket
// ---------------------------------------------------------------------------

type FakeCall = { op: string; args: unknown[] };

type FakeObject = { size: number; mimetype: string; updated_at: string };

/**
 * A Map of key -> object, plus a `list()` that derives one level of the tree
 * the way Supabase Storage does: immediate children as files, deeper prefixes
 * collapsed into folder entries with `id: null`.
 */
function createFakeClient(initial: Record<string, FakeObject> = {}) {
  const objects = new Map<string, FakeObject>(Object.entries(initial));
  const calls: FakeCall[] = [];
  let listError: string | null = null;

  const client: VaultStorageClient = {
    list: async (prefix, opts) => {
      calls.push({ op: "list", args: [prefix, opts] });
      if (listError) return { data: null, error: { message: listError } };

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

      // Real storage returns one flat page; the adapter owns the ordering.
      const all = [...folderEntries, ...files].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return {
        data: all.slice(opts.offset, opts.offset + opts.limit),
        error: null,
      };
    },

    createSignedUrl: async (path, expiresIn, opts) => {
      calls.push({ op: "createSignedUrl", args: [path, expiresIn, opts] });
      return {
        data: { signedUrl: `https://fake.storage/${path}?sig=abc&token=SECRET` },
        error: null,
      };
    },

    createSignedUploadUrl: async (path) => {
      calls.push({ op: "createSignedUploadUrl", args: [path] });
      return {
        data: {
          signedUrl: `https://fake.storage/upload/${path}?token=T`,
          token: "T",
          path,
        },
        error: null,
      };
    },

    upload: async (path, body, opts) => {
      calls.push({ op: "upload", args: [path, body, opts] });
      objects.set(path, {
        size: 0,
        mimetype: opts?.contentType ?? "application/octet-stream",
        updated_at: "2026-07-12T10:00:00Z",
      });
      return { data: { path }, error: null };
    },

    remove: async (paths) => {
      calls.push({ op: "remove", args: [paths] });
      for (const p of paths) objects.delete(p);
      return { data: null, error: null };
    },

    move: async (fromPath, toPath) => {
      calls.push({ op: "move", args: [fromPath, toPath] });
      const obj = objects.get(fromPath);
      // Supabase move errors when the source is absent — the adapter turns that
      // into a VaultStorageError, never a silent no-op.
      if (!obj) return { data: null, error: { message: "not found" } };
      objects.set(toPath, obj);
      objects.delete(fromPath);
      return { data: { message: "moved" }, error: null };
    },

    copy: async (fromPath, toPath) => {
      calls.push({ op: "copy", args: [fromPath, toPath] });
      const obj = objects.get(fromPath);
      if (!obj) return { data: null, error: { message: "not found" } };
      // Supabase copy errors on an existing destination — the source SURVIVES,
      // so a caller that must overwrite removes the dest first (restoreVersion).
      if (objects.has(toPath)) return { data: null, error: { message: "exists" } };
      objects.set(toPath, { ...obj });
      return { data: { path: toPath }, error: null };
    },
  };

  return {
    client,
    calls,
    objects,
    keys: () => [...objects.keys()].sort(),
    callsOf: (op: string) => calls.filter((c) => c.op === op),
    failListWith: (message: string) => {
      listError = message;
    },
  };
}

const FILE = (size = 100, mimetype = "text/plain"): FakeObject => ({
  size,
  mimetype,
  updated_at: "2026-07-12T10:00:00Z",
});

// ---------------------------------------------------------------------------
// listFolder
// ---------------------------------------------------------------------------

describe("listFolder", () => {
  it("maps folders (id === null) and files (metadata) onto VaultEntry", async () => {
    const fake = createFakeClient({
      "user-a/notes.txt": FILE(120, "text/plain"),
      "user-a/photos/cat.png": FILE(900, "image/png"),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const { entries } = await adapter.listFolder(USER_A, []);

    expect(entries).toEqual([
      {
        name: "photos",
        kind: "folder",
        isFolder: true,
        size: null,
        updatedAt: null,
        contentType: null,
      },
      {
        name: "notes.txt",
        kind: "text",
        isFolder: false,
        size: 120,
        updatedAt: "2026-07-12T10:00:00Z",
        contentType: "text/plain",
      },
    ]);
  });

  it("filters out the empty-folder placeholder — it is bookkeeping, never a row", async () => {
    const fake = createFakeClient({
      [`user-a/empty/${EMPTY_FOLDER_PLACEHOLDER}`]: FILE(0),
      "user-a/empty/real.txt": FILE(5),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const { entries } = await adapter.listFolder(USER_A, ["empty"]);

    expect(entries.map((e) => e.name)).toEqual(["real.txt"]);
  });

  it.each([
    ["a.png", "image"],
    ["a.PNG", "image"],
    ["a.jpeg", "image"],
    ["a.txt", "text"],
    ["a.md", "text"],
    ["a.zip", "archive"],
    ["a.tar.gz", "archive"],
    ["a.mp3", "audio"],
    ["a.mp4", "video"],
    ["a.unknownext", "file"],
    ["noextension", "file"],
  ])("derives kind from the extension: %s -> %s", async (name, kind) => {
    const fake = createFakeClient({ [`user-a/${name}`]: FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const { entries } = await adapter.listFolder(USER_A, []);

    expect(entries[0]?.kind).toBe(kind);
  });

  it("sorts folders before files, then by name — the registry rhythm, decided server-side", async () => {
    const fake = createFakeClient({
      "user-a/zebra.txt": FILE(),
      "user-a/apple.txt": FILE(),
      "user-a/zoo/x.txt": FILE(),
      "user-a/archive/y.txt": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const { entries } = await adapter.listFolder(USER_A, []);

    expect(entries.map((e) => e.name)).toEqual([
      "archive",
      "zoo",
      "apple.txt",
      "zebra.txt",
    ]);
  });

  it("passes limit 500 — the cap is real, not a comment", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.listFolder(USER_A, []);

    const [, opts] = fake.callsOf("list")[0]!.args as [string, { limit: number }];
    expect(opts.limit).toBe(500);
  });

  it("lists under the caller's own prefix and nowhere else", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.listFolder(USER_A, ["docs"]);

    expect(fake.callsOf("list")[0]!.args[0]).toBe("user-a/docs");
  });

  it("returns an empty LAST page for a genuinely empty folder", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.listFolder(USER_A, [])).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it("THROWS on a storage error — it never invents an empty listing out of a failure", async () => {
    // The "silent empty vault" lie, gated. A `[]` here renders as "your vault
    // is empty" on top of the user's real files. Asserted SEPARATELY from the
    // empty-folder case above so the two can never collapse into each other.
    const fake = createFakeClient({});
    fake.failListWith("storage exploded");
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.listFolder(USER_A, [])).rejects.toBeInstanceOf(
      VaultStorageError,
    );
  });

  it("refuses a traversal payload before it reaches storage", async () => {
    const fake = createFakeClient({ "user-b/secret.pdf": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.listFolder(USER_A, ["..", "user-b"])).rejects.toThrow();
    expect(fake.callsOf("list")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listFolder pagination — the 500-entry cap is a PAGE, not a truncation
// ---------------------------------------------------------------------------

describe("listFolder pagination (v2.1 hardening)", () => {
  /** Seed n files under user-a/, zero-padded so name order is stable. */
  const seed = (n: number): Record<string, FakeObject> => {
    const objects: Record<string, FakeObject> = {};
    for (let i = 0; i < n; i++) {
      objects[`user-a/f-${String(i).padStart(5, "0")}.txt`] = FILE();
    }
    return objects;
  };

  it("a full page reports the next cursor; the last page reports null", async () => {
    const fake = createFakeClient(seed(VAULT_LIST_PAGE_SIZE + 1));
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const first = await adapter.listFolder(USER_A, []);
    expect(first.entries).toHaveLength(VAULT_LIST_PAGE_SIZE);
    expect(first.nextCursor).toBe(VAULT_LIST_PAGE_SIZE);

    // The entry Phase 66 silently dropped is now reachable.
    const second = await adapter.listFolder(USER_A, [], first.nextCursor!);
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("forwards the offset to storage — the cursor is real, not decorative", async () => {
    const fake = createFakeClient(seed(1));
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.listFolder(USER_A, ["docs"], 500);

    const [, opts] = fake.callsOf("list")[0]!.args as [string, { offset: number }];
    expect(opts.offset).toBe(500);
  });

  it("an exactly-full LAST page reports a cursor whose next page is empty — over-ask, never under-show", async () => {
    // With offset-based listing the server cannot know a full page is the
    // final one without a second call. The honest resolution: report a
    // cursor, and let the next page come back empty-and-final. The client
    // shows one extra "Show more" that resolves to nothing — cheap. The
    // alternative (guessing null) hides real entries — not cheap.
    const fake = createFakeClient(seed(VAULT_LIST_PAGE_SIZE));
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const first = await adapter.listFolder(USER_A, []);
    expect(first.nextCursor).toBe(VAULT_LIST_PAGE_SIZE);

    const second = await adapter.listFolder(USER_A, [], first.nextCursor!);
    expect(second.entries).toHaveLength(0);
    expect(second.nextCursor).toBeNull();
  });

  it("the placeholder filter cannot swallow a page boundary", async () => {
    // A full raw page that CONTAINS the placeholder maps to 499 visible
    // entries — the cursor decision reads the RAW length, so the page still
    // chains. Decided on filtered length, the tail of the folder vanishes.
    const objects = seed(VAULT_LIST_PAGE_SIZE + 1);
    delete objects[`user-a/f-00000.txt`];
    objects[`user-a/${EMPTY_FOLDER_PLACEHOLDER}`] = FILE(0);
    const fake = createFakeClient(objects);
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const first = await adapter.listFolder(USER_A, []);
    expect(first.entries).toHaveLength(VAULT_LIST_PAGE_SIZE - 1);
    expect(first.nextCursor).toBe(VAULT_LIST_PAGE_SIZE);
  });
});

// ---------------------------------------------------------------------------
// signedDownloadUrl
// ---------------------------------------------------------------------------

describe("signedDownloadUrl", () => {
  it("signs the vaultKey with a 60s expiry and ATTACHMENT disposition", async () => {
    const fake = createFakeClient({ "user-a/docs/report.pdf": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.signedDownloadUrl(USER_A, ["docs"], "report.pdf");

    const [path, expiresIn, opts] = fake.callsOf("createSignedUrl")[0]!.args as [
      string,
      number,
      { download?: string },
    ];
    expect(path).toBe("user-a/docs/report.pdf");
    expect(expiresIn).toBe(60);
    // D-66-04: attachment disposition for ALL content types, no exceptions.
    // Without this a text/html upload is a stored-XSS on our own origin.
    expect(opts.download).toBe("report.pdf");
  });

  it("returns ONLY { url } — no token, key, or bucket leaks to the browser", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const result = await adapter.signedDownloadUrl(USER_A, [], "a.txt");

    expect(Object.keys(result)).toEqual(["url"]);
  });

  it("throws on a storage error", async () => {
    const fake = createFakeClient({});
    const failing = {
      ...fake.client,
      createSignedUrl: async () => ({ data: null, error: { message: "nope" } }),
    };
    const adapter = createVaultAdapter({ client: failing, bucket: BUCKET });

    await expect(
      adapter.signedDownloadUrl(USER_A, [], "a.txt"),
    ).rejects.toBeInstanceOf(VaultStorageError);
  });
});

// ---------------------------------------------------------------------------
// signedUploadUrl + createFolder
// ---------------------------------------------------------------------------

describe("signedUploadUrl", () => {
  it("mints an upload URL for a key prefixed by the caller's own id", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const result = await adapter.signedUploadUrl(USER_A, ["docs"], "new.pdf");

    expect(result.key).toBe("user-a/docs/new.pdf");
    expect(result.key.startsWith(`${USER_A}/`)).toBe(true);
    expect(result.token).toBe("T");
    expect(result.url).toContain("upload");
  });

  it("refuses a crafted filename before it reaches storage", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(
      adapter.signedUploadUrl(USER_A, [], "../../user-b/evil.pdf"),
    ).rejects.toThrow();
    expect(fake.callsOf("createSignedUploadUrl")).toHaveLength(0);
  });
});

describe("createFolder", () => {
  it("writes the zero-byte placeholder at exactly the expected key", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.createFolder(USER_A, ["docs"], "2026");

    const [path, , opts] = fake.callsOf("upload")[0]!.args as [
      string,
      unknown,
      { upsert?: boolean },
    ];
    expect(path).toBe(`user-a/docs/2026/${EMPTY_FOLDER_PLACEHOLDER}`);
    expect(opts.upsert).toBe(false);
  });

  it("refuses to let the user mint the reserved placeholder name", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(
      adapter.createFolder(USER_A, [], EMPTY_FOLDER_PLACEHOLDER),
    ).rejects.toThrow();
    expect(fake.callsOf("upload")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeEntry — the destructive end
// ---------------------------------------------------------------------------

describe("removeEntry", () => {
  it("removes a file by one exact key", async () => {
    const fake = createFakeClient({
      "user-a/a.txt": FILE(),
      "user-a/b.txt": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.removeEntry(USER_A, [], "a.txt", false);

    expect(fake.keys()).toEqual(["user-a/b.txt"]);
  });

  it("removes a folder RECURSIVELY — every level, not just the first page of children", async () => {
    const fake = createFakeClient({
      "user-a/keep.txt": FILE(),
      "user-a/docs/one.txt": FILE(),
      [`user-a/docs/${EMPTY_FOLDER_PLACEHOLDER}`]: FILE(0),
      "user-a/docs/deep/two.txt": FILE(),
      "user-a/docs/deep/deeper/three.txt": FILE(),
      "user-a/docs/deep/deeper/four.png": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.removeEntry(USER_A, [], "docs", true);

    // Everything under docs/ is gone — including the placeholders — and the
    // sibling file is untouched.
    expect(fake.keys()).toEqual(["user-a/keep.txt"]);
  });

  it("pages the walk — a >500-entry folder is fully removed, not capped at the listing limit", async () => {
    const many: Record<string, FakeObject> = {};
    for (let i = 0; i < 1201; i++) {
      many[`user-a/big/file-${String(i).padStart(5, "0")}.txt`] = FILE();
    }
    many["user-a/outside.txt"] = FILE();
    const fake = createFakeClient(many);
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.removeEntry(USER_A, [], "big", true);

    expect(fake.keys()).toEqual(["user-a/outside.txt"]);
  });

  it("THE TENANCY PROOF: the walk never removes a key outside {userId}/", async () => {
    // The single most important assertion in this plan. The adapter holds
    // service-role credentials — it CAN address every user's objects. The fake
    // is deliberately seeded with user-b's data, laid out to mirror user-a's
    // names exactly, so a prefix bug would delete something real.
    const fake = createFakeClient({
      "user-a/docs/mine.txt": FILE(),
      "user-a/docs/deep/also-mine.txt": FILE(),
      "user-b/docs/theirs.txt": FILE(),
      "user-b/docs/deep/also-theirs.txt": FILE(),
      "user-b/root.txt": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.removeEntry(USER_A, [], "docs", true);

    expect(fake.keys()).toEqual([
      "user-b/docs/deep/also-theirs.txt",
      "user-b/docs/theirs.txt",
      "user-b/root.txt",
    ]);

    // Stated directly as well: no key handed to `remove` was ever user-b's.
    for (const call of fake.callsOf("remove")) {
      for (const key of call.args[0] as string[]) {
        expect(key.startsWith(`${USER_A}/`), `escaped the prefix: ${key}`).toBe(true);
      }
    }
  });

  it("refuses a crafted name before it reaches storage", async () => {
    const fake = createFakeClient({ "user-b/secret.pdf": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(
      adapter.removeEntry(USER_A, [], "../user-b/secret.pdf", false),
    ).rejects.toThrow();
    expect(fake.callsOf("remove")).toHaveLength(0);
    expect(fake.keys()).toEqual(["user-b/secret.pdf"]);
  });

  it("throws on a storage error rather than reporting a delete that did not happen", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const failing: VaultStorageClient = {
      ...fake.client,
      remove: async () => ({ data: null, error: { message: "denied" } }),
    };
    const adapter = createVaultAdapter({ client: failing, bucket: BUCKET });

    await expect(
      adapter.removeEntry(USER_A, [], "a.txt", false),
    ).rejects.toBeInstanceOf(VaultStorageError);
  });
});

// ---------------------------------------------------------------------------
// DR-01 — moveEntry (rename + move)
// ---------------------------------------------------------------------------

describe("moveEntry (DR-01)", () => {
  it("renames a file in place — one atomic move, sibling untouched", async () => {
    const fake = createFakeClient({
      "user-a/a.txt": FILE(),
      "user-a/keep.txt": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.moveEntry(USER_A, [], "a.txt", [], "b.txt", false);

    expect(fake.keys()).toEqual(["user-a/b.txt", "user-a/keep.txt"]);
  });

  it("moves a file into another folder, keeping its name", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.moveEntry(USER_A, [], "a.txt", ["docs"], "a.txt", false);

    expect(fake.keys()).toEqual(["user-a/docs/a.txt"]);
  });

  it("a move to the identical key is a no-op, never an error", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.moveEntry(USER_A, [], "a.txt", [], "a.txt", false);

    expect(fake.callsOf("move")).toHaveLength(0);
    expect(fake.keys()).toEqual(["user-a/a.txt"]);
  });

  it("relocates a whole folder subtree, preserving structure", async () => {
    const fake = createFakeClient({
      "user-a/docs/one.txt": FILE(),
      "user-a/docs/deep/two.txt": FILE(),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.moveEntry(USER_A, [], "docs", ["archive"], "docs", true);

    expect(fake.keys()).toEqual([
      "user-a/archive/docs/deep/two.txt",
      "user-a/archive/docs/one.txt",
    ]);
  });

  it("refuses a crafted destination name before storage is touched", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(
      adapter.moveEntry(USER_A, [], "a.txt", [], "../user-b/x", false),
    ).rejects.toThrow();
    expect(fake.callsOf("move")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DR-02 — trash, versions, restore (the key-suffix scheme)
// ---------------------------------------------------------------------------

const SNAP_A = "11111111-1111-4111-8111-111111111111";
const SNAP_B = "22222222-2222-4222-8222-222222222222";

describe("trashEntry + restoreFromTrash (DR-02 soft-delete round-trip)", () => {
  it("parks a file under {userId}/.trash/<id> and reports its size", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE(120, "text/plain") });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const parked = await adapter.trashEntry(USER_A, [], "a.txt", false, SNAP_A);

    expect(parked).toEqual({ sizeBytes: 120, contentType: "text/plain" });
    // The KEY-SUFFIX scheme: the blob now lives at the reserved park key.
    expect(fake.keys()).toEqual([`user-a/${".trash"}/${SNAP_A}`]);
  });

  it("round-trips: trash then restore lands the blob back at its origin", async () => {
    const fake = createFakeClient({ "user-a/docs/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await adapter.trashEntry(USER_A, ["docs"], "a.txt", false, SNAP_A);
    expect(fake.keys()).toEqual([`user-a/.trash/${SNAP_A}`]);

    await adapter.restoreFromTrash(USER_A, ["docs"], "a.txt", false, SNAP_A);
    expect(fake.keys()).toEqual(["user-a/docs/a.txt"]);
  });

  it("trashes a folder subtree under one park prefix and restores it whole", async () => {
    const fake = createFakeClient({
      "user-a/docs/one.txt": FILE(10),
      "user-a/docs/deep/two.txt": FILE(20),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const parked = await adapter.trashEntry(USER_A, [], "docs", true, SNAP_A);
    expect(parked.sizeBytes).toBe(30);
    expect(fake.keys()).toEqual([
      `user-a/.trash/${SNAP_A}/deep/two.txt`,
      `user-a/.trash/${SNAP_A}/one.txt`,
    ]);

    await adapter.restoreFromTrash(USER_A, [], "docs", true, SNAP_A);
    expect(fake.keys()).toEqual([
      "user-a/docs/deep/two.txt",
      "user-a/docs/one.txt",
    ]);
  });

  it("rejects a snapshot id that is not a server-minted UUID", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE() });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(
      adapter.trashEntry(USER_A, [], "a.txt", false, "../user-b/evil"),
    ).rejects.toThrow();
    expect(fake.callsOf("move")).toHaveLength(0);
  });
});

describe("snapshotVersion + restoreVersion (DR-02)", () => {
  it("COPIES the live blob into .versions/<id> — the source survives", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE(99, "text/plain") });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const snap = await adapter.snapshotVersion(USER_A, [], "a.txt", SNAP_A);

    expect(snap).toEqual({ sizeBytes: 99, contentType: "text/plain" });
    // Both the live object AND its version copy exist.
    expect(fake.keys()).toEqual([`user-a/.versions/${SNAP_A}`, "user-a/a.txt"]);
  });

  it("restoreVersion overwrites the live key from the version copy", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    // Seed a live file, snapshot it, then mutate the live file.
    fake.objects.set("user-a/a.txt", FILE(10, "old"));
    await adapter.snapshotVersion(USER_A, [], "a.txt", SNAP_A);
    fake.objects.set("user-a/a.txt", FILE(20, "new"));

    await adapter.restoreVersion(USER_A, [], "a.txt", SNAP_A);

    // Live key now holds the version's content; the version copy still exists.
    const live = fake.objects.get("user-a/a.txt");
    expect(live?.mimetype).toBe("old");
    expect(fake.objects.has(`user-a/.versions/${SNAP_A}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DR-04 — statEntry + folderSizeRollup
// ---------------------------------------------------------------------------

describe("statEntry (DR-04)", () => {
  it("returns size + type for a live file", async () => {
    const fake = createFakeClient({ "user-a/a.txt": FILE(42, "text/plain") });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.statEntry(USER_A, [], "a.txt")).resolves.toEqual({
      size: 42,
      contentType: "text/plain",
    });
  });

  it("returns null for an absent file — no existence oracle", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.statEntry(USER_A, [], "missing.txt")).resolves.toBeNull();
  });
});

describe("folderSizeRollup (DR-04, TM-04 substrate)", () => {
  it("sums immediate children — a folder child carries its whole subtree", async () => {
    const fake = createFakeClient({
      "user-a/a.txt": FILE(100),
      "user-a/docs/one.txt": FILE(30),
      "user-a/docs/deep/two.txt": FILE(70),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const rollup = await adapter.folderSizeRollup(USER_A, []);

    expect(rollup.total).toBe(200);
    // Storage returns children name-sorted (the adapter's list sortBy), so the
    // rollup preserves that order rather than re-deriving folders-first.
    expect(rollup.children).toEqual([
      { name: "a.txt", isFolder: false, size: 100 },
      { name: "docs", isFolder: true, size: 100 },
    ]);
  });

  it("EXCLUDES the reserved parks — the rollup is the live vault only", async () => {
    const fake = createFakeClient({
      "user-a/a.txt": FILE(50),
      [`user-a/.versions/${SNAP_A}`]: FILE(999),
      [`user-a/.trash/${SNAP_B}`]: FILE(999),
    });
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    const rollup = await adapter.folderSizeRollup(USER_A, []);

    expect(rollup.total).toBe(50);
    expect(rollup.children.map((c) => c.name)).toEqual(["a.txt"]);
  });
});

describe("VAULT_MAX_UPLOAD_BYTES", () => {
  it("is 100MB, defined ONCE here — the bucket limit and the client pre-check both cite it", () => {
    // Three copies of one number is three chances to disagree. The
    // SCHEMA-REQUEST's fileSizeLimit and Plan 04's client pre-check both
    // point at this constant rather than restating it.
    expect(VAULT_MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });
});
