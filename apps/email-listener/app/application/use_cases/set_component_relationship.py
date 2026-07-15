"""Relationship setter use cases — role / entity-type / field-relationship (D-10/D-11).

Architecture contract: imports ONLY domain ports and entities.
No infrastructure imports permitted (verified by lint-imports rule).

Each setter loads the component, applies the tenant-from-component guard (D-18:
importer_id derived from the loaded row, never from the caller), calls a single
ComponentRepository writer, and returns the refreshed Component. Missing
component → ValueError → 404 at the FastAPI boundary.
"""

from __future__ import annotations

from typing import Literal

import structlog

from app.domain.entities.component import Component
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.entity_type_correction_repository import (
    EntityTypeCorrectionRepository,
)

logger = structlog.get_logger(__name__)

# Role allow-list (D-01). None clears the role to unclassified — manual override
# always wins over the AI's guess.
ComponentRole = Literal["entity", "field", "unrelated"]


class SetComponentRoleUseCase:
    """Set or clear a component's role (D-10): entity | field | unrelated | None."""

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_id: str,
        role: ComponentRole | None,
        importer_id: str | None = None,
    ) -> Component:
        """Update the component's role; returns the refreshed Component.

        importer_id (D-18): when None, the tenant is derived from the loaded
        component. When given, a mismatch with the component's importer 404s.

        Raises:
            ValueError: if the component cannot be found (or tenant mismatch).
        """
        log = logger.bind(component_id=component_id, role=role)
        log.info("set_component_role_start")

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("set_component_role_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        # D-18: derive tenant from the component row; explicit mismatch 404s.
        if importer_id is not None and component.importer_id != importer_id:
            log.warning("set_component_role_component_importer_mismatch")
            raise ValueError(f"Component not found: {component_id}")

        updated = await self._components.update_role(component_id, role)
        log.info("set_component_role_done")
        return updated


class SetComponentEntityTypeUseCase:
    """Set or clear a component's entity_type_id (D-03/D-11).

    LEARN-01 (Phase 57): a genuine reclassification (a prior entity_type_id
    existed AND differs from the new one) is captured as a durable
    entity_type_corrections row BEFORE the mutation (D-16 load-before-mutate
    idiom). Capture is best-effort — mirrors ConfirmRegionUseCase's synthesis
    hook (confirm_region.py): a capture failure must never block the human's
    reclassification from taking effect. First-time classification (None ->
    X), a no-op (X -> X), and a clear (X -> None) are NOT captured — only a
    genuine correction is (A3). Suggest-only invariant: this is pure
    audit-trail capture of a decision the human already made via this same
    setter; no new automated decision is introduced, and extraction_status is
    never touched here.
    """

    def __init__(
        self,
        *,
        components: ComponentRepository,
        corrections: EntityTypeCorrectionRepository | None = None,
    ) -> None:
        self._components = components
        self._corrections = corrections

    async def execute(
        self,
        *,
        component_id: str,
        entity_type_id: str | None,
        importer_id: str | None = None,
    ) -> Component:
        """Update the component's entity_type_id; returns the refreshed Component.

        importer_id (D-18): when None, the tenant is derived from the loaded
        component. When given, a mismatch with the component's importer 404s.

        Raises:
            ValueError: if the component cannot be found (or tenant mismatch).
        """
        log = logger.bind(component_id=component_id, entity_type_id=entity_type_id)
        log.info("set_component_entity_type_start")

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("set_component_entity_type_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        if importer_id is not None and component.importer_id != importer_id:
            log.warning("set_component_entity_type_component_importer_mismatch")
            raise ValueError(f"Component not found: {component_id}")

        # LEARN-01: capture the correction BEFORE mutating (D-16 load-before-
        # mutate). previous_entity_type_id and component_id/importer_id are
        # ALWAYS derived from the loaded component row (D-18), never from
        # caller args. Only a genuine reclassification is captured — a
        # first-time classification (previous is None) or a no-op
        # (previous == new) carries no correction signal (A3), and a clear
        # (new is None) is not a reclassification to a type.
        previous_entity_type_id = component.entity_type_id
        if (
            self._corrections is not None
            and previous_entity_type_id is not None
            and entity_type_id is not None
            and previous_entity_type_id != entity_type_id
        ):
            try:
                await self._corrections.save(
                    component_id=component.id,
                    importer_id=component.importer_id,
                    previous_entity_type_id=previous_entity_type_id,
                    corrected_entity_type_id=entity_type_id,
                )
            except Exception:
                # Best-effort (mirrors confirm_region.py's synthesis hook): a
                # capture failure must never block the human's reclassification.
                log.warning("set_component_entity_type_correction_capture_failed", exc_info=True)

        updated = await self._components.update_entity_type(component_id, entity_type_id)
        log.info("set_component_entity_type_done")
        return updated


class SetComponentFieldRelationshipUseCase:
    """Set or clear a field component's parent + entity_type_field_id (D-04/D-11)."""

    def __init__(self, *, components: ComponentRepository) -> None:
        self._components = components

    async def execute(
        self,
        *,
        component_id: str,
        parent_component_id: str | None,
        entity_type_field_id: str | None,
        importer_id: str | None = None,
    ) -> Component:
        """Set parent_component_id + entity_type_field_id together; returns refreshed.

        Both may be None to clear the field relationship (D-11).

        importer_id (D-18): when None, the tenant is derived from the loaded
        component. When given, a mismatch with the component's importer 404s.

        Raises:
            ValueError: if the component cannot be found (or tenant mismatch).
        """
        log = logger.bind(
            component_id=component_id,
            parent_component_id=parent_component_id,
            entity_type_field_id=entity_type_field_id,
        )
        log.info("set_component_field_relationship_start")

        component = await self._components.find_by_id(component_id)
        if component is None:
            log.warning("set_component_field_relationship_component_not_found")
            raise ValueError(f"Component not found: {component_id}")

        if importer_id is not None and component.importer_id != importer_id:
            log.warning("set_component_field_relationship_component_importer_mismatch")
            raise ValueError(f"Component not found: {component_id}")

        updated = await self._components.update_field_relationship(
            component_id, parent_component_id, entity_type_field_id
        )
        log.info("set_component_field_relationship_done")
        return updated
