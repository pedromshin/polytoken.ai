---
phase: 29-tier-ladder-edge-materialization
verified: 2026-07-07T19:26:12Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "End-to-end live confirm: confirm a region in the review UI against local Supabase + live Bedrock, then query knowledge_nodes/knowledge_node_edges directly for that importer"
    expected: "A knowledge_node row appears with tier=EXTRACTED, and knowledge_node_edges rows appear (evidenced_by anchor with provenance jsonb containing component_id/page_index/polygon/tokens, co_occurs_with edges to other confirmed components in the same email, and an about edge when a selected entity instance exists)"
    why_human: "The synthesis path is proven at the unit/adapter level (AsyncMock ports, MagicMock Supabase call-shape) and the migration is live-verified in local Postgres, but no test in this phase writes real rows to the live knowledge_nodes/knowledge_node_edges tables through a real confirm-region HTTP call — that requires a live Bedrock embedding call (ConfirmRegionUseCase always embeds before synthesis) plus a real OCR'd document with a confirmable region, which this autonomous verification pass cannot drive"
  - test: "Re-confirm the same region a second time and query knowledge_node_edges directly"
    expected: "The prior edge set is is_active=false (not deleted), a fresh is_active=true edge set exists, and exactly one active anchor edge remains for the node — no duplicate or orphaned rows"
    why_human: "Supersede-safety (SYNTH-03) is proven by AsyncMock unit tests asserting call ordering (deactivate_edges_for_node before insert_edge) and by adapter tests asserting update-not-delete call shape, but not by an actual second live confirm against real rows"
---

# Phase 29: Tier Ladder + Edge Materialization Verification Report

**Phase Goal:** Confirming a region in the review UI durably materializes provenance-carrying
knowledge graph edges — every future correction compounds instead of evaporating — and every
node/edge carries an ordinal trust tier so that provenance is trustworthy from the first row
written.
**Verified:** 2026-07-07T19:26:12Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `knowledge_nodes` and `knowledge_node_edges` each carry a non-null ordinal `tier` column (EXTRACTED\|INFERRED\|AMBIGUOUS) added via a Drizzle migration in `packages/db/migrations/`; `confidence real` retained | ✓ VERIFIED | `packages/db/migrations/0026_knowledge_trust_tier.sql` creates enum + adds `tier` NOT NULL DEFAULT 'AMBIGUOUS' to both tables; `packages/db/src/schema/knowledge-nodes.ts`/`knowledge-node-edges.ts` carry matching Drizzle columns; `confidence real` untouched in both schema files. Live-verified by re-running `packages/db/scripts/verify-0026-live.ts` against local Supabase Postgres in this verification pass: `knowledge_trust_tier enum labels: EXTRACTED,INFERRED,AMBIGUOUS`; both tables' `tier` columns present NOT NULL default `'AMBIGUOUS'`; `npx tsc --noEmit` clean in `packages/db`. Journal entry `idx: 26, tag: "0026_knowledge_trust_tier"` confirmed in `meta/_journal.json`. |
| 2 | Confirming a region creates `knowledge_nodes` + EXTRACTED-tier `knowledge_node_edges` rows linking the confirmed entity/field to co-occurring entities and importer scope — queryable immediately after confirm | ✓ VERIFIED (code path) / needs live confirm | `KnowledgeSynthesizerService.synthesize_from_confirmation` (`apps/email-listener/app/application/use_cases/synthesize_knowledge.py`) upserts one node with `tier="EXTRACTED"`, then inserts an anchor `evidenced_by` edge, `co_occurs_with` edges per other confirmed entity component in the email, and a conditional `about` edge — all `tier="EXTRACTED"`. `ConfirmRegionUseCase` (confirm_region.py:182-192) invokes it after `update_embedding`. `container.py:_provide_confirm_region_use_case` wires `SupabaseKnowledgeGraphRepository` + `KnowledgeSynthesizerService` into the real DI graph — confirmed by instantiating `create_container()` live in this pass (no dishka resolution errors). `SupabaseKnowledgeGraphRepository.insert_edge`/`upsert_node` are real (non-mocked) `.table(...).insert(...).execute()` calls against the Supabase client. No live confirm-region HTTP call was exercised in this verification pass (requires live Bedrock embedding) — see human_verification. |
| 3 | Each edge's provenance references exact OCR token-polygon(s) (`content_raw.tokens`/`location.polygon`), inspectable on the edge row | ✓ VERIFIED | `_token_provenance.capture_provenance(page, polygon)` re-derives tokens from `_page_tokens` (byte-identical bbox-overlap predicate to the original `edit_region._capture_text`); the synthesizer builds `provenance = {component_id, page_index, polygon, tokens}` and passes it to `insert_edge` for the anchor edge; `SupabaseKnowledgeGraphRepository._edge_to_row` writes it into the `provenance jsonb` column (NUL-sanitized via `strip_nul`). Unit tests (`test_synthesize_knowledge.py`) assert the anchor edge's provenance dict has exactly these four keys and `tier="EXTRACTED"`. |
| 4 | Re-confirming or superseding an already-confirmed region updates its edges without creating duplicate or orphaned rows | ✓ VERIFIED (code path) | Node identity is 1:1 with the region (`scope_ref_id=component_id`), so `find_active_node` on re-confirm returns the existing node id; `deactivate_edges_for_node(node_id)` is called (verified never called on first confirm, always called before any `insert_edge` on re-confirm — asserted via `mock_calls` ordering in `test_synthesize_knowledge.py`) before the fresh edge set is inserted. `deactivate_edges_for_node` issues `.update({"is_active": False})` filtered by `source_node_id`+`is_active=True` — a test explicitly asserts `.delete` is never called on the mock client. No live re-confirm was exercised against real rows in this pass — see human_verification. |

**Score:** 4/4 truths code-verified; 2 items need a live human/browser+Bedrock pass to observe real rows.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0026_knowledge_trust_tier.sql` | enum + ALTER TABLE migration, idempotent | ✓ VERIFIED | Present, idempotent (DO-block guard + `IF NOT EXISTS`), journaled, live-applied |
| `packages/db/src/schema/knowledge-nodes.ts` | `knowledgeTrustTierEnum` + `tier` column | ✓ VERIFIED | Present with ordinal doc comment; `confidence` unchanged |
| `packages/db/src/schema/knowledge-node-edges.ts` | `tier` + `provenance` + `isActive` columns | ✓ VERIFIED | All three present, shared enum imported |
| `apps/email-listener/app/application/use_cases/_token_provenance.py` | shared token∩polygon helper | ✓ VERIFIED | `capture_provenance`/`capture_text` present, `edit_region.py` delegates to it |
| `apps/email-listener/app/domain/ports/knowledge_synthesizer.py` | `KnowledgeSynthesizer` Protocol | ✓ VERIFIED | `synthesize_from_confirmation` signature matches hook contract; no infra imports (lint-imports clean) |
| `apps/email-listener/app/domain/ports/knowledge_graph_repository.py` | `KnowledgeGraphRepository` Protocol | ✓ VERIFIED | All 5 methods present; no infra imports |
| `apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py` | Supabase adapter | ✓ VERIFIED | Implements all 5 methods; `strip_nul` sanitization; delete-never supersede |
| `apps/email-listener/app/application/use_cases/synthesize_knowledge.py` | `KnowledgeSynthesizerService` | ✓ VERIFIED | 1:1 node identity, supersede ordering, anchor/co-occurrence/about edges, page-missing guard |
| `apps/email-listener/app/application/use_cases/confirm_region.py` | wired best-effort hook | ✓ VERIFIED | try/except around synthesis call, `confirmed_record` hoisted to avoid UnboundLocalError |
| `apps/email-listener/app/container.py` | DI wiring | ✓ VERIFIED | `_provide_confirm_region_use_case` factory registered; container builds live (verified in this pass) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `knowledge-node-edges.ts` | `knowledge-nodes.ts` | shared `knowledgeTrustTierEnum` import | ✓ WIRED | Confirmed by import + `npx tsc --noEmit` clean |
| `edit_region.py` | `_token_provenance.py` | `capture_text` import | ✓ WIRED | 53 edit_region/capture tests pass |
| `SupabaseKnowledgeGraphRepository` | `knowledge_node_edges` table | `.table("knowledge_node_edges").insert/update` | ✓ WIRED | Real (non-mocked) PostgREST calls in adapter; call-shape tests + code review confirm |
| `synthesize_knowledge.py` | `knowledge_graph_repository.py` (port) | `upsert_node`/`deactivate_edges_for_node`/`insert_edge` | ✓ WIRED | 8/8 AsyncMock unit tests pass, including ordering assertion |
| `synthesize_knowledge.py` | `_token_provenance.py` | `capture_provenance` | ✓ WIRED | Called with resolved page + polygon; page-missing fallback tested |
| `confirm_region.py` | `knowledge_synthesizer.py` (port) | `self._knowledge_synthesizer.synthesize_from_confirmation(...)` | ✓ WIRED | Best-effort try/except confirmed in source; 4 new tests pass including ordering-after-update_embedding |
| `container.py` | `knowledge_graph_repository.py` (adapter) | `_provide_confirm_region_use_case` factory | ✓ WIRED | Container builds live without dishka resolution errors (re-verified in this pass) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 0026 live in local Postgres | `npm run with-env -- tsx scripts/verify-0026-live.ts` (packages/db) | `VERIFICATION PASSED: all assertions confirmed live` — enum labels EXTRACTED,INFERRED,AMBIGUOUS; all 4 columns + partial index present | ✓ PASS |
| Drizzle schema typechecks | `npx tsc --noEmit -p tsconfig.json` (packages/db) | no output (clean) | ✓ PASS |
| Phase 29 Python test suite | `uv run pytest tests/test_confirm_region.py tests/test_synthesize_knowledge.py tests/test_knowledge_graph_repository.py tests/test_supabase_repositories.py -q --no-cov` | 47 passed | ✓ PASS |
| mypy on Phase 29 files | `uv run mypy <7 phase-29 files>` | 0 errors in the 7 target files (13 total errors reported are all in pre-existing unrelated files: genui_generator_adapter.py, genui_code_generator_adapter.py, supabase_ui_spec_template_repository.py, supabase_chat_widget_interaction_repository.py, and the one pre-existing test_confirm_region.py:156 dict-invariance error) | ✓ PASS |
| ruff on Phase 29 files | `uv run ruff check <7 phase-29 files>` | All checks passed | ✓ PASS |
| Hexagonal architecture contracts | `uv run lint-imports` | Contracts: 3 kept, 0 broken | ✓ PASS |
| DI container builds live | `create_container()` (async, live run in this verification pass) | "container created ok", no dishka `GraphMissingFactoryError` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| TIER-01 | 29-01 | Every knowledge node/edge carries ordinal trust tier; confidence retained | ✓ SATISFIED | Migration 0026 + schema + live verification |
| SYNTH-02 | 29-02 | Materialized edges carry OCR token-polygon provenance | ✓ SATISFIED | `_token_provenance.py` + adapter provenance jsonb write, tested |
| SYNTH-03 | 29-03 | Re-confirm/supersede updates edges without duplicates/orphans | ✓ SATISFIED (code path) | 1:1 node identity + deactivate-then-insert ordering, unit-tested; live re-confirm not exercised (human_verification) |
| SYNTH-01 | 29-04 | Confirm materializes knowledge_nodes + EXTRACTED edges, best-effort | ✓ SATISFIED (code path) | Hook wired, DI wired, container builds live; live confirm-to-query not exercised (human_verification) |

No orphaned requirements — all four IDs mapped to phase 29 in REQUIREMENTS.md are claimed across the four plans.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across all 10 Phase-29-modified/created source files returned zero matches.

### Human Verification Required

### 1. End-to-end live confirm materializes real rows

**Test:** In a running local stack (Bedrock reachable), confirm a region for an entity/field in the review UI, then query `knowledge_nodes` and `knowledge_node_edges` directly in local Supabase for that importer.
**Expected:** A `knowledge_nodes` row exists with `tier='EXTRACTED'`; `knowledge_node_edges` rows exist: one `evidenced_by` anchor edge with `provenance` containing `component_id`, `page_index`, `polygon`, non-empty `tokens`, plus `co_occurs_with` edges to any other confirmed entity components in the same email, and (if a selected entity instance exists) an `about` edge — all `tier='EXTRACTED'`, `is_active=true`.
**Why human:** The write path is proven correct at the unit/adapter/DI level (AsyncMock ports, MagicMock Supabase call-shape tests, live container build), but no automated test in this phase writes real rows through an actual HTTP confirm — `ConfirmRegionUseCase` always calls the embedder (live Bedrock) before the synthesis hook runs, which this autonomous verification pass cannot drive without a live document + browser session.

### 2. Re-confirm supersede against real rows

**Test:** Re-confirm the same region a second time (e.g. correct a field value), then query `knowledge_node_edges` for that node.
**Expected:** The prior edge set is `is_active=false` (rows still present, not deleted); a fresh `is_active=true` edge set exists; exactly one active anchor edge remains for the node — no duplicate or orphaned active rows.
**Why human:** Supersede ordering (`deactivate_edges_for_node` before `insert_edge`) and delete-never behavior are proven by unit/adapter tests with mocked clients, not by a second live confirm against real database rows.

### Gaps Summary

No code-level gaps found. All four ROADMAP success criteria have solid, tested, non-stub implementations: schema/migration live-verified against local Postgres, synthesizer/adapter/hook fully wired with passing unit tests (47/47), clean mypy/ruff/lint-imports on every phase-29 file, and a live DI container build with no resolution errors. The only reason this is not `passed` is that the phase's core dynamic behavior — real rows appearing in `knowledge_nodes`/`knowledge_node_edges` after a real confirm, and staying orphan-free after a real re-confirm — has only been exercised through mocks, per this project's established offline-pytest testing convention (no live Bedrock/DB write test exists for the use-case layer). This mirrors the project's standing pattern of parking live-Bedrock/browser checks as human verification items (see MEMORY.md "Local dev" / prior-phase verification reports) rather than a defect in this phase's implementation.

---

_Verified: 2026-07-07T19:26:12Z_
_Verifier: Claude (gsd-verifier)_
