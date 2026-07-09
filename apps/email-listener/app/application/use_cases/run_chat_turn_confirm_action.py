"""Pure parse/declaration-builder helpers for emit_confirm_action (Phase 40-01, CONF-01).

Mirrors run_chat_turn_widgets.py's contract statement: pure functions only, no
I/O, no ports. This module accepts/returns plain dicts and stays free of any
`KnowledgeGraphRepository` type import — the live edge read is the caller's
(RunChatTurn's) job, matching the port's own convention. Keeping this module
free of infrastructure imports also satisfies the import-linter's "Application
does not import infrastructure" contract.

The model supplies ONLY a `suggestionRef {kind, id}` (+ an optional short
`rationale`) via the emit_confirm_action tool — never a tier, node id, or
mutation parameter (T-40-01). `parse_confirm_action_call` re-validates this
defense-in-depth even though the tool's own JSON schema (chat_tools.py) already
restricts `suggestionRef.kind` to a single enum value. `build_confirm_action_
declaration` then turns an ALREADY-FETCHED edge dict into the frozen
confirm/reject widget declaration — it performs no I/O itself.

CONFIRM_ACTION_UNAVAILABLE_TEXT is this phase's "never silent" visible-surface
string (mirrors run_chat_turn_tool_loop.py's PARSE_FAILURE_TEXT/
ROUND_CAP_EXHAUSTED_TEXT convention): edge-not-found, cross-importer,
inactive, and wrong-tier all collapse into this SAME generic text so a
model/user probing another importer's edge id cannot distinguish "wrong
tenant" from "already resolved" from "doesn't exist" (T-40-02).
"""

from __future__ import annotations

import json
from typing import Any

# Mirrors app.infrastructure.llm.chat_tools.EMIT_CONFIRM_ACTION_TOOL_NAME --
# defined locally (not imported) because the import-linter forbids
# app.application -> app.infrastructure (same pattern as
# run_chat_turn_tool_loop.py's EMIT_UI_SPEC_TOOL_NAME).
EMIT_CONFIRM_ACTION_TOOL_NAME = "emit_confirm_action"

# The two suggestionRef.kind values this phase's dispatch vocabulary knows
# about. Only SUGGESTION_KIND_EDGE_TIER_PROMOTION is ever reachable via the
# emit_confirm_action tool's own JSON schema this phase (chat_tools.py's enum
# restricts it) -- SUGGESTION_KIND_ENTITY_MERGE_CONFIRM is defined here so
# Plan 40-02's submit-time dispatch table can reference it by name.
SUGGESTION_KIND_EDGE_TIER_PROMOTION = "knowledge_edge_tier_promotion"
SUGGESTION_KIND_ENTITY_MERGE_CONFIRM = "entity_merge_confirm"

# Live-read validation collapses every unavailable case (not-found,
# cross-importer, inactive, wrong-tier) into this ONE generic string (T-40-02
# -- never lets a caller distinguish tenant-mismatch from already-resolved
# from nonexistent).
CONFIRM_ACTION_UNAVAILABLE_TEXT = (
    "That suggestion is no longer available to confirm — it may have already been resolved."
)

# Server-assigned option ids (D-05 precedent: never trust a model-supplied
# id). "confirm"/"reject" ARE the wire-format contract -- they double as both
# the proposal-card-shaped `optionId` enum values submitted at CONF-02 time
# and the dispatch `action` parameter, zero extra mapping needed.
_CONFIRM_OPTION: dict[str, str] = {"id": "confirm", "title": "Confirm"}
_REJECT_OPTION: dict[str, str] = {"id": "reject", "title": "Reject"}


def parse_confirm_action_call(raw_json: str) -> dict[str, Any] | None:
    """Parse a finalized emit_confirm_action tool call's accumulated JSON.

    Pure -- no I/O. Returns `{"kind": ..., "id": ..., "rationale": str | None}`
    on success, or None (fail-closed) when: the JSON never parses, the parsed
    shape isn't a dict, `suggestionRef` isn't a dict, `suggestionRef.kind` is
    not exactly SUGGESTION_KIND_EDGE_TIER_PROMOTION (rejecting
    "entity_merge_confirm" and anything else -- defense in depth even though
    the tool schema already restricts this), or `suggestionRef.id` is not a
    non-empty string.
    """
    try:
        raw: Any = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None

    suggestion_ref = raw.get("suggestionRef")
    if not isinstance(suggestion_ref, dict):
        return None

    kind = suggestion_ref.get("kind")
    if kind != SUGGESTION_KIND_EDGE_TIER_PROMOTION:
        return None

    suggestion_id = suggestion_ref.get("id")
    if not isinstance(suggestion_id, str) or not suggestion_id:
        return None

    rationale = raw.get("rationale")
    if not isinstance(rationale, str):
        rationale = None

    return {"kind": kind, "id": suggestion_id, "rationale": rationale}


def build_confirm_action_declaration(
    *,
    kind: str,
    suggestion_id: str,
    edge: dict[str, object],
    rationale: str | None,
) -> dict[str, Any]:
    """Build the frozen confirm/reject widget declaration from an ALREADY-FETCHED edge.

    Pure -- no I/O; the caller (RunChatTurn._finalize_confirm_action) does the
    live edge read and passes the fetched row in. `tierSnapshot` is read by
    Plan 40-02's CONF-02 staleness check at submit time -- do not rename this
    key.
    """
    relation_type = edge.get("relation_type")
    confidence = edge.get("confidence")
    tier = edge.get("tier")

    prompt = f'Promote this suggested "{relation_type}" relationship to confirmed?'

    confirm_description = f"Confidence {confidence}, currently {tier}."
    if rationale:
        confirm_description = f"{confirm_description} {rationale}"

    confirm_option = {**_CONFIRM_OPTION, "description": confirm_description}
    reject_option = dict(_REJECT_OPTION)

    return {
        "prompt": prompt,
        "options": [confirm_option, reject_option],
        "suggestionRef": {"kind": kind, "id": suggestion_id},
        "tierSnapshot": tier,
    }


__all__ = [
    "CONFIRM_ACTION_UNAVAILABLE_TEXT",
    "EMIT_CONFIRM_ACTION_TOOL_NAME",
    "SUGGESTION_KIND_EDGE_TIER_PROMOTION",
    "SUGGESTION_KIND_ENTITY_MERGE_CONFIRM",
    "build_confirm_action_declaration",
    "parse_confirm_action_call",
]
