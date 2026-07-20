"""Turn-state accumulator + pure delta-folding functions (carved from run_chat_turn.py, 999.31).

`_TurnState` is the immutable accumulator folded across a turn's streamed
deltas (Phase 22-07, D-18); the functions here are the pure (no-I/O) fold and
finalize steps the RunChatTurn orchestrator drives. Moved verbatim — the
facade re-exports every name here under its old module path.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

import structlog

from app.application.use_cases.run_chat_turn_tool_loop import (
    PARSE_FAILURE_TEXT,
    SERVER_CALL_NOT_EXECUTED_TEXT,
)
from app.application.use_cases.run_chat_turn_widgets import (
    INTERACTIVE_WIDGET_TOOL_NAMES,
    build_interactive_widget_part,
)
from app.domain.ports.chat_provider import TextDelta, ToolCallDelta, UsageDelta

if TYPE_CHECKING:
    from collections.abc import Collection

    from app.domain.ports.chat_provider import ChatDelta
    from app.domain.ports.chat_repositories import ChatRunEventType

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class _TurnState:
    """Immutable accumulator folded across a turn's streamed deltas (Phase 22-07, D-18).

    parts: FINALIZED interleaved content parts, in emission order (text | genui_spec).
    text_buffer: text accumulated since the last flush point (not yet a part).
    pending_tool_name/pending_tool_id/pending_tool_json: an in-flight emit_ui_spec
        tool call's partial JSON, accumulated across ToolCallDelta chunks sharing
        the same id, until a different delta type/id finalizes it into a part.
    queued_server_calls: SERVER-tool calls finalized mid-stream (the model may
        emit several tool_use blocks in ONE response — observed live 2026-07-12).
        Each is a raw {"name", "id", "raw_json"} awaiting execution by
        `_advance_round`, which runs ALL of them in the round and feeds back one
        tool_result per tool_use (API contract). Before this queue existed, any
        server call that wasn't the LAST pending one at StreamEnd was mangled
        into a bogus genui_spec part.
    """

    parts: tuple[dict[str, Any], ...] = ()
    text_buffer: str = ""
    pending_tool_name: str | None = None
    pending_tool_id: str | None = None
    pending_tool_json: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    queued_server_calls: tuple[dict[str, str], ...] = ()


def _apply_delta(
    delta: ChatDelta,
    state: _TurnState,
    *,
    server_tool_names: Collection[str] = (),
) -> tuple[_TurnState, list[tuple[ChatRunEventType, dict[str, Any]]]]:
    """Fold one provider delta into the running turn state (pure, no I/O).

    TextDelta: finalizes any in-flight emit_ui_spec tool call first (D-18
    interleaving order), then buffers the text and emits a
    text_delta_checkpoint event.
    ToolCallDelta: flushes any buffered text before STARTING a new tool call
    (or finalizes a DIFFERENT prior tool call before starting this one), then
    accumulates this chunk's partial_json and emits a tool_call event so the
    client can render the partial tree progressively (STREAM-02).
    UsageDelta: records the real captured token counts, ACCUMULATING across
    multiple UsageDelta events (a multi-round turn emits one per round,
    LOOP-02 bugfix — the prior overwrite silently under-reported cost the
    moment a turn spans more than one round); no part/event change.
    A non-error StreamEnd needs no mid-loop handling (D-03/22-06 precedent).

    `server_tool_names` routes a mid-stream-finalized SERVER tool call onto
    `state.queued_server_calls` (executed by `_advance_round`) instead of
    mangling it into a genui_spec part — the model may emit several tool_use
    blocks in one response (live regression 2026-07-12).
    """
    if isinstance(delta, TextDelta):
        events: list[tuple[ChatRunEventType, dict[str, Any]]] = []
        if state.pending_tool_id is not None:
            state, tool_result_event = _finalize_pending_tool(state, server_tool_names=server_tool_names)
            if tool_result_event is not None:
                events.append(tool_result_event)
        state = replace(state, text_buffer=state.text_buffer + delta.text)
        events.append(("text_delta_checkpoint", {"text": delta.text}))
        return state, events

    if isinstance(delta, ToolCallDelta):
        events = []
        if state.pending_tool_id is not None and state.pending_tool_id != delta.id:
            state, tool_result_event = _finalize_pending_tool(state, server_tool_names=server_tool_names)
            if tool_result_event is not None:
                events.append(tool_result_event)
        if state.pending_tool_id is None:
            state = _flush_text_buffer(state)
            state = replace(state, pending_tool_name=delta.tool_name, pending_tool_id=delta.id, pending_tool_json="")
        state = replace(state, pending_tool_json=state.pending_tool_json + delta.partial_json)
        events.append(("tool_call", {"tool_name": delta.tool_name, "id": delta.id, "partial_json": delta.partial_json}))
        return state, events

    if isinstance(delta, UsageDelta):
        state = replace(
            state,
            input_tokens=state.input_tokens + delta.input_tokens,
            output_tokens=state.output_tokens + delta.output_tokens,
        )
        return state, []

    return state, []


def _flush_text_buffer(state: _TurnState) -> _TurnState:
    """Flush any buffered text into a finalized text part (order-preserving, D-18)."""
    if not state.text_buffer:
        return state
    return replace(state, parts=(*state.parts, {"type": "text", "text": state.text_buffer}), text_buffer="")


def _finalize_pending_tool(
    state: _TurnState,
    *,
    server_tool_names: Collection[str] = (),
) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
    """Parse an in-flight tool call's accumulated JSON into its finalized part.

    A SERVER tool call (name in `server_tool_names`) never becomes a part
    here — it moves onto `state.queued_server_calls` for `_advance_round` to
    execute (the model may emit several tool_use blocks in one response; only
    the last is still pending at StreamEnd). Callers that don't pass
    `server_tool_names` (the emit_ui_spec/widget finalize sites, where a
    server call can no longer be pending) keep the prior behavior exactly.

    emit_ui_spec (or any other non-widget tool) finalizes into a genui_spec
    part, stored verbatim (no validation/fallback -- that gate is the web
    boundary, FOUND-6). Phase 24-02 interactive-widget tools (e.g.
    emit_proposal_cards) finalize into an `interactive_widget` part instead
    (run_chat_turn_widgets.py owns the parse logic) -- never both. A tool
    call whose JSON never parses, or whose shape is unusable (e.g. cut off
    mid-stream), NEVER persists an invalid part and NEVER drops silently
    (LOOP-02 bugfix) -- it appends a visible PARSE_FAILURE_TEXT text part so
    the user sees the lookup failed, while the server-side logger.warning
    detail is retained.
    """
    if state.pending_tool_id is None:
        return state, None
    tool_name = state.pending_tool_name or ""
    tool_id = state.pending_tool_id
    raw_json = state.pending_tool_json
    cleared = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")

    if tool_name in server_tool_names:
        queued = {"name": tool_name, "id": tool_id, "raw_json": raw_json}
        return replace(cleared, queued_server_calls=(*cleared.queued_server_calls, queued)), None

    if tool_name in INTERACTIVE_WIDGET_TOOL_NAMES:
        widget_part = build_interactive_widget_part(tool_name, raw_json)
        if widget_part is None:
            logger.warning("interactive_widget_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
            return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None
        finalized = replace(cleared, parts=(*cleared.parts, widget_part))
        return finalized, (
            "tool_result",
            {"tool_name": tool_name, "id": tool_id, "interactionId": widget_part["interactionId"]},
        )

    try:
        spec: dict[str, Any] = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("emit_ui_spec_tool_call_parse_failed", tool_id=tool_id, tool_name=tool_name)
        return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None
    finalized = replace(cleared, parts=(*cleared.parts, {"type": "genui_spec", "spec": spec}))
    return finalized, ("tool_result", {"tool_name": tool_name, "id": tool_id, "spec": spec})


def _finalize_state(state: _TurnState, *, server_tool_names: Collection[str] = ()) -> _TurnState:
    """Flush any remaining buffered text/pending tool call into parts (never dropped, D-15).

    A server-tool call still pending/queued at persist time (the turn
    terminated mid-stream before its round could run) surfaces as a visible
    SERVER_CALL_NOT_EXECUTED_TEXT part — never a silent drop, never a bogus
    genui_spec part (the pre-2026-07-12 mangling bug).
    """
    state, _tool_result_event = _finalize_pending_tool(state, server_tool_names=server_tool_names)
    if state.queued_server_calls:
        not_executed = tuple({"type": "text", "text": SERVER_CALL_NOT_EXECUTED_TEXT} for _ in state.queued_server_calls)
        state = replace(state, parts=(*state.parts, *not_executed), queued_server_calls=())
    return _flush_text_buffer(state)


def _accumulated_text_for_estimate(state: _TurnState) -> str:
    """Cheap text-length signal for the mid-stream cost estimate (D-21 heuristic).

    Sums already-finalized text parts plus the current buffer; tool-call JSON
    length is intentionally excluded (the heuristic tracks assistant PROSE
    output, mirroring the pre-22-07 accumulated_text estimate).
    """
    finalized_text = "".join(part["text"] for part in state.parts if part.get("type") == "text")
    return finalized_text + state.text_buffer
