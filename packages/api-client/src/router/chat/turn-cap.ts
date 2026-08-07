/**
 * chat/turn-cap.ts — THE enforcement gate for the `monthlyChatTurns`
 * entitlement. This file is where the cap POLICY decision lives; the counting
 * semantics live in ../_chat-turn-usage.ts (shared byte-identically with
 * billingRouter.usage's meter), and the NUMBERS live in
 * @polytoken/billing's entitlements.ts (read here, never redefined).
 *
 * ## Policy (decideChatTurnCap — pure, DB-free)
 *   - FREE tier at/over its cap → BLOCKED: a typed TRPCError FORBIDDEN with a
 *     user-friendly message (the detail — user id, used, tier — is logged
 *     server-side only).
 *   - PRO/POWER tiers → NEVER hard-blocked. At/over cap the turn is allowed
 *     (fail-open) and the result carries `overLimit: true`, an additive
 *     response marker existing clients simply ignore. (power's cap is null =
 *     unlimited, so it can never read over-limit at all.)
 *   - Unknown/absent subscription row → treated as `free` (the default tier,
 *     matching billingRouter.currentSubscription).
 *
 * ## Failure posture (enforceChatTurnCap)
 *   FAIL-OPEN on ANY db/lookup error — tier lookup or count alike. An outage
 *   (missing table pre-migration, connectivity blip) must never lock users
 *   out of chat; the error is logged server-side and the turn proceeds with
 *   `overLimit: false`. Only the deliberate free-at-cap decision ever blocks.
 *
 * ## Scoping
 *   userId is contractually the server-verified ctx.user.id (protectedProcedure)
 *   — never client input. The tier lookup and the count are both scoped to it.
 */

import { eq } from "drizzle-orm";

import { asKnownTier, entitlementsFor, type Tier } from "@polytoken/billing";
import { Subscriptions } from "@polytoken/db/schema";

import { TRPCError } from "@trpc/server";
import {
  countMonthlyChatTurnsUsed,
  type ChatTurnUsageDb,
} from "../_chat-turn-usage";

/** User-facing block message (FREE tier at cap). Friendly by design — the
 * server-side log carries the detail (user id, used count, tier). */
export const CHAT_TURN_CAP_MESSAGE =
  "You've used all of this month's included chat turns on the free plan. " +
  "Upgrade to keep chatting — your allowance resets at the start of next month (UTC).";

export interface ChatTurnCapDecision {
  /** false ONLY for the free tier at/over its cap. */
  readonly allowed: boolean;
  /** true whenever a finite cap is met/exceeded (drives the paid-tier marker). */
  readonly overLimit: boolean;
}

/**
 * decideChatTurnCap — the pure policy decision (see module doc). Reads the
 * cap from @polytoken/billing entitlements; never redefines the numbers.
 */
export function decideChatTurnCap(
  tier: Tier,
  monthlyChatTurnsUsed: number,
): ChatTurnCapDecision {
  const cap = entitlementsFor(tier).monthlyChatTurns;
  if (cap === null) {
    // Unlimited (power) — no cap to be over.
    return { allowed: true, overLimit: false };
  }
  if (monthlyChatTurnsUsed < cap) {
    return { allowed: true, overLimit: false };
  }
  // At/over cap: ONLY free hard-blocks; paid tiers stay fail-open with the
  // overLimit marker.
  return { allowed: tier !== "free", overLimit: true };
}

/**
 * enforceChatTurnCap — run the gate for one turn-creating mutation. Call it
 * AFTER ownership/authn checks and BEFORE any turn row is written.
 *
 * Resolves `{ overLimit }` when the turn may proceed; throws
 * TRPCError FORBIDDEN (friendly message) when the free-tier cap blocks it.
 * Any db/lookup failure fails OPEN (logged, `overLimit: false`).
 *
 * `now` is injectable for deterministic tests only.
 */
export async function enforceChatTurnCap(
  db: ChatTurnUsageDb,
  userId: string,
  now: Date = new Date(),
): Promise<{ overLimit: boolean }> {
  let decision: ChatTurnCapDecision;
  try {
    // The tier lookup and the usage count are independent reads — run them
    // concurrently. Both live inside the same fail-open try: one rejection
    // (or a sync builder throw) lands in the single catch, exactly as the
    // sequential version did.
    const [rows, used] = await Promise.all([
      db
        .select({ tier: Subscriptions.tier })
        .from(Subscriptions)
        .where(eq(Subscriptions.userId, userId))
        .limit(1),
      countMonthlyChatTurnsUsed(db, userId, now),
    ]);
    const tier = asKnownTier(rows[0]?.tier);
    decision = decideChatTurnCap(tier, used);

    if (!decision.allowed) {
      // Server-side detail; the client only ever sees CHAT_TURN_CAP_MESSAGE.
      console.error(
        `[chat.turnCap] blocking turn for user ${userId}: tier=${tier} used=${used}`,
      );
    }
  } catch (error) {
    // FAIL-OPEN for everyone: an outage must never lock users out of chat.
    console.error("[chat.turnCap] cap check failed — failing open:", error);
    return { overLimit: false };
  }

  if (!decision.allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: CHAT_TURN_CAP_MESSAGE });
  }
  return { overLimit: decision.overLimit };
}
