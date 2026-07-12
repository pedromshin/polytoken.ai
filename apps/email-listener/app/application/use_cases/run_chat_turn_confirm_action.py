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

Phase 54-03 (CLUS-04/CLUS-05): `SUGGESTION_KIND_SOURCE_CAPTURE` extends the
same suggestionRef vocabulary for a captured web_search result. Unlike
`knowledge_edge_tier_promotion`, the "suggestion" here is not an existing
`knowledge_node_edges` row — it is a PERSISTED web_search tool_invocation_result
part, addressed by a server-legible `{toolUseId}:{index}` composite id
(`parse_source_capture_result_id`) rather than a database row id.
`extract_web_search_result` then pulls one result dict out of that part's
already-persisted JSON content. Both are pure (no I/O) — the actual message
lookup by conversation_id is the caller's (RunChatTurn's) job, exactly
mirroring `find_edge_by_id`'s live-I/O split from `build_confirm_action_
declaration` above. `build_source_capture_declaration` is a SIBLING builder
(not a `build_confirm_action_declaration` overload) since its input shape
(an ALREADY-SERVER-RE-READ `{url, title, retrievedAt}` source dict) differs
from an edge dict — T-54-03-01: never trusts model-authored title/url/snippet
text, only the id (a lookup key) comes from the model.
"""

from __future__ import annotations

import json
from typing import Any

# Mirrors app.infrastructure.llm.chat_tools.EMIT_CONFIRM_ACTION_TOOL_NAME --
# defined locally (not imported) because the import-linter forbids
# app.application -> app.infrastructure (same pattern as
# run_chat_turn_tool_loop.py's EMIT_UI_SPEC_TOOL_NAME).
EMIT_CONFIRM_ACTION_TOOL_NAME = "emit_confirm_action"

# The suggestionRef.kind values this phase's dispatch vocabulary knows about.
# SUGGESTION_KIND_EDGE_TIER_PROMOTION and SUGGESTION_KIND_SOURCE_CAPTURE (Phase
# 54-03) are both reachable via the emit_confirm_action tool's own JSON schema
# (chat_tools.py's enum lists both) -- SUGGESTION_KIND_ENTITY_MERGE_CONFIRM is
# defined here so Plan 40-02's submit-time dispatch table can reference it by
# name, but stays structurally unreachable via the tool schema.
SUGGESTION_KIND_EDGE_TIER_PROMOTION = "knowledge_edge_tier_promotion"
SUGGESTION_KIND_SOURCE_CAPTURE = "source_capture"
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


_SUPPORTED_SUGGESTION_KINDS = (SUGGESTION_KIND_EDGE_TIER_PROMOTION, SUGGESTION_KIND_SOURCE_CAPTURE)


def parse_confirm_action_call(raw_json: str) -> dict[str, Any] | None:
    """Parse a finalized emit_confirm_action tool call's accumulated JSON.

    Pure -- no I/O. Returns `{"kind": ..., "id": ..., "rationale": str | None}`
    on success, or None (fail-closed) when: the JSON never parses, the parsed
    shape isn't a dict, `suggestionRef` isn't a dict, `suggestionRef.kind` is
    not one of `_SUPPORTED_SUGGESTION_KINDS` (rejecting "entity_merge_confirm"
    and anything else -- defense in depth even though the tool schema already
    restricts this), or `suggestionRef.id` is not a non-empty string.
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
    if kind not in _SUPPORTED_SUGGESTION_KINDS:
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


def build_source_capture_declaration(
    *,
    suggestion_id: str,
    source: dict[str, object],
    rationale: str | None,
    importer_id: str,
) -> dict[str, Any]:
    """Build the frozen confirm/reject declaration for a source_capture suggestion (CLUS-04).

    Pure -- no I/O. `source` is the ALREADY-server-re-read web_search result
    `{url, title, retrievedAt}` (RunChatTurn's `_finalize_confirm_action` reads
    it from the persisted web_search tool_invocation_result part by result id
    -- never model free text, T-54-03-01). `importer_id` is embedded in the
    declaration as a frozen snapshot (key `importerId`) so
    `SubmitWidgetInteraction`'s submit-time dispatch -- which has no
    `knowledge_node_edges` row to derive tenant scope from, unlike
    edge_tier_promotion -- can read it back without a second server-side
    lookup (mirrors `tierSnapshot`'s existing precedent: the declaration is
    server-built and trusted). `sourcePayload` carries the same frozen
    snapshot for the write-time payload `SourceCaptureHandler` consumes.
    """
    url = source.get("url")
    title = source.get("title") or url
    retrieved_at = source.get("retrievedAt")

    prompt = f'Capture "{title}" as a knowledge source for this cluster?'
    confirm_description = f"Source: {url}"
    if rationale:
        confirm_description = f"{confirm_description} {rationale}"

    confirm_option = {**_CONFIRM_OPTION, "description": confirm_description}
    reject_option = dict(_REJECT_OPTION)

    return {
        "prompt": prompt,
        "options": [confirm_option, reject_option],
        "suggestionRef": {"kind": SUGGESTION_KIND_SOURCE_CAPTURE, "id": suggestion_id},
        "sourcePayload": {"url": url, "title": title, "retrievedAt": retrieved_at},
        "importerId": importer_id,
    }


def parse_source_capture_result_id(result_id: str) -> tuple[str, int] | None:
    """Parse a source_capture suggestionRef.id of the form '{toolUseId}:{index}'.

    Pure -- no I/O. The model supplies this id by copying its OWN prior
    web_search tool_use id (visible to it in this same turn's conversation)
    plus the 0-based position of the result it wants to capture inside that
    call's `results` array -- never the url/title/snippet content itself
    (T-54-03-01). Returns `(tool_use_id, index)` on success, or None
    (fail-closed) when the id has no ':' separator, the tool_use_id segment
    is empty, or the index segment isn't a non-negative integer.
    """
    if ":" not in result_id:
        return None
    tool_use_id, _, index_str = result_id.rpartition(":")
    if not tool_use_id or not index_str.isdigit():
        return None
    return tool_use_id, int(index_str)


def extract_web_search_result(content: str, index: int) -> dict[str, object] | None:
    """Extract one result dict from a persisted web_search tool_invocation_result part's content.

    Pure -- no I/O. `content` is the JSON string stored verbatim on the part
    (`WebSearchExecutor`'s own envelope: `{"mode": "web_search", "results":
    [...]}`). Returns None (fail-closed) on any parse failure, a missing/
    non-list `results`, an out-of-range `index`, or a non-dict entry.
    """
    try:
        envelope: Any = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(envelope, dict):
        return None
    results = envelope.get("results")
    if not isinstance(results, list) or index < 0 or index >= len(results):
        return None
    entry = results[index]
    return entry if isinstance(entry, dict) else None


__all__ = [
    "CONFIRM_ACTION_UNAVAILABLE_TEXT",
    "EMIT_CONFIRM_ACTION_TOOL_NAME",
    "SUGGESTION_KIND_EDGE_TIER_PROMOTION",
    "SUGGESTION_KIND_ENTITY_MERGE_CONFIRM",
    "SUGGESTION_KIND_SOURCE_CAPTURE",
    "build_confirm_action_declaration",
    "build_source_capture_declaration",
    "extract_web_search_result",
    "parse_confirm_action_call",
    "parse_source_capture_result_id",
]
