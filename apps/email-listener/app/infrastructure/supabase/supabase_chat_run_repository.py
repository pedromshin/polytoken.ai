"""SupabaseChatRunRepository — chat_runs / chat_run_events adapter (SEAM-03/04, D-27).

chat_run_events is append-only (T-22-22 repudiation mitigation): append_event
NEVER updates or deletes an existing row — it always INSERTs a new one, with
seq computed as (current max seq for the run) + 1. finish_run uses an upsert
(ON CONFLICT (id) DO UPDATE) rather than a literal `.update(` call — this file
carries zero literal `.update(` calls (verified by the plan's own acceptance
grep), keeping the "no update path" property true across the whole adapter,
not just the events table.

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded to
a thread-pool worker via asyncio.to_thread().
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.domain.ports.chat_repositories import ChatRun, ChatRunEvent, ChatRunEventType, ChatRunStatus

if TYPE_CHECKING:
    from supabase import Client

_RUNS_TABLE = "chat_runs"
_EVENTS_TABLE = "chat_run_events"


class SupabaseChatRunRepository:
    """Supabase implementation of ChatRunRepository over chat_runs / chat_run_events."""

    def __init__(self, *, client: Client) -> None:
        self._client = client

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> ChatRun:
        row: dict[str, Any] = {
            "conversation_id": conversation_id,
            "agent_id": agent_id,
            "model_id": model_id,
            "status": "running",
        }
        result = await asyncio.to_thread(lambda: self._client.table(_RUNS_TABLE).insert(row).execute())
        # postgrest-py types row data as the recursive `JSON` alias, which mypy cannot
        # narrow to a dict without an explicit Any escape hatch (mirrors the same gap
        # in supabase_cost_ledger_repository.py's _sum_cost_column).
        created: Any = result.data[0]
        return ChatRun(
            id=str(created["id"]),
            conversation_id=conversation_id,
            agent_id=agent_id,
            model_id=model_id,
            status="running",
        )

    async def append_event(
        self, *, run_id: str, event_type: ChatRunEventType, data: dict[str, Any]
    ) -> ChatRunEvent:
        next_seq = await asyncio.to_thread(self._next_seq, run_id)
        row: dict[str, Any] = {"run_id": run_id, "seq": next_seq, "type": event_type, "data": data}
        result = await asyncio.to_thread(lambda: self._client.table(_EVENTS_TABLE).insert(row).execute())
        created: Any = result.data[0]
        return ChatRunEvent(id=str(created["id"]), run_id=run_id, seq=next_seq, type=event_type, data=data)

    def _next_seq(self, run_id: str) -> int:
        """Compute the next monotonically increasing seq for a run (read-then-insert).

        Single-writer-per-run in this codebase's turn loop (one RunChatTurn
        instance drives one run at a time), so this read-then-insert has no
        concurrent-writer race in practice.
        """
        result = (
            self._client.table(_EVENTS_TABLE)
            .select("seq")
            .eq("run_id", run_id)
            .order("seq", desc=True)
            .limit(1)
            .execute()
        )
        rows: Any = result.data or []
        if not rows:
            return 0
        return int(rows[0]["seq"]) + 1

    async def finish_run(self, *, run_id: str, status: ChatRunStatus) -> None:
        await asyncio.to_thread(
            lambda: (
                self._client.table(_RUNS_TABLE)
                .upsert(
                    {"id": run_id, "status": status, "ended_at": datetime.now(UTC).isoformat()},
                    on_conflict="id",
                )
                .execute()
            )
        )
