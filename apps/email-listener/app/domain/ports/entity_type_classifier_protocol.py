"""EntityTypeClassifierProtocol port — domain abstraction over LLM entity-type classification.

One call classifies ALL candidate regions of a document (RELIABILITY design constraint):
never call Bedrock per-region — one batched call classifies the full list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RegionToClassify:
    """A candidate region submitted for entity-type classification.

    component_id: the Component primary key (used to route suggestions back).
    text: the region's content_text sent to the model.
    """

    component_id: str
    text: str


@dataclass(frozen=True)
class EntityTypeSuggestion:
    """Classification suggestion for a single region.

    component_id: mirrors the input RegionToClassify.component_id.
    entity_type_slug: the best-matching entity type slug, or None when the
        model is unsure (no clear match).
    confidence: model-reported confidence in [0, 1].  Callers should apply a
        threshold (e.g. >= 0.5) before acting on the suggestion.
    """

    component_id: str
    entity_type_slug: str | None
    confidence: float


class EntityTypeClassifierProtocol(Protocol):
    """Port for LLM-based entity-type classification of document regions.

    The adapter MUST classify all regions in a SINGLE Bedrock call to avoid
    per-region 504/429 errors (autofill's per-field sequential calls already
    saturate the ALB 60 s timeout and the Bedrock RPM quota).
    """

    async def classify(
        self,
        *,
        regions: tuple[RegionToClassify, ...],
        entity_types: tuple[object, ...],
        examples: tuple[dict[str, object], ...] = (),
    ) -> tuple[EntityTypeSuggestion, ...]:
        """Classify regions against the provided entity types in one call.

        regions: candidate regions to classify (id + text).
        entity_types: EntityType objects visible to the importer.
        examples: few-shot entity-type correction examples (LEARN-02).  Each
            dict carries at least "content_text" and
            "corrected_entity_type_slug".  Defaults to () (cold start — no
            behavior change from before this parameter existed).  Rendered
            ONLY in the Bedrock user turn, never the system prompt (D-14).

        Returns one EntityTypeSuggestion per region (in any order).
        Missing rows are treated as confidence=0 / slug=None by callers.
        Never raises — returns () on total failure.
        """
        ...
