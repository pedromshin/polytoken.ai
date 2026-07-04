-- ---------------------------------------------------------------------------
-- Phase 23 — 2D Canvas: chat_canvas_layouts (CANVAS-02, D-05, D-06, D-10).
--
-- One row per conversation — exact-restore snapshot of nodes/edges/viewport/
-- shared_state. NO genui spec content lives here (D-05) — genui-panel nodes
-- carry only provenance refs; specs rehydrate from chat_messages.
-- RLS:  RESTRICTIVE deny-all for anon + authenticated (mirrors 0023_chat_spine.sql
--       — T-23-03 mitigation). service_role / postgres (the tRPC backend)
--       bypass RLS by design.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "chat_canvas_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"nodes" jsonb DEFAULT '[]' NOT NULL,
	"edges" jsonb DEFAULT '[]' NOT NULL,
	"viewport" jsonb,
	"shared_state" jsonb DEFAULT '{}' NOT NULL,
	"node_registry_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_canvas_layouts" ADD CONSTRAINT "chat_canvas_layouts_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chat_canvas_layouts_conversation_id" ON "chat_canvas_layouts" USING btree ("conversation_id");--> statement-breakpoint
-- RLS deny-all baseline (mirrors 0023_chat_spine.sql) --
ALTER TABLE "chat_canvas_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_canvas_layouts_anon" ON "chat_canvas_layouts";--> statement-breakpoint
CREATE POLICY "deny_all_chat_canvas_layouts_anon" ON "chat_canvas_layouts"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
DROP POLICY IF EXISTS "deny_all_chat_canvas_layouts_authenticated" ON "chat_canvas_layouts";--> statement-breakpoint
CREATE POLICY "deny_all_chat_canvas_layouts_authenticated" ON "chat_canvas_layouts"
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
