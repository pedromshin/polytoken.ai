/**
 * _chat-turn-usage.ts — the ONE definition of "how many monthly chat turns
 * has this user used" (the `monthlyChatTurns` entitlement's meter).
 *
 * Extracted from `billingRouter.usage`'s inline query (mirroring the
 * `_ownership.ts` / `_listener-config.ts` shared-helper idiom) so the /billing
 * meter and the chat-turn cap ENFORCEMENT gate (chat/turn-cap.ts) execute the
 * byte-identical counting semantics — they can never drift apart:
 *
 *   ACTIVE user-role `chat_messages` rows in the caller's OWN conversations
 *   (chat_messages.conversation_id → chat_conversations.user_id = userId)
 *   with created_at >= the 1st of the current UTC month.
 *
 *   - role = 'user': assistant/system rows never count — a "turn" is the
 *     user's send, not the model's reply.
 *   - is_active = true: a regenerated/edited turn adds a sibling row sharing
 *     sibling_group_id; only the active sibling counts, matching the
 *     `monthlyChatTurns` entitlement's unit (logical turns, not row count).
 *   - UTC month window: the allowance resets at 00:00 UTC on the 1st.
 *
 * STRICTLY caller-scoped: the count joins to chat_conversations.user_id —
 * callers are contractually required to pass a server-verified user id
 * (ctx.user.id), never client input.
 *
 * Failure policy is deliberately NOT decided here — this helper THROWS on any
 * db error, and each caller owns its own degradation:
 *   - billingRouter.usage catches → renders 0 (a missing table pre-migration
 *     must not 500 the /billing page).
 *   - chat/turn-cap.ts catches → FAILS OPEN (an outage must never lock users
 *     out of chat).
 */

import { and, count, eq, gte } from "drizzle-orm";

import { ChatConversations, ChatMessages } from "@polytoken/db/schema";

import type { TRPCContext } from "../trpc";

/** The Drizzle handle both the meter and the enforcement gate pass in (ctx.db). */
export type ChatTurnUsageDb = TRPCContext["db"];

/**
 * startOfCurrentUtcMonth — 00:00:00.000 UTC on the 1st of `now`'s UTC month.
 * Pure; exported for DB-free month-boundary testing.
 */
export function startOfCurrentUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * countMonthlyChatTurnsUsed — the shared meter/enforcement count (see module
 * doc for the exact semantics). `now` is injectable for deterministic tests
 * only; production callers omit it.
 *
 * Throws on db failure — callers decide the failure policy (see module doc).
 */
export async function countMonthlyChatTurnsUsed(
  db: ChatTurnUsageDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const startOfUtcMonth = startOfCurrentUtcMonth(now);

  const rows = await db
    .select({ value: count() })
    .from(ChatMessages)
    .innerJoin(
      ChatConversations,
      eq(ChatMessages.conversationId, ChatConversations.id),
    )
    .where(
      and(
        eq(ChatConversations.userId, userId),
        eq(ChatMessages.role, "user"),
        // Only the active sibling counts — a regenerated/edited turn adds a
        // row sharing sibling_group_id; counting all would over-report turns.
        eq(ChatMessages.isActive, true),
        gte(ChatMessages.createdAt, startOfUtcMonth),
      ),
    );

  return Number(rows[0]?.value ?? 0);
}
