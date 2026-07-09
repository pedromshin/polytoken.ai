---
phase: 35-cost-eval-scaffolding
verified: 2026-07-08T19:45:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 35: Cost + Eval Scaffolding Verification Report

**Phase Goal:** A per-round cost ceiling distinct from the existing per-turn/session/day caps is
enforced on the FOUND-3 ledger with defined fail-closed abort semantics, and retrieval-quality,
citation-faithfulness, and injection-resistance become measurable dimensions in the Phase-16 eval
harness — all built and provable against Phase 34's stub executor, before real data flows.
**Verified:** 2026-07-08T19:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | A per-round cost ceiling, distinct from per-turn/session/day, is enforced by the FOUND-3 ledger and re-checked at each round boundary | VERIFIED | `cost_circuit_breaker.py:71,77,164-172` — `per_round_cap_usd` param + `_per_round_cap` field + `should_abort_round(round_cost) -> bool` (`>=` threshold). `container.py:720` passes `per_round_cap_usd=settings.COST_CAP_PER_ROUND_USD`. Round boundary check at `run_chat_turn.py:1090-1096` (`_run_server_tool_round`) ORs `should_abort` and `should_abort_round`. `test_should_abort_round_is_distinct_from_should_abort_per_turn` (line 340-345) proves genuine distinctness on the same breaker instance |
| SC2 | Hitting the per-round ceiling mid-loop aborts with a defined `cost_capped` outcome that still emits the visible partial-text part | VERIFIED | `run_chat_turn.py:671-709` (`_terminal_status_for`) checks `should_abort_round` in BOTH the `TextDelta` and `UsageDelta` branches, returning the same `"cost_capped"` status Phase 34 established. `test_mid_round_text_cost_cap_aborts_with_visible_partial_text` (35-01 e2e suite) asserts the persisted message's last text part equals the pre-trip partial text and the post-trip text never appears |
| SC3 (TS half) | A golden query→expected-ids fixture set is registered as a retrieval-quality (recall/precision) dimension in the Phase-16 harness | VERIFIED | `packages/genui/src/eval/retrieval-golden-set.json` — 7 entries, all 3 `kind` values present, 3 entries with multi-element `expected_ids`. `retrieval-scorer.ts` exports `scoreRetrievalAtK`. Both re-exported from `eval/index.ts` as `RETRIEVAL_GOLDEN_SET`/`scoreRetrievalAtK`, schema-parsed at module load |
| SC3 (Python half) | Runnable against the stub executor from the Python side, one fixture source of truth | VERIFIED | `tests/evals/test_retrieval_golden_set.py::test_golden_entries_round_trip_through_echo_stub_score_perfectly` loads the real JSON via `eval_fixtures_dir()`, round-trips every entry through `EchoToolExecutor`, asserts `recall==precision==1.0` for all 7 entries. `_paths.py` resolves `packages/genui/src/eval` with no hand-copied duplicate (grep-verified, see Key Link Verification) |
| SC4 | Citation-faithfulness structural dimension is measurable | VERIFIED (structural only, per documented deferral) | `citation-scorer.ts` exports `validateCitationEnvelope` (route-template + envelope-membership checks) and `citationRouteMatchesTemplate` (exhaustive switch, all 3 kinds). `CITATION_FAITHFULNESS_RUBRIC` LLM-judge half is an explicit STUB per 35-CONTEXT.md/EVAL-DIMENSIONS.README.md — NOT a gap, a documented connected-env deferral (999.3-family) |
| SC5 (TS half) | Injection-resistance canary scorer, beyond "didn't call a tool" | VERIFIED | `injection-fixtures.json` — 4 fixtures, one per named category, every `retrievedText` embeds `[CANARY:token]`. `injection-scorer.ts` exports `extractCanary`/`scoreInjectionResistance`, checking VISIBLE TEXT for the leaked canary substring |
| SC5 (Python half) | Runnable/scoreable from the Python side against the same JSON | VERIFIED | `tests/evals/test_injection_fixtures.py::test_leaking_sample_text_is_flagged`/`test_clean_sample_text_is_not_flagged` load the real `injection-fixtures.json` via `eval_fixtures_dir()` and prove `score_injection_resistance` correctly flags/clears a canary for the same fixture |
| 35-01 artifacts/key_links | `should_abort_round`, `COST_CAP_PER_ROUND_USD`, round-scoped wiring | VERIFIED | All 3 plan artifacts present with required content markers; both key_links (container→breaker, run_chat_turn→breaker) grep-confirmed |
| 35-02 artifacts/key_links | Fixture files, 3 scorer modules, README, index.ts re-exports | VERIFIED | All 7 plan artifacts present with required content markers; both key_links (index.ts→schema, assets-test→index.ts) grep-confirmed |
| 35-03 artifacts/key_links | `_paths.py`, `_scorers.py`, 2 pytest runner modules | VERIFIED | All 4 plan artifacts present with required content markers; both key_links (`_paths.py`→genui JSON path, retrieval test→EchoToolExecutor import) grep-confirmed |

**Score:** 10/10 truths verified (0 overrides applied)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/domain/services/cost_circuit_breaker.py` | `should_abort_round` distinct per-round abort signal | VERIFIED | Lines 71/77/164-172; `CapName` Literal unchanged (`["per_turn","per_session","per_day"]`, line 25) |
| `apps/email-listener/app/settings.py` | `COST_CAP_PER_ROUND_USD` default 0.15 | VERIFIED | Line 143 |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | round-scoped checks in `_terminal_status_for` + `_run_server_tool_round` | VERIFIED | `should_abort_round` called at lines 695/709 (mid-round) and 1090 (round boundary) |
| `packages/genui/src/eval/retrieval-golden-set.json` | 5-10 seed entries | VERIFIED | 7 entries, all 3 kinds present |
| `packages/genui/src/eval/injection-fixtures.json` | 3-5 canary fixtures | VERIFIED | 4 entries, every `retrievedText` has `[CANARY:...]` |
| `packages/genui/src/eval/retrieval-scorer.ts` | `scoreRetrievalAtK` | VERIFIED | Exported, zero-division safe |
| `packages/genui/src/eval/citation-scorer.ts` | `validateCitationEnvelope` + rubric stub | VERIFIED | Exported, exhaustive switch |
| `packages/genui/src/eval/injection-scorer.ts` | `scoreInjectionResistance` | VERIFIED | Exported, canary regex matches Python side |
| `packages/genui/src/eval/EVAL-DIMENSIONS.README.md` | scoring contracts + Python bridge path contract | VERIFIED | Documents `tests/evals` bridge explicitly |
| `apps/email-listener/tests/evals/_paths.py` | `eval_fixtures_dir()` | VERIFIED | Bounded `parents[4]` walk-up, resolves and exists on disk |
| `apps/email-listener/tests/evals/_scorers.py` | `score_retrieval_at_k`/`extract_canary`/`score_injection_resistance` | VERIFIED | Pure Python mirrors, same regex/math as TS |
| `apps/email-listener/tests/evals/test_retrieval_golden_set.py` | echo-stub round-trip scoring | VERIFIED | Imports `EchoToolExecutor`, scores 1.0/1.0 |
| `apps/email-listener/tests/evals/test_injection_fixtures.py` | canary-leak proof | VERIFIED | Imports `score_injection_resistance`, leaking + clean cases |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `container.py` | `cost_circuit_breaker.py` | `per_round_cap_usd=settings.COST_CAP_PER_ROUND_USD` | WIRED | Line 720 |
| `run_chat_turn.py` | `cost_circuit_breaker.py` | `self._breaker.should_abort_round(...)` at mid-round + boundary | WIRED | Lines 695, 709, 1090 |
| `eval/index.ts` | `eval-dimensions-schema.ts` | re-exports + `RETRIEVAL_GOLDEN_SET`/`INJECTION_FIXTURES` parsed constants | WIRED | Lines 52-95 |
| `eval-dimensions-assets.test.ts` | `eval/index.ts` | imports `RETRIEVAL_GOLDEN_SET`/`INJECTION_FIXTURES` | WIRED | 12 passing assertions |
| `tests/evals/_paths.py` | `packages/genui/src/eval/retrieval-golden-set.json` | `eval_fixtures_dir() / "retrieval-golden-set.json"` | WIRED | `test_retrieval_golden_set.py:25`; resolved dir confirmed `.is_dir()` via passing test |
| `tests/evals/test_retrieval_golden_set.py` | `tests/support/echo_tool_executor.py` | `from tests.support.echo_tool_executor import EchoToolExecutor` | WIRED | Line 21, exercised in `test_golden_entries_round_trip_through_echo_stub_score_perfectly` |
| One-fixture-source-of-truth | (no duplicate) | grep for fixture content across repo | CONFIRMED | `entity-acme-logistics`/`INJ_DELIM_9f2a` markers found ONLY inside `packages/genui/src/eval/*.json` (+ docs/plans referencing them) — no second data copy in `apps/email-listener/**` |

### Behavioral Spot-Checks / Test Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 35-01 full regression suite | `uv run pytest tests/test_cost_circuit_breaker.py tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py tests/application/test_emit_ui_spec_tool.py tests/test_container.py -q --no-cov` | 87 passed | PASS |
| 35-01 mypy | `uv run mypy app/domain/services/cost_circuit_breaker.py app/settings.py app/container.py app/application/use_cases/run_chat_turn.py` | 12 pre-existing errors in 4 UNTOUCHED infra files (genui_generator_adapter.py, genui_code_generator_adapter.py, supabase_ui_spec_template_repository.py, supabase_chat_widget_interaction_repository.py); zero errors in the 4 target files | PASS |
| 35-01 lint-imports | `uv run lint-imports` | 226 files, 969 deps; Contracts: 3 kept, 0 broken | PASS |
| 34/35-01 regression check | `uv run pytest tests/test_cost_circuit_breaker.py tests/application/test_run_chat_turn_tool_loop_e2e.py -q --no-cov` | 32 passed | PASS |
| 35-02 targeted TS tests | `npm run test -w @nauta/genui -- run src/eval/__tests__/scorers.test.ts src/__tests__/eval-dimensions-assets.test.ts src/__tests__/eval-assets.test.ts` | 3 files, 40 tests passed | PASS |
| 35-02 full package regression | `npm run test -w @nauta/genui` | 28 files, 501 tests passed | PASS |
| 35-02 typecheck | `npm run typecheck -w @nauta/genui` | clean (tsc --noEmit, no output) | PASS |
| 35-03 pytest suite | `uv run pytest tests/evals/ -q --no-cov` | 16 passed | PASS |
| 35-03 ruff | `uv run ruff check tests/evals` | All checks passed | PASS |
| 35-03 mypy | `uv run mypy tests/evals/_paths.py tests/evals/_scorers.py` | Success: no issues found in 2 source files | PASS |
| 35-03 collection-only (non-test-module proof) | `uv run pytest tests/evals/ --collect-only -q --no-cov` | 16 tests across exactly 3 `test_*.py` files (`_paths.py`/`_scorers.py` not collected) | PASS |
| Scope discipline | `git show --stat` on all 5 phase-35 commits (`e222c99`,`ae1bc9f`,`5e2ae05`,`caafc9e`,`30b2d3c`) grepped for `package.json\|pyproject.toml\|uv.lock\|migrations\|\.sql$` | zero matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| COST-05 | 35-01 | Per-round cost ceiling distinct from per-turn, mid-round `cost_capped` with visible partial text | SATISFIED | `should_abort_round` + round-boundary/mid-round wiring, 5 new passing tests |
| EVAL-06 | 35-02, 35-03 | Retrieval-quality golden set as measurable dimension | SATISFIED | TS scorer + fixtures + assets test; Python round-trip test scoring 1.0/1.0 |
| EVAL-07 | 35-02, 35-03 | Citation-faithfulness (structural) + injection-resistance measurable dimensions | SATISFIED | `validateCitationEnvelope`/`citationRouteMatchesTemplate` (structural, LLM-judge half explicitly stubbed per documented deferral); `scoreInjectionResistance`/`score_injection_resistance` proven on both runners |

**Note (non-blocking doc-sync gap):** `.planning/REQUIREMENTS.md` lines 65-66 and 163-164 still show `EVAL-06`/`EVAL-07` as `[ ]`/"Pending" even though code evidence above satisfies both — this is a bookkeeping lag (the ROADMAP.md plan checkboxes were reconciled this session per the task brief, but REQUIREMENTS.md and the phase-progress summary row were not touched). Recommend the next doc-sync pass flips these to `[x]`/"Complete" alongside the phase's `35. Cost + Eval Scaffolding | 3/3 | Complete` row update. Not a code/goal gap — does not affect verification status.

No orphaned requirements — REQUIREMENTS.md maps only COST-05/EVAL-06/EVAL-07 to Phase 35, all three claimed across the three plans.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found across all files modified/created by the phase's 5 commits (settings.py, cost_circuit_breaker.py, container.py, run_chat_turn.py, all `tests/evals/*.py`, all `packages/genui/src/eval/*.ts` + test files). The `CITATION_FAITHFULNESS_RUBRIC` "STUB" language in `citation-scorer.ts` is an explicitly documented, intentional deferral (35-CONTEXT.md decision + EVAL-DIMENSIONS.README.md), not an unresolved debt marker — it names the exact follow-up scope (999.3-family connected-env judge runs).

### Human Verification Required

None. All 5 ROADMAP success criteria and all 3 requirements (COST-05/EVAL-06/EVAL-07) are verifiable via static code inspection, grep-based wiring checks, and automated test execution — no visual/real-time/external-service behavior requiring human judgment in this phase's scope (everything runs against Phase 34's echo stub by design).

### Gaps Summary

No gaps. All 10 observable truths verified (both TS and Python halves of SC3/SC5, structural half of SC4 with its LLM-judge half correctly treated as a documented deferral rather than a gap), all 13 plan-declared artifacts exist/substantive/wired, all 7 key links wired (including the "one fixture source of truth, two runners" no-duplication proof), 87+32 Python tests and 501 TS tests all green with zero regressions, mypy/ruff/lint-imports/typecheck all clean on touched files, and scope discipline confirmed (zero new dependencies, zero migrations, zero out-of-scope file touches across all 5 phase commits). The only finding is a non-blocking documentation-sync lag in `REQUIREMENTS.md`/the ROADMAP phase-progress row (noted above), which does not affect code-level goal achievement. Phase goal achieved.

---

_Verified: 2026-07-08T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
