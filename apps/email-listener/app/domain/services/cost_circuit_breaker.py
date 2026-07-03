"""CostCircuitBreaker — fail-closed pre-turn gate + mid-stream abort check.

Phase 22-04 (STREAM-03, FOUND-3, D-20/D-21): the breaker is the sole authority
admitting or blocking a paid turn. Caps are read ONLY from settings at
construction time (D-21 — "raising a cap is a config change"); no method on
this class accepts a per-call cap parameter, so a request can never relax its
own limit.

Fail-closed contract (T-22-14): on ANY ambiguity or ledger-sum error, block
rather than allow. A browser-locus model (price $0) never blocks on cost —
cost enforcement is meaningless for free, on-device inference.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.domain.ports.cost_ledger_repository import CostLedgerRepository
    from app.domain.services.chat_model_registry import ChatModel

CapName = Literal["per_turn", "per_session", "per_day"]

# D-21 prompt-token estimate heuristic: ~4 characters per token — a standard
# rough English-text approximation used ONLY for the PRE-turn estimate. The
# real cost is always recorded post-turn from actual usage (D-22); this
# heuristic exists solely to decide whether a turn is even worth attempting.
_CHARS_PER_TOKEN_ESTIMATE = 4

_USD_PER_MTOK = Decimal(1_000_000)


def estimate_prompt_tokens(prompt_chars: int) -> int:
    """Rough prompt-token estimate from a character count (D-21 heuristic)."""
    return max(0, prompt_chars // _CHARS_PER_TOKEN_ESTIMATE)


@dataclass(frozen=True)
class PreTurnDecision:
    """Immutable ALLOW/BLOCK result of a pre-turn cap check (D-20/D-21)."""

    allowed: bool
    breached_cap: CapName | None = None

    @classmethod
    def allow(cls) -> PreTurnDecision:
        return cls(allowed=True)

    @classmethod
    def block(cls, cap: CapName) -> PreTurnDecision:
        return cls(allowed=False, breached_cap=cap)


class CostCircuitBreaker:
    """Fail-closed cost gate: pre-turn estimate check + mid-stream abort signal.

    Caps come ONLY from settings, passed in at construction (D-21). No public
    method accepts a per-call cap parameter.
    """

    def __init__(
        self,
        *,
        ledger: CostLedgerRepository,
        per_turn_cap_usd: float,
        per_session_cap_usd: float,
        per_day_cap_usd: float,
    ) -> None:
        self._ledger = ledger
        self._per_turn_cap = Decimal(str(per_turn_cap_usd))
        self._per_session_cap = Decimal(str(per_session_cap_usd))
        self._per_day_cap = Decimal(str(per_day_cap_usd))

    def estimate_turn_cost(
        self,
        *,
        model: ChatModel,
        prompt_tokens_est: int,
        max_output_tokens: int,
    ) -> Decimal:
        """Estimate this turn's USD cost from registry per-Mtok pricing (D-21).

        Pure/synchronous — no ledger I/O. A browser-locus model's registry
        entry always prices at $0 (price_in_per_mtok == price_out_per_mtok ==
        0.0), so this naturally returns Decimal("0") for it.
        """
        price_in = Decimal(str(model.price_in_per_mtok))
        price_out = Decimal(str(model.price_out_per_mtok))
        input_cost = (Decimal(prompt_tokens_est) * price_in) / _USD_PER_MTOK
        output_cost = (Decimal(max_output_tokens) * price_out) / _USD_PER_MTOK
        return input_cost + output_cost

    async def check_pre_turn(
        self,
        *,
        model: ChatModel,
        importer_id: str,
        conversation_id: str,
        prompt_tokens_est: int,
        max_output_tokens: int,
    ) -> PreTurnDecision:
        """Fail-closed pre-turn gate (D-20/D-21): ALLOW only if every cap stays clear.

        A browser-locus model never blocks — its estimate is always
        Decimal("0"), so it can never breach any cap.

        On a ledger sum failure, blocks rather than letting an un-metered turn
        through (T-22-14 fail-closed). The reported breached_cap matches
        whichever sum failed, since either failure means the turn's safety
        cannot be proven.
        """
        estimate = self.estimate_turn_cost(
            model=model,
            prompt_tokens_est=prompt_tokens_est,
            max_output_tokens=max_output_tokens,
        )

        if model.execution_locus == "browser":
            return PreTurnDecision.allow()

        if estimate > self._per_turn_cap:
            return PreTurnDecision.block("per_turn")

        if await self._session_cap_breached(conversation_id=conversation_id, estimate=estimate):
            return PreTurnDecision.block("per_session")

        if await self._day_cap_breached(importer_id=importer_id, estimate=estimate):
            return PreTurnDecision.block("per_day")

        return PreTurnDecision.allow()

    async def _session_cap_breached(self, *, conversation_id: str, estimate: Decimal) -> bool:
        """True when the session (conversation) sum + estimate would cross the cap.

        Fail-closed (T-22-14): a ledger sum failure counts as a breach.
        """
        try:
            session_sum = await self._ledger.sum_for_conversation(conversation_id)
        except Exception:
            return True
        return session_sum + estimate > self._per_session_cap

    async def _day_cap_breached(self, *, importer_id: str, estimate: Decimal) -> bool:
        """True when the importer's UTC-day sum + estimate would cross the cap.

        Fail-closed (T-22-14): a ledger sum failure counts as a breach.
        """
        today = datetime.now(UTC).date()
        try:
            day_sum = await self._ledger.sum_for_importer_day(importer_id, today)
        except Exception:
            return True
        return day_sum + estimate > self._per_day_cap

    def should_abort(self, running_cost: Decimal) -> bool:
        """Mid-stream abort signal (D-21): True once running_cost reaches the per-turn cap."""
        return running_cost >= self._per_turn_cap
