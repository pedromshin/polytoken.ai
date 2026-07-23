CREATE TYPE "public"."file_version_state" AS ENUM('version', 'trashed');--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_path" text NOT NULL,
	"state" "file_version_state" NOT NULL,
	"version_key" text NOT NULL,
	"is_folder" boolean DEFAULT false NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_file_versions_user_id" ON "file_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_file_versions_user_object" ON "file_versions" USING btree ("user_id","object_path");--> statement-breakpoint
CREATE INDEX "idx_file_versions_user_state" ON "file_versions" USING btree ("user_id","state");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner-scoping (DR-02 — file versioning + trash / INV-8/INV-9), mirroring
-- 0040_documents.sql's brand-new-table idiom. `file_versions` is created HERE,
-- so RLS is enabled and the owner-authenticated policy is created directly;
-- there is no pre-existing deny-all authenticated policy to drop. anon stays
-- fully denied per the 0001_rls_deny_all.sql idiom.
--
-- IMPORTANT — same caveat as 0040: Drizzle connects as the Postgres superuser
-- (packages/db/src/client.ts) and FastAPI connects with service_role — both
-- bypass RLS entirely. These policies are DEFENSE-IN-DEPTH ONLY; the PRIMARY
-- enforcement wall is the app-boundary `where user_id = ctx.user.id` filter in
-- every files-router procedure (fail-closed to NOT_FOUND). See
-- .planning/PROJECT.md Key Decisions ("v1.7 Phase 44 (TENA-04)").
--
-- file_versions — direct user_id (no importer join), same shape as
-- documents / spreadsheets.
-- ---------------------------------------------------------------------------
ALTER TABLE "file_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_file_versions_anon" ON "file_versions"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "file_versions_owner_authenticated" ON "file_versions"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());