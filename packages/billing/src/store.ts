/**
 * BillingStore — the persistence port the billing functions depend on.
 *
 * Deliberately a small INTERFACE (not the drizzle `db` directly) so the checkout
 * / webhook / portal logic is unit-testable against an in-memory fake, exactly
 * like the algomaxxing/billing package injects repositories. The drizzle-backed
 * implementation lives in `store.drizzle.ts`; tests fake this interface.
 *
 * Ownership note: every method is keyed by the SERVER-resolved `userId`
 * (Supabase auth id) or the Stripe-issued `customerId`/`eventId`. No method
 * takes a client-supplied subscription row id — there is no by-arbitrary-id
 * access path, so no ownership-assert sweep is needed here (the router scopes
 * every call to `ctx.user.id`).
 */

import type { Tier } from "./tiers";

/** A user's current subscription state (the row shape the app reads). */
export interface BillingSubscription {
  readonly userId: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly tier: Tier;
  /** Stripe subscription status (active/trialing/past_due/canceled/…) or
   * "inactive" before any checkout. */
  readonly status: string;
  readonly currentPeriodEnd: Date | null;
}

/** Fields that may be patched on a subscription row (userId is the key, never patched). */
export type BillingSubscriptionPatch = Partial<Omit<BillingSubscription, "userId">>;

export interface BillingStore {
  /** The user's subscription row, or null if they have none yet. */
  getByUserId(userId: string): Promise<BillingSubscription | null>;

  /** The subscription row owning a Stripe customer id, or null. Used by webhook
   * events that carry only the customer id. */
  getByCustomerId(customerId: string): Promise<BillingSubscription | null>;

  /** Upsert the user's single subscription row (unique on user_id), setting the
   * provided fields. Creates the row if absent. */
  upsertByUserId(userId: string, patch: BillingSubscriptionPatch): Promise<void>;

  // --- webhook idempotency (stripe_webhook_events dedupe) ---

  /** True if this Stripe event id has already been fully processed. */
  wasEventProcessed(eventId: string): Promise<boolean>;

  /** Record that an event has begun processing (insert; no-op on conflict). */
  recordEventStart(eventId: string, eventType: string, payload: unknown): Promise<void>;

  /** Mark an event fully processed (sets processed_at). */
  markEventProcessed(eventId: string): Promise<void>;
}

/** Result of processing a Stripe webhook event. */
export interface WebhookResult {
  readonly eventId: string;
  readonly eventType: string;
  readonly handled: boolean;
  readonly action: string;
}
