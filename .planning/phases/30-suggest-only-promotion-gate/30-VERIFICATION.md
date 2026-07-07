---
phase: 30-suggest-only-promotion-gate
verified: 2026-07-07T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 30: Suggest-Only Promotion Gate Verification Report

**Phase Goal:** Synthesis-generated relationships surface only as human-reviewable suggestions —
never as auto-trusted truth — so "being wrong is expensive" is a property of the tier itself, not a
bolt-on check (the design-case defense narrative).
**Verified:** 2026-07-07
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Synthesis-generated edges are created with tier INFERRED or AMBIGUOUS (never EXTRACTED) and are visibly distinguished as suggestions wherever edges are surfaced | ✓ VERIFIED | `synthesize_knowledge.py:173-208` emits two hardcoded-tier loops (`_TIER_INFERRED`/`_TIER_AMBIGUOUS`, `source="synthesis"`) with no branch that can reach `tier="EXTRACTED"`; `graph.ts` `shapeExplicitEdgeRow` (line 138-149) carries `tier` on every `kne-*` edge and excludes inactive rows; `GraphEdge.tier?: string` added to the interface (line 89). Read live, not paraphrased from SUMMARY. |
| 2 | The auto-injection query path returns only EXTRACTED-tier edges — INFERRED/AMBIGUOUS excluded even when present, verified by a seeded three-tier test | ✓ VERIFIED | `knowledge_graph_repository.py` (adapter) `list_injectable_edges` filters `.eq("tier","EXTRACTED").eq("is_active",True)` scoped to the importer's node ids (lines 192-215). `test_list_injectable_edges_excludes_suggestion_tiers` exists at `tests/test_knowledge_graph_repository.py:193` and passes (ran directly, not trusted from SUMMARY). |
| 3 | A human reviewer has an explicit confirm/promote action that changes a suggested edge's tier to EXTRACTED | ✓ VERIFIED | `POST /v1/knowledge/edges/{edge_id}/promote` (`knowledge_edges.py`) behind `Depends(require_api_key)`, calls `PromoteEdgeUseCase.execute` → `promote_edge` repo method which flips tier to `EXTRACTED` via a CAS-guarded update (`.eq("is_active",True).in_("tier",["INFERRED","AMBIGUOUS"])`). Router registered in `main.py:75`; DI factory `_provide_promote_edge_use_case` registered in `container.py:838`. Container build verified live (`create_container()` succeeds). |
| 4 | Promoting an edge records promotion provenance (what was promoted, when, from which suggestion) on the edge row, distinct from the original synthesis provenance | ✓ VERIFIED | Migration `0027_edge_promotion_provenance.sql` adds nullable `promotion jsonb` column, distinct from the pre-existing `provenance` column; journal entry idx=27 present. Live-verified against local Postgres: `tsx scripts/verify-0027-live.ts` → "VERIFICATION PASSED", confirming `promotion` udt=jsonb nullable=YES alongside unchanged `provenance`. `PromoteEdgeUseCase.execute` writes `{promoted_at, from_tier, mechanism:'human_promote'}` to `promotion` and never touches `provenance` (code read directly, lines 92-97). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/application/use_cases/synthesize_knowledge.py` | Suggestion-edge emission (INFERRED/AMBIGUOUS) | ✓ VERIFIED | Lines 173-208, contains `INFERRED`/`AMBIGUOUS` constants and emission loops, `source="synthesis"` hardcoded |
| `apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py` | `list_injectable_edges` EXTRACTED+active gate | ✓ VERIFIED | Lines 192-215, filters tier=EXTRACTED AND is_active=True |
| `packages/api-client/src/router/knowledge/graph.ts` | tier + isActive on GraphEdge for kne-* edges | ✓ VERIFIED | `GraphEdge.tier?`, `shapeExplicitEdgeRow` excludes inactive rows |
| `packages/db/migrations/0027_edge_promotion_provenance.sql` | nullable promotion jsonb column | ✓ VERIFIED | Idempotent `ADD COLUMN IF NOT EXISTS`, journaled idx=27, live-verified |
| `apps/email-listener/app/application/use_cases/promote_edge.py` | PromoteEdgeUseCase with fail-closed guard | ✓ VERIFIED | load → tenant guard → active guard → tier guard → CAS write, all rejections raised before any write |
| `apps/email-listener/app/presentation/api/v1/knowledge_edges.py` | authenticated POST promote endpoint | ✓ VERIFIED | `Depends(require_api_key)` router-wide, `POST /{edge_id}/promote`, wired in main.py |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `synthesize_knowledge.py` | `knowledge_graph_repository.insert_edge` | `insert_edge` calls with tier='INFERRED'/'AMBIGUOUS' source='synthesis' | ✓ WIRED | Confirmed at lines 185-193 (INFERRED) and 200-208 (AMBIGUOUS) |
| `graph.ts explicitEdgeRows` | `KnowledgeNodeEdges.tier` / `.isActive` | select + where is_active=true | ✓ WIRED | Confirmed lines 550-565; test coverage in graph.test.ts (14/14 pass) |
| `knowledge_edges.py endpoint` | `PromoteEdgeUseCase.execute` | FromDishka injected, typed rejection → 4xx | ✓ WIRED | Confirmed lines 58-82; EdgeNotFound→404, EdgeNotPromotable→409 |
| `PromoteEdgeUseCase` | `knowledge_graph_repository.promote_edge` | guard-then-flip, writes promotion jsonb | ✓ WIRED | Confirmed lines 92-99 of promote_edge.py; CAS filter in adapter lines 251-259 |
| `app.container` | `PromoteEdgeUseCase` DI | factory + provider registration | ✓ WIRED | `container.py:368-377` factory, `:838` registration; container build verified live |
| `app.main` | `knowledge_edges_router` | include_router | ✓ WIRED | `main.py:25` import, `:75` include_router |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Python test suite (both plans' targeted tests) | `uv run pytest tests/test_synthesize_knowledge.py tests/test_supabase_repositories.py tests/test_knowledge_graph_repository.py tests/test_promote_edge.py tests/test_promote_edge_endpoint.py -q --no-cov` | 59 passed | ✓ PASS |
| tRPC graph seam tests | `npm test --workspace=@nauta/api-client -- graph` | 14/14 passed | ✓ PASS |
| Migration 0027 live verification | `npm run with-env -- tsx scripts/verify-0027-live.ts` | "VERIFICATION PASSED" — promotion jsonb nullable=YES, provenance unchanged | ✓ PASS |
| ruff on touched files | `uv run ruff check ...` | All checks passed | ✓ PASS |
| lint-imports (hexagonal boundary) | `uv run lint-imports` | 3 kept, 0 broken | ✓ PASS |
| Container DI build | `create_container()` invoked directly | "container OK" | ✓ PASS |

### Suggest-Only Hard Invariant Check

Grepped the codebase for any consumer of `INFERRED`/`AMBIGUOUS` tier edges outside the
synthesis-emission and display/promotion paths. Only matches: the four Phase-30 files themselves
(synthesizer, ports, adapters, endpoint) plus an unrelated `_AMBIGUOUS_TOKEN_COUNT_FLOOR` constant
in `app/domain/anticipatory/triggers.py` (a different domain concept — token-count ambiguity in
anticipatory prompting, unrelated to edge tiers). No auto-injection consumer, prompt-builder, or
background job reads suggestion-tier edges. `list_injectable_edges` remains the only gate any future
consumer may call.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| TIER-02 | 30-01-PLAN.md | Synthesis-generated edges enter as INFERRED/AMBIGUOUS suggestions — display-only, never trusted for automatic prompt injection | ✓ SATISFIED | Emission loops + `list_injectable_edges` gate + seeded exclusion test, all verified above |
| TIER-03 | 30-02-PLAN.md | A human confirmation promotes an edge to EXTRACTED with promotion provenance recorded; only EXTRACTED edges are eligible for auto-injection | ✓ SATISFIED | Migration 0027 + PromoteEdgeUseCase + authenticated endpoint, all verified above |

REQUIREMENTS.md marks both TIER-02 and TIER-03 as Complete/Phase 30 — consistent with code evidence.
No orphaned requirements found for Phase 30.

### Anti-Patterns Found

None. No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER markers in any Phase 30 file. No empty implementations,
no hardcoded-empty stub returns, no console.log-only handlers.

### Human Verification Required

None. All four ROADMAP success criteria are code-level, testable claims (edge tier emission, gated
read path, promotion endpoint, promotion provenance) and were verified directly against the running
code, passing test suites, and a live local-Postgres migration check — no UI, visual, or live-Bedrock
dependency exists in this phase's scope (Phase 30 explicitly defers promote/dismiss UI chrome to
Phase 32).

### Gaps Summary

No gaps. All must-haves from both 30-01-PLAN.md and 30-02-PLAN.md frontmatter, and all 4 ROADMAP
Phase 30 success criteria, were independently verified by reading the actual code (not trusting
SUMMARY.md prose), running the targeted Python + TS test suites (59 + 14 tests, all passing), running
the live migration verification script against local Postgres, confirming ruff/lint-imports clean,
and confirming the DI container builds. Known pre-existing issues (test_genui_retrieval_provider.py
flake, pre-existing mypy error in test_confirm_region.py) were not re-triggered and are out of scope.

---

_Verified: 2026-07-07_
_Verifier: Claude (gsd-verifier)_
