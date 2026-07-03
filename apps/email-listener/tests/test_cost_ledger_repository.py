"""Tests for CostLedgerRepository port + SupabaseCostLedgerRepository adapter.

TDD (Phase 22-04, STREAM-03, FOUND-3, D-20/D-21/D-22):
  1. record() maps a UsageEvent to the correct chat_cost_ledger column dict.
  2. record() swallows an insert failure (best-effort, mirrors the generation
     audit repository's contract).
  3. sum_for_run / sum_for_conversation / sum_for_importer_day sum the selected
     rows' cost_usd column as Decimal.
  4. sum_* methods PROPAGATE errors (T-22-14 fail-closed) — never silently
     swallowed like record().

These tests use MagicMock for the Supabase client — no live DB required. The
test file lives at the FLAT tests/ level (not tests/unit/) to match this
repo's established convention for supabase-adapter tests (see
test_supabase_generation_audit_repository.py) rather than the plan's literal
tests/unit/ path — see 22-04-SUMMARY.md deviations.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.ports.cost_ledger_repository import CostLedgerRepository, UsageEvent
from app.infrastructure.supabase.supabase_cost_ledger_repository import (
    SupabaseCostLedgerRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAMPLE_EVENT = UsageEvent(
    importer_id="00000000-0000-0000-0003-000000000001",
    model_id="us.anthropic.claude-sonnet-4-6",
    execution_locus="server",
    input_tokens=512,
    output_tokens=256,
    cost_usd=Decimal("0.005280"),
    conversation_id="00000000-0000-0000-0004-000000000001",
    run_id="00000000-0000-0000-0005-000000000001",
)


def _make_insert_client(*, insert_raises: Exception | None = None) -> MagicMock:
    """Build a MagicMock Supabase client with a chainable .table().insert().execute() path."""
    client = MagicMock()

    execute_mock = MagicMock()
    if insert_raises is not None:
        execute_mock.side_effect = insert_raises
    else:
        execute_mock.return_value = MagicMock(data=[{"id": "some-uuid"}])

    insert_mock = MagicMock()
    insert_mock.execute = execute_mock

    table_mock = MagicMock()
    table_mock.insert = MagicMock(return_value=insert_mock)

    client.table = MagicMock(return_value=table_mock)
    return client


def _make_select_client(
    *,
    rows: list[dict[str, Any]] | None = None,
    select_raises: Exception | None = None,
) -> MagicMock:
    """Build a MagicMock Supabase client with a chainable .table().select().eq()[.gte()].execute() path.

    .eq() and .gte() both return the same chain object so any combination of
    filters (sum_for_run uses one .eq(), sum_for_importer_day uses .eq()+.gte())
    resolves to the same terminal .execute().
    """
    client = MagicMock()

    execute_mock = MagicMock()
    if select_raises is not None:
        execute_mock.side_effect = select_raises
    else:
        execute_mock.return_value = MagicMock(data=rows if rows is not None else [])

    chain = MagicMock()
    chain.eq = MagicMock(return_value=chain)
    chain.gte = MagicMock(return_value=chain)
    chain.execute = execute_mock

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=chain)

    client.table = MagicMock(return_value=table_mock)
    return client


# ---------------------------------------------------------------------------
# record()
# ---------------------------------------------------------------------------


def test_record_calls_insert_with_mapped_columns() -> None:
    """Successful record issues exactly one insert into chat_cost_ledger with mapped columns."""
    client = _make_insert_client()
    repo: CostLedgerRepository = SupabaseCostLedgerRepository(client)

    asyncio.run(repo.record(_SAMPLE_EVENT))

    client.table.assert_called_once_with("chat_cost_ledger")
    insert_call_args: dict[str, Any] = client.table.return_value.insert.call_args[0][0]

    assert insert_call_args["conversation_id"] == _SAMPLE_EVENT.conversation_id
    assert insert_call_args["run_id"] == _SAMPLE_EVENT.run_id
    assert insert_call_args["importer_id"] == _SAMPLE_EVENT.importer_id
    assert insert_call_args["model_id"] == _SAMPLE_EVENT.model_id
    assert insert_call_args["execution_locus"] == "server"
    assert insert_call_args["input_tokens"] == 512
    assert insert_call_args["output_tokens"] == 256
    assert insert_call_args["cost_usd"] == "0.005280"

    client.table.return_value.insert.return_value.execute.assert_called_once()


def test_record_browser_locus_zero_cost_still_records_tokens() -> None:
    """D-22: a browser-locus event stores cost_usd=0 but still records real token counts."""
    client = _make_insert_client()
    repo = SupabaseCostLedgerRepository(client)
    event = UsageEvent(
        importer_id="00000000-0000-0000-0003-000000000001",
        model_id="webllm-gemma-3-4b",
        execution_locus="browser",
        input_tokens=128,
        output_tokens=64,
        cost_usd=Decimal("0"),
    )

    asyncio.run(repo.record(event))

    insert_call_args: dict[str, Any] = client.table.return_value.insert.call_args[0][0]
    assert insert_call_args["execution_locus"] == "browser"
    assert insert_call_args["cost_usd"] == "0"
    assert insert_call_args["input_tokens"] == 128
    assert insert_call_args["output_tokens"] == 64
    assert insert_call_args["conversation_id"] is None
    assert insert_call_args["run_id"] is None


def test_record_swallows_insert_exception() -> None:
    """Client whose insert raises has the exception swallowed; record() returns None."""
    client = _make_insert_client(insert_raises=RuntimeError("DB unavailable"))
    repo: CostLedgerRepository = SupabaseCostLedgerRepository(client)

    result = asyncio.run(repo.record(_SAMPLE_EVENT))
    assert result is None


def test_usage_event_is_frozen() -> None:
    """UsageEvent dataclass must be frozen (immutable, D-22/CLAUDE.md)."""
    with pytest.raises(AttributeError):
        _SAMPLE_EVENT.model_id = "mutated"  # type: ignore[misc]


def test_adapter_satisfies_protocol() -> None:
    """SupabaseCostLedgerRepository must structurally satisfy CostLedgerRepository."""
    client = _make_insert_client()
    repo = SupabaseCostLedgerRepository(client)
    assert callable(getattr(repo, "record", None))
    assert callable(getattr(repo, "sum_for_run", None))
    assert callable(getattr(repo, "sum_for_conversation", None))
    assert callable(getattr(repo, "sum_for_importer_day", None))


# ---------------------------------------------------------------------------
# sum_for_run / sum_for_conversation / sum_for_importer_day
# ---------------------------------------------------------------------------


def test_sum_for_run_sums_cost_usd_column() -> None:
    """sum_for_run totals cost_usd across every ledger row for that run."""
    client = _make_select_client(rows=[{"cost_usd": "0.10"}, {"cost_usd": "0.25"}])
    repo = SupabaseCostLedgerRepository(client)

    total = asyncio.run(repo.sum_for_run("run-1"))

    assert total == Decimal("0.35")
    client.table.assert_called_once_with("chat_cost_ledger")
    client.table.return_value.select.assert_called_once_with("cost_usd")
    client.table.return_value.select.return_value.eq.assert_called_once_with("run_id", "run-1")


def test_sum_for_conversation_sums_cost_usd_column() -> None:
    """sum_for_conversation totals cost_usd across every ledger row for that conversation."""
    client = _make_select_client(rows=[{"cost_usd": "1.00"}])
    repo = SupabaseCostLedgerRepository(client)

    total = asyncio.run(repo.sum_for_conversation("conv-1"))

    assert total == Decimal("1.00")
    client.table.return_value.select.return_value.eq.assert_called_once_with("conversation_id", "conv-1")


def test_sum_for_importer_day_filters_by_importer_and_day_start() -> None:
    """sum_for_importer_day filters by importer_id + created_at >= start-of-day, then sums."""
    import datetime as dt

    client = _make_select_client(rows=[{"cost_usd": "0.02"}, {"cost_usd": "0.03"}])
    repo = SupabaseCostLedgerRepository(client)

    total = asyncio.run(repo.sum_for_importer_day("imp-1", dt.date(2026, 7, 3)))

    assert total == Decimal("0.05")
    chain = client.table.return_value.select.return_value
    chain.eq.assert_called_once_with("importer_id", "imp-1")
    # gte is called on whatever .eq() returned (the chained mock).
    chain.eq.return_value.gte.assert_called_once()
    gte_args = chain.eq.return_value.gte.call_args[0]
    assert gte_args[0] == "created_at"
    assert gte_args[1].startswith("2026-07-03T00:00:00")


def test_sum_for_run_returns_zero_for_no_rows() -> None:
    """An empty result set sums to Decimal('0'), never None or a float."""
    client = _make_select_client(rows=[])
    repo = SupabaseCostLedgerRepository(client)

    total = asyncio.run(repo.sum_for_run("run-empty"))

    assert total == Decimal("0")


def test_sum_for_run_propagates_errors() -> None:
    """T-22-14 fail-closed: a sum-query failure PROPAGATES — never swallowed like record()."""
    client = _make_select_client(select_raises=RuntimeError("DB unavailable"))
    repo = SupabaseCostLedgerRepository(client)

    with pytest.raises(RuntimeError, match="DB unavailable"):
        asyncio.run(repo.sum_for_run("run-1"))


def test_sum_for_conversation_propagates_errors() -> None:
    """T-22-14 fail-closed: sum_for_conversation also propagates errors."""
    client = _make_select_client(select_raises=RuntimeError("DB unavailable"))
    repo = SupabaseCostLedgerRepository(client)

    with pytest.raises(RuntimeError, match="DB unavailable"):
        asyncio.run(repo.sum_for_conversation("conv-1"))


def test_sum_for_importer_day_propagates_errors() -> None:
    """T-22-14 fail-closed: sum_for_importer_day also propagates errors."""
    import datetime as dt

    client = _make_select_client(select_raises=RuntimeError("DB unavailable"))
    repo = SupabaseCostLedgerRepository(client)

    with pytest.raises(RuntimeError, match="DB unavailable"):
        asyncio.run(repo.sum_for_importer_day("imp-1", dt.date(2026, 7, 3)))
