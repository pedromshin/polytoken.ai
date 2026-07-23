-- RES-1 follow-up: re-key the dismissal exclusion in the BlendedRAG entity-resolution
-- RPCs to match how was_dismissed rows are ACTUALLY written.
--
-- Migration 0039 added a NOT EXISTS dismissal filter that keyed on
-- component_entity_candidate_links.component_id = <entity_instances.id> (both
-- orderings), assuming an entity-to-entity keying. That keying never exists in the
-- data: component_id is a NOT NULL FK to email_components.id, so it can never hold an
-- entity id — the 0039 clause can never match a row and the filter is dead.
--
-- Since the RES-1 write-path fix, RejectMerge (dismiss_candidate_link) flags the
-- promote-written suggestion rows with their REAL keying:
--
--   (component_id ∈ email_components of the subject's email, entity_instance_id = target)
--   and symmetrically
--   (component_id ∈ email_components of the target's email,  entity_instance_id = subject)
--
-- An entity OCCURS in an email exactly when a was_selected=true link (a promote-written
-- occurrence/identity assignment) references it there — was_selected=false rows are mere
-- resemblance suggestions and must NOT anchor the pair, or a dismissal of C against S
-- would wrongly suppress every OTHER same-email candidate from C's future resolutions
-- (verified against a live Postgres engine while building this migration). So
-- "a dismissal exists between subject S and candidate C" becomes: a was_dismissed=true
-- link row points at ONE of the pair, and that row's component lives in an email where
-- the OTHER of the pair has a was_selected=true occurrence link. Both directions are
-- checked so a dismiss recorded from either side suppresses re-surfacing from both.
--
-- Everything else (parameters incl. the backward-compatible
-- match_subject_entity_instance_id DEFAULT NULL, filters, ORDER BY, LIMIT) is
-- preserved verbatim from 0039. No legacy data migration is needed: the pre-RES-1
-- dismiss UPDATE matched zero rows, so no was_dismissed=true rows with the old
-- (impossible) keying exist.

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
        SELECT 1
        FROM component_entity_candidate_links dl
        JOIN email_components dc ON dc.id = dl.component_id
        JOIN email_components oc ON oc.email_id = dc.email_id
        JOIN component_entity_candidate_links ol
          ON ol.component_id = oc.id AND ol.was_selected = true
        WHERE dl.was_dismissed = true
          AND (
            (dl.entity_instance_id = entity_instances.id
              AND ol.entity_instance_id = match_subject_entity_instance_id)
            OR (dl.entity_instance_id = match_subject_entity_instance_id
              AND ol.entity_instance_id = entity_instances.id)
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
        SELECT 1
        FROM component_entity_candidate_links dl
        JOIN email_components dc ON dc.id = dl.component_id
        JOIN email_components oc ON oc.email_id = dc.email_id
        JOIN component_entity_candidate_links ol
          ON ol.component_id = oc.id AND ol.was_selected = true
        WHERE dl.was_dismissed = true
          AND (
            (dl.entity_instance_id = sub.id
              AND ol.entity_instance_id = match_subject_entity_instance_id)
            OR (dl.entity_instance_id = match_subject_entity_instance_id
              AND ol.entity_instance_id = sub.id)
          )
      )
    )
  ORDER BY sim DESC
  LIMIT match_count;
$$;
