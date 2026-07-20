/**
 * 999.35 — References: the `references` table (saving references INSIDE
 * polytoken — the first real dogfood of D4+D2).
 *
 * A reference is a source-ledger-SHAPED record (url, title, note, tags,
 * saved_at, owner) but deliberately NOT a `chat_source_ledger` row: that table
 * anchors tenancy through a NOT NULL `conversation_id` FK (ON DELETE CASCADE
 * into chat_conversations) and its dedupe identity is
 * (conversation_id, tool_use_id, result_index) — a per-conversation candidate
 * pool populated by the tool-round loop. A user-saved reference has NO
 * conversation, NO tool round, and must outlive any chat. Reusing the ledger
 * would have required nulling its ownership anchor and inventing fake tool
 * identifiers, so references gets its own table (decision recorded here per
 * the 999.35 storage question).
 *
 * ## Tenancy
 *
 * `references` is NOT an importer-descendant — like documents /
 * chat_conversations / forwarding_addresses it carries a DIRECT `user_id`
 * referencing auth.users(id), scoped directly (no join). Ownership resolves
 * through the central helper `assertReferenceOwnership` (ownership.ts) —
 * never an ad-hoc per-call-site user_id filter. The owner-scoping RLS
 * policies (RESTRICTIVE deny-anon + PERMISSIVE owner-authenticated) ship in
 * the SAME migration as the table (0041_references.sql), mirroring
 * 0040_documents.sql.
 *
 * ## Columns
 *
 *   - `url` + `title` — the reference itself; same text shape as the ledger's
 *     url/title so a future "promote ledger row to saved reference" copy is a
 *     straight field map.
 *   - `note` — the user's own annotation (nullable; a reference can be saved
 *     bare).
 *   - `tags` — text[] with a NOT NULL '{}' default so list rendering never
 *     branches on null (chips iterate an empty array instead).
 *
 * ## Seam (recorded, NOT built): references-as-canvas-nodes
 *
 * A saved reference is shaped to appear later as a research-canvas node
 * (chat_context_edges' sourceRef union would grow a
 * `{ type: "reference", referenceId }` arm and ownership would resolve via
 * assertReferenceOwnership). Nothing here presupposes that — no canvas
 * columns, no FK into chat tables.
 *
 * NOTE: "references" is a reserved word in PostgreSQL — Drizzle quotes all
 * identifiers at runtime and the hand-written migration quotes it everywhere,
 * so this is safe; any future raw SQL touching this table must quote it too.
 */

import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// references — owner-scoped saved references (999.35)
// ---------------------------------------------------------------------------
export const References = pgTable(
  "references",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor — mirrors documents / chat_conversations /
    // forwarding_addresses. No importer join; scoped directly by user_id.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    url: text("url").notNull(),
    title: text("title").notNull(),

    // The user's own annotation. Nullable — a reference can be saved bare.
    note: text("note"),

    // NOT NULL with an empty-array default so consumers iterate, never
    // null-check.
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Ownership lookups + the references list (per-user, newest first).
    referencesUserIdIdx: index("idx_references_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ReferenceRow = typeof References.$inferSelect;
export type InsertReference = typeof References.$inferInsert;
