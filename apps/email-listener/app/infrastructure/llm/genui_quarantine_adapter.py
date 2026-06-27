"""GenuiQuarantineAdapter — Call A of the dual-LLM generation pipeline.

Security contract (D-09, SAFE-01, D-11):
  - Raw untrusted content is placed ONLY in the user turn inside
    <document_content> delimiters.
  - The system prompt is constructed from TRUSTED static schema only;
    it NEVER contains user-supplied content.
  - The quarantine_extraction tool uses an enum-constrained entity_type
    (D-10): only the 10 component slugs from genui-prompt.json + "unknown".
  - tool_choice is FORCED to the quarantine_extraction tool (D-02), not "auto".
  - max_tokens is always set (D-16).
  - asyncio.timeout wraps every call (D-17).
  - On any error/timeout: returns empty QuarantineExtraction, never raises.

The structured extract from Call A flows to Call B (generator).
Raw prose NEVER crosses that boundary (SAFE-02).
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

# ---------------------------------------------------------------------------
# Allowed entity-type slugs (D-10) — must match components in genui-prompt.json
# ---------------------------------------------------------------------------

_ALLOWED_ENTITY_TYPES: list[str] = [
    "text",
    "badge",
    "button",
    "card",
    "key-value-list",
    "separator",
    "alert",
    "table",
    "stack",
    "grid",
    "unknown",
]

# ---------------------------------------------------------------------------
# Quarantine tool definition (forced tool-use, D-02, D-10)
# ---------------------------------------------------------------------------

_QUARANTINE_TOOL_DICT: dict[str, Any] = {
    "name": "quarantine_extraction",
    "description": (
        "Extract the structured intent from the document. "
        "Return ONLY values from the allowed entity_type enum. "
        "Use 'unknown' if the appropriate component cannot be determined."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "entity_type": {
                "type": "string",
                "enum": _ALLOWED_ENTITY_TYPES,
                "description": "The UI component type that best represents the user's intent.",
            },
            "intent_summary": {
                "type": "string",
                "maxLength": 500,
                "description": (
                    "A brief (1-2 sentence, max 500 characters) description of what the user "
                    "wants to display. Written in neutral, factual language. No raw document content."
                ),
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
                "description": "Confidence in the entity_type classification.",
            },
        },
        "required": ["entity_type", "intent_summary", "confidence"],
    },
}

if TYPE_CHECKING:
    _QUARANTINE_TOOL: ToolParam = cast("ToolParam", _QUARANTINE_TOOL_DICT)
else:
    _QUARANTINE_TOOL = _QUARANTINE_TOOL_DICT

# ---------------------------------------------------------------------------
# System prompt — trusted static content only (D-11, D-14)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a UI intent classifier. "
    "Your task is to classify the user's display intent and identify the most appropriate "
    "UI component type from the allowed set.\n\n"
    "Allowed component types:\n"
    + "\n".join(f"  - {slug}" for slug in _ALLOWED_ENTITY_TYPES if slug != "unknown")
    + "\n  - unknown (use when no component fits)\n\n"
    "Rules:\n"
    "- Select the single best-fitting component type.\n"
    "- Summarise the intent in 1-2 neutral sentences (no document text).\n"
    "- Use 'unknown' when the intent does not match any allowed type.\n"
    "- Output ONLY via the quarantine_extraction tool — no prose.\n"
    "Call quarantine_extraction with your classification result."
)

# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class QuarantineExtraction:
    """Structured output from Call A (quarantine).

    Only this structured data crosses to Call B (generator) — raw prose never does.
    """

    entity_type: str = "unknown"
    intent_summary: str = ""
    confidence: str = "low"
    input_tokens: int = 0
    output_tokens: int = 0


_EMPTY_EXTRACTION = QuarantineExtraction()

# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class GenuiQuarantineAdapter:
    """Call A: enum-constrained extraction that quarantines raw untrusted content.

    The adapter receives the user's intent (trusted) and the document content
    (untrusted).  It places document content ONLY in the user turn inside
    <document_content> delimiters (D-11).  The system prompt contains ONLY
    static classification guidance — never raw user/document content (D-09).

    On any error or timeout: returns _EMPTY_EXTRACTION (entity_type='unknown').
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        model_id: str,
        max_tokens: int = 1024,
        timeout_seconds: float = 15.0,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds

    async def extract(
        self,
        *,
        intent: str,
        raw_content: str,
    ) -> QuarantineExtraction:
        """Classify the display intent and extract structured data.

        Args:
            intent: Trusted user intent string (from the request payload).
            raw_content: Untrusted document content — placed ONLY in user turn (D-11).

        Returns:
            QuarantineExtraction with entity_type from allowed enum.
            Returns _EMPTY_EXTRACTION on any error or timeout.
        """
        try:
            return await self._call_model(intent=intent, raw_content=raw_content)
        except Exception:
            logger.warning(
                "genui_quarantine_failed",
                model_id=self._model_id,
                exc_info=True,
            )
            return _EMPTY_EXTRACTION

    async def _call_model(self, *, intent: str, raw_content: str) -> QuarantineExtraction:
        """Make the Bedrock call with timeout; parse and return the extraction."""
        # System prompt: trusted static content ONLY (D-11, D-14).
        # User turn: raw_content inside <document_content> delimiters (D-11).
        user_content = (
            f"User intent: {intent}\n\n"
            f"<document_content>{raw_content}</document_content>\n\n"
            "Classify the display intent and call quarantine_extraction."
        )

        messages: list[dict[str, object]] = [{"role": "user", "content": user_content}]

        async with asyncio.timeout(self._timeout_seconds):
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self._model_id,
                max_tokens=self._max_tokens,
                system=_SYSTEM_PROMPT,
                tools=[_QUARANTINE_TOOL],
                tool_choice={"type": "tool", "name": "quarantine_extraction"},
                messages=messages,
            )

        return self._parse_response(response)

    def _parse_response(self, response: Any) -> QuarantineExtraction:
        """Extract QuarantineExtraction from a successful Bedrock response."""
        input_tokens: int = getattr(getattr(response, "usage", None), "input_tokens", 0) or 0
        output_tokens: int = getattr(getattr(response, "usage", None), "output_tokens", 0) or 0

        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                raw_input: dict[str, Any] = dict(block.input)
                entity_type = str(raw_input.get("entity_type", "unknown"))
                # Clamp to allowed enum (defence-in-depth: model may hallucinate)
                if entity_type not in _ALLOWED_ENTITY_TYPES:
                    entity_type = "unknown"
                # Clamp intent_summary to 500 chars (WR-01 / defence-in-depth:
                # model may ignore maxLength in constrained-decoding mode).
                intent_summary = str(raw_input.get("intent_summary", ""))[:500]
                return QuarantineExtraction(
                    entity_type=entity_type,
                    intent_summary=intent_summary,
                    confidence=str(raw_input.get("confidence", "low")),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            except (KeyError, TypeError, ValueError):
                logger.warning("genui_quarantine_parse_failed", exc_info=True)
                return QuarantineExtraction(input_tokens=input_tokens, output_tokens=output_tokens)

        # No tool_use block returned — model returned text only
        logger.debug("genui_quarantine_no_tool_use_block")
        return QuarantineExtraction(input_tokens=input_tokens, output_tokens=output_tokens)
