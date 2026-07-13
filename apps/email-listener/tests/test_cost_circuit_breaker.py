"""Tests for CostCircuitBreaker — fail-closed pre-turn gate + mid-stream abort.

TDD (Phase 22-04, STREAM-03, FOUND-3, D-20/D-21):
  1. estimate_turn_cost computes (prompt_tokens*price_in + max_output*price_out)/1e6.
  2. check_pre_turn: ALLOW when every cap stays clear.
  3. check_pre_turn: BLOCK('per_turn') when the estimate alone exceeds the cap.
  4. check_pre_turn: BLOCK('per_session') when session sum + estimate crosses the cap.
  5. check_pre_turn: BLOCK('per_day') when day sum + estimate crosses the cap.
  6. A browser-locus model never blocks (its estimate is always $0).
  7. should_abort is True exactly at/above the per-turn cap.
  8. No public method accepts a cap-override argument (D-21, config-only caps).
  9. A ledger sum failure BLOCKS (fail-closed) rather than allowing the turn.

This file lives at the FLAT tests/ level (not tests/unit/) to match this repo's
established convention for domain-service tests (see test_chat_model_registry.py)
rather than the plan's literal tests/unit/ path — see 22-04-SUMMARY.md deviations.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import (
    CostCircuitBreaker,
    PreTurnDecision,
    estimate_prompt_tokens,
)

# ---------------------------------------------------------------------------
# Fixtures / fakes
# ---------------------------------------------------------------------------


class _FakeLedger:
    """A minimal in-memory CostLedgerRepository test double.

    sum_for_conversation / sum_for_importer_day return fixed Decimal values (or
    raise, when configured), so the breaker's fail-closed behaviour can be
    exercised deterministically without a real Supabase client.
    """

    def __init__(
        self,
        *,
        session_sum: Decimal = Decimal("0"),
        day_sum: Decimal = Decimal("0"),
        session_raises: Exception | None = None,
        day_raises: Exception | None = None,
    ) -> None:
        self._session_sum = session_sum
        self._day_sum = day_sum
        self._session_raises = session_raises
        self._day_raises = day_raises

    async def record(self, event: object) -> None:  # pragma: no cover - unused by these tests
        return None

    async def sum_for_run(self, run_id: str) -> Decimal:  # pragma: no cover - unused by these tests
        return Decimal("0")

    async def sum_for_conversation(self, conversation_id: str) -> Decimal:
        if self._session_raises is not None:
            raise self._session_raises
        return self._session_sum

    async def sum_for_importer_day(self, importer_id: str, day: object) -> Decimal:
        if self._day_raises is not None:
            raise self._day_raises
        return self._day_sum


_SERVER_MODEL = ChatModel(
    id="test-server-model",
    display_name="Test Server Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=200_000),
    best_for="test",
)

_BROWSER_MODEL = ChatModel(
    id="test-browser-model",
    display_name="Test Browser Model",
    transport="browser",
    execution_locus="browser",
    price_in_per_mtok=0.0,
    price_out_per_mtok=0.0,
    capabilities=ChatModelCapabilities(tools=False, genui=False, streaming=True, context_tokens=8_192),
    best_for="test",
)


def _make_breaker(
    *,
    ledger: _FakeLedger | None = None,
    per_turn_cap_usd: float = 0.50,
    per_session_cap_usd: float = 2.00,
    per_day_cap_usd: float = 5.00,
    per_round_cap_usd: float = 0.15,
) -> CostCircuitBreaker:
    return CostCircuitBreaker(
        ledger=ledger or _FakeLedger(),
        per_turn_cap_usd=per_turn_cap_usd,
        per_session_cap_usd=per_session_cap_usd,
        per_day_cap_usd=per_day_cap_usd,
        per_round_cap_usd=per_round_cap_usd,
    )


# ---------------------------------------------------------------------------
# estimate_turn_cost
# ---------------------------------------------------------------------------


def test_estimate_turn_cost_uses_registry_pricing() -> None:
    """estimate = (prompt_tokens*price_in + max_output*price_out) / 1e6."""
    breaker = _make_breaker()

    estimate = breaker.estimate_turn_cost(model=_SERVER_MODEL, prompt_tokens_est=100_000, max_output_tokens=10_000)

    expected = (Decimal(100_000) * Decimal("3.0") + Decimal(10_000) * Decimal("15.0")) / Decimal(1_000_000)
    assert estimate == expected


def test_estimate_turn_cost_is_zero_for_browser_model() -> None:
    """A browser-locus model prices at $0 regardless of token volume."""
    breaker = _make_breaker()

    estimate = breaker.estimate_turn_cost(
        model=_BROWSER_MODEL, prompt_tokens_est=1_000_000, max_output_tokens=1_000_000
    )

    assert estimate == Decimal("0")


def test_estimate_prompt_tokens_heuristic() -> None:
    """~4 chars per token (D-21 heuristic); never negative."""
    assert estimate_prompt_tokens(400) == 100
    assert estimate_prompt_tokens(0) == 0
    assert estimate_prompt_tokens(3) == 0


# ---------------------------------------------------------------------------
# check_pre_turn — ALLOW
# ---------------------------------------------------------------------------


def test_check_pre_turn_allows_when_all_under_cap() -> None:
    """Small estimate + zero existing sums → ALLOW."""
    breaker = _make_breaker(ledger=_FakeLedger(session_sum=Decimal("0"), day_sum=Decimal("0")))

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=1_000,
            max_output_tokens=500,
        )
    )

    assert decision == PreTurnDecision.allow()
    assert decision.allowed is True
    assert decision.breached_cap is None


def test_check_pre_turn_allows_browser_model_with_huge_volume() -> None:
    """A browser-locus model never blocks, even with an enormous token volume."""
    breaker = _make_breaker(
        ledger=_FakeLedger(session_sum=Decimal("999"), day_sum=Decimal("999")),
        per_turn_cap_usd=0.01,
        per_session_cap_usd=0.01,
        per_day_cap_usd=0.01,
    )

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_BROWSER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=10_000_000,
            max_output_tokens=10_000_000,
        )
    )

    assert decision.allowed is True


# ---------------------------------------------------------------------------
# check_pre_turn — BLOCK
# ---------------------------------------------------------------------------


def test_check_pre_turn_blocks_per_turn_when_estimate_alone_exceeds_cap() -> None:
    """An over-per-turn estimate blocks before any ledger sum is even consulted."""
    breaker = _make_breaker(per_turn_cap_usd=0.01)

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=1_000_000,
            max_output_tokens=1_000_000,
        )
    )

    assert decision.allowed is False
    assert decision.breached_cap == "per_turn"


def test_check_pre_turn_blocks_per_session_when_session_sum_plus_estimate_crosses_cap() -> None:
    """Session sum near the cap + a small estimate that crosses it → BLOCK('per_session')."""
    breaker = _make_breaker(
        ledger=_FakeLedger(session_sum=Decimal("1.95"), day_sum=Decimal("0")),
        per_turn_cap_usd=0.50,
        per_session_cap_usd=2.00,
    )

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=20_000,
            max_output_tokens=1_000,
        )
    )

    assert decision.allowed is False
    assert decision.breached_cap == "per_session"


def test_check_pre_turn_blocks_per_day_when_day_sum_over_cap() -> None:
    """Day sum already at/over the cap → BLOCK('per_day') even with a tiny estimate."""
    breaker = _make_breaker(
        ledger=_FakeLedger(session_sum=Decimal("0"), day_sum=Decimal("5.00")),
        per_day_cap_usd=5.00,
    )

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=100,
            max_output_tokens=100,
        )
    )

    assert decision.allowed is False
    assert decision.breached_cap == "per_day"


# ---------------------------------------------------------------------------
# check_pre_turn — fail-closed on ledger errors (T-22-14)
# ---------------------------------------------------------------------------


def test_check_pre_turn_blocks_on_session_sum_failure() -> None:
    """A sum_for_conversation failure BLOCKS the turn (fail-closed), never raises."""
    breaker = _make_breaker(ledger=_FakeLedger(session_raises=RuntimeError("db down")))

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=100,
            max_output_tokens=100,
        )
    )

    assert decision.allowed is False
    assert decision.breached_cap == "per_session"


def test_check_pre_turn_blocks_on_day_sum_failure() -> None:
    """A sum_for_importer_day failure BLOCKS the turn (fail-closed), never raises."""
    breaker = _make_breaker(ledger=_FakeLedger(day_raises=RuntimeError("db down")))

    decision = asyncio.run(
        breaker.check_pre_turn(
            model=_SERVER_MODEL,
            importer_id="imp-1",
            conversation_id="conv-1",
            prompt_tokens_est=100,
            max_output_tokens=100,
        )
    )

    assert decision.allowed is False
    assert decision.breached_cap == "per_day"


# ---------------------------------------------------------------------------
# should_abort — mid-stream per-turn cap
# ---------------------------------------------------------------------------


def test_should_abort_false_below_cap() -> None:
    breaker = _make_breaker(per_turn_cap_usd=0.50)
    assert breaker.should_abort(Decimal("0.49")) is False


def test_should_abort_true_exactly_at_cap() -> None:
    breaker = _make_breaker(per_turn_cap_usd=0.50)
    assert breaker.should_abort(Decimal("0.50")) is True


def test_should_abort_true_above_cap() -> None:
    breaker = _make_breaker(per_turn_cap_usd=0.50)
    assert breaker.should_abort(Decimal("0.51")) is True


# ---------------------------------------------------------------------------
# should_abort_round — COST-05 distinct per-round cap
# ---------------------------------------------------------------------------


def test_should_abort_round_false_below_cap() -> None:
    breaker = _make_breaker(per_round_cap_usd=0.15)
    assert breaker.should_abort_round(Decimal("0.14")) is False


def test_should_abort_round_true_at_and_above_cap() -> None:
    breaker = _make_breaker(per_round_cap_usd=0.15)
    assert breaker.should_abort_round(Decimal("0.15")) is True
    assert breaker.should_abort_round(Decimal("0.16")) is True


def test_should_abort_round_is_distinct_from_should_abort_per_turn() -> None:
    """Same breaker instance: the per-round cap trips independently of the per-turn cap."""
    breaker = _make_breaker(per_turn_cap_usd=0.50, per_round_cap_usd=0.15)

    assert breaker.should_abort_round(Decimal("0.20")) is True
    assert breaker.should_abort(Decimal("0.20")) is False


# ---------------------------------------------------------------------------
# D-21 — no cap-override parameter anywhere on the breaker
# ---------------------------------------------------------------------------


def test_no_cap_override_parameter_in_source() -> None:
    """Structural guard mirroring the plan's own grep acceptance criterion."""
    import inspect

    from app.domain.services import cost_circuit_breaker as module

    source = inspect.getsource(module)
    assert "override" not in source


@pytest.mark.parametrize("method_name", ["estimate_turn_cost", "check_pre_turn", "should_abort", "should_abort_round"])
def test_public_methods_have_no_cap_parameter(method_name: str) -> None:
    """None of the breaker's public methods accept a per-call cap parameter."""
    import inspect

    method = getattr(CostCircuitBreaker, method_name)
    params = inspect.signature(method).parameters
    cap_params = [name for name in params if "cap" in name.lower()]
    assert cap_params == []
