/**
 * chat/browser-turn.ts — recordBrowserTurn: persist a locally-generated
 * (WebLLM, D-08/D-09) turn in the EXACT same canonical shape server turns
 * use (FOUND-1 typed parts, SEAM-03 run/run_events, FOUND-3 cost ledger).
 *
 * The browser engine (use-webllm-engine.ts) streams entirely client-side —
 * there is no server-side round-trip to persist deltas as they arrive, so
 * this mutation writes the FINISHED turn once, in one transaction, mirroring
 * what run_chat_turn.py's `_persist_and_finish` does for a server turn:
 *   - the user message (next turn_index)
 *   - a chat_runs row (agent_id "chat-agent-v1" — SEAM-04, same id as the
 *     server agent; model_id; status)
 *   - the assistant message (parts, status) linked to that run
 *   - started + terminal chat_run_events (T-22-42 — usage stays observable
 *     even though the cost is $0)
 *   - a chat_cost_ledger row: execution_locus="browser", cost_usd="0", but
 *     REAL input/output token counts (D-22 — "$0 but metered")
 *   - the conversation's model_id/title/updated_at (mirrors
 *     ChatConversationRepository.touch(), keeping the rail's recency list
 *     and title snippet correct for browser-only conversations too)
 *
 * Security (T-22-40, T-22-41, T-22-43):
 *   - userText/assistantText are Zod-bounded (untrusted browser-generated
 *     content must cross the same schema gate as server turns, FOUND-6).
 *   - parameterized Drizzle inserts only; importer-scoped (falls back to the
 *     same single-tenant DEFAULT_IMPORTER_ID as
 *     apps/email-listener/app/settings.py when omitted).
 *   - text renders through the sanitized MarkdownRenderer client-side (22-03)
 *     — this mutation itself never interprets/executes the text.
 *   - no genui tool is ever offered to a browser-locus model (D-08); this
 *     mutation has no path to persist a genui_spec/tool_call part at all.
 *
 * Row-shape building is a PURE function (buildBrowserTurnRows) tested
 * DB-free — this codebase has no precedent for mocking ctx.db chains
 * (22-05/22-10's established convention); see browser-turn.test.ts.
 *
 * Phase 44 (TENA-03, T-44-07-01/04): requires a session (protectedProcedure)
 * and asserts conversation ownership via @polytoken/db/ownership BEFORE
 * entering the transaction — a non-owned conversationId surfaces as
 * NOT_FOUND, no write is ever attempted. chat_cost_ledger.user_id (Plan 01,
 * NOT NULL) is always the session-derived ctx.user.id, never client-supplied.
 */

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  ChatConversations,
  ChatCostLedger,
  ChatMessages,
  ChatRunEvents,
  ChatRuns,
  type InsertChatCostLedger,
  type InsertChatMessage,
  type InsertChatRunEvent,
} from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// SEAM-04 — same agent id the server-side chat agent uses
// (run_chat_turn.py's _AGENT_ID) so runs are indistinguishable in shape
// regardless of execution_locus.
// ---------------------------------------------------------------------------
export const BROWSER_AGENT_ID = "chat-agent-v1";

// Mirrors apps/email-listener/app/settings.py's DEFAULT_IMPORTER_ID — the
// single-tenant fallback used whenever an explicit importerId is omitted.
export const DEFAULT_IMPORTER_ID = "00000000-0000-0000-0000-000000000001";

// T-22-19-style unbounded payload guard (T-22-40 — forged/oversized
// browser-turn payload).
const MAX_TEXT_LENGTH = 100_000;
const MAX_TOKENS = 1_000_000;

const TITLE_SNIPPET_MAX_LEN = 60;

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const recordBrowserTurnInputSchema = z.object({
  conversationId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
  userText: z.string().min(1).max(MAX_TEXT_LENGTH),
  // May be empty (e.g. stopped before any token streamed) — D-15 never drops
  // whatever partial content exists, including "none at all".
  assistantText: z.string().max(MAX_TEXT_LENGTH),
  // Mirrors chat_messages.status / chat_runs.status (D-15/D-19) — a browser
  // turn can be stopped or fail (e.g. WebGPU OOM) exactly like a server turn.
  status: z.enum(["completed", "stopped", "failed"]).default("completed"),
  inputTokens: z.number().int().min(0).max(MAX_TOKENS),
  outputTokens: z.number().int().min(0).max(MAX_TOKENS),
  importerId: z.string().uuid().optional(),
});
export type RecordBrowserTurnInput = z.infer<typeof recordBrowserTurnInputSchema>;

// ---------------------------------------------------------------------------
// Pure helpers — exported for DB-free testing (mirrors resolveDefaultModelId /
// shapeSessionCost's established no-ctx.db-mocking convention).
// ---------------------------------------------------------------------------

/**
 * titleSnippetFor — deterministic truncated first-message snippet (D-12),
 * mirrors run_chat_turn.py's `_title_snippet` exactly (whitespace-collapsed,
 * hard-truncated with an ellipsis, neutral fallback for empty text).
 */
export function titleSnippetFor(
  userText: string,
  maxLen: number = TITLE_SNIPPET_MAX_LEN,
): string {
  const collapsed = userText.split(/\s+/).filter(Boolean).join(" ");
  if (!collapsed) return "Untitled conversation";
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`;
}

export interface BrowserTurnRowContext {
  readonly turnIndex: number;
  readonly runId: string;
  readonly importerId: string;
  readonly isFirstTurn: boolean;
  /** Phase 44 (TENA-03): session-derived owner of the ledger row (never client-supplied). */
  readonly userId: string;
}

export interface BrowserTurnConversationUpdate {
  readonly modelId: string;
  readonly title?: string;
}

export interface BrowserTurnRows {
  readonly userMessage: InsertChatMessage;
  readonly assistantMessage: InsertChatMessage;
  readonly runEvents: readonly InsertChatRunEvent[];
  readonly costLedgerRow: InsertChatCostLedger;
  readonly conversationUpdate: BrowserTurnConversationUpdate;
}

/**
 * buildBrowserTurnRows — the canonical row shapes for one finished browser
 * turn (FOUND-1 parts, SEAM-03 run_events, FOUND-3/D-22 ledger). Pure: given
 * the same input + context, always returns the same new objects; never
 * mutates its arguments.
 */
export function buildBrowserTurnRows(
  input: RecordBrowserTurnInput,
  ctx: BrowserTurnRowContext,
): BrowserTurnRows {
  const userMessage: InsertChatMessage = {
    conversationId: input.conversationId,
    role: "user",
    parts: [{ type: "text", text: input.userText }],
    turnIndex: ctx.turnIndex,
    status: "completed",
  };

  const assistantMessage: InsertChatMessage = {
    conversationId: input.conversationId,
    runId: ctx.runId,
    role: "assistant",
    parts: [{ type: "text", text: input.assistantText }],
    turnIndex: ctx.turnIndex,
    status: input.status,
  };

  // started + the one matching terminal event — mirrors run_chat_turn.py's
  // _emit(run.id, "started", ...) / _emit(run.id, <terminal status>, ...)
  // pair (minus the intermediate text_delta_checkpoint trail, since the
  // browser stream is never itself server-observed).
  const runEvents: readonly InsertChatRunEvent[] = [
    { runId: ctx.runId, seq: 0, type: "started", data: { modelId: input.modelId } },
    { runId: ctx.runId, seq: 1, type: input.status, data: {} },
  ];

  const costLedgerRow: InsertChatCostLedger = {
    conversationId: input.conversationId,
    runId: ctx.runId,
    importerId: ctx.importerId,
    userId: ctx.userId,
    modelId: input.modelId,
    executionLocus: "browser",
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: "0",
  };

  const conversationUpdate: BrowserTurnConversationUpdate = ctx.isFirstTurn
    ? { modelId: input.modelId, title: titleSnippetFor(input.userText) }
    : { modelId: input.modelId };

  return { userMessage, assistantMessage, runEvents, costLedgerRow, conversationUpdate };
}

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const browserTurnProcedures = {
  /**
   * recordBrowserTurn — persists one finished in-browser (WebLLM) turn in
   * the canonical shape (D-08). One Drizzle transaction: next turn_index is
   * read, a chat_runs row is created, then buildBrowserTurnRows' pure output
   * is written verbatim (message x2, run_events x2, one $0 ledger row), and
   * the conversation's model_id/title/updated_at are touched to match the
   * server-turn ChatConversationRepository.touch() behavior.
   */
  recordBrowserTurn: protectedProcedure
    .input(recordBrowserTurnInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const importerId = input.importerId ?? DEFAULT_IMPORTER_ID;

      return ctx.db.transaction(async (tx) => {
        const [lastTurn] = await tx
          .select({ turnIndex: ChatMessages.turnIndex })
          .from(ChatMessages)
          .where(eq(ChatMessages.conversationId, input.conversationId))
          .orderBy(desc(ChatMessages.turnIndex))
          .limit(1);
        const turnIndex = lastTurn ? lastTurn.turnIndex + 1 : 0;

        const [run] = await tx
          .insert(ChatRuns)
          .values({
            conversationId: input.conversationId,
            agentId: BROWSER_AGENT_ID,
            modelId: input.modelId,
            status: input.status,
            endedAt: new Date(),
          })
          .returning({ id: ChatRuns.id });
        if (!run) {
          throw new Error("Failed to create browser run");
        }

        const rows = buildBrowserTurnRows(input, {
          turnIndex,
          runId: run.id,
          importerId,
          isFirstTurn: turnIndex === 0,
          userId: ctx.user.id,
        });

        await tx.insert(ChatRunEvents).values([...rows.runEvents]);
        await tx.insert(ChatMessages).values(rows.userMessage);
        await tx.insert(ChatMessages).values(rows.assistantMessage);
        await tx.insert(ChatCostLedger).values(rows.costLedgerRow);
        await tx
          .update(ChatConversations)
          .set({ ...rows.conversationUpdate, updatedAt: new Date() })
          .where(eq(ChatConversations.id, input.conversationId));

        return { runId: run.id, turnIndex };
      });
    }),
};
