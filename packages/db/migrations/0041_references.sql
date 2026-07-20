CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_references_user_id" ON "references" USING btree ("user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner-scoping (999.35 — References), copying 0040_documents.sql's
-- brand-new-table idiom verbatim: the table is created HERE, so there is no
-- pre-existing deny-all authenticated policy to drop — RLS is enabled and the
-- owner-authenticated policy is created directly. anon stays fully denied per
-- the 0001_rls_deny_all.sql idiom.
--
-- IMPORTANT — same caveat as 0034/0035/0040: Drizzle connects as the Postgres
-- superuser (packages/db/src/client.ts) and FastAPI connects with service_role
-- — both bypass RLS entirely. These policies are DEFENSE-IN-DEPTH ONLY; the
-- PRIMARY enforcement wall is the app-boundary ownership sweep
-- (assertReferenceOwnership, ownership.ts). See .planning/PROJECT.md Key
-- Decisions ("v1.7 Phase 44 (TENA-04)").
--
-- "references" is a reserved word in PostgreSQL — quoted everywhere here.
-- references — direct user_id (no importer join), same shape as documents /
-- forwarding_addresses / chat_conversations.
-- ---------------------------------------------------------------------------
ALTER TABLE "references" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_references_anon" ON "references"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "references_owner_authenticated" ON "references"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
