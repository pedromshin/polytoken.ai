"""Shared chainable PostgREST MagicMock builders (vLAUNCH W7-2 consolidation).

Merges the two fluent-builder mocks previously duplicated between
test_supabase_chat_widget_interaction_repository.py and
test_supabase_chat_turn_usage_count.py into one builder supporting the UNION
of their chains (insert/select/update/eq/gt/gte/order/desc/limit) and every
execute shape either suite needs: a single repeated data payload, a sequence
of data payloads consumed across calls, or a count/head response.

Not collected by pytest (python_files = test_*.py).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

_CHAIN_METHODS = ("insert", "select", "update", "eq", "gt", "gte", "order", "desc", "limit")

_UNSET = object()


def make_table(
    *,
    execute_data: Any = None,
    execute_sequence: list[Any] | None = None,
    execute_count: Any = _UNSET,
) -> MagicMock:
    """Chainable fluent-builder mock — every filter/select method returns itself.

    Pass ONE of:
    - `execute_data`: a single payload repeated on every .execute() call;
    - `execute_sequence`: return values consumed in order across multiple
      .execute() calls (e.g. is_stale's two sequential queries);
    - `execute_count`: a PostgREST count response (data=[], count=<value>) —
      pass None explicitly to model a HEAD+exact response missing its count.
    """
    table = MagicMock()
    for method in _CHAIN_METHODS:
        getattr(table, method).return_value = table
    if execute_sequence is not None:
        table.execute.side_effect = [MagicMock(data=d) for d in execute_sequence]
    elif execute_count is not _UNSET:
        table.execute.return_value = MagicMock(data=[], count=execute_count)
    else:
        table.execute.return_value = MagicMock(data=execute_data)
    return table


def make_client(tables: dict[str, MagicMock] | MagicMock) -> MagicMock:
    """Supabase client mock. Accepts one table (served for any name) or a name->table dict."""
    client = MagicMock()
    if isinstance(tables, dict):
        client.table.side_effect = lambda name: tables[name]
    else:
        client.table.return_value = tables
    return client
