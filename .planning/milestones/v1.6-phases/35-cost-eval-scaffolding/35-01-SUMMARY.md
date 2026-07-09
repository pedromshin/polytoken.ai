---
phase: 35-cost-eval-scaffolding
plan: 01
subsystem: api
tags: [python, fastapi, cost-circuit-breaker, chat-agent, bedrock, tdd]

# Dependency graph
requires:
  - phase: 34-tool-loop-mechanics-stub-echo-executor
    provides: "bounded mid-turn server-tool round loop in _execute_turn (_stream_round_deltas/_advance_round/_run_server_tool_round), EchoToolExecutor stub, breaker re-check at the round boundary (T-34-01)"
provides:
  - "CostCircuitBreaker.should_abort_round(round_cost) — a per-round abort signal distinct from should_abort's per-turn cap"
  - "COST_CAP_PER_ROUND_USD settings.py cap (default $0.15), wired through container.py (D-21 settings-only)"
  - "round-scoped cost checks wired into _terminal_status_for (mid-round) AND _run_server_tool_round (round boundary)"
affects: [36-thin-wrapper-tools, 37-knowledge-search-python-read-side, 38-quarantine-adversarial-eval]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Round-scoped cost baseline (round_start_output_tokens/round_start_text_len) threaded through the round-loop helper chain, diffed against the running turn state at each check point"
    - "Dual-gate abort: should_abort (per-turn) OR should_abort_round (per-round) — either trip aborts, both re-checked at the SAME call sites (mid-round delta processing + round boundary)"

key-files:
  created: []
  modified:
    - apps/email-listener/app/settings.py
    - apps/email-listener/app/domain/services/cost_circuit_breaker.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/tests/test_cost_circuit_breaker.py
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py
    - apps/email-listener/tests/application/test_run_chat_turn.py
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_bugfixes.py
    - apps/email-listener/tests/application/test_emit_ui_spec_tool.py

key-decisions:
  - "Round-scoped cost estimate takes the LARGER of the mid-stream text-length heuristic and the real per-round token delta (whichever signal is available at the call site) — mirrors _estimated_cost_so_far's own heuristic contract, scoped to a round instead of the whole turn"
  - "Round-boundary check aborts on should_abort OR should_abort_round (short-circuit `or`) — a single check point now enforces both caps"

patterns-established:
  - "Distinct-cap-on-same-instance testing pattern: assert should_abort_round(X) is True while should_abort(X) is False on the SAME breaker, proving genuinely separate thresholds rather than aliased values"

requirements-completed: [COST-05]

# Metrics
duration: ~30min
completed: 2026-07-08
---

# Phase 35 Plan 01: Per-Round Cost Ceiling Summary

**A distinct $0.15-default per-round cost ceiling on `CostCircuitBreaker`, re-checked both mid-round (inside a round's own streaming) and at the round boundary, that aborts the turn `cost_capped` while never dropping already-streamed partial text.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-08T03:27:00-03:00
- **Completed:** 2026-07-08T03:39:42-03:00
- **Tasks:** 2 completed
- **Files modified:** 9

## Accomplishments
- `CostCircuitBreaker.should_abort_round(round_cost)` — a new per-round abort signal (`>=` threshold, default $0.15), structurally proven distinct from `should_abort`'s per-turn cap on the SAME breaker instance (same value trips one, not the other)
- `COST_CAP_PER_ROUND_USD` settings-only cap wired through `container.py`'s `_provide_cost_circuit_breaker` (D-21 preserved — no per-call override anywhere)
- Round-scoped cost checks wired into BOTH `_terminal_status_for` (mid-round, checked after every TextDelta/UsageDelta once the per-turn check clears) AND `_run_server_tool_round`'s round-boundary re-check (now `should_abort OR should_abort_round`)
- A genuinely mid-round trip (during round 2's own streaming, not just at the boundary before round 2 starts) proven to preserve the "never silent" visible-partial-text contract — the persisted assistant message's last text part is the partial text that streamed before the trip, and text streamed after the trip never appears

## Task Commits

Each task was committed atomically:

1. **Task 1: Distinct per-round cap on CostCircuitBreaker + settings + container wiring** - `e222c99` (feat)
2. **Task 2: Wire the round-scoped cap into the round loop (mid-round + round boundary)** - `ae1bc9f` (feat)

_Note: both tasks were `tdd="true"` — tests were written and verified alongside the implementation in the same commit per this plan's `<behavior>`/`<action>` structure (not a separate RED/GREEN commit split); each commit's test suite was run green before committing._

## Files Created/Modified
- `apps/email-listener/app/settings.py` - `COST_CAP_PER_ROUND_USD: float = 0.15`, distinct from per-turn/session/day caps
- `apps/email-listener/app/domain/services/cost_circuit_breaker.py` - `per_round_cap_usd` constructor param + `_per_round_cap` field + `should_abort_round` method
- `apps/email-listener/app/container.py` - `_provide_cost_circuit_breaker` passes `per_round_cap_usd=settings.COST_CAP_PER_ROUND_USD`
- `apps/email-listener/app/application/use_cases/run_chat_turn.py` - `_estimated_round_cost_so_far` helper; round-start baselines (`round_start_output_tokens`/`round_start_text_len`) threaded through `_execute_turn` → `_stream_round_deltas` → `_terminal_status_for` and `_execute_turn` → `_advance_round` → `_run_server_tool_round`; both call sites now check `should_abort_round` alongside the existing `should_abort`
- `apps/email-listener/tests/test_cost_circuit_breaker.py` - 3 new tests (`test_should_abort_round_false_below_cap`, `test_should_abort_round_true_at_and_above_cap`, `test_should_abort_round_is_distinct_from_should_abort_per_turn`) + D-21 guard extended
- `apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py` - `FakeCostCircuitBreaker` made scriptable for round-scoped aborts (`round_abort_after`, `should_abort_round_calls`); 2 new tests (`test_round_scoped_cap_distinct_from_per_turn_cap_aborts_at_round_boundary`, `test_mid_round_text_cost_cap_aborts_with_visible_partial_text`)
- `apps/email-listener/tests/application/test_run_chat_turn.py`, `apps/email-listener/tests/application/test_run_chat_turn_tool_loop_bugfixes.py`, `apps/email-listener/tests/application/test_emit_ui_spec_tool.py` - local `FakeCostCircuitBreaker` doubles gained a plain `should_abort_round` stub (`return False`) to satisfy the new breaker interface

## Decisions Made
- Round-scoped cost estimate takes the larger of the text-length heuristic and the real per-round token delta, matching `_estimated_cost_so_far`'s existing heuristic contract rather than introducing a new estimation strategy
- Round-boundary check combines both caps via short-circuiting `or` rather than two sequential returns, keeping the single existing `if` branch as the one abort point

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` specifications were followed precisely: method signatures, threading of `round_start_output_tokens`/`round_start_text_len` through all four helper methods, the `FakeCostCircuitBreaker` scripting shape in the round-loop's own e2e test file, and the exact test names/assertions specified in each task's `<behavior>` list.

## Issues Encountered

Ran `git stash push -- <4 files>` once during Task 1 to verify a set of mypy errors were pre-existing (unrelated to this plan's changes) rather than introduced by them. Confirmed pre-existing (same 12 errors in 4 untouched infrastructure files both with and without this plan's changes) and immediately `git stash pop`'d to restore. No data was lost; going forward, avoided further `git stash` use per the destructive-git-prohibition guidance and relied on direct diffs instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- COST-05 is now satisfied: the per-round ceiling is enforced at both call sites the phase's success criteria specify (mid-round + round boundary), proven distinct from the per-turn cap, with the visible-partial-text contract intact.
- Phase 34's full tool-loop suite (76 tests) plus this plan's 5 new tests (3 breaker + 2 e2e) all stay green — 87/87 passing across the full verification scope.
- Ready for 35-02 (the remaining EVAL-06/EVAL-07 eval-dimension work in this phase) — no blockers.

---
*Phase: 35-cost-eval-scaffolding*
*Completed: 2026-07-08*

## Self-Check: PASSED

All 9 modified source/test files + this SUMMARY.md confirmed present on disk. Both task commits
(`e222c99`, `ae1bc9f`) confirmed present in `git log`.
