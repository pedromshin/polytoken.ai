---
phase: 35-cost-eval-scaffolding
plan: 03
subsystem: api
tags: [python, pytest, eval-harness, chat-agent, tdd]

# Dependency graph
requires:
  - phase: 35-02-eval-dimensions
    provides: "packages/genui/src/eval/retrieval-golden-set.json + injection-fixtures.json + EVAL-DIMENSIONS.README.md's Python bridge path contract"
  - phase: 34-tool-loop-mechanics-stub-echo-executor
    provides: "tests/support/echo_tool_executor.py (EchoToolExecutor stub, ToolExecutionResult)"
provides:
  - "eval_fixtures_dir() — bounded monorepo-relative resolution of packages/genui/src/eval/ from a test-only Python module"
  - "score_retrieval_at_k / extract_canary / score_injection_resistance — Python mirrors of the TS scorer contract, unit-tested"
  - "test_retrieval_golden_set.py / test_injection_fixtures.py — the Python-side runner proving EVAL-06/EVAL-07 are exercised against ONE fixture source of truth"
affects: [36-thin-wrapper-tools, 37-knowledge-search-python-read-side, 38-quarantine-adversarial-eval]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-only monorepo-relative path resolver (no env-var override branch, unlike genui_artifacts.py's production variant) — dev/CI always has a full checkout"
    - "One fixture source of truth, two runners: Python reads the SAME committed JSON via eval_fixtures_dir(), never a hand-copied duplicate"

key-files:
  created:
    - apps/email-listener/tests/evals/__init__.py
    - apps/email-listener/tests/evals/_paths.py
    - apps/email-listener/tests/evals/_scorers.py
    - apps/email-listener/tests/evals/test_scorers.py
    - apps/email-listener/tests/evals/test_retrieval_golden_set.py
    - apps/email-listener/tests/evals/test_injection_fixtures.py

key-decisions:
  - "eval_fixtures_dir() uses parents[4] (not genui_artifacts.py's parents[5]) because tests/evals/_paths.py sits one directory shallower than app/infrastructure/llm/genui_artifacts.py — verified by walking the actual path depth before writing the resolver, matching the plan's explicit depth-4 spec."
  - "Skipped the GENUI_ARTIFACTS_DIR-style env-var-override branch entirely — this resolver is test-only and never runs inside the deployed Docker image, so the production-container justification for that branch doesn't apply here."
  - "Python-side structural checks on the loaded JSON are intentionally lightweight/duck-typed (non-empty-field presence checks), not a re-implementation of the TS Zod schema — the TS side stays the schema source of truth per FOUND-7; Plan 35-02's assets test is what actually CI-gates schema drift."

patterns-established:
  - "score_retrieval_at_k/extract_canary/score_injection_resistance in _scorers.py are pure, no-I/O functions mirroring retrieval-scorer.ts/injection-scorer.ts's math exactly (same hit-counting, same regex/capture-group semantics) — any change to the TS scorer contract must be mirrored here by hand (no shared codegen in this phase)."

requirements-completed: [EVAL-06, EVAL-07]

# Metrics
duration: ~35min
completed: 2026-07-08
---

# Phase 35 Plan 03: Python Eval Bridge Summary

**`apps/email-listener/tests/evals/` loads the exact JSON fixtures Plan 35-02 committed to `packages/genui/src/eval/` via a bounded monorepo-relative path resolver, scores them with a Python mirror of the TS scorer contract, and proves both EVAL-06 (retrieval) and EVAL-07 (injection-resistance) are runnable from the Python chat-turn side against Phase 34's `EchoToolExecutor` stub — one fixture source of truth, two runners.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-08
- **Tasks:** 2 completed
- **Files created:** 6

## Accomplishments
- `_paths.py`'s `eval_fixtures_dir()` resolves `packages/genui/src/eval/` from a bounded `parents[4]` walk-up (test-only, no env-var machinery), verified to actually exist on disk (`.is_dir()`)
- `_scorers.py` mirrors the TS scorer contract exactly: `score_retrieval_at_k` (recall@k/precision@k, never divides by zero on empty inputs), `extract_canary` (same `[CANARY:token]` regex/capture-group semantics), `score_injection_resistance` (same leak-detection logic)
- `test_scorers.py` — 8 unit tests covering the path resolver + all 3 scorer functions per the plan's `<behavior>` spec
- `test_retrieval_golden_set.py` loads the REAL committed `retrieval-golden-set.json` (7 entries, not a hand-copied duplicate) and round-trips every entry through `EchoToolExecutor`, scoring a perfect `recall_at_k == precision_at_k == 1.0` for each — proving the fixture → stub → parse → score wiring end-to-end
- `test_injection_fixtures.py` loads the REAL committed `injection-fixtures.json` (4 entries) and proves the canary scorer distinguishes a deliberately-leaking sample visible text (`leaked=True`) from a clean one (`leaked=False`) for the same fixture's canary
- `tests/evals/__init__.py` mirrors the existing `tests/support/__init__.py` empty-package convention verbatim

## Task Commits

1. **Task 1: Monorepo-relative fixture path resolver + Python scorer mirror** — part of `30b2d3c` (feat)
2. **Task 2: Load the shared fixtures and score them against the stub executor** — part of `30b2d3c` (feat)

_Note: both tasks were completed and verified together in this reconciliation session (Task 1's tests run/passed before Task 2 was written, per the plan's dependency ordering) and committed as a single atomic commit covering all 6 files, since this was one continuous execution pass rather than two separately-checkpointed sessions._

## Files Created
- `apps/email-listener/tests/evals/__init__.py` - empty package marker (mirrors `tests/support/__init__.py`)
- `apps/email-listener/tests/evals/_paths.py` - `eval_fixtures_dir()`, bounded `parents[4]` walk-up, test-only (no `GENUI_ARTIFACTS_DIR`-style override)
- `apps/email-listener/tests/evals/_scorers.py` - `score_retrieval_at_k`, `extract_canary`, `score_injection_resistance`, `_CANARY_PATTERN` — pure Python mirrors of the TS scorer contract
- `apps/email-listener/tests/evals/test_scorers.py` - 8 unit tests (path resolver + 3 scorer functions)
- `apps/email-listener/tests/evals/test_retrieval_golden_set.py` - 3 tests: entry-count floor, non-empty-field structural check, echo-stub round-trip scoring 1.0/1.0 for every entry
- `apps/email-listener/tests/evals/test_injection_fixtures.py` - 5 tests: entry-count range, non-empty-field structural check, canary-marker presence, leaking-sample-flagged, clean-sample-not-flagged

## Decisions Made
- Verified the actual file-depth math before writing `_paths.py` (`tests/evals/_paths.py` → `parents[0]=evals, parents[1]=tests, parents[2]=email-listener, parents[3]=apps, parents[4]=repo_root`) rather than assuming the plan's stated depth was correct without checking — it matched exactly.
- `ruff check tests/evals` initially flagged `PT023` (`@pytest.mark.unit()` should be `@pytest.mark.unit` without parens) across all 3 test files — a pre-existing style the codebase is inconsistent about (the Phase-34 precedent file `tests/support/test_echo_tool_executor.py` also fails this same rule) — auto-fixed with `ruff check --fix` since this plan's own acceptance criteria explicitly requires `ruff check tests/evals` clean.

## Deviations from Plan

None — both tasks followed the plan's `<action>` specs exactly: `eval_fixtures_dir()`'s bounded walk-up depth, `_scorers.py`'s function signatures/formulas, and both test modules' structural/behavioral assertions all match what was specified.

## Issues Encountered

`ruff check` flagged the pre-existing repo-wide `PT023` style inconsistency (parenthesized vs bare pytest marker decorators) on all 3 new test files. Not a functional issue — auto-fixed via `ruff check tests/evals --fix`, re-ran the full test suite afterward to confirm the auto-fix didn't alter behavior (16/16 still green).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- EVAL-06/EVAL-07 now have BOTH a TS runner (Plan 35-02, CI-gated via `npm run test -w @nauta/genui`) and a Python runner (this plan, `cd apps/email-listener && uv run pytest tests/evals/`) reading the identical committed JSON fixtures — no drift risk, single source of truth.
- `cd apps/email-listener && uv run pytest tests/evals/ -q --no-cov` — 16/16 passed.
- `cd apps/email-listener && uv run ruff check tests/evals` — clean.
- `cd apps/email-listener && uv run mypy tests/evals/_paths.py tests/evals/_scorers.py` — clean.
- `_paths.py`/`_scorers.py` confirmed NOT collected as pytest test modules (`--collect-only` shows only the 3 `test_*.py` files, 16 tests total).
- Phase 34's tool-loop suite (`test_run_chat_turn_tool_loop_e2e.py`, `test_run_chat_turn.py`, `test_run_chat_turn_tool_loop_bugfixes.py`, `test_emit_ui_spec_tool.py`) plus Plan 35-01's `test_cost_circuit_breaker.py` and `test_echo_tool_executor.py` — 60/60 passed, zero regressions from this plan's additions.
- Ready for Phase 36 (thin-wrapper tools) to wire real retrieval data onto this scaffolding — no blockers.

---
*Phase: 35-cost-eval-scaffolding*
*Completed: 2026-07-08*

## Self-Check: PASSED

All 6 created files confirmed present on disk. Commit `30b2d3c` confirmed present in `git log`.
`tests/evals/` full suite (16 tests) + Phase-34/35-01 regression suite (60 tests) both green as of
this session.
