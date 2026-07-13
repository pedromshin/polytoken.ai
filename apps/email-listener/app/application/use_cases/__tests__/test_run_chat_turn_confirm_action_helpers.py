"""Pure-helper unit tests for emit_confirm_action (Phase 40-01 Task 2, CONF-01).

Covers `parse_confirm_action_call` (success / malformed / wrong-kind),
`build_confirm_action_declaration`'s shape, and the two widgets-module
integration points (`INTERACTIVE_WIDGET_TOOL_NAMES` length,
`derive_declared_response_schema("confirm_action", ...)`). No I/O, no
RunChatTurn/test-double scaffolding needed -- these are plain function calls.
"""

from __future__ import annotations

import json

from app.application.use_cases.run_chat_turn_confirm_action import (
    CONFIRM_ACTION_UNAVAILABLE_TEXT,
    EMIT_CONFIRM_ACTION_TOOL_NAME,
    SUGGESTION_KIND_EDGE_TIER_PROMOTION,
    SUGGESTION_KIND_ENTITY_MERGE_CONFIRM,
    build_confirm_action_declaration,
    parse_confirm_action_call,
)
from app.application.use_cases.run_chat_turn_widgets import (
    INTERACTIVE_WIDGET_TOOL_NAMES,
    derive_declared_response_schema,
)

# ---------------------------------------------------------------------------
# parse_confirm_action_call
# ---------------------------------------------------------------------------


def test_parse_confirm_action_call_success() -> None:
    raw = json.dumps(
        {
            "suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": "edge-1"},
            "rationale": "Looks solid.",
        }
    )
    parsed = parse_confirm_action_call(raw)
    assert parsed == {"kind": "knowledge_edge_tier_promotion", "id": "edge-1", "rationale": "Looks solid."}


def test_parse_confirm_action_call_success_no_rationale() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": "edge-1"}})
    parsed = parse_confirm_action_call(raw)
    assert parsed == {"kind": "knowledge_edge_tier_promotion", "id": "edge-1", "rationale": None}


def test_parse_confirm_action_call_malformed_json() -> None:
    assert parse_confirm_action_call("{not json") is None


def test_parse_confirm_action_call_empty_string() -> None:
    assert parse_confirm_action_call("") is None


def test_parse_confirm_action_call_not_a_dict() -> None:
    assert parse_confirm_action_call(json.dumps([1, 2, 3])) is None


def test_parse_confirm_action_call_missing_suggestion_ref() -> None:
    assert parse_confirm_action_call(json.dumps({"rationale": "no ref"})) is None


def test_parse_confirm_action_call_suggestion_ref_not_dict() -> None:
    assert parse_confirm_action_call(json.dumps({"suggestionRef": "edge-1"})) is None


def test_parse_confirm_action_call_wrong_kind_entity_merge_confirm() -> None:
    """Defense-in-depth: entity_merge_confirm is rejected even though the tool
    schema itself already restricts the kind enum to knowledge_edge_tier_promotion."""
    raw = json.dumps({"suggestionRef": {"kind": "entity_merge_confirm", "id": "pair-1"}})
    assert parse_confirm_action_call(raw) is None


def test_parse_confirm_action_call_wrong_kind_unknown() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "something_else", "id": "x"}})
    assert parse_confirm_action_call(raw) is None


def test_parse_confirm_action_call_missing_id() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "knowledge_edge_tier_promotion"}})
    assert parse_confirm_action_call(raw) is None


def test_parse_confirm_action_call_empty_id() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": ""}})
    assert parse_confirm_action_call(raw) is None


def test_parse_confirm_action_call_non_string_rationale_ignored() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": "edge-1"}, "rationale": 42})
    parsed = parse_confirm_action_call(raw)
    assert parsed == {"kind": "knowledge_edge_tier_promotion", "id": "edge-1", "rationale": None}


# ---------------------------------------------------------------------------
# build_confirm_action_declaration
# ---------------------------------------------------------------------------


def test_build_confirm_action_declaration_shape() -> None:
    edge: dict[str, object] = {
        "id": "edge-1",
        "relation_type": "works_at",
        "confidence": 0.82,
        "tier": "INFERRED",
    }
    declaration = build_confirm_action_declaration(
        kind=SUGGESTION_KIND_EDGE_TIER_PROMOTION,
        suggestion_id="edge-1",
        edge=edge,
        rationale="Two documents agree.",
    )

    assert declaration["suggestionRef"] == {"kind": "knowledge_edge_tier_promotion", "id": "edge-1"}
    assert declaration["tierSnapshot"] == "INFERRED"
    assert "works_at" in declaration["prompt"]

    options = declaration["options"]
    assert len(options) == 2
    assert options[0] == {
        "id": "confirm",
        "title": "Confirm",
        "description": "Confidence 0.82, currently INFERRED. Two documents agree.",
    }
    assert options[1] == {"id": "reject", "title": "Reject"}


def test_build_confirm_action_declaration_no_rationale() -> None:
    edge: dict[str, object] = {
        "id": "edge-2",
        "relation_type": "located_in",
        "confidence": 0.5,
        "tier": "AMBIGUOUS",
    }
    declaration = build_confirm_action_declaration(
        kind=SUGGESTION_KIND_EDGE_TIER_PROMOTION,
        suggestion_id="edge-2",
        edge=edge,
        rationale=None,
    )
    assert declaration["options"][0]["description"] == "Confidence 0.5, currently AMBIGUOUS."


# ---------------------------------------------------------------------------
# run_chat_turn_widgets.py integration points
# ---------------------------------------------------------------------------


def test_interactive_widget_tool_names_has_three_entries() -> None:
    assert len(INTERACTIVE_WIDGET_TOOL_NAMES) == 3
    assert EMIT_CONFIRM_ACTION_TOOL_NAME in INTERACTIVE_WIDGET_TOOL_NAMES


def test_derive_declared_response_schema_confirm_action() -> None:
    declaration = {
        "options": [
            {"id": "confirm", "title": "Confirm", "description": "..."},
            {"id": "reject", "title": "Reject"},
        ]
    }
    schema = derive_declared_response_schema("confirm_action", declaration)
    assert schema == {
        "type": "object",
        "required": ["optionId"],
        "additionalProperties": False,
        "properties": {"optionId": {"enum": ["confirm", "reject"]}},
    }


def test_confirm_action_unavailable_text_is_nonempty() -> None:
    assert isinstance(CONFIRM_ACTION_UNAVAILABLE_TEXT, str)
    assert len(CONFIRM_ACTION_UNAVAILABLE_TEXT) > 0


def test_suggestion_kind_entity_merge_confirm_registered_but_unused_in_schema() -> None:
    # Registered here for Plan 40-02's dispatch table to reference by name --
    # asserted distinct from the edge-tier-promotion kind.
    assert SUGGESTION_KIND_ENTITY_MERGE_CONFIRM != SUGGESTION_KIND_EDGE_TIER_PROMOTION
