/**
 * spreadsheets/index.ts — spreadsheetsRouter (FEATURE-CATALOG CV-03).
 *
 * The owner-scoped read/write control plane for the `spreadsheets` table. It serves two consumers:
 *
 *   1. the canvas `spreadsheet` node — `byId` returns one owned spreadsheet's columns/rows so the
 *      node can render the grid (node.data carries only a `spreadsheetId` ref, ref-only discipline);
 *      `list` is the picker source.
 *   2. the agent — `create`/`update` are the server side of the `table.create`/`table.update`
 *      capabilities (packages/capabilities/src/table.ts). The capabilities are DECLARED in
 *      `@polytoken/capabilities` (one declaration, many consumers, INV-1); this module is the
 *      control-plane BINDING, exactly as `router/desktop/index.ts` binds the desktop.* descriptors
 *      and `router/chat/canvas-mutations.ts` binds the canvas.* triple.
 *
 * ## Tenancy (INV-8/INV-9, TENA-03)
 *
 *   - Every procedure is `protectedProcedure`; the acting identity is ALWAYS `ctx.user.id`, never a
 *     client field. `create` sets the owner server-side. `byId`/`update` assert ownership at the TOP
 *     via `assertSpreadsheetOwnership` — missing-or-not-yours both surface as NOT_FOUND (fail-closed,
 *     no existence oracle). `list` filters directly on `ctx.user.id` (the direct-user_id anchor).
 *   - The store's own writes ALSO scope every UPDATE on `user_id` (defense in depth) — a bound store
 *     can never touch a row the caller does not own even if the ownership assert were bypassed.
 *   - The mutation runs through the capability registry, resolved BY ID (INV-2:
 *     `registry.get("table.create")`), re-parsed against `capability.input` at the boundary, and
 *     executed against the injected Drizzle-backed `SpreadsheetStore`.
 *
 * risk is DATA on the capability (INV-4) — this router does not re-implement a confirm flow.
 */

import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";

import {
  createCapabilityRegistry,
  TABLE_CAPABILITIES,
  tableCreateInputSchema,
  tableUpdateInputSchema,
  type SpreadsheetStore,
  type TableCreateInput,
  type TableCreateOutput,
  type TableExecCtx,
  type TableScope,
  type TableUpdateInput,
  type TableUpdateOutput,
} from "@polytoken/capabilities";
import { Spreadsheets } from "@polytoken/db/schema";
import { assertSpreadsheetOwnership, type OwnershipDb } from "@polytoken/db/ownership";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

/** The table-mutation registry, resolved by id (INV-2). Built once at module load. */
const registry = createCapabilityRegistry<TableExecCtx, TableScope>(TABLE_CAPABILITIES);

/** A stored SpreadsheetRow — `{ id, data }`. The store assigns an id to any proposed row without
 * one so the persisted document always has stable row identity (the grid's getRowId reads it). */
interface StoredRow {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

function normalizeRows(rows: TableCreateInput["rows"]): StoredRow[] {
  return (rows ?? []).map((row) => ({
    id: row.id ?? globalThis.crypto.randomUUID(),
    data: row.data,
  }));
}

/**
 * Build the Drizzle-backed store the table capabilities execute against. Closes over the DB handle
 * AND the owner principal — `create` stamps `user_id` server-side, `update` scopes every write on
 * it. Exported so a (future) chat-stream tool loop reuses THE single write path.
 */
export function createSpreadsheetStore(db: OwnershipDb, userId: string): SpreadsheetStore {
  return {
    async create(input: TableCreateInput): Promise<TableCreateOutput> {
      const inserted = await db
        .insert(Spreadsheets)
        .values({
          userId,
          title: input.title,
          columns: input.columns,
          rows: normalizeRows(input.rows),
        })
        .returning({ id: Spreadsheets.id });
      const id = inserted[0]?.id;
      if (id === undefined) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "spreadsheet insert returned no id" });
      }
      return { spreadsheetId: id, created: true };
    },

    async update(input: TableUpdateInput): Promise<TableUpdateOutput> {
      // Only the provided fields change (partial patch); updatedAt always bumps.
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) set.title = input.title;
      if (input.columns !== undefined) set.columns = input.columns;
      if (input.rows !== undefined) set.rows = normalizeRows(input.rows);

      const updated = await db
        .update(Spreadsheets)
        .set(set)
        // Defense in depth: scope the write on user_id too, never id alone.
        .where(and(eq(Spreadsheets.id, input.spreadsheetId), eq(Spreadsheets.userId, userId)))
        .returning({ id: Spreadsheets.id });
      return { spreadsheetId: input.spreadsheetId, updated: updated.length > 0 };
    },
  };
}

/** Resolve a table capability BY ID (INV-2), re-parse at the boundary, execute against the store. */
async function runTableCapability(
  id: string,
  rawInput: unknown,
  db: OwnershipDb,
  userId: string,
): Promise<unknown> {
  const capability = registry.get(id);
  if (!capability) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${id} unregistered` });
  }
  const parsed = capability.input.parse(rawInput);
  return capability.execute(parsed as never, { store: createSpreadsheetStore(db, userId) } as never);
}

export const spreadsheetsRouter = createTRPCRouter({
  /**
   * list — the caller's spreadsheets, newest first. Scoped directly to `ctx.user.id`. Omits the
   * heavy columns/rows jsonb so the picker never streams table bodies.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: Spreadsheets.id,
        title: Spreadsheets.title,
        createdAt: Spreadsheets.createdAt,
        updatedAt: Spreadsheets.updatedAt,
      })
      .from(Spreadsheets)
      .where(eq(Spreadsheets.userId, ctx.user.id))
      .orderBy(desc(Spreadsheets.updatedAt))
      .limit(100);
  }),

  /**
   * byId — a single spreadsheet with its full columns/rows (what the canvas `spreadsheet` node
   * renders). Ownership asserted BEFORE the read; NOT_FOUND on missing-or-not-yours (fail-closed).
   */
  byId: protectedProcedure
    .input(z.object({ spreadsheetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertSpreadsheetOwnership(ctx.db, input.spreadsheetId, ctx.user.id),
      );
      const rows = await ctx.db
        .select({
          id: Spreadsheets.id,
          title: Spreadsheets.title,
          columns: Spreadsheets.columns,
          rows: Spreadsheets.rows,
          createdAt: Spreadsheets.createdAt,
          updatedAt: Spreadsheets.updatedAt,
        })
        .from(Spreadsheets)
        .where(eq(Spreadsheets.id, input.spreadsheetId))
        .limit(1);
      // Ownership already asserted existence; defensive narrowing, not an existence oracle.
      return rows[0] ?? null;
    }),

  /**
   * create — the server half of `table.create`. Owner is stamped server-side inside the store; the
   * capability validates the columns/rows document.
   */
  create: protectedProcedure
    .input(tableCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      return (await runTableCapability(
        "table.create",
        input,
        ctx.db,
        ctx.user.id,
      )) as TableCreateOutput;
    }),

  /**
   * update — the server half of `table.update`. Ownership asserted FIRST (NOT_FOUND on
   * missing-or-not-yours), then the capability runs against the owner-scoped store.
   */
  update: protectedProcedure
    .input(tableUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertSpreadsheetOwnership(ctx.db, input.spreadsheetId, ctx.user.id),
      );
      return (await runTableCapability(
        "table.update",
        input,
        ctx.db,
        ctx.user.id,
      )) as TableUpdateOutput;
    }),
});
