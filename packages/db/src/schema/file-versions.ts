/**
 * FEATURE-CATALOG DR-02 — File versioning + trash: the `file_versions` table.
 *
 * The /files vault is BLOB-ONLY (D-66-01): a folder exists iff it holds an
 * object, and there is NO metadata table for live objects — everything the
 * surface shows is derived from a Supabase Storage listing. That design is why
 * versioning and trash need this table: a blob that is no longer LIVE (it was
 * overwritten, or soft-deleted) is parked under a reserved prefix
 * (`{userId}/.versions/<id>` or `{userId}/.trash/<id>`, see vault-keys.ts), and
 * this row is the ONLY record of what that parked blob is, which object it
 * belongs to, and where it came from. The park is flat; this table is its index.
 *
 * ## One table, two states — and why not two tables
 *
 * A version and a trashed object are the same physical thing — a parked copy of
 * a blob keyed on a logical vault path — differing only in WHY they were parked
 * and what "restore" means. `state` discriminates them:
 *   - `version` — a prior copy snapshotted just before an overwrite. Restore
 *     copies it back over the live key (DR-02 "restore version").
 *   - `trashed` — a soft-deleted object/subtree awaiting restore or retention
 *     expiry. Restore moves it back to its original path ("restore from trash").
 * Splitting these into two tables would duplicate the ownership anchor, the
 * park-key column, and the size rollup for zero consumer benefit — the read
 * paths already filter on `state`.
 *
 * ## `objectPath` is the vault-object key (DR-02 "keyed on vault object")
 *
 * The logical path of the object this snapshot belongs to, RELATIVE to the user
 * root, POSIX-joined (e.g. `docs/report.pdf`). Versioning-on-overwrite and
 * restore both resolve segments back out of this string through the same
 * `VaultPathSchema` the router validates live input with — a stored path is
 * re-validated, never trusted, exactly as `vaultKey` re-parses its segments.
 *
 * ## Tenancy (INV-8/INV-9)
 *
 * Like documents / spreadsheets, this carries a DIRECT `user_id` referencing
 * auth.users(id), scoped directly (no importer join). Every router procedure
 * filters `where user_id = ctx.user.id` and fails closed to NOT_FOUND; the
 * owner-scoping RLS policies (RESTRICTIVE deny-anon + PERMISSIVE
 * owner-authenticated) ship in the SAME migration (0045), mirroring
 * documents in 0040_documents.sql.
 */

import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// file_version_state — a parked blob is either a prior version or trash (DR-02)
// ---------------------------------------------------------------------------
export const fileVersionStateEnum = pgEnum("file_version_state", [
  "version",
  "trashed",
]);

// ---------------------------------------------------------------------------
// file_versions — owner-scoped index of parked vault blobs (DR-02)
// ---------------------------------------------------------------------------
export const FileVersions = pgTable(
  "file_versions",
  {
    // The id is ALSO the snapshot key suffix minted server-side
    // (`.versions/<id>` / `.trash/<id>`), so one v4 UUID names both the row and
    // the parked blob — no second identifier to keep in sync.
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (INV-8/9) — mirrors documents / spreadsheets.
    // Cascade so a deleted user's parked blobs' records go with them.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // The logical vault path (relative to the user root) of the object this
    // snapshot belongs to — the "keyed on the vault object" anchor.
    objectPath: text("object_path").notNull(),

    // version | trashed — see the enum above.
    state: fileVersionStateEnum("state").notNull(),

    // The reserved-park storage suffix where this snapshot's blob lives,
    // relative to the user root (e.g. `.versions/<id>` or `.trash/<id>`). The
    // key-suffix scheme, recorded rather than re-derived.
    versionKey: text("version_key").notNull(),

    // Whether the parked thing was a folder subtree (trash only) — restore has
    // to know whether to move one blob or a whole subtree.
    isFolder: boolean("is_folder").notNull().default(false),

    // Bytes parked, for the usage rollup / display. bigint(number) because a
    // vault object can exceed 2^31 bytes.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),

    contentType: text("content_type"),

    // When the snapshot was made (overwrite time / delete time).
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Retention expiry for trashed rows (null for versions). A sweep past this
    // instant may hard-delete the parked blob + row; nullable because a version
    // is kept until it is superseded out, not on a clock.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    // Ownership lookups + the per-user usage rollup.
    fileVersionsUserIdIdx: index("idx_file_versions_user_id").on(t.userId),
    // "versions of THIS object" — the restore-version list.
    fileVersionsUserObjectIdx: index("idx_file_versions_user_object").on(
      t.userId,
      t.objectPath,
    ),
    // "everything in this user's trash" — the trash list.
    fileVersionsUserStateIdx: index("idx_file_versions_user_state").on(
      t.userId,
      t.state,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type FileVersionRow = typeof FileVersions.$inferSelect;
export type InsertFileVersion = typeof FileVersions.$inferInsert;
