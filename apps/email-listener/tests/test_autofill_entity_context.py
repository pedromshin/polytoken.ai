"""Tests for the resolved-entity cheap-recall injection in AutofillUseCase (RECALL-01, Plan 31-01).

Uses AsyncMock-style fake EntityInstanceRepository ports per repo convention.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.domain.entities.component import Component
from app.domain.entities.entity_instance import EntityInstance
from app.domain.entities.entity_type import EntityType, EntityTypeField
from app.domain.entities.extraction_record import ExtractionRecord
from app.domain.ports.autofill_protocol import AutofillResult

IMPORTER_ID = "imp-001"
OTHER_IMPORTER_ID = "imp-other"
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

SELECTED_INSTANCE = EntityInstance(
    id="ent-selected-001",
    importer_id=IMPORTER_ID,
    entity_type_id="et-001",
    nauta_id=None,
    source="email_extracted",
    display_name="Acme Corp",
    identifiers={"tax_id": "12-3456789"},
    aliases=["Acme Corp", "Acme Corporation"],
    summary_text=None,
    embedding=None,
    is_active=True,
)

CANDIDATE_INSTANCE = EntityInstance(
    id="ent-candidate-001",
    importer_id=IMPORTER_ID,
    entity_type_id="et-001",
    nauta_id=None,
    source="email_extracted",
    display_name="Beta Corp",
    identifiers={"tax_id": "98-7654321"},
    aliases=["Beta Corp"],
    summary_text=None,
    embedding=None,
    is_active=True,
)

OTHER_IMPORTER_INSTANCE = EntityInstance(
    id="ent-other-001",
    importer_id=OTHER_IMPORTER_ID,
    entity_type_id="et-001",
    nauta_id=None,
    source="email_extracted",
    display_name="Cross Tenant Corp",
    identifiers={"tax_id": "00-0000000"},
    aliases=["Cross Tenant"],
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
        self.saved: list[ExtractionRecord] = []

    async def save(self, record: ExtractionRecord) -> ExtractionRecord:
        self.saved.append(record)
        return record

    async def find_by_component_id(self, component_id: str) -> list[ExtractionRecord]:
        return []

    async def supersede_active(self, component_id: str) -> None:
        pass


class FakeAutofiller:
    def __init__(self, result: AutofillResult) -> None:
        self._result = result
        self.calls: list[dict[str, object]] = []

    async def autofill(
        self,
        *,
        region_text: str,
        entity_type: EntityType,
        knowledge_base_text: str,
        examples: tuple[dict[str, object], ...] = (),
        entity_context: dict[str, object] | None = None,
    ) -> AutofillResult:
        self.calls.append(
            {
                "region_text": region_text,
                "entity_type": entity_type,
                "knowledge_base_text": knowledge_base_text,
                "examples": examples,
                "entity_context": entity_context,
            }
        )
        return self._result


class FakeEntityInstanceRepository:
    """Fake EntityInstanceRepository — only the two 31-01 recall methods matter here."""

    def __init__(
        self,
        *,
        selected: EntityInstance | None = None,
        candidates: list[EntityInstance] | None = None,
        raises: bool = False,
    ) -> None:
        self._selected = selected
        self._candidates = candidates or []
        self._raises = raises
        self.selected_calls: list[str] = []
        self.candidate_calls: list[str] = []

    async def find_selected_instance_for_component(self, component_id: str) -> EntityInstance | None:
        self.selected_calls.append(component_id)
        if self._raises:
            raise RuntimeError("entity read boom")
        return self._selected

    async def find_unselected_candidate_instances_for_component(self, component_id: str) -> list[EntityInstance]:
        self.candidate_calls.append(component_id)
        if self._raises:
            raise RuntimeError("entity read boom")
        return self._candidates


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_selected_instance_injects_entity_context() -> None:
    """When a selected instance exists, its aliases/identifiers are passed as entity_context."""
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    entity_instances = FakeEntityInstanceRepository(selected=SELECTED_INSTANCE)
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=autofiller,
        entity_instances=entity_instances,
    )

    asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    assert len(autofiller.calls) == 1
    entity_context = autofiller.calls[0]["entity_context"]
    assert entity_context == {
        "aliases": ["Acme Corp", "Acme Corporation"],
        "identifiers": {"tax_id": "12-3456789"},
        "entity_instance_id": "ent-selected-001",
    }
    # Candidate fallback must not be consulted when a selected instance exists.
    assert entity_instances.candidate_calls == []


def test_falls_back_to_top_unselected_candidate() -> None:
    """When no selected instance exists, the top unselected candidate is injected."""
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    entity_instances = FakeEntityInstanceRepository(selected=None, candidates=[CANDIDATE_INSTANCE])
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=autofiller,
        entity_instances=entity_instances,
    )

    asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    entity_context = autofiller.calls[0]["entity_context"]
    assert entity_context == {
        "aliases": ["Beta Corp"],
        "identifiers": {"tax_id": "98-7654321"},
        "entity_instance_id": "ent-candidate-001",
    }


def test_no_resolved_entity_calls_autofiller_without_entity_context() -> None:
    """Neither selected nor candidate resolves => entity_context=None, routing_reason unaffected."""
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    entity_instances = FakeEntityInstanceRepository(selected=None, candidates=[])
    extractions = FakeExtractionRepository()
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=extractions,
        autofiller=autofiller,
        entity_instances=entity_instances,
    )

    asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    assert autofiller.calls[0]["entity_context"] is None
    # examples=() (no embedder/retrieval configured) => cold_start_autofill unaffected by entity read.
    assert extractions.saved[0].routing_reason == "cold_start_autofill"


def test_entity_repo_raises_never_breaks_autofill() -> None:
    """A raising entity_instances repo is swallowed; execute still completes (best-effort)."""
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    entity_instances = FakeEntityInstanceRepository(raises=True)
    extractions = FakeExtractionRepository()
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=extractions,
        autofiller=autofiller,
        entity_instances=entity_instances,
    )

    result = asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    assert isinstance(result, AutofillResult)
    assert len(autofiller.calls) == 1
    assert autofiller.calls[0]["entity_context"] is None
    assert len(extractions.saved) == 1


def test_no_entity_instances_port_omits_entity_context() -> None:
    """When entity_instances is not injected (e.g. legacy caller), entity_context stays None."""
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=autofiller,
    )

    asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    assert autofiller.calls[0]["entity_context"] is None


def test_entity_read_scoped_to_component_never_cross_importer() -> None:
    """Tenant scoping (D-18): the resolved entity read must never inject another importer's instance.

    The fake repo here simulates a correctly-scoped port (it only ever returns
    instances that belong to the component's own resolved importer_id) -- this
    test proves the use case passes through whatever the port resolves without
    ever substituting a foreign importer's instance itself.
    """
    from app.application.use_cases.autofill import AutofillUseCase

    autofiller = FakeAutofiller(result=AutofillResult({}, 0.5, None))
    # A correctly-scoped repo would never return OTHER_IMPORTER_INSTANCE for
    # this component; assert the use case only forwards what is scoped.
    entity_instances = FakeEntityInstanceRepository(selected=SELECTED_INSTANCE)
    use_case = AutofillUseCase(
        components=FakeComponentRepository(),
        entity_types=FakeEntityTypeRepository(),
        extractions=FakeExtractionRepository(),
        autofiller=autofiller,
        entity_instances=entity_instances,
    )

    asyncio.run(
        use_case.execute(
            component_id="comp-001",
            entity_type_slug="invoice",
            importer_id=IMPORTER_ID,
        )
    )

    entity_context = autofiller.calls[0]["entity_context"]
    assert entity_context is not None
    injected_aliases = entity_context["aliases"]
    assert OTHER_IMPORTER_INSTANCE.display_name not in injected_aliases
    # The selected component_id passed through is the component under resolution.
    assert entity_instances.selected_calls == ["comp-001"]
