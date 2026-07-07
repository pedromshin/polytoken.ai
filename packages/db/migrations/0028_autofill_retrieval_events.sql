-- Custom SQL migration file, put your code below! --
-- ---------------------------------------------------------------------------
-- autofill_retrieval_events — recall/measurement instrumentation (Phase 31-02, RECALL-02)
--
-- One best-effort row per AutofillUseCase.execute run, recording the retrieval
-- outcome: seed hits (few-shot examples), injected alias/identifier context
-- (RECALL-01), and the routing_reason. Human-correction linkage is derived AT
-- QUERY TIME by joining extraction_records.corrected_fields on component_id —
-- this table is never mutated by that join (see retrieval-miss-rate.ts).
--
-- Threat mitigations: T-31-04 (best-effort write never breaks autofill — see
-- AutofillUseCase try/except), T-31-05 (RESTRICTIVE RLS deny-all for anon +
-- authenticated; service-role writer bypasses by design), T-31-06 (all reads/
-- writes parameterized — no string-interpolated SQL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "autofill_retrieval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"importer_id" uuid,
	"entity_type_id" uuid,
	"seed_hits" jsonb,
	"seed_hit_count" integer DEFAULT 0 NOT NULL,
	"injected_entity_instance_id" uuid,
	"injected_alias_count" integer DEFAULT 0 NOT NULL,
	"injected_identifier_count" integer DEFAULT 0 NOT NULL,
	"routing_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_autofill_retrieval_events_component_id" ON "autofill_retrieval_events" USING btree ("component_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_autofill_retrieval_events_importer_id" ON "autofill_retrieval_events" USING btree ("importer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_autofill_retrieval_events_created_at" ON "autofill_retrieval_events" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "autofill_retrieval_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_autofill_retrieval_events_anon" ON "autofill_retrieval_events";
--> statement-breakpoint
CREATE POLICY "deny_all_autofill_retrieval_events_anon" ON "autofill_retrieval_events"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_autofill_retrieval_events_authenticated" ON "autofill_retrieval_events";
--> statement-breakpoint
CREATE POLICY "deny_all_autofill_retrieval_events_authenticated" ON "autofill_retrieval_events"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
