"""SupabaseCorrectionCascadeRepository — Phase 75 Plan 75-03 (CPF-01/02/03).

Implements BOTH cascade ports from app/domain/ports/correction_cascade.py on one
adapter (they are structural Protocols; composition passes the same instance as
`cascade_reader` and `propagations`):

  - CorrectionCascadeReader — the two owner-scoped reads the cascade needs:
      * find_promotable_suggestion_edge_ids: ACTIVE INFERRED/AMBIGUOUS
        knowledge_node_edges targeting the survivor/absorbed identities.
        knowledge_node_edges carries no importer_id column, so tenant scope is
        applied transitively via source_node_id -> knowledge_nodes.importer_id —
        pattern-copied from SupabaseKnowledgeGraphRepository.list_injectable_edges
        (T-29-06). The promoter's own guards remain the source of truth for
        "promotable"; this only shapes the candidate set.
      * find_email_ids_for_entity: distinct email ids where the entity appears as
        a resolved component candidate — candidate links -> owning components ->
        email ids, the same join walked by
        SupabaseEntityInstanceRepository._email_component_ids_for_entity (RES-1).
  - CorrectionPropagationWriter — the correction_propagations ledger insert
    (migration 0060), ON CONFLICT (job_key) DO NOTHING via ignore-duplicates
    upsert; True only when a NEW row landed (the CPF-02 idempotency signal).

Follows the established Supabase-repo idiom: self-contained module, payload
builders wrapped in strip_nul, table().select/upsert().execute() call shapes
inside asyncio.to_thread.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any, cast

from supabase import Client

from app.infrastructure.supabase.sanitize import strip_nul

_SUGGESTION_TIERS = ["INFERRED", "AMBIGUOUS"]


class SupabaseCorrectionCascadeRepository:
    """Supabase adapter for CorrectionCascadeReader + CorrectionPropagationWriter.

    Tenant isolation: edge reads are scoped through the importer's own
    knowledge_nodes ids (edges carry no importer_id column, T-29-06); the
    ledger write always carries the caller-derived importer_id (D-21 — the
    use case derives it from the loaded survivor row, never a request arg).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def find_promotable_suggestion_edge_ids(
        self,
        *,
        entity_instance_ids: Sequence[str],
        importer_id: str,
    ) -> list[str]:
        """ACTIVE suggestion-tier edge ids targeting any of `entity_instance_ids`.

        Two-step read mirroring list_injectable_edges: resolve the importer's
        knowledge_nodes ids first (THE tenant boundary), then select edges
        scoped to those source nodes with tier in INFERRED/AMBIGUOUS and
        is_active=True whose target_ref_id is one of the given identities.
        """
        targets = [eid for eid in entity_instance_ids if eid]
        if not targets:
            return []

        nodes_result = await asyncio.to_thread(
            lambda: self._client.table("knowledge_nodes").select("id").eq("importer_id", importer_id).execute()
        )
        node_ids = [str(cast("dict[str, Any]", row)["id"]) for row in nodes_result.data]
        if not node_ids:
            return []

        result = await asyncio.to_thread(
            lambda: (
                self._client.table("knowledge_node_edges")
                .select("id")
                .in_("source_node_id", node_ids)
                .in_("target_ref_id", targets)
                .in_("tier", _SUGGESTION_TIERS)
                .eq("is_active", True)
                .execute()
            )
        )
        return [str(cast("dict[str, Any]", row)["id"]) for row in result.data]

    async def find_email_ids_for_entity(
        self,
        *,
        entity_instance_id: str,
    ) -> list[str]:
        """Distinct email ids where the entity appears as a resolved component candidate.

        candidate links (component_id FK) -> email_components.email_id — the
        inverse of the detail-page occurrence join (RES-1: links are keyed by
        component_id, never by an entity id). Sorted for determinism.
        """
        link_result = await asyncio.to_thread(
            lambda: (
                self._client.table("component_entity_candidate_links")
                .select("component_id")
                .eq("entity_instance_id", entity_instance_id)
                .execute()
            )
        )
        component_ids = [
            cast("dict[str, Any]", row)["component_id"]
            for row in link_result.data
            if cast("dict[str, Any]", row).get("component_id") is not None
        ]
        if not component_ids:
            return []

        comp_result = await asyncio.to_thread(
            lambda: self._client.table("email_components").select("email_id").in_("id", component_ids).execute()
        )
        email_ids = {
            str(cast("dict[str, Any]", row)["email_id"])
            for row in comp_result.data
            if cast("dict[str, Any]", row).get("email_id") is not None
        }
        return sorted(email_ids)

    async def record(
        self,
        *,
        importer_id: str,
        survivor_entity_instance_id: str,
        absorbed_entity_instance_id: str,
        promoted_edge_ids: Sequence[str],
        affected_email_ids: Sequence[str],
        job_key: str,
    ) -> bool:
        """Insert ONE correction_propagations ledger row, ON CONFLICT (job_key) DO NOTHING.

        ignore-duplicates upsert on the job_key unique index (migration 0060):
        PostgREST returns the inserted row when new and an empty set when the
        conflict was skipped — so a truthy result IS the "new row written"
        idempotency signal (CPF-02).
        """
        payload = cast(
            "dict[str, Any]",
            strip_nul(
                {
                    "importer_id": importer_id,
                    "survivor_entity_instance_id": survivor_entity_instance_id,
                    "absorbed_entity_instance_id": absorbed_entity_instance_id,
                    "promoted_edge_ids": list(promoted_edge_ids),
                    "affected_email_ids": list(affected_email_ids),
                    "job_key": job_key,
                }
            ),
        )
        result = await asyncio.to_thread(
            lambda: (
                self._client.table("correction_propagations")
                .upsert(payload, on_conflict="job_key", ignore_duplicates=True)
                .execute()
            )
        )
        return bool(result.data)
