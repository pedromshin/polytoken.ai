"""Regression tests for SupabaseChatRunRepository.finish_run (live bug 2026-07-04).

finish_run originally used a partial-row `.upsert({id, status, ended_at})` —
Postgres checks NOT NULL constraints on the candidate insert tuple BEFORE
ON CONFLICT resolution, so every finish_run violated
chat_runs.conversation_id NOT NULL in the live database. The fix is a real
UPDATE scoped by id; these tests pin that shape.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.infrastructure.supabase.supabase_chat_run_repository import SupabaseChatRunRepository


def _make_client() -> tuple[MagicMock, MagicMock]:
    client = MagicMock()
    table = MagicMock()
    client.table.return_value = table
    table.update.return_value = table
    table.eq.return_value = table
    table.execute.return_value = MagicMock(data=[])
    return client, table


@pytest.mark.unit
@pytest.mark.asyncio
async def test_finish_run_uses_update_scoped_by_id_not_upsert() -> None:
    client, table = _make_client()
    repo = SupabaseChatRunRepository(client=client)

    await repo.finish_run(run_id="run-123", status="completed")

    client.table.assert_called_once_with("chat_runs")
    table.upsert.assert_not_called()
    table.update.assert_called_once()
    payload: dict[str, Any] = table.update.call_args.args[0]
    assert payload["status"] == "completed"
    assert "ended_at" in payload
    # A partial-row write must NEVER travel the insert path — no id in the
    # payload (it is the .eq() filter), no conversation_id nulls possible.
    assert "id" not in payload
    table.eq.assert_called_once_with("id", "run-123")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_finish_run_records_terminal_status_verbatim() -> None:
    client, table = _make_client()
    repo = SupabaseChatRunRepository(client=client)

    await repo.finish_run(run_id="run-9", status="failed")

    payload: dict[str, Any] = table.update.call_args.args[0]
    assert payload["status"] == "failed"
