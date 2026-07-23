/**
 * router/files/index.ts — the `files` tRPC router (Phase 66 Plan 02; DR-01/02/04).
 *
 * The /files vault's procedures. ALL of them are `protectedProcedure`, and on
 * every one of them the acting user is `ctx.user.id` — never an input field,
 * never a header, never a default.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE INPUT RULE, WHICH IS THE WHOLE TENANCY ARGUMENT:
 * no procedure input may contain a `userId`, a `key`, a `bucket`, or a
 * `prefix`. The client sends validated RELATIVE SEGMENTS (and, for DR-02
 * restore, a snapshot `id` — a server-minted UUID it received from a prior
 * list) and receives a URL or a result; it never chooses where anything lands.
 * If a future need seems to call for one of those fields, that is the signal to
 * STOP, not to add the field. Two independent gates hold this:
 * `files-tenancy.test.ts` (behavioural — zod strips unknown keys) and
 * `files-inputs.test.ts` (source-level — the one that survives a refactor).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * DR-02 ADDS A METADATA TABLE — DELIBERATELY, THROUGH THE MIGRATIONS QUEUE.
 * Phase 66 was blob-only (D-66-01): no DB table, and `files-tenancy.test.ts`
 * pinned `ctx.db = {} as never` to keep it so. Versioning + trash need to
 * remember what a PARKED blob is, so `file_versions` (migration 0045) now backs
 * this router through the injectable `VaultVersionStore` seam. The DB is
 * reached ONLY for the version/trash/usage procedures, and always scoped
 * `where user_id = ctx.user.id`, fail-closed to NOT_FOUND — same posture as the
 * storage chokepoint. `list`/`createFolder`/`requestDownload` still touch no
 * table.
 *
 * WIRING: `root.ts` is ORCHESTRATOR-RESERVED and is not touched by this lane
 * (LANE-CONTRACTS). It gains exactly one line at merge:
 *
 *     files: filesRouter,        // import { filesRouter } from "./router/files";
 *
 * Until then the surface reaches these procedures through the temporary
 * `vault-api` seam (D-66-03, `apps/web/src/app/files/_lib/vault-api.tsx`).
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { VaultAdapter } from "./storage-adapter";
import type { VaultVersionStore } from "./version-store";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { createServiceRoleVaultClient, VAULT_BUCKET } from "./service-client";
import {
  createVaultAdapter,
  VAULT_LIST_PAGE_SIZE,
  VAULT_MAX_UPLOAD_BYTES,
  VAULT_QUOTA_BYTES,
  VAULT_TRASH_RETENTION_DAYS,
  VaultStorageError,
} from "./storage-adapter";
import { createDrizzleVersionStore } from "./version-store";
import {
  VAULT_TRASH_PREFIX,
  VAULT_VERSIONS_PREFIX,
  VaultNameSchema,
  VaultPathSchema,
} from "./vault-keys";

/**
 * Turn any adapter failure into a generic client-facing error.
 *
 * The real `{ op, message }` goes to the server log; the client gets a fixed
 * string. Storage error text names KEYS and BUCKETS — echoing it to the
 * browser hands an attacker the vault's internal layout for free (T-66-07).
 *
 * Fail-closed, no existence oracle: a missing object and someone else's object
 * are indistinguishable from outside, because both produce this same error.
 */
function toClientError(err: unknown): never {
  if (err instanceof TRPCError) throw err;

  if (err instanceof VaultStorageError) {
    console.error(`[files] storage error during ${err.op}:`, err.message);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong reaching your files.",
    });
  }

  // A `vaultKey`/zod throw lands here: the input got past the procedure's own
  // schema but the chokepoint refused it. That is a BAD_REQUEST, and the fact
  // that it is reachable at all is the deliberate belt-and-braces of Plan 01's
  // re-parse — not dead code.
  console.error("[files] unexpected error:", err);
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "That request wasn't valid.",
  });
}

/**
 * `[...path, name]` as the canonical, relative, POSIX-joined object path that
 * keys a `file_versions` row. Segments and name have already crossed their zod
 * schemas at the procedure boundary, so this is a pure join.
 */
function objectPathOf(path: readonly string[], name: string): string {
  return [...path, name].join("/");
}

/**
 * Split a stored `objectPath` back into `{ path, name }`, RE-VALIDATING every
 * segment through the same schemas live input crosses. A row is data we wrote,
 * but "we wrote it" is not "it is safe to feed back into a key" — a restore
 * that trusted the string would be the one hole the whole chokepoint exists to
 * close. Throws (→ BAD_REQUEST) on anything that does not re-parse.
 */
function segmentsOf(objectPath: string): { path: string[]; name: string } {
  const parts = objectPath.split("/");
  const name = VaultNameSchema.parse(parts.pop());
  const path = VaultPathSchema.parse(parts);
  return { path, name };
}

/**
 * @param opts.adapter - injected by the tests. Production passes nothing and
 * gets the service-role adapter, resolved LAZILY (see below).
 * @param opts.versionStore - injected by the tests. Production resolves the
 * Drizzle-backed store per call from `ctx.db`, so importing this router never
 * requires a live DB.
 */
export function createFilesRouter(opts?: {
  adapter?: VaultAdapter;
  versionStore?: VaultVersionStore;
}) {
  /**
   * Resolved per call, not at module load. Importing this router must never
   * require secrets — otherwise the whole package's test run and the build
   * both fail at import time, for reasons that look nothing like the cause.
   */
  const adapter = (): VaultAdapter =>
    opts?.adapter ??
    createVaultAdapter({
      client: createServiceRoleVaultClient(),
      bucket: VAULT_BUCKET,
    });

  /** Same lazy posture for the DB seam — resolved from ctx.db per call. */
  const versionStore = (db: Parameters<typeof createDrizzleVersionStore>[0]): VaultVersionStore =>
    opts?.versionStore ?? createDrizzleVersionStore(db);

  return createTRPCRouter({
    /**
     * One PAGE of a folder's contents. `path` defaults to the vault root.
     *
     * `cursor` is the field tRPC's `useInfiniteQuery` echoes back — it MUST
     * accept null (tRPC's initialCursor default) and it is bounded: an offset
     * is not a key or a prefix (the input rule above stands untouched), but an
     * unbounded one is still a free amplifier against storage. 2000 pages of
     * 500 is deeper than any honest vault.
     */
    list: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          cursor: z
            .number()
            .int()
            .min(0)
            .max(VAULT_LIST_PAGE_SIZE * 2000)
            .nullish(),
        }),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await adapter().listFolder(ctx.user.id, input.path, input.cursor ?? 0);
        } catch (err) {
          return toClientError(err);
        }
      }),

    createFolder: protectedProcedure
      .input(z.object({ path: VaultPathSchema, name: VaultNameSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          await adapter().createFolder(ctx.user.id, input.path, input.name);
          return { ok: true as const };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * Mint a signed upload URL. The browser PUTs to it directly.
     *
     * TWO things happen here that the raw PUT cannot (DR-02/DR-04), both
     * BEFORE the URL is handed out:
     *   (1) QUOTA SOFT-BLOCK (DR-04): the live-vault total plus this upload is
     *       checked against `VAULT_QUOTA_BYTES`. Over quota → FORBIDDEN, and
     *       no URL is minted, so the transfer never starts.
     *   (2) VERSIONING-ON-OVERWRITE (DR-02): if an object already lives at the
     *       target, its current blob is snapshotted into `.versions/` and a
     *       `file_versions` row recorded — THEN the URL is minted, and the raw
     *       PUT overwrites the live key. The snapshot is the pre-overwrite copy.
     *
     * `size.max()` is T-66-05's server-side half — the client's pre-check
     * (Plan 04) is a courtesy. The bucket's own `fileSizeLimit` is the third
     * layer. All three cite `VAULT_MAX_UPLOAD_BYTES`; none restates the number.
     */
    requestUpload: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          name: VaultNameSchema,
          size: z.number().int().positive().max(VAULT_MAX_UPLOAD_BYTES),
          // Stored by storage; NEVER trusted for a rendering decision
          // (D-66-04). Bounded so it cannot be used as a payload smuggler.
          contentType: z.string().max(255).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const a = adapter();

          // (1) Quota soft-block — the live-vault rollup is also DR-04's meter
          // and TM-04's substrate (folderSizeRollup), so there is one aggregate
          // of one truth.
          const { total: usedBytes } = await a.folderSizeRollup(ctx.user.id, []);
          if (usedBytes + input.size > VAULT_QUOTA_BYTES) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "That upload would put you over your storage limit.",
            });
          }

          // (2) Versioning-on-overwrite — only when something is actually there
          // to supersede. A first-time upload snapshots nothing.
          const existing = await a.statEntry(ctx.user.id, input.path, input.name);
          if (existing) {
            const id = randomUUID();
            const snapshot = await a.snapshotVersion(
              ctx.user.id,
              input.path,
              input.name,
              id,
            );
            await versionStore(ctx.db).insert(ctx.user.id, {
              id,
              objectPath: objectPathOf(input.path, input.name),
              state: "version",
              versionKey: `${VAULT_VERSIONS_PREFIX}/${id}`,
              isFolder: false,
              sizeBytes: snapshot.sizeBytes,
              contentType: snapshot.contentType,
              expiresAt: null,
            });
          }

          return await a.signedUploadUrl(ctx.user.id, input.path, input.name);
        } catch (err) {
          return toClientError(err);
        }
      }),

    /** `{ url }` and nothing else, ever (T-66-07). */
    requestDownload: protectedProcedure
      .input(z.object({ path: VaultPathSchema, name: VaultNameSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await adapter().signedDownloadUrl(ctx.user.id, input.path, input.name);
        } catch (err) {
          return toClientError(err);
        }
      }),

    // ── DR-01: rename + move ──────────────────────────────────────────────

    /**
     * Rename an entry in place (DR-01). A rename is a move within the same
     * folder, so it delegates to the one adapter verb. `newName` crosses the
     * name schema; a crafted one throws before storage is touched.
     */
    rename: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          name: VaultNameSchema,
          newName: VaultNameSchema,
          isFolder: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await adapter().moveEntry(
            ctx.user.id,
            input.path,
            input.name,
            input.path,
            input.newName,
            input.isFolder,
          );
          return { ok: true as const };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * Move an entry into another folder (DR-01), keeping its name. `toPath` is
     * a validated relative path — never a key.
     */
    move: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          name: VaultNameSchema,
          toPath: VaultPathSchema,
          isFolder: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.isFolder) {
          // Reject moving a folder into itself or a descendant — the subtree
          // walk collects source keys up front so it wouldn't loop, but the
          // result is a folder nested inside itself, which is nonsense (most
          // filesystems refuse it). Source folder's own path:
          const ownPath = [...input.path, input.name];
          const intoSelfOrChild =
            input.toPath.length >= ownPath.length &&
            ownPath.every((seg, i) => input.toPath[i] === seg);
          if (intoSelfOrChild) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot move a folder into itself or one of its own subfolders.",
            });
          }
        }
        try {
          await adapter().moveEntry(
            ctx.user.id,
            input.path,
            input.name,
            input.toPath,
            input.name,
            input.isFolder,
          );
          return { ok: true as const };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * Move MANY entries from one folder into another in one call (DR-01 bulk).
     * Each entry re-crosses the schemas; the loop is sequential so a mid-batch
     * storage failure surfaces rather than being swallowed behind a partial
     * success the user cannot see.
     */
    bulkMove: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          toPath: VaultPathSchema,
          entries: z
            .array(z.object({ name: VaultNameSchema, isFolder: z.boolean() }))
            .min(1)
            .max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const a = adapter();
          for (const entry of input.entries) {
            await a.moveEntry(
              ctx.user.id,
              input.path,
              entry.name,
              input.toPath,
              entry.name,
              entry.isFolder,
            );
          }
          return { ok: true as const, moved: input.entries.length };
        } catch (err) {
          return toClientError(err);
        }
      }),

    // ── DR-02: soft-delete → trash, versions, restore ─────────────────────

    /**
     * SOFT-DELETE to trash (DR-02) — the former hard `remove`.
     *
     * Instead of erasing the blob, it is relocated into `{userId}/.trash/<id>`
     * and a `file_versions` row (state=trashed) is written with a retention
     * expiry. "Deleted" is now reversible: `restoreFromTrash` moves it back.
     * The blob and the row are removed for real only by a retention sweep past
     * `expiresAt` (a seam, not built here).
     */
    remove: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          name: VaultNameSchema,
          isFolder: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const id = randomUUID();
          const parked = await adapter().trashEntry(
            ctx.user.id,
            input.path,
            input.name,
            input.isFolder,
            id,
          );
          const expiresAt = new Date(
            Date.now() + VAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          );
          await versionStore(ctx.db).insert(ctx.user.id, {
            id,
            objectPath: objectPathOf(input.path, input.name),
            state: "trashed",
            versionKey: `${VAULT_TRASH_PREFIX}/${id}`,
            isFolder: input.isFolder,
            sizeBytes: parked.sizeBytes,
            contentType: parked.contentType,
            expiresAt,
          });
          return { ok: true as const, id };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * Bulk soft-delete (DR-01 bulk delete over the DR-02 soft-delete path).
     * Each entry trashes independently; sequential for the same fail-loud
     * reason as `bulkMove`.
     */
    bulkRemove: protectedProcedure
      .input(
        z.object({
          path: VaultPathSchema,
          entries: z
            .array(z.object({ name: VaultNameSchema, isFolder: z.boolean() }))
            .min(1)
            .max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const a = adapter();
          const store = versionStore(ctx.db);
          const expiresAt = new Date(
            Date.now() + VAULT_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          );
          for (const entry of input.entries) {
            const id = randomUUID();
            const parked = await a.trashEntry(
              ctx.user.id,
              input.path,
              entry.name,
              entry.isFolder,
              id,
            );
            await store.insert(ctx.user.id, {
              id,
              objectPath: objectPathOf(input.path, entry.name),
              state: "trashed",
              versionKey: `${VAULT_TRASH_PREFIX}/${id}`,
              isFolder: entry.isFolder,
              sizeBytes: parked.sizeBytes,
              contentType: parked.contentType,
              expiresAt,
            });
          }
          return { ok: true as const, removed: input.entries.length };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * The version history of one object, newest first (DR-02). Returns only
     * client-safe fields — the internal park key never crosses the wire.
     */
    listVersions: protectedProcedure
      .input(z.object({ path: VaultPathSchema, name: VaultNameSchema }))
      .query(async ({ ctx, input }) => {
        try {
          const rows = await versionStore(ctx.db).listVersions(
            ctx.user.id,
            objectPathOf(input.path, input.name),
          );
          return rows.map((r) => ({
            id: r.id,
            sizeBytes: r.sizeBytes,
            contentType: r.contentType,
            createdAt: r.createdAt,
          }));
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * Restore a prior version back over the live object (DR-02). The current
     * content is snapshotted to a FRESH version first, so the restore is itself
     * undoable — nothing is lost, it is only re-ordered in the history.
     */
    restoreVersion: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const a = adapter();
          const store = versionStore(ctx.db);

          const row = await store.getById(ctx.user.id, input.id);
          // Fail-closed: not yours, gone, or not a version → the same NOT_FOUND.
          if (!row || row.state !== "version") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Version not found." });
          }

          const { path, name } = segmentsOf(row.objectPath);

          // Snapshot the CURRENT live content (if any) before it is overwritten,
          // so restore is non-destructive.
          const current = await a.statEntry(ctx.user.id, path, name);
          if (current) {
            const supersededId = randomUUID();
            const snapshot = await a.snapshotVersion(ctx.user.id, path, name, supersededId);
            await store.insert(ctx.user.id, {
              id: supersededId,
              objectPath: row.objectPath,
              state: "version",
              versionKey: `${VAULT_VERSIONS_PREFIX}/${supersededId}`,
              isFolder: false,
              sizeBytes: snapshot.sizeBytes,
              contentType: snapshot.contentType,
              expiresAt: null,
            });
          }

          await a.restoreVersion(ctx.user.id, path, name, input.id);
          return { ok: true as const };
        } catch (err) {
          return toClientError(err);
        }
      }),

    /** Everything in the caller's trash, newest first (DR-02). */
    listTrash: protectedProcedure.query(async ({ ctx }) => {
      try {
        const rows = await versionStore(ctx.db).listTrash(ctx.user.id);
        return rows.map((r) => {
          const { name } = segmentsOf(r.objectPath);
          return {
            id: r.id,
            objectPath: r.objectPath,
            name,
            isFolder: r.isFolder,
            sizeBytes: r.sizeBytes,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
          };
        });
      } catch (err) {
        return toClientError(err);
      }
    }),

    /**
     * Restore a trashed entry to its original path (DR-02). The `file_versions`
     * row is deleted only AFTER the blob is back, so a mid-restore failure
     * leaves the trash record intact and the item still recoverable.
     */
    restoreFromTrash: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const store = versionStore(ctx.db);
          const row = await store.getById(ctx.user.id, input.id);
          if (!row || row.state !== "trashed") {
            throw new TRPCError({ code: "NOT_FOUND", message: "Trashed item not found." });
          }

          const { path, name } = segmentsOf(row.objectPath);
          await adapter().restoreFromTrash(ctx.user.id, path, name, row.isFolder, input.id);
          await store.deleteById(ctx.user.id, input.id);
          return { ok: true as const };
        } catch (err) {
          return toClientError(err);
        }
      }),

    // ── DR-04: usage + size rollups ───────────────────────────────────────

    /**
     * Per-folder byte rollup (DR-04). The SAME aggregate the deferred TM-04
     * drive treemap consumes — immediate children with their (subtree) sizes,
     * plus the folder's recursive total. Reserved parks are excluded, so this
     * is strictly the live vault.
     */
    folderSizeRollup: protectedProcedure
      .input(z.object({ path: VaultPathSchema }))
      .query(async ({ ctx, input }) => {
        try {
          return await adapter().folderSizeRollup(ctx.user.id, input.path);
        } catch (err) {
          return toClientError(err);
        }
      }),

    /**
     * The /files header meter (DR-04): live bytes used against the quota. Built
     * on the same `folderSizeRollup` total as the soft-block, so the number the
     * meter shows and the number the block enforces can never disagree.
     */
    usageSummary: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { total } = await adapter().folderSizeRollup(ctx.user.id, []);
        return {
          usedBytes: total,
          quotaBytes: VAULT_QUOTA_BYTES,
          availableBytes: Math.max(0, VAULT_QUOTA_BYTES - total),
        };
      } catch (err) {
        return toClientError(err);
      }
    }),
  });
}

/** What the orchestrator's one-line `root.ts` wiring imports. */
export const filesRouter = createFilesRouter();
