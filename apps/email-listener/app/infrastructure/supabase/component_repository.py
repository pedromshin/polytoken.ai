"""SupabaseComponentRepository — implements ComponentRepository port."""

from __future__ import annotations

from typing import Any, cast

from supabase import Client

from app.domain.entities.component import Component
from app.infrastructure.supabase.sanitize import parse_embedding, strip_nul


def _to_row(component: Component) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "id": component.id,
                "email_id": component.email_id,
                "importer_id": component.importer_id,
                "attachment_id": component.attachment_id,
                "parent_component_id": component.parent_component_id,
                "source_type": component.source_type,
                "location": component.location,
                "content_text": component.content_text,
                "content_markdown": component.content_markdown,
                "content_raw": component.content_raw,
                "embedding": list(component.embedding) if component.embedding is not None else None,
                "sequence_index": component.sequence_index,
                "extraction_status": component.extraction_status,
                "role": component.role,
                "entity_type_id": component.entity_type_id,
                "entity_type_field_id": component.entity_type_field_id,
            }
        ),
    )


def _from_row(row: dict[str, Any]) -> Component:
    embedding = parse_embedding(row.get("embedding"))
    return Component(
        id=row["id"],
        email_id=row["email_id"],
        importer_id=row["importer_id"],
        attachment_id=row.get("attachment_id"),
        parent_component_id=row.get("parent_component_id"),
        source_type=row["source_type"],
        location=dict(row.get("location") or {}),
        content_text=row["content_text"],
        content_markdown=row.get("content_markdown"),
        content_raw=dict(row["content_raw"]) if row.get("content_raw") else None,
        embedding=embedding,
        sequence_index=row["sequence_index"],
        extraction_status=row["extraction_status"],
        role=row.get("role"),
        entity_type_id=row.get("entity_type_id"),
        entity_type_field_id=row.get("entity_type_field_id"),
    )


class SupabaseComponentRepository:
    """Supabase implementation of ComponentRepository.

    Tenant isolation: reads filtered by importer_id (direct) or email_id
    (already importer-scoped via the emails FK cascade).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def save_many(self, components: list[Component]) -> list[Component]:
        """Bulk upsert components; embedding tuple serialized to list[float]."""
        payload = [_to_row(c) for c in components]
        result = self._client.table("email_components").upsert(payload, on_conflict="id").execute()
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_by_id(self, component_id: str) -> Component | None:
        result = self._client.table("email_components").select("*").eq("id", component_id).execute()
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        result = self._client.table("email_components").select("*").eq("email_id", email_id).execute()
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_unclassified_candidate_regions(self, email_id: str) -> list[Component]:
        """Email's role-less UNREVIEWED regions (server-side filtered; avoids the
        1000-row cap that loading all region components would hit).

        Status is pending OR candidate: freshly-proposed regions arrive 'pending'
        (this is what auto-classify-on-extraction sees), and become 'candidate'
        only after a user accepts them. Either way they are unclassified (role
        IS NULL) and awaiting an entity-type suggestion. Confirmed/rejected/
        superseded regions are excluded."""
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("email_id", email_id)
            .eq("source_type", "region")
            .in_("extraction_status", ["pending", "candidate"])
            .is_("role", "null")
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def update_embedding(self, component_id: str, embedding: tuple[float, ...]) -> None:
        """Persist a computed embedding vector onto a component row (halfvec column)."""
        (self._client.table("email_components").update({"embedding": list(embedding)}).eq("id", component_id).execute())

    async def find_pages_by_attachment(self, attachment_id: str) -> list[Component]:
        """Return the attachment_page components for an attachment (any page)."""
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("attachment_id", attachment_id)
            .eq("source_type", "attachment_page")
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_by_page_component_id(self, page_component_id: str) -> list[Component]:
        """Return all components whose parent_component_id equals page_component_id.

        Fetches a parent's child components — e.g. an entity's FIELD children
        during AutofillFieldsUseCase, or a page's regions. Filtered by
        parent_component_id directly (already importer-scoped via the FK cascade).
        """
        result = (
            self._client.table("email_components").select("*").eq("parent_component_id", page_component_id).execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def latest_component_created_at(self, email_id: str) -> str | None:
        """Newest created_at among the email's components (DB row timestamp).

        Single-row SELECT (order desc + limit 1) — immune to the 1000-row cap.
        Returns the ISO-8601 string exactly as PostgREST serialized it so it can
        be fed straight back into a created_at comparison without any app-side
        clock arithmetic (clock-skew mitigation for supersede_pending_regions).
        """
        result = (
            self._client.table("email_components")
            .select("created_at")
            .eq("email_id", email_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if not result.data:
            return None
        created_at = cast("dict[str, Any]", result.data[0]).get("created_at")
        return str(created_at) if created_at is not None else None

    async def supersede_pending_regions(self, email_id: str, *, created_before: str | None = None) -> int:
        """Bulk-supersede the email's pending (auto-proposed) region components.

        One UPDATE covers every matching row regardless of count (the row cap
        applies to SELECTs, not UPDATEs), so reprocess never loops thousands of
        rows. Human-touched regions (candidate/confirmed/rejected) and page
        components are left untouched.

        created_before (inclusive, DB timestamp): when provided, adds
        created_at <= created_before so rows inserted after the cutoff snapshot
        (e.g. by a concurrent re-ingest) survive. Derived from the DB's own row
        timestamps (latest_component_created_at), never from the app clock.
        """
        query = (
            self._client.table("email_components")
            .update({"extraction_status": "superseded"})
            .eq("email_id", email_id)
            .eq("source_type", "region")
            .eq("extraction_status", "pending")
        )
        if created_before is not None:
            query = query.lte("created_at", created_before)
        result = query.execute()
        return len(result.data)

    async def update_status(self, component_id: str, status: str) -> Component:
        """Update extraction_status for the given component; returns refreshed entity.

        Raises ValueError when no row is matched (component deleted or never existed).
        This prevents IndexError propagating as an unformatted 500 from FastAPI.
        """
        result = (
            self._client.table("email_components")
            .update({"extraction_status": status})
            .eq("id", component_id)
            .execute()
        )
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def update_parent(self, component_id: str, parent_id: str | None) -> Component:
        """Update parent_component_id for the given component; returns refreshed entity.

        Raises ValueError when no row is matched (component deleted or never existed).
        This prevents IndexError propagating as an unformatted 500 from FastAPI.
        """
        result = (
            self._client.table("email_components")
            .update({"parent_component_id": parent_id})
            .eq("id", component_id)
            .execute()
        )
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def update_role(self, component_id: str, role: str | None) -> Component:
        """Update the component's role (D-10); returns refreshed entity.

        Raises ValueError when no row is matched (component deleted or never existed),
        mirroring update_status — prevents IndexError surfacing as an unformatted 500.
        """
        result = self._client.table("email_components").update({"role": role}).eq("id", component_id).execute()
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def update_entity_type(self, component_id: str, entity_type_id: str | None) -> Component:
        """Update entity_type_id for the given component (D-03); returns refreshed entity.

        Raises ValueError when no row is matched.
        """
        result = (
            self._client.table("email_components")
            .update({"entity_type_id": entity_type_id})
            .eq("id", component_id)
            .execute()
        )
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def update_field_relationship(
        self,
        component_id: str,
        parent_component_id: str | None,
        entity_type_field_id: str | None,
    ) -> Component:
        """Set parent_component_id + entity_type_field_id together (D-04, D-11).

        One UPDATE writes both columns. Raises ValueError when no row is matched.
        """
        result = (
            self._client.table("email_components")
            .update(
                {
                    "parent_component_id": parent_component_id,
                    "entity_type_field_id": entity_type_field_id,
                }
            )
            .eq("id", component_id)
            .execute()
        )
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def clear_candidate_fields(self, component_id: str) -> Component:
        """Clear entity_type_field_id on a user-drawn field box (D-18 deny path).

        Raises ValueError when no row is matched.
        """
        result = (
            self._client.table("email_components")
            .update({"entity_type_field_id": None})
            .eq("id", component_id)
            .execute()
        )
        if not result.data:
            raise ValueError(f"Component not found: {component_id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def append_denied_polygon(self, component_id: str, polygon: list[list[float]]) -> None:
        """Atomically append a denied polygon to content_raw.denied_field_polygons (D-19).

        MEDIUM-4: delegates to the append_denied_polygon Postgres function
        (migration 0015) so the append is a single server-side jsonb UPDATE — no
        read-modify-write, so concurrent denies never lose entries. No-op when the
        component does not exist (the use case has already verified the parent).
        """
        self._client.rpc(
            "append_denied_polygon",
            {"p_component_id": component_id, "p_polygon": polygon},
        ).execute()
