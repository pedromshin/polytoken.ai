"""The server-tool round executor (Phase 34-03 LOOP-01; carved from run_chat_turn.py, W7-1).

Owns the round-loop tuning constants (round cap, per-tool timeouts, the
fail-closed replacement texts), the `_ServerRoundResult` outcome type, the
fail-open source-ledger auto-collect hook (Phase 56-02, RCNV-01), and
`_run_server_tool_round` — the "dispatch, cap, feed back" engine for one
mid-turn server-tool round. Moved VERBATIM out of RunChatTurn — the
instance collaborators (`self._runs` via `self._emit`, `self._breaker`,
`self._tool_executors`, `self._source_ledger`) became explicit keyword
parameters, nothing else changed.

Architecture contract (lint-imports): imports only domain ports/services and
standard library / structlog — same as the facade.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

import structlog

from app.application.use_cases.chat.prompt_assembly import _provider_content_blocks
from app.application.use_cases.chat.source_capture_lookup import _WEB_SEARCH_TOOL_NAME
from app.application.use_cases.chat.turn_state import _TurnState
from app.application.use_cases.run_chat_turn_stream_guard import (
    _estimated_cost_so_far,
    _estimated_round_cost_so_far,
)
from app.application.use_cases.run_chat_turn_tool_loop import (
    FINAL_ROUND_NUDGE_TEXT,
    MAX_SERVER_CALLS_PER_ROUND,
    PARALLEL_CALL_OVERFLOW_TEXT,
    build_synthetic_tool_results_message,
    build_tool_invocation_part,
    build_tool_invocation_result_part,
    cap_tool_output,
)
from app.domain.ports.chat_provider import ToolResultDelta
from app.domain.ports.chat_repositories import ChatRunEvent
from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.tool_envelope_gate import validate_tool_envelope

if TYPE_CHECKING:
    from collections.abc import Mapping

    from app.domain.ports.chat_repositories import ChatRun, ChatRunRepository
    from app.domain.ports.source_ledger_repository import SourceLedgerRepository
    from app.domain.ports.tool_executor import ToolExecutor
    from app.domain.services.chat_model_registry import ChatModel
    from app.domain.services.cost_circuit_breaker import CostCircuitBreaker

logger = structlog.get_logger(__name__)

# Phase 56-02 (RCNV-01): the ledger-eligible tool allowlist -- only a tool
# name in this frozenset ever triggers a `chat_source_ledger` auto-collect
# write. Starts as exactly the one already-gated web_search tool (A4:
# gating is inherited transitively from WEB_SEARCH_TOOL_ENABLED -- the hook
# only ever fires for an already-gated tool, no separate settings flag).
_LEDGER_ELIGIBLE_TOOL_NAMES = frozenset({_WEB_SEARCH_TOOL_NAME})

# Phase 34-03 (LOOP-01): bounded mid-turn server-tool round loop. A round is
# one "model calls a server tool -> executor runs -> result fed back" cycle
# inside the SAME _execute_turn call/run (no new ChatRun per round, SEAM-04).
# At most _MAX_TOOL_ROUNDS executor.execute() calls happen per turn -- a
# request for a 5th server tool call after the cap is exhaustion (LOOP-03),
# never a 5th execution.
_MAX_TOOL_ROUNDS = 4
# Per-tool execution ceiling (T-34-01) -- a timeout never raises out of the
# loop, it becomes an is_error ToolExecutionResult instead.
_TOOL_EXECUTION_TIMEOUT_SECONDS = 10.0
# Phase 69 (RSRCH-01): deep_research is a bounded multi-round agentic loop
# (several LLM steps + web-search rounds), not a lookup -- the flat 10s
# ceiling above would kill every real run mid-plan. Per-tool override,
# consulted at the one dispatch point in _run_server_tool_round; every other
# tool keeps the flat default. This is only the stalled-run backstop -- the
# loop's own ResearchBudget (token ceiling + round cap, deep_research.py) is
# the real cost gate, and it aborts fail-closed long before this fires on a
# healthy run.
_TOOL_TIMEOUT_OVERRIDES: dict[str, float] = {"deep_research": 600.0}
_TOOL_TIMEOUT_TEXT = "Tool execution timed out."
_TOOL_EXECUTION_ERROR_TEXT = "Tool execution failed."

# Phase 38 (QUAR-01): the ONE wiring point's fail-closed replacement text --
# an executor output that fails validate_tool_envelope() is swapped for this
# generic, safe text (never the raw poisoned content) and marked is_error.
_TOOL_ENVELOPE_INVALID_TEXT = "That tool result didn't pass a safety check, so I discarded it."


@dataclass(frozen=True)
class _ServerRoundResult:
    """Outcome of one server-tool round (Phase 34-03, LOOP-01) — see `_run_server_tool_round`.

    provider_messages is None exactly when the post-round breaker re-check
    (T-34-01) trips — the caller must terminate the turn `cost_capped`.
    Otherwise it carries the NEXT round's provider_messages and the caller
    increments round_count and continues streaming in the SAME run.
    """

    state: _TurnState
    events: tuple[ChatRunEvent, ...]
    provider_messages: list[dict[str, Any]] | None


async def _write_source_ledger_entries(
    *,
    source_ledger: SourceLedgerRepository | None,
    conversation_id: str,
    importer_id: str,
    tool_name: str,
    tool_use_id: str,
    content: str,
) -> None:
    """Fail-open ledger write (Phase 56-02, RCNV-01) — never raises past the tool round.

    Parses the ALREADY-quarantined+bounded envelope (post `validate_tool_envelope` +
    `cap_tool_output`) `{"mode": "web_search", "results": [{"title","url","snippet"}, ...]}`,
    builds one `SourceLedgerEntry` per result carrying a url (urlless entries are skipped,
    `result_index` is the enumeration position), and upserts them via `insert_entries` when
    non-empty. Zero writes to the confirm-ceremony knowledge graph — this is a separate
    candidate pool (999.19), never the `SourceCaptureHandler` path.

    A malformed/unparseable envelope, or ANY failure from `insert_entries` (e.g. the
    chat_source_ledger table not yet applied to this environment), logs a warning and
    returns — mirrors `_list_captured_sources`/`_resolve_thread_id`'s exact fail-open
    idiom (T-56-02-01: never block the model's turn, never raise a 500).
    """
    if source_ledger is None:
        return
    try:
        envelope = json.loads(content)
        results = envelope.get("results", []) if isinstance(envelope, dict) else []
        entries = [
            SourceLedgerEntry(
                conversation_id=conversation_id,
                importer_id=importer_id,
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                result_index=index,
                url=str(result["url"]),
                title=str(result.get("title") or result["url"]),
                snippet=str(result.get("snippet")) if result.get("snippet") else None,
            )
            for index, result in enumerate(results)
            if isinstance(result, dict) and result.get("url")
        ]
        if entries:
            await source_ledger.insert_entries(entries)
    except Exception:  # never raise past the tool round (fail-open, T-56-02-01)
        logger.warning("source_ledger_write_failed", tool_use_id=tool_use_id, tool_name=tool_name)


async def _run_server_tool_round(
    *,
    run: ChatRun,
    runs: ChatRunRepository,
    breaker: CostCircuitBreaker,
    tool_executors: Mapping[str, ToolExecutor],
    source_ledger: SourceLedgerRepository | None,
    state: _TurnState,
    model: ChatModel,
    calls: list[dict[str, Any]],
    this_round_lead_parts: list[dict[str, Any]],
    provider_messages: list[dict[str, Any]],
    round_start_output_tokens: int,
    round_start_text_len: int,
    importer_id: str,
    is_last_round: bool = False,
) -> _ServerRoundResult:
    """Execute one server-tool round (Phase 34-03, LOOP-01): dispatch, cap, feed back.

    `calls` is EVERY server-tool call the model emitted in this response
    ({"name", "id", "arguments"} each, in emission order) — the API
    contract requires one tool_result per tool_use in the SAME next user
    message. Calls beyond MAX_SERVER_CALLS_PER_ROUND are not executed but
    still get an is_error tool_result (bounded work, protocol intact).

    `is_last_round`: this round consumed the tool budget — the fed-back
    user message gains a trailing FINAL_ROUND_NUDGE_TEXT text block
    (paired with the final stream offering no server tools) so the model
    spends its last stream answering instead of asking for another lookup.

    A per-tool timeout (`asyncio.wait_for`, ~10s, T-34-01) or ANY raised
    exception NEVER escapes this method — both become an `is_error`
    `ToolExecutionResult` (port contract, `tool_executor.py`). The
    `tool_invocation`/`tool_invocation_result` parts and the `tool_call`/
    `tool_result` run events are always recorded, whatever the outcome.
    """
    events: list[ChatRunEvent] = []
    results: list[ToolExecutionResult] = []
    for call_index, call in enumerate(calls):
        tool_name: str = call["name"]
        tool_id: str = call["id"]
        arguments: dict[str, Any] = call["arguments"]
        invocation_part = build_tool_invocation_part(tool_name, tool_id, arguments)
        state = replace(state, parts=(*state.parts, invocation_part))
        events.append(
            await runs.append_event(
                run_id=run.id,
                event_type="tool_call",
                data={"tool_name": tool_name, "id": tool_id, "arguments": arguments},
            )
        )
        # Phase 39 (TUI-01): non-persisted SSE mirror frame -- constructed
        # DIRECTLY (never routed through self._emit/self._runs.append_event),
        # id/run_id/seq stay at their dataclass defaults (None). Deliberately
        # omits `arguments` (see 39-UI-SPEC.md's SSE / Part Contract).
        events.append(ChatRunEvent(type="server_tool_call", data={"tool_name": tool_name, "id": tool_id}))

        if call_index >= MAX_SERVER_CALLS_PER_ROUND:
            logger.warning("server_tool_call_overflow_skipped", tool_id=tool_id, tool_name=tool_name)
            result = ToolExecutionResult(tool_use_id=tool_id, content=PARALLEL_CALL_OVERFLOW_TEXT, is_error=True)
        else:
            executor = tool_executors[tool_name]
            try:
                result = await asyncio.wait_for(
                    executor.execute(name=tool_name, arguments=arguments, importer_id=importer_id),
                    timeout=_TOOL_TIMEOUT_OVERRIDES.get(tool_name, _TOOL_EXECUTION_TIMEOUT_SECONDS),
                )
            except TimeoutError:
                logger.warning("server_tool_execution_timed_out", tool_id=tool_id, tool_name=tool_name)
                result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_TIMEOUT_TEXT, is_error=True)
            except Exception:  # an executor MUST NEVER raise out of the loop (port contract)
                logger.warning("server_tool_execution_failed", tool_id=tool_id, tool_name=tool_name)
                result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_EXECUTION_ERROR_TEXT, is_error=True)

        # Phase 38 (QUAR-01): the ONE wiring point in the round loop -- every
        # registered executor's non-error output is validated against the
        # structural envelope contract BEFORE it can enter provider_messages
        # or a persisted part. The existing timeout/exception is_error
        # results above are deliberately left untouched -- their content is
        # already a pre-vetted safe string, not JSON from an executor.
        if result.is_error is False:
            gate = validate_tool_envelope(result.content)
            if gate.ok is False:
                logger.warning("tool_envelope_gate_rejected", tool_id=tool_id, tool_name=tool_name, reason=gate.reason)
                result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_ENVELOPE_INVALID_TEXT, is_error=True)

        # T-34-04 defense-in-depth / protocol correctness: the fed-back native
        # tool_result block's tool_use_id MUST match the tool_use block's id
        # exactly (Anthropic/Bedrock correlation contract) -- the ToolExecutor
        # port's execute() signature doesn't even receive tool_use_id as an
        # input, so an executor's own result.tool_use_id is NEVER trusted for
        # this; always overridden with the id the model actually streamed.
        result = replace(result, tool_use_id=tool_id, content=cap_tool_output(result.content))
        results.append(result)

        # Phase 56-02 (RCNV-01): fail-open auto-collect write, fires ONLY for an
        # already-gated, non-error, ledger-eligible tool result -- never raises,
        # never blocks the round (see _write_source_ledger_entries).
        if source_ledger is not None and result.is_error is False and tool_name in _LEDGER_ELIGIBLE_TOOL_NAMES:
            await _write_source_ledger_entries(
                source_ledger=source_ledger,
                conversation_id=run.conversation_id,
                importer_id=importer_id,
                tool_name=tool_name,
                tool_use_id=tool_id,
                content=result.content,
            )

        result_part = build_tool_invocation_result_part(result, tool_name)
        state = replace(state, parts=(*state.parts, result_part))
        # ToolResultDelta (chat_provider.py) — modeled, never emitted until now
        # (LOOP-01): its fields feed the persisted tool_result run event.
        tool_result_delta = ToolResultDelta(
            tool_use_id=result.tool_use_id, content=result.content, is_error=result.is_error
        )
        events.append(
            await runs.append_event(
                run_id=run.id,
                event_type="tool_result",
                data={
                    "tool_name": tool_name,
                    "id": tool_id,
                    "content": tool_result_delta.content,
                    "isError": tool_result_delta.is_error,
                },
            )
        )
        # Phase 39 (TUI-01): non-persisted SSE mirror frame, same convention
        # as the server_tool_call mirror above -- identical `data` shape to
        # the persisted tool_result event (byte-identical mirror, per
        # 39-UI-SPEC.md), so the client can build the SAME
        # tool_invocation_result part client-side without a "flash" on
        # terminal chat.getHistory refetch.
        events.append(
            ChatRunEvent(
                type="server_tool_result",
                data={
                    "tool_name": tool_name,
                    "id": tool_id,
                    "content": tool_result_delta.content,
                    "isError": tool_result_delta.is_error,
                },
            )
        )

    # T-34-01: a round is the same spend commitment as continuing to
    # stream — re-check the breaker at the round boundary. COST-05
    # (Phase 35): ALSO re-check the round-scoped ceiling here — either
    # the per-turn OR the per-round cap tripping aborts the turn.
    if breaker.should_abort(
        _estimated_cost_so_far(breaker=breaker, model=model, state=state)
    ) or breaker.should_abort_round(
        _estimated_round_cost_so_far(
            breaker=breaker,
            model=model,
            state=state,
            round_start_output_tokens=round_start_output_tokens,
            round_start_text_len=round_start_text_len,
        )
    ):
        return _ServerRoundResult(state=state, events=tuple(events), provider_messages=None)

    tool_use_blocks = [
        {"type": "tool_use", "id": call["id"], "name": call["name"], "input": call["arguments"]} for call in calls
    ]
    # this_round_lead_parts are CANONICAL parts (text | genui_spec |
    # interactive_widget ...), not Anthropic content blocks — a genui_spec
    # finalized before this server-tool call in the same stream would 400
    # the next round ("Input tag 'genui_spec' ... does not match") if
    # replayed raw. Same conversion as history replay.
    lead_blocks = _provider_content_blocks(this_round_lead_parts)
    results_message = build_synthetic_tool_results_message(results)
    if is_last_round:
        results_message = {
            **results_message,
            "content": [*results_message["content"], {"type": "text", "text": FINAL_ROUND_NUDGE_TEXT}],
        }
    next_provider_messages = [
        *provider_messages,
        {"role": "assistant", "content": [*lead_blocks, *tool_use_blocks]},
        results_message,
    ]
    return _ServerRoundResult(state=state, events=tuple(events), provider_messages=next_provider_messages)
