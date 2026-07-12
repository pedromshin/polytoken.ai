"""CostLedgerRepository port — domain abstraction for chat cost ledger writes/reads.

Phase 22-04 (STREAM-03, FOUND-3, D-20/D-21/D-22): a general budget ledger drawn on
by the CostCircuitBreaker (per-turn/per-session/per-day caps) — not a chat-shaped
guard bolted beside the existing AWS budget alert. Every adapter (server model,
browser model) writes a usage row here, including browser-executed models which
meter tokens at $0 cost but still record usage events for observability (D-22).

Contracts:
  - UsageEvent is frozen (immutable, CLAUDE.md).
  - record() is best-effort (mirrors GenerationAuditRepository's audit contract,
    T-13-10-style): a Supabase failure is logged and swallowed by the adapter —
    the caller never receives an exception from record().
  - sum_for_run / sum_for_conversation / sum_for_importer_day MUST propagate
    errors (T-22-14 fail-closed): the CostCircuitBreaker must never under-count
    cost because a sum query silently swallowed a failure and returned 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal, Protocol

ExecutionLocus = Literal["server", "browser", "remote-peer"]


@dataclass(frozen=True)
class UsageEvent:
    """Immutable record of one turn's real token usage + computed USD cost (D-22).

    conversation_id / run_id are optional — a ledger row must survive even after
    its conversation/run is hard-deleted (D-14, mirrors chat_cost_ledger's
    ON DELETE SET NULL semantics). Browser-executed models
    (execution_locus='browser') record real token counts with cost_usd =
    Decimal("0") — usage stays observable even though it is free.

    user_id is the conversation OWNER (chat_cost_ledger.user_id, NOT NULL since
    migration 0033) — resolved by the caller from the conversation row, not the
    HTTP session, so importer/agent-triggered turns are attributed too. Typed
    optional only so the record() best-effort contract holds when the lookup
    fails; a None here means the insert will be rejected (23502) and logged.
    """

    importer_id: str
    model_id: str
    execution_locus: ExecutionLocus
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    conversation_id: str | None = None
    run_id: str | None = None
    user_id: str | None = None


class CostLedgerRepository(Protocol):
    """Port for recording + summing chat cost ledger usage (FOUND-3, D-20).

    record(): best-effort — implementations MUST swallow and log failures; the
    caller never receives an exception from this method.

    sum_for_run / sum_for_conversation / sum_for_importer_day: MUST propagate
    errors to the caller. The CostCircuitBreaker is fail-closed (T-22-14) — a
    sum query that silently swallowed a failure and returned Decimal("0") would
    let a request slip past every cap.
    """

    async def record(self, event: UsageEvent) -> None:
        """Persist one usage/cost row. Must not raise under any circumstance."""
        ...

    async def sum_for_run(self, run_id: str) -> Decimal:
        """Total cost_usd recorded for a single run (per-turn cap accounting)."""
        ...

    async def sum_for_conversation(self, conversation_id: str) -> Decimal:
        """Total cost_usd recorded for a conversation (per-session cap check)."""
        ...

    async def sum_for_importer_day(self, importer_id: str, day: date) -> Decimal:
        """Total cost_usd recorded for an importer on a given UTC day (per-day cap check)."""
        ...
