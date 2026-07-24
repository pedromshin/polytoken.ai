"""SupabaseEntityTypeRepository — implements EntityTypeRepository port.

System entity types have importer_id = NULL. Importer-specific types have
importer_id set. find_by_slug with importer_id=None queries system defaults.

Writes (09-03, D-26/D-27) operate on the system-default scope (importer_id NULL):
create/update entity types + create/update/delete/reorder fields, plus a
confirmed-reference count powering the D-27 delete-guard. is_identifier is
persisted inside the entity_type_fields.config jsonb (not a top-level column,
per the live schema + D-27 Claude's Discretion).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, cast

from postgrest.base_request_builder import CountMethod
from postgrest.exceptions import APIError
from supabase import Client

from app.domain.entities.entity_type import EntityType, EntityTypeField
from app.infrastructure.supabase.sanitize import parse_embedding

# Postgres unique-violation SQLSTATE — surfaced by PostgREST on the
# entity_types_importer_id_slug_unique constraint (D-27 -> 409).
_UNIQUE_VIOLATION = "23505"
_SLUG_EXISTS_MARKER = "slug exists"


def _field_is_active(row: dict[str, Any]) -> bool:
    """A field is active unless its config jsonb explicitly sets is_active=False.

    deactivate_field (D-27) soft-deactivates by writing config.is_active=False;
    that row must be excluded from the active read paths so it never leaks into
    EntityType.fields (autofill system prompt + management UI) — while the row
    itself survives to preserve the D-04 FK for confirmed components.
    """
    config = row.get("config") or {}
    return config.get("is_active", True) is not False


def _field_from_row(row: dict[str, Any]) -> EntityTypeField:
    # DB→domain mapping (matches migration 0000 / packages/db entity-types schema):
    #   id is the uuid PK (the D-04 FK target); field_type column → data_type;
    #   is_identifier lives in the config jsonb, not a top-level column. Defaults
    #   mirror the schema (.default("string")/0/false).
    config = row.get("config") or {}
    return EntityTypeField(
        id=row["id"],
        slug=row["slug"],
        label=row["label"],
        data_type=row.get("field_type", "string"),
        is_identifier=bool(config.get("is_identifier", False)),
        is_required=bool(row.get("is_required", False)),
        description=row.get("description"),
        sort_order=int(row.get("sort_order", 0)),
    )


def _from_row(row: dict[str, Any]) -> EntityType:
    embedding = parse_embedding(row.get("embedding"))
    raw_fields = row.get("entity_type_fields") or []
    # CRIT-2 (D-27): drop soft-deactivated fields from the active schema view.
    fields = tuple(_field_from_row(f) for f in raw_fields if _field_is_active(f))
    return EntityType(
        id=row["id"],
        importer_id=row.get("importer_id"),
        slug=row["slug"],
        label=row["label"],
        description=row.get("description"),
        is_active=row["is_active"],
        embedding=embedding,
        fields=fields,
    )


def _merged_config(existing: dict[str, Any] | None, is_identifier: bool) -> dict[str, Any]:
    """Return a new config dict with is_identifier set (immutable, never mutates input)."""
    base = dict(existing or {})
    return {**base, "is_identifier": is_identifier}


def _build_field_patch(
    *,
    slug: str | None,
    label: str | None,
    field_type: str | None,
    is_required: bool | None,
    sort_order: int | None,
    description: str | None,
) -> dict[str, Any]:
    """Collect the non-None scalar field columns into an update patch (no jsonb)."""
    candidates: dict[str, Any] = {
        "slug": slug,
        "label": label,
        "field_type": field_type,
        "is_required": is_required,
        "sort_order": sort_order,
        "description": description,
    }
    return {key: value for key, value in candidates.items() if value is not None}


class SupabaseEntityTypeRepository:
    """Supabase implementation of EntityTypeRepository."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def find_by_slug(self, importer_id: str | None, slug: str) -> EntityType | None:
        """Return entity type matching (importer_id, slug). None importer_id = system default."""
        query = (
            self._client.table("entity_types").select("*, entity_type_fields(*)").eq("slug", slug).eq("is_active", True)
        )
        query = query.is_("importer_id", None) if importer_id is None else query.eq("importer_id", importer_id)

        result = await asyncio.to_thread(query.execute)
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_id(self, entity_type_id: str) -> EntityType | None:
        """Return the entity type with the given id (+ its field schema), or None.

        Id is a global primary key (not importer-scoped); tenant isolation is
        enforced on the component row that carries the entity_type_id (D-18).
        """
        result = await asyncio.to_thread(
            lambda: (
                self._client.table("entity_types")
                .select("*, entity_type_fields(*)")
                .eq("id", entity_type_id)
                .execute()
            )
        )
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_entity_type_by_id(self, entity_type_id: str) -> EntityType | None:
        """Alias of find_by_id (09-03 plan naming) — load an entity type before a write."""
        return await self.find_by_id(entity_type_id)

    async def find_entity_type_by_field_id(self, field_id: str) -> EntityType | None:
        """Resolve the EntityType that owns the given field id (WR-03), or None."""
        row = await self._find_field_row(field_id)
        if row is None:
            return None
        entity_type_id = row.get("entity_type_id")
        if not entity_type_id:
            return None
        return await self.find_by_id(str(entity_type_id))

    async def list_active(self, importer_id: str | None) -> list[EntityType]:
        """Return all active entity types visible to importer (system + importer-specific)."""
        query = self._client.table("entity_types").select("*, entity_type_fields(*)").eq("is_active", True)
        query = query.is_("importer_id", None) if importer_id is None else query.eq("importer_id", importer_id)

        result = await asyncio.to_thread(query.execute)
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    # ── Writes (09-03, D-26/D-27) ────────────────────────────────────────────

    async def create_entity_type(
        self,
        *,
        slug: str,
        label: str,
        description: str | None = None,
    ) -> EntityType:
        """Insert a new system-default entity type (importer_id NULL, active, config {})."""
        payload: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "importer_id": None,
            "slug": slug,
            "label": label,
            "description": description,
            "config": {},
            "is_active": True,
        }
        try:
            result = await asyncio.to_thread(lambda: self._client.table("entity_types").insert(payload).execute())
        except APIError as exc:
            if exc.code == _UNIQUE_VIOLATION:
                raise ValueError(f"entity type {_SLUG_EXISTS_MARKER}: {slug}") from exc
            raise
        return await self._refresh_entity_type(cast("dict[str, Any]", result.data[0])["id"])

    async def update_entity_type(
        self,
        entity_type_id: str,
        *,
        label: str | None = None,
        description: str | None = None,
        is_active: bool | None = None,
    ) -> EntityType:
        """Partially update an entity type; return the refreshed EntityType."""
        patch: dict[str, Any] = {}
        if label is not None:
            patch["label"] = label
        if description is not None:
            patch["description"] = description
        if is_active is not None:
            patch["is_active"] = is_active

        if patch:
            result = await asyncio.to_thread(
                lambda: self._client.table("entity_types").update(patch).eq("id", entity_type_id).execute()
            )
            if not result.data:
                raise ValueError(f"EntityType not found: {entity_type_id}")

        refreshed = await self.find_by_id(entity_type_id)
        if refreshed is None:
            raise ValueError(f"EntityType not found: {entity_type_id}")
        return refreshed

    async def create_field(
        self,
        entity_type_id: str,
        *,
        slug: str,
        label: str,
        field_type: str,
        is_required: bool = False,
        sort_order: int = 0,
        is_identifier: bool = False,
        description: str | None = None,
    ) -> EntityTypeField:
        """Insert a new field on an entity type (is_identifier into config jsonb)."""
        payload: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "entity_type_id": entity_type_id,
            "importer_id": None,
            "slug": slug,
            "label": label,
            "description": description,
            "field_type": field_type,
            "is_required": is_required,
            "sort_order": sort_order,
            "config": {"is_identifier": is_identifier},
        }
        try:
            result = await asyncio.to_thread(lambda: self._client.table("entity_type_fields").insert(payload).execute())
        except APIError as exc:
            if exc.code == _UNIQUE_VIOLATION:
                raise ValueError(f"field {_SLUG_EXISTS_MARKER}: {slug}") from exc
            raise
        return _field_from_row(cast("dict[str, Any]", result.data[0]))

    async def update_field(
        self,
        field_id: str,
        *,
        slug: str | None = None,
        label: str | None = None,
        field_type: str | None = None,
        is_required: bool | None = None,
        sort_order: int | None = None,
        is_identifier: bool | None = None,
        description: str | None = None,
    ) -> EntityTypeField:
        """Partially update a field row (is_identifier maps into config jsonb)."""
        patch = _build_field_patch(
            slug=slug,
            label=label,
            field_type=field_type,
            is_required=is_required,
            sort_order=sort_order,
            description=description,
        )
        if is_identifier is not None:
            existing = await self._find_field_row(field_id)
            if existing is None:
                raise ValueError(f"EntityTypeField not found: {field_id}")
            patch["config"] = _merged_config(existing.get("config"), is_identifier)

        if patch:
            try:
                result = await asyncio.to_thread(
                    lambda: self._client.table("entity_type_fields").update(patch).eq("id", field_id).execute()
                )
            except APIError as exc:
                if exc.code == _UNIQUE_VIOLATION:
                    raise ValueError(f"field {_SLUG_EXISTS_MARKER}: {slug}") from exc
                raise
            if not result.data:
                raise ValueError(f"EntityTypeField not found: {field_id}")

        row = await self._find_field_row(field_id)
        if row is None:
            raise ValueError(f"EntityTypeField not found: {field_id}")
        return _field_from_row(row)

    async def deactivate_field(self, field_id: str) -> EntityTypeField:
        """Soft-deactivate a field (config.is_active = False) — keeps the D-04 FK intact."""
        existing = await self._find_field_row(field_id)
        if existing is None:
            raise ValueError(f"EntityTypeField not found: {field_id}")
        config = {**dict(existing.get("config") or {}), "is_active": False}
        result = await asyncio.to_thread(
            lambda: self._client.table("entity_type_fields").update({"config": config}).eq("id", field_id).execute()
        )
        if not result.data:
            raise ValueError(f"EntityTypeField not found: {field_id}")
        return _field_from_row(cast("dict[str, Any]", result.data[0]))

    async def delete_field(self, field_id: str) -> None:
        """Hard-delete a field row (caller guarantees zero confirmed references)."""
        await asyncio.to_thread(
            lambda: self._client.table("entity_type_fields").delete().eq("id", field_id).execute()
        )

    async def reorder_fields(self, entity_type_id: str, ordered_field_ids: list[str]) -> None:
        """Set sort_order = position for each id in the given order (one update per id)."""
        for position, field_id in enumerate(ordered_field_ids):
            query = (
                self._client.table("entity_type_fields")
                .update({"sort_order": position})
                .eq("id", field_id)
                .eq("entity_type_id", entity_type_id)
            )
            await asyncio.to_thread(query.execute)

    async def count_confirmed_references(self, field_id: str) -> int:
        """Count confirmed components referencing this field (D-27 delete-guard)."""
        result = await asyncio.to_thread(
            lambda: (
                self._client.table("email_components")
                .select("id", count=CountMethod.exact)
                .eq("entity_type_field_id", field_id)
                .eq("extraction_status", "confirmed")
                .execute()
            )
        )
        return int(result.count or 0)

    # ── Internal helpers ─────────────────────────────────────────────────────

    async def _refresh_entity_type(self, entity_type_id: str) -> EntityType:
        refreshed = await self.find_by_id(entity_type_id)
        if refreshed is None:
            raise ValueError(f"EntityType not found: {entity_type_id}")
        return refreshed

    async def _find_field_row(self, field_id: str) -> dict[str, Any] | None:
        result = await asyncio.to_thread(
            lambda: self._client.table("entity_type_fields").select("*").eq("id", field_id).execute()
        )
        if not result.data:
            return None
        return cast("dict[str, Any]", result.data[0])
