CREATE TYPE "public"."desktop_session_status" AS ENUM('provisioning', 'running', 'hibernated', 'destroyed');--> statement-breakpoint
CREATE TABLE "desktop_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'aws' NOT NULL,
	"region" text NOT NULL,
	"shape" text NOT NULL,
	"label" text,
	"status" "desktop_session_status" DEFAULT 'provisioning' NOT NULL,
	"provider_instance_id" text,
	"gateway_url" text,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"max_lifetime_minutes" integer DEFAULT 480 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attached_at" timestamp with time zone,
	"hibernated_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD CONSTRAINT "desktop_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_desktop_sessions_user_id" ON "desktop_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_desktop_sessions_status" ON "desktop_sessions" USING btree ("status");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner-scoping (E5 Cloud Desktop / INV-8/INV-9 — RFC §6), mirroring
-- 0040_documents.sql's brand-new-table idiom. `desktop_sessions` is created
-- HERE, so RLS is enabled and the owner-authenticated policy is created
-- directly; anon stays fully denied per the 0001_rls_deny_all.sql idiom.
--
-- IMPORTANT — same caveat as documents/references: Drizzle connects as the
-- Postgres superuser and FastAPI as service_role — both bypass RLS. These
-- policies are DEFENSE-IN-DEPTH ONLY; the PRIMARY wall is the app-boundary
-- ownership sweep (assertDesktopSessionOwnership, ownership.ts). One VM = one
-- owner (RFC §6): provider ids / gateway hostnames are DATA on the row, never
-- parsed for authz (INV-11).
-- ---------------------------------------------------------------------------
ALTER TABLE "desktop_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_desktop_sessions_anon" ON "desktop_sessions"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "desktop_sessions_owner_authenticated" ON "desktop_sessions"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
