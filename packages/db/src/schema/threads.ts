/**
 * Phase 45 — Email Threads: threads table (THRD-01).
 *
 * A real threads table (over an emails.thread_id-only design, per the
 * 45-CONTEXT decision) grouping related emails. Threads are
 * importer-anchored, matching emails — tenant scope resolves via ONE join
 * through importers.user_id (TENA-01 guardrail: all NEW tables tenant-scoped).
 *
 * subject is the derived/normalized thread subject (Re:/Fwd:-stripped),
 * nullable until the resolver assigns one. Grouping itself (Union-Find over
 * Message-ID/In-Reply-To/References headers + forwarded-mail fallback tiers)
 * is implemented by a later plan's ThreadResolver domain port — this table
 * is the persistence target only.
 */

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { Importers } from "./importers";

// ---------------------------------------------------------------------------
// threads — one row per resolved email thread
// ---------------------------------------------------------------------------
export const Threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    importerId: uuid("importer_id")
      .notNull()
      .references(() => Importers.id, { onDelete: "cascade" }),

    // Derived/normalized thread subject (Re:/Fwd:-stripped). Nullable until
    // the resolver assigns one.
    subject: text("subject"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    threadsImporterIdIdx: index("idx_threads_importer_id").on(t.importerId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ThreadRow = typeof Threads.$inferSelect;
export type InsertThread = typeof Threads.$inferInsert;
