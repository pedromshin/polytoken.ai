/**
 * Phase 76 (BTAP-03/04) — Bespoke disposable apps: the `code_islands` table.
 *
 * The first true *bespoke-app object* in the personal graph. Generated island
 * code is non-deterministic and UNCACHED (`generate_code_island.py:24`), so the
 * winning program must be persisted to survive a reload — the canvas
 * `code-island` node carries only an `islandId` ref (ref-only discipline, like
 * `spreadsheets`) and rehydrates the code + its input bindings from this row via
 * `codeIslands.byId`. Because the island + its bindings are rows (not a chat
 * transcript), a "reconciler" built once becomes a standing, re-openable tool a
 * future tools-gallery / cross-conversation reuse reads from.
 *
 * ## Tenancy (INV-8/INV-9)
 * Like `spreadsheets` / `documents`, this is NOT an importer-descendant — it
 * carries a DIRECT `user_id` referencing auth.users(id), scoped directly.
 * Ownership resolves through `assertCodeIslandOwnership` (ownership.ts), never an
 * ad-hoc per-call-site filter. Owner-scoping RLS (RESTRICTIVE deny-anon +
 * PERMISSIVE owner-authenticated) ships in the SAME migration as the table
 * (mirroring 0040_documents.sql), as defense-in-depth behind the app-boundary
 * ownership wall.
 *
 * ## JSONB `input_bindings`
 * The `targetKey -> { sourceNodeKey, sourcePath }` map that records how the
 * island's `window.__ISLAND_DATA__.{targetKey}` inputs are wired to their
 * source nodes' published projections (Phase 73 publish port). Stored whole
 * (never per-binding-addressed), same idiom as `documents.spec` /
 * `chat_canvas_layouts.nodes`. The DATA itself never lives here — it flows live
 * through `usePanelData` at render time; only the wiring is persisted.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

// ---------------------------------------------------------------------------
// code_islands — owner-scoped, persisted bespoke-app objects (BTAP-04)
// ---------------------------------------------------------------------------
export const CodeIslands = pgTable(
  "code_islands",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (INV-8/9) — mirrors documents / spreadsheets.
    // Cascade so a deleted user's islands go with them.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // The natural-language task the island was generated for ("reconcile these
    // invoices against the bank rows…"). Kept for the tools-gallery label + as
    // the regenerate seed.
    intent: text("intent").notNull(),

    // The winning generated island program (plain JS). The source of truth for
    // THIS island — the node reads it via byId and does NOT re-call the
    // generator on mount (non-determinism = no regenerate-on-reload).
    code: text("code").notNull(),

    // targetKey -> { sourceNodeKey, sourcePath } — how the island's typed inputs
    // wire to their source nodes' published projections. jsonb, whole-written.
    inputBindings: jsonb("input_bindings").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Ownership lookups + the per-user tools list (newest first).
    codeIslandsUserIdIdx: index("idx_code_islands_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CodeIslandRow = typeof CodeIslands.$inferSelect;
export type InsertCodeIsland = typeof CodeIslands.$inferInsert;
