/**
 * chat/history.ts — the `getHistory` tRPC procedure.
 *
 * Returns a conversation's chat_messages ordered by turn then sibling version,
 * including the FOUND-1 typed `parts` payload plus the D-16 sibling-version
 * columns (siblingGroupId, version, isActive) so the UI can render turns with
 * `< N/M >` regenerate navigation.
 *
 * Security (T-22-16, T-22-19):
 *   - conversationId is validated as z.string().uuid() before any query runs.
 *   - row count is capped (unbounded-history guard).
 *
 * Phase 44 (TENA-03, T-44-07-01): requires a session (protectedProcedure)
 * and asserts conversation ownership via @polytoken/db/ownership BEFORE
 * reading messages — a non-owned conversationId surfaces as NOT_FOUND.
 */

import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { ChatMessages } from "@polytoken/db/schema";
import { assertConversationOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const getHistoryInputSchema = z.object({
  conversationId: z.string().uuid(),
});
export type GetHistoryInput = z.infer<typeof getHistoryInputSchema>;

// D-26/T-22-19 — unbounded history payload guard; per-model context trimming
// is a later plan's concern, this is the row-count safety cap.
const MAX_HISTORY_ROWS = 500;

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const chatHistoryProcedures = {
  /**
   * getHistory — messages for a conversation, ordered by turnIndex then
   * version, with parts + sibling-version metadata so the UI can render
   * interleaved typed parts (D-18) and sibling navigation (D-16).
   */
  getHistory: protectedProcedure
    .input(getHistoryInputSchema)
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );

      const rows = await ctx.db
        .select({
          id: ChatMessages.id,
          role: ChatMessages.role,
          parts: ChatMessages.parts,
          status: ChatMessages.status,
          turnIndex: ChatMessages.turnIndex,
          siblingGroupId: ChatMessages.siblingGroupId,
          version: ChatMessages.version,
          isActive: ChatMessages.isActive,
          createdAt: ChatMessages.createdAt,
        })
        .from(ChatMessages)
        .where(eq(ChatMessages.conversationId, input.conversationId))
        .orderBy(asc(ChatMessages.turnIndex), asc(ChatMessages.version))
        .limit(MAX_HISTORY_ROWS);

      return rows;
    }),
};
