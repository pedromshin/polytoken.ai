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

import { eq } from "drizzle-orm";

import { StripeWebhookEvents, Subscriptions } from "@polytoken/db/schema";
import type { OwnershipDb } from "@polytoken/db/ownership";

import type { BillingStore, BillingSubscription } from "./store";
import type { Tier } from "./tiers";

function coerceTier(value: string): Tier {
  return value === "pro" || value === "power" ? value : "free";
}

function rowToSubscription(row: typeof Subscriptions.$inferSelect): BillingSubscription {
  return {
    userId: row.userId,
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    tier: coerceTier(row.tier),
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
  };
}

export function createDrizzleBillingStore(db: OwnershipDb): BillingStore {
  return {
    async getByUserId(userId) {
      const rows = await db
        .select()
        .from(Subscriptions)
        .where(eq(Subscriptions.userId, userId))
        .limit(1);
      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async getByCustomerId(customerId) {
      const rows = await db
        .select()
        .from(Subscriptions)
        .where(eq(Subscriptions.stripeCustomerId, customerId))
        .limit(1);
      return rows[0] ? rowToSubscription(rows[0]) : null;
    },

    async upsertByUserId(userId, patch) {
      const now = new Date();
      await db
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

    async wasEventProcessed(eventId) {
      const rows = await db
        .select({ processedAt: StripeWebhookEvents.processedAt })
        .from(StripeWebhookEvents)
        .where(eq(StripeWebhookEvents.id, eventId))
        .limit(1);
      return rows[0]?.processedAt != null;
    },

    async recordEventStart(eventId, eventType, payload) {
      await db
        .insert(StripeWebhookEvents)
        .values({
          id: eventId,
          eventType,
          payload: (payload ?? {}) as Record<string, unknown>,
          processedAt: null,
        })
        .onConflictDoNothing();
    },

    async markEventProcessed(eventId) {
      await db
        .update(StripeWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(StripeWebhookEvents.id, eventId));
    },
  };
}
