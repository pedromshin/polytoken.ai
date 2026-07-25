"""Tests for the pure mid-turn tool-loop helpers (Phase 34, LOOP-01)."""

from __future__ import annotations

import pytest

from app.application.use_cases.run_chat_turn_tool_loop import (
    PARSE_FAILURE_TEXT,
    ROUND_CAP_EXHAUSTED_TEXT,
    build_canvas_part,
    build_synthetic_tool_result_message,
    build_tool_invocation_part,
    build_tool_invocation_result_part,
    cap_tool_output,
    classify_tool_dispatch,
)
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS, ToolExecutionResult

# ---------------------------------------------------------------------------
# Part builders
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_tool_invocation_part_shape() -> None:
    part = build_tool_invocation_part("lookup_entity", "tu_1", {"entity_id": "e1"})
    assert part == {
        "type": "tool_invocation",
        "toolUseId": "tu_1",
        "toolName": "lookup_entity",
        "arguments": {"entity_id": "e1"},
    }


@pytest.mark.unit
def test_build_tool_invocation_result_part_shape() -> None:
    result = ToolExecutionResult(tool_use_id="tu_1", content="hello", is_error=False)
    part = build_tool_invocation_result_part(result, "lookup_entity")
    assert part == {
        "type": "tool_invocation_result",
        "toolUseId": "tu_1",
        "toolName": "lookup_entity",
        "content": "hello",
        "isError": False,
    }


@pytest.mark.unit
def test_build_tool_invocation_result_part_carries_is_error() -> None:
    result = ToolExecutionResult(tool_use_id="tu_2", content="boom", is_error=True)
    part = build_tool_invocation_result_part(result, "search_emails")
    assert part["isError"] is True
    assert part["content"] == "boom"


# ---------------------------------------------------------------------------
# Synthetic tool_result content block
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_synthetic_tool_result_message_shape() -> None:
    result = ToolExecutionResult(tool_use_id="tu_3", content="the answer", is_error=False)
    message = build_synthetic_tool_result_message(result)
    assert message["role"] == "user"
    assert message["content"] == [
        {
            "type": "tool_result",
            "tool_use_id": "tu_3",
            "content": "the answer",
            "is_error": False,
        }
    ]


@pytest.mark.unit
def test_build_synthetic_tool_result_message_carries_error_flag() -> None:
    result = ToolExecutionResult(tool_use_id="tu_4", content="failed", is_error=True)
    message = build_synthetic_tool_result_message(result)
    block = message["content"][0]
    assert block["is_error"] is True
    assert block["tool_use_id"] == "tu_4"
    assert block["content"] == "failed"


# ---------------------------------------------------------------------------
# classify_tool_dispatch
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_dispatch_emit_ui_spec() -> None:
    assert classify_tool_dispatch("emit_ui_spec", set()) == "emit_ui_spec"


@pytest.mark.unit
def test_classify_dispatch_widget() -> None:
    assert classify_tool_dispatch("emit_proposal_cards", set()) == "widget"
    assert classify_tool_dispatch("emit_clarify_widget", set()) == "widget"


@pytest.mark.unit
def test_classify_dispatch_server() -> None:
    assert classify_tool_dispatch("echo", {"echo"}) == "server"


@pytest.mark.unit
def test_classify_dispatch_unknown() -> None:
    assert classify_tool_dispatch("nope", set()) == "unknown"


@pytest.mark.unit
def test_classify_dispatch_canvas() -> None:
    """Phase 73: canvas emit tools route to the emit-a-part 'canvas' branch, never 'server'."""
    assert classify_tool_dispatch("emit_canvas_node", set()) == "canvas"
    assert classify_tool_dispatch("emit_canvas_connect", set()) == "canvas"


@pytest.mark.unit
def test_classify_dispatch_server_takes_precedence_over_widget() -> None:
    """A server_tool_names entry must win even if it collides with a widget/emit_ui_spec name."""
    assert classify_tool_dispatch("emit_proposal_cards", {"emit_proposal_cards"}) == "server"
    assert classify_tool_dispatch("emit_ui_spec", {"emit_ui_spec"}) == "server"


# ---------------------------------------------------------------------------
# build_canvas_part (Phase 73 Wave A — frozen wire contract)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_canvas_add_node_part_with_position() -> None:
    raw = '{"handle": "sheet", "nodeType": "spreadsheet", "data": {"rows": 3}, "position": {"x": 10, "y": 20}}'
    part = build_canvas_part("emit_canvas_node", raw)
    assert part == {
        "type": "canvas_add_node",
        "handle": "sheet",
        "nodeType": "spreadsheet",
        "data": {"rows": 3},
        "position": {"x": 10, "y": 20},
    }


@pytest.mark.unit
def test_build_canvas_add_node_part_omits_absent_position() -> None:
    """position is OPTIONAL — the key must be absent entirely when the model gives none."""
    part = build_canvas_part("emit_canvas_node", '{"handle": "tile", "nodeType": "document", "data": {}}')
    assert part == {"type": "canvas_add_node", "handle": "tile", "nodeType": "document", "data": {}}
    assert "position" not in part


@pytest.mark.unit
def test_build_canvas_connect_part_shape() -> None:
    raw = '{"sourceHandle": "sheet", "targetHandle": "tile", "sourcePath": "data", "targetKey": "input"}'
    part = build_canvas_part("emit_canvas_connect", raw)
    assert part == {
        "type": "canvas_connect",
        "sourceHandle": "sheet",
        "targetHandle": "tile",
        "sourcePath": "data",
        "targetKey": "input",
    }


@pytest.mark.unit
def test_build_canvas_part_fail_closed_on_bad_json() -> None:
    assert build_canvas_part("emit_canvas_node", "{not json") is None


@pytest.mark.unit
def test_build_canvas_part_fail_closed_on_missing_required_fields() -> None:
    # missing nodeType
    assert build_canvas_part("emit_canvas_node", '{"handle": "x", "data": {}}') is None
    # data not an object
    assert build_canvas_part("emit_canvas_node", '{"handle": "x", "nodeType": "chat", "data": "nope"}') is None
    # missing targetKey
    assert (
        build_canvas_part("emit_canvas_connect", '{"sourceHandle": "a", "targetHandle": "b", "sourcePath": "data"}')
        is None
    )


@pytest.mark.unit
def test_build_canvas_part_unknown_tool_name_returns_none() -> None:
    assert build_canvas_part("emit_ui_spec", '{"handle": "x", "nodeType": "chat", "data": {}}') is None


# ---------------------------------------------------------------------------
# cap_tool_output
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cap_tool_output_leaves_short_text_untouched() -> None:
    assert cap_tool_output("hello") == "hello"


@pytest.mark.unit
def test_cap_tool_output_truncates_and_marks_long_text() -> None:
    long_text = "x" * 5000
    capped = cap_tool_output(long_text)
    assert len(capped) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
    assert capped.endswith("…[truncated]")


@pytest.mark.unit
def test_cap_tool_output_respects_custom_limit() -> None:
    capped = cap_tool_output("x" * 100, limit=10)
    assert capped.startswith("x" * 10)
    assert capped.endswith("…[truncated]")


# ---------------------------------------------------------------------------
# Visible-surface text constants (LOOP-02/LOOP-03 "never silent" motto)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_failure_text_is_nonempty_and_visible() -> None:
    assert PARSE_FAILURE_TEXT
    assert "parse" in PARSE_FAILURE_TEXT.lower()


@pytest.mark.unit
def test_round_cap_exhausted_text_is_nonempty_and_visible() -> None:
    assert ROUND_CAP_EXHAUSTED_TEXT
    assert "resolve" in ROUND_CAP_EXHAUSTED_TEXT.lower()
