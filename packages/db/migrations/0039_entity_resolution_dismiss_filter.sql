-- Phase 57 (LEARN-02, gap 2): wire the dead component_entity_candidate_links.was_dismissed
-- flag into the BlendedRAG entity-resolution RPCs as a symmetric in-SQL exclusion filter.
--
-- RejectMergeUseCase (curate_entity_merge.py) has durably written was_dismissed=true since
-- migration 0018, with a docstring promising the resolver "never re-surfaces a dismissed
-- link" — but a whole-tree grep proves the flag was written and never read. This migration
-- re-emits both migration-0017 RPCs (CREATE OR REPLACE, bodies otherwise unchanged) adding:
--
--   1. A new trailing parameter match_subject_entity_instance_id uuid DEFAULT NULL
--      (backward-compatible — existing no-arg callers see identical behavior, guarded by
--      `match_subject_entity_instance_id IS NULL OR ...`).
--   2. A NOT EXISTS dismissal-exclusion clause checked against the dismissed-flag column
--      on component_entity_candidate_links.
--
-- Pitfall 1 (entity_instance_repository.py:311-372): component_entity_candidate_links.
-- component_id is POLYMORPHIC — for entity-to-entity dedup links (this table's dismiss/
-- select paths) it holds an entity_instances.id, not an email_components.id. dismiss_
-- candidate_link writes BOTH orderings ((component_id=subject, entity_instance_id=target)
-- AND (component_id=target, entity_instance_id=subject)). The NOT EXISTS clause below checks
-- BOTH orderings so a dismiss recorded in one direction cannot resurface from the other —
-- this is the filter-level symmetry guarantee, independent of which ordering(s) happen to
-- have been written.
--
-- All existing filters (importer_id, entity_type_id, source='email_extracted', is_active),
-- ORDER BY, LIMIT, and the GIN trgm indexes from migration 0017 are preserved verbatim.

-- ---------------------------------------------------------------------------
-- Dense vector arm — cosine similarity over entity_instances.embedding
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_entities_by_embedding(
  query_embedding halfvec(1536),
  match_importer_id uuid,
  match_entity_type_id uuid,
  match_count int,
  match_subject_entity_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  display_name text,
  distance real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    display_name,
    (embedding <=> query_embedding) AS distance
  FROM entity_instances
  WHERE importer_id = match_importer_id
    AND entity_type_id = match_entity_type_id
    AND source = 'email_extracted'
    AND embedding IS NOT NULL
    AND is_active = true
    AND (
      match_subject_entity_instance_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM component_entity_candidate_links l
        WHERE l.was_dismissed = true
          AND (
            (l.component_id = match_subject_entity_instance_id AND l.entity_instance_id = entity_instances.id)
            OR (l.component_id = entity_instances.id AND l.entity_instance_id = match_subject_entity_instance_id)
          )
      )
    )
  ORDER BY (embedding <=> query_embedding)
  LIMIT match_count;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lexical arm — pg_trgm similarity over display_name + identifiers + aliases
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_entities_by_trgm(
  query_text text,
  match_importer_id uuid,
  match_entity_type_id uuid,
  match_count int,
  match_subject_entity_instance_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  display_name text,
  sim real,
  name_sim real,
  identifier_sim real,
  alias_sim real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    display_name,
    sim,
    name_sim,
    identifier_sim,
    alias_sim
  FROM (
    SELECT
      id,
      display_name,
      similarity(display_name, query_text)                                         AS name_sim,
      similarity(identifiers::text, query_text)                                    AS identifier_sim,
      similarity(coalesce(array_to_string(aliases, ' '), ''), query_text)          AS alias_sim,
      greatest(
        similarity(display_name, query_text),
        similarity(identifiers::text, query_text),
        similarity(coalesce(array_to_string(aliases, ' '), ''), query_text)
      )                                                                            AS sim
    FROM entity_instances
    WHERE importer_id = match_importer_id
      AND entity_type_id = match_entity_type_id
      AND source = 'email_extracted'
      AND is_active = true
      AND query_text <> ''
  ) sub
  WHERE sim > 0
    AND (
      match_subject_entity_instance_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM component_entity_candidate_links l
        WHERE l.was_dismissed = true
          AND (
            (l.component_id = match_subject_entity_instance_id AND l.entity_instance_id = sub.id)
            OR (l.component_id = sub.id AND l.entity_instance_id = match_subject_entity_instance_id)
          )
      )
    )
  ORDER BY sim DESC
  LIMIT match_count;
$$;
