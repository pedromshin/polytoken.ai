CREATE TYPE "public"."share_permission" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."shared_resource_type" AS ENUM('document', 'entity', 'file', 'conversation');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text DEFAULT 'Untitled workspace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_members_workspace_user" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "resource_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "shared_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"workspace_id" uuid,
	"target_user_id" uuid,
	"permission" "share_permission" DEFAULT 'view' NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workspaces_owner_user_id" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_workspace_id" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user_id" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_resource_shares_resource" ON "resource_shares" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_resource_shares_target_user" ON "resource_shares" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_resource_shares_workspace" ON "resource_shares" USING btree ("workspace_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- resource_shares grantee exclusivity (W5): EXACTLY ONE of workspace_id /
-- target_user_id is set — a share targets a whole workspace OR a single user,
-- never both, never neither. Not expressible in the Drizzle table shape, so it
-- lives here only (no residual `generate` diff — the snapshot has no check).
-- ---------------------------------------------------------------------------
ALTER TABLE "resource_shares"
  ADD CONSTRAINT "ck_resource_shares_one_grantee"
  CHECK (num_nonnulls("workspace_id", "target_user_id") = 1);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS owner/member-scoping (W5), mirroring 0040_documents.sql's brand-new-table
-- idiom: RLS enabled + owner/member PERMISSIVE policy created directly (these
-- tables are created HERE, so there is no pre-existing deny-all-authenticated
-- policy to DROP as in 0034). anon stays fully denied per 0001_rls_deny_all.
--
-- SAME caveat as 0034/0040: Drizzle connects as the Postgres superuser and
-- FastAPI as service_role — BOTH bypass RLS. These policies are
-- DEFENSE-IN-DEPTH ONLY; the PRIMARY wall is the app boundary (assertCanAccess
-- + assertWorkspaceRole in access-control.ts, and the workspaces router's
-- server-side RBAC). See .planning/PROJECT.md ("v1.7 Phase 44 (TENA-04)").
-- ---------------------------------------------------------------------------

-- workspaces — visible to its owner and its members; only the owner may write.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_workspaces_anon" ON "workspaces"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "workspaces_member_authenticated" ON "workspaces"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM "workspace_members" m
      WHERE m.workspace_id = "workspaces".id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (owner_user_id = auth.uid());
--> statement-breakpoint

-- workspace_members — a member sees their own row(s); a workspace owner sees all
-- membership rows for their workspace. Membership MUTATION authority (add /
-- change-role / remove by owner or admin) is enforced at the app boundary
-- (assertWorkspaceRole), not here — the app connects as a role that bypasses RLS.
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_workspace_members_anon" ON "workspace_members"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "workspace_members_scoped_authenticated" ON "workspace_members"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM "workspaces" w
      WHERE w.id = "workspace_members".workspace_id
        AND w.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "workspaces" w
      WHERE w.id = "workspace_members".workspace_id
        AND w.owner_user_id = auth.uid()
    )
  );
--> statement-breakpoint

-- resource_shares — visible to the grantor, the direct target user, and members
-- of the target workspace; only the grantor may write (granted_by = auth.uid()).
ALTER TABLE "resource_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deny_all_resource_shares_anon" ON "resource_shares"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "resource_shares_scoped_authenticated" ON "resource_shares"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    granted_by = auth.uid()
    OR target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM "workspace_members" m
      WHERE m.workspace_id = "resource_shares".workspace_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (granted_by = auth.uid());
