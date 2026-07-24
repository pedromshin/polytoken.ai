"""Cost-governance providers — extracted from container.py (Track 2 decomposition).

FOUND-3 cost ledger + the fail-closed circuit breaker (STREAM-03, D-20/D-21) that gates every
chat turn. Factory bodies moved verbatim; `register` performs the group's bindings. Both take
an injected `Client` / `CostLedgerRepository` port — no patched global — so container.py's
boot-test patch targets are unaffected.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.domain.ports.cost_ledger_repository import CostLedgerRepository
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker
from app.infrastructure.supabase.supabase_cost_ledger_repository import SupabaseCostLedgerRepository
from app.settings import get_settings


def _provide_cost_ledger_repository(client: Client) -> CostLedgerRepository:
    """SupabaseCostLedgerRepository — chat_cost_ledger adapter (FOUND-3, D-20/D-22)."""
    return SupabaseCostLedgerRepository(client=client)


def _provide_cost_circuit_breaker(ledger: CostLedgerRepository) -> CostCircuitBreaker:
    """CostCircuitBreaker — fail-closed pre-turn gate + mid-stream abort (STREAM-03, D-20/D-21).

    Caps come ONLY from settings (D-21) — passed in here at construction time,
    never overridable per-call.
    """
    settings = get_settings()
    return CostCircuitBreaker(
        ledger=ledger,
        per_turn_cap_usd=settings.COST_CAP_PER_TURN_USD,
        per_session_cap_usd=settings.COST_CAP_PER_SESSION_USD,
        per_day_cap_usd=settings.COST_CAP_PER_DAY_USD,
        per_round_cap_usd=settings.COST_CAP_PER_ROUND_USD,
    )


def register(provider: Provider) -> None:
    """Register the cost-governance group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    cost ledger + circuit-breaker block they replaced.
    """
    provider.provide(_provide_cost_ledger_repository, provides=CostLedgerRepository)
    provider.provide(_provide_cost_circuit_breaker, provides=CostCircuitBreaker)
