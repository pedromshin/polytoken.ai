"""Tests for SupabaseHomeCanvasLayoutWriter (Phase 74, MORN-04).

MORN-04: the writer persists a snapshot keyed on the EXPLICIT payload user_id
(never a session), stamps ``scope='home'`` + a NULL ``conversation_id``, and is
tenancy-safe — a write for user A can never land on user B's home row. Two users
therefore produce two distinct rows; the same user twice overwrites in place
(whole-snapshot LWW).

Backed by a small STATEFUL fake of the supabase-py fluent client (select / insert
/ update / eq / limit / execute over an in-memory row list) so the keying and the
two-rows / LWW invariants are proven end-to-end without a live Postgres.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

from app.domain.canvas.snapshot import CanvasNode, CanvasSnapshot
from app.infrastructure.supabase.home_canvas_layout_writer import SupabaseHomeCanvasLayoutWriter


class _FakeTable:
    """A one-shot fluent query builder over a shared in-memory row list."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._op: str | None = None
        self._payload: dict[str, Any] | None = None
        self._filters: list[tuple[str, Any]] = []

    def select(self, _columns: str) -> _FakeTable:
        self._op = "select"
        return self

    def insert(self, row: dict[str, Any]) -> _FakeTable:
        self._op = "insert"
        self._payload = row
        return self

    def update(self, columns: dict[str, Any]) -> _FakeTable:
        self._op = "update"
        self._payload = columns
        return self

    def eq(self, column: str, value: Any) -> _FakeTable:
        self._filters.append((column, value))
        return self

    def limit(self, _n: int) -> _FakeTable:
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(row.get(col) == val for col, val in self._filters)

    def execute(self) -> SimpleNamespace:
        if self._op == "insert":
            assert self._payload is not None
            self._rows.append(dict(self._payload))
            return SimpleNamespace(data=[dict(self._payload)])
        if self._op == "select":
            matched = [row for row in self._rows if self._matches(row)]
            return SimpleNamespace(data=matched)
        if self._op == "update":
            assert self._payload is not None
            matched = [row for row in self._rows if self._matches(row)]
            for row in matched:
                row.update(self._payload)
            return SimpleNamespace(data=matched)
        raise AssertionError(f"unexpected op {self._op!r}")


class _FakeClient:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def table(self, _name: str) -> _FakeTable:
        return _FakeTable(self.rows)


def _snapshot(node_id: str) -> CanvasSnapshot:
    return CanvasSnapshot(
        nodes=(CanvasNode(id=node_id, type="brief", position_x=0.0, position_y=0.0, data={}),),
        edges=(),
        shared_state={},
        node_registry_version="home-v1",
        viewport=None,
    )


def test_write_stamps_user_id_and_home_scope() -> None:
    client = _FakeClient()
    writer = SupabaseHomeCanvasLayoutWriter(client=client)  # type: ignore[arg-type]

    asyncio.run(writer.write_home_snapshot("user-a", _snapshot("n-a")))

    assert len(client.rows) == 1
    row = client.rows[0]
    assert row["user_id"] == "user-a"
    assert row["scope"] == "home"
    assert row["conversation_id"] is None
    assert row["node_registry_version"] == "home-v1"
    assert row["nodes"][0]["id"] == "n-a"


def test_two_users_produce_two_distinct_rows() -> None:
    client = _FakeClient()
    writer = SupabaseHomeCanvasLayoutWriter(client=client)  # type: ignore[arg-type]

    asyncio.run(writer.write_home_snapshot("user-a", _snapshot("n-a")))
    asyncio.run(writer.write_home_snapshot("user-b", _snapshot("n-b")))

    assert len(client.rows) == 2
    by_user = {row["user_id"]: row for row in client.rows}
    assert set(by_user) == {"user-a", "user-b"}
    # Cross-tenant isolation: each user's row holds ONLY that user's node.
    assert by_user["user-a"]["nodes"][0]["id"] == "n-a"
    assert by_user["user-b"]["nodes"][0]["id"] == "n-b"


def test_same_user_twice_overwrites_in_place_lww() -> None:
    client = _FakeClient()
    writer = SupabaseHomeCanvasLayoutWriter(client=client)  # type: ignore[arg-type]

    asyncio.run(writer.write_home_snapshot("user-a", _snapshot("first")))
    asyncio.run(writer.write_home_snapshot("user-a", _snapshot("second")))

    # LWW: still exactly one home row for the user, carrying the latest snapshot.
    assert len(client.rows) == 1
    row = client.rows[0]
    assert row["user_id"] == "user-a"
    assert row["scope"] == "home"
    assert row["nodes"][0]["id"] == "second"
