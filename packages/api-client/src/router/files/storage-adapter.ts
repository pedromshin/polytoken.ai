/**
 * storage-adapter.ts — list / download / upload / mkdir / remove over an
 * INJECTED storage client (Phase 66 Plan 01, D-66-01).
 *
 * PURE BY CONSTRUCTION: this module does not import `@supabase/supabase-js`
 * (the name appears in this comment; the module never imports it — D-66-02
 * keeps that import in `service-client.ts` alone), does not read
 * `process.env`, and does not construct a client. Plan 02 injects the real
 * one; the tests inject a Map-backed fake. That is what makes every error
 * branch here cheap to assert.
 *
 * EVERY KEY REACHABLE FROM CLIENT INPUT COMES FROM `vaultKey`. If you find
 * yourself building one from an argument with template interpolation or
 * `join("/")`, that is precisely the bug this module exists to prevent
 * (T-66-02).
 *
 * THE ONE EXCEPTION, STATED RATHER THAN HIDDEN: `collectKeysUnder` builds
 * child keys as `${prefix}/${entry.name}` while walking a folder for deletion.
 * That interpolation is sound for a reason worth being explicit about — its
 * `prefix` is an already-`vaultKey`-validated key, and `entry.name` is a
 * basename returned BY STORAGE, not by a caller. It is descent through a tree
 * we already proved we are inside of, not construction from an input. The
 * tenancy test pins the consequence directly (no key handed to `remove` ever
 * leaves `{userId}/`) rather than trusting this paragraph.
 *
 * POSTURE, inherited from `apps/web/src/app/api/attachments/[id]/route.ts`:
 * ownership is asserted BEFORE any signed URL is minted (here, structurally —
 * the key is derived from the caller's own id and cannot name anyone else);
 * only `{ url }` reaches the browser; failures are loud, never fail-open.
 */

import type { VaultEntry, VaultKind, VaultStorageClient } from "./vault-types";
import {
  EMPTY_FOLDER_PLACEHOLDER,
  emptyFolderPlaceholderKey,
  VAULT_PATH_MAX_DEPTH,
  vaultKey,
} from "./vault-keys";

/**
 * The upload cap — 100MB. DEFINED ONCE, HERE.
 *
 * The bucket's own `fileSizeLimit` (SCHEMA-REQUEST.md) and Plan 04's
 * client-side pre-check both cite this constant rather than restating the
 * number: three copies of one bound are three chances to disagree, and the
 * disagreement always surfaces as a user watching a 100MB upload run to
 * completion and then get rejected by the bucket.
 */
export const VAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** One listing page. The OUT-listed cap (pagination beyond it is backlog). */
const LIST_PAGE_SIZE = 500;

/** Signed download URLs live for 60 seconds. Long enough to click, not to share. */
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Supabase `remove()` takes exact keys; batch them rather than one call per object. */
const REMOVE_BATCH_SIZE = 100;

/**
 * Transport-agnostic failure. Plan 02 maps this onto a TRPCError — this module
 * deliberately does NOT import `TRPCError`, so it stays usable from a script,
 * a job, or a test without dragging tRPC in.
 */
export class VaultStorageError extends Error {
  readonly op: string;

  constructor(op: string, message: string) {
    super(`vault storage failed during ${op}: ${message}`);
    this.name = "VaultStorageError";
    this.op = op;
  }
}

// ---------------------------------------------------------------------------
// Kind derivation — GEOMETRY, never hue
// ---------------------------------------------------------------------------

/**
 * A CLOSED literal lookup from extension to kind. Derived server-side and
 * shipped on `VaultEntry` so the surface never re-derives it — two maps of one
 * fact drift (brand-guide §3).
 *
 * `kind` becomes a GLYPH, never a colour (D-58-01 law 3, D-66-05). There is no
 * per-kind hue anywhere downstream, and adding one is the "colour-coded file
 * types" anti-generic tell.
 */
const EXTENSION_KIND: Readonly<Record<string, VaultKind>> = {
  txt: "text",
  md: "text",
  rtf: "text",
  csv: "text",
  json: "text",
  pdf: "text",
  doc: "text",
  docx: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  heic: "image",
  zip: "archive",
  gz: "archive",
  tar: "archive",
  rar: "archive",
  "7z": "archive",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
};

function kindForFile(name: string): VaultKind {
  const lastDot = name.lastIndexOf(".");
  // No extension, or a leading-dot name with no other dot ("...hidden"), is
  // just a file. Never guess from content — nothing here reads bytes.
  if (lastDot <= 0) return "file";
  const ext = name.slice(lastDot + 1).toLowerCase();
  return EXTENSION_KIND[ext] ?? "file";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type VaultAdapter = {
  listFolder(userId: string, segments: readonly string[]): Promise<VaultEntry[]>;
  signedDownloadUrl(
    userId: string,
    segments: readonly string[],
    filename: string,
  ): Promise<{ url: string }>;
  signedUploadUrl(
    userId: string,
    segments: readonly string[],
    filename: string,
  ): Promise<{ url: string; token: string; key: string }>;
  createFolder(
    userId: string,
    segments: readonly string[],
    name: string,
  ): Promise<void>;
  removeEntry(
    userId: string,
    segments: readonly string[],
    name: string,
    isFolder: boolean,
  ): Promise<void>;
};

export function createVaultAdapter(opts: {
  client: VaultStorageClient;
  bucket: string;
}): VaultAdapter {
  const { client } = opts;

  /** One page of a prefix's children. Throws rather than inventing an empty page. */
  async function listPage(prefix: string, offset: number) {
    const { data, error } = await client.list(prefix, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw new VaultStorageError("list", error.message);

    return data ?? [];
  }

  /**
   * Every leaf key under a prefix, paging each level.
   *
   * Bounded at the same depth as `VaultPathSchema`, and it tracks visited
   * prefixes: a self-referential entry (a folder whose listing reports itself)
   * would otherwise be an infinite DELETE loop — which is a materially worse
   * outcome than an infinite listing loop.
   */
  async function collectKeysUnder(
    prefix: string,
    depth: number,
    visited: Set<string>,
  ): Promise<string[]> {
    if (depth > VAULT_PATH_MAX_DEPTH) return [];
    if (visited.has(prefix)) return [];
    visited.add(prefix);

    const keys: string[] = [];
    const folders: string[] = [];

    // Page until a page comes back short. The listing cap is a UI bound; a
    // DELETE that inherited it would leave orphans the user cannot see or
    // reach — a folder that reports itself gone while still costing storage.
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await listPage(prefix, offset);
      for (const entry of page) {
        const childKey = `${prefix}/${entry.name}`;
        if (entry.id === null) folders.push(childKey);
        else keys.push(childKey);
      }
      if (page.length < LIST_PAGE_SIZE) break;
    }

    for (const folder of folders) {
      keys.push(...(await collectKeysUnder(folder, depth + 1, visited)));
    }

    return keys;
  }

  async function removeKeys(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += REMOVE_BATCH_SIZE) {
      const batch = keys.slice(i, i + REMOVE_BATCH_SIZE);
      const { error } = await client.remove([...batch]);
      if (error) throw new VaultStorageError("remove", error.message);
    }
  }

  return {
    async listFolder(userId, segments) {
      // Throws on a crafted path BEFORE any call reaches storage.
      const prefix = vaultKey(userId, segments);
      const raw = await listPage(prefix, 0);

      const entries = raw
        // The placeholder is bookkeeping (D-66-01) — never a row.
        .filter((object) => object.name !== EMPTY_FOLDER_PLACEHOLDER)
        .map((object): VaultEntry => {
          const isFolder = object.id === null;
          return {
            name: object.name,
            kind: isFolder ? "folder" : kindForFile(object.name),
            isFolder,
            size: isFolder ? null : (object.metadata?.size ?? null),
            updatedAt: isFolder ? null : object.updated_at,
            contentType: isFolder ? null : (object.metadata?.mimetype ?? null),
          };
        });

      // Folders first, then name. Decided ONCE, here, server-side: a
      // client-side re-sort is a second opinion about the same rhythm, and the
      // two disagree the moment one of them changes.
      return entries.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },

    async signedDownloadUrl(userId, segments, filename) {
      const key = vaultKey(userId, [...segments, filename]);

      // D-66-04: `download` forces ATTACHMENT disposition for EVERY content
      // type, with no allowlist and no exceptions. Without it, a `text/html`
      // or `image/svg+xml` upload becomes stored XSS the moment its signed URL
      // is opened. When inline preview eventually arrives it may relax this
      // for an allowlist that NEVER includes those two — but not from here.
      const { data, error } = await client.createSignedUrl(
        key,
        DOWNLOAD_URL_TTL_SECONDS,
        { download: filename },
      );

      if (error || !data) {
        throw new VaultStorageError("createSignedUrl", error?.message ?? "no url returned");
      }

      // ONLY the url. The attachments-route posture: nothing else reaches the
      // browser, so there is nothing else to leak.
      return { url: data.signedUrl };
    },

    async signedUploadUrl(userId, segments, filename) {
      const key = vaultKey(userId, [...segments, filename]);
      const { data, error } = await client.createSignedUploadUrl(key);

      if (error || !data) {
        throw new VaultStorageError(
          "createSignedUploadUrl",
          error?.message ?? "no url returned",
        );
      }

      return { url: data.signedUrl, token: data.token, key };
    },

    async createFolder(userId, segments, name) {
      // Folders are implicit (D-66-01): a folder exists iff it holds an
      // object, so creating one means writing the zero-byte placeholder.
      //
      // `emptyFolderPlaceholderKey` (not a hand-built path) because the
      // schema REJECTS the placeholder as a name — see its comment in
      // vault-keys.ts. The user's `name` still crosses the chokepoint; only
      // our own constant is appended afterwards.
      const key = emptyFolderPlaceholderKey(userId, [...segments, name]);

      const { error } = await client.upload(key, new Uint8Array(0), {
        contentType: "application/octet-stream",
        // upsert:false so creating a folder that already exists is an error
        // rather than a silent no-op the user reads as success.
        upsert: false,
      });

      if (error) throw new VaultStorageError("upload", error.message);
    },

    async removeEntry(userId, segments, name, isFolder) {
      const key = vaultKey(userId, [...segments, name]);

      if (!isFolder) {
        await removeKeys([key]);
        return;
      }

      // A folder delete is a WALK: Supabase's `remove` takes exact keys and
      // has no prefix/recursive form. Every key collected below is descended
      // from `key`, which `vaultKey` already proved is under `{userId}/` — so
      // the walk cannot escape the caller's own prefix. That is the property
      // the tenancy test pins.
      const keys = await collectKeysUnder(key, 0, new Set<string>());
      if (keys.length > 0) await removeKeys(keys);
    },
  };
}
