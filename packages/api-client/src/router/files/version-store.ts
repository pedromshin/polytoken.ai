/**
 * version-store.ts — the `file_versions` metadata seam for the files router
 * (DR-02).
 *
 * The vault's blobs live in Supabase Storage (storage-adapter.ts); this module
 * is the thin, INJECTABLE handle over the one DB table that indexes the parked
 * ones. It exists as a seam for the same reason `storage-adapter.ts` does: the
 * router's version/trash/usage procedures can then be tested against a ~40-line
 * in-memory fake — no Postgres, no env, no network — and the DB-shaped error
 * and ordering branches stay cheap to assert.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TENANCY, THE SAME ARGUMENT AS THE REST OF THE VAULT:
 * every method takes `userId` as its FIRST argument — always `ctx.user.id`,
 * never an input field — and every query filters `where user_id = userId`. A
 * read for a row the caller does not own returns `null` (never the row, never a
 * distinguishing error): fail-closed to NOT_FOUND, no existence oracle, exactly
 * as `vaultKey` and `toClientError` behave. The RLS policies in 0045 are
 * defense-in-depth behind this app-boundary filter.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { and, desc, eq } from "drizzle-orm";

import { FileVersions } from "@polytoken/db/schema";

import type { TRPCContext } from "../../trpc";

/** The two states a parked blob can be in. Mirrors the pgEnum in 0045. */
export type FileVersionState = "version" | "trashed";

/** The app-facing shape of one `file_versions` row. `userId` is never exposed — it is always the caller. */
export type VaultVersionRecord = {
  readonly id: string;
  readonly objectPath: string;
  readonly state: FileVersionState;
  readonly versionKey: string;
  readonly isFolder: boolean;
  readonly sizeBytes: number;
  readonly contentType: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
};

/** The fields the router supplies when parking a blob. `id` is minted by the caller (it doubles as the park-key suffix). */
export type NewVaultVersion = {
  readonly id: string;
  readonly objectPath: string;
  readonly state: FileVersionState;
  readonly versionKey: string;
  readonly isFolder: boolean;
  readonly sizeBytes: number;
  readonly contentType: string | null;
  readonly expiresAt: Date | null;
};

/**
 * The seam. Production is `createDrizzleVersionStore(ctx.db)`; tests inject a
 * Map-backed fake with this exact surface.
 */
export type VaultVersionStore = {
  insert(userId: string, record: NewVaultVersion): Promise<VaultVersionRecord>;
  /** Versions of ONE object, newest first (state = version). */
  listVersions(userId: string, objectPath: string): Promise<VaultVersionRecord[]>;
  /** The whole trash for a user, newest first (state = trashed). */
  listTrash(userId: string): Promise<VaultVersionRecord[]>;
  /** One row scoped to the owner, or null (fail-closed — no existence oracle). */
  getById(userId: string, id: string): Promise<VaultVersionRecord | null>;
  deleteById(userId: string, id: string): Promise<void>;
};

type Row = typeof FileVersions.$inferSelect;

function toRecord(row: Row): VaultVersionRecord {
  return {
    id: row.id,
    objectPath: row.objectPath,
    state: row.state,
    versionKey: row.versionKey,
    isFolder: row.isFolder,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * The production store, over a real Drizzle handle (`ctx.db`). Resolved PER
 * CALL by the router (never at module load), so importing the files router
 * never requires a live DB — the same lazy posture the storage adapter takes.
 */
export function createDrizzleVersionStore(db: TRPCContext["db"]): VaultVersionStore {
  return {
    async insert(userId, record) {
      const [row] = await db
        .insert(FileVersions)
        .values({
          id: record.id,
          userId,
          objectPath: record.objectPath,
          state: record.state,
          versionKey: record.versionKey,
          isFolder: record.isFolder,
          sizeBytes: record.sizeBytes,
          contentType: record.contentType,
          expiresAt: record.expiresAt,
        })
        .returning();
      // `.returning()` on a single-row insert cannot come back empty — a failed
      // insert throws. The guard is here so a driver quirk surfaces loudly.
      if (!row) throw new Error("file_versions insert returned no row");
      return toRecord(row);
    },

    async listVersions(userId, objectPath) {
      const rows = await db
        .select()
        .from(FileVersions)
        .where(
          and(
            eq(FileVersions.userId, userId),
            eq(FileVersions.objectPath, objectPath),
            eq(FileVersions.state, "version"),
          ),
        )
        .orderBy(desc(FileVersions.createdAt));
      return rows.map(toRecord);
    },

    async listTrash(userId) {
      const rows = await db
        .select()
        .from(FileVersions)
        .where(
          and(
            eq(FileVersions.userId, userId),
            eq(FileVersions.state, "trashed"),
          ),
        )
        .orderBy(desc(FileVersions.createdAt));
      return rows.map(toRecord);
    },

    async getById(userId, id) {
      const rows = await db
        .select()
        .from(FileVersions)
        // BOTH predicates: scoping by owner is what turns a lookup by primary
        // key into a fail-closed one — another user's id resolves to no row.
        .where(and(eq(FileVersions.id, id), eq(FileVersions.userId, userId)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async deleteById(userId, id) {
      await db
        .delete(FileVersions)
        .where(and(eq(FileVersions.id, id), eq(FileVersions.userId, userId)));
    },
  };
}
