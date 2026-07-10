-- Phase 44 (Tenancy) — Plan 04: auth.uid()-based RLS ownership policies.
--
-- IMPORTANT — read before touching this file or the app boundary:
-- Both current app paths BYPASS these policies entirely:
--   - Drizzle connects as the Postgres SUPERUSER via POSTGRES_URL_NON_POOLING
--     (packages/db/src/client.ts:28-36) — RLS never runs for any Drizzle query.
--   - FastAPI connects with SUPABASE_SECRET_KEY / service_role
--     (infrastructure/supabase/client.py) — service_role bypasses RLS by
--     Supabase design.
-- These policies are DEFENSE-IN-DEPTH ONLY. They defend a future PostgREST /
-- non-superuser / anon-key path, not the app's real query path today. The
-- PRIMARY enforcement wall is the app-boundary ownership sweep (Plans 02/03/
-- 05/06/07) that derives scope from the session's user_id, never from
-- client-supplied input. See .planning/PROJECT.md Key Decisions
-- ("v1.7 Phase 44 (TENA-04)") for the recorded architecture decision.
--
-- What this migration does, per user-owned table:
--   - DROP the RESTRICTIVE `deny_all_<table>_authenticated` policy from
--     0001_rls_deny_all.sql (and its later siblings for tables added after
--     0001) so a PERMISSIVE ownership policy can actually grant access — a
--     RESTRICTIVE deny-all always wins regardless of any PERMISSIVE policy.
--   - CREATE a PERMISSIVE `<table>_owner_authenticated` policy scoped to
--     auth.uid() (directly, or transitively through importers.user_id).
--   - Leave the `deny_all_<table>_anon` RESTRICTIVE policies untouched — anon
--     stays fully denied on every one of these tables.
--
-- Threat mitigations: T-44-04-01 (authenticated deny-all -> auth.uid()
-- ownership), T-44-04-02 (entity_types/entity_type_fields WITH CHECK forbids
-- an authenticated session from writing importer_id IS NULL system-default
-- rows; USING still allows read-only visibility of those rows).
--
-- Deviation note (Rule 1 — schema-accuracy fix): knowledge_node_edges has NO
-- importer_id column (confirmed against packages/db/src/schema/
-- knowledge-node-edges.ts) — only source_node_id -> knowledge_nodes.id. Its
-- policy therefore scopes via a join through knowledge_nodes.importer_id
-- rather than a direct importer_id column, unlike every other hard-FK
-- descendant table.

-- ---------------------------------------------------------------------------
-- importers — direct user_id (the tenant anchor)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_importers_authenticated" ON "importers";
--> statement-breakpoint
CREATE POLICY "importers_owner_authenticated" ON "importers"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- chat_conversations — direct user_id (no FK to importers, per schema doc)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_chat_conversations_authenticated" ON "chat_conversations";
--> statement-breakpoint
CREATE POLICY "chat_conversations_owner_authenticated" ON "chat_conversations"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- chat_cost_ledger — direct user_id (no FK to importers, per schema doc)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_chat_cost_ledger_authenticated" ON "chat_cost_ledger";
--> statement-breakpoint
CREATE POLICY "chat_cost_ledger_owner_authenticated" ON "chat_cost_ledger"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- emails — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_emails_authenticated" ON "emails";
--> statement-breakpoint
CREATE POLICY "emails_owner_authenticated" ON "emails"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- email_attachments — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_email_attachments_authenticated" ON "email_attachments";
--> statement-breakpoint
CREATE POLICY "email_attachments_owner_authenticated" ON "email_attachments"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- email_components — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_email_components_authenticated" ON "email_components";
--> statement-breakpoint
CREATE POLICY "email_components_owner_authenticated" ON "email_components"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- extraction_records — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_extraction_records_authenticated" ON "extraction_records";
--> statement-breakpoint
CREATE POLICY "extraction_records_owner_authenticated" ON "extraction_records"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- entity_instances — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_entity_instances_authenticated" ON "entity_instances";
--> statement-breakpoint
CREATE POLICY "entity_instances_owner_authenticated" ON "entity_instances"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sender_profiles — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_sender_profiles_authenticated" ON "sender_profiles";
--> statement-breakpoint
CREATE POLICY "sender_profiles_owner_authenticated" ON "sender_profiles"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- knowledge_nodes — hard-FK importer descendant (importer_id NOT NULL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_knowledge_nodes_authenticated" ON "knowledge_nodes";
--> statement-breakpoint
CREATE POLICY "knowledge_nodes_owner_authenticated" ON "knowledge_nodes"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- knowledge_node_edges — NO importer_id column (deviation: scope via join
-- through source_node_id -> knowledge_nodes.importer_id -> importers.user_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_knowledge_node_edges_authenticated" ON "knowledge_node_edges";
--> statement-breakpoint
CREATE POLICY "knowledge_node_edges_owner_authenticated" ON "knowledge_node_edges"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    source_node_id IN (
      SELECT kn.id FROM knowledge_nodes kn
      JOIN importers i ON i.id = kn.importer_id
      WHERE i.user_id = auth.uid()
    )
  )
  WITH CHECK (
    source_node_id IN (
      SELECT kn.id FROM knowledge_nodes kn
      JOIN importers i ON i.id = kn.importer_id
      WHERE i.user_id = auth.uid()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- entity_types — nullable importer_id (importer_id IS NULL = system default,
-- seeded rows that must stay readable to every authenticated session)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_entity_types_authenticated" ON "entity_types";
--> statement-breakpoint
CREATE POLICY "entity_types_owner_authenticated" ON "entity_types"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    importer_id IS NULL
    OR importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid())
  )
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- entity_type_fields — nullable importer_id (same system-default idiom)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "deny_all_entity_type_fields_authenticated" ON "entity_type_fields";
--> statement-breakpoint
CREATE POLICY "entity_type_fields_owner_authenticated" ON "entity_type_fields"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    importer_id IS NULL
    OR importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid())
  )
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
