CREATE TABLE "canvas_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"edge_key" text NOT NULL,
	"source_key" text NOT NULL,
	"target_key" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_canvas_edges_canvas_edge_key" UNIQUE("canvas_id","edge_key")
);
--> statement-breakpoint
CREATE TABLE "canvas_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"type" text NOT NULL,
	"position" jsonb NOT NULL,
	"width" real,
	"height" real,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "uq_canvas_nodes_canvas_node_key" UNIQUE("canvas_id","node_key")
);
--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" text NOT NULL,
	"name" text DEFAULT 'Untitled canvas' NOT NULL,
	"viewport" jsonb,
	"shared_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"node_registry_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_edges_canvas_id" ON "canvas_edges" USING btree ("canvas_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_nodes_canvas_id" ON "canvas_nodes" USING btree ("canvas_id");--> statement-breakpoint
CREATE INDEX "idx_canvases_workspace_id" ON "canvases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_canvases_owner_user_id" ON "canvases" USING btree ("owner_user_id");--> statement-breakpoint

-- ===========================================================================
-- Track 3b — hand-appended DDL (partial-unique indexes + kind discriminator
-- CHECK + RLS). NOT expressible in / deliberately kept out of the Drizzle table
-- shape (literal predicates + defense-in-depth policies), so they live here only
-- — no residual `generate` diff (mirrors the 0047 CHECK convention).
--
-- ⚠️ UNPROVEN-IN-CONTAINER: the partial-unique indexes, the CHECK, and the RLS
-- block below CANNOT be verified in the build container (no pgvector to replay
-- 0000–0050 from scratch; no Supabase `auth` schema / `auth.uid()`). They are
-- written per 20-track3-design (D9, lines 253–289) and are TRACK-2-CI-GATED:
-- apply-from-scratch + real-Postgres tenant-isolation must go green before P7
-- applies 0052 to staging/prod. See 20-track3-design B1 + the Landmine audit.
-- ===========================================================================

-- Two board identities as two `kind`s of ONE first-class row — the successor to
-- the 0046 `scope='home'` discriminator on chat_canvas_layouts. Partial-unique:
--   one conversation canvas per conversation (Postgres treats NULLs as distinct,
--   but the explicit partial predicate documents intent and excludes home rows);
--   one home board per user (mirrors idx_chat_canvas_layouts_home_user).
CREATE UNIQUE INDEX "idx_canvases_conversation_id" ON "canvases" USING btree ("conversation_id") WHERE "canvases"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_canvases_home_owner" ON "canvases" USING btree ("owner_user_id") WHERE "canvases"."kind" = 'home';--> statement-breakpoint

-- Kind discriminator — a row is EITHER a conversation canvas (conversation_id
-- NOT NULL) OR a home board (conversation_id NULL); never a hybrid. Successor to
-- the 0046 scope-discriminator CHECK. (Also constrains `kind` to the two values:
-- any other value satisfies neither branch.)
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_kind_discriminator" CHECK (("canvases"."kind" = 'conversation' AND "canvases"."conversation_id" IS NOT NULL) OR ("canvases"."kind" = 'home' AND "canvases"."conversation_id" IS NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS (Track 3b) — DEFENSE-IN-DEPTH ONLY. Drizzle connects as the Postgres
-- superuser and FastAPI as service_role — BOTH bypass RLS; the PRIMARY wall is
-- the app boundary (assertCanvasOwnership + the tRPC procedures). anon stays
-- fully denied per 0001_rls_deny_all. Brand-new-table idiom (mirrors 0047):
-- these tables are created HERE, so there is no pre-existing deny-all policy to
-- DROP; RLS is enabled and the scoped policy created directly.
-- ---------------------------------------------------------------------------

-- canvases — visible to its owner and its workspace members; only the owner may
-- write (mirrors 0047 workspaces_member_authenticated).
ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_canvases_anon" ON "canvases"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "canvases_member_authenticated" ON "canvases"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM "workspace_members" m
      WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (owner_user_id = auth.uid());--> statement-breakpoint

-- canvas_nodes — no denormalized workspace_id; scope through the parent canvas
-- via nested EXISTS. Readable by the parent canvas's owner or a workspace
-- member; writable only when the parent canvas is owned by the actor.
ALTER TABLE "canvas_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_canvas_nodes_anon" ON "canvas_nodes"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "canvas_nodes_via_canvas_authenticated" ON "canvas_nodes"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "canvases" c
      WHERE c.id = "canvas_nodes".canvas_id
        AND (
          c.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM "workspace_members" m
            WHERE m.workspace_id = c.workspace_id AND m.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "canvases" c
      WHERE c.id = "canvas_nodes".canvas_id AND c.owner_user_id = auth.uid()
    )
  );--> statement-breakpoint

-- canvas_edges — same nested-EXISTS scoping through the parent canvas.
ALTER TABLE "canvas_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deny_all_canvas_edges_anon" ON "canvas_edges"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "canvas_edges_via_canvas_authenticated" ON "canvas_edges"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "canvases" c
      WHERE c.id = "canvas_edges".canvas_id
        AND (
          c.owner_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM "workspace_members" m
            WHERE m.workspace_id = c.workspace_id AND m.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "canvases" c
      WHERE c.id = "canvas_edges".canvas_id AND c.owner_user_id = auth.uid()
    )
  );