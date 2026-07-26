"""Unit tests for the tier-aware cap in IngestBudgetGuard (slice B).

The guard gains an OPTIONAL tier_resolver. When absent it uses the constructed
``daily_email_cap`` exactly as before (byte-identical). When present it derives
the cap from the importer's self-resolved subscription tier, and falls back to
the constructed default on ANY resolver error (fail-open — a lookup failure must
never cap legitimate mail).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from app.domain.services.ingest_budget_guard import IngestBudgetGuard

IMPORTER_ID = "imp-1"


def _counter(*, returns: int) -> AsyncMock:
    counter = AsyncMock()
    counter.count_received_since = AsyncMock(return_value=returns)
    return counter


def _resolver(*, tier: str | None = None, raises: Exception | None = None) -> AsyncMock:
    resolver = AsyncMock()
    if raises is not None:
        resolver.tier_for_importer = AsyncMock(side_effect=raises)
    else:
        resolver.tier_for_importer = AsyncMock(return_value=tier)
    return resolver


def test_no_resolver_uses_constructed_cap_under() -> None:
    """resolver=None: the flat constructed cap is used, byte-identical."""
    guard = IngestBudgetGuard(counter=_counter(returns=3), daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False


def test_no_resolver_uses_constructed_cap_at() -> None:
    guard = IngestBudgetGuard(counter=_counter(returns=5), daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is True


def test_pro_tier_cap_at_500_is_over() -> None:
    """Pro's 500 cap wins over the constructed default (100)."""
    guard = IngestBudgetGuard(
        counter=_counter(returns=500),
        daily_email_cap=100,
        tier_resolver=_resolver(tier="pro"),
    )
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is True


def test_pro_tier_cap_under_500_is_not_over() -> None:
    guard = IngestBudgetGuard(
        counter=_counter(returns=499),
        daily_email_cap=100,
        tier_resolver=_resolver(tier="pro"),
    )
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False


def test_power_tier_cap_at_2000_is_over() -> None:
    """Power's 2000 cap wins over the constructed default (100)."""
    guard = IngestBudgetGuard(
        counter=_counter(returns=2000),
        daily_email_cap=100,
        tier_resolver=_resolver(tier="power"),
    )
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is True


def test_power_tier_cap_under_2000_is_not_over() -> None:
    guard = IngestBudgetGuard(
        counter=_counter(returns=1999),
        daily_email_cap=100,
        tier_resolver=_resolver(tier="power"),
    )
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False


def test_resolver_error_falls_back_to_constructed_default() -> None:
    """Fail-OPEN: a resolver raise uses the constructed cap, not a downgrade."""
    guard = IngestBudgetGuard(
        counter=_counter(returns=3),
        daily_email_cap=5,
        tier_resolver=_resolver(raises=RuntimeError("db down")),
    )
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False
