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

    const entries = await adapter.listFolder(USER_A, []);

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

    const entries = await adapter.listFolder(USER_A, ["empty"]);

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

    const entries = await adapter.listFolder(USER_A, []);

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

    const entries = await adapter.listFolder(USER_A, []);

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

  it("returns [] for a genuinely empty folder", async () => {
    const fake = createFakeClient({});
    const adapter = createVaultAdapter({ client: fake.client, bucket: BUCKET });

    await expect(adapter.listFolder(USER_A, [])).resolves.toEqual([]);
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

describe("VAULT_MAX_UPLOAD_BYTES", () => {
  it("is 100MB, defined ONCE here — the bucket limit and the client pre-check both cite it", () => {
    // Three copies of one number is three chances to disagree. The
    // SCHEMA-REQUEST's fileSizeLimit and Plan 04's client pre-check both
    // point at this constant rather than restating it.
    expect(VAULT_MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });
});
