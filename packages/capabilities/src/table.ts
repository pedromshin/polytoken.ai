/**
 * table.ts — the two agent table capabilities (FEATURE-CATALOG CV-03), declared ONCE as
 * `defineCapability()` descriptors so the LLM tool loop, genui, the /capabilities panel, and the
 * canvas `spreadsheet` node all read the SAME declaration (INV-1). This is what lets a turn that
 * extracts structure from email materialize it: "here are the 14 invoices as a table" →
 * `table.create` persists a spreadsheet the user can open as a canvas panel.
 *
 * ## Why this lives in OSS substrate, and how it stays pure
 *
 * The package rule (capability.ts header): NO tenant logic, NO env coupling, NO Supabase. These
 * descriptors carry ZERO persistence code — the `spreadsheets` row machinery is a
 * `SpreadsheetStore` PORT injected through the executor's context (`TCtx = TableExecCtx`), exactly
 * as desktop.ts injects its `DesktopProvider` and canvas.ts injects its `CanvasMutationStore`. The
 * control plane (packages/api-client's `router/spreadsheets`) binds a Drizzle-backed store that
 * sets the owner `user_id` server-side and asserts ownership before an update. Until a store is
 * bound, {@link failClosedSpreadsheetStore} is the default and every verb refuses (INV-5: unbound
 * fails closed).
 *
 * ## The column type vocabulary is a MIRROR (honesty discipline)
 *
 * `SPREADSHEET_FIELD_TYPES` hand-mirrors `SchemaFieldType` from
 * packages/ui/src/spreadsheet-grid/types.ts — this substrate package cannot import the (heavy,
 * React) UI package, so the enum is copied, not imported. A one-line vocabulary rarely moves; if
 * a type is ever added to the grid, add it here too.
 *
 * ## risk + reversibility are DATA (INV-4)
 *
 * No verb implements its own confirm flow. Both are `risk: "write"` and both are reversible:
 * neither declares a reversibility key (absent ⇒ reversible, the sibling convention — matching
 * canvas.addNode). `table.update` replaces the doc, but the mutation is scoped to one owned row
 * and undoable by a subsequent update, never a bespoke confirm dialog.
 */
import { z } from "zod";

import { defineCapability, type Capability } from "./capability.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True if `value` (or any nested object/array) carries a prototype-pollution key. */
function hasForbiddenKeyDeep(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeyDeep(item));
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeyDeep((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bounds — a single JSONB document must stay sane (spreadsheets.ts records the
// whole-document write posture and points here for the caps).
// ---------------------------------------------------------------------------

export const MAX_TABLE_COLUMNS = 64;
export const MAX_TABLE_ROWS = 5000;

/** The grid's SchemaFieldType, mirrored (see module header). */
export const SPREADSHEET_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "boolean",
  "url",
  "email",
  "enum",
  "json",
  "array",
] as const;

// ---------------------------------------------------------------------------
// Column / row shapes — the exact SpreadsheetColumn / SpreadsheetRow the grid
// consumes (packages/ui/src/spreadsheet-grid/types.ts), validated here so an
// agent can never persist a malformed document.
// ---------------------------------------------------------------------------

const tableColumnSchema = z
  .object({
    name: z.string().min(1).max(128),
    type: z.enum(SPREADSHEET_FIELD_TYPES),
    required: z.boolean().optional(),
    enumValues: z.array(z.string().max(256)).max(128).optional(),
    description: z.string().max(512).optional(),
  })
  .strict();
export type TableColumn = z.infer<typeof tableColumnSchema>;

const tableRowSchema = z
  .object({
    /** Optional — the store assigns a uuid when absent (a proposed row need not name its id). */
    id: z.string().min(1).max(128).optional(),
    /** The cells, keyed by column name. Prototype-pollution keys are rejected below. */
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type TableRow = z.infer<typeof tableRowSchema>;

/** Reject a columns array whose names collide or that overruns the cap. */
const columnsSchema = z
  .array(tableColumnSchema)
  .min(1)
  .max(MAX_TABLE_COLUMNS)
  .superRefine((cols, ctx) => {
    const names = new Set<string>();
    for (const col of cols) {
      if (names.has(col.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate column name "${col.name}" — column names must be unique`,
        });
      }
      names.add(col.name);
    }
  });

const rowsSchema = z
  .array(tableRowSchema)
  .max(MAX_TABLE_ROWS)
  .superRefine((rows, ctx) => {
    if (rows.some((row) => hasForbiddenKeyDeep(row.data))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "row data must not contain __proto__/constructor/prototype keys at any depth",
      });
    }
  });

// ---------------------------------------------------------------------------
// Input / output schemas — the LLM-tool-facing validation boundary (INV-1).
// ---------------------------------------------------------------------------

export const tableCreateInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    columns: columnsSchema,
    /** Optional — a table can be proposed with a schema but no rows yet. */
    rows: rowsSchema.optional(),
  })
  .strict();
export type TableCreateInput = z.infer<typeof tableCreateInputSchema>;

const tableCreateOutputSchema = z
  .object({
    spreadsheetId: z.string().uuid(),
    created: z.literal(true),
  })
  .strict();
export type TableCreateOutput = z.infer<typeof tableCreateOutputSchema>;

export const tableUpdateInputSchema = z
  .object({
    spreadsheetId: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    columns: columnsSchema.optional(),
    rows: rowsSchema.optional(),
  })
  .strict()
  // An update must change SOMETHING — an empty patch is a no-op the agent never means.
  .refine(
    (input) =>
      input.title !== undefined || input.columns !== undefined || input.rows !== undefined,
    { message: "table.update must set at least one of title/columns/rows" },
  );
export type TableUpdateInput = z.infer<typeof tableUpdateInputSchema>;

const tableUpdateOutputSchema = z
  .object({
    spreadsheetId: z.string().uuid(),
    /** false ⇒ no such spreadsheet (fail-safe: a retried update must not blow up the turn). */
    updated: z.boolean(),
  })
  .strict();
export type TableUpdateOutput = z.infer<typeof tableUpdateOutputSchema>;

// ---------------------------------------------------------------------------
// The store PORT — the one seam substrate exposes for real persistence. The
// control plane binds a Drizzle-backed implementation over the `spreadsheets`
// table (owner set server-side on create, ownership asserted before update);
// substrate holds no DB.
// ---------------------------------------------------------------------------

export interface SpreadsheetStore {
  create(input: TableCreateInput): Promise<TableCreateOutput>;
  update(input: TableUpdateInput): Promise<TableUpdateOutput>;
}

/** What the executor receives — the injected store (and nothing tenant-shaped; the binding closes
 * over the DB handle and the owner principal). */
export type TableExecCtx = { readonly store: SpreadsheetStore };

/** The scope a permission decision is made against — the verb + the target (create has no id). */
export type TableScope = { readonly action: string; readonly spreadsheetId?: string };

/** The fails-closed default: no store bound ⇒ every verb refuses (INV-5). */
export const failClosedSpreadsheetStore: SpreadsheetStore = Object.freeze({
  create: () =>
    Promise.reject(new Error("[table] no spreadsheet store configured — table creation is unavailable")),
  update: () =>
    Promise.reject(new Error("[table] no spreadsheet store configured — table update is unavailable")),
});

// ── table.create ─────────────────────────────────────────────────────────────────────────────────
export const tableCreateCapability = defineCapability<
  TableCreateInput,
  TableCreateOutput,
  TableExecCtx,
  TableScope
>({
  id: "table.create",
  input: tableCreateInputSchema,
  output: tableCreateOutputSchema,
  risk: "write",
  cost: "free",
  describe:
    "Create a new spreadsheet table from structured data you have extracted — for example the " +
    "invoices, line items, or contacts found across a set of emails. Provide a title, the column " +
    "definitions (name + type), and the rows; the table is saved to the user's own workspace and " +
    "can then be opened as a spreadsheet panel on the canvas.",
  source: "builtin",
  trust: "first-party",
  scope: () => ({ action: "table.create" }),
  execute: (input, ctx) => ctx.store.create(input),
});

// ── table.update ─────────────────────────────────────────────────────────────────────────────────
export const tableUpdateCapability = defineCapability<
  TableUpdateInput,
  TableUpdateOutput,
  TableExecCtx,
  TableScope
>({
  id: "table.update",
  input: tableUpdateInputSchema,
  output: tableUpdateOutputSchema,
  risk: "write",
  cost: "free",
  describe:
    "Update an existing spreadsheet table the user owns: change its title, replace its column " +
    "definitions, and/or replace its rows. Only the fields you provide change. The spreadsheet is " +
    "identified by its id, and the update is refused unless the user owns that spreadsheet.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "table.update", spreadsheetId: input.spreadsheetId }),
  execute: (input, ctx) => ctx.store.update(input),
});

/**
 * The two table capabilities as one array — the control plane folds this into its registry
 * (INV-1: one declaration, many consumers). Ordered create, update.
 */
export const TABLE_CAPABILITIES: readonly Capability<
  never,
  never,
  TableExecCtx,
  TableScope
>[] = Object.freeze([
  tableCreateCapability,
  tableUpdateCapability,
] as unknown as readonly Capability<never, never, TableExecCtx, TableScope>[]);
