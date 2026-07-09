---
phase: 34-tool-loop-mechanics-stub-echo-executor
plan: 03
subsystem: chat-tool-loop
tags: [tool-loop, round-loop, echo-stub, LOOP-01, LOOP-03, gate-G4]
dependency_graph:
  requires:
    - "app.domain.ports.tool_executor.ToolExecutor (34-01)"
    - "app.application.use_cases.run_chat_turn_tool_loop pure helpers (34-01)"
    - "run_chat_turn.py UsageDelta accumulation + visible-parse-failure bugfixes (34-02)"
  provides:
    - "RunChatTurn._execute_turn bounded in-stream server-tool round loop"
    - "container.py production wiring (tool_executors={})"
  affects:
    - "Phase 35-39 (this phase IS gate G4 -- the round-loop mechanics they build on)"
    - "Phase 36 (real executors wire into the SAME tool_executors seam)"
tech_stack:
  added: []
  patterns:
    - "Bounded while-loop round state machine (round_count <= _MAX_TOOL_ROUNDS), same run/state across rounds"
    - "Helper-method decomposition to satisfy ruff PLR0912/PLR0915 cyclomatic-complexity limits"
    - "Frozen dataclass result types (_ServerRoundResult, _RoundAdvance) instead of tuple returns"
key_files:
  created:
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py
  modified:
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/app/container.py
decisions:
  - "tool_executors default value uses types.MappingProxyType({}) instead of a bare {} literal -- ruff B006 (mutable-argument-default) flags {} even under a Mapping[...] annotation; MappingProxyType is a genuinely immutable empty mapping and passes cleanly"
  - "Overrode the executor's returned ToolExecutionResult.tool_use_id with the model-streamed tool_id before building the synthetic tool_result message -- the ToolExecutor.execute() port signature never receives tool_use_id as input, so an executor's own value can never be trusted for Anthropic/Bedrock tool_use/tool_result correlation (protocol-correctness fix, not in the original plan text, applied under Rule 1/2)"
  - "_execute_turn decomposed into _build_tool_offer / _stream_round_deltas / _advance_round / _run_server_tool_round / _finalize_turn_completed -- required to satisfy ruff's PLR0912 (max 12 branches) and PLR0915 (max 50 statements) limits once the round loop was added; CancelledError handling stays INLINE in _execute_turn (not extracted) because a plain awaited coroutine that raises never reaches a `return`, silently losing the accumulated _TurnState at the exact moment D-15 requires it be persisted -- verified by a real regression catch (see Deviations)"
  - "RunChatTurn is an APP-scoped (singleton) DI dependency (container.py Provider(scope=Scope.APP)) -- per-call round-loop state lives ONLY in local variables/parameters/return values passed through the helper methods, NEVER on self, to stay concurrency-safe across simultaneous chat turns"
metrics:
  duration: "~90 min"
  completed: 2026-07-08
---

# Phase 34 Plan 03: Bounded In-Stream Server-Tool Round Loop Summary

Wires the Plan 34-01 primitives into `_execute_turn` as a bounded (`_MAX_TOOL_ROUNDS = 4`)
in-stream round loop, gated on `max_tool_rounds`, fail-closed on exhaustion, with an empty
production executor mapping -- this phase IS gate G4 for Phases 35-39.

## What Was Built

### Task 1 -- tool_executors seam + gate + container empty wiring + part-type replay tolerance

`RunChatTurn.__init__` gained `tool_executors: Mapping[str, ToolExecutor] = MappingProxyType({})`
(additive default, mirrors `interactive_widget_tools`) and derives `self._server_tool_names` from
its keys. `_execute_turn`'s tool offer (now `_build_tool_offer`) additionally offers a minimal
`{"name", "description", "input_schema": {"type":"object","additionalProperties":false}}` schema
per server tool name -- but ONLY when `model.capabilities.max_tool_rounds > 0 AND
self._tool_executors` is non-empty (independent of the existing `genui` gate for
emit_ui_spec/interactive-widget tools). `_provider_content_blocks` gained text stand-ins for the
two new part types (`tool_invocation`/`tool_invocation_result`), mirroring the existing
`genui_spec`/`interactive_widget` treatment, so history replay in a LATER turn never emits a bare
`tool_use`/`tool_result` pair. `container.py`'s `_provide_run_chat_turn` wires `tool_executors={}`
with a comment explaining the empty-in-production rationale (no real server tool exists until
Phase 36).

### Task 2 -- Bounded in-stream round loop (LOOP-01)

`_execute_turn`'s single-stream body is now wrapped in `while round_count <= _MAX_TOOL_ROUNDS:`
(module constant `_MAX_TOOL_ROUNDS = 4`) -- the SAME `run` and the SAME accumulating `_TurnState`
persist across every iteration (SEAM-04's one-`ChatRun`-per-turn invariant preserved, proven by an
e2e assertion that `create_run` is called exactly once for a multi-round turn). Each round:
streams via `_stream_round_deltas` (a small async generator wrapping `provider.stream()` +
`contextlib.aclosing`, yielding `(state, event_or_none)` pairs so the caller's `state` is never
stale even for events-less deltas like `UsageDelta`); on a non-error, non-cost-capped stream end,
`_advance_round` classifies the finalized pending tool call via `classify_tool_dispatch`:

- **"server"** dispatch -> parses the accumulated JSON (a `JSONDecodeError` appends a visible
  `PARSE_FAILURE_TEXT` part and breaks to the completed-finalize path -- the server-side fix half
  of the LOOP-02 "never silent" motto) -> `_run_server_tool_round` appends a `tool_invocation` part,
  emits a `tool_call` run event, executes via `asyncio.wait_for(..., timeout=10.0)` (a `TimeoutError`
  or ANY other exception is caught and converted to `ToolExecutionResult(is_error=True)`, NEVER
  raising out of the loop -- T-34-01), caps the output via `cap_tool_output`, appends a
  `tool_invocation_result` part, constructs a `ToolResultDelta` (declared in Plan 22 but never
  emitted until now) and emits it as a `tool_result` run event, re-checks
  `self._breaker.should_abort(...)` at the round boundary (T-34-01 -- a round is the same spend
  commitment as continuing to stream; a trip persists+terminates `cost_capped` immediately, no new
  breaker method this phase), then builds the next round's `provider_messages` = current messages +
  an assistant message (this round's leading text parts + a native `tool_use` block) +
  `build_synthetic_tool_result_message(result)`, and continues the SAME run.
- **"widget"/"emit_ui_spec"/"unknown"** dispatch, or no pending tool call at all -> terminal,
  unchanged behavior (falls through to the existing `_finalize_pending_tool` completed-finalize
  path, exactly as before this phase).

**Protocol-correctness fix beyond the plan's literal text:** the `ToolExecutor.execute()` port
signature (`app/domain/ports/tool_executor.py`, Plan 34-01) never receives `tool_use_id` as an
input parameter -- only `name`/`arguments`. This means an executor's own returned
`ToolExecutionResult.tool_use_id` can never be trusted to match the `tool_use` block's `id` the
model actually streamed (Anthropic/Bedrock requires exact correlation between a `tool_use` block's
`id` and its paired `tool_result` block's `tool_use_id`, or the API rejects the next round).
`_run_server_tool_round` now unconditionally overrides `result.tool_use_id` with the original
streamed `tool_id` immediately after the executor returns, regardless of what the executor set --
applied under Rule 1/2 (correctness requirement, not a feature).

### Task 3 -- Round-cap exhaustion (LOOP-03)

**Implemented together with Task 2, not as a separate commit** (see Deviations below for why).
When the while-loop's guard would allow a 5th server-tool round (`round_count >= _MAX_TOOL_ROUNDS`
inside `_advance_round`, i.e. the model STILL wants a server tool after 4 executions), the loop
does NOT execute a 5th time: it clears the pending tool state, appends a visible
`{"type":"text","text": ROUND_CAP_EXHAUSTED_TEXT}` part, and breaks to the completed-finalize path
-- the turn always finishes with terminal status `completed`, never a bare `stopped`. Bounded at
exactly 4 `executor.execute()` calls for an always-tool-calling provider (the 5th `provider.stream()`
call still happens -- to LEARN whether the model wants another round -- but the tool itself is never
invoked a 5th time).

### Tests

`tests/application/test_run_chat_turn_tool_loop_e2e.py` -- 9 new end-to-end tests against
`EchoToolExecutor` (Plan 34-01) via a new `_MultiRoundFakeChatProvider` (returns a DIFFERENT delta
list per `.stream()` call, repeating the last list past its length -- drives the "always calls a
tool" exhaustion scenario without hand-repeating fixtures):

- `test_server_tool_round_continues_streaming_within_single_run` -- the LOOP-01 happy path: one
  `ChatRun`, `tool_invocation` + `tool_invocation_result` + final text parts persisted in order,
  `tool_call`/`tool_result` run events present, usage SUMMED across both rounds' `UsageDelta`s
  (15/23, not just the last round's 5/3), round 2's `provider_messages` carries the native
  `tool_result` block.
- `test_server_tool_forced_error_result_does_not_raise_and_completes` -- an executor-returned
  `is_error=True` result feeds back and the turn still completes.
- `test_server_tool_execution_exception_becomes_error_result_loop_continues` -- a
  `_RaisingToolExecutor` (raises `RuntimeError`) never escapes the loop.
- `test_server_tool_execution_timeout_becomes_error_result` -- `_TOOL_EXECUTION_TIMEOUT_SECONDS`
  monkeypatched to 0.01s against `EchoToolExecutor`'s `__sleep__` hook, proving the real
  `asyncio.wait_for` timeout path.
- `test_breaker_rechecked_at_round_boundary_cost_caps_before_next_round` -- isolates the T-34-01
  round-boundary re-check specifically (round 1 has no `TextDelta`/`UsageDelta`, so
  `should_abort` is NEVER called mid-stream) -- proves the SPECIFIC call site, not just "cost
  capping happens somewhere".
- `test_openrouter_model_never_offered_server_tool` -- T-34-05 gate isolation: a genui=True,
  max_tool_rounds=0 model gets `emit_ui_spec` but never `echo`.
- `test_round_cap_exhaustion_appends_visible_text_and_completes` +
  `test_round_cap_exhaustion_bounded_even_with_asyncio_timeout_stub` -- Task 3/LOOP-03.
- `test_single_round_text_only_turn_unregressed_by_round_loop` -- regression guard.

## Verification

```
cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py -q --no-cov
# 9 passed

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py -x -q --no-cov -k "round or continues or single_run"
# 6 passed, 3 deselected  (Task 2's specified filter)

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py -x -q --no-cov -k "exhaust or cap"
# 3 passed, 6 deselected  (Task 3's specified filter)

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py \
  tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py \
  tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py \
  tests/application/test_emit_ui_spec_tool.py tests/test_container.py -q --no-cov
# 66 passed (full targeted sweep; test_run_chat_turn_interactive_widget.py /
# test_run_chat_turn_clarify_widget.py named in the plan's own <verification> block do not exist in
# this repo -- same file-location correction 34-02 already documented; test_run_chat_turn.py is the
# actual home of that coverage and is included above)

cd apps/email-listener && uv run mypy app/application/use_cases/run_chat_turn.py app/container.py
# Success: no issues found (container.py's own 12 reported errors are ALL pre-existing, in
# unrelated infrastructure files it transitively imports -- confirmed identical via git stash
# before/after this plan's changes)

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app tests
# 221 pre-existing errors, ALL in files this plan never touched (test_genui_retrieval_provider.py,
# test_supabase_ui_spec_template_repository.py, test_run_chat_turn_tool_loop.py's pre-existing
# PT023 pattern already documented in 34-01-SUMMARY.md, etc.) -- zero errors in
# run_chat_turn.py / container.py / test_run_chat_turn_tool_loop_e2e.py specifically (grep-verified)
```

Note: as in 34-01/34-02, the repo's global pytest coverage gate (`fail-under=80`) fails on any
targeted subset run by design -- the pass/fail counts above (all green, 0 failed) are what verify
this plan.

## Deviations from Plan

**1. [Rule 1/2 -- protocol correctness] `tool_use_id` override.** Not explicitly called out in the
plan text. The `ToolExecutor.execute()` port never receives `tool_use_id`, so an executor's own
returned value can never be trusted to match the streamed `tool_use` block's `id` -- the loop now
unconditionally overrides it. Without this fix, a real (non-echo) executor that didn't happen to
echo back the exact input `tool_use_id` would produce a `tool_result` block with a mismatched id,
which Bedrock/Anthropic would reject on the next round. Files: `run_chat_turn.py`
(`_run_server_tool_round`). No test regression; covered implicitly by every e2e round-continuation
test (the synthetic message is accepted by the FakeChatProvider regardless, but the production
Bedrock adapter's contract requires this).

**2. [Rule 1 -- bug found during implementation] CancelledError state-loss across an extracted
coroutine boundary.** An earlier refactor pass extracted the ENTIRE per-round stream-and-react
sequence (including `_MidStreamTerminalError`/`CancelledError`/`Exception` handling) into a single
awaited helper coroutine returning `(state, events, is_terminal)`. This passed ruff and mypy but
FAILED `test_cancellation_persists_partial_stopped_and_reraises` (a PRE-EXISTING regression test
from `test_run_chat_turn.py`, run before committing, per this executor's own protocol) -- an
`asyncio.CancelledError` raised mid-stream propagates through the `await helper(...)` expression
BEFORE the helper's `return` executes, discarding whatever `_TurnState` it had accumulated
internally, violating D-15 ("never silently dropped"). Root-caused and reverted: the CancelledError
except-branch (and the `_stream_round_deltas` consumption loop feeding it) now stays INLINE in
`_execute_turn`, where `state` is reassigned as a normal local variable on every iteration (not via
a coroutine's return value) -- the SAME structural pattern the pre-refactor code already used
safely. The `_MidStreamTerminalError`/`Exception` branches (which don't need to preserve a specific
exception instance across a raise/return boundary) were merged into one `except Exception as exc:`
with an `isinstance` check to bring `_execute_turn`'s cyclomatic complexity back under ruff's
PLR0912 limit (12) after the round loop's added branching. Verified: the regression test passes
again (66/66 green in the full targeted sweep above). This deviation is a mechanical
lint-vs-correctness tradeoff resolution, not an architectural change (Rule 4 not triggered -- no
new structure, no new dependency, purely an internal control-flow correction).

**3. Task 3 has no separate commit.** The plan structures round-cap exhaustion (LOOP-03) as Task
3, implying it could land as a distinct commit after Task 2's round loop. In practice, the
exhaustion check (`round_count >= _MAX_TOOL_ROUNDS`) is one branch inside the SAME `_advance_round`
dispatch function Task 2 required to build the loop's core mechanics at all -- there is no
intermediate, independently-committable state where the loop exists but "what happens at the cap"
is undefined (an uncapped version would either infinite-loop against an always-tool-calling
provider, in test terms, or silently drop into `_finalize_pending_tool`'s existing emit_ui_spec
path with a mismatched tool name, which is wrong). Task 3's code was written and committed as part
of `158ee4c` (Task 2's commit); its 2 dedicated e2e tests are in the SAME commit. All of Task 3's
acceptance criteria are independently verified above via its own specified `-k "exhaust or cap"`
filter. No user-facing behavior or requirement is missing -- this is a task-boundary/commit-grain
observation, not a scope gap.

**4. Task 1's "verified by a unit assertion" acceptance criterion deferred to Task 2's test file.**
Task 1's `<files>` list only names `run_chat_turn.py`/`container.py` (no test file exists yet at
that point in the plan), but its acceptance criteria calls for "a unit assertion on the
FakeChatProvider.stream_calls `tools` kwarg" proving a `max_tool_rounds==0` model never receives a
server tool. That assertion lives in `test_openrouter_model_never_offered_server_tool`, added in
Task 2's e2e file (the first point in the plan where a test file for this feature exists) -- folded
into the SAME e2e suite that exercises Task 2's mechanics, since the gate and the loop it gates
are inseparable to test meaningfully in isolation.

## Known Stubs

None. The empty `tool_executors={}` in `container.py`'s production wiring is an INTENTIONAL,
plan-mandated stub (no real server tool exists until Phase 36) -- documented inline with a comment,
not a gap.

## Threat Flags

None beyond the plan's own `<threat_model>` register. The `tool_use_id` override (Deviation 1)
strengthens T-34-04 (Tampering: model-authored tool args -- server dispatch only on names present
in the injected executor map) rather than introducing new surface.

## Self-Check: PASSED

- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py (tool_executors seam,
  `_MAX_TOOL_ROUNDS`, `_build_tool_offer`, `_stream_round_deltas`, `_advance_round`,
  `_run_server_tool_round`, `_finalize_turn_completed`, `_ServerRoundResult`, `_RoundAdvance`,
  `_MidStreamTerminalError` all present)
- FOUND: apps/email-listener/app/container.py (`tool_executors={}` wired with comment)
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py (9 tests)
- FOUND commit 42a486c (Task 1)
- FOUND commit 158ee4c (Task 2 + Task 3, see Deviation 3)
