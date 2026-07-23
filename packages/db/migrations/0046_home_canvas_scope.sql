-- ---------------------------------------------------------------------------
-- HM-01 — Pinned home board: a `scope` discriminator on chat_canvas_layouts.
--
-- ONE column/discriminator, not a new system (FEATURE-CATALOG §7). A layout row
-- is EITHER conversation-scoped (the /chat canvas, conversation_id NOT NULL) OR
-- home-scoped (the pinned board at `/`, user_id NOT NULL + scope='home'). The
-- CHECK enforces exactly one shape; existing conversation rows already satisfy
-- the first branch, so NO backfill is needed. A partial unique index on user_id
-- WHERE scope='home' gives one home board per user (the saveHomeCanvasLayout
-- upsert target), mirroring the conversation_id unique index.
--
-- RLS owner-scoping for home rows (mirrors 0040_documents.sql). The original
-- 0024 baseline denied ALL authenticated access (conversation rows are reached
-- only by the superuser-role backend). We replace the RESTRICTIVE authenticated
-- deny-all with a PERMISSIVE owner policy keyed on user_id = auth.uid(): home
-- rows become owner-reachable, while conversation rows (user_id NULL) stay
-- denied to authenticated exactly as before (NULL = auth.uid() is never true).
-- anon stays fully denied. DEFENSE-IN-DEPTH ONLY — Drizzle connects as the
-- Postgres superuser and bypasses RLS; the primary wall is the app-boundary
-- user_id filter in getHomeCanvasLayout / saveHomeCanvasLayout.
-- ---------------------------------------------------------------------------
ALTER TABLE "chat_canvas_layouts" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_canvas_layouts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_canvas_layouts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "chat_canvas_layouts" ADD CONSTRAINT "chat_canvas_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_canvas_layouts_home_user" ON "chat_canvas_layouts" USING btree ("user_id") WHERE "chat_canvas_layouts"."scope" = 'home';--> statement-breakpoint
ALTER TABLE "chat_canvas_layouts" ADD CONSTRAINT "chat_canvas_layouts_scope_discriminator" CHECK ((("chat_canvas_layouts"."conversation_id" IS NOT NULL)::int + ("chat_canvas_layouts"."user_id" IS NOT NULL)::int = 1) AND (("chat_canvas_layouts"."scope" IS NULL) = ("chat_canvas_layouts"."conversation_id" IS NOT NULL)) AND ("chat_canvas_layouts"."scope" IS NULL OR "chat_canvas_layouts"."scope" = 'home'));--> statement-breakpoint
-- RLS: home rows owner-scoped (mirrors 0040_documents.sql); conversation rows
-- + anon stay denied to authenticated as in the 0024 baseline. --
DROP POLICY IF EXISTS "deny_all_chat_canvas_layouts_authenticated" ON "chat_canvas_layouts";--> statement-breakpoint
CREATE POLICY "chat_canvas_layouts_home_owner_authenticated" ON "chat_canvas_layouts"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ("user_id" = auth.uid())
  WITH CHECK ("user_id" = auth.uid());