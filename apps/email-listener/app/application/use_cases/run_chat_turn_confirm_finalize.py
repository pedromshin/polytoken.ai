"""emit_confirm_action live-re-read finalization (Phase 40-01 CONF-01 / 54-03 CLUS-04; carved from run_chat_turn.py, W7-1).

Owns the two async finalizers that are NOT purely parse-driven: a
still-pending emit_confirm_action call is finalized via a LIVE re-read of
the suggestion it names — a `knowledge_node_edges` row for
knowledge_edge_tier_promotion, a persisted web_search result for
source_capture — failing into visible text when the suggestion is
gone/inactive/cross-tenant/wrong-tier or the call itself is malformed
(never silent). The pure parse/build helpers stay in
run_chat_turn_confirm_action.py; the pure result lookups stay in
chat/source_capture_lookup.py. Moved VERBATIM out of RunChatTurn — the
instance collaborators (`self._knowledge_graph`, `self._messages`) became
explicit keyword parameters, nothing else changed.

Architecture contract (lint-imports): imports only domain ports/services and
standard library / structlog — same as the facade.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import TYPE_CHECKING, Any

import structlog

from app.application.use_cases.chat.source_capture_lookup import (
    _find_latest_web_search_result_by_index,
    _find_web_search_result,
    _find_web_search_result_in_parts,
)
from app.application.use_cases.run_chat_turn_confirm_action import (
    CONFIRM_ACTION_UNAVAILABLE_TEXT,
    EMIT_CONFIRM_ACTION_TOOL_NAME,
    SUGGESTION_KIND_SOURCE_CAPTURE,
    build_confirm_action_declaration,
    build_source_capture_declaration,
    parse_confirm_action_call,
    parse_source_capture_result_id,
)
from app.application.use_cases.run_chat_turn_tool_loop import PARSE_FAILURE_TEXT

if TYPE_CHECKING:
    from app.application.use_cases.chat.turn_state import _TurnState
    from app.domain.ports.chat_repositories import ChatMessageRepository, ChatRunEventType
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)


async def _finalize_confirm_action(
    state: _TurnState,
    *,
    importer_id: str,
    conversation_id: str,
    knowledge_graph: KnowledgeGraphRepository | None,
    messages: ChatMessageRepository,
) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
    """Finalize a still-pending emit_confirm_action call via a LIVE re-read (CONF-01/CLUS-04).

    No-op (`state, None`) unless the pending tool is emit_confirm_action —
    every other pending tool name falls through unchanged to the caller's
    subsequent `_finalize_pending_tool(state)` call.

    Clears pending_tool_* EAGERLY on every branch below (parse-fail,
    edge-unavailable, success) — this is what makes it safe to run this
    live-I/O check from `_finalize_turn_completed` (the only async site
    with the repositories) while `_finalize_pending_tool` itself stays pure:
    by the time that pure function runs next, pending_tool_id is already
    None, so it is provably a no-op for this tool.

    A malformed call (T-40-04) never reaches ANY live lookup — parsing
    happens first for both suggestion kinds. `source_capture` (Phase
    54-03) branches into `_finalize_source_capture`, which re-reads a
    persisted web_search result instead of a `knowledge_node_edges` row.
    For `knowledge_edge_tier_promotion`: edge-not-found, cross-importer,
    inactive, and wrong-tier all collapse into the SAME
    CONFIRM_ACTION_UNAVAILABLE_TEXT (T-40-02) — a probing model/user
    cannot distinguish "wrong tenant" from "already resolved" from
    "doesn't exist". A DB error during the lookup is caught and treated
    identically to edge-unavailable (fail-closed, never crashes the turn).
    """
    if state.pending_tool_name != EMIT_CONFIRM_ACTION_TOOL_NAME or state.pending_tool_id is None:
        return state, None

    tool_id = state.pending_tool_id
    raw_json = state.pending_tool_json
    cleared = replace(state, pending_tool_name=None, pending_tool_id=None, pending_tool_json="")

    parsed = parse_confirm_action_call(raw_json)
    if parsed is None:
        logger.warning("confirm_action_tool_call_parse_failed", tool_id=tool_id)
        return replace(cleared, parts=(*cleared.parts, {"type": "text", "text": PARSE_FAILURE_TEXT})), None

    if parsed["kind"] == SUGGESTION_KIND_SOURCE_CAPTURE:
        return await _finalize_source_capture(
            cleared,
            tool_id=tool_id,
            parsed=parsed,
            importer_id=importer_id,
            conversation_id=conversation_id,
            messages=messages,
        )

    edge: dict[str, object] | None = None
    if knowledge_graph is not None:
        try:
            edge = await knowledge_graph.find_edge_by_id(parsed["id"])
        except Exception:  # fail-closed, never crash the turn on a DB hiccup
            logger.warning("confirm_action_edge_lookup_failed", tool_id=tool_id, suggestion_id=parsed["id"])
            edge = None

    edge_valid = (
        edge is not None
        and edge.get("importer_id") == importer_id
        and bool(edge.get("is_active"))
        and edge.get("tier") in ("INFERRED", "AMBIGUOUS")
    )
    if not edge_valid:
        logger.warning("confirm_action_edge_unavailable", tool_id=tool_id, suggestion_id=parsed["id"])
        return (
            replace(cleared, parts=(*cleared.parts, {"type": "text", "text": CONFIRM_ACTION_UNAVAILABLE_TEXT})),
            None,
        )

    assert edge is not None  # narrows for mypy -- edge_valid already proved this
    declaration = build_confirm_action_declaration(
        kind=parsed["kind"],
        suggestion_id=parsed["id"],
        edge=edge,
        rationale=parsed["rationale"],
    )
    widget_part = {
        "type": "interactive_widget",
        "interactionId": str(uuid.uuid4()),
        "widgetKind": "confirm_action",
        "declaration": declaration,
    }
    finalized = replace(cleared, parts=(*cleared.parts, widget_part))
    return finalized, (
        "tool_result",
        {"tool_name": EMIT_CONFIRM_ACTION_TOOL_NAME, "id": tool_id, "interactionId": widget_part["interactionId"]},
    )


async def _finalize_source_capture(
    cleared: _TurnState,
    *,
    tool_id: str,
    parsed: dict[str, Any],
    importer_id: str,
    conversation_id: str,
    messages: ChatMessageRepository,
) -> tuple[_TurnState, tuple[ChatRunEventType, dict[str, Any]] | None]:
    """Re-read a web_search result server-side by its {toolUseId}:{index} id (Phase 54-03, T-54-03-01).

    Never trusts model-authored title/url/snippet text — only the id (a
    lookup key into a server-recorded tool_invocation_result part) comes
    from the model. The CURRENT turn's accumulated parts are scanned
    FIRST — the designed flow is search-then-propose in ONE turn, and at
    finalize time this turn's assistant message is not yet persisted
    (found live 2026-07-12: the history-only lookup made every same-turn
    capture collapse into 'unavailable', deadlocking CLUS-04 — prior-turn
    refs are impossible too, since replay stand-ins omit tool ids).
    Persisted history remains the fallback. A malformed id, an
    unresolvable toolUseId, an out-of-range index, or a foreign
    (cross-conversation) result all collapse into the SAME
    CONFIRM_ACTION_UNAVAILABLE_TEXT (T-54-03-03 — no leak of which case).
    `retrievedAt` is stamped fresh at THIS re-read (server time, never
    model-supplied).
    """
    source: dict[str, object] | None = None
    ref = parse_source_capture_result_id(parsed["id"])
    if ref is not None:
        tool_use_id, index = ref
        source = _find_web_search_result_in_parts(cleared.parts, tool_use_id=tool_use_id, index=index)
        if source is None:
            try:
                history = await messages.list_active_context(conversation_id)
            except Exception:  # fail-closed, never crash the turn on a DB hiccup
                logger.warning("confirm_action_source_capture_lookup_failed", tool_id=tool_id)
                history = []
            source = _find_web_search_result(history, tool_use_id=tool_use_id, index=index)
        if source is None:
            # Models mistranscribe opaque tool ids (observed live
            # 2026-07-12: 'toolu_01...' fabricated for the real
            # 'toolu_bdrk_01...'). The id is only a lookup key — content
            # is still re-read server-side, and the user still sees the
            # exact url/title in the confirm widget before anything is
            # written (suggest-only gate) — so fall back to resolving
            # `index` against THIS turn's own web_search results
            # (most recent first). Cross-conversation reads stay
            # impossible; no same-turn search means still-unavailable.
            source = _find_latest_web_search_result_by_index(cleared.parts, index=index)
            if source is not None:
                logger.warning(
                    "confirm_action_source_capture_id_fallback",
                    tool_id=tool_id,
                    suggestion_id=parsed["id"],
                )

    if source is None:
        logger.warning("confirm_action_source_capture_unavailable", tool_id=tool_id, suggestion_id=parsed["id"])
        return (
            replace(cleared, parts=(*cleared.parts, {"type": "text", "text": CONFIRM_ACTION_UNAVAILABLE_TEXT})),
            None,
        )

    declaration = build_source_capture_declaration(
        suggestion_id=parsed["id"],
        source=source,
        rationale=parsed["rationale"],
        importer_id=importer_id,
    )
    widget_part = {
        "type": "interactive_widget",
        "interactionId": str(uuid.uuid4()),
        "widgetKind": "confirm_action",
        "declaration": declaration,
    }
    finalized = replace(cleared, parts=(*cleared.parts, widget_part))
    return finalized, (
        "tool_result",
        {"tool_name": EMIT_CONFIRM_ACTION_TOOL_NAME, "id": tool_id, "interactionId": widget_part["interactionId"]},
    )
