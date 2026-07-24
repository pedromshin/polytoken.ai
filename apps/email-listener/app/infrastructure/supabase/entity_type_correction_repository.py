"""SupabaseEntityTypeCorrectionRepository — capture + retrieval of entity-type corrections.

Implements EntityTypeCorrectionRepository (LEARN-01/LEARN-02):
  save(): insert a durable entity_type_corrections row (best-effort posture is
    the CALLER's responsibility — mirrors confirm_region.py's use-case-level
    try/except, see SetComponentEntityTypeUseCase).
  find_similar(): pg_trgm retrieval via match_entity_type_corrections_by_trgm,
    importer_id-scoped ONLY (no entity_type_id filter — Pitfall 4, this
    retrieval runs BEFORE the type is known). Degrade-safe: never raises,
    an empty/failed RPC returns [] (D-13 cold-start-safe).

Follows SupabaseRetrievalRepository's exact .rpc(...).execute() + row-map
style (apps/email-listener/app/infrastructure/supabase/retrieval_repository.py).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.domain.ports.entity_type_correction_repository import (
    EntityTypeCorrectionExample,
)

logger = logging.getLogger(__name__)

_TABLE = "entity_type_corrections"
_TRGM_RPC = "match_entity_type_corrections_by_trgm"


class SupabaseEntityTypeCorrectionRepository:
    """Supabase implementation of EntityTypeCorrectionRepository.

    The Supabase client is injected so the repository can be unit-tested
    with a mock (no real DB).
    """

    def __init__(self, client: Any) -> None:
        self._client = client

    async def save(
        self,
        *,
        component_id: str,
        importer_id: str,
        previous_entity_type_id: str,
        corrected_entity_type_id: str,
    ) -> None:
        """Insert one entity_type_corrections row.

        Does NOT swallow exceptions — the caller (SetComponentEntityTypeUseCase)
        wraps this call in a best-effort try/except, mirroring confirm_region's
        posture (a capture failure must never block the human's reclassification).
        """
        payload = {
            "importer_id": importer_id,
            "component_id": component_id,
            "previous_entity_type_id": previous_entity_type_id,
            "corrected_entity_type_id": corrected_entity_type_id,
        }
        await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(payload).execute())

    async def find_similar(
        self,
        *,
        query_text: str,
        importer_id: str,
        top_n: int = 3,
    ) -> list[EntityTypeCorrectionExample]:
        """Return top-N corrections whose content_text is similar to query_text.

        importer_id-scoped ONLY (no entity-type filter param — Pitfall 4).
        Never raises — an empty/failed RPC returns [] (degrade-safe, D-13).
        """
        try:
            result = await asyncio.to_thread(
                lambda: self._client.rpc(
                    _TRGM_RPC,
                    {
                        "query_text": query_text,
                        "match_importer_id": importer_id,
                        "match_count": top_n,
                    },
                ).execute()
            )
            rows: list[dict[str, Any]] = result.data or []
        except Exception:
            logger.exception(
                "SupabaseEntityTypeCorrectionRepository: find_similar RPC failed — returning empty",
                extra={"importer_id": importer_id},
            )
            return []

        return [
            EntityTypeCorrectionExample(
                content_text=str(row.get("content_text", "")),
                corrected_entity_type_slug=str(row.get("corrected_entity_type_slug", "")),
                score=float(row.get("sim", 0.0)),
            )
            for row in rows
        ]
