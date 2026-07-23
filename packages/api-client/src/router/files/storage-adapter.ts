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

import type {
  VaultEntry,
  VaultKind,
  VaultListPage,
  VaultStorageClient,
} from "./vault-types";
import {
  EMPTY_FOLDER_PLACEHOLDER,
  emptyFolderPlaceholderKey,
  RESERVED_SEGMENTS,
  trashSnapshotKey,
  VAULT_PATH_MAX_DEPTH,
  vaultKey,
  versionSnapshotKey,
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

/**
 * The per-user LIVE-vault storage quota — 5GB. DEFINED ONCE, HERE (DR-04).
 *
 * `requestUpload`'s soft-block and the `/files` header meter both cite this
 * constant rather than restating the number, the same discipline
 * `VAULT_MAX_UPLOAD_BYTES` keeps. It counts LIVE bytes only: versions and
 * trashed blobs are retention grace, not billed against the user, so a
 * soft-delete immediately frees quota and the meter reflects it. If parked
 * bytes ever need to count, THAT is the trigger to sum them in — not before.
 */
export const VAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * How long a soft-deleted entry sits in `.trash` before a retention sweep may
 * hard-delete it (DR-02). The sweep itself is a seam, not built here; this
 * constant is what stamps each `file_versions` row's `expires_at`.
 */
export const VAULT_TRASH_RETENTION_DAYS = 30;

/**
 * One listing page. Was the OUT-listed hard cap in Phase 66; the v2.1
 * hardening pass turned it into a PAGE SIZE — `listFolder` takes an offset and
 * reports whether another page exists, so a >500-entry folder is reachable
 * rather than silently truncated. Exported so the router's cursor bound and
 * any test that manufactures a full page cite the same number.
 */
export const VAULT_LIST_PAGE_SIZE = 500;

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
  /**
   * One PAGE of a folder, starting at `offset` (default 0 — the first page).
   * `nextCursor` names the next offset, or null when this page is the last.
   */
  listFolder(
    userId: string,
    segments: readonly string[],
    offset?: number,
  ): Promise<VaultListPage>;
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

  /**
   * Size + type of ONE live file, or `null` if it is not there (DR-02/DR-04).
   * Fail-quiet on absence — a missing object and someone else's object are
   * indistinguishable, same posture as everywhere else in this module.
   */
  statEntry(
    userId: string,
    segments: readonly string[],
    name: string,
  ): Promise<{ size: number; contentType: string | null } | null>;

  /**
   * Rename OR move a live entry (DR-01) — one verb, because a rename is a move
   * within the same folder. A file is one atomic `move`; a folder is a walk
   * that relocates its whole subtree.
   */
  moveEntry(
    userId: string,
    fromSegments: readonly string[],
    name: string,
    toSegments: readonly string[],
    toName: string,
    isFolder: boolean,
  ): Promise<void>;

  /**
   * Soft-delete: relocate a live entry into `{userId}/.trash/<snapshotId>`
   * (DR-02). Returns the byte count parked, for the `file_versions` row.
   */
  trashEntry(
    userId: string,
    segments: readonly string[],
    name: string,
    isFolder: boolean,
    snapshotId: string,
  ): Promise<{ sizeBytes: number; contentType: string | null }>;

  /** Restore a trashed entry from its park back to a live location (DR-02). */
  restoreFromTrash(
    userId: string,
    toSegments: readonly string[],
    name: string,
    isFolder: boolean,
    snapshotId: string,
  ): Promise<void>;

  /**
   * COPY a live file into `{userId}/.versions/<snapshotId>` (DR-02) — the
   * source survives, because this snapshots the ABOUT-TO-BE-OVERWRITTEN
   * content before an overwrite lands. Returns the bytes/type snapshotted.
   */
  snapshotVersion(
    userId: string,
    segments: readonly string[],
    name: string,
    snapshotId: string,
  ): Promise<{ sizeBytes: number; contentType: string | null }>;

  /**
   * Restore a prior version's blob back over the live key (DR-02). The live
   * key is removed first (copy cannot overwrite), so the caller MUST snapshot
   * the current content to a fresh version BEFORE calling this, or it is lost.
   */
  restoreVersion(
    userId: string,
    toSegments: readonly string[],
    name: string,
    snapshotId: string,
  ): Promise<void>;

  /**
   * Per-folder byte rollup (DR-04, and the substrate TM-04's drive treemap
   * consumes). Immediate children with their sizes (a folder child's size is
   * its whole subtree), plus the folder's own recursive total. Reserved parks
   * (`.versions` / `.trash`) are EXCLUDED — this is the live-vault view.
   */
  folderSizeRollup(
    userId: string,
    segments: readonly string[],
  ): Promise<{
    total: number;
    children: readonly { name: string; isFolder: boolean; size: number }[];
  }>;
};

export function createVaultAdapter(opts: {
  client: VaultStorageClient;
  bucket: string;
}): VaultAdapter {
  const { client } = opts;

  /** One page of a prefix's children. Throws rather than inventing an empty page. */
  async function listPage(prefix: string, offset: number) {
    const { data, error } = await client.list(prefix, {
      limit: VAULT_LIST_PAGE_SIZE,
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
    for (let offset = 0; ; offset += VAULT_LIST_PAGE_SIZE) {
      const page = await listPage(prefix, offset);
      for (const entry of page) {
        const childKey = `${prefix}/${entry.name}`;
        if (entry.id === null) folders.push(childKey);
        else keys.push(childKey);
      }
      if (page.length < VAULT_LIST_PAGE_SIZE) break;
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

  /** One atomic object move. Both keys are already `vaultKey`-derived. */
  async function moveOne(fromKey: string, toKey: string): Promise<void> {
    const { error } = await client.move(fromKey, toKey);
    if (error) throw new VaultStorageError("move", error.message);
  }

  /** One object copy — the source survives. Both keys are `vaultKey`-derived. */
  async function copyOne(fromKey: string, toKey: string): Promise<void> {
    const { error } = await client.copy(fromKey, toKey);
    if (error) throw new VaultStorageError("copy", error.message);
  }

  /**
   * Relocate a whole subtree from one already-validated prefix to another,
   * preserving relative structure. Same tenancy property as `collectKeysUnder`:
   * every key it walks is descended from `fromPrefix` (a `vaultKey` result), so
   * the walk cannot escape the caller's own `{userId}/`; the destination is
   * likewise a `vaultKey`/park key under the same user.
   */
  async function relocateSubtree(fromPrefix: string, toPrefix: string): Promise<void> {
    const keys = await collectKeysUnder(fromPrefix, 0, new Set<string>());
    for (const key of keys) {
      // `rest` begins with "/" — descent through a tree we already proved we
      // are inside of, not construction from an input (the module header's
      // stated exception).
      const rest = key.slice(fromPrefix.length);
      await moveOne(key, `${toPrefix}${rest}`);
    }
  }

  /** Sum every leaf's bytes under a prefix, paging and depth-bounded. */
  async function sumSizeUnder(
    prefix: string,
    depth: number,
    visited: Set<string>,
  ): Promise<number> {
    if (depth > VAULT_PATH_MAX_DEPTH) return 0;
    if (visited.has(prefix)) return 0;
    visited.add(prefix);

    let sum = 0;
    const folders: string[] = [];

    for (let offset = 0; ; offset += VAULT_LIST_PAGE_SIZE) {
      const page = await listPage(prefix, offset);
      for (const entry of page) {
        if (entry.name === EMPTY_FOLDER_PLACEHOLDER) continue;
        if (entry.id === null) folders.push(`${prefix}/${entry.name}`);
        else sum += entry.metadata?.size ?? 0;
      }
      if (page.length < VAULT_LIST_PAGE_SIZE) break;
    }

    for (const folder of folders) {
      sum += await sumSizeUnder(folder, depth + 1, visited);
    }

    return sum;
  }

  /** Find one immediate child file by name under a parent prefix, or null. */
  async function findChildFile(
    prefix: string,
    name: string,
  ): Promise<{ size: number; contentType: string | null } | null> {
    for (let offset = 0; ; offset += VAULT_LIST_PAGE_SIZE) {
      const page = await listPage(prefix, offset);
      for (const entry of page) {
        // `id === null` is a folder — `statEntry` is about files only.
        if (entry.name === name && entry.id !== null) {
          return {
            size: entry.metadata?.size ?? 0,
            contentType: entry.metadata?.mimetype ?? null,
          };
        }
      }
      if (page.length < VAULT_LIST_PAGE_SIZE) break;
    }
    return null;
  }

  return {
    async listFolder(userId, segments, offset = 0) {
      // Throws on a crafted path BEFORE any call reaches storage.
      const prefix = vaultKey(userId, segments);
      const raw = await listPage(prefix, offset);

      // A FULL page means storage may hold more; a short page is the end.
      // Decided on the RAW length, before the placeholder filter below — the
      // filter can shrink a full page, and a shrunk-but-full page must still
      // report a next cursor or the entries past it become unreachable again.
      const nextCursor =
        raw.length === VAULT_LIST_PAGE_SIZE ? offset + VAULT_LIST_PAGE_SIZE : null;

      const entries = raw
        // The placeholder is bookkeeping (D-66-01) — never a row. The DR-02
        // `.versions` / `.trash` parks are the same kind of bookkeeping (they
        // only ever appear at the user root); `RESERVED_SEGMENTS` is the one
        // set both this filter and the name schema read, so the park a user
        // cannot NAME is also a park they never SEE.
        .filter((object) => !RESERVED_SEGMENTS.has(object.name))
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
      //
      // WITH PAGINATION THIS RHYTHM IS PER-PAGE, and that is stated rather
      // than hidden: storage sorts the whole folder by name, so page 2's
      // folders sit after page 1's files. Exact within the first 500 entries
      // (every realistic folder); honest name-order beyond. Re-sorting
      // accumulated pages client-side would reorder rows under the user's
      // cursor on every "Show more" — the worse trade.
      entries.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { entries, nextCursor };
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

    async statEntry(userId, segments, name) {
      const prefix = vaultKey(userId, segments);
      // Re-validate `name` by building (and discarding) its full key — a
      // crafted name throws here BEFORE any listing, same as everywhere else.
      vaultKey(userId, [...segments, name]);
      return findChildFile(prefix, name);
    },

    async moveEntry(userId, fromSegments, name, toSegments, toName, isFolder) {
      const fromKey = vaultKey(userId, [...fromSegments, name]);
      const toKey = vaultKey(userId, [...toSegments, toName]);
      // A move to the identical key is a no-op, not an error — the surface can
      // fire a rename that did not change the name without a spurious failure.
      if (fromKey === toKey) return;
      if (!isFolder) {
        await moveOne(fromKey, toKey);
        return;
      }
      await relocateSubtree(fromKey, toKey);
    },

    async trashEntry(userId, segments, name, isFolder, snapshotId) {
      const fromKey = vaultKey(userId, [...segments, name]);
      const trashKey = trashSnapshotKey(userId, snapshotId);

      if (!isFolder) {
        const stat = await findChildFile(fromKey.slice(0, fromKey.lastIndexOf("/")), name);
        await moveOne(fromKey, trashKey);
        return {
          sizeBytes: stat?.size ?? 0,
          contentType: stat?.contentType ?? null,
        };
      }

      const sizeBytes = await sumSizeUnder(fromKey, 0, new Set<string>());
      await relocateSubtree(fromKey, trashKey);
      return { sizeBytes, contentType: null };
    },

    async restoreFromTrash(userId, toSegments, name, isFolder, snapshotId) {
      const trashKey = trashSnapshotKey(userId, snapshotId);
      const toKey = vaultKey(userId, [...toSegments, name]);
      if (!isFolder) {
        await moveOne(trashKey, toKey);
        return;
      }
      await relocateSubtree(trashKey, toKey);
    },

    async snapshotVersion(userId, segments, name, snapshotId) {
      const fromKey = vaultKey(userId, [...segments, name]);
      const versionKey = versionSnapshotKey(userId, snapshotId);
      const stat = await findChildFile(fromKey.slice(0, fromKey.lastIndexOf("/")), name);
      await copyOne(fromKey, versionKey);
      return {
        sizeBytes: stat?.size ?? 0,
        contentType: stat?.contentType ?? null,
      };
    },

    async restoreVersion(userId, toSegments, name, snapshotId) {
      const versionKey = versionSnapshotKey(userId, snapshotId);
      const toKey = vaultKey(userId, [...toSegments, name]);
      // Copy cannot overwrite; the live blob is removed first. The caller
      // snapshots the current content to a fresh version BEFORE this, so the
      // removal is non-destructive.
      await removeKeys([toKey]);
      await copyOne(versionKey, toKey);
    },

    async folderSizeRollup(userId, segments) {
      const prefix = vaultKey(userId, segments);
      const children: { name: string; isFolder: boolean; size: number }[] = [];
      let total = 0;

      for (let offset = 0; ; offset += VAULT_LIST_PAGE_SIZE) {
        const page = await listPage(prefix, offset);
        for (const entry of page) {
          if (entry.name === EMPTY_FOLDER_PLACEHOLDER) continue;
          // Reserved parks only surface at the root; excluded so the rollup is
          // the LIVE-vault view TM-04 draws and DR-04 meters.
          if (RESERVED_SEGMENTS.has(entry.name)) continue;

          if (entry.id === null) {
            const size = await sumSizeUnder(
              `${prefix}/${entry.name}`,
              0,
              new Set<string>(),
            );
            children.push({ name: entry.name, isFolder: true, size });
            total += size;
          } else {
            const size = entry.metadata?.size ?? 0;
            children.push({ name: entry.name, isFolder: false, size });
            total += size;
          }
        }
        if (page.length < VAULT_LIST_PAGE_SIZE) break;
      }

      return { total, children };
    },
  };
}
