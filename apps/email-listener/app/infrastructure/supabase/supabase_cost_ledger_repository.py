"""SupabaseCostLedgerRepository — chat_cost_ledger adapter (FOUND-3, D-20/D-21/D-22).

record() is best-effort (mirrors supabase_generation_audit_repository.py): any
exception is logged via structlog and swallowed — never raised to the caller.

sum_for_run / sum_for_conversation / sum_for_importer_day intentionally do NOT
swallow errors (T-22-14 fail-closed): the CostCircuitBreaker must never
under-count cost because a sum query silently failed and returned Decimal("0").

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded to
a thread-pool worker via asyncio.to_thread() so the event loop stays free during
the network round-trip.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any

import structlog
from supabase import Client

from app.domain.ports.cost_ledger_repository import UsageEvent

logger = structlog.get_logger(__name__)

_TABLE = "chat_cost_ledger"


def _to_row(event: UsageEvent) -> dict[str, Any]:
    """Map a UsageEvent dataclass to the chat_cost_ledger column dict.

    Returns a new dict — never mutates the event (CLAUDE.md immutability).
    cost_usd is serialized as a string to preserve numeric(12,6) precision across
    the JSON wire boundary (avoids float rounding).
    """
    return {
        "conversation_id": event.conversation_id,
        "run_id": event.run_id,
        "importer_id": event.importer_id,
        "model_id": event.model_id,
        "execution_locus": event.execution_locus,
        "input_tokens": event.input_tokens,
        "output_tokens": event.output_tokens,
        "cost_usd": str(event.cost_usd),
    }


def _day_start_utc(day: date) -> str:
    """ISO-8601 UTC start-of-day boundary for a given date (for a created_at >= filter)."""
    return datetime.combine(day, time.min, tzinfo=UTC).isoformat()


def _sum_cost_column(rows: Any) -> Decimal:
    """Sum the cost_usd column across selected rows as Decimal (avoids float drift).

    ``rows`` is typed ``Any`` rather than ``list[dict[str, Any]]``: postgrest-py's
    ``APIResponse.data`` is typed as ``list[JSON]`` (a recursive JSON value union),
    which mypy cannot narrow to ``dict[str, Any]`` per-row without an explicit cast.
    """
    if not rows:
        return Decimal("0")
    return sum((Decimal(str(row["cost_usd"])) for row in rows), Decimal("0"))


class SupabaseCostLedgerRepository:
    """Supabase implementation of CostLedgerRepository over chat_cost_ledger.

    Satisfies the CostLedgerRepository Protocol structurally (mirrors
    SupabaseGenerationAuditRepository — no explicit Protocol inheritance keeps
    the domain port lint-imports clean).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def record(self, event: UsageEvent) -> None:
        """Insert a usage event row (best-effort, D-22).

        Offloads the blocking synchronous Supabase execute() call to a
        thread-pool worker via asyncio.to_thread() (WR-06). Swallows all
        exceptions and logs them server-side via structlog — never raises to
        the caller.
        """
        row = _to_row(event)
        try:
            await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(row).execute())
        except Exception:
            logger.exception(
                "cost_ledger_record_failed",
                table=_TABLE,
                model_id=event.model_id,
                execution_locus=event.execution_locus,
                importer_id=event.importer_id,
            )

    async def sum_for_run(self, run_id: str) -> Decimal:
        """Total cost_usd for a single run (per-turn cap accounting).

        Propagates errors (T-22-14 fail-closed) — the caller (CostCircuitBreaker)
        must never mistake a failed query for a zero-cost run.
        """
        result = await asyncio.to_thread(
            lambda: self._client.table(_TABLE).select("cost_usd").eq("run_id", run_id).execute()
        )
        return _sum_cost_column(result.data)

    async def sum_for_conversation(self, conversation_id: str) -> Decimal:
        """Total cost_usd for a conversation (per-session cap check). Propagates errors."""
        result = await asyncio.to_thread(
            lambda: self._client.table(_TABLE)
            .select("cost_usd")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        return _sum_cost_column(result.data)

    async def sum_for_importer_day(self, importer_id: str, day: date) -> Decimal:
        """Total cost_usd for an importer on a given UTC day (per-day cap check). Propagates errors."""
        result = await asyncio.to_thread(
            lambda: self._client.table(_TABLE)
            .select("cost_usd")
            .eq("importer_id", importer_id)
            .gte("created_at", _day_start_utc(day))
            .execute()
        )
        return _sum_cost_column(result.data)
