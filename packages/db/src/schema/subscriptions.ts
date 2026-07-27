/**
 * `subscriptions` — a user's Stripe subscription state (billing, greenfield).
 *
 * ## Tenancy (INV-8/INV-9)
 * Like documents / code_islands, this is NOT an importer-descendant — it carries
 * a DIRECT `user_id` referencing auth.users(id), scoped directly. There is
 * exactly ONE row per user (unique user_id), upserted as Stripe events arrive;
 * Stripe is the source of truth and the webhook keeps this row in sync. Owner-
 * scoping RLS (RESTRICTIVE deny-anon + PERMISSIVE owner-authenticated) ships in
 * the same migration, as defense-in-depth behind the app-boundary ownership wall.
 *
 * `tier` is the entitlement the rest of the app reads ('free' | 'pro' | 'power').
 * `status` mirrors the Stripe subscription status. The stripe_* ids let the
 * webhook map a Stripe customer/subscription back to this user.
 */

import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";

export const Subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (INV-8/9) — one row per user (unique below).
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // Stripe identifiers (null until the first checkout creates them).
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),

    // The entitlement tier the app gates features on: 'free' | 'pro' | 'power'.
    tier: text("tier").notNull().default("free"),

    // The Stripe subscription status (active/trialing/past_due/canceled/…), or
    // 'inactive' before any checkout.
    status: text("status").notNull().default("inactive"),

    // When the current paid period ends (for grace/renewal display). Null when free.
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),

    // Event-ordering high-water mark: the Stripe `event.created` (or Checkout
    // Session `created`) of the most recent event applied to this row. The
    // webhook's ordered upsert writes state ONLY when the incoming event is not
    // older than this mark, so a stale/out-of-order `subscription.updated`
    // delivered AFTER `subscription.deleted` cannot resurrect a canceled tier.
    // Nullable/no-default: existing rows read NULL → the first event seeds it.
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Exactly one subscription row per user (the upsert conflict target).
    subscriptionsUserIdIdx: uniqueIndex("idx_subscriptions_user_id").on(t.userId),
    // Webhook lookups map a Stripe customer id back to the owning user.
    subscriptionsStripeCustomerIdIdx: index("idx_subscriptions_stripe_customer_id").on(
      t.stripeCustomerId,
    ),
  }),
);

export type SubscriptionRow = typeof Subscriptions.$inferSelect;
export type InsertSubscription = typeof Subscriptions.$inferInsert;
