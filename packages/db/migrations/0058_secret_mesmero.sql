CREATE TABLE "canvas_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"name" text DEFAULT 'Untitled recipe' NOT NULL,
	"node_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edge_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_recipes" ADD CONSTRAINT "canvas_recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_recipes" ADD CONSTRAINT "canvas_recipes_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_recipes_conversation_id" ON "canvas_recipes" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_recipes_user_id" ON "canvas_recipes" USING btree ("user_id");--> statement-breakpoint
-- Brand-new-table RLS idiom (hand-appended; drizzle-kit never emits policies),
-- mirroring 0055_code_islands.sql / 0044_spreadsheets / 0040_documents. The app
-- boundary (assertCanvasRecipeOwnership) is the primary wall; this is the
-- defense-in-depth parity every direct-user_id table in the tree carries.
ALTER TABLE "canvas_recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_canvas_recipes_anon" ON "canvas_recipes"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "canvas_recipes_owner_authenticated" ON "canvas_recipes"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());