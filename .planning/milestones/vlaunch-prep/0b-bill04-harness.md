# BILL-04 Verification Harness — Pedro's checkout → portal → cancel loop

READ-ONLY harness. Companion SQL: `0b-bill04-queries.sql` (beside this file, Q0–Q7).
Nothing here was executed against any database or Stripe.

Sources of truth studied (exact schema/logic):

| File | What it contributes |
|---|---|
| `packages/db/migrations/0056_billing.sql` | tables `public.subscriptions`, `public.stripe_webhook_events`, unique `idx_subscriptions_user_id`, RLS |
| `packages/db/migrations/0057_sour_peter_quill.sql` | `subscriptions.last_event_at timestamptz` (the ordering high-water mark) |
| `packages/billing/src/store.drizzle.ts` | `applyOrderedSync` conditional upsert (`last_event_at` GREATEST + stale-skip guard, lines 109–123); `recordEventStart` = `INSERT .. ON CONFLICT DO NOTHING RETURNING` (atomic claim); `releaseUnprocessedEvent` (crash release) |
| `packages/billing/src/webhook.ts` | `HANDLED_EVENTS` (4 types), dedupe order (dupe-check → type-check → claim → handle → mark), `applyCanceled` patch |
| `packages/billing/src/verify.ts` | `/billing/success` fallback rows keyed `verify:{sessionId}`, `event_type='verify.checkout.session'` |
| `packages/billing/src/checkout.ts` | pre-payment customer upsert (row can exist as free/inactive BEFORE payment) |
| `packages/api-client/src/router/billing/index.ts` | `currentSubscription` read shape (absent row → free/inactive); portal creation does NO db write |
| `apps/web/src/app/api/stripe/webhook/route.ts` | signature-auth boundary; 500 → Stripe retry; duplicate → 200 `action:"skipped_duplicate"` |
| `packages/billing/src/entitlements.ts` | `entitlementsFor(tier)` — free = `{dailyIngestEmailCap: 100, monthlyChatTurns: 200}` |

Exact column names used by every query: `subscriptions(id, user_id, stripe_customer_id, stripe_subscription_id, tier, status, current_period_end, created_at, updated_at, last_event_at)`; `stripe_webhook_events(id, event_type, payload, processed_at, created_at)`. `subscriptions.user_id` FKs `auth.users(id)` — the email placeholder resolves through `auth.users.email` (Q0).

---

## 1. What each leg must look like in the DB

### Leg 0 — `createCheckoutSession` clicked (BEFORE paying)
`checkout.ts:68-76` may pre-create the row to persist the Stripe customer:

| column | expected |
|---|---|
| `tier` | `'free'` (insert default) |
| `status` | `'inactive'` (insert default) |
| `stripe_customer_id` | `cus_…` |
| `stripe_subscription_id` | NULL |
| `last_event_at` | NULL (`upsertByUserId` never touches it) |

If Pedro had a prior customer, the row may pre-date the loop — fine either way.

### Leg 1 — Checkout completed (payment succeeds)
Stripe fires, in near-simultaneous order: `customer.subscription.created` (object status `incomplete` or `active`), usually `customer.subscription.updated` (→ `active`), and `checkout.session.completed`. Each goes through `syncSubscription` with `eventAt = to_timestamp(event.created)` → `applyOrderedSync`. If Pedro lands on `/billing/success`, `verifyCheckout` may ALSO fulfil via a `verify:cs_…` ledger row — same upsert keyed by `user_id`, so it converges, never doubles.

End state (assert with **Q2** — all columns `t`):

| column | expected |
|---|---|
| `tier` | `'pro'` |
| `status` | `'active'` (a transient `'incomplete'` between `created` and `updated` is legal for seconds) |
| `stripe_subscription_id` | `sub_…` |
| `stripe_customer_id` | `cus_…` (unchanged) |
| `current_period_end` | ≈ now + 1 billing period, strictly future |
| `last_event_at` | NOT NULL ≈ max(`event.created`) of the leg — **capture this value; it is `:'checkout_hwm'` for Q3** |

Ledger (**Q4**): one row per handled event, ALL `processed_at NOT NULL`; plus at most one `verify:cs_…` row. No `invoice.*`/`payment_intent.*` rows ever (**Q5d**).

### Leg 2 — Portal opened
`createPortalSession` (router lines 252–265) only READS the row and asks Stripe for a URL — **zero DB writes, zero webhook events for merely opening the portal**. `last_event_at` is unchanged here by design. The high-water mark advances at each *state-changing* leg (checkout, plan change, cancel), not at portal open — evidence template records the unchanged value as its own proof line.

### Leg 3 — Cancel (two branches — identify which via Q4's `cancel_at_period_end` column)

**Branch A — Stripe portal default: cancel at period end.** Fires `customer.subscription.updated` with `cancel_at_period_end=true`, object status still `active` → `syncSubscription` keeps `tier='pro'`, `status='active'`, and **advances `last_event_at`**. Assert with **Q3b**. The actual downgrade happens when Stripe fires `customer.subscription.deleted` at period end (then run Q3).

**Branch B — Immediate cancel** (portal configured "cancel immediately", or test-clock advance). Fires `customer.subscription.deleted` with object status `canceled`.

## 2. Cancel leg's expected end state (derived from `webhook.ts` `applyCanceled`, lines 103–126)

The patch is exactly `{ tier: 'free', status: sub.status ?? 'canceled', stripeSubscriptionId: null, currentPeriodEnd: null }` applied via `applyOrderedSync(userId, patch, eventAt)`:

| column | expected value | why |
|---|---|---|
| `tier` | `'free'` | hard-coded in the patch |
| `status` | `'canceled'` | Stripe's `deleted` event carries object status `canceled`; `?? 'canceled'` backstops |
| `stripe_subscription_id` | NULL | patch nulls it → router's `hasSubscription` flips false |
| `current_period_end` | NULL | patch nulls it |
| `stripe_customer_id` | **retained** (`cus_…`) | patch omits it; `applyOrderedSync` only sets provided fields — enables future portal/checkout reuse |
| `last_event_at` | `GREATEST(prev, deleted-event.created)` — strictly > checkout-leg value | high-water mark raise (store.drizzle.ts:106) |

Assert with **Q3** — all columns `t`.

**Entitlement fallback to free:** `billing.currentSubscription` now returns `{ tier: 'free', status: 'canceled', currentPeriodEnd: null, hasSubscription: false }` (it reads the row's literal columns; a fully absent row would read `free`/`inactive` too). Gates then resolve `entitlementsFor('free')` = `{ dailyIngestEmailCap: 100, monthlyChatTurns: 200 }`. Two independent backstops force `free` even on garbage data: `coerceTier()` (store.drizzle.ts:21-23) maps any non-`pro`/`power` string to `free`, and `entitlementsFor` falls back to `ENTITLEMENTS.free`.

**Resurrection guard:** any late/redelivered `customer.subscription.updated` whose `event.created` ≤ the deleted-event's mark is skipped by the conditional upsert (`WHERE subscriptions.last_event_at IS NULL OR last_event_at < EXCLUDED.last_event_at OR (= AND NOT (status='canceled' AND EXCLUDED.status<>'canceled'))`, store.drizzle.ts:118-121) — `tier` stays `free`. Assert with **Q7** twice (immediately + ~10 min later).

## 3. Dedupe proof — how to show each event was processed exactly once

Mechanism chain: `wasEventProcessed` (fast path) → `HANDLED_EVENTS` filter → **`recordEventStart` atomic claim on the `id` PRIMARY KEY** → handler → `markEventProcessed`. A duplicate delivery either hits the fast path or loses the claim; both return `action: "skipped_duplicate"` with HTTP 200 and never touch `subscriptions`.

| Query | Exposes | Expect |
|---|---|---|
| **Q5** | a double-processed event id (two rows for one id) — physically impossible unless the PK is gone, which is exactly why it is THE dedupe proof | 0 rows |
| **Q5b** | per-dashboard-event-id count + processed flag (paste real `evt_…` ids, including any Stripe redelivered) | `db_rows=1`, `processed=t` for every id |
| **Q5c** | stuck claims (crashed handler that never released → silently swallowed event) | 0 rows |
| **Q5d** | unhandled event types leaking into the ledger (they must short-circuit before insert) | 0 rows |

The Stripe-side half of the proof: in Dashboard → Developers → Webhooks → endpoint → an event delivered 2+ times shows BOTH attempts `200`, and the second response body reads `{"received":true,"action":"skipped_duplicate"}` — pair that screenshot/JSON with Q5b's `db_rows=1`.

## 4. Evidence template — fill the minute Pedro finishes clicking

Pre-loop (capture once, before the first click):

```
E0  loop_start (UTC ISO)            : ____________________  ← becomes :'loop_start'
E1  Q0 output (user_id, email)      : ____________________
E2  Q1 output — baseline row (or "0 rows")           : [paste]
E3  BILLING_ENABLED / STRIPE_* env present? (y/n)    : ____
```

Leg 1 — checkout (run within ~1 min of the success page):

```
E4  wall-clock of payment success   : ____________________
E5  Q1 output — post-checkout row                    : [paste]
E6  Q2 output — all t?                               : [paste]
E7  checkout_hwm := Q1.last_event_at : ____________________  ← feeds Q3/Q3b
E8  Q4 output — event ledger so far                  : [paste]
E9  Stripe dashboard evt ids + `created` for the leg :
      evt_____________  checkout.session.completed   created ____
      evt_____________  customer.subscription.created created ____
      evt_____________  customer.subscription.updated created ____ (if fired)
E10 verify row present? (Q4 id LIKE 'verify:cs_%')   : y / n
```

Leg 2 — portal opened:

```
E11 wall-clock portal opened        : ____________________
E12 Q1 output — row unchanged, last_event_at == E7   : [paste]
```

Leg 3 — cancel:

```
E13 wall-clock cancel clicked       : ____________________
E14 branch (Q4 cancel_at_period_end): A (period-end) / B (immediate)
E15 Q3b (branch A) or Q3 (branch B) — all t?         : [paste]
E16 Q1 output — post-cancel row                      : [paste]
E17 Stripe dashboard evt id + created for the cancel event:
      evt_____________  customer.subscription.______  created ____
E18 Q4 full ledger — every processed_at NOT NULL     : [paste]
```

Dedupe + guard closeout (run once, ≥10 min after E13):

```
E19 Q5  output (expect 0 rows)      : [paste]
E20 Q5b output with E9+E17 evt ids  : [paste]
E21 Q5c output (expect 0 rows)      : [paste]
E22 Q5d output (expect 0 rows)      : [paste]
E23 Q6  output (hwm_lag sane)       : [paste]
E24 Q7  output run twice, both free/canceled (branch B) : [paste]
E25 If Stripe shows any redelivery: attempt list screenshot + second
    response body `action` value    : ____________________
E26 UI check: /billing shows Free tier + no manage-portal state? : y / n
```

High-water-mark monotonicity is proven by E7 < E16.last_event_at (strict, branch A and B both), with E12 showing no movement on the no-op leg.

## 5. Caveats the runner must know

- **`payload` is `event.data.object`, not the event envelope** (webhook.ts:153) — `payload->>'created'` is the OBJECT's creation time; the event's `created` (the value written into `last_event_at`) exists only in the Stripe dashboard. Q6 therefore compares against ledger ARRIVAL time with minutes of slack, and E9/E17 capture the exact dashboard values.
- `stripe_webhook_events` has no `user_id` — during Pedro's solo loop the `loop_start` window is sufficient scoping; on a busy DB additionally filter `payload->>'customer' = '<cus_id from E5>'` for subscription events.
- Both tables are RLS-denied to `anon`/`authenticated` (0056 lines 38–50, webhook-events denied to everyone) — run the SQL as the owner role (`POSTGRES_URL_NON_POOLING` identity / Supabase SQL editor), which bypasses RLS.
- A transient `status='incomplete'` snapshot mid-checkout is not a failure; only the settled Q2 state matters.
- If Q2's `tier_is_pro` is `f` with 0 subscription rows: check the webhook endpoint's dashboard delivery log first — 503 means `BILLING_ENABLED`/keys unset in the deployed env, 400 means wrong `STRIPE_WEBHOOK_SECRET`.
