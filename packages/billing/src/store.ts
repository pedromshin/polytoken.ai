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
   * provided fields. Creates the row if absent. No event-ordering guard — use
   * {@link applyOrderedSync} for Stripe-event-driven writes. */
  upsertByUserId(userId: string, patch: BillingSubscriptionPatch): Promise<void>;

  /**
   * Event-ordered upsert (the resurrection guard). Apply `patch` for `userId`
   * ONLY when `eventAt` is not older than the most recent event already applied
   * to this row; a strictly-older event (e.g. a stale
   * `customer.subscription.updated` delivered AFTER the
   * `customer.subscription.deleted`) is ignored so it cannot resurrect a
   * canceled tier. Records `eventAt` as the row's new high-water mark when it
   * wins. Returns `true` if the patch was applied, `false` if skipped as stale.
   * Atomic: the compare-and-apply is a single conditional upsert, so concurrent
   * out-of-order events for one subscription cannot interleave.
   */
  applyOrderedSync(
    userId: string,
    patch: BillingSubscriptionPatch,
    eventAt: Date,
  ): Promise<boolean>;

  /**
   * Run `fn` while holding a per-user exclusive lock, serializing concurrent
   * billing mutations for one user (two simultaneous checkout calls, a
   * double-submit). The lock is released when `fn` settles. This closes the
   * checkout TOCTOU: the duplicate-active guard + customer reuse re-read state
   * inside the critical section, so two concurrent checkouts cannot both pass
   * the guard or both create a Stripe customer. Implemented with a
   * transaction-scoped Postgres advisory lock in production.
   */
  withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T>;

  // --- webhook idempotency (stripe_webhook_events dedupe) ---

  /** True if this Stripe event id has already been fully processed. */
  wasEventProcessed(eventId: string): Promise<boolean>;

  /**
   * Atomically CLAIM an event id for processing (insert; ON CONFLICT DO
   * NOTHING). Returns `true` when THIS call inserted the row (the caller won the
   * claim and must process), `false` when the row already existed (a concurrent
   * in-flight worker or an already-recorded event owns it). This is the atomic
   * idempotency gate: two concurrent duplicate deliveries cannot both win, so
   * the handler body runs exactly once.
   */
  recordEventStart(eventId: string, eventType: string, payload: unknown): Promise<boolean>;

  /** Mark an event fully processed (sets processed_at). */
  markEventProcessed(eventId: string): Promise<void>;

  /**
   * Release a claim that never completed — delete the ledger row ONLY while it
   * is still unprocessed (`processed_at IS NULL`). Called when the handler
   * throws after {@link recordEventStart} won the claim, so Stripe's retry can
   * re-claim and re-run it instead of the crashed claim silently swallowing the
   * event. A no-op once the event has been marked processed.
   */
  releaseUnprocessedEvent(eventId: string): Promise<void>;
}

/** Result of processing a Stripe webhook event. */
export interface WebhookResult {
  readonly eventId: string;
  readonly eventType: string;
  readonly handled: boolean;
  readonly action: string;
}
