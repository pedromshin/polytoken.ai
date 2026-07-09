-- Phase 37 (TOOL-03/TOOL-04): knowledge_nodes_extracted_only view + BlendedRAG search RPCs.
--
-- knowledge_nodes_extracted_only — THE belt-1, structural, SQL-level guarantee: free-text
-- (title/content) for non-EXTRACTED (INFERRED/AMBIGUOUS) rows is NULLed at the view level, so
-- ANY consumer selecting from this view -- regardless of what WHERE clause it does or doesn't
-- add -- can never read non-EXTRACTED text. Every downstream read path this migration adds
-- (both search RPCs, and Task 3's expand_neighbours) reads through this view, never the base
-- knowledge_nodes table directly for free-text columns.
--
-- match_knowledge_nodes_by_embedding / match_knowledge_nodes_by_trgm — BlendedRAG search arms
-- mirroring the 0017 (match_entities_by_*) / 0009 (match_components_by_*) RPC pattern. Both add
-- an explicit tier = 'EXTRACTED' filter on top of the view's belt-1 nulling (belt 3) --
-- search-mode results are ALWAYS EXTRACTED-tier rows, never textless structural stubs.
--
-- RLS: 0001/0007 already applied deny-all RLS to knowledge_nodes; the view inherits no
-- independent RLS state and this migration grants nothing new -- the Python backend connects
-- via the service-role/postgres role that already bypasses RLS, same posture as every other
-- knowledge_nodes read/write path.
--
-- Threat mitigations: T-37-01 (view-level text nulling, live-verified with seeded 3-tier data),
-- T-37-02 (explicit tier = 'EXTRACTED' filter on both RPCs), T-37-05 (both RPCs are
-- parameterized SQL functions invoked via .rpc(name, params) -- never string-concatenated).

-- ---------------------------------------------------------------------------
-- knowledge_nodes_extracted_only view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW knowledge_nodes_extracted_only AS
SELECT
  id,
  importer_id,
  scope,
  scope_ref_id,
  scope_ref_type,
  source,
  tier,
  confidence,
  embedding,
  created_at,
  updated_at,
  CASE WHEN tier = 'EXTRACTED' THEN title ELSE NULL END AS title,
  CASE WHEN tier = 'EXTRACTED' THEN content ELSE NULL END AS content
FROM knowledge_nodes
WHERE is_active = true;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Dense vector arm — cosine similarity over knowledge_nodes.embedding (HNSW)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_knowledge_nodes_by_embedding(
  query_embedding halfvec(1536),
  match_importer_id uuid,
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  scope text,
  scope_ref_id uuid,
  tier text,
  confidence real,
  distance real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    title,
    content,
    scope::text AS scope,
    scope_ref_id,
    tier::text AS tier,
    confidence,
    (embedding <=> query_embedding) AS distance
  FROM knowledge_nodes_extracted_only
  WHERE importer_id = match_importer_id
    AND tier = 'EXTRACTED'
    AND embedding IS NOT NULL
  ORDER BY (embedding <=> query_embedding)
  LIMIT match_count;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lexical arm — pg_trgm similarity over title + content
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_knowledge_nodes_by_trgm(
  query_text text,
  match_importer_id uuid,
  match_count int
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  scope text,
  scope_ref_id uuid,
  tier text,
  confidence real,
  sim real
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    title,
    content,
    scope,
    scope_ref_id,
    tier,
    confidence,
    sim
  FROM (
    SELECT
      id,
      title,
      content,
      scope::text AS scope,
      scope_ref_id,
      tier::text AS tier,
      confidence,
      greatest(
        similarity(coalesce(title, ''), query_text),
        similarity(coalesce(content, ''), query_text)
      ) AS sim
    FROM knowledge_nodes_extracted_only
    WHERE importer_id = match_importer_id
      AND tier = 'EXTRACTED'
      AND query_text <> ''
  ) sub
  WHERE sim > 0
  ORDER BY sim DESC
  LIMIT match_count;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Supporting indexes (idempotent — mirrors every prior migration's convention)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_knowledge_nodes_embedding_hnsw"
  ON "knowledge_nodes"
  USING hnsw ("embedding" halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_title_trgm
  ON knowledge_nodes USING gin (title gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_content_trgm
  ON knowledge_nodes USING gin (content gin_trgm_ops);
