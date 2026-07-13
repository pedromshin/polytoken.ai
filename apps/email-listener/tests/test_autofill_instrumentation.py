"""Tests for AutofillUseCase's best-effort retrieval-event instrumentation (RECALL-02, Phase 31-02).

Uses an AsyncMock port for AutofillRetrievalEventRepository — proves exactly one
`save` call per `execute`, with seed/injection fields matching the run, and that
a raising `save` never breaks `execute` (best-effort isolation, T-31-04).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.domain.entities.component import Component
from app.domain.entities.entity_instance import EntityInstance
from app.domain.entities.entity_type import EntityType, EntityTypeField
from app.domain.ports.autofill_protocol import AutofillResult
from app.domain.ports.retrieval_port import RetrievedExample

IMPORTER_ID = "imp-001"
NOW = datetime(2026, 6, 12, 12, 0, 0, tzinfo=UTC)

FIELD_A = EntityTypeField(
    id="efield-001",
    slug="vendor_name",
    label="Vendor Name",
    data_type="string",
    is_identifier=False,
    is_required=True,
    description="Name of the vendor",
    sort_order=0,
)
ENTITY_TYPE = EntityType(
    id="et-001",
    importer_id=None,
    slug="invoice",
    label="Invoice",
    description="A tax invoice from a vendor",
    is_active=True,
    embedding=None,
    fields=(FIELD_A,),
)

COMPONENT = Component(
    id="comp-001",
    email_id="email-001",
    importer_id=IMPORTER_ID,
    attachment_id="att-001",
    parent_component_id=None,
    source_type="region",
    location={"page_index": 0},
    content_text="Acme Corp Invoice INV-001 Total: $100",
    content_markdown=None,
    content_raw=None,
    embedding=None,
    sequence_index=0,
    extraction_status="pending",
)

ENTITY_INSTANCE = EntityInstance(
    id="ei-001",
    importer_id=IMPORTER_ID,
    entity_type_id="et-001",
    nauta_id=None,
    source="email_extracted",
    display_name="Acme Corp",
    identifiers={"tax_id": "12-3456789"},
    aliases=["Acme", "ACME Corp"],
    summary_text=None,
    embedding=None,
    is_active=True,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeComponentRepository:
    def __init__(self, component: Component | None = COMPONENT) -> None:
        self._component = component

    async def find_by_id(self, component_id: str) -> Component | None:
        if self._component and self._component.id == component_id:
            return self._component
        return None

    async def save_many(self, components: list[Component]) -> list[Component]:
        return components

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        return []

    async def update_embedding(self, component_id: str, embedding: tuple[float, ...]) -> None:
        pass


class FakeEntityTypeRepository:
    def __init__(self, entity_type: EntityType | None = ENTITY_TYPE) -> None:
        self._entity_type = entity_type

    async def find_by_slug(self, importer_id: str | None, slug: str) -> EntityType | None:
        if self._entity_type and self._entity_type.slug == slug:
            return self._entity_type
        return None

    async def list_active(self, importer_id: str | None) -> list[EntityType]:
        return []


class FakeExtractionRepository:
    def __init__(self) -> None:
        self.saved: list[object] = []

    async def save(self, record: object) -> object:
        self.saved.append(record)
        return record

    async def find_by_component_id(self, component_id: str) -> list[object]:
        return []

    async def supersede_active(self, component_id: str) -> None:
        pass


class FakeAutofiller:
    def __init__(self, result: AutofillResult) -> None:
        self._result = result

    async def autofill(
        self,
        *,
        region_text: str,
        entity_type: EntityType,
        knowledge_base_text: str,
        examples: tuple[dict[str, object], ...] = (),
        entity_context: dict[str, object] | None = None,
    ) -> AutofillResult:
        return self._result


class FakeEmbedder:
    async def embed(self, *, text: str) -> tuple[float, ...]:
        return (0.1, 0.2, 0.3)


class FakeRetrieval:
    def __init__(self, examples: list[RetrievedExample]) -> None:
        self._examples = examples

    async def find_similar_confirmed(
        self,
        *,
        component_embedding: tuple[float, ...],
        entity_type_id: str,
        importer_id: str,
        key_terms: tuple[str, ...],
        top_n: int = 3,
    ) -> list[RetrievedExample]:
        return self._examples


class FakeEntityInstanceRepository:
    """Returns a fixed selected instance (or none) for entity-context resolution."""

    def __init__(self, instance: EntityInstance | None = None) -> None:
        self._instance = instance

    async def find_selected_instance_for_component(self, component_id: str) -> EntityInstance | None:
        return self._instance

    async def find_unselected_candidate_instances_for_component(self, component_id: str) -> list[EntityInstance]:
        return []


def _make_use_case(
    *,
    retrieval: FakeRetrieval | None,
    entity_instances: FakeEntityInstanceRepository | None,
    retrieval_events: object,
    embedder: FakeEmbedder | None = None,
):
    from app.application.use_cases.autofill import AutofillUseCase

    return AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=FakeAutofiller(result=AutofillResult({"vendor_name": "Acme"}, 0.9, None)),
        embedder=embedder or (FakeEmbedder() if retrieval is not None else None),
        retrieval=retrieval,
        entity_instances=entity_instances,
        retrieval_events=retrieval_events,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_execute_saves_exactly_one_retrieval_event_few_shot_case() -> None:
    """Few-shot run: save() is called once with seed hits + injected context + routing_reason."""
    examples = [
        RetrievedExample(component_id="comp-src-1", content_text="foo", extracted_fields={}, score=0.9),
        RetrievedExample(component_id="comp-src-2", content_text="bar", extracted_fields={}, score=0.7),
    ]
    retrieval_events = AsyncMock()
    use_case = _make_use_case(
        retrieval=FakeRetrieval(examples),
        entity_instances=FakeEntityInstanceRepository(ENTITY_INSTANCE),
        retrieval_events=retrieval_events,
    )

    asyncio.run(use_case.execute(component_id="comp-001", entity_type_slug="invoice", importer_id=IMPORTER_ID))

    retrieval_events.save.assert_awaited_once()
    event = retrieval_events.save.await_args.args[0]
    assert event.component_id == "comp-001"
    assert event.importer_id == IMPORTER_ID
    assert event.entity_type_id == "et-001"
    assert event.seed_hit_count == 2
    assert event.routing_reason == "few_shot_autofill"
    assert event.injected_entity_instance_id == "ei-001"
    assert event.injected_alias_count == 2
    assert event.injected_identifier_count == 1


def test_execute_seed_hits_carry_per_example_score() -> None:
    """seed_hits carries per-example id/score from the retrieved examples."""
    examples = [
        RetrievedExample(component_id="comp-src-1", content_text="foo", extracted_fields={}, score=0.9),
    ]
    retrieval_events = AsyncMock()
    use_case = _make_use_case(
        retrieval=FakeRetrieval(examples),
        entity_instances=FakeEntityInstanceRepository(None),
        retrieval_events=retrieval_events,
    )

    asyncio.run(use_case.execute(component_id="comp-001", entity_type_slug="invoice", importer_id=IMPORTER_ID))

    event = retrieval_events.save.await_args.args[0]
    assert len(event.seed_hits) == 1
    assert event.seed_hits[0]["id"] == "comp-src-1"
    assert event.seed_hits[0]["score"] == 0.9


def test_execute_cold_start_zero_counts() -> None:
    """Cold-start run: seed_hit_count == 0 and injected counts == 0."""
    retrieval_events = AsyncMock()
    use_case = _make_use_case(
        retrieval=None,
        entity_instances=FakeEntityInstanceRepository(None),
        retrieval_events=retrieval_events,
    )

    asyncio.run(use_case.execute(component_id="comp-001", entity_type_slug="invoice", importer_id=IMPORTER_ID))

    retrieval_events.save.assert_awaited_once()
    event = retrieval_events.save.await_args.args[0]
    assert event.seed_hit_count == 0
    assert event.seed_hits == ()
    assert event.injected_entity_instance_id is None
    assert event.injected_alias_count == 0
    assert event.injected_identifier_count == 0
    assert event.routing_reason == "cold_start_autofill"


def test_execute_instrumentation_failure_never_breaks_autofill() -> None:
    """Best-effort isolation: a raising save() does not propagate; execute still returns a result."""
    retrieval_events = AsyncMock()
    retrieval_events.save.side_effect = RuntimeError("db unavailable")
    use_case = _make_use_case(
        retrieval=None,
        entity_instances=FakeEntityInstanceRepository(None),
        retrieval_events=retrieval_events,
    )

    result = asyncio.run(use_case.execute(component_id="comp-001", entity_type_slug="invoice", importer_id=IMPORTER_ID))

    assert result.extracted_fields == {"vendor_name": "Acme"}
    retrieval_events.save.assert_awaited_once()


def test_execute_no_retrieval_events_port_is_a_noop() -> None:
    """When retrieval_events is None (unwired), execute completes without error."""
    use_case = _make_use_case(
        retrieval=None,
        entity_instances=FakeEntityInstanceRepository(None),
        retrieval_events=None,
    )

    result = asyncio.run(use_case.execute(component_id="comp-001", entity_type_slug="invoice", importer_id=IMPORTER_ID))

    assert result.extracted_fields == {"vendor_name": "Acme"}


def test_execute_raises_on_missing_component_without_saving_event() -> None:
    """Unknown component: execute raises before any instrumentation write is attempted."""
    from app.application.use_cases.autofill import AutofillUseCase

    retrieval_events = AsyncMock()
    use_case = AutofillUseCase(
        components=FakeComponentRepository(component=None),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=FakeAutofiller(result=AutofillResult({}, 0.0, None)),
        retrieval_events=retrieval_events,
    )

    with pytest.raises(ValueError, match="Component not found"):
        asyncio.run(
            use_case.execute(component_id="does-not-exist", entity_type_slug="invoice", importer_id=IMPORTER_ID)
        )

    retrieval_events.save.assert_not_awaited()
