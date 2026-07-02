"""Tests for GenuiCodeJudgeAdapter (ranks N code-island candidates).

Part of the PARALLEL multi-candidate code-island path. Contracts:
  - Forced tool-use: pick_best_design with a HAND-WRITTEN input_schema (D-02).
  - Non-streaming messages.create (small, fast ranking output).
  - max_tokens always set (D-16); temperature=0 (D-18).
  - asyncio.timeout wraps the call (D-17).
  - Parses best_index from the tool_use block; clamps to [0, len-1].
  - On ANY error/timeout/invalid output → returns 0, never raises.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.infrastructure.llm.genui_code_judge_adapter import (
    _PICK_BEST_DESIGN_TOOL,
    GenuiCodeJudgeAdapter,
)

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_CANDIDATES = [
    "const a = document.getElementById('island-root'); a.textContent = 'A';",
    "const b = document.getElementById('island-root'); b.textContent = 'B';",
    "const c = document.getElementById('island-root'); c.textContent = 'C';",
]


def _make_pick_response(best_index: int, reason: str = "cleanest layout") -> MagicMock:
    """Build a mock Bedrock response with a pick_best_design tool_use block."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"best_index": best_index, "reason": reason}
    response = MagicMock()
    response.content = [block]
    return response


def _make_no_tool_response() -> MagicMock:
    """Build a mock response with NO tool_use block (text only)."""
    block = MagicMock()
    block.type = "text"
    block.text = "Candidate 1 looks nice."
    response = MagicMock()
    response.content = [block]
    return response


@pytest.fixture
def mock_bedrock_client() -> MagicMock:
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.create = AsyncMock()
    return client


@pytest.fixture
def judge(mock_bedrock_client: MagicMock) -> GenuiCodeJudgeAdapter:
    return GenuiCodeJudgeAdapter(
        client=mock_bedrock_client,
        model_id="us.anthropic.claude-sonnet-4-6",
        max_tokens=512,
        timeout_seconds=15.0,
    )


# ---------------------------------------------------------------------------
# Forced-tool schema shape (D-02)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_pick_tool_schema_shape_is_hand_written() -> None:
    """pick_best_design input_schema must be the exact hand-written shape (D-02)."""
    schema = _PICK_BEST_DESIGN_TOOL["input_schema"]
    assert _PICK_BEST_DESIGN_TOOL["name"] == "pick_best_design"
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"best_index", "reason"}
    assert schema["properties"]["best_index"]["type"] == "integer"
    assert schema["properties"]["reason"]["type"] == "string"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_forced_pick_best_design_tool(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """tool_choice must force the pick_best_design tool (D-02)."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(1)

    await judge.rank(intent_summary="a dashboard", candidates=_CANDIDATES)

    call_kwargs = mock_bedrock_client.messages.create.call_args.kwargs
    assert call_kwargs["tool_choice"]["type"] == "tool"
    assert call_kwargs["tool_choice"]["name"] == "pick_best_design"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_non_streaming_create_used_with_max_tokens_and_temp_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Judge uses non-streaming messages.create with max_tokens set + temperature=0 (D-16, D-18)."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(0)

    await judge.rank(intent_summary="a dashboard", candidates=_CANDIDATES)

    # Non-streaming path: create called, stream NOT called.
    mock_bedrock_client.messages.create.assert_awaited_once()
    assert not hasattr(mock_bedrock_client.messages, "stream") or not mock_bedrock_client.messages.stream.called
    call_kwargs = mock_bedrock_client.messages.create.call_args.kwargs
    assert call_kwargs["max_tokens"] == 512
    assert call_kwargs["temperature"] == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_candidates_listed_in_user_turn(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Each candidate is listed as `--- CANDIDATE {i} ---` with the intent summary."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(0)

    await judge.rank(intent_summary="a distinctive dashboard", candidates=_CANDIDATES)

    messages = mock_bedrock_client.messages.create.call_args.kwargs["messages"]
    user_content = str(messages[0]["content"])
    assert "a distinctive dashboard" in user_content
    assert "--- CANDIDATE 0 ---" in user_content
    assert "--- CANDIDATE 1 ---" in user_content
    assert "--- CANDIDATE 2 ---" in user_content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_candidate_code_is_truncated(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Overlong candidate code is truncated (~4000 chars) before entering the prompt."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(0)
    huge = "x" * 10000
    await judge.rank(intent_summary="big", candidates=[huge, "short"])

    user_content = str(mock_bedrock_client.messages.create.call_args.kwargs["messages"][0]["content"])
    # The full 10000-char blob must not survive verbatim.
    assert huge not in user_content
    assert ("x" * 4000) in user_content


# ---------------------------------------------------------------------------
# Parsing + clamping
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_parses_best_index(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A valid in-range best_index is returned as-is."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(2)

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_out_of_range_index_is_clamped(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """An out-of-range best_index is clamped to [0, len-1]."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(99)

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == len(_CANDIDATES) - 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_negative_index_is_clamped_to_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A negative best_index is clamped to 0."""
    mock_bedrock_client.messages.create.return_value = _make_pick_response(-5)

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 0


# ---------------------------------------------------------------------------
# Short-circuit + error handling → return 0 (never raise)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_single_candidate_short_circuits_without_model_call(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """< 2 candidates → return 0 immediately, no Bedrock call."""
    result = await judge.rank(intent_summary="x", candidates=["only"])

    assert result == 0
    mock_bedrock_client.messages.create.assert_not_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_tool_use_returns_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """No tool_use block in the response → return 0 (never raise)."""
    mock_bedrock_client.messages.create.return_value = _make_no_tool_response()

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_invalid_index_type_returns_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A non-integer best_index → return 0 (defence-in-depth)."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"best_index": "not-an-int", "reason": "?"}
    response = MagicMock()
    response.content = [block]
    mock_bedrock_client.messages.create.return_value = response

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_timeout_returns_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """asyncio.TimeoutError must return 0, not raise (D-17)."""
    mock_bedrock_client.messages.create = AsyncMock(side_effect=TimeoutError())

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_exception_returns_zero(
    judge: GenuiCodeJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Any Bedrock exception must return 0, not raise."""
    mock_bedrock_client.messages.create = AsyncMock(side_effect=RuntimeError("Bedrock error"))

    result = await judge.rank(intent_summary="x", candidates=_CANDIDATES)

    assert result == 0
