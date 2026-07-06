"""Tests for BedrockAppropriatenessJudgeAdapter (Phase 25-02, D-07/D-09) + the dark-pipeline boot (D-01).

Infra testing infra (no cross-layer import), mirroring test_chat_tools.py's
convention. Contracts under test:
  - score_appropriateness input_schema is Bedrock-valid (D-02-style hand-written schema).
  - A well-formed tool_use response parses + clamps the score into [0, 1].
  - A RAISED client call and a TIMEOUT both return AppropriatenessScore(score=0.0, ...) —
    fail-TOWARD-SUPPRESS (D-07), never raise.
  - response.usage is read (and logged) when present.

Plus a container boot smoke test (D-01): create_container() resolves the
anticipatory providers with zero DI errors and ANTICIPATORY_PROMPTING_ENABLED
defaults to False.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.application.use_cases.evaluate_anticipatory_candidates import EvaluateAnticipatoryCandidates
from app.container import create_container
from app.domain.ports.anticipatory_ports import AnticipatoryCapStore, AppropriatenessJudge
from app.infrastructure.llm.anticipatory_judge_adapter import (
    _SCORE_APPROPRIATENESS_TOOL,
    BedrockAppropriatenessJudgeAdapter,
)
from app.settings import get_settings

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_score_response(
    score: float, reason: str = "helpful and non-intrusive", *, input_tokens: int = 80, output_tokens: int = 20
) -> MagicMock:
    """Build a mock Bedrock response with a score_appropriateness tool_use block + usage."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"score": score, "reason": reason}
    response = MagicMock()
    response.content = [block]
    response.usage = MagicMock(input_tokens=input_tokens, output_tokens=output_tokens)
    return response


def _make_no_tool_response() -> MagicMock:
    block = MagicMock()
    block.type = "text"
    block.text = "I think this is fine."
    response = MagicMock()
    response.content = [block]
    response.usage = MagicMock(input_tokens=50, output_tokens=5)
    return response


@pytest.fixture
def mock_bedrock_client() -> MagicMock:
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.create = AsyncMock()
    return client


@pytest.fixture
def judge(mock_bedrock_client: MagicMock) -> BedrockAppropriatenessJudgeAdapter:
    return BedrockAppropriatenessJudgeAdapter(
        client=mock_bedrock_client,
        model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        max_tokens=256,
        timeout_seconds=10.0,
        threshold=0.75,
    )


# ---------------------------------------------------------------------------
# Forced-tool schema shape — Bedrock-valid (no root $ref, additionalProperties false)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_appropriateness_schema_is_bedrock_valid() -> None:
    schema = _SCORE_APPROPRIATENESS_TOOL["input_schema"]
    assert _SCORE_APPROPRIATENESS_TOOL["name"] == "score_appropriateness"
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert "$ref" not in schema
    assert set(schema["required"]) == {"score", "reason"}
    assert schema["properties"]["score"]["type"] == "number"
    assert schema["properties"]["reason"]["type"] == "string"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_forced_score_appropriateness_tool_temperature_zero(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_score_response(0.9)

    await judge.score(proposed_prompt_text="Want me to build on that?", rationale="idle after genui", context_summary="x")

    call_kwargs = mock_bedrock_client.messages.create.call_args.kwargs
    assert call_kwargs["tool_choice"]["type"] == "tool"
    assert call_kwargs["tool_choice"]["name"] == "score_appropriateness"
    assert call_kwargs["temperature"] == 0
    assert call_kwargs["max_tokens"] == 256


# ---------------------------------------------------------------------------
# Parsing + clamping
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_parses_and_returns_valid_score(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_score_response(0.62, reason="mostly relevant")

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.62
    assert result.reason == "mostly relevant"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_out_of_range_high_score_is_clamped_to_one(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_score_response(4.2)

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 1.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_negative_score_is_clamped_to_zero(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_score_response(-3.0)

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_invalid_score_type_suppresses(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A non-numeric score -> fail toward SUPPRESS (D-07), not a crash."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"score": "not-a-number", "reason": "?"}
    response = MagicMock()
    response.content = [block]
    response.usage = MagicMock(input_tokens=10, output_tokens=2)
    mock_bedrock_client.messages.create.return_value = response

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0
    assert result.reason == "judge_error_suppress"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_tool_use_suppresses(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_no_tool_response()

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0
    assert result.reason == "judge_error_suppress"


# ---------------------------------------------------------------------------
# Fail-toward-SUPPRESS (D-07) — the critical inversion vs. the code-island judge
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_raised_exception_suppresses_never_raises(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create = AsyncMock(side_effect=RuntimeError("Bedrock error"))

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0
    assert result.reason == "judge_error_suppress"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_timeout_suppresses_never_raises(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create = AsyncMock(side_effect=TimeoutError())

    result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0
    assert result.reason == "judge_error_suppress"


# ---------------------------------------------------------------------------
# Real usage capture — response.usage is read when present
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_is_read_and_logged_on_success(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_score_response(
        0.8, input_tokens=321, output_tokens=17
    )

    with patch("app.infrastructure.llm.anticipatory_judge_adapter.logger") as mock_logger:
        await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    mock_logger.info.assert_called_once()
    _, log_kwargs = mock_logger.info.call_args
    assert log_kwargs["input_tokens"] == 321
    assert log_kwargs["output_tokens"] == 17


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_is_read_even_on_no_tool_use_fallback(
    judge: BedrockAppropriatenessJudgeAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.create.return_value = _make_no_tool_response()

    with patch("app.infrastructure.llm.anticipatory_judge_adapter.logger") as mock_logger:
        result = await judge.score(proposed_prompt_text="x", rationale="y", context_summary="z")

    assert result.score == 0.0
    mock_logger.warning.assert_called_once()
    _, log_kwargs = mock_logger.warning.call_args
    assert log_kwargs["input_tokens"] == 50
    assert log_kwargs["output_tokens"] == 5


# ---------------------------------------------------------------------------
# Dark-pipeline DI boot smoke test (D-01) — mirrors tests/test_container.py's convention
# ---------------------------------------------------------------------------

_PATCH_SUPABASE = "app.container.get_supabase_client"
_PATCH_ANTHROPIC = "app.container.get_anthropic_client"


@pytest.mark.unit
def test_anticipatory_pipeline_resolves_and_flag_defaults_off() -> None:
    """create_container() boots with the anticipatory providers registered.

    The flag defaults to False (D-12) — proven independently of DI resolution
    by reading get_settings() directly, mirroring 25-01's own flag-default test.
    """
    with (
        patch(_PATCH_SUPABASE, return_value=MagicMock()),
        patch(_PATCH_ANTHROPIC, return_value=MagicMock()),
        patch("app.container.boto3") as boto3_mock,
    ):
        boto3_mock.client.return_value = MagicMock()
        container = create_container()

        judge = asyncio.run(container.get(AppropriatenessJudge))
        cap_store = asyncio.run(container.get(AnticipatoryCapStore))
        pipeline = asyncio.run(container.get(EvaluateAnticipatoryCandidates))

        assert isinstance(judge, BedrockAppropriatenessJudgeAdapter)
        assert isinstance(pipeline, EvaluateAnticipatoryCandidates)
        assert cap_store is not None

    assert get_settings().ANTICIPATORY_PROMPTING_ENABLED is False
