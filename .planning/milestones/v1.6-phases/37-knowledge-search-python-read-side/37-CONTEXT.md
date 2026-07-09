# Phase 37: Knowledge Search + Python Read-Side - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous (recommendations auto-accepted + documented; sources: SYNTHESIS.md Fork 5 + Fork 3 Tier-1 rule + v1.5 shipped code)

<domain>
## Phase Boundary

User can search or expand the knowledge graph from chat via `search_knowledge(query, mode:
"search"|"expand")` — backed by an EXTENDED Python `KnowledgeGraphRepository` (the port + Supabase
impl ALREADY EXIST from v1.5's promote-edge work — this phase adds read-side methods, correcting
the synthesis's "build from scratch") plus new SQL (migrations **0029+**, verify head at execution
with `ls packages/db/migrations | tail -1`) including the DB-level `extracted_only` view (TOOL-04).
Built but NOT user-exposed: the executor ships behind a settings flag default-OFF; Phase 38 flips
it after quarantine wiring (synthesis P6 rule). Requirements: TOOL-03, TOOL-04. Gates G1+G2+G3+G4
all satisfied.

</domain>

<decisions>
## Implementation Decisions

### Repository extension (not creation)
- Extend `app/domain/ports/knowledge_graph_repository.py` (existing Protocol: upsert_node, find_active_node, insert_edge, deactivate_edges_for_node, find_active_edges_for_node, list_injectable_edges, find_edge_by_id, promote_edge) with read-side methods, e.g. `search_nodes(query, importer_id, limit=8)` and `expand_neighbours(node_id, importer_id, max_depth=2, node_budget=50)`. Mirror the existing impl style in `app/infrastructure/supabase/knowledge_graph_repository.py`.
- `expand` mode mirrors Phase 32's bounded-BFS SEMANTICS (depth ≤2, ~50-node budget, importer-scoped) as a Python-side RPC — it does NOT call the TS tRPC endpoint (no cross-runtime HTTP hop; same Postgres).

### SQL (migrations 0029+, authored in packages/db/migrations like v1.5's 0026–0028)
- **`extracted_only` view** — the single-point-of-failure killer Fork 3 demanded: a view over active knowledge nodes/edges that exposes free-text columns ONLY for EXTRACTED-tier rows (non-EXTRACTED rows either excluded or text columns NULLed at the view level, so a forgotten WHERE in any consumer cannot leak INFERRED/AMBIGUOUS text). The prompt-facing search query reads THROUGH this view.
- **Search RPC(s)**: BlendedRAG over knowledge nodes mirroring the 0017/0009 RPC patterns — pg_trgm lexical arm + embedding arm (existing `embedding_protocol.py` Titan/Bedrock port), RRF k=60 fusion. If the embedding call fails at runtime, degrade to trgm-only (never fail the tool; "never silent" → note degraded mode in envelope metadata).
- Apply migrations to the LOCAL database and live-verify (v1.5 precedent; deploy-playbook is migrations-first). Staging/prod deploy stays deferred like 0026–0028.

### Envelope + tier enforcement (TOOL-04)
- EXTRACTED-only free text BY FIELD OMISSION: envelope entries carry `{node_id, label, tier, confidence, source_region_id, citations[]}`; the free-text `label`/content fields are POPULATED ONLY for EXTRACTED rows (guaranteed by the view); INFERRED/AMBIGUOUS return structural fields only where the mode includes them, else omitted entirely from prompt-facing results. No boolean "trusted" flag anywhere.
- Top-8 results, 300-char truncation per text field (Fork 5), size-capped via Phase 34's shared helper. `citations[]` route: `/knowledge?focus={id}`.

### Exposure gating (synthesis P6 rule)
- New settings flag (e.g. `SEARCH_KNOWLEDGE_TOOL_ENABLED`, default `False`): the executor class + full test suite ship this phase; `container.py` registers it in the prod mapping ONLY when the flag is true. Phase 38 flips the default after the adversarial suite passes. Tests exercise the executor directly regardless of flag.

### Claude's Discretion
- Exact method/RPC/view names; one combined migration vs view+RPC split; envelope dataclass shape (align with Phase 36's envelope conventions — read its SUMMARYs at execution time); trgm/similarity thresholds; how expand-mode results mark tier on edges vs nodes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `knowledge_graph_repository.py` port + Supabase impl (v1.5) — extend, don't recreate. `list_injectable_edges` shows the EXTRACTED-gate query convention + seeded three-tier exclusion test pattern.
- Migrations `0017` (entity-resolution RPCs) + `0009` (few-shot retrieval RPCs) — the BlendedRAG RPC pattern to mirror; `0026` shows the tier enum; head currently `0028`.
- `embedding_protocol.py` (Titan embeddings via Bedrock IAM); Phase 34 ToolExecutor port + cap helper; Phase 36 envelope/citation conventions (read its SUMMARYs).

### Established Patterns
- Deactivate-then-insert supersede, never DELETE; fail toward least trust (tier default AMBIGUOUS); importer-scoped everything; RRF k=60 fusion; seeded-DB tests for tier gates.

### Integration Points
- `container.py` (flag-gated executor registration), `settings.py` (new flag), `packages/db/migrations/` (0029+), Phase 35's retrieval-golden-set (real-data entries become possible after this phase — note in SUMMARY, don't do it here).

</code_context>

<specifics>
## Specific Ideas

- TOOL-04's whole point: a missing WHERE clause anywhere must NOT be able to leak non-EXTRACTED text — the VIEW enforces it, the field-omission envelope enforces it again (belt and suspenders).
- Migration-numbering rule from the synthesis critic: verify head at execution time; do not assume 0029 is free.

</specifics>

<deferred>
## Deferred Ideas

- Flipping the exposure flag + adversarial fixtures against this executor → Phase 38.
- Real-data golden-set entries for EVAL-06 → after this phase ships (Phase 38 can fold it in).
- Citation-chip UI for /knowledge?focus links → Phase 39.
- BFS-into-autofill-prompts (KGX-01..03) → still measurement-gated backlog; this phase's expand mode serves CHAT, not autofill.

</deferred>
