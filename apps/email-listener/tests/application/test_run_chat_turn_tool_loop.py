"""Tests for the pure mid-turn tool-loop helpers (Phase 34, LOOP-01)."""

from __future__ import annotations

import pytest

from app.application.use_cases.run_chat_turn_tool_loop import (
    PARSE_FAILURE_TEXT,
    ROUND_CAP_EXHAUSTED_TEXT,
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
def test_classify_dispatch_server_takes_precedence_over_widget() -> None:
    """A server_tool_names entry must win even if it collides with a widget/emit_ui_spec name."""
    assert classify_tool_dispatch("emit_proposal_cards", {"emit_proposal_cards"}) == "server"
    assert classify_tool_dispatch("emit_ui_spec", {"emit_ui_spec"}) == "server"


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
