"""SupabaseAutofillRetrievalEventRepository — best-effort insert into autofill_retrieval_events.

Phase 31-02, RECALL-02: satisfies the AutofillRetrievalEventRepository Protocol
structurally (no explicit inheritance, keeps the domain port lint-imports clean).
Mirrors SupabaseGenerationAuditRepository's best-effort posture: `save` never
raises to the caller — every exception is caught, logged via structlog, and
swallowed. The caller (AutofillUseCase) additionally wraps its own call in a
try/except (defense in depth, T-31-04) — an instrumentation-write failure must
never break autofill through either layer.

WR-06: the supabase-py Client is synchronous; asyncio.to_thread() offloads the
blocking insert() call so the event loop stays free during the round-trip.
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog
from supabase import Client

from app.domain.entities.autofill_retrieval_event import AutofillRetrievalEvent

logger = structlog.get_logger(__name__)

_TABLE = "autofill_retrieval_events"


def _to_row(event: AutofillRetrievalEvent) -> dict[str, Any]:
    """Map an AutofillRetrievalEvent dataclass to the autofill_retrieval_events column dict.

    Returns a new dict — never mutates the event (CLAUDE.md immutability).
    """
    return {
        "id": event.id,
        "component_id": event.component_id,
        "importer_id": event.importer_id,
        "entity_type_id": event.entity_type_id,
        "seed_hits": list(event.seed_hits),
        "seed_hit_count": event.seed_hit_count,
        "injected_entity_instance_id": event.injected_entity_instance_id,
        "injected_alias_count": event.injected_alias_count,
        "injected_identifier_count": event.injected_identifier_count,
        "routing_reason": event.routing_reason,
        "created_at": event.created_at.isoformat(),
    }


class SupabaseAutofillRetrievalEventRepository:
    """Supabase implementation of AutofillRetrievalEventRepository (best-effort insert)."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def save(self, event: AutofillRetrievalEvent) -> None:
        """Insert a retrieval event row (best-effort, RECALL-02).

        Never raises — swallows all exceptions from the Supabase client and
        logs them server-side via structlog (mirrors GenerationAuditRepository's
        T-13-10 contract).
        """
        row = _to_row(event)
        try:
            await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(row).execute())
        except Exception:
            logger.exception(
                "autofill_retrieval_event_save_failed",
                table=_TABLE,
                component_id=event.component_id,
                routing_reason=event.routing_reason,
            )
