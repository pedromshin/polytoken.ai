-- ---------------------------------------------------------------------------
-- Phase 22 — Chat Spine: chat_conversations / chat_runs / chat_messages /
-- chat_run_events / chat_cost_ledger (CHAT-01, CHAT-04, STREAM-03, SEAM-03).
--
-- FOUND-1: chat_messages.parts is the canonical typed-parts store (D-18).
-- D-16:    chat_messages sibling_group_id/version/is_active model the
--          regenerate-as-sibling-versions turn tree.
-- SEAM-03/D-27: chat_runs + append-only chat_run_events model the run/event
--          abstraction (one agent/one run per turn today).
-- FOUND-3/D-20: chat_cost_ledger is the general budget ledger; D-14 —
--          conversation_id is ON DELETE SET NULL so ledger rows survive a
--          hard conversation delete (T-22-04 mitigation).
-- RLS:     RESTRICTIVE deny-all for anon + authenticated on all five tables
--          (mirrors 0020_knowledge_node_edges_rls.sql / 0022_right_firedrake.sql
--          — T-22-01/T-22-02 mitigation). service_role / postgres (the
--          tRPC + Python backends) bypass RLS by design.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"importer_id" uuid,
	"title" text DEFAULT 'Untitled conversation' NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "chat_runs_status_check" CHECK (status IN ('running', 'completed', 'stopped', 'failed', 'cost_capped', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"turn_index" integer NOT NULL,
	"sibling_group_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK (role IN ('user', 'assistant', 'system')),
	CONSTRAINT "chat_messages_status_check" CHECK (status IN ('streaming', 'completed', 'stopped', 'failed', 'cost_capped', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_run_events_type_check" CHECK (type IN ('started', 'text_delta_checkpoint', 'tool_call', 'tool_result', 'usage', 'completed', 'stopped', 'failed', 'cost_capped', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"run_id" uuid,
	"importer_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"execution_locus" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_cost_ledger_execution_locus_check" CHECK (execution_locus IN ('server', 'browser'))
);
--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run_events" ADD CONSTRAINT "chat_run_events_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_cost_ledger" ADD CONSTRAINT "chat_cost_ledger_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_conversations_importer_updated_at" ON "chat_conversations" USING btree ("importer_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_runs_conversation_id" ON "chat_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_turn" ON "chat_messages" USING btree ("conversation_id","turn_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_messages_sibling_group_id" ON "chat_messages" USING btree ("sibling_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_run_events_run_seq" ON "chat_run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_run_events_run_id" ON "chat_run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_cost_ledger_importer_created_at" ON "chat_cost_ledger" USING btree ("importer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chat_cost_ledger_conversation_id" ON "chat_cost_ledger" USING btree ("conversation_id");--> statement-breakpoint
-- RLS deny-all baseline for all five chat tables (mirrors 0020/0022 pattern) --
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_conversations_anon" ON "chat_conversations";--> statement-breakpoint
CREATE POLICY "deny_all_chat_conversations_anon" ON "chat_conversations"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_conversations_authenticated" ON "chat_conversations";--> statement-breakpoint
CREATE POLICY "deny_all_chat_conversations_authenticated" ON "chat_conversations"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "chat_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_runs_anon" ON "chat_runs";--> statement-breakpoint
CREATE POLICY "deny_all_chat_runs_anon" ON "chat_runs"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_runs_authenticated" ON "chat_runs";--> statement-breakpoint
CREATE POLICY "deny_all_chat_runs_authenticated" ON "chat_runs"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_messages_anon" ON "chat_messages";--> statement-breakpoint
CREATE POLICY "deny_all_chat_messages_anon" ON "chat_messages"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_messages_authenticated" ON "chat_messages";--> statement-breakpoint
CREATE POLICY "deny_all_chat_messages_authenticated" ON "chat_messages"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "chat_run_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_run_events_anon" ON "chat_run_events";--> statement-breakpoint
CREATE POLICY "deny_all_chat_run_events_anon" ON "chat_run_events"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_run_events_authenticated" ON "chat_run_events";--> statement-breakpoint
CREATE POLICY "deny_all_chat_run_events_authenticated" ON "chat_run_events"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);--> statement-breakpoint
ALTER TABLE "chat_cost_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_cost_ledger_anon" ON "chat_cost_ledger";--> statement-breakpoint
CREATE POLICY "deny_all_chat_cost_ledger_anon" ON "chat_cost_ledger"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_cost_ledger_authenticated" ON "chat_cost_ledger";--> statement-breakpoint
CREATE POLICY "deny_all_chat_cost_ledger_authenticated" ON "chat_cost_ledger"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
