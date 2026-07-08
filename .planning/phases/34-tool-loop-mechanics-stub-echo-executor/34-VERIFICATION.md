---
phase: 34-tool-loop-mechanics-stub-echo-executor
verified: 2026-07-08T00:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 34: Tool-Loop Mechanics (stub/echo executor) Verification Report

**Phase Goal:** The chat agent can execute server tools mid-turn in a bounded round loop against a
stub/echo `ToolExecutor` — proving the loop mechanics, the new domain port, and the new part types
before any real knowledge tool exists — and the 2 latent bugs research found (cost under-reporting,
silent tool-parse-failure drop) are fixed. This phase IS gate G4 for Phases 35-39.
**Verified:** 2026-07-08
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ToolExecutor port + `tool_invocation`/`tool_invocation_result` part types exist and are wired correctly | ✓ VERIFIED | `app/domain/ports/tool_executor.py` defines `ToolExecutor` Protocol + `ToolExecutionResult` frozen dataclass + `MAX_TOOL_OUTPUT_CHARS=2000`, docstring contains "never raw" quarantine obligation. `run_chat_turn_tool_loop.py` builds `tool_invocation`/`tool_invocation_result` part dicts; `run_chat_turn.py` imports and calls both builders inside `_run_server_tool_round` (lines 976, 1002) |
| 2 | Bounded round loop is INSIDE `_execute_turn` (not recursion, not a new run per round), respects `_MAX_TOOL_ROUNDS=4` | ✓ VERIFIED | `run_chat_turn.py:486` creates exactly ONE `run` before `while round_count <= _MAX_TOOL_ROUNDS:` (line 504); same `run`/`state` thread through every iteration. e2e test `test_server_tool_round_continues_streaming_within_single_run` asserts `len(runs.create_run_calls) == 1` for a 2-round turn — PASSES |
| 3 | UsageDelta accumulates (summed, not overwritten) across rounds | ✓ VERIFIED | `_apply_delta`'s `UsageDelta` branch (line 1079-1085) uses `state.input_tokens + delta.input_tokens` / `state.output_tokens + delta.output_tokens`. Overwrite line `input_tokens=delta.input_tokens` no longer exists (grep confirms 0 matches). Tests `test_usage_delta_accumulates_summed_across_two_rounds` (asserts 15/27) and e2e `test_server_tool_round_continues_streaming_within_single_run` (asserts 15/23) both pass |
| 4 | Parse failures produce a visible text part in BOTH the terminal (widget/emit_ui_spec) path and the new server-tool round path — never silent | ✓ VERIFIED | `_finalize_pending_tool` (terminal path, lines 1097-1137): both former `return cleared, None` sites now append `{"type":"text","text": PARSE_FAILURE_TEXT}`. `_advance_round` (server-round path, lines 906-914): `JSONDecodeError`/`TypeError` on the server-tool JSON appends the same visible text. 4 dedicated tests pass (2 bugfix tests + design covers both dispatch branches) |
| 5 | Round-cap exhaustion fails closed with a visible text part, never a bare "stopped" | ✓ VERIFIED | `_advance_round` lines 895-901: when `round_count >= _MAX_TOOL_ROUNDS` and the model still wants a server tool, appends `{"type":"text","text": ROUND_CAP_EXHAUSTED_TEXT}` and breaks to the completed-finalize path (never `stopped`). Test `test_round_cap_exhaustion_appends_visible_text_and_completes` asserts terminal event is `completed`, `"stopped" not in event_types`, exhaustion text is the LAST part, and `counting_executor.call_count == 4` (never a 5th execution) — PASSES |
| 6 | Per-tool timeout (~10s) and tool-output size cap (~2000 chars) implemented | ✓ VERIFIED | `_TOOL_EXECUTION_TIMEOUT_SECONDS = 10.0` (line 126) wraps `executor.execute(...)` in `asyncio.wait_for` (line 984); `TimeoutError` and any other `Exception` are both caught and converted to `ToolExecutionResult(is_error=True)`, never raising (lines 988-993). `cap_tool_output` applied to the result content (line 1001) using `MAX_TOOL_OUTPUT_CHARS=2000`. Tests `test_server_tool_execution_timeout_becomes_error_result` and `test_server_tool_execution_exception_becomes_error_result_loop_continues` both pass |
| 7 | `max_tool_rounds=4` on exactly the 2 Bedrock Claude registry entries, 0 elsewhere; OpenRouter never enters a round | ✓ VERIFIED | Registry: `us.anthropic.claude-sonnet-4-6` and `us.anthropic.claude-haiku-4-5-20251001-v1:0` are the only 2 entries with `max_tool_rounds=4`; all 4 OpenRouter + 1 browser entry default to 0 (code-read confirmed). `_build_tool_offer` (line 452) gates server-tool schemas on `model.capabilities.max_tool_rounds > 0 and self._tool_executors`. `openrouter_chat_adapter.py`'s `_to_openai_messages` still flattens to text-only (tool blocks dropped) — defense in depth confirmed. Tests `test_only_bedrock_claude_entries_enable_tool_rounds` and e2e `test_openrouter_model_never_offered_server_tool` both pass |
| 8 | `container.py` wires an EMPTY `tool_executors` mapping in production | ✓ VERIFIED | `container.py:657` — `tool_executors={},` with an explanatory comment ("EMPTY in production — no real server tool exists until Phase 36... no round can ever be entered today"). `tests/test_container.py` (12 tests) passes with this wiring in place |
| 9 | Scope discipline: all phase-34 commits touch only `apps/email-listener/**` or `.planning/**`, no DB migrations | ✓ VERIFIED | `git show --name-only` on all 13 commits (39fceb7, 56c05b7, 82de363, 6ba5275, 6715ca0, 560d0fd, d50324d, 09c9baf, 87ac8f8, 42a486c, 158ee4c, cf0040e, 488fbe7) shows every touched path is under `apps/email-listener/**` or `.planning/**` — zero `apps/web`, zero `packages/*`. No new file in `packages/db/migrations/` (head still `0028_autofill_retrieval_events.sql`) |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/domain/ports/tool_executor.py` | ToolExecutor Protocol + ToolExecutionResult + quarantine obligation | ✓ VERIFIED | Exists, contains all required symbols, docstring has "never raw", domain-only imports (`dataclasses`, `typing`) |
| `apps/email-listener/app/application/use_cases/run_chat_turn_tool_loop.py` | Pure tool-loop helpers | ✓ VERIFIED | All 5 functions + 2 constants exported via `__all__`; imports only `app.domain.*` + `run_chat_turn_widgets` (same layer) |
| `apps/email-listener/tests/support/echo_tool_executor.py` | EchoToolExecutor test double | ✓ VERIFIED | Implements `ToolExecutor` port; supports `__force_error__`/`__sleep__`; test-only (not wired in container.py) |
| `apps/email-listener/app/domain/services/chat_model_registry.py` | `max_tool_rounds` field + 2 Bedrock entries set to 4 | ✓ VERIFIED | Field default 0; exactly 2 entries pass `max_tool_rounds=4` |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | Round loop in `_execute_turn`, bugfixes, `_MAX_TOOL_ROUNDS` | ✓ VERIFIED | Contains `_MAX_TOOL_ROUNDS = 4`, `while round_count <= _MAX_TOOL_ROUNDS:`, accumulating `_apply_delta`, non-silent `_finalize_pending_tool`/`_advance_round` |
| `apps/email-listener/app/container.py` | `tool_executors={}` production wiring | ✓ VERIFIED | Line 657, with rationale comment |
| `apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py` | End-to-end loop tests against EchoToolExecutor | ✓ VERIFIED | 9 tests, all pass, cover happy path/forced-error/exception/timeout/breaker re-check/OpenRouter gate/exhaustion (x2)/regression |
| `apps/email-listener/tests/application/test_run_chat_turn_tool_loop_bugfixes.py` | Regression tests for both bugs | ✓ VERIFIED | 4 tests: usage-accumulation (x2), parse-failure visible text (x2) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tests/support/echo_tool_executor.py` | `app/domain/ports/tool_executor.py` | implements `ToolExecutor` / returns `ToolExecutionResult` | ✓ WIRED | `EchoToolExecutor.execute()` returns `ToolExecutionResult(...)` |
| `run_chat_turn_tool_loop.py` | `tool_executor.py` | type-hints `ToolExecutionResult` | ✓ WIRED | `TYPE_CHECKING` import used in `build_tool_invocation_result_part`/`build_synthetic_tool_result_message` |
| `run_chat_turn.py` | `run_chat_turn_tool_loop.py` | `classify_tool_dispatch`/`build_synthetic_tool_result_message`/`ROUND_CAP_EXHAUSTED_TEXT` | ✓ WIRED | All imported at module top (lines 65-73) and called inside `_advance_round`/`_run_server_tool_round` |
| `run_chat_turn.py` | `tool_executor.py` | `tool_executors: Mapping[str, ToolExecutor]` | ✓ WIRED | Constructor param (line 227), stored as `self._tool_executors`, consumed in `_build_tool_offer`/`_run_server_tool_round` |
| `container.py` | `run_chat_turn.py` | `_provide_run_chat_turn` passes `tool_executors={}` | ✓ WIRED | Line 657; `tests/test_container.py` (12 tests) passes with this wiring |

### Behavioral Spot-Checks / Full Targeted Test Suite

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full targeted suite for all phase-34 touched/regression modules | `uv run pytest tests/test_chat_model_registry.py tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/test_container.py --no-cov` | 72 passed | ✓ PASS |
| `emit_ui_spec` regression (adjacent surface) | `uv run pytest tests/application/test_emit_ui_spec_tool.py --no-cov` | 4 passed | ✓ PASS |
| mypy on all 5 touched source files | `uv run mypy app/domain/ports/tool_executor.py app/domain/services/chat_model_registry.py app/application/use_cases/run_chat_turn_tool_loop.py app/application/use_cases/run_chat_turn.py app/container.py` | 12 errors, all in `genui_generator_adapter.py`/`genui_code_generator_adapter.py`/`supabase_ui_spec_template_repository.py`/`supabase_chat_widget_interaction_repository.py` (transitively imported, confirmed NOT touched by any phase-34 commit) | ✓ PASS (0 errors in the 5 checked files themselves) |
| lint-imports (Clean Architecture contract) | `uv run lint-imports` | 3 kept, 0 broken | ✓ PASS |
| ruff on all touched files | `uv run ruff check <9 files>` | 25 errors, all `PT023` (pre-existing repo-wide `@pytest.mark.x()` convention, confirmed present identically elsewhere via 34-01/34-02 SUMMARY notes); 0 errors on the 5 non-test source files | ✓ PASS (no new lint debt) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LOOP-01 | 34-01, 34-03 | Bounded round loop, ToolExecutor port, new part types | ✓ SATISFIED | Truths 1, 2, 7, 8 above; REQUIREMENTS.md marks Complete |
| LOOP-02 | 34-01, 34-02 | Usage accumulation + non-silent parse failure | ✓ SATISFIED | Truths 3, 4 above; REQUIREMENTS.md marks Complete |
| LOOP-03 | 34-03 | Round-cap exhaustion visible text | ✓ SATISFIED | Truth 5 above; REQUIREMENTS.md marks Complete |

No orphaned requirements — REQUIREMENTS.md maps only LOOP-01/02/03 to Phase 34, and all 3 are claimed by the phase's plans.

### Anti-Patterns Found

None. Scanned all 6 core touched source files (`tool_executor.py`, `chat_model_registry.py`, `run_chat_turn_tool_loop.py`, `run_chat_turn.py`, `container.py`, `echo_tool_executor.py`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented" — zero matches.

### Human Verification Required

None. This phase is Python-only mechanics work (no UI surface — explicitly out of scope per `34-CONTEXT.md`: "NO web UI work, tool-round display is Phase 39"). No `<verify><human-check>` blocks exist in any of the 3 plans (all tasks are `type="auto"`). The new part types (`tool_invocation`/`tool_invocation_result`) cannot reach the web renderer in production today since `container.py` wires an empty executor mapping — the web-tolerance question from `34-CONTEXT.md`'s "Claude's Discretion" section is moot until Phase 36 wires a real tool.

### Gaps Summary

None. All 9 observable truths derived from the ROADMAP Success Criteria + CONTEXT.md locked decisions + the verification task's explicit checklist are VERIFIED against the actual codebase (not SUMMARY narrative alone) — read the domain port, the pure helper module, the registry, the full `_execute_turn`/`_advance_round`/`_run_server_tool_round` implementation, and `container.py`; independently re-ran the full targeted pytest suite (76 tests total across two runs, all green), mypy, lint-imports, and ruff; and independently verified scope discipline via `git show --name-only` on all 13 phase-34 commits.

---

_Verified: 2026-07-08_
_Verifier: Claude (gsd-verifier)_
