"""KnowledgeSynthesizerService — materializes knowledge-graph rows on confirmation (SYNTH-03).

Implements the KnowledgeSynthesizer port. On a confirmed region it upserts exactly one
knowledge_node per region (node identity 1:1 with the component, scope_ref_id=component_id)
and writes a supersede-safe set of EXTRACTED-tier edges:
  - anchor edge (evidenced_by) carrying OCR token-polygon provenance
  - co_occurs_with edges to the email's other confirmed entity components
  - an "about" edge to the region's selected entity instance, when resolvable

Re-confirming the same region deactivates its prior active edges (never DELETE, T-29-08)
before inserting the fresh set — deactivate-then-insert, no DB transactions available.

Architecture contract: imports ONLY app.domain.* and sibling app.application modules.
No infrastructure imports permitted (verified by lint-imports rule).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

import structlog

from app.application.use_cases._token_provenance import capture_provenance
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

if TYPE_CHECKING:
    from app.domain.entities.extraction_record import ExtractionRecord

logger = structlog.get_logger(__name__)

_TIER_EXTRACTED = "EXTRACTED"
_TIER_INFERRED = "INFERRED"
_TIER_AMBIGUOUS = "AMBIGUOUS"
_SCOPE_ENTITY_TYPE = "entity_type"
_TARGET_TYPE_COMPONENT = "email_component"
_TARGET_TYPE_ENTITY_INSTANCE = "entity_instance"


class KnowledgeSynthesizerService:
    """Materializes a 1:1 region node + supersede-safe EXTRACTED edge set (D-13/SYNTH-03).

    Collaborators (all domain ports):
        components: ComponentRepository — load the confirmed region + its parent page.
        knowledge: KnowledgeGraphRepository — node upsert/reuse, edge insert/deactivate.
        entity_instances: EntityInstanceRepository — co-occurrence + selected-instance reads.

    NODE IDENTITY: the polymorphic scope_ref intentionally points at the confirmed region
    (scope="entity_type", scope_ref_id=component_id) rather than at the entity_type row, so
    the node is 1:1 with the region and `deactivate_edges_for_node` on re-confirm touches
    exactly and only this region's edges (T-29-08).
    """

    def __init__(
        self,
        *,
        components: ComponentRepository,
        knowledge: KnowledgeGraphRepository,
        entity_instances: EntityInstanceRepository,
    ) -> None:
        self._components = components
        self._knowledge = knowledge
        self._entity_instances = entity_instances

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

        See KnowledgeSynthesizer port docstring for the best-effort contract (this
        method itself does not swallow exceptions -- the best-effort wrapper lives
        in the caller, per plan 29-04).
        """
        log = logger.bind(component_id=component_id, importer_id=importer_id)

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("synthesize_from_confirmation_component_not_found")
            return

        location = component.location
        polygon = cast("list[list[float]]", location.get("polygon") or [])
        page_index = location.get("page_index")

        # Page resolution (edit_region.py:159-162 idiom). Guard the page-missing case:
        # a parent_component_id that fails to resolve to a page must not raise -- the
        # anchor edge is still written, with empty tokens.
        page = None
        if component.parent_component_id is not None:
            page = await self._components.find_by_id(component.parent_component_id)

        captured = capture_provenance(page, polygon) if page is not None else {"tokens": [], "text": ""}

        provenance: dict[str, object] = {
            "component_id": component_id,
            "page_index": page_index,
            "polygon": polygon,
            "tokens": captured["tokens"],
        }

        # NODE IDENTITY = the region (scope_ref_id=component_id) -- see class docstring.
        existing_node = await self._knowledge.find_active_node(importer_id, _SCOPE_ENTITY_TYPE, component_id)
        node_existed = existing_node is not None

        effective_fields: dict[str, object] = dict(
            corrected_fields or (confirmed_record.extracted_fields if confirmed_record else {}) or {}
        )
        title, content = _compose_title_and_content(component, effective_fields)

        node_id = await self._knowledge.upsert_node(
            importer_id=importer_id,
            title=title,
            content=content,
            scope=_SCOPE_ENTITY_TYPE,
            scope_ref_id=component_id,
            scope_ref_type=_TARGET_TYPE_COMPONENT,
            source=source,
            tier=_TIER_EXTRACTED,
        )

        # SUPERSEDE: deactivate-then-insert (no DB transactions available). The
        # momentary no-active-edges window only occurs on re-confirm and leaves no
        # corruption -- rows are never deleted (T-29-08).
        if node_existed:
            await self._knowledge.deactivate_edges_for_node(node_id)

        # Anchor edge: confirmed-component provenance (evidenced_by).
        await self._knowledge.insert_edge(
            source_node_id=node_id,
            target_ref_id=component_id,
            target_ref_type=_TARGET_TYPE_COMPONENT,
            relation_type="evidenced_by",
            tier=_TIER_EXTRACTED,
            source=source,
            provenance=provenance,
        )

        # Co-occurrence edges: other confirmed entity components in the same email.
        co_occurring = await self._entity_instances.find_confirmed_entity_components_for_email(component.email_id)
        for other in co_occurring:
            if other.id == component_id:
                continue
            await self._knowledge.insert_edge(
                source_node_id=node_id,
                target_ref_id=other.id,
                target_ref_type=_TARGET_TYPE_COMPONENT,
                relation_type="co_occurs_with",
                tier=_TIER_EXTRACTED,
                source=source,
                provenance=None,
            )

        # About edge: only when a selected entity instance is resolvable.
        selected_instance = await self._entity_instances.find_selected_instance_for_component(component_id)
        if selected_instance is not None:
            await self._knowledge.insert_edge(
                source_node_id=node_id,
                target_ref_id=selected_instance.id,
                target_ref_type=_TARGET_TYPE_ENTITY_INSTANCE,
                relation_type="about",
                tier=_TIER_EXTRACTED,
                source=source,
                provenance=None,
            )

        # Suggestion edges (SUGGEST-ONLY, T-30-01): display-only INFERRED/AMBIGUOUS
        # relations, always source='synthesis', never tier='EXTRACTED'. Runs after
        # the deactivate-then-insert supersede above so re-confirm re-derives fresh
        # suggestions alongside the fresh EXTRACTED set.

        # INFERRED: unconfirmed entity components co-occurring in the same email.
        unconfirmed = await self._entity_instances.find_unconfirmed_entity_components_for_email(component.email_id)
        for other in unconfirmed:
            if other.id == component_id:
                continue
            await self._knowledge.insert_edge(
                source_node_id=node_id,
                target_ref_id=other.id,
                target_ref_type=_TARGET_TYPE_COMPONENT,
                relation_type="co_occurs_with",
                tier=_TIER_INFERRED,
                source="synthesis",
                provenance=None,
            )

        # AMBIGUOUS: non-selected candidate entity instances for this component.
        unselected_candidates = await self._entity_instances.find_unselected_candidate_instances_for_component(
            component_id
        )
        for candidate in unselected_candidates:
            await self._knowledge.insert_edge(
                source_node_id=node_id,
                target_ref_id=candidate.id,
                target_ref_type=_TARGET_TYPE_ENTITY_INSTANCE,
                relation_type="possibly_about",
                tier=_TIER_AMBIGUOUS,
                source="synthesis",
                provenance=None,
            )

        log.info("synthesize_from_confirmation_done", node_id=node_id, node_existed=node_existed)


def _compose_title_and_content(component: object, effective_fields: dict[str, object]) -> tuple[str, str | None]:
    """Compose node title/content from confirmed field values + component text.

    title mirrors promote_entity_on_confirm.py's display_name idiom
    ("{entity_type}: {primary_value}"), falling back to the entity_type_id alone
    (or the component_id) when no field values are available.
    content joins effective fields as "k: v" lines plus component.content_text.
    """
    entity_type_id = getattr(component, "entity_type_id", None)
    content_text = getattr(component, "content_text", None) or ""
    component_id = getattr(component, "id", "")

    primary_value = next(iter(effective_fields.values()), None) if effective_fields else None
    fallback = entity_type_id or (content_text.strip()[:200] or component_id)
    title = f"{entity_type_id}: {primary_value}" if primary_value is not None and entity_type_id else str(fallback)

    content_lines = [f"{k}: {v}" for k, v in effective_fields.items()]
    if content_text:
        content_lines.append(content_text)
    content = "\n".join(content_lines) if content_lines else None

    return title, content
