---
phase: 31-recall-measurement
verified: 2026-07-07T23:50:51Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 31: Recall & Measurement Verification Report

**Phase Goal:** Autofill prompts recall an entity's already-known aliases and identifiers cheaply,
and every autofill run's retrieval outcome is measured well enough to tell whether the deferred
BFS graph-expand (stage 3) would ever be worth building.
**Verified:** 2026-07-07T23:50:51Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An autofill run for a resolved entity includes that entity's `aliases[]`/`identifiers` in the few-shot prompt payload | ✓ VERIFIED | `autofill_adapter.py::_render_entity_context_block` wraps aliases/identifiers in `<known_entity_context>` and appends to `user_content` only; `autofill.py::_resolve_entity_context` reads the resolved entity and passes `entity_context=` to `autofiller.autofill(...)`. 12 tests in `test_autofill_adapter_examples.py` assert alias/identifier strings appear in the constructed user message and are absent from `system`. Full targeted suite (31/31) passes live. |
| 2 | No BFS/graph traversal introduced; direct `entity_instances` read; zero new migrations for the injection half | ✓ VERIFIED | `grep -rn "knowledge_node_edges"` on `autofill.py` and `autofill_adapter.py` returns zero hits. Entity read is via `EntityInstanceRepository.find_selected_instance_for_component` / `find_unselected_candidate_instances_for_component` (existing suggest-only link paths). Only migration 0028 exists for the phase, and it belongs to the instrumentation half (RECALL-02), not the injection half — consistent with the roadmap's carve-out ("zero new migrations" for RECALL-01 specifically). |
| 3 | Every autofill run persists an instrumentation record (seed hits, injected context, later-correction joinable) | ✓ VERIFIED | `autofill.py::_save_retrieval_event` builds an `AutofillRetrievalEvent` (seed_hits, seed_hit_count, injected_entity_instance_id, injected_alias_count, injected_identifier_count, routing_reason, created_at) and calls `AutofillRetrievalEventRepository.save` at the end of every `execute` call, inside try/except. `SupabaseAutofillRetrievalEventRepository.save` also swallows exceptions (defense in depth). Live migration 0028 verified against local Postgres (`verify-0028-live.ts` → VERIFICATION PASSED, all 11 columns + `relrowsecurity=true` + both RESTRICTIVE policies confirmed). |
| 4 | A retrieval-miss rate is computable from persisted data with a written miss definition | ✓ VERIFIED | `packages/db/scripts/retrieval-miss-rate.ts` joins `autofill_retrieval_events` to `extraction_records` on `component_id`, classifying Type A/Type B misses; run live against local Postgres printed `total_runs=0 miss_rate=0.0000` then a self-test fixture (`total_runs=1 miss_type_b=1 miss_rate=1.0000`) → `Self-test PASSED` / `VERIFICATION PASSED`. `RETRIEVAL-MISS-RATE.md` documents both miss types and names the artifact the stage-3 go/no-go gate. `grep -ni "UPDATE\|DELETE"` on the script returns zero hits (query-time join only, no mutation). |
| 5 | Instrumentation write failure never breaks autofill (best-effort) | ✓ VERIFIED | `test_autofill_instrumentation.py` includes a best-effort-isolation test proving a raising `save` does not propagate; `execute` still returns an `AutofillResult`. Two independent swallow layers: `SupabaseAutofillRetrievalEventRepository.save` (adapter-level) + `AutofillUseCase._save_retrieval_event` (use-case-level try/except). |
| 6 | Entity-read failure never breaks autofill (best-effort) | ✓ VERIFIED | `_resolve_entity_context` wraps the repository read in try/except, logs a warning, returns `None` on failure. `test_autofill_entity_context.py` proves `execute` still completes and `autofiller.autofill` is still called (with no `entity_context`) when the repo raises. |
| 7 | Cold-start contract preserved (examples=() + no entity_context → single unchanged user message) | ✓ VERIFIED | Byte-identical regression test in `test_autofill_adapter_examples.py`; confirmed passing in the live pytest run. |
| 8 | Human-correction linkage derivable at query time (no event mutation, single write path) | ✓ VERIFIED | `retrieval-miss-rate.ts` joins on `component_id` against `extraction_records.corrected_fields`; no second write path exists — `AutofillRetrievalEventRepository` exposes only `save`, no update method. |
| 9 | Tenant isolation on the resolved-entity read | ✓ VERIFIED | `_resolve_entity_context` is called after `importer_id` is derived from the component (D-18); `test_autofill_entity_context.py` includes a tenant-scoping test. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/infrastructure/llm/autofill_adapter.py` | Few-shot + entity-context rendering, user-turn only | ✓ VERIFIED | `_render_examples_block`, `_render_entity_context_block`, `_MAX_RENDERED_ALIASES=20` cap, D-14 system-prompt isolation preserved |
| `apps/email-listener/app/domain/ports/autofill_protocol.py` | `entity_context` kwarg | ✓ VERIFIED | Present, documented |
| `apps/email-listener/app/application/use_cases/autofill.py` | Resolved-entity read + instrumentation write | ✓ VERIFIED | `_resolve_entity_context`, `_save_retrieval_event`, both best-effort |
| `apps/email-listener/app/container.py` | DI wiring for entity_instances + retrieval_events | ✓ VERIFIED | `_provide_autofill_retrieval_event_repository`, both params passed through `_provide_autofill_use_case`; `test_container.py` boots cleanly (12/12 pass) |
| `packages/db/migrations/0028_autofill_retrieval_events.sql` | Event table + RLS deny-all | ✓ VERIFIED | CREATE TABLE + 3 indexes + RESTRICTIVE deny-all for anon/authenticated; live-applied and verified |
| `packages/db/scripts/verify-0028-live.ts` | Live pg verification | ✓ VERIFIED | Ran live against local Postgres → VERIFICATION PASSED |
| `packages/db/src/schema/autofill-retrieval-events.ts` | Drizzle schema | ✓ VERIFIED | Exists, barrel-exported |
| `apps/email-listener/app/infrastructure/supabase/autofill_retrieval_event_repository.py` | Best-effort event writer | ✓ VERIFIED | asyncio.to_thread offload, catch-log-swallow |
| `packages/db/scripts/retrieval-miss-rate.ts` | Computable miss-rate query/report | ✓ VERIFIED | Ran live, printed numeric rate + self-test |
| `packages/db/scripts/RETRIEVAL-MISS-RATE.md` | Written miss definition | ✓ VERIFIED | Type A/Type B defined, named as stage-3 gate |
| `apps/email-listener/tests/test_autofill_adapter_examples.py` | Prompt-content assertions | ✓ VERIFIED | 12 tests, all pass |
| `apps/email-listener/tests/test_autofill_entity_context.py` | Entity-context injection tests | ✓ VERIFIED | 6 tests, all pass |
| `apps/email-listener/tests/test_autofill_instrumentation.py` | Instrumentation write tests | ✓ VERIFIED | 6 tests, all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `autofill.py::execute` | `EntityInstanceRepository.find_selected_instance_for_component` | domain port read | ✓ WIRED | Called in `_resolve_entity_context`, fallback to unselected candidates |
| `autofill.py::execute` | `AutofillProtocol.autofill` | `entity_context=` kwarg | ✓ WIRED | `grep -n "entity_context=" autofill.py` → 1 hit |
| `autofill.py::execute` | `AutofillRetrievalEventRepository.save` | best-effort instrumentation write | ✓ WIRED | `_save_retrieval_event` called at end of every `execute`; `grep -n "retrieval_event"` → 11 hits |
| `retrieval-miss-rate.ts` | `autofill_retrieval_events` + `extraction_records` | query-time join on `component_id` | ✓ WIRED | Confirmed live (`grep corrected_fields` in script; live run printed correct classification) |
| `container.py` | `AutofillUseCase` | `entity_instances`/`retrieval_events` DI | ✓ WIRED | `test_container.py` passes (container boots) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted autofill/instrumentation test suite | `pytest tests/test_autofill_adapter_examples.py tests/test_autofill_entity_context.py tests/test_autofill_instrumentation.py tests/test_autofill_use_case.py tests/test_autofill_adapter.py -q --no-cov` | 31/31 passed | ✓ PASS |
| Full email-listener suite (excl. known flake) | `pytest tests/ -q --no-cov --ignore=tests/test_genui_retrieval_provider.py` | all green, only expected env-gated skips | ✓ PASS |
| Migration 0028 live verification | `npm run with-env -- tsx scripts/verify-0028-live.ts` | VERIFICATION PASSED (11 columns, RLS on, both policies) | ✓ PASS |
| Retrieval-miss-rate live run | `npm run with-env -- tsx scripts/retrieval-miss-rate.ts` | `total_runs=0 miss_rate=0.0000`; self-test `miss_rate=1.0000` PASSED; VERIFICATION PASSED | ✓ PASS |
| ruff on all touched Python files | `ruff check <files>` | All checks passed | ✓ PASS |
| mypy on all touched Python files | `mypy <files>` | Success: no issues found | ✓ PASS |
| lint-imports (hexagonal contract) | `lint-imports` | 3/3 contracts kept | ✓ PASS |
| tsc typecheck on packages/db | `npx tsc --noEmit` | clean | ✓ PASS |
| No graph-edge reference in injection path | `grep -rn "knowledge_node_edges" autofill.py autofill_adapter.py` | 0 hits | ✓ PASS |
| No event mutation in miss-rate script | `grep -ni "UPDATE\|DELETE" retrieval-miss-rate.ts` | 0 hits | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RECALL-01 | 31-01-PLAN.md | Autofill few-shot prompts include resolved entity's aliases[]/identifiers (no BFS/graph traversal) | ✓ SATISFIED | `autofill_adapter.py` + `autofill.py` verified above |
| RECALL-02 | 31-02-PLAN.md | Retrieval outcomes instrumented per autofill run; miss rate measurable | ✓ SATISFIED | migration 0028, `_save_retrieval_event`, `retrieval-miss-rate.ts` verified above |

No orphaned requirements — both RECALL-01/RECALL-02 map to plans that exist and were verified.

### Anti-Patterns Found

None. `grep` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across all phase-modified Python files returned zero matches. No stub returns, no empty handlers, no hardcoded-empty data flowing to output.

### Human Verification Required

None. All four roadmap success criteria are code-level verifiable (prompt-content assertions via unit tests substitute for a live-Bedrock capture; the delimited block construction is deterministic and directly inspectable in `_generate`'s `user_content` construction, which the test suite asserts against byte-for-byte). No live-Bedrock-only claim was required to establish the goal.

### Gaps Summary

None. All 9 derived truths verified against live code execution (pytest, live Postgres migration verify, live miss-rate script run), not just SUMMARY.md narrative. Both plans' commits, tests, migration, and artifacts exist, are substantive, are wired end-to-end through `container.py`, and pass ruff/mypy/lint-imports/tsc cleanly. Zero regressions in the full test suite.

---

_Verified: 2026-07-07T23:50:51Z_
_Verifier: Claude (gsd-verifier)_
