CREATE TABLE "spreadsheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'Untitled table' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spreadsheets" ADD CONSTRAINT "spreadsheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_spreadsheets_user_id" ON "spreadsheets" USING btree ("user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner-scoping (FEATURE-CATALOG CV-03 / INV-8/INV-9), mirroring
-- 0040_documents.sql's brand-new-table idiom. `spreadsheets` is created HERE,
-- so RLS is enabled and the owner-authenticated policy is created directly;
-- anon stays fully denied per the 0001_rls_deny_all.sql idiom.
--
-- IMPORTANT — same caveat as documents/desktop_sessions: Drizzle connects as
-- the Postgres superuser (packages/db/src/client.ts) and FastAPI connects with
-- service_role — both bypass RLS entirely. These policies are
-- DEFENSE-IN-DEPTH ONLY; the PRIMARY enforcement wall is the app-boundary
-- ownership sweep (assertSpreadsheetOwnership, ownership.ts).
--
-- spreadsheets — direct user_id (no importer join), same shape as documents /
-- desktop_sessions.
-- ---------------------------------------------------------------------------
ALTER TABLE "spreadsheets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_spreadsheets_anon" ON "spreadsheets"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "spreadsheets_owner_authenticated" ON "spreadsheets"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());