/**
 * chat/cost.ts — tRPC query: chat.sessionCost
 *
 * Reads chat_cost_ledger (22-01, FOUND-3) for a conversation's running total
 * plus a per-turn breakdown (model, tokens in/out, cost) — the session cost
 * meter's data source (STREAM-03, D-23). Display-only: this procedure never
 * gates or blocks a turn; enforcement lives entirely server-side in the
 * FastAPI cost breaker (22-04). Reads are parameterized Drizzle, scoped by
 * conversationId (uuid) and an optional importerId (T-22-37).
 *
 * totalCostUsd is computed from the SAME bounded row set as breakdown (see
 * shapeSessionCost below) rather than a separate unbounded SQL SUM — for a
 * conversation with more than MAX_BREAKDOWN_ROWS turns, a detached SUM
 * aggregate could disagree with what the breakdown popover actually shows;
 * deriving both from one capped query keeps them consistent by construction.
 *
 * Phase 44 (TENA-03, T-44-07-01): requires a session (protectedProcedure)
 * and asserts conversation ownership via @polytoken/db/ownership BEFORE
 * reading ledger rows — a non-owned conversationId surfaces as NOT_FOUND.
 */

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatCostLedger } from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const sessionCostInputSchema = z.object({
  conversationId: z.string().uuid(),
  importerId: z.string().uuid().optional(),
});
export type SessionCostInput = z.infer<typeof sessionCostInputSchema>;

// ---------------------------------------------------------------------------
// D-19-style unbounded payload guard — mirrors history.ts/gallery.ts's
// MAX_HISTORY_ROWS / limit+1 caps.
// ---------------------------------------------------------------------------
const MAX_BREAKDOWN_ROWS = 200;

// ---------------------------------------------------------------------------
// Raw row shape — what the DB query returns before shaping. costUsd arrives
// as a string (Postgres `numeric` columns are not returned as JS numbers by
// the pg driver, to avoid float precision loss, D-22).
// ---------------------------------------------------------------------------
export interface CostLedgerRawRow {
  readonly runId: string | null;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: string;
}

export interface CostBreakdownRow {
  readonly runId: string | null;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface SessionCostOutput {
  readonly totalCostUsd: number;
  readonly breakdown: readonly CostBreakdownRow[];
}

// ---------------------------------------------------------------------------
// Pure shaping helper — exported for DB-free testing (mirrors
// shapeGalleryItem / resolveDefaultModelId — this codebase's established
// no-ctx.db-mocking test convention, 22-05's key-decisions).
// ---------------------------------------------------------------------------

/**
 * shapeSessionCost — maps raw chat_cost_ledger rows to the session cost
 * meter's { totalCostUsd, breakdown } shape. Returns new immutable objects;
 * never mutates the input rows.
 */
export function shapeSessionCost(
  rows: readonly CostLedgerRawRow[],
): SessionCostOutput {
  const breakdown: CostBreakdownRow[] = rows.map((row) => ({
    runId: row.runId,
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: Number(row.costUsd),
  }));

  const totalCostUsd = breakdown.reduce((total, row) => total + row.costUsd, 0);

  return { totalCostUsd, breakdown };
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const chatCostProcedures = {
  /**
   * sessionCost — running total + per-turn breakdown for one conversation
   * (D-23). Never blocks/gates a turn; purely a read for the display-only
   * meter and its breakdown popover.
   */
  sessionCost: protectedProcedure
    .input(sessionCostInputSchema)
    .query(async ({ ctx, input }): Promise<SessionCostOutput> => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const rows = await ctx.db
        .select({
          runId: ChatCostLedger.runId,
          modelId: ChatCostLedger.modelId,
          inputTokens: ChatCostLedger.inputTokens,
          outputTokens: ChatCostLedger.outputTokens,
          costUsd: ChatCostLedger.costUsd,
        })
        .from(ChatCostLedger)
        .where(
          and(
            eq(ChatCostLedger.conversationId, input.conversationId),
            input.importerId !== undefined
              ? eq(ChatCostLedger.importerId, input.importerId)
              : undefined,
          ),
        )
        .orderBy(asc(ChatCostLedger.createdAt))
        .limit(MAX_BREAKDOWN_ROWS);

      return shapeSessionCost(rows);
    }),
};
