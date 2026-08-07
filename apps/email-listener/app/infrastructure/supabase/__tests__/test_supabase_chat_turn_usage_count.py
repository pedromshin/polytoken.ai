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

These are FLUENT-BUILDER MOCKS: they prove the query this code *asks for*, not
that PostgREST *answers* it. The embed actually resolving against real Postgres
is proven by tests/test_integration_real_postgres.py's
test_monthly_chat_turn_count_against_real_postgrest (vLAUNCH W9-3). Also
covered below: the dead-cap marker both raising paths emit, since the raise
itself is invisible once the gate fails open.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.infrastructure.supabase import supabase_chat_message_repository as repo_module
from app.infrastructure.supabase.__tests__._postgrest_mocks import make_client, make_table
from app.infrastructure.supabase.supabase_chat_message_repository import (
    CHAT_TURN_USAGE_COUNT_FAILED_EVENT,
    SupabaseChatMessageRepository,
)

# The chainable table/client mocks live in _postgrest_mocks.py (shared with
# test_supabase_chat_widget_interaction_repository.py); make_table(execute_count=...)
# models the PostgREST HEAD+exact count response (data=[], count=...).


@pytest.mark.unit
@pytest.mark.asyncio
async def test_count_filters_mirror_the_ts_meter_semantics() -> None:
    table = make_table(execute_count=42)
    repo = SupabaseChatMessageRepository(client=make_client(table))

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
    table = make_table(execute_count=0)
    repo = SupabaseChatMessageRepository(client=make_client(table))

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
    table = make_table(execute_count=None)
    repo = SupabaseChatMessageRepository(client=make_client(table))

    with pytest.raises(RuntimeError, match="no exact count"):
        await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 7, tzinfo=UTC))


# ---------------------------------------------------------------------------
# vLAUNCH W9-3: the dead-cap marker. A raise here is INVISIBLE downstream — the
# gate catches it and fails open — and the gate's own warning cannot say which
# of its two gathered reads failed. These tests pin the source-level marker so
# a dead cap is greppable instead of silent.
# ---------------------------------------------------------------------------


class _PostgrestApiError(Exception):
    """Stands in for the PGRST200 a broken `!inner` embed answers with."""


class _RecordingLogger:
    """Records structlog calls (mirrors _FakeLogger in test_sns_inbound_enqueue.py)."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def info(self, *_args: Any, **_kwargs: Any) -> None:
        pass

    def warning(self, *_args: Any, **_kwargs: Any) -> None:
        pass

    def error(self, event: str, **kwargs: Any) -> None:
        self.entries.append({"event": event, **kwargs})

    def exception(self, event: str, **kwargs: Any) -> None:
        self.entries.append({"event": event, **kwargs})


@pytest.mark.unit
@pytest.mark.asyncio
async def test_embed_failure_logs_the_dead_cap_marker_and_still_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The live failure this guards: PostgREST stops resolving the
    # chat_conversations!inner embed and answers 400. The gate then fails OPEN,
    # so nothing user-visible changes — the cap is just gone. The marker is the
    # only signal, so it must carry the reason and the user id.
    table = make_table(execute_count=0)
    table.execute.side_effect = _PostgrestApiError("PGRST200: could not find a relationship")
    recorder = _RecordingLogger()
    monkeypatch.setattr(repo_module, "logger", recorder)
    repo = SupabaseChatMessageRepository(client=make_client(table))

    with pytest.raises(_PostgrestApiError):  # still PROPAGATES — log-and-reraise
        await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 7, tzinfo=UTC))

    assert recorder.entries == [
        {
            "event": CHAT_TURN_USAGE_COUNT_FAILED_EVENT,
            "reason": "query_error",
            "user_id": "user-1",
            "month_start": datetime(2026, 8, 1, tzinfo=UTC).isoformat(),
        }
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_count_logs_the_dead_cap_marker_with_its_own_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = make_table(execute_count=None)
    recorder = _RecordingLogger()
    monkeypatch.setattr(repo_module, "logger", recorder)
    repo = SupabaseChatMessageRepository(client=make_client(table))

    with pytest.raises(RuntimeError, match="no exact count"):
        await repo.count_monthly_chat_turns_used("user-1", now=datetime(2026, 8, 7, tzinfo=UTC))

    assert [(e["event"], e["reason"]) for e in recorder.entries] == [
        (CHAT_TURN_USAGE_COUNT_FAILED_EVENT, "missing_exact_count")
    ]
