/**
 * Drizzle-backed BillingStore — the production adapter over the `subscriptions`
 * and `stripe_webhook_events` tables. Kept in its own entrypoint
 * (`@polytoken/billing/store-drizzle`) so the pure billing logic + its tests
 * never import a real db.
 *
 * Uses the shared `OwnershipDb` type (the postgres-js drizzle db) so it matches
 * every other @polytoken/db consumer. This db connects as the owner and is
 * trusted server-side (the router scopes each call to ctx.user.id; the webhook
 * is signature-authed) — RLS is defense-in-depth, not the wall.
 */

import { eq, sql } from "drizzle-orm";

import { StripeWebhookEvents, Subscriptions } from "@polytoken/db/schema";
import type { OwnershipDb } from "@polytoken/db/ownership";

import type { BillingStore, BillingSubscription, LockedBillingStore } from "./store";
import { asKnownTier } from "./tiers";

function rowToSubscription(row: typeof Subscriptions.$inferSelect): BillingSubscription {
  return {
    userId: row.userId,
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    tier: asKnownTier(row.tier),
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
  };
}

/**
 * The row operations, built over ANY runner — the pool-backed `db` or a
 * transaction handle.
 *
 * This exists so `withUserLock` can hand its callback a store bound to the
 * transaction's own connection. On Vercel the pool is capped at ONE connection
 * (`packages/db/src/client.ts` `max: 1`); a query issued against the outer `db`
 * from inside an open transaction waits for a second connection that cannot be
 * freed until that transaction commits, which cannot happen until the query
 * returns. Self-deadlock — and it hangs rather than erroring, because
 * postgres-js has no queue timeout.
 */
function rowOps(runner: OwnershipDb): LockedBillingStore {
  return {
    async getByUserId(userId) {
      const rows = await runner
        .select()
        .from(Subscriptions)
        .where(eq(Subscriptions.userId, userId))
        .limit(1);
      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async getByCustomerId(customerId) {
      const rows = await runner
        .select()
        .from(Subscriptions)
        .where(eq(Subscriptions.stripeCustomerId, customerId))
        .limit(1);
      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async upsertByUserId(userId, patch) {
      const now = new Date();
      await runner
        .insert(Subscriptions)
        .values({
          userId,
          stripeCustomerId: patch.stripeCustomerId ?? null,
          stripeSubscriptionId: patch.stripeSubscriptionId ?? null,
          tier: patch.tier ?? "free",
          status: patch.status ?? "inactive",
          currentPeriodEnd: patch.currentPeriodEnd ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: Subscriptions.userId,
          // Only overwrite fields the patch actually provides (undefined = leave
          // as-is), so a later partial update never clobbers a set field.
          set: {
            ...(patch.stripeCustomerId !== undefined
              ? { stripeCustomerId: patch.stripeCustomerId }
              : {}),
            ...(patch.stripeSubscriptionId !== undefined
              ? { stripeSubscriptionId: patch.stripeSubscriptionId }
              : {}),
            ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.currentPeriodEnd !== undefined
              ? { currentPeriodEnd: patch.currentPeriodEnd }
              : {}),
            updatedAt: now,
          },
        });
    },
  };
}

export function createDrizzleBillingStore(db: OwnershipDb): BillingStore {
  return {
    ...rowOps(db),

    async applyOrderedSync(userId, patch, eventAt) {
      // Single conditional upsert: apply the patch ONLY when this event is not
      // older than the row's high-water mark (`last_event_at`), so a stale /
      // out-of-order Stripe event cannot resurrect a canceled subscription.
      // `last_event_at` lives in the DB but NOT in the Drizzle model, so this is
      // a raw parameterized statement. Only patch-provided fields are set on
      // conflict (undefined = leave as-is), matching upsertByUserId's semantics.
      const setFragments = [];
      if (patch.stripeCustomerId !== undefined)
        setFragments.push(sql`stripe_customer_id = ${patch.stripeCustomerId}`);
      if (patch.stripeSubscriptionId !== undefined)
        setFragments.push(sql`stripe_subscription_id = ${patch.stripeSubscriptionId}`);
      if (patch.tier !== undefined) setFragments.push(sql`tier = ${patch.tier}`);
      if (patch.status !== undefined) setFragments.push(sql`status = ${patch.status}`);
      if (patch.currentPeriodEnd !== undefined)
        setFragments.push(sql`current_period_end = ${patch.currentPeriodEnd}`);
      setFragments.push(sql`last_event_at = GREATEST(subscriptions.last_event_at, EXCLUDED.last_event_at)`);
      setFragments.push(sql`updated_at = now()`);

      const result = await db.execute(sql`
        INSERT INTO subscriptions
          (user_id, stripe_customer_id, stripe_subscription_id, tier, status,
           current_period_end, last_event_at, updated_at)
        VALUES
          (${userId}, ${patch.stripeCustomerId ?? null}, ${patch.stripeSubscriptionId ?? null},
           ${patch.tier ?? "free"}, ${patch.status ?? "inactive"}, ${patch.currentPeriodEnd ?? null},
           ${eventAt}, now())
        ON CONFLICT (user_id) DO UPDATE SET ${sql.join(setFragments, sql`, `)}
          WHERE subscriptions.last_event_at IS NULL
             OR subscriptions.last_event_at < EXCLUDED.last_event_at
             OR (subscriptions.last_event_at = EXCLUDED.last_event_at
                 AND NOT (subscriptions.status = 'canceled' AND EXCLUDED.status <> 'canceled'))
        RETURNING user_id
      `);
      // postgres-js returns a RowList (array-like); a returned row means the
      // insert happened or the guarded update won. Empty = skipped as stale.
      const rows = result as unknown as Array<unknown>;
      return rows.length > 0;
    },

    async withUserLock(userId, fn) {
      // Serialize concurrent billing mutations for one user with a
      // transaction-scoped advisory lock (auto-released on commit/rollback, so
      // it survives connection pooling — the whole txn is one connection). The
      // key is stable per user; a second withUserLock for the same user blocks
      // until this txn commits.
      //
      // `fn` is handed a store bound to `tx`, NOT the outer db. That is
      // load-bearing, not stylistic: on Vercel the pool is capped at ONE
      // connection, so a query issued against the outer db here would wait for a
      // second connection that only frees when this transaction commits — which
      // waits on `fn`. Self-deadlock, and it HANGS rather than erroring, because
      // postgres-js has no queue timeout. That was the checkout hang.
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`billing:user:${userId}`}))`);
        return fn(rowOps(tx as unknown as OwnershipDb));
      });
    },

    async wasEventProcessed(eventId) {
      const rows = await db
        .select({ processedAt: StripeWebhookEvents.processedAt })
        .from(StripeWebhookEvents)
        .where(eq(StripeWebhookEvents.id, eventId))
        .limit(1);
      return rows[0]?.processedAt != null;
    },

    async recordEventStart(eventId, eventType, payload) {
      // Atomic claim: ON CONFLICT DO NOTHING + RETURNING. A returned row means
      // THIS call inserted it (won the claim); an empty result means the id was
      // already recorded (concurrent in-flight worker or prior delivery). The
      // unique PK on stripe_webhook_events makes the insert the single point of
      // serialization, so duplicate deliveries can't both win.
      const inserted = await db
        .insert(StripeWebhookEvents)
        .values({
          id: eventId,
          eventType,
          payload: (payload ?? {}) as Record<string, unknown>,
          processedAt: null,
        })
        .onConflictDoNothing()
        .returning({ id: StripeWebhookEvents.id });
      return inserted.length > 0;
    },

    async markEventProcessed(eventId) {
      await db
        .update(StripeWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(StripeWebhookEvents.id, eventId));
    },

    async releaseUnprocessedEvent(eventId) {
      // Delete the claim ONLY while still unprocessed, so a handler crash after
      // winning the claim doesn't permanently swallow the event — Stripe's retry
      // re-claims and re-runs it. Guarded on processed_at so it never races away
      // a concurrently-completing success.
      await db
        .delete(StripeWebhookEvents)
        .where(
          sql`${StripeWebhookEvents.id} = ${eventId} AND ${StripeWebhookEvents.processedAt} IS NULL`,
        );
    },
  };
}
