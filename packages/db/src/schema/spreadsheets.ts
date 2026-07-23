/**
 * FEATURE-CATALOG CV-03 — Spreadsheets: the `spreadsheets` table.
 *
 * This is the ONLY new schema CV-03 introduces (the catalog's own note: the
 * spreadsheet-grid — packages/ui/src/spreadsheet-grid — is a complete Excel-like
 * grid imported by zero surface; wiring it as a canvas panel + agent-proposed
 * table needs persistence). It backs both the canvas `spreadsheet` node
 * (node.data carries only a `spreadsheetId` ref, the doc rehydrates via
 * `spreadsheets.byId`) and the `table.create`/`table.update` capabilities the
 * agent uses to propose tables from email extractions.
 *
 * ## JSONB document, NOT a normalized `spreadsheet_cells` table — and why
 *
 * The catalog offered two shapes ("`spreadsheets` + `spreadsheet_cells`, or a
 * JSONB doc"). This picks the JSONB doc, deliberately:
 *
 *   - The grid consumes `SpreadsheetColumn[]` + `SpreadsheetRow[]`
 *     (packages/ui/src/spreadsheet-grid/types.ts), and a `SpreadsheetRow`
 *     ALREADY carries its cells as a `data: Record<string, unknown>` JSONB-shaped
 *     object. Storing columns/rows as jsonb is therefore a 1:1 persistence of the
 *     exact shape the renderer reads — no assembly, no join.
 *   - The write path is WHOLE-DOCUMENT: `table.create` materializes a proposed
 *     table in one shot ("here are the 14 invoices as a table") and
 *     `table.update` replaces title/columns/rows atomically. Neither verb — and
 *     nothing on the read side — needs per-cell addressing, so a normalized
 *     `spreadsheet_cells` table would add a join and per-cell mutation machinery
 *     for zero consumer.
 *   - It matches the repo's established idiom for structured, queryable-but-
 *     whole-written payloads: `documents.spec` (jsonb) and
 *     `chat_canvas_layouts.nodes/edges` (jsonb) are the same shape of decision.
 *
 * The tradeoff recorded honestly: a giant sheet is read/written as one row. The
 * `table.create`/`table.update` input schemas bound column/row counts
 * (packages/capabilities/src/table.ts) so a single doc stays sane; if
 * cell-level collaborative editing ever lands, THAT is the trigger to normalize
 * — not before.
 *
 * ## Tenancy (INV-8/INV-9)
 *
 * spreadsheets is NOT an importer-descendant — like documents / desktop_sessions
 * it carries a DIRECT `user_id` referencing auth.users(id), scoped directly (no
 * join). Ownership resolves through the central helper
 * `assertSpreadsheetOwnership` (ownership.ts) — never an ad-hoc per-call-site
 * user_id filter. The owner-scoping RLS policies (RESTRICTIVE deny-anon +
 * PERMISSIVE owner-authenticated) ship in the SAME migration as the table
 * (INV-8/9), mirroring documents in 0040_documents.sql.
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
// spreadsheets — owner-scoped, JSONB-document tables (CV-03)
// ---------------------------------------------------------------------------
export const Spreadsheets = pgTable(
  "spreadsheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (INV-8/9) — mirrors documents / desktop_sessions.
    // No importer join; scoped directly by user_id. Cascade so a deleted user's
    // spreadsheets go with them.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    title: text("title").notNull().default("Untitled table"),

    // The column definitions (SpreadsheetColumn[]) the grid renders from —
    // name/type/enumValues/required. jsonb so it stays the exact shape
    // packages/ui/src/spreadsheet-grid/types.ts consumes.
    columns: jsonb("columns").notNull().default([]),

    // The row records (SpreadsheetRow[]) — each `{ id, data: {...cells} }`.
    // Whole-document write path (table.create/table.update); bounded by the
    // capability input schemas.
    rows: jsonb("rows").notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Ownership lookups + the per-user spreadsheets list (newest first).
    spreadsheetsUserIdIdx: index("idx_spreadsheets_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type SpreadsheetRow = typeof Spreadsheets.$inferSelect;
export type InsertSpreadsheet = typeof Spreadsheets.$inferInsert;
