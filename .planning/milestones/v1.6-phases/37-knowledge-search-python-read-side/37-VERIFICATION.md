---
phase: 37-knowledge-search-python-read-side
verified: 2026-07-09T00:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 37: Knowledge Search + Python Read-Side Verification Report

**Phase Goal:** User can search or expand the knowledge graph from chat via `search_knowledge`,
backed by a NEW Python `KnowledgeGraphRepository` and a DB-level `extracted_only` view —
non-EXTRACTED tiers are structurally unable to leak free text into model context by field
omission, not a flag. `search_knowledge` is built and fully tested but ships DARK (not yet
user-facing) — exposure lifts in Phase 38.
**Verified:** 2026-07-09
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration 0029+ creates `knowledge_nodes_extracted_only` view + 2 BlendedRAG RPCs + indexes, applied locally and live-verified | VERIFIED | `packages/db/migrations/0029_knowledge_search_extracted_only.sql` read in full; journal entry present (`meta/_journal.json` idx 29); re-ran `npm run migrate:local` (idempotent, 23 tables, 12ms) and independently re-ran `tsx scripts/verify-0029-live.ts` myself — printed `VERIFICATION PASSED: all assertions confirmed live.` against the real local Postgres |
| 2 | Non-EXTRACTED (INFERRED/AMBIGUOUS) free text is structurally NULL through the view — belt 1 | VERIFIED | SQL `CASE WHEN tier = 'EXTRACTED' THEN title ELSE NULL END` (2 occurrences, title+content); my own live re-run's seeded 3-tier readback showed `tier=INFERRED title=null content=null` / `tier=AMBIGUOUS title=null content=null`, EXTRACTED round-tripped exact strings |
| 3 | `search_nodes` returns EXTRACTED-tier-only, RRF(k=60)-fused results scoped to `importer_id`; embedding arm gracefully skipped/degrades, never raises | VERIFIED | `SupabaseKnowledgeGraphRepository.search_nodes` read in full — `_vector_search_query` only called when `query_embedding is not None`, both `_vector_search_query`/`_trgm_search_query` wrapped in try/except → `[]`, `_merge_rrf`/`_rrf_score` (k=60) present; RPCs (`match_knowledge_nodes_by_embedding/trgm`) both filter `tier = 'EXTRACTED'` explicitly (belt 3); 7 targeted tests pass (`-k search_nodes`) |
| 4 | `expand_neighbours` performs bounded (≤2-hop, ≤50-node) BFS, tenant-scoped at every hop, fail-closed on unknown/inactive/cross-tenant seed | VERIFIED | Code read in full — `_seed_is_valid` fail-closes before any further query, `_clamp_depth` bounds `[MIN_EXPAND_DEPTH=1, MAX_EXPAND_DEPTH=2]`, `_resolve_view_rows` filters `.eq("importer_id", importer_id)` against the view every hop, budget cap applied once post-walk (`DEFAULT_EXPAND_NODE_BUDGET=50`); 8 targeted tests pass (`-k expand_neighbours`) |
| 5 | `search_knowledge(mode="search")` returns top-8, 300-char-truncated EXTRACTED results with `/knowledge?focus={id}` citations | VERIFIED | `DEFAULT_SEARCH_LIMIT = 8` (port), `MAX_RESULT_FIELD_CHARS = 300` + `truncate_field` (envelope.py) used inside `_belt_two_label`; `_ROUTE_TEMPLATES["knowledge"] = "/knowledge?focus={id}"`; `_build_citations` builds one `citation_to_dict(build_citation("knowledge", id))` per distinct node id |
| 6 | `search_knowledge(mode="expand")` bounded-expands (≤2 hop) via `expand_neighbours`, belt-2 label omission independent of belt 1 | VERIFIED | `_execute_expand` calls `expand_neighbours(..., max_depth=MAX_EXPAND_DEPTH, node_budget=DEFAULT_EXPAND_NODE_BUDGET)` — hardcoded, not caller-controlled (schema has no depth/budget property); `_map_node_row`/`_belt_two_label` re-derive omission from the row's own `tier`, grep-verified as the SOLE reader of `title`/`content` in the file (1 match, inside `_belt_two_label`) |
| 7 | Embedding failure degrades to trgm-only, never fails the tool; envelope notes degraded mode | VERIFIED | `_execute_search` wraps `embedder.embed` in try/except → `query_embedding=None`, `degraded=True`, logs a warning, never re-raises; envelope conditionally includes `"embedding_degraded": True` only when degraded (`**({...} if degraded else {})`) |
| 8 | `SEARCH_KNOWLEDGE_TOOL_ENABLED` defaults False; container's `tool_executors`/`server_tool_defs` omit `search_knowledge` unless the flag is explicitly true | VERIFIED | `app/settings.py:152` `SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False`; `app/container.py` `_provide_run_chat_turn` builds both mappings via immutable `**({...} if settings.SEARCH_KNOWLEDGE_TOOL_ENABLED else {})` unpacking (zero `.update()`/item-assignment in the function body); `test_container_search_knowledge_disabled_by_default` / `test_container_search_knowledge_enabled_via_flag` both pass, independently re-run |
| 9 | The executor and its full test suite exist and are exercised regardless of the flag's runtime value | VERIFIED | `tests/infrastructure/tools/test_search_knowledge_executor.py` (11 tests, all pass independent of `SEARCH_KNOWLEDGE_TOOL_ENABLED`, which is never referenced in that test file) |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0029_knowledge_search_extracted_only.sql` | view + 2 RPCs + 3 indexes | VERIFIED | Read in full; `grep -c "IF NOT EXISTS"` = 3; `grep "WHEN tier = 'EXTRACTED'"` = 2 |
| `packages/db/scripts/verify-0029-live.ts` | live-verify script | VERIFIED | Re-executed independently against local Postgres — passed |
| `packages/db/migrations/meta/_journal.json` | idx 29 entry | VERIFIED | Entry present, migration applies (not silently skipped) |
| `apps/email-listener/app/domain/ports/knowledge_graph_repository.py` | search_nodes + expand_neighbours Protocol methods + constants | VERIFIED | `DEFAULT_SEARCH_LIMIT`, `MIN/MAX_EXPAND_DEPTH`, `DEFAULT_EXPAND_NODE_BUDGET` all present |
| `apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py` | Supabase impls | VERIFIED | Both methods implemented, 15 targeted tests pass |
| `apps/email-listener/app/infrastructure/tools/search_knowledge_executor.py` | SEARCH_KNOWLEDGE_TOOL_NAME, build_search_knowledge_tool, SearchKnowledgeExecutor | VERIFIED | All 3 exported (`__all__`), 11 tests pass |
| `apps/email-listener/app/infrastructure/tools/envelope.py` | "knowledge" citation kind | VERIFIED | `CitationKind` widened, `_ROUTE_TEMPLATES["knowledge"]` present, Phase 36 executor tests unregressed |
| `apps/email-listener/app/settings.py` | SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = False | VERIFIED | Present at line 152 |
| `apps/email-listener/app/container.py` | flag-gated conditional wiring | VERIFIED | Both `tool_executors`/`server_tool_defs` conditionally include the tool, immutable construction |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `SupabaseKnowledgeGraphRepository.search_nodes` | `match_knowledge_nodes_by_embedding` / `match_knowledge_nodes_by_trgm` RPCs | `self._client.rpc(name, params).execute()` | WIRED | `_VECTOR_RPC`/`_TRGM_RPC` constants called inside `_vector_search_query`/`_trgm_search_query` |
| `SupabaseKnowledgeGraphRepository.expand_neighbours` | `knowledge_nodes_extracted_only` view | `.table("knowledge_nodes_extracted_only").select(...).in_("id",...).eq("importer_id",...)` | WIRED | `_resolve_view_rows` — the tenant boundary, re-used every hop |
| `SearchKnowledgeExecutor` | `search_nodes`/`expand_neighbours` | direct call | WIRED | `_execute_search`/`_execute_expand` call both, zero new repository methods |
| `SearchKnowledgeExecutor` | `envelope.build_citation("knowledge", ...)` | server-side citation construction | WIRED | `_build_citations` builds one per distinct node id, both modes |
| `container.py:_provide_run_chat_turn` | `settings.SEARCH_KNOWLEDGE_TOOL_ENABLED` | conditional `**` dict-literal unpack | WIRED | Grep-verified zero `.update()`/item-assignment mutation inside the function |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 0029 applies idempotently against live local Postgres | `cd packages/db && npm run migrate:local` (run twice by 37-01, re-run once here) | "Migrations completed in 12ms (23 tables)" | PASS |
| View text-nulling + RPC tier-filter proven live (not mocked) | `cd packages/db && npm run with-env -- tsx scripts/verify-0029-live.ts` (independently re-run by verifier) | `VERIFICATION PASSED: all assertions confirmed live.` — EXTRACTED round-tripped, INFERRED/AMBIGUOUS both null, trgm RPC returned only the EXTRACTED id | PASS |
| Targeted repository tests (search_nodes + expand_neighbours) | `uv run pytest tests/test_knowledge_graph_repository.py -q --no-cov` | 25 passed | PASS |
| Targeted executor tests | `uv run pytest tests/infrastructure/tools/test_search_knowledge_executor.py -q --no-cov` | 11 passed | PASS |
| Belt-2 field-omission proofs independently selectable | `uv run pytest tests/infrastructure/tools/test_search_knowledge_executor.py -k "belt_two or field_omission" -q --no-cov` | 2 passed | PASS |
| Container exposure-gate tests | `uv run pytest tests/test_container.py -q --no-cov` | included in full sweep, both new tests pass | PASS |
| Full phase 34/35/36/37 regression sweep | `uv run pytest tests/test_knowledge_graph_repository.py tests/infrastructure/tools/test_search_knowledge_executor.py tests/test_container.py tests/infrastructure/tools/ tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn_real_tools_wiring.py --no-cov` | 94 passed, 0 failed | PASS |
| mypy on all touched files | `uv run mypy app/domain/ports/knowledge_graph_repository.py app/infrastructure/supabase/knowledge_graph_repository.py app/infrastructure/tools/search_knowledge_executor.py app/infrastructure/tools/envelope.py app/settings.py app/container.py` | 12 pre-existing errors, all in 4 unrelated files (genui_generator_adapter, genui_code_generator_adapter, supabase_ui_spec_template_repository, supabase_chat_widget_interaction_repository) — zero in phase 37 files | PASS |
| ruff on touched files | `uv run ruff check <6 files>` | "All checks passed!" | PASS |
| lint-imports | `uv run lint-imports` | "Contracts: 3 kept, 0 broken" | PASS |
| Anti-pattern scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) on 7 touched source files | `grep -n -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` | zero matches | PASS |
| No unexpected files touched across the phase's commit range | `git diff --name-only 07ca6ce~1 9ef100d` | Exactly the 2 plans' declared `files_modified` (+ expected `.planning`/ROADMAP/STATE docs) — no `run_chat_turn.py` edits, no scope creep | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| TOOL-03 | 37-01, 37-02 | User can search/expand knowledge graph via `search_knowledge(query, mode: search\|expand)` backed by new Python repo + RPCs, top-8/300-char truncation | SATISFIED | Executor + repo methods fully implemented and tested (dark, per SC5) |
| TOOL-04 | 37-01, 37-02 | Non-EXTRACTED tiers can never leak free text — field omission, not flag-gated, backed by DB-level extracted_only view | SATISFIED | Two independent belts: SQL view (live-verified) + `_belt_two_label` (unit-tested with hostile mocked rows) |

No orphaned requirements — REQUIREMENTS.md maps only TOOL-03/TOOL-04 to Phase 37, both claimed by the two plans.

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) in any touched file. No stub returns, no hardcoded empty envelopes, no orphaned wiring.

### Human Verification Required

None. This phase is backend-only (Python repository + SQL migration + ToolExecutor), explicitly not user-facing this phase (SC5: dark by design, `SEARCH_KNOWLEDGE_TOOL_ENABLED=False`). Every observable truth is verifiable via code inspection, unit tests, and a live-DB script — all independently re-run during this verification, not merely re-read from SUMMARY.md.

### Gaps Summary

None found. All 9 merged must-haves (5 ROADMAP success criteria + plan-specific detail) are verified against the actual codebase, not SUMMARY claims:
- Migration 0029 applied and re-verified live by the verifier (not trusted from SUMMARY.md screenshots).
- Both repository methods (`search_nodes`, `expand_neighbours`) read in full, their 15 targeted tests independently re-run.
- The `_belt_two_label` belt-2 defense re-derives omission from `tier` alone, grep-confirmed as the sole reader of `title`/`content` in the executor file.
- The exposure gate (`SEARCH_KNOWLEDGE_TOOL_ENABLED=False`) is enforced by immutable, mutation-free dict construction and covered by a permanent CI regression test.
- Zero scope creep: `git diff` across the full commit range touches exactly the files each plan declared.

---

_Verified: 2026-07-09_
_Verifier: Claude (gsd-verifier)_
