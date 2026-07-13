"""GenuiCodeJudgeAdapter — ranks N code-island candidates and picks the best.

Part of the PARALLEL multi-candidate code-island path: after the generator fans out
N candidates CONCURRENTLY (varied temperature), this judge ranks them and returns the
index of the best one. The declarative spec path is untouched by this module.

Security/correctness contracts (mirror the sibling code-island adapters):
  - D-02: Forced tool-use (pick_best_design tool; tool_choice type=tool).
  - D-16: max_tokens set on every call (judge output is tiny).
  - D-17: asyncio.timeout wraps the call.
  - D-18: temperature=0 (deterministic ranking).
  - Non-streaming messages.create: the judge output is small and fast, so the streaming
    inactivity-timeout machinery (needed for large generations) is unnecessary here.
  - On ANY error/timeout/invalid output: return 0 (first candidate), never raise. The
    caller always has at least one good candidate, so index 0 is always a safe default.

The judge receives only the intent summary (from the quarantine extraction) and the
candidate code strings — no raw prose.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

import structlog

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# Per-candidate code is truncated before it enters the prompt: the judge only needs
# enough to assess layout/visual/interaction quality, and full multi-thousand-line
# candidates would blow the input budget for a small, fast ranking call.
_CANDIDATE_CHAR_LIMIT = 4000

# Fewer than this many candidates → nothing to rank; the first (index 0) is the answer.
_MIN_CANDIDATES_TO_RANK = 2

# ---------------------------------------------------------------------------
# pick_best_design tool definition (D-02) — hand-written input_schema.
# ---------------------------------------------------------------------------

_PICK_TOOL_NAME = "pick_best_design"

_PICK_BEST_DESIGN_TOOL: dict[str, Any] = {
    "name": _PICK_TOOL_NAME,
    "description": (
        "Return the 0-based index of the single best candidate design. Respond ONLY via this tool — no prose."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "best_index": {
                "type": "integer",
                "description": "0-based index of the best candidate.",
            },
            "reason": {
                "type": "string",
                "description": "A brief justification for the choice.",
            },
        },
        "required": ["best_index", "reason"],
        "additionalProperties": False,
    },
}

if TYPE_CHECKING:
    _PICK_TOOL: ToolParam = cast("ToolParam", _PICK_BEST_DESIGN_TOOL)
else:
    _PICK_TOOL = _PICK_BEST_DESIGN_TOOL

# ---------------------------------------------------------------------------
# System prompt — static, trusted content only.
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a senior UI/design reviewer. Given the user's intent and N candidate "
    "implementations (plain-JS DOM code), pick the index (0-based) of the candidate that "
    "best realizes a polished, distinctive, CORRECT, complete design matching the intent "
    "— favor real layout/visual quality and working interactivity over verbosity. Return "
    "via pick_best_design only."
)


@dataclass(frozen=True)
class JudgeResult:
    """Immutable result of a GenuiCodeJudgeAdapter.rank() call (D-22).

    best_index is the primary value callers want; input_tokens/output_tokens
    surface the judge call's real usage (0 on the short-circuit < 2 candidates
    path or on any error — no billed call was made in either case).
    """

    best_index: int
    input_tokens: int = 0
    output_tokens: int = 0


def _extract_usage(response: Any) -> tuple[int, int]:
    """Read real (input_tokens, output_tokens) off a Bedrock response (D-22).

    Mirrors GenuiQuarantineAdapter's existing `.usage` capture idiom.
    """
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    return input_tokens, output_tokens


class GenuiCodeJudgeAdapter:
    """LLM judge that ranks N code-island candidates and returns the best index.

    Bedrock forced tool-use (pick_best_design). Non-streaming: the ranking output is
    tiny (an index + short reason), so a single fast messages.create is used. On any
    error/timeout/invalid output the adapter returns JudgeResult(best_index=0) —
    never raises.
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        model_id: str,
        max_tokens: int = 512,
        timeout_seconds: float = 90.0,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds

    async def rank(self, *, intent_summary: str, candidates: list[str]) -> JudgeResult:
        """Return the 0-based index of the best candidate + the judge call's real usage.

        Args:
            intent_summary: Neutral description of what the user wants (from Call A).
            candidates: The candidate island code strings to rank (len >= 1).

        Returns:
            JudgeResult.best_index is in [0, len(candidates) - 1]. Returns index 0
            (with input_tokens=output_tokens=0 — no call was made) on any error,
            timeout, invalid tool output, out-of-range index, or when fewer than 2
            candidates are supplied. Never raises.
        """
        if len(candidates) < _MIN_CANDIDATES_TO_RANK:  # nothing to rank; first is the answer.
            return JudgeResult(best_index=0)
        try:
            return await self._call_model(intent_summary=intent_summary, candidates=candidates)
        except Exception:
            logger.warning(
                "genui_code_judge_failed",
                model_id=self._model_id,
                candidate_count=len(candidates),
                exc_info=True,
            )
            return JudgeResult(best_index=0)

    async def _call_model(self, *, intent_summary: str, candidates: list[str]) -> JudgeResult:
        """Make the Bedrock ranking call with a timeout; parse and clamp the index."""
        user_content = _build_user_content(intent_summary=intent_summary, candidates=candidates)
        messages: list[dict[str, object]] = [{"role": "user", "content": user_content}]

        async with asyncio.timeout(self._timeout_seconds):
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self._model_id,
                max_tokens=self._max_tokens,
                temperature=0,
                system=_SYSTEM_PROMPT,
                tools=[_PICK_TOOL],
                tool_choice={"type": "tool", "name": _PICK_TOOL_NAME},
                messages=messages,
            )

        # D-22: capture real usage regardless of how parsing turns out below.
        input_tokens, output_tokens = _extract_usage(response)
        best_index = self._parse_response(response, candidate_count=len(candidates))
        return JudgeResult(best_index=best_index, input_tokens=input_tokens, output_tokens=output_tokens)

    def _parse_response(self, response: Any, *, candidate_count: int) -> int:
        """Extract best_index from the pick_best_design tool_use block; clamp to range."""
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                raw_input: dict[str, Any] = dict(block.input)
            except (TypeError, ValueError):
                logger.warning("genui_code_judge_parse_failed", exc_info=True)
                return 0
            best_index = raw_input.get("best_index")
            if not isinstance(best_index, int) or isinstance(best_index, bool):
                logger.warning("genui_code_judge_invalid_index", best_index=best_index)
                return 0
            # Clamp to [0, candidate_count - 1] (defence-in-depth: model may hallucinate).
            clamped = max(0, min(best_index, candidate_count - 1))
            logger.info("genui_code_judge_picked", best_index=clamped, candidate_count=candidate_count)
            return clamped

        logger.warning("genui_code_judge_no_tool_use")
        return 0


def _build_user_content(*, intent_summary: str, candidates: list[str]) -> str:
    """Build the judge user turn: intent + each candidate (code truncated) as a block."""
    parts = [f"User intent: {intent_summary}\n"]
    for i, code in enumerate(candidates):
        truncated = code[:_CANDIDATE_CHAR_LIMIT]
        parts.append(f"--- CANDIDATE {i} ---\n{truncated}")
    parts.append(f"\nPick the best of the {len(candidates)} candidates (0-based) and call pick_best_design.")
    return "\n\n".join(parts)
