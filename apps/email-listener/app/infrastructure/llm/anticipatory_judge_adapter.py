"""BedrockAppropriatenessJudgeAdapter — Haiku appropriateness scorer (Phase 25-02, D-07/D-09).

Gate #1 of the anticipatory-prompting SPIKE's independent gate chain (D-08).
Mirrors GenuiCodeJudgeAdapter's Bedrock posture (forced tool-use, temperature=0,
asyncio.timeout, non-streaming messages.create, real-usage capture) with ONE
deliberate inversion:

    This judge is FALSE-POSITIVE-AVERSE (D-07). On ANY error/timeout/invalid
    output it returns `AppropriatenessScore(score=0.0, reason="judge_error_suppress")`
    — the safe default here is SUPPRESS, never "show it anyway". The
    code-island judge's safe default (index 0 -> use the first candidate) is
    the OPPOSITE posture and must NOT be mirrored: an uncertain appropriateness
    call must never resolve toward prompting the user.

The judge receives only the neutral candidate text + rationale + a neutral
context summary (T-25-03) — never raw chat PII.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.domain.ports.anticipatory_ports import AppropriatenessJudge, AppropriatenessScore

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# D-07: the safe default on ANY error/timeout/invalid output — SUPPRESS, never prompt.
_SUPPRESS_ON_ERROR = AppropriatenessScore(score=0.0, reason="judge_error_suppress")

# ---------------------------------------------------------------------------
# score_appropriateness tool definition — hand-written input_schema (Bedrock-valid:
# type object, additionalProperties false, no root $ref).
# ---------------------------------------------------------------------------

_SCORE_TOOL_NAME = "score_appropriateness"

_SCORE_APPROPRIATENESS_TOOL: dict[str, Any] = {
    "name": _SCORE_TOOL_NAME,
    "description": (
        "Score how appropriate it is to proactively show this candidate prompt to the "
        "user RIGHT NOW. Respond ONLY via this tool — no prose."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "score": {
                "type": "number",
                "description": "0.0 (never show) to 1.0 (definitely appropriate now).",
            },
            "reason": {
                "type": "string",
                "description": "A brief justification for the score.",
            },
        },
        "required": ["score", "reason"],
        "additionalProperties": False,
    },
}

if TYPE_CHECKING:
    _SCORE_TOOL: ToolParam = cast("ToolParam", _SCORE_APPROPRIATENESS_TOOL)
else:
    _SCORE_TOOL = _SCORE_APPROPRIATENESS_TOOL

# ---------------------------------------------------------------------------
# System prompt — static, trusted content only. Conservative-bias rubric (D-07).
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a conservative gatekeeper deciding whether to proactively interrupt a user with "
    "an unsolicited prompt suggestion. Score 0.0-1.0 on: is this HELPFUL right now? is it "
    "NON-INTRUSIVE (not interrupting active work)? is it RELEVANT to the current context? is "
    "it NOT REDUNDANT with what the user is already doing? When unsure, or when the evidence "
    "is thin, score LOW — a missed suggestion costs nothing, an unwanted interruption costs "
    "trust. Return via score_appropriateness only."
)


class BedrockAppropriatenessJudgeAdapter(AppropriatenessJudge):
    """Gate #1 (D-07) — Bedrock Haiku forced-tool-use appropriateness scorer.

    Mirrors GenuiCodeJudgeAdapter's posture (forced tool-use, temperature=0,
    asyncio.timeout, non-streaming messages.create) with the D-07 fail-toward-
    suppress inversion described in the module docstring. Never raises.
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        model_id: str,
        max_tokens: int = 256,
        timeout_seconds: float = 30.0,
        threshold: float,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds
        self._threshold = threshold

    async def score(self, *, proposed_prompt_text: str, rationale: str, context_summary: str) -> AppropriatenessScore:
        """Score a candidate 0-1; on ANY error/timeout/invalid output, SUPPRESS (D-07).

        Never raises — the gate-chain use case can always call this safely.
        """
        try:
            return await self._call_model(
                proposed_prompt_text=proposed_prompt_text,
                rationale=rationale,
                context_summary=context_summary,
            )
        except Exception:
            logger.warning("anticipatory_judge_failed", model_id=self._model_id, exc_info=True)
            return _SUPPRESS_ON_ERROR

    async def _call_model(
        self, *, proposed_prompt_text: str, rationale: str, context_summary: str
    ) -> AppropriatenessScore:
        """Make the Bedrock scoring call with a timeout; parse and clamp the score."""
        user_content = _build_user_content(
            proposed_prompt_text=proposed_prompt_text,
            rationale=rationale,
            context_summary=context_summary,
        )
        messages: list[dict[str, object]] = [{"role": "user", "content": user_content}]

        async with asyncio.timeout(self._timeout_seconds):
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self._model_id,
                max_tokens=self._max_tokens,
                temperature=0,
                system=_SYSTEM_PROMPT,
                tools=[_SCORE_TOOL],
                tool_choice={"type": "tool", "name": _SCORE_TOOL_NAME},
                messages=messages,
            )

        return self._parse_response(response)

    def _parse_response(self, response: Any) -> AppropriatenessScore:
        """Extract + clamp score from the score_appropriateness tool_use block (D-07 fail-closed).

        Real Bedrock usage (input/output tokens) is read off `response.usage`
        whenever present and logged alongside the outcome — regardless of
        which parsing branch is taken, mirroring GenuiCodeJudgeAdapter's D-22
        "a real call was billed, so surface its real usage" posture.
        """
        input_tokens, output_tokens = _extract_usage(response)

        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                raw_input: dict[str, Any] = dict(block.input)
            except (TypeError, ValueError):
                logger.warning(
                    "anticipatory_judge_parse_failed",
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    exc_info=True,
                )
                return _SUPPRESS_ON_ERROR

            raw_score = raw_input.get("score")
            if not isinstance(raw_score, int | float) or isinstance(raw_score, bool):
                logger.warning(
                    "anticipatory_judge_invalid_score",
                    raw_score=raw_score,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
                return _SUPPRESS_ON_ERROR

            reason = raw_input.get("reason")
            if not isinstance(reason, str):
                reason = "no_reason_given"

            clamped = max(0.0, min(float(raw_score), 1.0))
            logger.info(
                "anticipatory_judge_scored",
                score=clamped,
                threshold=self._threshold,
                would_pass=clamped >= self._threshold,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            return AppropriatenessScore(score=clamped, reason=reason)

        logger.warning(
            "anticipatory_judge_no_tool_use",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        return _SUPPRESS_ON_ERROR


def _extract_usage(response: Any) -> tuple[int, int]:
    """Read real (input_tokens, output_tokens) off a Bedrock response.

    Mirrors GenuiCodeJudgeAdapter's `_extract_usage` idiom exactly.
    """
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    return input_tokens, output_tokens


def _build_user_content(*, proposed_prompt_text: str, rationale: str, context_summary: str) -> str:
    """Build the judge user turn — neutral candidate text + rationale + context summary only."""
    return (
        f"Candidate prompt to potentially show: {proposed_prompt_text!r}\n\n"
        f"Rationale (why the trigger fired): {rationale}\n\n"
        f"Neutral context summary: {context_summary}\n\n"
        "Score this candidate's appropriateness (0.0-1.0) and call score_appropriateness."
    )


__all__ = ["BedrockAppropriatenessJudgeAdapter"]
