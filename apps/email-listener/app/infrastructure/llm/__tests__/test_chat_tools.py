"""Tests for build_emit_proposal_cards_tool (Phase 24-02 Task 1, D-01/D-03/D-04/D-05).

Infra testing infra (no cross-layer import), unlike
test_run_chat_turn_interactive_widget.py which must stay decoupled from
app.infrastructure per the import-linter contract.
"""

from __future__ import annotations

import json

from app.infrastructure.llm.chat_tools import (
    EMIT_PROPOSAL_CARDS_TOOL_NAME,
    build_emit_clarify_widget_tool,
    build_emit_confirm_action_tool,
    build_emit_proposal_cards_tool,
    build_emit_ui_spec_tool,
)


def test_build_emit_proposal_cards_tool_root_is_bedrock_valid_object_schema() -> None:
    tool = build_emit_proposal_cards_tool()

    assert tool["name"] == EMIT_PROPOSAL_CARDS_TOOL_NAME
    schema = tool["input_schema"]
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["options"]
    assert "$ref" not in schema


def test_proposal_cards_options_schema_bounds_are_present() -> None:
    tool = build_emit_proposal_cards_tool()
    options_schema = tool["input_schema"]["properties"]["options"]

    assert options_schema["type"] == "array"
    assert options_schema["minItems"] == 1
    assert options_schema["maxItems"] == 8
    item_schema = options_schema["items"]
    assert item_schema["required"] == ["title", "value"]
    assert item_schema["additionalProperties"] is False


def test_all_tool_builders_are_deterministic_for_prompt_caching() -> None:
    """Every builder must return byte-identical output across calls (COST-01/D-21).

    BedrockChatAdapter places a cache_control ephemeral breakpoint (Bedrock
    cachePoint) on the last tool — any per-call variation in these dicts would
    silently invalidate the prompt cache prefix on every turn.
    """
    builders = [
        build_emit_ui_spec_tool,
        build_emit_proposal_cards_tool,
        build_emit_clarify_widget_tool,
        build_emit_confirm_action_tool,
    ]
    for build in builders:
        first = json.dumps(build(), sort_keys=False)
        second = json.dumps(build(), sort_keys=False)
        assert first == second, f"{build.__name__} output must be cache-stable across calls"


def test_no_tool_builder_bakes_in_cache_control() -> None:
    """Cache-breakpoint placement belongs to BedrockChatAdapter (last tool only).

    A builder-level cache_control would burn one of the 4 allowed breakpoints
    per tool and pin placement to composition order.
    """
    for build in (
        build_emit_ui_spec_tool,
        build_emit_proposal_cards_tool,
        build_emit_clarify_widget_tool,
        build_emit_confirm_action_tool,
    ):
        assert "cache_control" not in build(), f"{build.__name__} must not bake in cache_control"
