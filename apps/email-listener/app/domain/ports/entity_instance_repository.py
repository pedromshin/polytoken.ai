"""EntityInstanceRepository port — domain abstraction over entity instance persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.domain.entities.component import Component
    from app.domain.entities.entity_instance import EntityInstance


class EntityInstanceRepository(Protocol):
    """Port for persisting and retrieving EntityInstance domain entities.

    All reads are scoped to source='email_extracted' (D-21 tenant isolation).
    """

    async def find_by_id(self, entity_instance_id: str) -> EntityInstance | None:
        """Return the entity instance with the given id, or None."""
        ...

    async def find_by_importer_and_type(
        self,
        importer_id: str,
        entity_type_id: str,
    ) -> list[EntityInstance]:
        """Return all active instances for the given importer + entity type."""
        ...

    async def upsert(self, entity_instance: EntityInstance) -> EntityInstance:
        """Insert or update an entity instance row; returns the persisted entity."""
        ...

    async def record_candidate_link(
        self,
        component_id: str,
        entity_instance_id: str,
        entity_type_id: str,
        match_type: str,
        similarity_score: float,
        was_selected: bool = False,
    ) -> None:
        """Upsert a row in component_entity_candidate_links (D-09 provenance).

        entity_type_id is required — the table column is NOT NULL; it is the
        entity type shared by the source component and its same-type candidates.
        was_selected defaults False for duplicate-candidate provenance; pass
        True when recording occurrence links for confirmed field children
        (the field child IS the identity assignment, not a duplicate suggestion).
        Conflicts on (component_id, entity_instance_id) update match_type,
        similarity_score, and was_selected in place.
        """
        ...

    async def mark_candidate_selected(
        self,
        component_id: str,
        entity_instance_id: str,
    ) -> None:
        """Set was_selected=True for the winning candidate link (D-09)."""
        ...

    async def append_alias(
        self,
        entity_instance_id: str,
        alias: str,
    ) -> None:
        """Append alias to the entity instance's aliases array if not present (D-11)."""
        ...

    async def list_confirmed_entity_components(
        self,
        importer_id: str,
    ) -> list[Component]:
        """Return confirmed role='entity' components for this importer (D-10 backfill)."""
        ...

    async def find_confirmed_field_children(
        self,
        parent_component_id: str,
    ) -> list[Component]:
        """Return confirmed role='field' children of the given entity component.

        Filters to: parent_component_id = <given id>, role='field',
        extraction_status='confirmed', entity_type_field_id IS NOT NULL.
        Used by PromoteEntityOnConfirmUseCase to build occurrence links,
        identifiers, and display_name from the field child values.
        """
        ...

    async def select_candidate_link(
        self,
        *,
        entity_instance_id: str,
        target_id: str,
    ) -> None:
        """Set was_selected=True on the candidate link between two entity instances (D-09).

        Called by ConfirmMergeUseCase to record the human decision in the
        component_entity_candidate_links provenance table.
        """
        ...

    async def dismiss_candidate_link(
        self,
        *,
        entity_instance_id: str,
        target_id: str,
    ) -> None:
        """Mark the candidate link as durably dismissed (D-20 reject).

        The row is retained for audit but flagged so it is not re-surfaced as
        a suggestion in future resolution passes.
        """
        ...

    async def find_confirmed_entity_components_for_email(
        self,
        email_id: str,
    ) -> list[Component]:
        """Return confirmed role='entity' components for this email (co-occurrence source).

        Filters: email_id = <given id>, role='entity', extraction_status='confirmed'.
        Deliberately email-scoped (not importer-scoped like list_confirmed_entity_components)
        because co-occurrence means "confirmed in the same email" per CONTEXT.md. Used by
        KnowledgeSynthesizerService to derive co_occurs_with edges from a confirmed region
        to the other confirmed entity components in the same email.
        """
        ...

    async def find_selected_instance_for_component(
        self,
        component_id: str,
    ) -> EntityInstance | None:
        """Return the selected entity instance linked to this component, or None.

        Reads component_entity_candidate_links where component_id = <given id> and
        was_selected = True, then resolves the winning entity_instance_id. Returns None
        when no selected link exists -- this is the expected first-confirm case, since
        PromoteEntityOnConfirmUseCase (which writes the selected link) runs AFTER
        ConfirmRegionUseCase/KnowledgeSynthesizerService in the confirm flow.
        """
        ...

    async def set_merge_state(
        self,
        entity_instance_id: str,
        *,
        merged_into: str | None = None,
        is_active: bool = True,
    ) -> None:
        """Update merge linkage and active state on an entity instance.

        Called by ConfirmMergeUseCase (mark target inactive, set merged_into) and
        UnmergeEntityUseCase (reactivate, clear merged_into).
        Supersede-never-mutate: original rows are never deleted.
        Every call scoped to source='email_extracted' (D-21).
        """
        ...
