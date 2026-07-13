"""Tests for SupabaseUiSpecTemplateRepository — history read methods.

TDD (Phase 16-03, STDO-05/STDO-06, D-14/D-15/D-16):
  1. list_recent returns a list of TemplateSummary rows (no spec_json field).
  2. list_recent respects limit/offset query parameters.
  3. list_recent clamps limit to [1, 100] and offset >= 0.
  4. list_recent applies importer_id filter only when not None.
  5. list_recent returns [] on any exception (best-effort, D-15).
  6. find_by_id returns TemplateDetail (with spec_json) when row exists.
  7. find_by_id returns None when no row matches (miss).
  8. find_by_id returns None on any exception (best-effort, D-15).
  9. find_by_id handles spec_json returned as JSON string (WR-02).
  10. TemplateSummary and TemplateDetail are frozen (immutable, CLAUDE.md).
  11. SupabaseUiSpecTemplateRepository satisfies extended Protocol structurally
      (list_recent and find_by_id callable).

These tests use MagicMock for the Supabase client — no live DB required.
"""

from __future__ import annotations

import asyncio
import json as _json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.ports.ui_spec_template_repository import (
    TemplateDetail,
    TemplateSummary,
    UiSpecTemplateRepository,
)
from app.infrastructure.supabase.supabase_ui_spec_template_repository import (
    SupabaseUiSpecTemplateRepository,
)

# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

_SAMPLE_ID = "22222222-2222-2222-2222-222222222222"
_SAMPLE_IMPORTER_ID = "00000000-0000-0000-0003-000000000001"
_SAMPLE_SPEC_JSON: dict[str, Any] = {"v": 1, "root": {"type": "card", "title": "Invoice"}}

_SUMMARY_ROW: dict[str, Any] = {
    "id": _SAMPLE_ID,
    "intent_text": "show invoice details",
    "created_at": "2026-06-01T12:00:00+00:00",
    "registry_version": "abc123",
    "use_count": 3,
    "validation_status": "validated",
}

_DETAIL_ROW: dict[str, Any] = {
    **_SUMMARY_ROW,
    "spec_json": _SAMPLE_SPEC_JSON,
}


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


def _make_list_chain(
    rows: list[dict[str, Any]] | None = None,
    raises: Exception | None = None,
) -> MagicMock:
    """Build a mock chain for .select().order().range().execute() (list_recent path).

    Also supports optional .eq() filtering for importer_id before .order().
    Chain: select → [eq()] → order → range → execute
    """
    execute_mock = MagicMock()
    if raises is not None:
        execute_mock.side_effect = raises
    else:
        execute_mock.return_value = MagicMock(data=rows if rows is not None else [])

    range_mock = MagicMock()
    range_mock.execute = execute_mock

    order_mock = MagicMock()
    order_mock.range = MagicMock(return_value=range_mock)

    # eq() for importer_id filter — returns order_mock so chain continues
    eq_for_importer_mock = MagicMock()
    eq_for_importer_mock.order = MagicMock(return_value=order_mock)

    select_mock = MagicMock()
    # Without filter: select → order → range → execute
    select_mock.order = MagicMock(return_value=order_mock)
    # With filter: select → eq("importer_id", ...) → order → range → execute
    select_mock.eq = MagicMock(return_value=eq_for_importer_mock)

    return select_mock


def _make_detail_chain(
    rows: list[dict[str, Any]] | None = None,
    raises: Exception | None = None,
) -> MagicMock:
    """Build a mock chain for .select().eq().limit().execute() (find_by_id path)."""
    execute_mock = MagicMock()
    if raises is not None:
        execute_mock.side_effect = raises
    else:
        execute_mock.return_value = MagicMock(data=rows if rows is not None else [])

    limit_mock = MagicMock()
    limit_mock.execute = execute_mock

    eq_mock = MagicMock()
    eq_mock.limit = MagicMock(return_value=limit_mock)

    select_mock = MagicMock()
    select_mock.eq = MagicMock(return_value=eq_mock)

    return select_mock


def _make_history_client(
    *,
    list_rows: list[dict[str, Any]] | None = None,
    list_raises: Exception | None = None,
    detail_rows: list[dict[str, Any]] | None = None,
    detail_raises: Exception | None = None,
) -> MagicMock:
    """Build a MagicMock Supabase client routing list vs. detail chains by select() column arg.

    Routing logic:
      - select("id, intent_text, ...")  → list_recent chain (no spec_json)
      - select("id, intent_text, ..., spec_json") → find_by_id chain (with spec_json)
    """
    list_chain = _make_list_chain(rows=list_rows, raises=list_raises)
    detail_chain = _make_detail_chain(rows=detail_rows, raises=detail_raises)

    def _select_router(*args: Any, **kwargs: Any) -> MagicMock:
        col_arg: str = args[0] if args else ""
        if "spec_json" in col_arg:
            return detail_chain
        return list_chain

    table_mock = MagicMock()
    table_mock.select = MagicMock(side_effect=_select_router)
    # Keep existing upsert/update so existing tests still compile
    table_mock.upsert = MagicMock()
    table_mock.update = MagicMock()

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    return client


# ---------------------------------------------------------------------------
# Test 1: list_recent returns TemplateSummary rows (no spec_json)
# ---------------------------------------------------------------------------


def test_list_recent_returns_template_summary_rows() -> None:
    """list_recent returns a list of TemplateSummary objects (D-14: no spec_json)."""
    client = _make_history_client(list_rows=[_SUMMARY_ROW])
    repo = SupabaseUiSpecTemplateRepository(client=client)

    results = asyncio.run(repo.list_recent(limit=10, offset=0))

    assert len(results) == 1
    summary = results[0]
    assert isinstance(summary, TemplateSummary)
    assert summary.id == _SAMPLE_ID
    assert summary.intent_text == "show invoice details"
    assert summary.created_at == "2026-06-01T12:00:00+00:00"
    assert summary.registry_version == "abc123"
    assert summary.use_count == 3
    assert summary.validation_status == "validated"
    # D-14: TemplateSummary must NOT have spec_json
    assert not hasattr(summary, "spec_json"), "TemplateSummary must not expose spec_json (D-14)"


# ---------------------------------------------------------------------------
# Test 2: list_recent respects limit and offset
# ---------------------------------------------------------------------------


def test_list_recent_passes_limit_and_offset_to_query() -> None:
    """list_recent calls the DB with limit/offset (integration smoke — see range_bounds_correct for precision)."""
    client = _make_history_client(list_rows=[])
    table_mock = client.table.return_value

    repo = SupabaseUiSpecTemplateRepository(client=client)
    asyncio.run(repo.list_recent(limit=5, offset=20))

    # Verify select was called at least once
    called_selects = table_mock.select.call_args_list
    assert len(called_selects) >= 1


def test_list_recent_range_bounds_correct() -> None:
    """list_recent passes (offset, offset+limit-1) to .range() call."""
    captured_range_args: list[tuple[Any, ...]] = []

    # Build a chain that captures .range() args
    execute_mock = MagicMock(return_value=MagicMock(data=[]))
    range_mock = MagicMock()
    range_mock.execute = execute_mock

    def _capture_range(*args: Any, **kwargs: Any) -> MagicMock:
        captured_range_args.append(args)
        return range_mock

    order_mock = MagicMock()
    order_mock.range = MagicMock(side_effect=_capture_range)

    select_mock = MagicMock()
    select_mock.order = MagicMock(return_value=order_mock)
    select_mock.eq = MagicMock(return_value=MagicMock(order=MagicMock(return_value=order_mock)))

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)

    repo = SupabaseUiSpecTemplateRepository(client=client)
    asyncio.run(repo.list_recent(limit=5, offset=10))

    assert len(captured_range_args) == 1, f"Expected 1 range() call, got: {captured_range_args}"
    start, end = captured_range_args[0]
    assert start == 10, f"Expected range start=10, got: {start}"
    assert end == 14, f"Expected range end=14 (10+5-1), got: {end}"


# ---------------------------------------------------------------------------
# Test 3: list_recent clamps limit/offset
# ---------------------------------------------------------------------------


def test_list_recent_clamps_limit_below_1() -> None:
    """list_recent clamps limit to minimum 1 when caller passes 0 or negative."""
    captured_range_args: list[tuple[Any, ...]] = []

    execute_mock = MagicMock(return_value=MagicMock(data=[]))
    range_mock = MagicMock()
    range_mock.execute = execute_mock

    def _capture_range(*args: Any, **kwargs: Any) -> MagicMock:
        captured_range_args.append(args)
        return range_mock

    order_mock = MagicMock()
    order_mock.range = MagicMock(side_effect=_capture_range)

    select_mock = MagicMock()
    select_mock.order = MagicMock(return_value=order_mock)
    select_mock.eq = MagicMock(return_value=MagicMock(order=MagicMock(return_value=order_mock)))

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.list_recent(limit=0, offset=0))

    start, end = captured_range_args[0]
    # clamped limit=1: range(0, 0)
    assert end - start == 0, f"Clamped limit=1 should give range(0, 0), got ({start}, {end})"


def test_list_recent_clamps_limit_above_100() -> None:
    """list_recent clamps limit to maximum 100 when caller passes > 100."""
    captured_range_args: list[tuple[Any, ...]] = []

    execute_mock = MagicMock(return_value=MagicMock(data=[]))
    range_mock = MagicMock()
    range_mock.execute = execute_mock

    def _capture_range(*args: Any, **kwargs: Any) -> MagicMock:
        captured_range_args.append(args)
        return range_mock

    order_mock = MagicMock()
    order_mock.range = MagicMock(side_effect=_capture_range)

    select_mock = MagicMock()
    select_mock.order = MagicMock(return_value=order_mock)
    select_mock.eq = MagicMock(return_value=MagicMock(order=MagicMock(return_value=order_mock)))

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.list_recent(limit=200, offset=0))

    _start, end = captured_range_args[0]
    # clamped limit=100: range(0, 99)
    assert end == 99, f"Clamped limit=100 should give range end=99, got: {end}"


def test_list_recent_clamps_offset_below_0() -> None:
    """list_recent clamps offset to minimum 0 when caller passes negative."""
    captured_range_args: list[tuple[Any, ...]] = []

    execute_mock = MagicMock(return_value=MagicMock(data=[]))
    range_mock = MagicMock()
    range_mock.execute = execute_mock

    def _capture_range(*args: Any, **kwargs: Any) -> MagicMock:
        captured_range_args.append(args)
        return range_mock

    order_mock = MagicMock()
    order_mock.range = MagicMock(side_effect=_capture_range)

    select_mock = MagicMock()
    select_mock.order = MagicMock(return_value=order_mock)
    select_mock.eq = MagicMock(return_value=MagicMock(order=MagicMock(return_value=order_mock)))

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.list_recent(limit=10, offset=-5))

    start, _end = captured_range_args[0]
    assert start == 0, f"Clamped offset=0 should give range start=0, got: {start}"


# ---------------------------------------------------------------------------
# Test 4: list_recent applies importer_id filter only when not None
# ---------------------------------------------------------------------------


def test_list_recent_applies_importer_id_filter_when_provided() -> None:
    """list_recent applies eq('importer_id', ...) filter when importer_id is not None."""
    eq_calls: list[tuple[str, Any]] = []
    order_mock_inner = MagicMock()
    range_inner = MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))
    order_mock_inner.range = MagicMock(return_value=range_inner)

    def _track_eq(col: str, val: Any) -> MagicMock:
        eq_calls.append((col, val))
        result = MagicMock()
        result.order = MagicMock(return_value=order_mock_inner)
        return result

    select_mock = MagicMock()
    select_mock.eq = MagicMock(side_effect=_track_eq)
    select_mock.order = MagicMock(return_value=order_mock_inner)

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.list_recent(limit=10, offset=0, importer_id=_SAMPLE_IMPORTER_ID))

    assert ("importer_id", _SAMPLE_IMPORTER_ID) in eq_calls, (
        f"Expected eq('importer_id', ...) to be called, got: {eq_calls}"
    )


def test_list_recent_skips_importer_id_filter_when_none() -> None:
    """list_recent does NOT add eq('importer_id', ...) filter when importer_id is None."""
    eq_calls: list[tuple[str, Any]] = []
    order_mock_inner = MagicMock()
    range_inner = MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))
    order_mock_inner.range = MagicMock(return_value=range_inner)

    def _track_eq(col: str, val: Any) -> MagicMock:
        eq_calls.append((col, val))
        result = MagicMock()
        result.order = MagicMock(return_value=order_mock_inner)
        return result

    select_mock = MagicMock()
    select_mock.eq = MagicMock(side_effect=_track_eq)
    select_mock.order = MagicMock(return_value=order_mock_inner)

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.list_recent(limit=10, offset=0, importer_id=None))

    importer_calls = [c for c in eq_calls if c[0] == "importer_id"]
    assert not importer_calls, f"Expected NO eq('importer_id', ...) when None, got: {importer_calls}"


# ---------------------------------------------------------------------------
# Test 5: list_recent returns [] on exception (best-effort, D-15)
# ---------------------------------------------------------------------------


def test_list_recent_returns_empty_list_on_exception() -> None:
    """list_recent must return [] on any exception (best-effort, D-15)."""
    client = _make_history_client(list_raises=RuntimeError("DB error"))
    repo = SupabaseUiSpecTemplateRepository(client=client)

    results = asyncio.run(repo.list_recent(limit=10, offset=0))

    assert results == [], f"Expected [], got: {results}"


# ---------------------------------------------------------------------------
# Test 6: find_by_id returns TemplateDetail (with spec_json) when row exists
# ---------------------------------------------------------------------------


def test_find_by_id_returns_template_detail_on_hit() -> None:
    """find_by_id returns a TemplateDetail (including spec_json) on a match (D-14)."""
    client = _make_history_client(detail_rows=[_DETAIL_ROW])
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_id(_SAMPLE_ID))

    assert result is not None
    assert isinstance(result, TemplateDetail)
    assert result.id == _SAMPLE_ID
    assert result.intent_text == "show invoice details"
    assert result.spec_json == _SAMPLE_SPEC_JSON
    assert result.use_count == 3
    assert result.validation_status == "validated"


# ---------------------------------------------------------------------------
# Test 7: find_by_id returns None when no row matches
# ---------------------------------------------------------------------------


def test_find_by_id_returns_none_on_miss() -> None:
    """find_by_id returns None when no row matches the given id."""
    client = _make_history_client(detail_rows=[])
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_id(_SAMPLE_ID))

    assert result is None


# ---------------------------------------------------------------------------
# Test 8: find_by_id returns None on exception (best-effort, D-15)
# ---------------------------------------------------------------------------


def test_find_by_id_returns_none_on_exception() -> None:
    """find_by_id must return None on any exception (best-effort, D-15)."""
    client = _make_history_client(detail_raises=RuntimeError("DB error"))
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_id(_SAMPLE_ID))

    assert result is None


# ---------------------------------------------------------------------------
# Test 9: find_by_id handles spec_json returned as JSON string (WR-02)
# ---------------------------------------------------------------------------


def test_find_by_id_handles_spec_json_as_string() -> None:
    """find_by_id must parse spec_json when PostgREST returns it as a JSON string (WR-02)."""
    detail_row_with_str_json = {
        **_SUMMARY_ROW,
        "spec_json": _json.dumps(_SAMPLE_SPEC_JSON),
    }
    client = _make_history_client(detail_rows=[detail_row_with_str_json])
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_id(_SAMPLE_ID))

    assert result is not None
    assert result.spec_json == _SAMPLE_SPEC_JSON, "spec_json returned as string must be parsed to dict (WR-02)"


# ---------------------------------------------------------------------------
# Test 10: TemplateSummary and TemplateDetail are frozen (immutable, CLAUDE.md)
# ---------------------------------------------------------------------------


def test_template_summary_is_frozen() -> None:
    """TemplateSummary dataclass must be frozen (immutable, CLAUDE.md)."""
    summary = TemplateSummary(
        id=_SAMPLE_ID,
        intent_text="test",
        created_at="2026-01-01T00:00:00+00:00",
        registry_version="v1",
        use_count=0,
        validation_status="validated",
    )
    with pytest.raises(AttributeError):
        summary.id = "mutated"  # type: ignore[misc]


def test_template_detail_is_frozen() -> None:
    """TemplateDetail dataclass must be frozen (immutable, CLAUDE.md)."""
    detail = TemplateDetail(
        id=_SAMPLE_ID,
        intent_text="test",
        created_at="2026-01-01T00:00:00+00:00",
        registry_version="v1",
        use_count=0,
        validation_status="validated",
        spec_json=_SAMPLE_SPEC_JSON,
    )
    with pytest.raises(AttributeError):
        detail.id = "mutated"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Test 11: SupabaseUiSpecTemplateRepository satisfies extended Protocol
# ---------------------------------------------------------------------------


def test_adapter_satisfies_history_protocol() -> None:
    """SupabaseUiSpecTemplateRepository must expose callable list_recent and find_by_id."""
    client = _make_history_client()
    repo = SupabaseUiSpecTemplateRepository(client=client)

    assert callable(getattr(repo, "list_recent", None)), "list_recent must be callable"
    assert callable(getattr(repo, "find_by_id", None)), "find_by_id must be callable"


def test_protocol_has_list_recent_and_find_by_id() -> None:
    """UiSpecTemplateRepository Protocol must declare list_recent and find_by_id."""
    assert callable(getattr(UiSpecTemplateRepository, "list_recent", None)), (
        "UiSpecTemplateRepository Protocol must declare list_recent"
    )
    assert callable(getattr(UiSpecTemplateRepository, "find_by_id", None)), (
        "UiSpecTemplateRepository Protocol must declare find_by_id"
    )
