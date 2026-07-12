"""Pure-helper tests for source_capture suggestion parsing/declaration (Phase 54-03, CLUS-04).

Covers `parse_confirm_action_call`'s extended kind vocabulary,
`build_emit_confirm_action_tool()`'s schema enum, `build_source_capture_
declaration`'s shape, and the two new pure result-id helpers
(`parse_source_capture_result_id` / `extract_web_search_result`) that let
RunChatTurn re-read a persisted web_search result server-side (T-54-03-01 —
never model free text). No I/O — plain function calls only, mirrors
test_run_chat_turn_confirm_action_helpers.py's own contract statement.
"""

from __future__ import annotations

import json

from app.application.use_cases.run_chat_turn_confirm_action import (
    SUGGESTION_KIND_EDGE_TIER_PROMOTION,
    SUGGESTION_KIND_ENTITY_MERGE_CONFIRM,
    SUGGESTION_KIND_SOURCE_CAPTURE,
    build_source_capture_declaration,
    extract_web_search_result,
    parse_confirm_action_call,
    parse_source_capture_result_id,
)
from app.infrastructure.llm.chat_tools import build_emit_confirm_action_tool

# ---------------------------------------------------------------------------
# parse_confirm_action_call -- extended kind vocabulary
# ---------------------------------------------------------------------------


def test_parse_accepts_source_capture_kind() -> None:
    raw = json.dumps(
        {
            "suggestionRef": {"kind": "source_capture", "id": "toolu_abc123:0"},
            "rationale": "Looks relevant.",
        }
    )
    parsed = parse_confirm_action_call(raw)
    assert parsed == {"kind": "source_capture", "id": "toolu_abc123:0", "rationale": "Looks relevant."}


def test_parse_rejects_source_capture_with_empty_id() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "source_capture", "id": ""}})
    assert parse_confirm_action_call(raw) is None


def test_parse_rejects_source_capture_with_non_string_id() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "source_capture", "id": 42}})
    assert parse_confirm_action_call(raw) is None


def test_parse_still_accepts_edge_tier_promotion() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": "edge-1"}})
    parsed = parse_confirm_action_call(raw)
    assert parsed == {"kind": "knowledge_edge_tier_promotion", "id": "edge-1", "rationale": None}


def test_parse_still_rejects_entity_merge_confirm() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "entity_merge_confirm", "id": "pair-1"}})
    assert parse_confirm_action_call(raw) is None


def test_parse_still_rejects_unknown_kind() -> None:
    raw = json.dumps({"suggestionRef": {"kind": "something_else", "id": "x"}})
    assert parse_confirm_action_call(raw) is None


def test_suggestion_kind_source_capture_distinct_from_other_kinds() -> None:
    assert SUGGESTION_KIND_SOURCE_CAPTURE not in (
        SUGGESTION_KIND_EDGE_TIER_PROMOTION,
        SUGGESTION_KIND_ENTITY_MERGE_CONFIRM,
    )


# ---------------------------------------------------------------------------
# build_emit_confirm_action_tool -- schema enum gains source_capture
# ---------------------------------------------------------------------------


def test_confirm_action_tool_schema_enum_includes_both_kinds() -> None:
    tool = build_emit_confirm_action_tool()
    kind_enum = tool["input_schema"]["properties"]["suggestionRef"]["properties"]["kind"]["enum"]
    assert set(kind_enum) == {"knowledge_edge_tier_promotion", "source_capture"}


def test_confirm_action_tool_schema_still_forbids_additional_properties() -> None:
    tool = build_emit_confirm_action_tool()
    assert tool["input_schema"]["additionalProperties"] is False
    assert tool["input_schema"]["properties"]["suggestionRef"]["additionalProperties"] is False


# ---------------------------------------------------------------------------
# build_source_capture_declaration
# ---------------------------------------------------------------------------


def test_build_source_capture_declaration_shape() -> None:
    source: dict[str, object] = {
        "url": "https://example.com/article",
        "title": "An Article",
        "retrievedAt": "2026-07-12T00:00:00+00:00",
    }
    declaration = build_source_capture_declaration(
        suggestion_id="toolu_abc123:0",
        source=source,
        rationale="Directly on-topic.",
        importer_id="importer-1",
    )

    assert declaration["suggestionRef"] == {"kind": "source_capture", "id": "toolu_abc123:0"}
    assert "An Article" in declaration["prompt"]
    assert declaration["sourcePayload"] == {
        "url": "https://example.com/article",
        "title": "An Article",
        "retrievedAt": "2026-07-12T00:00:00+00:00",
    }
    assert declaration["importerId"] == "importer-1"

    options = declaration["options"]
    assert options[0]["id"] == "confirm"
    assert "https://example.com/article" in options[0]["description"]
    assert "Directly on-topic." in options[0]["description"]
    assert options[1] == {"id": "reject", "title": "Reject"}


def test_build_source_capture_declaration_no_rationale() -> None:
    source: dict[str, object] = {"url": "https://example.com/x", "title": None, "retrievedAt": "t"}
    declaration = build_source_capture_declaration(
        suggestion_id="toolu_x:1", source=source, rationale=None, importer_id="importer-2"
    )
    # Falls back to the url when title is missing.
    assert "https://example.com/x" in declaration["prompt"]
    assert declaration["options"][0]["description"] == "Source: https://example.com/x"


# ---------------------------------------------------------------------------
# parse_source_capture_result_id
# ---------------------------------------------------------------------------


def test_parse_source_capture_result_id_valid() -> None:
    assert parse_source_capture_result_id("toolu_abc123:0") == ("toolu_abc123", 0)
    assert parse_source_capture_result_id("toolu_abc123:4") == ("toolu_abc123", 4)


def test_parse_source_capture_result_id_no_separator() -> None:
    assert parse_source_capture_result_id("toolu_abc123") is None


def test_parse_source_capture_result_id_empty_tool_use_id() -> None:
    assert parse_source_capture_result_id(":0") is None


def test_parse_source_capture_result_id_non_digit_index() -> None:
    assert parse_source_capture_result_id("toolu_abc123:zero") is None


def test_parse_source_capture_result_id_negative_index_rejected() -> None:
    # "-1" is not `.isdigit()` -- rejected the same way as any other non-digit.
    assert parse_source_capture_result_id("toolu_abc123:-1") is None


# ---------------------------------------------------------------------------
# extract_web_search_result
# ---------------------------------------------------------------------------

_ENVELOPE = json.dumps(
    {
        "mode": "web_search",
        "results": [
            {"title": "First", "url": "https://a.example/1", "snippet": "..."},
            {"title": "Second", "url": "https://a.example/2", "snippet": "..."},
        ],
    }
)


def test_extract_web_search_result_valid_index() -> None:
    entry = extract_web_search_result(_ENVELOPE, 1)
    assert entry == {"title": "Second", "url": "https://a.example/2", "snippet": "..."}


def test_extract_web_search_result_out_of_range_index() -> None:
    assert extract_web_search_result(_ENVELOPE, 5) is None


def test_extract_web_search_result_negative_index() -> None:
    assert extract_web_search_result(_ENVELOPE, -1) is None


def test_extract_web_search_result_malformed_json() -> None:
    assert extract_web_search_result("{not json", 0) is None


def test_extract_web_search_result_not_a_dict() -> None:
    assert extract_web_search_result(json.dumps([1, 2, 3]), 0) is None


def test_extract_web_search_result_missing_results_key() -> None:
    assert extract_web_search_result(json.dumps({"mode": "web_search"}), 0) is None


def test_extract_web_search_result_non_dict_entry() -> None:
    envelope = json.dumps({"mode": "web_search", "results": ["not-a-dict"]})
    assert extract_web_search_result(envelope, 0) is None
