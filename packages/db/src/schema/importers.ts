/**
 * Phase 4 — Email Intelligence: importers table (tenant / multi-tenant boundary).
 *
 * Every domain table carries importer_id FK → importers.id (D-05).
 * importer_id = null on system defaults (entity_types seed rows) only.
 *
 * Phase 44 (tenancy): importers is the tenant ANCHOR for user-level scoping —
 * user_id references auth.users(id) directly here; the 7 hard-FK importer_id
 * descendant tables get zero migration (scoped via ONE join through importers).
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// importers — one row per customer / forwarding sender
// ---------------------------------------------------------------------------
export const Importers = pgTable(
  "importers",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),

    // Importer-level rule hints (per-importer LLM prompt cache configuration)
    config: jsonb("config").notNull().default({}),

    // Phase 44 (tenancy): the ownership anchor. Nullable during the expand
    // migration step; contracted to NOT NULL once backfill completes.
    userId: uuid("user_id").references(() => AuthUsers.id, {
      onDelete: "cascade",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    importersUserIdIdx: index("idx_importers_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ImporterRow = typeof Importers.$inferSelect;
export type InsertImporter = typeof Importers.$inferInsert;
