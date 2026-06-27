CREATE TABLE IF NOT EXISTS "genui_generation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_hash" text NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"outcome" text NOT NULL,
	"spec_validation_passed" boolean NOT NULL,
	"spec_node_count" integer,
	"spec_depth" integer,
	"registry_version" text NOT NULL,
	"latency_ms" integer,
	"importer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "genui_generation_events_outcome_check" CHECK (outcome IN ('ok', 'fallback', 'escalated'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_genui_generation_events_created_at" ON "genui_generation_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_genui_generation_events_importer_id" ON "genui_generation_events" USING btree ("importer_id");