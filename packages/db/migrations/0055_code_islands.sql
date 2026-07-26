CREATE TABLE "code_islands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"code" text NOT NULL,
	"input_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_islands" ADD CONSTRAINT "code_islands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_code_islands_user_id" ON "code_islands" USING btree ("user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner-scoping (Phase 76 — Bespoke apps / INV-8/INV-9), mirroring
-- 0040_documents.sql's brand-new-table idiom. `code_islands` is created HERE, so
-- RLS is enabled and the owner-authenticated policy is created directly (no
-- pre-existing deny-all authenticated policy to drop); anon stays fully denied
-- per the 0001_rls_deny_all.sql idiom.
--
-- IMPORTANT — same caveat as documents/spreadsheets: Drizzle connects as the
-- Postgres superuser and FastAPI connects with service_role — both bypass RLS
-- entirely. These policies are DEFENSE-IN-DEPTH ONLY; the PRIMARY enforcement
-- wall is the app-boundary ownership sweep (assertCodeIslandOwnership,
-- ownership.ts).
--
-- code_islands — direct user_id (no importer join), same shape as
-- documents / spreadsheets.
-- ---------------------------------------------------------------------------
ALTER TABLE "code_islands" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_code_islands_anon" ON "code_islands"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "code_islands_owner_authenticated" ON "code_islands"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
