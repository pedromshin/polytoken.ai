"""KnowledgeSynthesizer port -- domain abstraction over knowledge-graph synthesis.

D-13 materialization port: wires the confirm_region.py:169 synthesis-trigger
hook so confirming a region can derive knowledge_nodes/knowledge_node_edges
rows. No infrastructure imports permitted (verified by lint-imports rule).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.domain.entities.extraction_record import ExtractionRecord


class KnowledgeSynthesizer(Protocol):
    """Port for deriving knowledge-graph nodes/edges from a confirmed region.

    Best-effort: implementations MUST NOT raise into the caller
    (confirm_region.py's confirmation flow must never fail because synthesis
    failed) -- synthesis errors should be logged and swallowed internally.
    """

    async def synthesize_from_confirmation(
        self,
        *,
        component_id: str,
        importer_id: str,
        confirmed_record: ExtractionRecord | None,
        corrected_fields: dict[str, object] | None,
        source: str = "learned_from_correction",
    ) -> None:
        """Derive and persist knowledge-graph rows from a confirmed region.

        `source="learned_from_correction"` distinguishes edges derived from a
        human confirmation from those inferred by automated extraction (D-13
        design note); it becomes the knowledge_node_edges.source value.
        """
        ...
