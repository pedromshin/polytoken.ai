"""ComponentRepository port — domain abstraction over component persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.domain.entities.component import Component


class ComponentRepository(Protocol):
    """Port for persisting and retrieving Component domain entities."""

    async def save_many(self, components: list[Component]) -> list[Component]:
        """Bulk-insert or upsert components; returns the persisted entities."""
        ...

    async def find_by_id(self, component_id: str) -> Component | None:
        """Return the component with the given id, or None."""
        ...

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        """Return all components belonging to the given email."""
        ...

    async def find_unclassified_candidate_regions(self, email_id: str) -> list[Component]:
        """Return the email's UNCLASSIFIED unreviewed regions.

        Server-side filtered to source_type='region', extraction_status IN
        ('pending','candidate'), role IS NULL — so it returns only the regions
        awaiting an entity type, NOT every region component (an email can have
        thousands of region rows, which would exceed the PostgREST 1000-row
        default and silently drop them). 'pending' is the post-propose state that
        auto-classify-on-extraction sees; 'candidate' is post-accept. Used by
        SuggestEntityTypesUseCase.
        """
        ...

    async def update_embedding(self, component_id: str, embedding: tuple[float, ...]) -> None:
        """Persist a computed embedding vector onto a component row."""
        ...

    async def update_status(self, component_id: str, status: str) -> Component:
        """Update extraction_status for the given component; returns refreshed entity."""
        ...

    async def update_parent(self, component_id: str, parent_id: str | None) -> Component:
        """Update parent_component_id for the given component; returns refreshed entity."""
        ...

    async def update_role(self, component_id: str, role: str | None) -> Component:
        """Update the component's role (D-10); returns refreshed entity.

        ``role`` is one of entity|field|unrelated, or None to clear to
        unclassified (D-01). Raises ValueError on no-match.
        """
        ...

    async def update_entity_type(self, component_id: str, entity_type_id: str | None) -> Component:
        """Update entity_type_id for the given component (D-03); returns refreshed entity.

        ``entity_type_id`` may be None to clear. Raises ValueError on no-match.
        """
        ...

    async def update_field_relationship(
        self,
        component_id: str,
        parent_component_id: str | None,
        entity_type_field_id: str | None,
    ) -> Component:
        """Set parent_component_id + entity_type_field_id together (D-04, D-11).

        Both may be None to clear the field relationship. Raises ValueError on
        no-match.
        """
        ...

    async def clear_candidate_fields(self, component_id: str) -> Component:
        """Clear entity_type_field_id on a user-drawn field box (D-18 deny path).

        Used by DenyFieldUseCase to revert a user-drawn field to
        unclassified-with-geometry. Raises ValueError on no-match.
        """
        ...

    async def append_denied_polygon(self, component_id: str, polygon: list[list[float]]) -> None:
        """Atomically append a denied polygon to content_raw.denied_field_polygons (D-19).

        MEDIUM-4: a single targeted UPDATE (server-side jsonb append) — never a
        full-row read-modify-write — so concurrent denies do not lose entries.
        ``component_id`` is the PARENT entity component whose D-19 memo is grown.
        No-op (no raise) when the component does not exist; the caller has already
        verified the parent before recording the memo.
        """
        ...

    async def find_by_page_component_id(self, page_component_id: str) -> list[Component]:
        """Return all components whose parent_component_id equals page_component_id."""
        ...

    async def find_pages_by_attachment(self, attachment_id: str) -> list[Component]:
        """Return the attachment_page components for the given attachment.

        Queried by attachment_id directly (not via the email) so it is not
        affected by the per-email row cap when an email has many components.
        """
        ...

    async def latest_component_created_at(self, email_id: str) -> str | None:
        """Return the newest created_at among the email's components, or None.

        The value is the DB's own row timestamp (ISO-8601 string as stored),
        NOT an app-server clock reading — used to derive a clock-skew-free
        cutoff for supersede_pending_regions.
        """
        ...

    async def supersede_pending_regions(self, email_id: str, *, created_before: str | None = None) -> int:
        """Mark the email's auto-proposed (pending) region components as superseded.

        Single bulk update — scales past the per-row row cap. Only source_type
        'region' rows with extraction_status 'pending' are affected; human-touched
        regions (candidate/confirmed/rejected) and page components are untouched.

        created_before: optional INCLUSIVE upper bound on created_at (a DB row
        timestamp, e.g. from latest_component_created_at). When provided, only
        rows with created_at <= created_before are superseded, so regions
        inserted concurrently AFTER the cutoff snapshot are never eaten. The
        bound is inclusive because rows written in one save_many batch share a
        single statement timestamp — a strict bound would skip the newest batch
        entirely. When None, all pending regions are superseded (legacy scope).

        Returns the number of rows superseded.
        """
        ...
