-- ============================================================================
-- BILL-04 verification harness — READ-ONLY SQL
-- Target: Postgres (Supabase). Tables from packages/db/migrations/0056_billing.sql
--         + 0057_sour_peter_quill.sql (adds subscriptions.last_event_at).
--
-- ALL queries are SELECT-only. Nothing here mutates state.
--
-- psql usage:
--   \set user_email  '''pedromaschio.shin@gmail.com'''
--   \set loop_start  '''2026-08-07T00:00:00Z'''      -- timestamp just BEFORE Pedro clicks "Upgrade"
-- Supabase SQL editor: manually replace :'user_email' / :'loop_start' literals.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Q0. Resolve the user id from email (subscriptions.user_id FKs auth.users.id)
-- ----------------------------------------------------------------------------
SELECT id AS user_id, email
FROM auth.users
WHERE email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q1. Full subscription row snapshot — run AFTER EACH LEG and paste the output.
--     (Also proves the one-row-per-user invariant: idx_subscriptions_user_id
--      is UNIQUE, so >1 row is impossible; 0 rows = fulfilment never landed.)
-- ----------------------------------------------------------------------------
SELECT now() AS captured_at,
       s.user_id,
       s.tier,
       s.status,
       s.stripe_customer_id,
       s.stripe_subscription_id,
       s.current_period_end,
       s.last_event_at,
       s.created_at,
       s.updated_at
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q2. CHECKOUT-LEG assertion (run once /billing shows Pro, or ~30 s after pay).
--     Every column must read `t`.
-- ----------------------------------------------------------------------------
SELECT (s.tier = 'pro')                              AS tier_is_pro,
       (s.status = 'active')                         AS status_is_active,
       (s.stripe_subscription_id LIKE 'sub_%')       AS subscription_id_set,
       (s.stripe_customer_id LIKE 'cus_%')           AS customer_id_set,
       (s.current_period_end > now())                AS period_end_in_future,
       (s.last_event_at IS NOT NULL)                 AS high_water_mark_set
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q3. CANCEL-LEG assertion — IMMEDIATE-cancel branch
--     (portal configured to cancel now, or after the period lapses on the
--      cancel-at-period-end default). Every column must read `t`.
--     :'checkout_hwm' = the last_event_at captured by Q1 after the checkout leg.
-- ----------------------------------------------------------------------------
SELECT (s.tier = 'free')                             AS tier_downgraded_to_free,
       (s.status = 'canceled')                       AS status_is_canceled,
       (s.stripe_subscription_id IS NULL)            AS subscription_id_cleared,
       (s.stripe_customer_id LIKE 'cus_%')           AS customer_id_retained,
       (s.current_period_end IS NULL)                AS period_end_cleared,
       (s.last_event_at > :'checkout_hwm'::timestamptz) AS high_water_mark_advanced
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q3b. CANCEL-LEG assertion — CANCEL-AT-PERIOD-END branch (Stripe portal
--      default). Immediately after clicking cancel the row must still be a
--      live Pro sub whose high-water mark advanced (the `updated` event with
--      cancel_at_period_end=true was applied). Every column must read `t`.
-- ----------------------------------------------------------------------------
SELECT (s.tier = 'pro')                              AS tier_still_pro_until_period_end,
       (s.status = 'active')                         AS status_still_active,
       (s.stripe_subscription_id LIKE 'sub_%')       AS subscription_id_still_set,
       (s.last_event_at > :'checkout_hwm'::timestamptz) AS high_water_mark_advanced
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q4. Event ledger for the loop window — the status-transition trail.
--     payload is event.data.object (webhook.ts:153 records event.data.object),
--     so payload->>'status' is the OBJECT's status at event time:
--       customer.subscription.created  -> 'incomplete' or 'active'
--       customer.subscription.updated  -> 'active' (cancel leg: + cancel_at_period_end=true)
--       checkout.session.completed     -> 'complete' (session status, not sub)
--       customer.subscription.deleted  -> 'canceled'
--       verify:cs_... (if /billing/success verify fallback fired) -> 'complete'
--     CAUTION: payload->>'created' is the OBJECT's creation time, not the
--     event's `created` — do not use it as the ordering high-water mark.
--     Expect: every row has processed_at NOT NULL.
-- ----------------------------------------------------------------------------
SELECT e.id,
       e.event_type,
       e.created_at                                   AS arrived_at,
       e.processed_at,
       e.payload->>'id'                               AS stripe_object_id,
       e.payload->>'status'                           AS object_status,
       e.payload->>'cancel_at_period_end'             AS cancel_at_period_end
FROM public.stripe_webhook_events e
WHERE e.created_at >= :'loop_start'::timestamptz
ORDER BY e.created_at ASC;


-- ----------------------------------------------------------------------------
-- Q5. DEDUPE PROOF (a): the query that would expose a double-processed event.
--     stripe_webhook_events.id is the PRIMARY KEY, so a redelivered event id
--     physically cannot insert a second row — recordEventStart is
--     INSERT .. ON CONFLICT DO NOTHING RETURNING (store.drizzle.ts:157-167) and
--     a lost claim returns action='skipped_duplicate' WITHOUT running the
--     handler (webhook.ts:153-156). Any row returned here means the dedupe
--     substrate itself is broken (PK dropped / table recreated wrong).
--     EXPECT: 0 rows.
-- ----------------------------------------------------------------------------
SELECT e.id, e.event_type, count(*) AS occurrences
FROM public.stripe_webhook_events e
GROUP BY e.id, e.event_type
HAVING count(*) > 1;


-- ----------------------------------------------------------------------------
-- Q5b. DEDUPE PROOF (b): per-event-id exactly-once check against the Stripe
--      dashboard. For EVERY event id listed in Dashboard > Developers >
--      Webhooks > (endpoint) > event deliveries during the loop — including
--      ids Stripe delivered 2+ times — exactly one row, processed exactly once.
--      Replace the ANY-array with the dashboard's evt_ ids.
--      EXPECT: one row per id, db_rows = 1, processed = t.
-- ----------------------------------------------------------------------------
SELECT e.id,
       count(*)                                       AS db_rows,          -- must be 1
       bool_and(e.processed_at IS NOT NULL)           AS processed         -- must be t
FROM public.stripe_webhook_events e
WHERE e.id = ANY (ARRAY['evt_REPLACE_1', 'evt_REPLACE_2', 'evt_REPLACE_3'])
GROUP BY e.id;


-- ----------------------------------------------------------------------------
-- Q5c. DEDUPE PROOF (c): stuck claims. A claim whose handler crashed is
--      released (deleted) so Stripe's retry re-runs it (webhook.ts:191-197,
--      store.drizzle.ts:177-187); a lingering unprocessed row = a swallowed
--      event. EXPECT: 0 rows.
-- ----------------------------------------------------------------------------
SELECT e.id, e.event_type, e.created_at, now() - e.created_at AS stuck_for
FROM public.stripe_webhook_events e
WHERE e.processed_at IS NULL
  AND e.created_at < now() - interval '5 minutes';


-- ----------------------------------------------------------------------------
-- Q5d. DEDUPE PROOF (d): unhandled event types never enter the ledger.
--      handleStripeEvent returns 'unknown_event_type' BEFORE recordEventStart
--      (webhook.ts:145-147), so invoice.*, payment_intent.*, customer.created
--      etc. must have ZERO rows. The only legal event_type values are the four
--      HANDLED_EVENTS + the verify fallback's synthetic type.
--      EXPECT: 0 rows.
-- ----------------------------------------------------------------------------
SELECT e.id, e.event_type, e.created_at
FROM public.stripe_webhook_events e
WHERE e.event_type NOT IN (
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'verify.checkout.session'
);


-- ----------------------------------------------------------------------------
-- Q6. High-water-mark sanity: last_event_at must not lag far behind the newest
--     handled event's ARRIVAL (arrival time approximates Stripe's event.created
--     within seconds; the exact event.created lives only in the dashboard).
--     A large positive lag AFTER a state-changing leg means an applied event
--     failed to raise the mark. EXPECT: hwm_lag within ~2 minutes, or NULL row
--     fields explained (e.g. only the pre-checkout customer upsert ran).
-- ----------------------------------------------------------------------------
SELECT s.last_event_at,
       le.newest_event_arrival,
       le.newest_event_arrival - s.last_event_at      AS hwm_lag
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
CROSS JOIN LATERAL (
  SELECT max(e.created_at) AS newest_event_arrival
  FROM public.stripe_webhook_events e
  WHERE e.created_at >= :'loop_start'::timestamptz
) le
WHERE u.email = :'user_email';


-- ----------------------------------------------------------------------------
-- Q7. RESURRECTION-GUARD proof (run any time after an immediate cancel, and
--     again ~10 min later): tier must STILL be free even if Stripe redelivered
--     a late customer.subscription.updated — applyOrderedSync's conditional
--     upsert skips any event whose eventAt <= last_event_at, and at a tie a
--     non-canceled status cannot overwrite 'canceled'
--     (store.drizzle.ts:117-121). EXPECT: all t.
-- ----------------------------------------------------------------------------
SELECT (s.tier = 'free')       AS still_free,
       (s.status = 'canceled') AS still_canceled,
       s.last_event_at
FROM public.subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = :'user_email';
