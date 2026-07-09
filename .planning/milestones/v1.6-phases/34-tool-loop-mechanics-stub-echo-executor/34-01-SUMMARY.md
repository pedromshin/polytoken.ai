---
phase: 34-tool-loop-mechanics-stub-echo-executor
plan: 01
subsystem: chat-tool-loop
tags: [tool-loop, domain-port, capability-gate, echo-stub, LOOP-01]
dependency_graph:
  requires: []
  provides:
    - "app.domain.ports.tool_executor.ToolExecutor"
    - "app.domain.ports.tool_executor.ToolExecutionResult"
    - "ChatModelCapabilities.max_tool_rounds"
    - "app.application.use_cases.run_chat_turn_tool_loop (pure helpers)"
    - "tests.support.echo_tool_executor.EchoToolExecutor"
  affects:
    - "34-03 (wires tool_executors + these helpers into _execute_turn)"
    - "34-02 (consumes ToolExecutor + registry gate for the actual round loop)"
tech_stack:
  added: []
  patterns:
    - "Protocol-based domain port (mirrors ChatProvider)"
    - "Pure-helper module split (mirrors run_chat_turn_widgets.py)"
key_files:
  created:
    - apps/email-listener/app/domain/ports/tool_executor.py
    - apps/email-listener/app/application/use_cases/run_chat_turn_tool_loop.py
    - apps/email-listener/tests/support/__init__.py
    - apps/email-listener/tests/support/echo_tool_executor.py
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop.py
    - apps/email-listener/tests/support/test_echo_tool_executor.py
  modified:
    - apps/email-listener/app/domain/services/chat_model_registry.py
    - apps/email-listener/tests/test_chat_model_registry.py
decisions:
  - "max_tool_rounds int field (default 0) doubles as the capability gate — no second boolean, per 34-CONTEXT.md"
  - "EMIT_UI_SPEC_TOOL_NAME redefined locally in run_chat_turn_tool_loop.py (not imported from infrastructure) to respect the import-linter contract"
  - "classify_tool_dispatch precedence: server tool names win over widget/emit_ui_spec on a name collision"
metrics:
  duration: "~35 min"
  completed: 2026-07-08
---

# Phase 34 Plan 01: Tool-Loop Mechanics Contracts + Stub Executor Summary

ToolExecutor domain port, the `max_tool_rounds` capability gate on the 2 Bedrock Claude registry
entries, pure tool-loop helper functions, and a test-only EchoToolExecutor — the dependency-free
contract layer Plan 34-03 wires into `_execute_turn`'s streaming round loop.

## What Was Built

### Task 1 — ToolExecutor domain port + ToolExecutionResult
`apps/email-listener/app/domain/ports/tool_executor.py`: a frozen `ToolExecutionResult` dataclass
(`tool_use_id: str`, `content: str`, `is_error: bool = False` — field names mirror
`ToolResultDelta` 1:1) and a `ToolExecutor` Protocol with one async method
`execute(*, name: str, arguments: dict[str, Any]) -> ToolExecutionResult`. The module-level
`MAX_TOOL_OUTPUT_CHARS = 2000` constant and the class docstring both state the Fork 3⊗4 quarantine
obligation ("never raw" — enforcement lands in Phase 38/QUAR-01). Domain-only imports
(`dataclasses`, `typing`), no infrastructure, no I/O.

### Task 2 — max_tool_rounds capability gate
`ChatModelCapabilities` gained `max_tool_rounds: int = 0`. Only the 2 Bedrock Claude entries
(`us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-haiku-4-5-20251001-v1:0`) now pass
`max_tool_rounds=4`; every OpenRouter (`deepseek/deepseek-chat`, `qwen/qwen-2.5-72b-instruct`,
`z-ai/glm-4.6`, `google/gemma-2-27b-it`) and browser (`webllm-qwen3-4b`) entry stays at the
default 0. New test `test_only_bedrock_claude_entries_enable_tool_rounds` asserts the split
directly (both Bedrock entries == 4, every `transport != "bedrock"` entry == 0). The registry's
content hash (`chat_registry_version()`) changed as an expected side effect — no golden hash is
asserted anywhere in the suite.

### Task 3 — Pure tool-loop helpers + EchoToolExecutor stub
`apps/email-listener/app/application/use_cases/run_chat_turn_tool_loop.py` — pure functions only
(no I/O, imports only `app.domain.*` + stdlib, mirrors `run_chat_turn_widgets.py`'s pattern):

- `build_tool_invocation_part(tool_name, tool_use_id, arguments)` — new `tool_invocation` part type
- `build_tool_invocation_result_part(result, tool_name)` — new `tool_invocation_result` part type
- `build_synthetic_tool_result_message(result)` — native Bedrock `{"role": "user", "content": [{"type": "tool_result", ...}]}` block (preferred over string fencing — the Bedrock adapter accepts native `tool_result` blocks verbatim)
- `classify_tool_dispatch(tool_name, server_tool_names)` — `"server"` / `"widget"` / `"emit_ui_spec"` / `"unknown"`, server-first precedence
- `cap_tool_output(text, limit=MAX_TOOL_OUTPUT_CHARS)` — truncates with a visible `" …[truncated]"` marker
- `PARSE_FAILURE_TEXT` / `ROUND_CAP_EXHAUSTED_TEXT` — exact visible-surface strings for the "never silent" motto (LOOP-02/LOOP-03), consumed by Plans 34-02/34-03

`tests/support/echo_tool_executor.py` — `EchoToolExecutor` implementing the `ToolExecutor` port:
echoes its capped JSON-serialized arguments back as `content`; `arguments["__force_error__"]`
truthy returns `is_error=True`; `arguments["__sleep__"]` (seconds) awaits `asyncio.sleep` first so
34-03 can drive the per-tool timeout path.

20 new unit tests across `tests/application/test_run_chat_turn_tool_loop.py` (part builders,
synthetic block shape, classify precedence incl. server-wins-on-collision and unknown, cap
truncation marker, visible-text constants) and `tests/support/test_echo_tool_executor.py` (round-trip,
default tool_use_id, forced-error, output cap, sleep-flag timing).

## Verification

```
cd apps/email-listener && uv run pytest tests/test_chat_model_registry.py \
  tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py \
  -q --no-cov
# 34 passed

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run mypy app/domain/ports/tool_executor.py \
  app/domain/services/chat_model_registry.py app/application/use_cases/run_chat_turn_tool_loop.py
# Success: no issues found in 3 source files
```

Note: the repo's global pytest coverage gate (`fail-under=80`) fails on any targeted subset run
(expected — the gate is designed for full-suite runs); the actual test results (all passed, 0
failed) are what verify this plan. `uv run ruff check` on the new test files surfaces pre-existing
`PT023` (`@pytest.mark.unit()` vs `@pytest.mark.unit`) warnings that already exist identically in
every other test file in this repo (confirmed via `git stash` diff) — out of scope per the executor's
scope-boundary rule (pre-existing repo-wide convention, not introduced by this plan).

## Deviations from Plan

None — plan executed exactly as written. `cap_tool_output`'s default limit parameter imports
`MAX_TOOL_OUTPUT_CHARS` from `tool_executor.py` (as the plan's acceptance criteria implied via
`limit: int = MAX_TOOL_OUTPUT_CHARS`) rather than hardcoding `2000` a second time — same value,
single source of truth.

## Known Stubs

None. `EchoToolExecutor` is an intentional, plan-scoped test double (registered in tests only —
`container.py` is untouched this plan and will continue wiring an empty executor mapping in
production per 34-CONTEXT.md, until Phase 36 adds real tools).

## Self-Check: PASSED

- FOUND: apps/email-listener/app/domain/ports/tool_executor.py
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn_tool_loop.py
- FOUND: apps/email-listener/tests/support/__init__.py
- FOUND: apps/email-listener/tests/support/echo_tool_executor.py
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_tool_loop.py
- FOUND: apps/email-listener/tests/support/test_echo_tool_executor.py
- FOUND commit 39fceb7 (Task 1)
- FOUND commit 56c05b7 (Task 2)
- FOUND commit 82de363 (Task 3)
