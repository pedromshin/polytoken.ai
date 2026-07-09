---
phase: 37-knowledge-search-python-read-side
plan: 01
subsystem: knowledge-graph-read-side
tags: [extracted-only-view, blended-rag, rrf, bounded-bfs, tenant-isolation, TOOL-03, TOOL-04]
dependency_graph:
  requires:
    - "app.domain.ports.knowledge_graph_repository.KnowledgeGraphRepository (v1.5 -- upsert_node/find_active_node/insert_edge/deactivate_edges_for_node/find_active_edges_for_node/list_injectable_edges/find_edge_by_id/promote_edge)"
    - "app.infrastructure.supabase.entity_resolution_repository (RRF-fusion pattern mirrored: _rrf_score/_merge_rrf, vector-arm-skipped-when-embedding-None)"
    - "packages/db/migrations/0028_autofill_retrieval_events.sql (migration head at plan start)"
  provides:
    - "packages/db/migrations/0029_knowledge_search_extracted_only.sql -- knowledge_nodes_extracted_only view + match_knowledge_nodes_by_embedding/match_knowledge_nodes_by_trgm RPCs + 3 supporting indexes"
    - "app.domain.ports.knowledge_graph_repository.search_nodes / .expand_neighbours (+ DEFAULT_SEARCH_LIMIT / MIN_EXPAND_DEPTH / MAX_EXPAND_DEPTH / DEFAULT_EXPAND_NODE_BUDGET constants)"
    - "app.infrastructure.supabase.knowledge_graph_repository.SupabaseKnowledgeGraphRepository.search_nodes / .expand_neighbours"
  affects:
    - "Plan 37-02's search_knowledge ToolExecutor (consumes these two repository methods directly)"
tech_stack:
  added: []
  patterns:
    - "DB-level extracted_only view -- title/content NULLed via CASE WHEN tier = 'EXTRACTED' at the view level, structurally unreachable by a missing WHERE clause (belt 1)"
    - "RPC-level explicit tier = 'EXTRACTED' filter on top of the view (belt 3) -- search results are always EXTRACTED, never textless structural stubs"
    - "RRF(k=60) fusion mirroring entity_resolution_repository.py's find_candidates structure, copied verbatim per-file (not cross-module imported)"
    - "Bounded BFS with per-hop tenant-scoped view resolution (not raw table), budget cap applied once after the walk (mirrors expand.ts's capBudget)"
key_files:
  created:
    - packages/db/migrations/0029_knowledge_search_extracted_only.sql
    - packages/db/scripts/verify-0029-live.ts
  modified:
    - packages/db/migrations/meta/_journal.json
    - apps/email-listener/app/domain/ports/knowledge_graph_repository.py
    - apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
    - apps/email-listener/tests/test_knowledge_graph_repository.py
decisions:
  - "Migration numbered 0029 (head was still 0028 at execution time, confirmed via ls packages/db/migrations | tail -1 -- no renumbering needed)"
  - "Custom SQL migrations in this repo (view/RPC-only, no Drizzle schema diff) need a manually-added packages/db/migrations/meta/_journal.json entry -- there is no corresponding meta/*_snapshot.json file, matching the established pattern for 0009/0015/0017/0025-0028"
  - "expand_neighbours resolves the SEED's own row through knowledge_nodes_extracted_only (not just the raw-table is_active/importer_id check) before starting the BFS, so the seed itself is included in the returned nodes list with real tier-gated title/content -- mirrors expand.ts's walkKnowledgeGraph/expandNode semantics exactly (the TS reference always includes the seed id in nodeIds, resolved and returned)"
  - "expand_neighbours decomposed into _seed_is_valid/_walk_bfs/_collect_hop_candidates/_resolve_view_rows/_fetch_edges_for_node + a pure _filter_edges_to_node_set helper to satisfy ruff's cyclomatic-complexity (PLR0912) limit -- functionally identical to a single inline method, just broken into named, independently-readable steps"
metrics:
  duration: "~50 min"
  completed: 2026-07-09
---

# Phase 37 Plan 01: Knowledge Search Python Read-Side Summary

Migration 0029 creates a DB-level `knowledge_nodes_extracted_only` view (title/content NULLed for
non-EXTRACTED rows -- belt 1) plus two BlendedRAG search RPCs with an explicit `tier = 'EXTRACTED'`
filter (belt 3), and the existing v1.5 `KnowledgeGraphRepository` port/impl is extended (not
recreated) with `search_nodes` (RRF-fused vector+trgm search) and `expand_neighbours` (bounded,
tenant-scoped BFS) -- both proven with live/seeded three-tier data and 25 targeted unit tests.

## What Was Built

### Task 1 -- Migration 0029: extracted_only view + BlendedRAG search RPCs + indexes

Verified the migration head first (`ls packages/db/migrations | tail -1` showed
`0028_autofill_retrieval_events.sql`, per the plan's warning) -- no renumbering needed, authored as
`0029_knowledge_search_extracted_only.sql`.

Three sections:

1. **`knowledge_nodes_extracted_only` view** -- selects every `knowledge_nodes` column unchanged
   except `title`/`content`, which become `CASE WHEN tier = 'EXTRACTED' THEN title ELSE NULL END`
   (and the identical CASE for `content`), filtered to `is_active = true`. This is the single point
   where non-EXTRACTED free text becomes structurally unreachable -- any consumer selecting from
   this view, regardless of its own WHERE clause, gets NULL title/content for INFERRED/AMBIGUOUS
   rows.
2. **`match_knowledge_nodes_by_embedding`** -- HNSW cosine-distance RPC over the view, filtered to
   `tier = 'EXTRACTED' AND embedding IS NOT NULL`, `scope`/`tier` cast to `::text` (mirrors 0009's
   enum-cast idiom).
3. **`match_knowledge_nodes_by_trgm`** -- pg_trgm similarity RPC over `title`/`content`
   (`coalesce(..., '')` + `greatest(...)`), same `tier = 'EXTRACTED'` filter, `WHERE sim > 0` outer
   filter (mirrors 0017's `match_entities_by_trgm` structure exactly).
4. Three `IF NOT EXISTS` indexes: HNSW on `knowledge_nodes.embedding` (new -- no prior HNSW index
   existed on this column) + 2 GIN trgm indexes on `title`/`content`.

Applied via `cd packages/db && npm run migrate:local` (23 tables, exits 0) and confirmed idempotent
by re-running a second time (also exits 0, no errors). A required manual step not spelled out in
the plan's action text: this repo's `migrate()` runner reads `packages/db/migrations/meta/_journal.json`
to discover which migration files to apply -- a raw `.sql` file with no journal entry is silently
skipped. Added a `{"idx": 29, "tag": "0029_knowledge_search_extracted_only", ...}` entry (no
corresponding snapshot file needed -- matches the established pattern for every prior custom-SQL-only
migration in this repo: 0009/0015/0017/0025-0028 also have no `meta/*_snapshot.json`).

`packages/db/scripts/verify-0029-live.ts` (mirrors `verify-0028-live.ts`'s shape: direct `pg.Client`
against `POSTGRES_URL_NON_POOLING`, assertion-based, `process.exit(1)` on failure) seeds 3
`knowledge_nodes` rows (EXTRACTED/INFERRED/AMBIGUOUS, `importer_id = DEFAULT_IMPORTER_ID`) and
asserts: the view exists in `information_schema.views`; both RPCs exist as `FUNCTION`s in
`information_schema.routines`; reading the 3 seeded ids back through the view returns the EXTRACTED
row's exact title/content and NULL/NULL for both the INFERRED and AMBIGUOUS rows; calling
`match_knowledge_nodes_by_trgm('Extracted Title', ...)` returns the EXTRACTED id and excludes both
suggestion-tier ids. Cleans up the seeded rows in a `finally` block. Ran against the LOCAL database
(reachable) -- **VERIFICATION PASSED: all assertions confirmed live** (see Verification section for
raw output).

### Task 2 -- `search_nodes` (TDD RED -> GREEN)

`app/domain/ports/knowledge_graph_repository.py`: `DEFAULT_SEARCH_LIMIT = 8` (Fork 5's top-8) +
`search_nodes(*, query_text, query_embedding, importer_id, limit=DEFAULT_SEARCH_LIMIT) ->
list[dict[str, object]]` appended to the Protocol, docstring stating results are always
EXTRACTED-tier (belt 3) and callers must still apply their own field-omission belt.

`app/infrastructure/supabase/knowledge_graph_repository.py`: `_VECTOR_RPC`/`_TRGM_RPC` name
constants, `_rrf_score`/`_merge_rrf` copied verbatim from `entity_resolution_repository.py`'s
pattern (`_K_DEFAULT = 60`, self-contained per this codebase's per-file convention -- not
cross-module imported). `search_nodes` mirrors `find_candidates`'s exact structure: `_vector_search_query`
runs only when `query_embedding is not None`, `_trgm_search_query` always runs, both wrapped in
try/except -> `[]` (logged via `logging.getLogger(__name__)`), results merged via RRF, deduped by
`id`, capped at `limit`, returned verbatim (every RPC-returned column preserved, no additional
filtering).

7 tests, all independently `-k`-selectable: RRF merge+dedupe+cap; vector arm skipped (never called)
when `query_embedding is None`; vector-failure-degrades-to-trgm-only; trgm-failure-degrades-to-vector-only;
both-arms-empty -> `[]`; every `.rpc()` call's params carry `match_importer_id`; limit respected,
keeping highest-RRF-scored rows.

RED confirmed first: `AttributeError: 'SupabaseKnowledgeGraphRepository' object has no attribute
'search_nodes'` on all 7 tests (committed before the implementation existed). GREEN: 7/7 passed on
first implementation run after one mypy fix (see Deviations).

### Task 3 -- `expand_neighbours` (TDD RED -> GREEN)

`app/domain/ports/knowledge_graph_repository.py`: `MIN_EXPAND_DEPTH = 1`, `MAX_EXPAND_DEPTH = 2`,
`DEFAULT_EXPAND_NODE_BUDGET = 50` + `expand_neighbours(*, node_id, importer_id,
max_depth=MAX_EXPAND_DEPTH, node_budget=DEFAULT_EXPAND_NODE_BUDGET) -> dict[str, object]` appended
to the Protocol.

`app/infrastructure/supabase/knowledge_graph_repository.py`: `_clamp_depth` (pure, mirrors
`expand.ts`'s `clampDepth`). `expand_neighbours` fail-closes (zero further queries) on an unknown,
inactive, or cross-tenant seed via `_seed_is_valid` (raw `knowledge_nodes` table check); then
resolves the seed itself through `knowledge_nodes_extracted_only` before starting the walk (see
Decisions -- this is what makes the seed appear in the output with real tier-gated data, matching
`expand.ts`'s semantics where the seed id is always part of `walk.nodeIds`). `_walk_bfs` runs up to
`clamped_depth` hops: each hop's `_collect_hop_candidates` fetches active edges touching every node
in the current frontier (`.or_("source_node_id.eq.<id>,target_ref_id.eq.<id>")`), collects newly-seen
endpoint ids, and `_resolve_view_rows` resolves them in ONE batched
`knowledge_nodes_extracted_only` query per hop filtered to `.eq("importer_id", importer_id)` -- THE
tenant boundary (T-37-02): any id that fails to resolve here (foreign-importer, inactive, or a
polymorphic non-knowledge_node target) is silently dropped and never becomes part of the next
frontier. After the walk, `_filter_edges_to_node_set` (pure) drops any edge whose endpoints fell
outside the resolved node set; the budget cap is applied ONCE at the end (mirrors `expand.ts`'s
`capBudget`, not per-hop) -- if the walk discovered more than `node_budget` nodes, only the first
`node_budget` (in discovery order) are kept, edges re-filtered against that smaller set, `truncated:
True`.

8 tests, all independently `-k`-selectable: fail-closed on unknown/inactive/cross-tenant seed (3
tests, each asserting zero edge/view queries occurred); 1-hop happy path (both edges + both
neighbours + the seed itself returned, each node dict carrying
id/tier/confidence/scope/scope_ref_id/title/content); depth clamp (max_depth=99 -> exactly 2
edge-fetch calls in a 5-node chain topology; max_depth=0 -> exactly 1); three-tier field-omission
proof (an INFERRED neighbour's title/content come back `None`, passed through unchanged from the
view); node-budget cap (11 discovered nodes, budget=5 -> exactly 5 returned, `truncated: True`, no
edge references an excluded id); cross-tenant neighbour exclusion (a foreign-importer neighbour is
dropped from both nodes and edges, proven via the view query's actual `importer_id` filter call, not
just the output shape).

RED confirmed first: `AttributeError: 'SupabaseKnowledgeGraphRepository' object has no attribute
'expand_neighbours'` on all 8 tests. GREEN: 8/8 passed on the first implementation attempt. A
subsequent `ruff check` run flagged `PLR0912 Too many branches (13 > 12)` on the single-method
implementation -- refactored (Rule 1, bug/lint-violation fix) into `_seed_is_valid`/`_walk_bfs`/
`_collect_hop_candidates`/`_resolve_view_rows`/`_fetch_edges_for_node` plus a pure
`_filter_edges_to_node_set` module helper; all 8 tests still passed unchanged after the refactor
(behavior-preserving).

## Verification

```
cd packages/db && npm run migrate:local
# Migrations completed in 39ms (23 tables); re-run: 11ms, 23 tables (idempotent)

cd packages/db && npm run with-env -- tsx scripts/verify-0029-live.ts
# View knowledge_nodes_extracted_only present: true
# Routines: match_knowledge_nodes_by_embedding: FUNCTION / match_knowledge_nodes_by_trgm: FUNCTION
# Read-back: EXTRACTED row title/content round-tripped exactly; INFERRED/AMBIGUOUS rows both NULL
# match_knowledge_nodes_by_trgm returned only the EXTRACTED seed id
# VERIFICATION PASSED: all assertions confirmed live.

grep -n "WHEN tier = 'EXTRACTED'" packages/db/migrations/0029_*.sql
# 2 matches (title CASE + content CASE)

grep -c "IF NOT EXISTS" packages/db/migrations/0029_*.sql
# 3

cd apps/email-listener && uv run pytest tests/test_knowledge_graph_repository.py -k "search_nodes" -q --no-cov
# 7 passed

cd apps/email-listener && uv run pytest tests/test_knowledge_graph_repository.py -k "expand_neighbours" -q --no-cov
# 8 passed

cd apps/email-listener && uv run pytest tests/test_knowledge_graph_repository.py -q --no-cov
# 25 passed (10 pre-existing + 7 search_nodes + 8 expand_neighbours)

cd apps/email-listener && uv run mypy app/domain/ports/knowledge_graph_repository.py app/infrastructure/supabase/knowledge_graph_repository.py
# Success: no issues found in 2 source files

cd apps/email-listener && uv run lint-imports
# Contracts: 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/domain/ports/knowledge_graph_repository.py app/infrastructure/supabase/knowledge_graph_repository.py tests/test_knowledge_graph_repository.py
# All checks passed!

grep -rn "match_knowledge_nodes_by\|knowledge_nodes_extracted_only" apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
# _VECTOR_RPC/_TRGM_RPC constants + 4 docstring/call-site references -- confirms both RPCs and the
# view are referenced from the Python layer, not dead SQL.
```

## Deviations from Plan

**1. [Rule 3 -- blocking, discovered mid-Task-1] Custom SQL migrations require a manual journal
entry.** The plan's action text only described authoring the `.sql` file; it did not mention that
this repo's `drizzle-orm/node-postgres/migrator` reads `packages/db/migrations/meta/_journal.json`
to discover which migration files exist -- a `.sql` file with no journal entry is silently never
applied. Added an `idx: 29` entry to `_journal.json` (no `meta/0029_snapshot.json` needed, matching
the established pattern for every prior custom-SQL-only migration: 0009/0015/0017/0025-0028 also
lack snapshot files, since custom SQL carries no Drizzle-schema diff). Confirmed via successful
`migrate:local` (idempotent on 2 runs) and the live-verify script finding the view/RPCs.

**2. [Rule 1 -- bug fix] mypy `Incompatible types in assignment` on `result.data or []`.**
`SupabaseKnowledgeGraphRepository.__init__` types `self._client: Client` (a real supabase-py type,
not `Any` like `entity_resolution_repository.py`'s constructor), so `result.data` resolves to a real
union type incompatible with the intended `list[dict[str, Any]]` annotation via direct assignment.
Fixed by returning `cast("list[dict[str, Any]]", result.data or [])` directly instead of an
intermediate annotated variable, in both `_vector_search_query` and `_trgm_search_query`. Verified:
`uv run mypy` clean afterward.

**3. [Rule 1 -- lint-violation fix] ruff `PLR0912 Too many branches (13 > 12)` on `expand_neighbours`.**
The single-method implementation following the plan's literal 7-step action text exceeded this
repo's ruff branch-count limit. Decomposed into 5 private async methods
(`_seed_is_valid`/`_walk_bfs`/`_collect_hop_candidates`/`_resolve_view_rows`/`_fetch_edges_for_node`)
plus a pure module-level `_filter_edges_to_node_set` helper -- behavior-preserving, all 8 targeted
tests passed unchanged before and after the refactor.

**4. [Claude's Discretion, documented per 37-CONTEXT.md's explicit allowance] Seed resolution
through the view.** The plan's step-3 action text describes seeding `node_ids` with a placeholder
(`{node_id: <unresolved>}`) and never explicitly resolving the seed's own row through
`knowledge_nodes_extracted_only`. Taken literally, this would leave a broken placeholder in the final
`nodes` output for the seed. Implemented instead to resolve the seed through the view BEFORE starting
the BFS (one extra `_resolve_view_rows` call for `{node_id}`), so the seed appears in the output with
real, tier-gated `title`/`content`/`tier`/`confidence`/`scope`/`scope_ref_id` -- this exactly mirrors
`expand.ts`'s `walkKnowledgeGraph`/`expandNode` semantics, which the plan's own read_first repeatedly
states this task reimplements ("the SAME semantics in Python"), and where the seed id is always part
of the walked node set and resolved alongside every other touched node. Fail-closed defense-in-depth
retained: if the seed somehow fails to resolve through the view despite passing the raw-table
is_active/importer_id check, `expand_neighbours` still returns the empty result rather than surface a
partially-resolved seed.

No architectural deviations (Rule 4 not triggered). No auth gates encountered.

## Known Stubs

None. Both `search_nodes` and `expand_neighbours` are fully implemented against real Postgres RPCs
and the live-verified view -- not yet consumed by a ToolExecutor (that's Plan 37-02, by design, per
this plan's own `<success_criteria>`: "not yet exposed to a chat tool").

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-37-01..05, all addressed as designed -- see
"What Was Built" above for T-37-01/T-37-02/T-37-03's concrete implementation, and T-37-05's
parameterized-RPC-calls posture, unchanged from the plan).

## Self-Check: PASSED

- FOUND: packages/db/migrations/0029_knowledge_search_extracted_only.sql
- FOUND: packages/db/scripts/verify-0029-live.ts
- FOUND: packages/db/migrations/meta/_journal.json (idx 29 entry present)
- FOUND: apps/email-listener/app/domain/ports/knowledge_graph_repository.py
- FOUND: apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py
- FOUND: apps/email-listener/tests/test_knowledge_graph_repository.py
- FOUND commit 07ca6ce (Task 1 -- migration 0029)
- FOUND commit 2258ae1 (Task 2 RED -- search_nodes tests)
- FOUND commit 3a5b209 (Task 2 GREEN -- search_nodes impl)
- FOUND commit d15f946 (Task 3 RED -- expand_neighbours tests)
- FOUND commit 3f9e079 (Task 3 GREEN -- expand_neighbours impl)
