"""SupabaseGenerationAuditRepository — best-effort insert into genui_generation_events.

Phase 13-02, GEN-05 / D-19 / T-13-10:
- Inserts a GenerationEvent row into the genui_generation_events table.
- Any exception during insert is caught, logged via structlog, and swallowed.
- The caller (generation pipeline) never receives an exception from this adapter.
- intent_hash is stored as-is (caller must hash before calling, D-19).

WR-06: The supabase-py Client is synchronous. Calling it directly from an async
context blocks the event loop for the duration of the network round-trip.
asyncio.to_thread() offloads the blocking execute() call to a thread-pool worker,
keeping the event loop free to process other requests while the insert is in-flight.
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog
from supabase import Client

from app.domain.ports.generation_audit_repository import GenerationEvent

logger = structlog.get_logger(__name__)

_TABLE = "genui_generation_events"


def _to_row(event: GenerationEvent) -> dict[str, Any]:
    """Map a GenerationEvent dataclass to the genui_generation_events column dict.

    Returns a new dict — never mutates the event (CLAUDE.md immutability).
    """
    return {
        "intent_hash": event.intent_hash,
        "model_id": event.model_id,
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "attempts": event.attempts,
        "outcome": event.outcome,
        "spec_validation_passed": event.spec_validation_passed,
        "spec_node_count": event.spec_node_count,
        "spec_depth": event.spec_depth,
        "registry_version": event.registry_version,
        "latency_ms": event.latency_ms,
        "importer_id": event.importer_id,
    }


class SupabaseGenerationAuditRepository:
    """Supabase implementation of GenerationAuditRepository (best-effort insert).

    Satisfies the GenerationAuditRepository Protocol structurally — no explicit
    Protocol inheritance to keep the domain port lint-imports clean.
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def record(self, event: GenerationEvent) -> None:
        """Insert a generation event row (best-effort, T-13-10).

        Offloads the blocking synchronous Supabase execute() call to a thread-pool
        worker via asyncio.to_thread() so the event loop is not blocked during
        the network round-trip (WR-06).

        Swallows all exceptions from the Supabase client and logs them server-side
        via structlog. Never raises to the caller (D-19 audit contract).
        """
        row = _to_row(event)
        try:
            await asyncio.to_thread(
                lambda: self._client.table(_TABLE).insert(row).execute()
            )
        except Exception:
            logger.exception(
                "generation_audit_record_failed",
                table=_TABLE,
                outcome=event.outcome,
                model_id=event.model_id,
                registry_version=event.registry_version,
            )
