CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_stripe_customer_id" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS (billing) — mirroring 0055_code_islands.sql's brand-new-table idiom.
--
-- IMPORTANT caveat (same as documents/code_islands): Drizzle connects as the
-- Postgres superuser and the web webhook uses the owner db connection — both
-- BYPASS RLS. These policies are DEFENSE-IN-DEPTH ONLY; the primary wall is the
-- app-boundary scoping (every billing procedure filters on ctx.user.id; the
-- webhook is Stripe-signature-authed).
--
-- subscriptions — direct user_id (no importer join), owner-readable.
-- stripe_webhook_events — infra dedupe table, NO user should ever read/write it
-- via the Supabase API, so BOTH anon and authenticated are denied.
-- ---------------------------------------------------------------------------
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_subscriptions_anon" ON "subscriptions"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "subscriptions_owner_authenticated" ON "subscriptions"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());--> statement-breakpoint

ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_stripe_webhook_events_anon" ON "stripe_webhook_events"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "deny_all_stripe_webhook_events_authenticated" ON "stripe_webhook_events"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);