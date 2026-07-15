"""AnthropicEntityTypeClassifier — entity-type classification adapter using AWS Bedrock.

RELIABILITY contract:
  ONE Bedrock call classifies ALL candidate regions in a single document.
  Never called per-region (avoids ALB 60 s timeout + Bedrock RPM saturation).

SUGGEST-ONLY contract (D-05):
  Returns EntityTypeSuggestion objects with a confidence score.
  Callers decide the threshold; this adapter never mutates any row.

BEST-EFFORT contract:
  On any failure, logs and returns an empty tuple — never raises.
  Callers wrap the use-case call in try/except as an additional guard.

Security (D-14 structural defence):
  Region content lives ONLY in the user turn inside <regions> delimiters.
  The system prompt contains only entity-type metadata (slug/label/description).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.domain.entities.entity_type import EntityType
from app.domain.ports.entity_type_classifier_protocol import (
    EntityTypeSuggestion,
    RegionToClassify,
)

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Model used for classification (same model family as autofill/segmenter).
# Stored here so callers + tests can inspect it, and the orchestrator can verify it.
MODEL_ID_USED = "us.anthropic.claude-3-5-haiku-20241022-v1:0"

_EMPTY: tuple[EntityTypeSuggestion, ...] = ()

# Tool schema for structured output — parallel to autofill's extract_fields tool.
_CLASSIFY_REGIONS_TOOL_DICT: dict[str, Any] = {
    "name": "classify_regions",
    "description": (
        "Classify each document region against the provided entity types. "
        "For each region, assign the best-matching entity_type_slug or null when "
        "no type clearly matches.  Include a confidence score in [0, 1] for each."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "description": "One entry per region.",
                "items": {
                    "type": "object",
                    "properties": {
                        "component_id": {
                            "type": "string",
                            "description": "The component_id from the input region.",
                        },
                        "entity_type_slug": {
                            "type": ["string", "null"],
                            "description": (
                                "The slug of the best-matching entity type, or null when no type clearly matches."
                            ),
                        },
                        "confidence": {
                            "type": "number",
                            "description": "Confidence score in [0, 1].",
                        },
                    },
                    "required": ["component_id", "entity_type_slug", "confidence"],
                },
            },
        },
        "required": ["classifications"],
    },
}

if TYPE_CHECKING:
    _CLASSIFY_REGIONS_TOOL: ToolParam = cast("ToolParam", _CLASSIFY_REGIONS_TOOL_DICT)
else:
    _CLASSIFY_REGIONS_TOOL = _CLASSIFY_REGIONS_TOOL_DICT


# ---------------------------------------------------------------------------
# System prompt builder
# ---------------------------------------------------------------------------


def _render_entity_types(entity_types: tuple[EntityType, ...]) -> str:
    """Render entity type catalog as a compact text block for the system prompt."""
    lines: list[str] = []
    for et in entity_types:
        desc = f" — {et.description}" if et.description else ""
        lines.append(f"  - slug={et.slug!r}  label={et.label!r}{desc}")
    return "\n".join(lines) if lines else "  (no entity types available)"


def _render_correction_examples_block(examples: tuple[dict[str, object], ...]) -> str:
    """Render few-shot entity-type correction examples as a delimited block.

    Mirrors autofill_adapter._render_examples_block exactly (D-14: user turn
    only, never the system prompt). Returns "" for empty examples (cold
    start — no block appended, byte-identical to pre-examples behavior).
    """
    if not examples:
        return ""
    rendered = "\n".join(
        "<example>"
        f"<content>{example.get('content_text', '')}</content>"
        f"<corrected_entity_type_slug>{example.get('corrected_entity_type_slug', '')}</corrected_entity_type_slug>"
        "</example>"
        for example in examples
    )
    return f"<entity_type_examples>\n{rendered}\n</entity_type_examples>"


def _build_system_prompt(entity_types: tuple[EntityType, ...]) -> str:
    """Build the classification system prompt from entity-type metadata only (D-14).

    NEVER includes region content — that is placed in the user turn.
    """
    catalog = _render_entity_types(entity_types)
    return (
        "You are a document classification assistant.\n"
        "Your task is to classify each document region against the following entity types:\n\n"
        f"{catalog}\n\n"
        "Rules:\n"
        "- Assign the entity_type_slug that BEST matches the region's content.\n"
        "- Use null when the region does not clearly match any type.\n"
        "- Set confidence in [0, 1]: 1.0 = certain match, 0.0 = no match.\n"
        "- A region may match only ONE entity type (pick the strongest match).\n"
        "- Output ONLY via the classify_regions tool — no prose.\n"
        "Call classify_regions with your classification result."
    )


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class AnthropicEntityTypeClassifier:
    """Classify multiple regions against entity types in ONE Bedrock call (D-05).

    Authentication via ECS task IAM role (bedrock:InvokeModel) — no API key.
    """

    def __init__(self, *, client: AsyncAnthropicBedrock, model_id: str = MODEL_ID_USED) -> None:
        self._client = client
        self._model_id = model_id

    async def classify(
        self,
        *,
        regions: tuple[RegionToClassify, ...],
        entity_types: tuple[object, ...],
        examples: tuple[dict[str, object], ...] = (),
    ) -> tuple[EntityTypeSuggestion, ...]:
        """Classify all regions in a single Bedrock call; returns () on any failure."""
        typed_entity_types = tuple(et for et in entity_types if isinstance(et, EntityType))

        if not regions or not typed_entity_types:
            logger.debug(
                "entity_type_classifier_skip_empty",
                region_count=len(regions),
                entity_type_count=len(typed_entity_types),
            )
            return _EMPTY

        system_prompt = _build_system_prompt(typed_entity_types)

        # Region content lives ONLY in the user turn inside <regions> delimiters (D-14).
        regions_json = json.dumps(
            [{"component_id": r.component_id, "text": r.text} for r in regions],
            ensure_ascii=False,
        )
        user_content = (
            f"<regions>\n{regions_json}\n</regions>\n\nClassify each region and call classify_regions with your result."
        )

        # Few-shot correction examples (LEARN-02, D-14): UNTRUSTED content
        # rendered ONLY in the user turn, never the system prompt. Empty
        # examples -> "" -> no block appended (cold start, byte-identical).
        examples_block = _render_correction_examples_block(examples)
        if examples_block:
            user_content = f"{user_content}\n\n{examples_block}"

        messages: list[dict[str, object]] = [{"role": "user", "content": user_content}]

        try:
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self._model_id,
                max_tokens=4096,
                system=system_prompt,
                tools=[_CLASSIFY_REGIONS_TOOL],
                tool_choice={"type": "auto"},
                messages=messages,
            )
            result = self._parse_response(response, regions=regions)
            logger.info(
                "entity_type_classifier_done",
                region_count=len(regions),
                suggestion_count=len(result),
                model_id=self._model_id,
            )
            return result
        except Exception:
            logger.warning(
                "entity_type_classifier_failed",
                region_count=len(regions),
                exc_info=True,
            )
            return _EMPTY

    def _parse_response(
        self,
        response: Any,
        *,
        regions: tuple[RegionToClassify, ...],
    ) -> tuple[EntityTypeSuggestion, ...]:
        """Extract EntityTypeSuggestion list from the model response.

        Tolerates extra prose blocks, missing rows, and malformed entries.
        """
        known_ids = {r.component_id for r in regions}

        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                raw_list: list[dict[str, object]] = list(block.input.get("classifications", []))
            except (AttributeError, TypeError):
                logger.warning("entity_type_classifier_parse_failed_bad_input", exc_info=True)
                return _EMPTY

            suggestions: list[EntityTypeSuggestion] = []
            for entry in raw_list:
                if not isinstance(entry, dict):
                    continue
                component_id = entry.get("component_id")
                if not isinstance(component_id, str) or component_id not in known_ids:
                    continue
                slug = entry.get("entity_type_slug")
                if slug is not None and not isinstance(slug, str):
                    slug = None
                try:
                    confidence = float(entry.get("confidence", 0.0))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    confidence = 0.0
                confidence = max(0.0, min(1.0, confidence))
                suggestions.append(
                    EntityTypeSuggestion(
                        component_id=component_id,
                        entity_type_slug=slug,
                        confidence=confidence,
                    )
                )

            return tuple(suggestions)

        # No tool_use block — model returned text only
        logger.debug("entity_type_classifier_no_tool_use_block")
        return _EMPTY
