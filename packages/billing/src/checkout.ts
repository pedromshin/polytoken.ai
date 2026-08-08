/**
 * Stripe Checkout session creation (subscription mode).
 *
 * Reuses or creates the user's Stripe customer, guards against a duplicate active
 * subscription (change plans via the portal instead), and stamps userId+tier into
 * both the session and the SUBSCRIPTION metadata so the webhook lifecycle events
 * can sync without a lookup.
 */

import type Stripe from "stripe";

import { DuplicateSubscriptionError, BillingError } from "./errors";
import type { BillingStore } from "./store";
import { priceIdForTier, type Tier, type TierPriceIds } from "./tiers";

export interface CheckoutDeps {
  readonly stripe: Stripe;
  readonly store: BillingStore;
}

export interface CheckoutParams {
  readonly userId: string;
  readonly email?: string | null;
  /** The paid tier being purchased. */
  readonly tier: Tier;
  readonly prices: TierPriceIds;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CheckoutSession {
  readonly sessionId: string;
  readonly url: string;
}

/**
 * NEVER hold the per-user lock across a Stripe call.
 *
 * `withUserLock` is a `pg_advisory_xact_lock` inside an OPEN DB TRANSACTION
 * (store.drizzle.ts). The original shape ran the whole guard → customer-create →
 * session-create flow inside it, so one request pinned a pooled connection and a
 * transaction across TWO network round trips to Stripe. On a serverless function
 * with a bounded budget that is a hang: the platform kills the invocation, and
 * because the client uses `httpBatchStreamLink` (HTTP 200 is committed BEFORE the
 * procedures resolve) the stream is cut with no error frame — `onError` never
 * fires, `isPending` never clears, and the Subscribe button reads "Starting…"
 * forever. It also leaves no lock residue to find afterwards, because the dead
 * connection rolls the transaction back.
 *
 * So the lock now covers only what it must: the read-modify-write of the
 * subscription row. Stripe is called with nothing held.
 */
export async function createCheckoutSession(
  deps: CheckoutDeps,
  params: CheckoutParams,
): Promise<CheckoutSession> {
  const priceId = priceIdForTier(params.tier, params.prices);
  if (!priceId) {
    throw new BillingError(`No Stripe price configured for tier "${params.tier}"`, "UNKNOWN_TIER");
  }

  // Phase 1 — DB only, under the lock: read committed state and run the
  // duplicate-active guard. An active/trialing paid subscription must be changed
  // through the customer portal, never by opening a second checkout.
  const existingCustomerId = await deps.store.withUserLock(params.userId, async (locked) => {
    const existing = await locked.getByUserId(params.userId);
    if (
      existing &&
      existing.tier !== "free" &&
      (existing.status === "active" || existing.status === "trialing")
    ) {
      throw new DuplicateSubscriptionError(
        `User "${params.userId}" already has an active subscription (${existing.tier})`,
      );
    }
    return existing?.stripeCustomerId ?? null;
  });

  // Phase 2 — Stripe, with NO lock and NO transaction held.
  const customerId = existingCustomerId ?? (await resolveCustomerId(deps, params));

  return createSessionFor(deps, params, priceId, customerId);
}

/**
 * Create the user's Stripe customer and persist the id, without ever holding the
 * lock across the API call.
 *
 * Dropping the lock reopens the check-then-act window the lock used to close: two
 * concurrent first-time checkouts (double-submit, two tabs) both read "no
 * customer". Two mechanisms close it again, neither of which blocks on a network
 * call while holding a transaction:
 *
 *  1. A per-user **idempotency key** — Stripe replays the first response for a
 *     repeated key, so concurrent creates return the SAME customer rather than
 *     two. (Keys age out after 24h, by which point the id is persisted and this
 *     path no longer runs.)
 *  2. A **re-read inside the lock** before persisting, so if a concurrent call
 *     already committed a customer id, that one wins and is returned.
 */
async function resolveCustomerId(deps: CheckoutDeps, params: CheckoutParams): Promise<string> {
  const customer = await deps.stripe.customers.create(
    {
      ...(params.email ? { email: params.email } : {}),
      metadata: { userId: params.userId },
    },
    { idempotencyKey: `billing:customer:${params.userId}` },
  );

  // Persist so the webhook can map customer -> user even if the
  // subscription.created event lands first.
  return deps.store.withUserLock(params.userId, async (locked) => {
    const fresh = await locked.getByUserId(params.userId);
    if (fresh?.stripeCustomerId) return fresh.stripeCustomerId;
    await locked.upsertByUserId(params.userId, { stripeCustomerId: customer.id });
    return customer.id;
  });
}

/** Create the Stripe Checkout Session once a customer id is resolved. */
async function createSessionFor(
  deps: CheckoutDeps,
  params: CheckoutParams,
  priceId: string,
  customerId: string,
): Promise<CheckoutSession> {
  const session = await deps.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: params.userId,
    // subscription_data.metadata rides on the Subscription object, so the
    // customer.subscription.* events carry userId+tier for sync (session
    // metadata alone does not reach those events).
    subscription_data: { metadata: { userId: params.userId, tier: params.tier } },
    metadata: { userId: params.userId, tier: params.tier },
    // Charge in USD but let Stripe present/settle the buyer's local currency
    // (adaptive_pricing) — avoids per-currency price ids and card-not-supported
    // errors for a Brazil-based seller going global.
    currency: "usd",
    adaptive_pricing: { enabled: true },
    allow_promotion_codes: true,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  if (!session.url) {
    throw new BillingError("Stripe returned a checkout session without a url", "NO_CHECKOUT_URL");
  }
  return { sessionId: session.id, url: session.url };
}
