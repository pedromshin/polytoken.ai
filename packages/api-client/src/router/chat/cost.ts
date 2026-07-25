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

import { and, asc, eq, gte, sql } from "drizzle-orm";
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
// usage.summary — owner-scoped spend meter (system-to-user canvas `usage` node)
// ---------------------------------------------------------------------------
//
// The FastAPI cost breaker (22-04, cost_circuit_breaker.py) is the sole
// ENFORCEMENT authority and accepts no per-call cap — caps live ONLY in
// settings (D-21). This procedure is the READ side of that same accounting:
// it never gates a turn, it reports the caller's spend against those caps so
// the canvas can render a live meter.
//
// SCOPING (owner, not conversation): chat_cost_ledger carries a DIRECT
// `user_id` ownership anchor (Phase 44 — the ledger is NOT an importer
// descendant, chat-cost-ledger.ts module doc). The day sum is therefore scoped
// by `userId = ctx.user.id` — that WHERE clause IS the tenancy boundary, so no
// conversation assertion is needed for the day path (there is no conversation
// in it). The UTC-day window mirrors the breaker's `_day_cap_breached` exactly
// (`created_at >= start-of-UTC-day`, cost_circuit_breaker.py:148-158), so the
// meter and the gate agree on what "today" means.
//
// SESSION (optional): a session cap is per-conversation in the breaker
// (`sum_for_conversation`). This node places with no conversation ref, so
// `conversationId` is OPTIONAL; when present the caller's ownership of it is
// asserted (NOT_FOUND on a non-owned id, sibling idiom) AND the sum is still
// userId-filtered (defense in depth). When absent, sessionSpendUsd is null.
//
// CAPS: the numeric caps live in the Python settings module
// (apps/email-listener/app/settings.py — COST_CAP_PER_TURN/SESSION/DAY_USD),
// which the TS side has no import of. They are re-read here from the matching
// env vars, defaulting to the SAME literals the settings dataclass declares, so
// a deployment that raises a cap in the environment (D-21: "raising a cap is a
// config change") moves both the gate and this meter together.

/** Re-read a positive USD cap from the environment, falling back to the value
 * the Python settings dataclass declares for the same name (settings.py). */
function capFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** UTC start-of-today, the lower bound of the day window — identical semantics
 * to the breaker's `datetime.now(UTC).date()` day boundary. */
function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export const usageSummaryInputSchema = z.object({
  // Optional: when supplied, the response also carries this conversation's
  // session spend (owner-asserted). The canvas `usage` node passes nothing.
  conversationId: z.string().uuid().optional(),
});
export type UsageSummaryInput = z.infer<typeof usageSummaryInputSchema>;

export interface UsageCaps {
  readonly perTurnUsd: number;
  readonly perSessionUsd: number;
  readonly perDayUsd: number;
}

export interface UsageSummaryOutput {
  /** The caller's total USD spend since UTC start-of-today (all importers). */
  readonly spendTodayUsd: number;
  /** This conversation's total USD spend, or null when no conversationId given. */
  readonly spendSessionUsd: number | null;
  /** The configured caps (env → Python-settings defaults). */
  readonly caps: UsageCaps;
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

  /**
   * summary — the owner-scoped spend meter behind the canvas `usage` node.
   * Read-only, never gates a turn. Day spend is scoped by `ctx.user.id`
   * (the ledger's direct ownership anchor) over the UTC-day window the breaker
   * uses; session spend is included only when a (owned) conversationId is
   * passed. Caps mirror the Python settings caps (env → same defaults).
   */
  summary: protectedProcedure
    .input(usageSummaryInputSchema)
    .query(async ({ ctx, input }): Promise<UsageSummaryOutput> => {
      const dayStart = startOfUtcDay(new Date());

      const [todayRow] = await ctx.db
        .select({
          total: sql<string>`coalesce(sum(${ChatCostLedger.costUsd}), 0)`,
        })
        .from(ChatCostLedger)
        .where(
          and(
            eq(ChatCostLedger.userId, ctx.user.id),
            gte(ChatCostLedger.createdAt, dayStart),
          ),
        );

      let spendSessionUsd: number | null = null;
      if (input.conversationId !== undefined) {
        // Owner-assert the conversation (NOT_FOUND on a non-owned id, sibling
        // idiom) before summing — and still userId-filter (defense in depth).
        await assertOwnedOrNotFound(() =>
          assertConversationOwnership(
            ctx.db,
            input.conversationId as string,
            ctx.user.id,
          ),
        );
        const [sessionRow] = await ctx.db
          .select({
            total: sql<string>`coalesce(sum(${ChatCostLedger.costUsd}), 0)`,
          })
          .from(ChatCostLedger)
          .where(
            and(
              eq(ChatCostLedger.userId, ctx.user.id),
              eq(ChatCostLedger.conversationId, input.conversationId),
            ),
          );
        spendSessionUsd = Number(sessionRow?.total ?? 0);
      }

      return {
        spendTodayUsd: Number(todayRow?.total ?? 0),
        spendSessionUsd,
        caps: {
          perTurnUsd: capFromEnv("COST_CAP_PER_TURN_USD", 0.5),
          perSessionUsd: capFromEnv("COST_CAP_PER_SESSION_USD", 2.0),
          perDayUsd: capFromEnv("COST_CAP_PER_DAY_USD", 5.0),
        },
      };
    }),
};
