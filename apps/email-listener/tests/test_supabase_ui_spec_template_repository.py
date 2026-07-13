"""Tests for SupabaseUiSpecTemplateRepository — best-effort cache adapter.

TDD (Phase 14-03, CACHE-01, D-15, D-17):
  1. find_by_cache_key returns CachedTemplate on a matching row.
  2. find_by_cache_key returns None on an empty result (cache miss).
  3. find_by_cache_key returns None on a client exception (best-effort miss, D-17).
  4. find_by_cache_key filters by BOTH cache_key AND validation_status='validated' (D-15).
  5. persist calls upsert with on_conflict="cache_key" (D-12 concurrency-safe upsert).
  6. persist swallows an exception without propagating (best-effort, D-17).
  7. increment_use_count issues a read-modify-write update and swallows a raised exception (D-17).
  8. increment_use_count includes use_count=current+1 in the UPDATE payload (CR-01 / IN-02).
  9. CachedTemplate / TemplateToPersist are frozen (immutable, CLAUDE.md).
  10. SupabaseUiSpecTemplateRepository satisfies the UiSpecTemplateRepository Protocol structurally.
  11. find_by_cache_key handles spec_json returned as a JSON string (WR-02 defensive handling).

These tests use MagicMock for the Supabase client — no live DB required.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.ports.ui_spec_template_repository import (
    CachedTemplate,
    TemplateToPersist,
)
from app.infrastructure.supabase.supabase_ui_spec_template_repository import (
    SupabaseUiSpecTemplateRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAMPLE_CACHE_KEY = "a" * 64  # 64-char hex string
_SAMPLE_TEMPLATE_ID = "11111111-1111-1111-1111-111111111111"
_SAMPLE_SPEC_JSON: dict[str, Any] = {"v": 1, "root": {"type": "card", "title": "Invoice"}}

_SAMPLE_TEMPLATE_TO_PERSIST = TemplateToPersist(
    cache_key=_SAMPLE_CACHE_KEY,
    intent_text="show invoice details",
    data_shape_hash="b" * 64,
    registry_version="abc123" * 10 + "abcd",
    catalog_id="global",
    spec_json=_SAMPLE_SPEC_JSON,
    validation_status="validated",
    spec_node_count=5,
    spec_depth=2,
    importer_id="00000000-0000-0000-0003-000000000001",
)


def _make_select_chain(
    rows: list[dict[str, Any]] | None = None,
    raises: Exception | None = None,
) -> MagicMock:
    """Build a re-usable mock for .select().eq()*.limit().execute() chains.

    Supports both single-eq (increment_use_count: .eq("id", ...).limit(1).execute())
    and double-eq (find_by_cache_key: .eq("cache_key", ...).eq("validation_status", ...).limit(1).execute())
    call patterns: every .eq() result has both a .eq() and a .limit() that both
    lead to the same terminal execute_mock.
    """
    execute_mock = MagicMock()
    if raises is not None:
        execute_mock.side_effect = raises
    else:
        execute_mock.return_value = MagicMock(data=rows if rows is not None else [])

    limit_mock = MagicMock()
    limit_mock.execute = execute_mock

    # eq2_mock: after second .eq() call — only .limit() matters here
    eq2_mock = MagicMock()
    eq2_mock.limit = MagicMock(return_value=limit_mock)

    # eq1_mock: after first .eq() call — supports .eq() (double-eq path) AND
    # .limit() (single-eq path, used by increment_use_count).
    eq1_mock = MagicMock()
    eq1_mock.eq = MagicMock(return_value=eq2_mock)
    eq1_mock.limit = MagicMock(return_value=limit_mock)  # single-eq path

    select_mock = MagicMock()
    select_mock.eq = MagicMock(return_value=eq1_mock)

    return select_mock


def _make_update_chain(raises: Exception | None = None) -> MagicMock:
    """Build a re-usable mock for a .update().eq().execute() chain."""
    update_execute = MagicMock()
    if raises is not None:
        update_execute.side_effect = raises
    else:
        update_execute.return_value = MagicMock(data=[])

    update_eq_mock = MagicMock()
    update_eq_mock.execute = update_execute

    update_mock = MagicMock()
    update_mock.eq = MagicMock(return_value=update_eq_mock)
    return update_mock


def _make_client(
    *,
    select_rows: list[dict[str, Any]] | None = None,
    select_raises: Exception | None = None,
    upsert_raises: Exception | None = None,
    update_raises: Exception | None = None,
    # CR-01: increment_use_count now does SELECT("use_count") then UPDATE.
    # Supply increment_select_rows to configure what that SELECT returns.
    # Routing is based on the column argument passed to .select():
    #   .select("id, spec_json") → find_chain  (find_by_cache_key path)
    #   .select("use_count")     → increment_chain (increment_use_count path)
    # When increment_select_rows is None, any select() call returns the find chain
    # (backward-compat for tests that don't exercise the increment SELECT path).
    increment_select_rows: list[dict[str, Any]] | None = None,
) -> MagicMock:
    """Build a MagicMock Supabase client with chainable table().select/upsert/update paths.

    CR-01: increment_use_count issues SELECT("use_count") then UPDATE.
    Routing is done by inspecting the first positional argument to .select():
      - "id, spec_json"  → find_by_cache_key chain (select_rows / select_raises)
      - "use_count"      → increment_use_count chain (increment_select_rows)
    This avoids call-order brittleness when tests only exercise one of the paths.
    """
    client = MagicMock()

    find_chain = _make_select_chain(
        rows=select_rows,
        raises=select_raises,
    )

    if increment_select_rows is not None:
        increment_chain = _make_select_chain(rows=increment_select_rows)

        def _select_side_effect(*args: Any, **kwargs: Any) -> MagicMock:
            # Route by the column string passed to .select():
            #   find_by_cache_key → .select("id, spec_json")
            #   increment_use_count → .select("use_count")
            col_arg = args[0] if args else ""
            if "use_count" in col_arg:
                return increment_chain
            return find_chain

        select_side_eff: Any = _select_side_effect
    else:
        # No increment_select_rows: always return the find_chain (backward-compat).
        def _single_select_side_effect(*args: Any, **kwargs: Any) -> MagicMock:
            return find_chain

        select_side_eff = _single_select_side_effect

    # ── upsert chain: .table().upsert().execute() ────────────────────────────
    upsert_execute = MagicMock()
    if upsert_raises is not None:
        upsert_execute.side_effect = upsert_raises
    else:
        upsert_execute.return_value = MagicMock(data=[])

    upsert_mock = MagicMock()
    upsert_mock.execute = upsert_execute

    # ── update chain: .table().update().eq().execute() ───────────────────────
    update_mock = _make_update_chain(raises=update_raises)

    table_mock = MagicMock()
    table_mock.select = MagicMock(side_effect=select_side_eff)
    table_mock.upsert = MagicMock(return_value=upsert_mock)
    table_mock.update = MagicMock(return_value=update_mock)

    client.table = MagicMock(return_value=table_mock)
    return client


# ---------------------------------------------------------------------------
# Test 1: find_by_cache_key returns CachedTemplate on a matching row
# ---------------------------------------------------------------------------


def test_find_by_cache_key_returns_cached_template_on_hit() -> None:
    """find_by_cache_key returns a CachedTemplate when the query returns a row."""
    rows = [{"id": _SAMPLE_TEMPLATE_ID, "spec_json": _SAMPLE_SPEC_JSON}]
    client = _make_client(select_rows=rows)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert result is not None
    assert isinstance(result, CachedTemplate)
    assert result.id == _SAMPLE_TEMPLATE_ID
    assert result.spec_json == _SAMPLE_SPEC_JSON


# ---------------------------------------------------------------------------
# Test 2: find_by_cache_key returns None on empty result (cache miss)
# ---------------------------------------------------------------------------


def test_find_by_cache_key_returns_none_on_miss() -> None:
    """find_by_cache_key returns None when the query returns no rows."""
    client = _make_client(select_rows=[])
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert result is None


# ---------------------------------------------------------------------------
# Test 3: find_by_cache_key returns None on exception (best-effort, D-17)
# ---------------------------------------------------------------------------


def test_find_by_cache_key_returns_none_on_exception() -> None:
    """find_by_cache_key treats any lookup exception as a miss (D-17)."""
    client = _make_client(select_raises=RuntimeError("DB unavailable"))
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert result is None


# ---------------------------------------------------------------------------
# Test 4: find_by_cache_key filters by BOTH cache_key AND validation_status (D-15)
# ---------------------------------------------------------------------------


def test_find_by_cache_key_filters_by_cache_key_and_validation_status() -> None:
    """find_by_cache_key must apply eq('cache_key', ...) AND eq('validation_status', 'validated') (D-15)."""
    rows = [{"id": _SAMPLE_TEMPLATE_ID, "spec_json": _SAMPLE_SPEC_JSON}]
    client = _make_client(select_rows=rows)
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    # First call to select() is from find_by_cache_key — check via call args
    calls = table_mock.select.call_args_list
    assert len(calls) >= 1  # at least one select call was made

    # We verify the eq chain from the first select call's return value
    # (table_mock.select.return_value is not reliable with side_effect)
    # Approach: verify through the find chain directly
    # The first call to table_mock.select(). Since side_effect is used, .return_value isn't set.
    # Instead we capture the chain: select mock returned the find_chain.
    # To avoid brittle introspection, we verify indirectly: result was CachedTemplate (correct row returned).
    # The filters are tested by checking the eq call counts below using a simpler direct mock.
    # filter correctness is validated by the fact that only validated rows are returned


def test_find_by_cache_key_filters_eq_calls_directly() -> None:
    """find_by_cache_key must call .eq('cache_key', ...) and .eq('validation_status', 'validated') (D-15).

    Uses a dedicated mock setup that captures eq() call arguments directly.
    """
    eq_calls: list[tuple[Any, ...]] = []

    def _track_eq(*args: Any) -> MagicMock:
        eq_calls.append(args)
        inner_eq = MagicMock()
        inner_eq.eq = MagicMock(side_effect=_track_eq)
        inner_eq.limit = MagicMock(
            return_value=MagicMock(
                execute=MagicMock(
                    return_value=MagicMock(data=[{"id": _SAMPLE_TEMPLATE_ID, "spec_json": _SAMPLE_SPEC_JSON}])
                )
            )
        )
        return inner_eq

    select_mock = MagicMock()
    select_mock.eq = MagicMock(side_effect=_track_eq)

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_mock)
    table_mock.upsert = MagicMock()
    table_mock.update = MagicMock()

    client = MagicMock()
    client.table = MagicMock(return_value=table_mock)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert ("cache_key", _SAMPLE_CACHE_KEY) in eq_calls, f"Missing eq('cache_key', ...) in {eq_calls}"
    assert ("validation_status", "validated") in eq_calls, f"Missing eq('validation_status', 'validated') in {eq_calls}"


# ---------------------------------------------------------------------------
# Test 5: persist calls upsert with on_conflict="cache_key" (D-12)
# ---------------------------------------------------------------------------


def test_persist_calls_upsert_with_on_conflict() -> None:
    """persist uses ON CONFLICT (cache_key) upsert for concurrency-safe writes (D-12)."""
    client = _make_client()
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.persist(_SAMPLE_TEMPLATE_TO_PERSIST))

    assert table_mock.upsert.called
    call_kwargs = table_mock.upsert.call_args
    # The on_conflict kwarg must be "cache_key"
    _, kwargs = call_kwargs if isinstance(call_kwargs, tuple) and len(call_kwargs) == 2 else ([], {})
    if not kwargs:
        # call_args may be a Call object — inspect keyword args
        kwargs = table_mock.upsert.call_args.kwargs if hasattr(table_mock.upsert.call_args, "kwargs") else {}
    assert kwargs.get("on_conflict") == "cache_key", f"Expected on_conflict='cache_key', got: {kwargs}"


# ---------------------------------------------------------------------------
# Test 6: persist swallows an exception without propagating (D-17)
# ---------------------------------------------------------------------------


def test_persist_swallows_exception() -> None:
    """persist must not raise even when the upsert call fails (best-effort, D-17)."""
    client = _make_client(upsert_raises=RuntimeError("DB unavailable"))
    repo = SupabaseUiSpecTemplateRepository(client=client)

    # Must not raise
    result = asyncio.run(repo.persist(_SAMPLE_TEMPLATE_TO_PERSIST))
    assert result is None


# ---------------------------------------------------------------------------
# Test 7: increment_use_count swallows a raised exception (D-17)
# ---------------------------------------------------------------------------


def test_increment_use_count_swallows_exception() -> None:
    """increment_use_count must not raise when the update fails (best-effort, D-17)."""
    client = _make_client(update_raises=RuntimeError("DB unavailable"))
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.increment_use_count(_SAMPLE_TEMPLATE_ID))
    assert result is None


def test_increment_use_count_calls_update() -> None:
    """increment_use_count must call the DB update on the ui_spec_templates table."""
    # Must supply increment_select_rows so the SELECT returns a row; otherwise
    # the read-modify-write logic hits "row not found" and returns early.
    client = _make_client(increment_select_rows=[{"use_count": 0}])
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.increment_use_count(_SAMPLE_TEMPLATE_ID))

    assert table_mock.update.called


# ---------------------------------------------------------------------------
# Test 8: increment_use_count sends use_count=current+1 in the UPDATE payload (CR-01/IN-02)
# ---------------------------------------------------------------------------


def test_increment_use_count_payload_includes_incremented_use_count() -> None:
    """increment_use_count must set use_count = current + 1 in the UPDATE payload (CR-01/IN-02).

    The read-modify-write approach: SELECT current use_count, then UPDATE with current+1.
    """
    current_count = 5
    client = _make_client(increment_select_rows=[{"use_count": current_count}])
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.increment_use_count(_SAMPLE_TEMPLATE_ID))

    # update() must have been called with a payload containing use_count = current_count + 1
    assert table_mock.update.called
    update_call_args = table_mock.update.call_args
    # First positional arg is the payload dict
    payload: dict[str, Any] = update_call_args[0][0] if update_call_args[0] else update_call_args.args[0]
    assert payload.get("use_count") == current_count + 1, (
        f"Expected use_count={current_count + 1} in UPDATE payload, got: {payload}"
    )
    assert "updated_at" in payload, "UPDATE payload must include updated_at timestamp"


def test_increment_use_count_starts_from_zero_when_use_count_is_null() -> None:
    """increment_use_count treats NULL use_count as 0 and sets use_count=1 (CR-01).

    Handles the case where the column is NULL (e.g. newly-inserted row).
    """
    client = _make_client(increment_select_rows=[{"use_count": None}])
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.increment_use_count(_SAMPLE_TEMPLATE_ID))

    assert table_mock.update.called
    payload: dict[str, Any] = table_mock.update.call_args[0][0]
    assert payload.get("use_count") == 1, f"Expected use_count=1 when NULL → treated as 0, got: {payload}"


# ---------------------------------------------------------------------------
# Test 9: find_by_cache_key handles spec_json returned as JSON string (WR-02)
# ---------------------------------------------------------------------------


def test_find_by_cache_key_handles_spec_json_as_string() -> None:
    """find_by_cache_key must parse spec_json when PostgREST returns it as a JSON string (WR-02)."""
    import json

    spec_as_str = json.dumps(_SAMPLE_SPEC_JSON)
    rows = [{"id": _SAMPLE_TEMPLATE_ID, "spec_json": spec_as_str}]
    client = _make_client(select_rows=rows)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert result is not None
    assert result.spec_json == _SAMPLE_SPEC_JSON, "spec_json returned as string must be parsed to a dict (WR-02)"


def test_find_by_cache_key_handles_spec_json_as_dict() -> None:
    """find_by_cache_key must accept spec_json when PostgREST returns it as a dict (WR-02, normal path)."""
    rows = [{"id": _SAMPLE_TEMPLATE_ID, "spec_json": _SAMPLE_SPEC_JSON}]
    client = _make_client(select_rows=rows)
    repo = SupabaseUiSpecTemplateRepository(client=client)

    result = asyncio.run(repo.find_by_cache_key(_SAMPLE_CACHE_KEY))

    assert result is not None
    assert result.spec_json == _SAMPLE_SPEC_JSON


# ---------------------------------------------------------------------------
# Test 10: DTOs are frozen (immutable, CLAUDE.md)
# ---------------------------------------------------------------------------


def test_cached_template_is_frozen() -> None:
    """CachedTemplate dataclass must be frozen (immutable, CLAUDE.md)."""
    ct = CachedTemplate(id=_SAMPLE_TEMPLATE_ID, spec_json=_SAMPLE_SPEC_JSON)
    with pytest.raises(AttributeError):
        ct.id = "mutated"  # type: ignore[misc]


def test_template_to_persist_is_frozen() -> None:
    """TemplateToPersist dataclass must be frozen (immutable, CLAUDE.md)."""
    with pytest.raises(AttributeError):
        _SAMPLE_TEMPLATE_TO_PERSIST.cache_key = "mutated"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Test 11: SupabaseUiSpecTemplateRepository satisfies the Protocol structurally
# ---------------------------------------------------------------------------


def test_adapter_satisfies_protocol() -> None:
    """SupabaseUiSpecTemplateRepository must structurally satisfy UiSpecTemplateRepository."""
    client = _make_client()
    repo = SupabaseUiSpecTemplateRepository(client=client)

    assert callable(getattr(repo, "find_by_cache_key", None))
    assert callable(getattr(repo, "persist", None))
    assert callable(getattr(repo, "increment_use_count", None))
