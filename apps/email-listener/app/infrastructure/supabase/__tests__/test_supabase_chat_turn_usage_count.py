"""Tests for SupabaseChatMessageRepository.count_monthly_chat_turns_used (vLAUNCH W5-1).

The listener-side mirror of packages/api-client/src/router/_chat-turn-usage.ts's
countMonthlyChatTurnsUsed — the ONE counting semantics both gates share:
ACTIVE (is_active=true) role='user' chat_messages rows joined (PostgREST
`!inner` embed) to chat_conversations owned by the user, created_at >= the 1st
of the current UTC month. Covers: the exact filter set (W6-L: a head=True HEAD
request — count from Content-Range, no row body, no .limit(1)), the UTC
month-boundary window, and a missing count RAISING (never read as a real 0).
Errors PROPAGATE (the module's non-best-effort contract) — the RunChatTurn
gate owns the fail-open wrapping.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.infrastructure.supabase.supabase_chat_message_repository import SupabaseChatMessageRepository


def _make_count_table(*, count: int | None) -> MagicMock:
    """Chainable fluent-builder mock whose .execute() reports a PostgREST count."""
    table = MagicMock()
    table.select.return_value = table
    table.eq.return_value = table
    table.gte.return_value = table
    table.limit.return_value = table
    table.execute.return_value = MagicMock(data=[], count=count)
    return table


def _make_client(table: MagicMock) -> MagicMock:
    client = MagicMock()
    client.table.return_value = table
    return client


@pytest.mark.unit
@pytest.mark.asyncio
async def test_count_filters_mirror_the_ts_meter_semantics() -> None:
    table = _make_count_table(count=42)
    repo = SupabaseChatMessageRepository(client=_make_client(table))

    used = await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 7, 15, 30, tzinfo=UTC))

    assert used == 42
    # The join to the owning conversation rides a PostgREST !inner embed with
    # an exact server-side count — never a fetched-rows length. W6-L: head=True
    # makes it a HEAD request (count only, no row body), so no .limit(1) either.
    select_args, select_kwargs = table.select.call_args
    assert select_args == ("id, chat_conversations!inner(user_id)",)
    assert select_kwargs == {"count": "exact", "head": True}
    table.limit.assert_not_called()
    eq_calls = {call.args for call in table.eq.call_args_list}
    assert ("chat_conversations.user_id", "user-1") in eq_calls
    assert ("role", "user") in eq_calls
    assert ("is_active", True) in eq_calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_count_window_starts_at_the_first_of_the_current_utc_month() -> None:
    table = _make_count_table(count=0)
    repo = SupabaseChatMessageRepository(client=_make_client(table))

    await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 31, 23, 59, 59, tzinfo=UTC))

    gte_args: tuple[Any, ...] = table.gte.call_args.args
    assert gte_args == ("created_at", datetime(2026, 8, 1, tzinfo=UTC).isoformat())


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_count_raises_so_the_gate_fails_open_upstream() -> None:
    # W6-L: a HEAD+exact response with no count is an anomaly, never a real 0 —
    # reading it as 0 would silently pretend a fresh month. The raise reaches
    # RunChatTurn's gate, which fails OPEN (logged), same net posture as any
    # other count-query error.
    table = _make_count_table(count=None)
    repo = SupabaseChatMessageRepository(client=_make_client(table))

    with pytest.raises(RuntimeError, match="no exact count"):
        await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 7, tzinfo=UTC))
