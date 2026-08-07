/**
 * @polytoken/billing — Stripe subscription billing for polytoken.
 *
 * Framework-agnostic, dependency-injected (a `stripe` client + a `BillingStore`),
 * so the checkout/webhook/portal logic is unit-tested against an in-memory fake.
 * The drizzle-backed store lives at `@polytoken/billing/store-drizzle`.
 *
 * polytoken is subscription-only (Pro / Power tiers) — no credit packs.
 */

// Tiers
export type { Tier, TierPriceIds } from "./tiers";
export { PAID_TIERS, asKnownTier, asPaidTier, tierFromPriceId, priceIdForTier } from "./tiers";

// Entitlements (per-tier allowances)
export type { TierEntitlements } from "./entitlements";
export { ENTITLEMENTS, entitlementsFor } from "./entitlements";

// Errors
export {
  BillingError,
  DuplicateSubscriptionError,
  WebhookProcessingError,
  BillingNotConfiguredError,
} from "./errors";

// Store port + shapes
export type {
  BillingStore,
  BillingSubscription,
  BillingSubscriptionPatch,
  WebhookResult,
} from "./store";

// Stripe client factory
export { createStripeClient } from "./stripe-client";
export type { StripeClientOptions } from "./stripe-client";

// Checkout
export { createCheckoutSession } from "./checkout";
export type { CheckoutDeps, CheckoutParams, CheckoutSession } from "./checkout";

// Webhook
export { handleStripeEvent, syncSubscription } from "./webhook";
export type { WebhookDeps } from "./webhook";

// Verify-session fallback (webhook-lag recovery on /billing/success)
export { verifySession } from "./verify";
export type { VerifyDeps, VerifyResult } from "./verify";

// Portal
export { createPortalSession } from "./portal";
export type { PortalDeps, PortalParams } from "./portal";
