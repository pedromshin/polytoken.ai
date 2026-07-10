/**
 * chat/widget-interactions.ts — the `getWidgetInteractions` tRPC procedure
 * (Task 3, 24-03, DCUI-01/DCUI-04).
 *
 * Returns the authoritative `chat_widget_interactions` rows for a
 * conversation — the client's ONLY source of truth for whether a pending
 * widget has since been submitted (D-11 CAS lock lives server-side; this
 * procedure is how the client learns the outcome after a 409 reconciles, or
 * after a page reload). `state`/`submittedValue` are read verbatim; staleness
 * ("stale"/"superseded") is NEVER stored here (see widget-display-state.ts) —
 * it is derived client-side from this data plus `chat.getHistory`'s
 * turn/sibling-version rows (D-12).
 *
 * Security (T-24-04): conversationId is validated as z.string().uuid() before
 * any query runs; row count is capped mirroring history.ts's MAX_HISTORY_ROWS
 * guard (D-26/T-22-19 posture).
 *
 * Phase 44 (TENA-03, T-44-07-01): requires a session (protectedProcedure)
 * and asserts conversation ownership via @polytoken/db/ownership BEFORE
 * reading — a non-owned conversationId surfaces as NOT_FOUND.
 */

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatWidgetInteractions } from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const getWidgetInteractionsInputSchema = z.object({
  conversationId: z.string().uuid(),
});
export type GetWidgetInteractionsInput = z.infer<typeof getWidgetInteractionsInputSchema>;

// Mirrors history.ts's MAX_HISTORY_ROWS — unbounded-payload guard.
const MAX_WIDGET_INTERACTION_ROWS = 500;

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const chatWidgetInteractionsProcedures = {
  /**
   * getWidgetInteractions — a conversation's widget-interaction rows,
   * ordered by creation (emission order), for client-side display-state
   * derivation (widget-display-state.ts).
   */
  getWidgetInteractions: protectedProcedure
    .input(getWidgetInteractionsInputSchema)
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const rows = await ctx.db
        .select({
          id: ChatWidgetInteractions.id,
          messageId: ChatWidgetInteractions.messageId,
          partIndex: ChatWidgetInteractions.partIndex,
          widgetKind: ChatWidgetInteractions.widgetKind,
          state: ChatWidgetInteractions.state,
          submittedValue: ChatWidgetInteractions.submittedValue,
        })
        .from(ChatWidgetInteractions)
        .where(eq(ChatWidgetInteractions.conversationId, input.conversationId))
        .orderBy(asc(ChatWidgetInteractions.createdAt))
        .limit(MAX_WIDGET_INTERACTION_ROWS);

      return rows;
    }),
};
