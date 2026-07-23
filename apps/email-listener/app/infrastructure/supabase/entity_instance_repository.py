"""SupabaseEntityInstanceRepository — implements EntityInstanceRepository port."""

from __future__ import annotations

from typing import Any, cast

from supabase import Client

from app.domain.entities.component import Component
from app.domain.entities.entity_instance import EntityInstance
from app.infrastructure.supabase.sanitize import parse_embedding, strip_nul

_SOURCE = "email_extracted"


def _to_row(entity: EntityInstance) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "id": entity.id,
                "importer_id": entity.importer_id,
                "entity_type_id": entity.entity_type_id,
                "nauta_id": entity.nauta_id,
                "source": entity.source,
                "display_name": entity.display_name,
                "identifiers": entity.identifiers,
                "aliases": entity.aliases,
                "summary_text": entity.summary_text,
                "embedding": entity.embedding,
                "is_active": entity.is_active,
            }
        ),
    )


def _from_row(row: dict[str, Any]) -> EntityInstance:
    raw_embedding = parse_embedding(row.get("embedding"))
    embedding: list[float] | None = list(raw_embedding) if raw_embedding is not None else None
    return EntityInstance(
        id=row["id"],
        importer_id=row["importer_id"],
        entity_type_id=row["entity_type_id"],
        nauta_id=row.get("nauta_id"),
        source=row.get("source", _SOURCE),
        display_name=row["display_name"],
        identifiers=dict(row.get("identifiers") or {}),
        aliases=list(row.get("aliases") or []),
        summary_text=row.get("summary_text"),
        embedding=embedding,
        is_active=bool(row.get("is_active", True)),
    )


def _from_component_row(row: dict[str, Any]) -> Component:
    """Minimal _from_row for email_components rows returned by backfill query."""
    raw_embedding = parse_embedding(row.get("embedding"))
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
        embedding=raw_embedding,
        sequence_index=row["sequence_index"],
        extraction_status=row["extraction_status"],
        role=row.get("role"),
        entity_type_id=row.get("entity_type_id"),
        entity_type_field_id=row.get("entity_type_field_id"),
    )


class SupabaseEntityInstanceRepository:
    """Supabase implementation of EntityInstanceRepository.

    All reads on entity_instances are scoped to source='email_extracted' (D-21).
    Candidate provenance is written to component_entity_candidate_links (D-09).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def find_by_id(self, entity_instance_id: str) -> EntityInstance | None:
        result = (
            self._client.table("entity_instances")
            .select("*")
            .eq("id", entity_instance_id)
            .eq("source", _SOURCE)
            .execute()
        )
        if not result.data:
            return None
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_importer_and_type(
        self,
        importer_id: str,
        entity_type_id: str,
    ) -> list[EntityInstance]:
        result = (
            self._client.table("entity_instances")
            .select("*")
            .eq("importer_id", importer_id)
            .eq("entity_type_id", entity_type_id)
            .eq("source", _SOURCE)
            .eq("is_active", True)
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def upsert(self, entity: EntityInstance) -> EntityInstance:
        """Insert or update an entity instance; conflicts resolved on id.

        Merge-aware (RES-4): re-promoting an existing entity (e.g. the idempotent
        backfill endpoint re-runs promote for every confirmed component) must not
        clobber curation state. A freshly-built promote payload carries
        aliases=[] and is_active=True, which would otherwise (1) wipe the D-11
        alias flywheel and (2) resurrect a human-merged-away entity. So when a
        row already exists we:
          - union the incoming aliases with the persisted ones (never wipe), and
          - preserve is_active + merged_into when the row was merged away
            (merged_into is set), so a merged duplicate never reappears.
        """
        existing = (
            self._client.table("entity_instances")
            .select("aliases,is_active,merged_into")
            .eq("id", entity.id)
            .eq("source", _SOURCE)
            .execute()
        )

        payload = _to_row(entity)

        if existing.data:
            row = cast("dict[str, Any]", existing.data[0])

            # Preserve the D-11 alias flywheel: union, never overwrite.
            persisted_aliases = list(row.get("aliases") or [])
            merged_aliases = list(persisted_aliases)
            for alias in entity.aliases:
                if alias not in merged_aliases:
                    merged_aliases.append(alias)
            payload["aliases"] = merged_aliases

            # A human-merged-away row (merged_into set) stays merged + inactive:
            # do not let a re-promote resurrect it into the confirmed gallery.
            if row.get("merged_into") is not None:
                payload["is_active"] = bool(row.get("is_active", False))
                payload["merged_into"] = row["merged_into"]

        result = self._client.table("entity_instances").upsert(payload, on_conflict="id").execute()
        if not result.data:
            raise ValueError(f"EntityInstance upsert returned no data: {entity.id}")
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def record_candidate_link(
        self,
        component_id: str,
        entity_instance_id: str,
        entity_type_id: str,
        match_type: str,
        similarity_score: float,
        was_selected: bool = False,
    ) -> None:
        """Upsert a candidate provenance row (D-09).

        Conflicts on (component_id, entity_instance_id) — update scores and
        was_selected in place. entity_type_id is required (column is NOT NULL).
        was_selected defaults False for duplicate-suggestion links; pass True
        for occurrence links from confirmed field children.
        """
        payload: dict[str, Any] = {
            "component_id": component_id,
            "entity_instance_id": entity_instance_id,
            "entity_type_id": entity_type_id,
            "match_type": match_type,
            "similarity_score": similarity_score,
            "was_selected": was_selected,
        }
        (
            self._client.table("component_entity_candidate_links")
            .upsert(payload, on_conflict="component_id,entity_instance_id")
            .execute()
        )

    async def mark_candidate_selected(
        self,
        component_id: str,
        entity_instance_id: str,
    ) -> None:
        """Set was_selected=True for the winning candidate link (D-09)."""
        (
            self._client.table("component_entity_candidate_links")
            .update({"was_selected": True})
            .eq("component_id", component_id)
            .eq("entity_instance_id", entity_instance_id)
            .execute()
        )

    async def append_alias(
        self,
        entity_instance_id: str,
        alias: str,
    ) -> None:
        """Append alias to aliases array if not already present (D-11 flywheel).

        Uses a targeted server-side array_append so concurrent appends from
        parallel confirms do not race on a full read-modify-write cycle.
        """
        existing = await self.find_by_id(entity_instance_id)
        if existing is None:
            return
        if alias in existing.aliases:
            return
        new_aliases = [*existing.aliases, alias]
        (
            self._client.table("entity_instances")
            .update({"aliases": new_aliases})
            .eq("id", entity_instance_id)
            .eq("source", _SOURCE)
            .execute()
        )

    async def remove_alias(
        self,
        entity_instance_id: str,
        alias: str,
    ) -> None:
        """Remove alias from the aliases array if present (unmerge — inverse of append).

        No-op when the row does not exist or the alias is absent. Scoped to
        source='email_extracted' (D-21).
        """
        existing = await self.find_by_id(entity_instance_id)
        if existing is None:
            return
        if alias not in existing.aliases:
            return
        new_aliases = [a for a in existing.aliases if a != alias]
        (
            self._client.table("entity_instances")
            .update({"aliases": new_aliases})
            .eq("id", entity_instance_id)
            .eq("source", _SOURCE)
            .execute()
        )

    async def find_merged_children(
        self,
        entity_instance_id: str,
    ) -> list[EntityInstance]:
        """Return entity instances merged INTO the given survivor (RES-2 unmerge).

        Rows where merged_into == entity_instance_id, scoped to
        source='email_extracted' (D-21). Empty when the id is not a survivor.
        """
        result = (
            self._client.table("entity_instances")
            .select("*")
            .eq("merged_into", entity_instance_id)
            .eq("source", _SOURCE)
            .execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def list_confirmed_entity_components(
        self,
        importer_id: str,
    ) -> list[Component]:
        """Return confirmed role='entity' components for backfill (D-10)."""
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("importer_id", importer_id)
            .eq("role", "entity")
            .eq("extraction_status", "confirmed")
            .execute()
        )
        return [_from_component_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_confirmed_field_children(
        self,
        parent_component_id: str,
    ) -> list[Component]:
        """Return confirmed role='field' children with a mapped entity_type_field_id.

        Filters: parent_component_id = <given id>, role='field',
        extraction_status='confirmed', entity_type_field_id not null.
        Used by PromoteEntityOnConfirmUseCase to build occurrence links,
        identifiers, and display_name from the confirmed field values.
        """
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("parent_component_id", parent_component_id)
            .eq("role", "field")
            .eq("extraction_status", "confirmed")
            .not_.is_("entity_type_field_id", "null")
            .execute()
        )
        return [_from_component_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_confirmed_entity_components_for_email(
        self,
        email_id: str,
    ) -> list[Component]:
        """Return confirmed role='entity' components for this email (co-occurrence source).

        Deliberately email-scoped (not importer-scoped like list_confirmed_entity_components)
        because co-occurrence means "confirmed in the same email".
        """
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("email_id", email_id)
            .eq("role", "entity")
            .eq("extraction_status", "confirmed")
            .execute()
        )
        return [_from_component_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_selected_instance_for_component(
        self,
        component_id: str,
    ) -> EntityInstance | None:
        """Return the selected entity instance linked to this component, or None.

        Reads component_entity_candidate_links for the winning (was_selected=True) link.
        None is expected on first confirm, since PromoteEntityOnConfirmUseCase (which
        writes the selected link) runs after the synthesizer in the confirm flow.
        """
        result = (
            self._client.table("component_entity_candidate_links")
            .select("*")
            .eq("component_id", component_id)
            .eq("was_selected", True)
            .execute()
        )
        if not result.data:
            return None
        entity_instance_id = cast("dict[str, Any]", result.data[0])["entity_instance_id"]
        return await self.find_by_id(cast("str", entity_instance_id))

    async def find_unconfirmed_entity_components_for_email(
        self,
        email_id: str,
    ) -> list[Component]:
        """Return NOT-yet-confirmed role='entity' components for this email (INFERRED source).

        Deterministic, LLM-free co-occurrence signal: components sharing the email that have
        not themselves been confirmed yet.
        """
        result = (
            self._client.table("email_components")
            .select("*")
            .eq("email_id", email_id)
            .eq("role", "entity")
            .neq("extraction_status", "confirmed")
            .execute()
        )
        return [_from_component_row(cast("dict[str, Any]", row)) for row in result.data]

    async def find_unselected_candidate_instances_for_component(
        self,
        component_id: str,
    ) -> list[EntityInstance]:
        """Return non-selected candidate entity instances for this component (AMBIGUOUS source).

        Reads component_entity_candidate_links for was_selected=False links, resolves each
        entity_instance_id, and drops any that fail to resolve.
        """
        result = (
            self._client.table("component_entity_candidate_links")
            .select("*")
            .eq("component_id", component_id)
            .eq("was_selected", False)
            .execute()
        )
        instances: list[EntityInstance] = []
        for row in result.data:
            entity_instance_id = cast("dict[str, Any]", row)["entity_instance_id"]
            instance = await self.find_by_id(cast("str", entity_instance_id))
            if instance is not None:
                instances.append(instance)
        return instances

    async def _email_component_ids_for_entity(self, entity_instance_id: str) -> list[str]:
        """Return the ids of all email_components sharing the entity's email.

        A duplicate suggestion in component_entity_candidate_links is keyed by
        component_id — a NOT NULL FK to email_components.id — NOT by an entity id
        (RES-1: an entity id can never equal a component id, so filtering on
        component_id=<entity id> matches zero rows). Promote writes each dedup
        suggestion as (component_id=<subject's source component>, entity_instance_id
        =<candidate>). To act on those rows for a given subject entity we must
        resolve the subject back to its email's components — exactly how the web
        pendingSuggestions query scopes a suggestion (by shared email).

        Resolution: find a candidate-link row referencing this entity to locate a
        component in its email, read that component's email_id, then return every
        component in that email. Empty when the entity has no links yet.
        """
        link_result = (
            self._client.table("component_entity_candidate_links")
            .select("component_id")
            .eq("entity_instance_id", entity_instance_id)
            .execute()
        )
        component_ids = [
            cast("dict[str, Any]", row)["component_id"]
            for row in link_result.data
            if cast("dict[str, Any]", row).get("component_id") is not None
        ]
        if not component_ids:
            return []

        comp_result = (
            self._client.table("email_components")
            .select("email_id")
            .in_("id", component_ids)
            .execute()
        )
        email_ids = {
            cast("dict[str, Any]", row)["email_id"]
            for row in comp_result.data
            if cast("dict[str, Any]", row).get("email_id") is not None
        }
        if not email_ids:
            return []

        all_result = (
            self._client.table("email_components")
            .select("id")
            .in_("email_id", sorted(email_ids))
            .execute()
        )
        return [cast("dict[str, Any]", row)["id"] for row in all_result.data]

    async def select_candidate_link(
        self,
        *,
        entity_instance_id: str,
        target_id: str,
    ) -> None:
        """Set was_selected=True on the subject→target duplicate suggestion (D-09).

        RES-1: the suggestion rows are promote-written and keyed by
        (component_id ∈ subject's email, entity_instance_id=target). We resolve the
        subject entity to its email components and set was_selected on every link
        to the target. Idempotent — re-running only re-asserts the flag.
        """
        subject_components = await self._email_component_ids_for_entity(entity_instance_id)
        if not subject_components:
            return
        (
            self._client.table("component_entity_candidate_links")
            .update({"was_selected": True})
            .in_("component_id", subject_components)
            .eq("entity_instance_id", target_id)
            .execute()
        )

    async def dismiss_candidate_link(
        self,
        *,
        entity_instance_id: str,
        target_id: str,
    ) -> None:
        """Flag the subject↔target suggestion dismissed so it is not re-surfaced (D-20).

        RES-1: dismisses the promote-written rows in BOTH directions — the
        subject's links to the target AND the target's links to the subject — so a
        reject recorded from one side cannot re-appear as a pending duplicate from
        the other. Uses the 'was_dismissed' column. Idempotent.
        """
        subject_components = await self._email_component_ids_for_entity(entity_instance_id)
        if subject_components:
            (
                self._client.table("component_entity_candidate_links")
                .update({"was_dismissed": True})
                .in_("component_id", subject_components)
                .eq("entity_instance_id", target_id)
                .execute()
            )

        target_components = await self._email_component_ids_for_entity(target_id)
        if target_components:
            (
                self._client.table("component_entity_candidate_links")
                .update({"was_dismissed": True})
                .in_("component_id", target_components)
                .eq("entity_instance_id", entity_instance_id)
                .execute()
            )

    async def set_merge_state(
        self,
        entity_instance_id: str,
        *,
        merged_into: str | None = None,
        is_active: bool = True,
    ) -> None:
        """Update merge linkage and active state on an entity instance.

        Sets is_active and merged_into (nullable FK to entity_instances.id).
        Scoped to source='email_extracted' (D-21 — never mutates another tenant's row).
        Supersede-never-mutate: the row is updated in-place; nothing is deleted.
        """
        payload: dict[str, Any] = {
            "is_active": is_active,
            "merged_into": merged_into,
        }
        (
            self._client.table("entity_instances")
            .update(payload)
            .eq("id", entity_instance_id)
            .eq("source", _SOURCE)
            .execute()
        )
