"""AnthropicSegmenter -- LLM segmentation adapter using AWS Bedrock.

Security contract (D-14):
  - Document content lives ONLY in the user turn inside <document_content> delimiters.
  - The system prompt is a constant: schema + instructions, NEVER document content.
  - Prompt-injection in document text cannot escape into the system prompt.

Retry contract:
  - Up to _MAX_RETRIES attempts with _RETRY_DELAYS seconds between them.
  - On total failure returns [] (never raises to caller). ST-04: the silent
    [] fallbacks additionally call record_adapter_degradation("segmentation",
    ...) so a pipeline driver collecting degradations can mark the email
    'degraded' — a no-op outside a collector, so the never-raise contract and
    every other caller are unchanged.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.domain.ports.segmenter_protocol import PageToken, ProposedRegion
from app.domain.services.pipeline_health import record_adapter_degradation

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_RETRIES = 3
_RETRY_DELAYS: tuple[float, float, float] = (2.0, 5.0, 15.0)

# Maximum characters sent to the model per page (roughly ~8k tokens for Claude).
# Prevents runaway token costs on enormous pages; truncation is logged.
_MAX_PAGE_CHARS = 32_000

# The segment_document tool schema for structured output.
# The model SELECTS which numbered tokens belong to each region (token_indices);
# the caller computes the region polygon from those tokens' real coordinates (04-14).
_SEGMENT_TOOL_DICT: dict[str, Any] = {
    "name": "segment_document",
    "description": (
        "Return all candidate entity regions found in the document page. "
        "Return an empty list if the content is junk, irrelevant, or corrupt."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "regions": {
                "type": "array",
                "description": "List of proposed entity regions (may be empty).",
                "items": {
                    "type": "object",
                    "required": ["content_text", "token_indices", "page_index"],
                    "properties": {
                        "content_text": {
                            "type": "string",
                            "description": "Text content of this region.",
                        },
                        "token_indices": {
                            "type": "array",
                            "description": (
                                "0-based indices into the numbered tokens (the [i] markers "
                                "in the document content) that belong to this region. "
                                "The region's box is derived from these tokens — select all "
                                "tokens the entity spans."
                            ),
                            "items": {"type": "integer"},
                        },
                        "entity_type_hint": {
                            "type": ["string", "null"],
                            "description": "Optional coarse entity type hint.",
                        },
                        "parent_index": {
                            "type": ["integer", "null"],
                            "description": (
                                "0-based index into this response's regions array "
                                "for the parent region, or null if top-level."
                            ),
                        },
                        "page_index": {
                            "type": "integer",
                            "description": "0-based page index this region belongs to.",
                        },
                    },
                },
            }
        },
        "required": ["regions"],
    },
}

if TYPE_CHECKING:
    # Expose cast type for mypy; at runtime we rely on duck-typing
    _SEGMENT_TOOL: ToolParam = cast("ToolParam", _SEGMENT_TOOL_DICT)
else:
    _SEGMENT_TOOL = _SEGMENT_TOOL_DICT

# System prompt is a constant -- NEVER interpolates document content.
_SEGMENTATION_SYSTEM = (
    "You are a document segmentation assistant. "
    "The document page is given as a numbered list of tokens, one per line, "
    "each prefixed with its 0-based index in square brackets, e.g. '[3] Invoice'. "
    "Identify all candidate entity regions. "
    "Rules:\n"
    "- A page may contain multiple, overlapping, or nested entities.\n"
    "- For each region, set token_indices to the indices of the tokens the entity spans "
    "(the region's box is derived from those tokens' real coordinates).\n"
    "- Use parent_index to denote nested entities (index into the returned regions array).\n"
    "- Return [] for junk, irrelevant, or corrupt content -- never guess.\n"
    "- Output ONLY via the segment_document tool -- no prose.\n"
    "Call segment_document with the regions you find."
)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class AnthropicSegmenter:
    """Proposes candidate entity regions via Claude on AWS Bedrock (D-08).

    Document content is ALWAYS placed in the user turn inside
    <document_content> delimiters (D-14 structural defense).
    """

    def __init__(self, *, client: AsyncAnthropicBedrock, model_id: str) -> None:
        self._client = client
        self._model_id = model_id

    async def segment(self, *, tokens: tuple[PageToken, ...], page_index: int) -> list[ProposedRegion]:
        """Return candidate regions for the page tokens; returns [] on error or junk."""
        # Nothing to segment — short-circuit without an API call.
        if not tokens:
            return []

        # Serialize tokens as a numbered list: "[i] text" per line.
        numbered = "\n".join(f"[{t.index}] {t.text}" for t in tokens)

        # T-04-17: cap serialized token block to prevent token runaway. Truncate at a
        # line boundary so the final token line is never cut mid-token.
        if len(numbered) > _MAX_PAGE_CHARS:
            truncated = numbered[:_MAX_PAGE_CHARS]
            last_newline = truncated.rfind("\n")
            numbered = truncated[:last_newline] if last_newline > 0 else truncated
            logger.warning(
                "segmentation_page_text_truncated",
                original_len=len(numbered),
                truncated_len=_MAX_PAGE_CHARS,
                page_index=page_index,
            )

        raw = await self._generate(page_content=numbered, page_index=page_index)
        return raw

    async def _generate(self, *, page_content: str, page_index: int) -> list[ProposedRegion]:
        """Call the model with retries; return [] on total failure."""
        # D-14 hardening: neutralize any literal closing delimiter in document content
        # so a malicious token cannot break out of the <document_content> envelope.
        safe_content = page_content.replace("</document_content>", "<\\/document_content>")
        user_content = (
            f"<document_content>{safe_content}</document_content>\n\nReturn the candidate entity regions as JSON."
        )

        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._client.messages.create(
                    model=self._model_id,
                    max_tokens=4096,
                    system=_SEGMENTATION_SYSTEM,
                    tools=[_SEGMENT_TOOL],
                    tool_choice={"type": "auto"},
                    messages=[{"role": "user", "content": user_content}],
                )
                return self._parse_response(response, page_index=page_index)
            except Exception:
                delay = _RETRY_DELAYS[attempt] if attempt < len(_RETRY_DELAYS) else _RETRY_DELAYS[-1]
                logger.warning(
                    "segmentation_attempt_failed",
                    attempt=attempt + 1,
                    max_retries=_MAX_RETRIES,
                    page_index=page_index,
                    exc_info=True,
                )
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(delay)

        logger.error(
            "segmentation_all_retries_exhausted",
            max_retries=_MAX_RETRIES,
            page_index=page_index,
        )
        record_adapter_degradation(
            "segmentation",
            f"page {page_index}: {_MAX_RETRIES} attempts failed, no regions proposed",
        )
        return []

    def _parse_response(self, response: Any, *, page_index: int) -> list[ProposedRegion]:
        """Extract ProposedRegion list from the model response."""
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                raw_regions = block.input.get("regions", [])
                return [self._parse_region(r, page_index=page_index) for r in raw_regions]
            except (KeyError, TypeError, ValueError):
                logger.warning(
                    "segmentation_parse_failed",
                    page_index=page_index,
                    exc_info=True,
                )
                record_adapter_degradation(
                    "segmentation",
                    f"page {page_index}: malformed model response, regions dropped",
                )
                return []

        # No tool_use block -- model returned text only; treat as no regions
        logger.debug("segmentation_no_tool_use_block", page_index=page_index)
        return []

    @staticmethod
    def _parse_region(raw: dict[str, Any], *, page_index: int) -> ProposedRegion:
        """Convert a raw region dict into a ProposedRegion."""
        indices_raw = raw.get("token_indices", []) or []
        token_indices = tuple(int(v) for v in indices_raw)
        return ProposedRegion(
            content_text=str(raw.get("content_text", "")),
            token_indices=token_indices,
            entity_type_hint=raw.get("entity_type_hint") or None,
            parent_index=raw.get("parent_index"),
            page_index=int(raw.get("page_index", page_index)),
        )
