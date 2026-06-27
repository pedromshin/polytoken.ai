-- ---------------------------------------------------------------------------
-- ui_spec_templates — exact-match template store (Phase 14 Wave 1)
--
-- CACHE-01: Persists every successfully-validated generated spec so the
--           flywheel foundation can serve repeat intents from cache.
-- D-10:     v1.1 exact-cache column set; semantic/promotion columns deferred.
-- D-11:     validation_status CHECK enforces only 'validated' specs persist
--           at the DB boundary — second line of defence against cache poisoning
--           (T-14-03). The CHECK is intentionally narrow for v1.1; v1.2 will
--           widen it to include 'candidate'/'promoted'/'invalidated'.
-- D-20:     RESTRICTIVE deny-all RLS for anon + authenticated — closes direct
--           cross-tenant cache read/write via Supabase client (T-14-01/T-14-02).
--           service_role / postgres bypass RLS by design (FastAPI service-role).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ui_spec_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"intent_text" text NOT NULL,
	"data_shape_hash" text NOT NULL,
	"registry_version" text NOT NULL,
	"catalog_id" text DEFAULT 'global' NOT NULL,
	"spec_json" jsonb NOT NULL,
	"validation_status" text DEFAULT 'validated' NOT NULL,
	"spec_node_count" integer,
	"spec_depth" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"importer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_spec_templates_validation_status_check" CHECK (validation_status IN ('validated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ui_spec_templates_cache_key" ON "ui_spec_templates" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ui_spec_templates_importer_catalog" ON "ui_spec_templates" USING btree ("importer_id","catalog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ui_spec_templates_registry_version" ON "ui_spec_templates" USING btree ("registry_version");--> statement-breakpoint
-- RLS deny-all baseline — D-20 (mirrors 0020_knowledge_node_edges_rls.sql pattern)
ALTER TABLE "ui_spec_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_ui_spec_templates_anon" ON "ui_spec_templates";--> statement-breakpoint
CREATE POLICY "deny_all_ui_spec_templates_anon" ON "ui_spec_templates"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_ui_spec_templates_authenticated" ON "ui_spec_templates";--> statement-breakpoint
CREATE POLICY "deny_all_ui_spec_templates_authenticated" ON "ui_spec_templates"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
