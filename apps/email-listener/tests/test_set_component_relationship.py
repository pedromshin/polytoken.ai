"""Tests for SetComponentEntityTypeUseCase's correction-capture hook (Phase 57-01, LEARN-01).

Uses fake ports (in-memory), mirroring test_suggest_entity_types.py's
FakeComponentRepository style. Covers:
  - Genuine reclassification (prior exists AND differs): corrections.save is
    called once with the exact provenance; update_entity_type still applies.
  - First-time classification (None -> X): corrections.save is NOT called.
  - No-op (X -> X): corrections.save is NOT called.
  - Clear (X -> None): corrections.save is NOT called; update_entity_type
    still applies.
  - Best-effort: a corrections.save failure never blocks the reclassification
    (execute() still returns the updated component).
  - Backward compatibility: omitting the corrections collaborator entirely
    (None default) still lets execute() run unchanged.
"""

from __future__ import annotations

import asyncio

from app.application.use_cases.set_component_relationship import (
    SetComponentEntityTypeUseCase,
)
from app.domain.entities.component import Component

EMAIL_ID = "email-abc"
IMPORTER_ID = "imp-001"
COMPONENT_ID = "comp-001"


def _make_component(entity_type_id: str | None) -> Component:
    return Component(
        id=COMPONENT_ID,
        email_id=EMAIL_ID,
        importer_id=IMPORTER_ID,
        attachment_id="att-001",
        parent_component_id=None,
        source_type="region",
        location={},
        content_text="MSCU1234567 container manifest",
        content_markdown=None,
        content_raw=None,
        embedding=None,
        sequence_index=0,
        extraction_status="candidate",
        role="entity",
        entity_type_id=entity_type_id,
    )


class FakeComponentRepository:
    """In-memory component repository tracking update_entity_type calls."""

    def __init__(self, component: Component) -> None:
        self._component = component
        self.entity_type_updates: list[str | None] = []

    async def find_by_id(self, component_id: str) -> Component | None:
        return self._component if component_id == self._component.id else None

    async def update_entity_type(self, component_id: str, entity_type_id: str | None) -> Component:
        self.entity_type_updates.append(entity_type_id)
        updated = Component(
            id=self._component.id,
            email_id=self._component.email_id,
            importer_id=self._component.importer_id,
            attachment_id=self._component.attachment_id,
            parent_component_id=self._component.parent_component_id,
            source_type=self._component.source_type,
            location=self._component.location,
            content_text=self._component.content_text,
            content_markdown=self._component.content_markdown,
            content_raw=self._component.content_raw,
            embedding=self._component.embedding,
            sequence_index=self._component.sequence_index,
            extraction_status=self._component.extraction_status,
            role=self._component.role,
            entity_type_id=entity_type_id,
            entity_type_field_id=self._component.entity_type_field_id,
        )
        self._component = updated
        return updated


class FakeCorrectionRepository:
    """In-memory EntityTypeCorrectionRepository recording save() calls."""

    def __init__(self, raise_on_save: bool = False) -> None:
        self.save_calls: list[dict[str, str]] = []
        self._raise_on_save = raise_on_save

    async def save(
        self,
        *,
        component_id: str,
        importer_id: str,
        previous_entity_type_id: str,
        corrected_entity_type_id: str,
    ) -> None:
        if self._raise_on_save:
            raise RuntimeError("simulated correction-capture failure")
        self.save_calls.append(
            {
                "component_id": component_id,
                "importer_id": importer_id,
                "previous_entity_type_id": previous_entity_type_id,
                "corrected_entity_type_id": corrected_entity_type_id,
            }
        )

    async def find_similar(
        self,
        *,
        query_text: str,
        importer_id: str,
        top_n: int = 3,
    ) -> list[object]:
        return []


class TestGenuineReclassification:
    def test_capture_and_mutation_both_happen(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id="et-A"))
        corrections = FakeCorrectionRepository()
        use_case = SetComponentEntityTypeUseCase(components=components, corrections=corrections)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id="et-B"))

        assert updated.entity_type_id == "et-B"
        assert components.entity_type_updates == ["et-B"]
        assert corrections.save_calls == [
            {
                "component_id": COMPONENT_ID,
                "importer_id": IMPORTER_ID,
                "previous_entity_type_id": "et-A",
                "corrected_entity_type_id": "et-B",
            }
        ]


class TestFirstTimeClassification:
    def test_capture_not_called_when_previous_is_none(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id=None))
        corrections = FakeCorrectionRepository()
        use_case = SetComponentEntityTypeUseCase(components=components, corrections=corrections)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id="et-B"))

        assert updated.entity_type_id == "et-B"
        assert components.entity_type_updates == ["et-B"]
        assert corrections.save_calls == []


class TestNoOp:
    def test_capture_not_called_when_previous_equals_new(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id="et-A"))
        corrections = FakeCorrectionRepository()
        use_case = SetComponentEntityTypeUseCase(components=components, corrections=corrections)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id="et-A"))

        assert updated.entity_type_id == "et-A"
        assert components.entity_type_updates == ["et-A"]
        assert corrections.save_calls == []


class TestClear:
    def test_capture_not_called_on_clear(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id="et-A"))
        corrections = FakeCorrectionRepository()
        use_case = SetComponentEntityTypeUseCase(components=components, corrections=corrections)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id=None))

        assert updated.entity_type_id is None
        assert components.entity_type_updates == [None]
        assert corrections.save_calls == []


class TestBestEffort:
    def test_save_failure_does_not_block_mutation(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id="et-A"))
        corrections = FakeCorrectionRepository(raise_on_save=True)
        use_case = SetComponentEntityTypeUseCase(components=components, corrections=corrections)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id="et-B"))

        assert updated.entity_type_id == "et-B"
        assert components.entity_type_updates == ["et-B"]


class TestBackwardCompatibility:
    def test_execute_without_corrections_collaborator(self) -> None:
        components = FakeComponentRepository(_make_component(entity_type_id="et-A"))
        use_case = SetComponentEntityTypeUseCase(components=components)

        updated = asyncio.run(use_case.execute(component_id=COMPONENT_ID, entity_type_id="et-B"))

        assert updated.entity_type_id == "et-B"
        assert components.entity_type_updates == ["et-B"]
