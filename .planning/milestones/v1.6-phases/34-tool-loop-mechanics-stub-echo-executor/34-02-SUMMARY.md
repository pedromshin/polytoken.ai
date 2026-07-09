---
phase: 34-tool-loop-mechanics-stub-echo-executor
plan: 02
subsystem: chat-tool-loop
tags: [tool-loop, bugfix, usage-accumulation, parse-failure, LOOP-02]
dependency_graph:
  requires:
    - "app.application.use_cases.run_chat_turn_tool_loop.PARSE_FAILURE_TEXT (34-01)"
  provides:
    - "run_chat_turn.py _apply_delta: UsageDelta accumulation (summed, not overwritten)"
    - "run_chat_turn.py _finalize_pending_tool: visible-text-on-parse-failure (never silent drop)"
  affects:
    - "34-03 (the new server-tool round path reuses this same never-silent posture)"
tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN gate commits (test(...) before feat(...))"
    - "Fakes/scaffold copied locally per-test-file (avoids cross-file test coupling)"
key_files:
  created:
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_bugfixes.py
  modified:
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
decisions:
  - "PARSE_FAILURE_TEXT imported directly from run_chat_turn_tool_loop.py (34-01's module was already committed and present at execution time — the plan's local-literal fallback was not needed)"
  - "Fakes/_make_use_case scaffold copied locally into the new test file (not imported from test_run_chat_turn.py) — mirrors this repo's existing per-test-file convention, avoids coupling"
metrics:
  duration: "~20 min"
  completed: 2026-07-08
---

# Phase 34 Plan 02: Tool-Loop Bugfixes (UsageDelta accumulation + visible parse-failure) Summary

Fixed the 2 concrete latent bugs research found in the existing single-round chat turn — before
Plan 34-03's round loop amplifies them: UsageDelta silently overwrote instead of accumulating
(cost under-reporting the moment a turn spans >1 round), and a malformed/truncated tool-call's
JSON was silently dropped with only a `logger.warning`. Both now fixed with a TDD RED/GREEN gate.

## What Was Built

### Task 1 — UsageDelta accumulates across rounds (bug 1)
`_apply_delta`'s `UsageDelta` branch in `run_chat_turn.py` changed from
`replace(state, input_tokens=delta.input_tokens, output_tokens=delta.output_tokens)` (overwrite)
to `replace(state, input_tokens=state.input_tokens + delta.input_tokens, output_tokens=state.output_tokens + delta.output_tokens)`
(sum). Docstring updated to state the accumulation explicitly and name the LOOP-02 rationale
(a multi-round turn emits one UsageDelta per round).

### Task 2 — Visible text part on tool-call parse failure (bug 2, terminal path)
`_finalize_pending_tool`'s two silent `return cleared, None` drop sites — the widget path
(`build_interactive_widget_part` returned `None`) and the `emit_ui_spec` `except
(json.JSONDecodeError, TypeError)` path — now both return
`replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None`
instead. The existing `logger.warning` calls are retained (server-side detail unchanged); only the
silent-drop behavior is fixed. `PARSE_FAILURE_TEXT` is imported from `run_chat_turn_tool_loop.py`
(Plan 34-01's module, already committed and importable — the plan's "define locally if not yet
present" fallback was not needed). This resolves the REQUIRED behavior of the pending todo
`2026-07-06-salvage-truncated-tool-calls` (full lenient-repair salvage remains an optional future
enhancement, out of scope here).

### Tests
`tests/application/test_run_chat_turn_tool_loop_bugfixes.py` — 4 new tests, fakes/`_make_use_case`
scaffold copied locally from `test_run_chat_turn.py`'s existing pattern (that exact file name from
the plan's `<read_first>`, `test_run_chat_turn_interactive_widget.py`, does not exist in this repo —
`test_run_chat_turn.py` is the actual home of this scaffold and was used instead):

- `test_usage_delta_accumulates_summed_across_two_rounds` — 2 UsageDeltas (10/20 then 5/7) sum to
  input=15/output=27 in both the `usage` run event and the recorded `UsageEvent`.
- `test_usage_delta_single_round_passthrough_no_regression` — a single UsageDelta still reports
  its own exact values (no double-count regression).
- `test_malformed_emit_ui_spec_json_surfaces_visible_text_part` — truncated `emit_ui_spec` JSON
  persists a `{"type":"text","text": PARSE_FAILURE_TEXT}` part, no `genui_spec` part, turn
  `completed`.
- `test_malformed_proposal_cards_json_surfaces_visible_text_part` — truncated `emit_proposal_cards`
  JSON persists the same visible text part, no `interactive_widget` part, turn `completed`.

## TDD Gate Compliance

RED gate: commit `560d0fd` (`test(34-02): add failing tests for tool-loop bugfixes`) — 3/4 tests
failed against pre-fix `run_chat_turn.py` (the 4th, single-round passthrough, correctly passed —
no regression existed yet to guard). GREEN gate: commit `d50324d`
(`feat(34-02): accumulate UsageDelta and surface visible text on tool-call parse failure`) — all
4 new tests plus the 15 pre-existing `test_run_chat_turn.py` tests pass. No REFACTOR commit needed
(the GREEN diff was already minimal).

## Verification

```
cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_bugfixes.py \
  tests/application/test_run_chat_turn.py -q --no-cov
# 19 passed

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn.py \
  tests/application/test_run_chat_turn_tool_loop_bugfixes.py \
  tests/application/test_run_chat_turn_tool_loop.py tests/application/test_emit_ui_spec_tool.py \
  -q --no-cov
# 38 passed (broader targeted sweep — no cross-plan regression)

cd apps/email-listener && uv run mypy app/application/use_cases/run_chat_turn.py
# Success: no issues found in 1 source file

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/application/use_cases/run_chat_turn.py \
  tests/application/test_run_chat_turn_tool_loop_bugfixes.py
# All checks passed!
```

Note: as in 34-01, the repo's global pytest coverage gate (`fail-under=80`) fails on any targeted
subset run by design — the actual pass/fail counts above (all green, 0 failed) are what verify
this plan.

## Deviations from Plan

**1. Test-scaffold source file name.** The plan's `<read_first>` for both tasks pointed to
`tests/application/test_run_chat_turn_interactive_widget.py` and (in `<verification>`)
`test_run_chat_turn_clarify_widget.py` for the fakes/`_make_use_case` scaffold and regression
coverage. Neither file exists in this repo — the interactive-widget/clarify-widget test coverage
for `run_chat_turn.py` lives entirely inside `tests/application/test_run_chat_turn.py` (which
already contains `FakeChatMessageRepository`/`FakeChatProvider`/`_make_use_case` etc.). Used
`test_run_chat_turn.py` as the scaffold source and regression target instead — same shape the plan
asked for, correct actual location. Not a Rule 4 architectural change; a file-name correction.

**2. `_make_use_case` scaffold trimmed.** The local copy in the new test file omits the unused
`_SMALL_CONTEXT_MODEL`/`_TEXT_ONLY_MODEL` fixtures and the breaker's `abort_after` scripting (not
needed by these 4 tests — the fixed `FakeCostCircuitBreaker` here always allows/never mid-stream
aborts, since a genuine cost-cap abort is orthogonal to what's under test).

Neither deviation required a Rule 4 (architectural) checkpoint — both are file-location
corrections consistent with the plan's own escape hatch ("or import them if that file exposes them
cleanly; prefer a local copy to avoid coupling").

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/email-listener/tests/application/test_run_chat_turn_tool_loop_bugfixes.py
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py (PARSE_FAILURE_TEXT import + accumulation fix + visible-text fix all present)
- FOUND commit 560d0fd (RED — test file)
- FOUND commit d50324d (GREEN — source fix)
