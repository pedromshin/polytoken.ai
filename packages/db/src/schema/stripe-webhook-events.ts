/**
 * `stripe_webhook_events` — webhook idempotency ledger (billing).
 *
 * The Stripe event id is the natural PK: the webhook records an event before
 * processing and marks `processed_at` after, so a duplicate delivery (Stripe
 * retries aggressively) is a cheap no-op. NOT user-scoped — it is an
 * infrastructure dedupe table only the trusted server (the signature-authed
 * webhook route, over the owner db connection) ever touches. RLS denies all
 * Supabase-API roles (anon + authenticated) as defense-in-depth.
 */

import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const StripeWebhookEvents = pgTable("stripe_webhook_events", {
  // The Stripe event id (evt_…) — natural primary key for idempotent dedupe.
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  // The event's data.object, stored whole for audit/replay. Never addressed per-field.
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  // Null while in-flight; stamped once the handler completes (the idempotency gate).
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StripeWebhookEventRow = typeof StripeWebhookEvents.$inferSelect;
export type InsertStripeWebhookEvent = typeof StripeWebhookEvents.$inferInsert;
