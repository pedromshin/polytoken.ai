---
phase: 39-tool-round-ui-citation-chips
plan: 01
subsystem: chat-tool-loop-sse
tags: [SSE, tool-loop, TUI-01, mirror-frame, transport-only]
dependency_graph:
  requires:
    - "app.application.use_cases.run_chat_turn._run_server_tool_round (Phase 34-03, wired to real tools by Phases 36-38)"
    - "app.domain.ports.chat_repositories.ChatRunEvent / ChatRunEventType (Phase 22-06)"
  provides:
    - "server_tool_call/server_tool_result non-persisted SSE mirror ChatRunEvents, emitted at _run_server_tool_round's 2 existing dispatch points"
    - "ChatRunEventType widened additively (12 entries, order preserved)"
  affects:
    - "39-02 (web/TypeScript sibling plan) -- consumes these 2 new frame types verbatim per 39-UI-SPEC.md's SSE/Part Contract table (applyRunEvent branches, tool_invocation_streaming/tool_invocation_result parts)"
    - "apps/email-listener/app/presentation/api/v1/chat_stream.py -- zero changes needed; _format_sse_event serializes any ChatRunEvent generically"
tech_stack:
  added: []
  patterns:
    - "Non-persisted in-memory ChatRunEvent construction (id/run_id/seq left at dataclass defaults) -- same convention the pre-existing fail-closed pre-turn BLOCK path already established"
key_files:
  created: []
  modified:
    - apps/email-listener/app/domain/ports/chat_repositories.py
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py
decisions:
  - "server_tool_result's ChatRunEvent(...) construction kept as a one-line `type=\"server_tool_result\"` call head (data dict wrapped across lines) rather than ruff format's preferred fully-multi-line layout -- the plan's own acceptance criteria requires a literal single-line grep match on `ChatRunEvent(type=\"server_tool_result\"`; `ruff format --check` was confirmed non-gating for this repo (the file already contains multiple pre-existing lines that don't match ruff format's canonical style, and neither 34-03-SUMMARY.md nor 38-01-SUMMARY.md's own verification blocks run `ruff format`), so `ruff check` (lint, which DOES pass clean) is the actual gate, not `ruff format`"
metrics:
  duration: "~25 min"
  completed: 2026-07-09
---

# Phase 39 Plan 01: Tool-Round SSE Mirror Frames Summary

Makes the chat agent's already-shipped mid-turn server-tool round loop visible over SSE with its
own correctly-typed transport frames (`server_tool_call`/`server_tool_result`), closing the Python
half of TUI-01 — the durable, DB-persisted `tool_call`/`tool_result` run events and the
`chat_run_events` CHECK constraint are completely untouched (no migration).

## What Was Built

### Task 1 — Non-persisted server_tool_call/server_tool_result SSE mirror frames

`ChatRunEventType` (`app/domain/ports/chat_repositories.py`) widened additively with
`"server_tool_call"` and `"server_tool_result"` appended after the existing `"interrupted"` entry
(the prior 10 entries unchanged, same order), with an inline comment stating both values are
transport-only SSE mirror types — never passed to `ChatRunRepository.append_event`, never part of
the `chat_run_events` table's CHECK constraint, no migration required.

`_run_server_tool_round` (`app/application/use_cases/run_chat_turn.py`) now constructs 2 additional
`ChatRunEvent`s, directly (never routed through `self._emit`/`self._runs.append_event`), at its 2
existing dispatch points:

- Immediately after the existing `events.append(await self._emit(run.id, "tool_call", {...}))`
  statement: `events.append(ChatRunEvent(type="server_tool_call", data={"tool_name": tool_name,
  "id": tool_id}))` — deliberately omits `arguments` (the activity row this phase's sibling web
  plan builds never gets raw tool arguments, per T-39-01's information-disclosure mitigation).
- Immediately after the existing `events.append(await self._emit(run.id, "tool_result", {...}))`
  statement: a `server_tool_result` `ChatRunEvent` whose `data` is a byte-identical mirror of the
  persisted `tool_result` event's own `data` (`tool_name`, `id`, `content`, `isError`) — so the
  client can build the same `tool_invocation_result` part client-side that `chat.getHistory` will
  later confirm, with no visual "flash" on terminal refetch.

Both new events leave `id`/`run_id`/`seq` at their dataclass defaults (`None`), reaching the SSE
wire automatically via the same `events` list `_run_server_tool_round` already returns (through
`_ServerRoundResult.events` → `_RoundAdvance.events` → `_execute_turn`'s existing
`for event in advance.events: yield event` loop) — `chat_stream.py` required zero changes, since
`_format_sse_event` serializes any `ChatRunEvent` generically with no type allowlist.

Two new e2e tests added to `test_run_chat_turn_tool_loop_e2e.py`, reusing the existing
`_MultiRoundFakeChatProvider`/`_make_use_case`/`EchoToolExecutor` fixtures and mirroring
`test_server_tool_round_continues_streaming_within_single_run`'s provider-rounds shape:

- `test_server_tool_round_emits_non_persisted_sse_mirror_events` — proves Behaviors 1-4: the
  `server_tool_call` mirror follows `tool_call` with exactly `{"tool_name", "id"}` as its `data`
  keys; the `server_tool_result` mirror follows `tool_result` with `content`/`isError` values
  identical to the persisted event's own; both mirrors have `id is None`, `run_id is None`,
  `seq is None`; and `fakes["runs"].events` (the `FakeChatRunRepository`'s persisted-event log,
  populated only by `append_event`) never contains either new type while still containing
  `tool_call`/`tool_result`.
- `test_server_tool_error_round_mirror_event_matches_persisted_error_result` — the same
  non-persistence + shape proof holds for the `isError: True` executor-forced-error path.

## Verification

```
cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py -q --no-cov
# 13 passed (11 pre-existing + 2 new)

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py \
  tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py \
  tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py -q --no-cov
# 54 passed (full plan-level regression sweep, 0 failures)

cd apps/email-listener && uv run mypy app/domain/ports/chat_repositories.py app/application/use_cases/run_chat_turn.py
# Success: no issues found in 2 source files

cd apps/email-listener && uv run lint-imports
# 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/application/use_cases/run_chat_turn.py app/domain/ports/chat_repositories.py
# All checks passed!

grep -rn "server_tool_call\|server_tool_result" packages/db/
# (no output -- zero matches, confirming no migration/schema/CHECK-constraint touch)

grep -n "server_tool_call\|server_tool_result" apps/email-listener/app/domain/ports/chat_repositories.py
# matches inside the ChatRunEventType Literal (lines 49, 55-56)

grep -n 'ChatRunEvent(type="server_tool_call"' apps/email-listener/app/application/use_cases/run_chat_turn.py
# matches exactly once (line 1220), inside _run_server_tool_round

grep -n 'ChatRunEvent(type="server_tool_result"' apps/email-listener/app/application/use_cases/run_chat_turn.py
# matches exactly once (line 1282), inside _run_server_tool_round

grep -n "server_tool_call\|server_tool_result" apps/email-listener/app/application/use_cases/run_chat_turn.py
# NEITHER string appears near self._emit(/append_event( -- confirmed via manual context check
```

## Deviations from Plan

**1. [Rule 3 -- blocking formatting/acceptance-criteria conflict, non-architectural] one-line
`ChatRunEvent(type="server_tool_result", ...)` call head.** The plan's own acceptance criteria
requires `grep -n "ChatRunEvent(type=\"server_tool_result\"" ...` to match exactly once. `ruff
format` (run to check, not applied) wanted to reformat this into a fully multi-line
`ChatRunEvent(\n    type="server_tool_result",\n    data={...` shape, which would break that literal
grep. Confirmed `ruff format --check` is NOT a gate this repo actually enforces (the file already
contained several pre-existing lines — `_SYSTEM_PROMPT`, a list-comprehension `if` clause, a
`logger.warning` call, `_provider_content_blocks`'s tool_invocation_result branch — that do not
match `ruff format`'s canonical output, predating this plan entirely; neither 34-03-SUMMARY.md nor
38-01-SUMMARY.md's own verification blocks ever run `ruff format`). `ruff check` (the actual lint
gate) passes clean on both files. Kept the `ChatRunEvent(type="server_tool_result", data={` head on
one line (dict body still wrapped across lines for the 4 keys) to satisfy both the plan's literal
acceptance criteria and `ruff check`. Files: `run_chat_turn.py`. No test impact.

## Known Stubs

None. This is a strictly additive, 2-statement-per-dispatch-point change with no UI/data-flow
attached yet — the web-side consumer (39-02) is a separate sibling plan.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-39-01/02/03, all pre-declared and already
mitigated/accepted in the plan text — `server_tool_call`'s `data` shape omits `arguments` exactly
as T-39-01 requires, verified by the new test's exact-key-set assertion).

## Self-Check: PASSED

- FOUND: apps/email-listener/app/domain/ports/chat_repositories.py (ChatRunEventType widened,
  server_tool_call/server_tool_result present)
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py (both ChatRunEvent(...)
  mirror constructions present inside _run_server_tool_round)
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py (13 tests, 2 new)
- FOUND commit 35f5f54 (Task 1 — feat(39-01): emit non-persisted server_tool_call/server_tool_result SSE mirror frames)
