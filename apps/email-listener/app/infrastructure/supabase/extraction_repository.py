"""SupabaseExtractionRepository — implements ExtractionRepository port.

supersede_active uses update(status="superseded") — never delete (D-16).
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, cast

from supabase import Client

from app.domain.entities.extraction_record import ExtractionRecord
from app.infrastructure.supabase.sanitize import strip_nul


def _to_row(record: ExtractionRecord) -> dict[str, Any]:
    # LLM-extracted fields and retrieval context are jsonb; strip NUL chars (22P05)
    return cast(
        "dict[str, Any]",
        strip_nul(
            {
                "id": record.id,
                "importer_id": record.importer_id,
                "component_id": record.component_id,
                "entity_type_id": record.entity_type_id,
                "extracted_fields": record.extracted_fields,
                "confidence_score": record.confidence_score,
                "confidence_breakdown": record.confidence_breakdown,
                "routing_reason": record.routing_reason,
                "status": record.status,
                "corrected_fields": record.corrected_fields,
                "retrieval_context": record.retrieval_context,
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            }
        ),
    )


def _from_row(row: dict[str, Any]) -> ExtractionRecord:
    return ExtractionRecord(
        id=row["id"],
        importer_id=row["importer_id"],
        component_id=row["component_id"],
        entity_type_id=row["entity_type_id"],
        extracted_fields=dict(row.get("extracted_fields") or {}),
        confidence_score=float(row["confidence_score"]),
        confidence_breakdown=dict(row["confidence_breakdown"]) if row.get("confidence_breakdown") else None,
        routing_reason=row.get("routing_reason"),
        status=row["status"],
        corrected_fields=dict(row["corrected_fields"]) if row.get("corrected_fields") else None,
        retrieval_context=dict(row["retrieval_context"]) if row.get("retrieval_context") else None,
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )


class SupabaseExtractionRepository:
    """Supabase implementation of ExtractionRepository."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def save(self, record: ExtractionRecord) -> ExtractionRecord:
        """Upsert an extraction record; returns the persisted entity."""
        result = await asyncio.to_thread(
            lambda: self._client.table("extraction_records").upsert(_to_row(record), on_conflict="id").execute()
        )
        return _from_row(cast("dict[str, Any]", result.data[0]))

    async def find_by_component_id(self, component_id: str) -> list[ExtractionRecord]:
        """Return all extraction records for a given component."""
        result = await asyncio.to_thread(
            lambda: self._client.table("extraction_records").select("*").eq("component_id", component_id).execute()
        )
        return [_from_row(cast("dict[str, Any]", row)) for row in result.data]

    async def supersede_active(self, component_id: str) -> None:
        """Mark all active records for the component as superseded — never delete (D-16)."""
        await asyncio.to_thread(
            lambda: (
                self._client.table("extraction_records")
                .update({"status": "superseded"})
                .eq("component_id", component_id)
                .neq("status", "superseded")
                .execute()
            )
        )
