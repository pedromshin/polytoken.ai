# @polytoken/billing

Stripe **subscription** billing for polytoken (Pro / Power tiers — no credit packs).

Framework-agnostic and dependency-injected: every function takes a `stripe` client
and a `BillingStore` (a small persistence port), so the checkout / webhook / portal
logic is unit-tested against an in-memory fake with no db. The drizzle-backed store
is a separate entrypoint so the pure logic never imports a real database.

## Layout

| File | What |
|------|------|
| `tiers.ts` | `Tier` (`free`/`pro`/`power`) + price-id ↔ tier mapping (prices are env config, injected) |
| `errors.ts` | `BillingError` hierarchy (machine-readable `code`) |
| `store.ts` | `BillingStore` port + `BillingSubscription` shape (the DI seam) |
| `store.drizzle.ts` | `createDrizzleBillingStore(db)` — production adapter over `subscriptions` + `stripe_webhook_events` (import from `@polytoken/billing/store-drizzle`) |
| `stripe-client.ts` | `createStripeClient(secretKey)` factory |
| `checkout.ts` | `createCheckoutSession` — subscription-mode Checkout, customer reuse, duplicate-active guard |
| `webhook.ts` | `handleStripeEvent` — idempotent lifecycle sync (checkout / subscription created·updated·deleted) |
| `portal.ts` | `createPortalSession` — Stripe Customer Portal |

## Wiring in polytoken

- **tRPC** `billing` router (`packages/api-client/src/router/billing`): `currentSubscription`,
  `createCheckoutSession`, `createPortalSession` — owner-scoped, gated on `BILLING_ENABLED`.
- **Webhook** route (`apps/web/src/app/api/stripe/webhook/route.ts`): raw body + `stripe-signature`
  → `constructEventAsync` → `handleStripeEvent`.
- **DB**: `subscriptions` (one row/user, the entitlement `tier`) + `stripe_webhook_events`
  (idempotency), migration `0056_billing.sql`.

## Config (server-only, all optional)

Billing is inert unless `BILLING_ENABLED=true` **and** these are set (see `apps/web/.env.example`):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_POWER`,
`BILLING_APP_URL`. Never expose a Stripe secret as `NEXT_PUBLIC_*`.

## Notes

- **Merchant of Record:** Stripe makes the seller (the Brazilian LTDA) the merchant of record — it
  does **not** handle cross-border sales-tax/VAT for you (unlike Paddle/Lemon Squeezy). Confirm the
  international-billing + tax treatment with the accountant.
- Charges are in **USD with `adaptive_pricing`** (Stripe presents/settles the buyer's local currency)
  — avoids per-currency price ids + card-not-supported errors for a global-selling seller.
- Not yet built (follow-ups): a `verifySession` redirect-fallback for delayed webhooks; wiring the
  `tier` into the email-listener per-user cost caps (track 09 "tiers map onto the circuit-breaker").
