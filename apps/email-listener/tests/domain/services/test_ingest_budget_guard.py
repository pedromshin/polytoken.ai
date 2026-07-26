"""Unit tests for app.domain.services.ingest_budget_guard.IngestBudgetGuard (A1).

The guard is the per-importer daily ingest cost cap (mail-bomb blast-radius
limiter). It counts on the server-stamped created_at via a narrow
DailyIngestCounter port, is fail-OPEN (never caps legitimate mail on a count
error — the deliberate opposite of the chat circuit breaker's fail-closed
contract), and reads its cap only at construction.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, time
from unittest.mock import AsyncMock

from app.domain.services.ingest_budget_guard import IngestBudgetGuard

IMPORTER_ID = "imp-1"


def _counter(*, returns: int | None = None, raises: Exception | None = None) -> AsyncMock:
    counter = AsyncMock()
    if raises is not None:
        counter.count_received_since = AsyncMock(side_effect=raises)
    else:
        counter.count_received_since = AsyncMock(return_value=returns)
    return counter


def test_under_cap_is_not_over() -> None:
    counter = _counter(returns=3)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False


def test_at_cap_is_over() -> None:
    """count == cap is already over (the cap-th email is the last enriched one)."""
    counter = _counter(returns=5)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is True


def test_above_cap_is_over() -> None:
    counter = _counter(returns=9)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is True


def test_zero_cap_is_disabled_never_over() -> None:
    """A non-positive cap means 'disabled' — never caps, and never even counts."""
    counter = _counter(returns=1000)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=0)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False
    counter.count_received_since.assert_not_awaited()


def test_negative_cap_is_disabled_never_over() -> None:
    counter = _counter(returns=1000)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=-1)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False
    counter.count_received_since.assert_not_awaited()


def test_counter_error_fails_open_not_over() -> None:
    """Fail-OPEN: a count error reports 'not over cap' rather than capping real mail."""
    counter = _counter(raises=RuntimeError("db down"))
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=5)
    assert asyncio.run(guard.is_over_daily_cap(IMPORTER_ID)) is False


def test_counts_importer_since_start_of_utc_day() -> None:
    """The guard counts the given importer since midnight UTC today (created_at basis)."""
    counter = _counter(returns=0)
    guard = IngestBudgetGuard(counter=counter, daily_email_cap=5)
    asyncio.run(guard.is_over_daily_cap(IMPORTER_ID))

    counter.count_received_since.assert_awaited_once()
    passed_importer, passed_since = counter.count_received_since.await_args.args
    assert passed_importer == IMPORTER_ID
    expected = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)
    assert passed_since == expected
    assert passed_since.tzinfo == UTC
    # Start-of-day: no intra-day time component.
    assert (passed_since.hour, passed_since.minute, passed_since.second) == (0, 0, 0)
