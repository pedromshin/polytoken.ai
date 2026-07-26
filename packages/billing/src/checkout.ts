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

export async function createCheckoutSession(
  deps: CheckoutDeps,
  params: CheckoutParams,
): Promise<CheckoutSession> {
  const priceId = priceIdForTier(params.tier, params.prices);
  if (!priceId) {
    throw new BillingError(`No Stripe price configured for tier "${params.tier}"`, "UNKNOWN_TIER");
  }

  const existing = await deps.store.getByUserId(params.userId);

  // Duplicate-active guard: an active/trialing paid subscription must be changed
  // through the customer portal, never by opening a second checkout.
  if (
    existing &&
    existing.tier !== "free" &&
    (existing.status === "active" || existing.status === "trialing")
  ) {
    throw new DuplicateSubscriptionError(
      `User "${params.userId}" already has an active subscription (${existing.tier})`,
    );
  }

  // Reuse or create the Stripe customer, persisting the id so the webhook can map
  // customer -> user even if the subscription.created event lands first.
  let customerId = existing?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await deps.stripe.customers.create({
      ...(params.email ? { email: params.email } : {}),
      metadata: { userId: params.userId },
    });
    customerId = customer.id;
    await deps.store.upsertByUserId(params.userId, { stripeCustomerId: customerId });
  }

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
