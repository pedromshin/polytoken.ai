"""Tests for KnowledgeSynthesizerService (SYNTH-03, Phase 29 Plan 03).

AsyncMock-port unit tests (asyncio.run, no pytest-asyncio) covering:
  - Node identity is 1:1 with the confirmed region (scope_ref_id=component_id).
  - First confirm: no deactivate call; anchor + co-occurrence edges inserted.
  - Re-confirm: deactivate_edges_for_node(node_id) called BEFORE any insert_edge
    (supersede-safe ordering, T-29-08).
  - Anchor edge carries {component_id, page_index, polygon, tokens} provenance
    and tier='EXTRACTED'.
  - Co-occurrence edges exclude the confirmed component itself.
  - The 'about' edge is inserted only when a selected entity instance exists.
  - Page-missing does not raise; the anchor edge is still written.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from app.application.use_cases.synthesize_knowledge import KnowledgeSynthesizerService
from app.domain.entities.component import Component
from app.domain.entities.entity_instance import EntityInstance
from app.domain.entities.extraction_record import ExtractionRecord

_COMP_ID = "comp-region-001"
_EMAIL_ID = "email-001"
_PAGE_ID = "comp-page-001"
_IMPORTER_ID = "imp-abc"
_ENTITY_TYPE_ID = "et-001"
_NODE_ID = "node-001"
_POLYGON = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]]


def _make_component(
    *,
    component_id: str = _COMP_ID,
    parent_component_id: str | None = _PAGE_ID,
) -> Component:
    return Component(
        id=component_id,
        email_id=_EMAIL_ID,
        importer_id=_IMPORTER_ID,
        attachment_id=None,
        parent_component_id=parent_component_id,
        source_type="region",
        location={"page_index": 0, "polygon": _POLYGON},
        content_text="Acme Corp",
        content_markdown=None,
        content_raw=None,
        embedding=None,
        sequence_index=0,
        extraction_status="confirmed",
        role="entity",
        entity_type_id=_ENTITY_TYPE_ID,
    )


def _make_page(component_id: str = _PAGE_ID) -> Component:
    return Component(
        id=component_id,
        email_id=_EMAIL_ID,
        importer_id=_IMPORTER_ID,
        attachment_id=None,
        parent_component_id=None,
        source_type="pdf_page",
        location={},
        content_text="page text",
        content_markdown=None,
        content_raw={"tokens": []},
        embedding=None,
        sequence_index=0,
        extraction_status="pending",
    )


def _make_extraction_record(fields: dict[str, object] | None = None) -> ExtractionRecord:
    now = datetime.now(UTC)
    return ExtractionRecord(
        id="er-001",
        importer_id=_IMPORTER_ID,
        component_id=_COMP_ID,
        entity_type_id=_ENTITY_TYPE_ID,
        extracted_fields=fields or {"name": "Acme Corp"},
        confidence_score=0.9,
        confidence_breakdown=None,
        routing_reason=None,
        status="confirmed",
        corrected_fields=None,
        retrieval_context=None,
        created_at=now,
        updated_at=now,
    )


def _make_entity_instance(instance_id: str = "ei-001") -> EntityInstance:
    return EntityInstance(
        id=instance_id,
        importer_id=_IMPORTER_ID,
        entity_type_id=_ENTITY_TYPE_ID,
        nauta_id=None,
        source="email_extracted",
        display_name="Acme Corp",
        identifiers={},
        aliases=[],
        summary_text=None,
        embedding=None,
        is_active=True,
    )


def _make_ports(
    *,
    component: Component | None = None,
    page: Component | None = None,
    active_node: dict[str, object] | None = None,
    co_occurring: list[Component] | None = None,
    selected_instance: EntityInstance | None = None,
    unconfirmed: list[Component] | None = None,
    unselected_candidates: list[EntityInstance] | None = None,
) -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    components = AsyncMock()

    async def _find_by_id(component_id: str) -> Component | None:
        if component is not None and component_id == component.id:
            return component
        if page is not None and component_id == page.id:
            return page
        return None

    components.find_by_id.side_effect = _find_by_id

    knowledge = AsyncMock()
    knowledge.find_active_node.return_value = active_node
    knowledge.upsert_node.return_value = _NODE_ID

    entity_instances = AsyncMock()
    entity_instances.find_confirmed_entity_components_for_email.return_value = co_occurring or []
    entity_instances.find_selected_instance_for_component.return_value = selected_instance
    entity_instances.find_unconfirmed_entity_components_for_email.return_value = unconfirmed or []
    entity_instances.find_unselected_candidate_instances_for_component.return_value = unselected_candidates or []

    return components, knowledge, entity_instances


# ---------------------------------------------------------------------------
# Task 2 (RED -> GREEN): core node-identity + supersede-ordering behavior
# ---------------------------------------------------------------------------


def test_first_confirm_creates_node_without_deactivate() -> None:
    """First confirm (find_active_node -> None): no deactivate call is made."""
    component = _make_component()
    page = _make_page()
    components, knowledge, entity_instances = _make_ports(component=component, page=page, active_node=None)

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    knowledge.find_active_node.assert_awaited_once_with(_IMPORTER_ID, "entity_type", _COMP_ID)
    knowledge.upsert_node.assert_awaited_once()
    upsert_kwargs = knowledge.upsert_node.await_args.kwargs
    assert upsert_kwargs["scope_ref_id"] == _COMP_ID
    knowledge.deactivate_edges_for_node.assert_not_awaited()
    assert knowledge.insert_edge.await_count >= 1


def test_reconfirm_deactivates_before_insert() -> None:
    """Re-confirm (node exists): deactivate_edges_for_node is called BEFORE insert_edge."""
    component = _make_component()
    page = _make_page()
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node={"id": _NODE_ID},
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    knowledge.deactivate_edges_for_node.assert_awaited_once_with(_NODE_ID)

    # Assert ordering: deactivate must precede all insert_edge calls.
    call_names = [call[0] for call in knowledge.mock_calls if call[0] in ("deactivate_edges_for_node", "insert_edge")]
    deactivate_index = call_names.index("deactivate_edges_for_node")
    insert_indices = [i for i, name in enumerate(call_names) if name == "insert_edge"]
    assert insert_indices, "expected at least one insert_edge call"
    assert deactivate_index < min(insert_indices), "deactivate_edges_for_node must precede insert_edge"


def test_anchor_edge_carries_provenance_and_tier() -> None:
    component = _make_component()
    page = _make_page()
    components, knowledge, entity_instances = _make_ports(component=component, page=page, active_node=None)

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    anchor_calls = [
        c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("relation_type") == "evidenced_by"
    ]
    assert len(anchor_calls) == 1
    anchor_kwargs = anchor_calls[0].kwargs
    assert anchor_kwargs["tier"] == "EXTRACTED"
    assert anchor_kwargs["target_ref_id"] == _COMP_ID
    assert anchor_kwargs["target_ref_type"] == "email_component"
    provenance = anchor_kwargs["provenance"]
    assert set(provenance.keys()) == {"component_id", "page_index", "polygon", "tokens"}
    assert provenance["component_id"] == _COMP_ID
    assert provenance["polygon"] == _POLYGON


# ---------------------------------------------------------------------------
# Task 3: co-occurrence self-exclusion, conditional about-edge, page-missing
# ---------------------------------------------------------------------------


def test_co_occurrence_excludes_confirmed_component_itself() -> None:
    component = _make_component()
    page = _make_page()
    other = _make_component(component_id="comp-other-001")
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        co_occurring=[component, other],
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    co_occurs_calls = [
        c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("relation_type") == "co_occurs_with"
    ]
    assert len(co_occurs_calls) == 1
    assert co_occurs_calls[0].kwargs["target_ref_id"] == "comp-other-001"


def test_about_edge_present_only_when_selected_instance_exists() -> None:
    component = _make_component()
    page = _make_page()
    instance = _make_entity_instance()
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        selected_instance=instance,
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    about_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("relation_type") == "about"]
    assert len(about_calls) == 1
    assert about_calls[0].kwargs["target_ref_id"] == "ei-001"
    assert about_calls[0].kwargs["target_ref_type"] == "entity_instance"


def test_about_edge_absent_when_no_selected_instance() -> None:
    component = _make_component()
    page = _make_page()
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        selected_instance=None,
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    about_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("relation_type") == "about"]
    assert not about_calls


def test_page_missing_does_not_raise_and_still_writes_anchor_edge() -> None:
    """Page unavailable (parent_component_id present but page not found): no exception."""
    component = _make_component()
    # No page registered in _find_by_id -> find_by_id(parent_component_id) returns None
    components, knowledge, entity_instances = _make_ports(component=component, page=None, active_node=None)

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    anchor_calls = [
        c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("relation_type") == "evidenced_by"
    ]
    assert len(anchor_calls) == 1
    provenance = anchor_calls[0].kwargs["provenance"]
    assert provenance["tokens"] == []
    assert provenance["polygon"] == _POLYGON


def test_no_duplicate_anchor_edge_across_first_then_reconfirm_sequence() -> None:
    """A first-confirm followed by a re-confirm never leaves two active anchor edges.

    Simulated at the port-call level: on re-confirm, deactivate_edges_for_node is
    called (deactivating the prior anchor), and exactly one new anchor edge is
    inserted for the second call -- so across the sequence only the most recent
    anchor insert_edge call is active.
    """
    component = _make_component()
    page = _make_page()

    # First confirm: no active node yet.
    components1, knowledge1, entity_instances1 = _make_ports(component=component, page=page, active_node=None)
    service1 = KnowledgeSynthesizerService(components=components1, knowledge=knowledge1, entity_instances=entity_instances1)
    asyncio.run(
        service1.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )
    first_anchor_calls = [
        c for c in knowledge1.insert_edge.await_args_list if c.kwargs.get("relation_type") == "evidenced_by"
    ]
    assert len(first_anchor_calls) == 1

    # Re-confirm: node now exists.
    components2, knowledge2, entity_instances2 = _make_ports(
        component=component, page=page, active_node={"id": _NODE_ID}
    )
    service2 = KnowledgeSynthesizerService(components=components2, knowledge=knowledge2, entity_instances=entity_instances2)
    asyncio.run(
        service2.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )
    knowledge2.deactivate_edges_for_node.assert_awaited_once_with(_NODE_ID)
    second_anchor_calls = [
        c for c in knowledge2.insert_edge.await_args_list if c.kwargs.get("relation_type") == "evidenced_by"
    ]
    assert len(second_anchor_calls) == 1


# ---------------------------------------------------------------------------
# Task 2 (30-01, RED -> GREEN): suggestion-edge emission (INFERRED / AMBIGUOUS)
# ---------------------------------------------------------------------------


def test_inferred_suggestion_edge_emitted_per_unconfirmed_component() -> None:
    component = _make_component()
    page = _make_page()
    unconfirmed_other = _make_component(component_id="comp-unconfirmed-001")
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        unconfirmed=[component, unconfirmed_other],
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    inferred_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("tier") == "INFERRED"]
    assert len(inferred_calls) == 1
    assert inferred_calls[0].kwargs["target_ref_id"] == "comp-unconfirmed-001"
    assert inferred_calls[0].kwargs["relation_type"] == "co_occurs_with"
    assert inferred_calls[0].kwargs["source"] == "synthesis"


def test_ambiguous_suggestion_edge_emitted_per_unselected_candidate() -> None:
    component = _make_component()
    page = _make_page()
    candidate = _make_entity_instance(instance_id="ei-candidate-001")
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        unselected_candidates=[candidate],
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    ambiguous_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("tier") == "AMBIGUOUS"]
    assert len(ambiguous_calls) == 1
    assert ambiguous_calls[0].kwargs["target_ref_id"] == "ei-candidate-001"
    assert ambiguous_calls[0].kwargs["target_ref_type"] == "entity_instance"
    assert ambiguous_calls[0].kwargs["relation_type"] == "possibly_about"
    assert ambiguous_calls[0].kwargs["source"] == "synthesis"


def test_suggestion_emission_excludes_self_and_no_ops_on_empty_sources() -> None:
    component = _make_component()
    page = _make_page()
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        unconfirmed=[component],  # only self -- must be excluded, zero INFERRED edges
        unselected_candidates=[],
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    inferred_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("tier") == "INFERRED"]
    ambiguous_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("tier") == "AMBIGUOUS"]
    assert not inferred_calls
    assert not ambiguous_calls


def test_no_suggestion_edge_is_ever_extracted_tier() -> None:
    """Hard invariant: every source='synthesis' insert_edge call is INFERRED or AMBIGUOUS, never EXTRACTED."""
    component = _make_component()
    page = _make_page()
    unconfirmed_other = _make_component(component_id="comp-unconfirmed-001")
    candidate = _make_entity_instance(instance_id="ei-candidate-001")
    components, knowledge, entity_instances = _make_ports(
        component=component,
        page=page,
        active_node=None,
        unconfirmed=[unconfirmed_other],
        unselected_candidates=[candidate],
    )

    service = KnowledgeSynthesizerService(components=components, knowledge=knowledge, entity_instances=entity_instances)
    asyncio.run(
        service.synthesize_from_confirmation(
            component_id=_COMP_ID,
            importer_id=_IMPORTER_ID,
            confirmed_record=_make_extraction_record(),
            corrected_fields=None,
        )
    )

    synthesis_calls = [c for c in knowledge.insert_edge.await_args_list if c.kwargs.get("source") == "synthesis"]
    assert len(synthesis_calls) == 2
    for call in synthesis_calls:
        assert call.kwargs["tier"] in ("INFERRED", "AMBIGUOUS")
        assert call.kwargs["tier"] != "EXTRACTED"
