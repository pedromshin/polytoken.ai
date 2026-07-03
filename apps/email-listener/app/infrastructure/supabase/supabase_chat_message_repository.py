"""SupabaseChatMessageRepository — chat_messages adapter (FOUND-1, D-16, D-18).

Unlike the audit/ledger repos in this codebase, message persistence is NOT
best-effort: a chat turn's user/assistant messages are the core correctness
data of the feature (T-22-22 — "the partial is never silently dropped"), so
every method here PROPAGATES exceptions rather than swallowing them.

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded to
a thread-pool worker via asyncio.to_thread() so the event loop stays free
during the network round-trip.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from app.domain.ports.chat_repositories import ChatMessage, ChatMessageRole, ChatMessageStatus

if TYPE_CHECKING:
    from supabase import Client

_TABLE = "chat_messages"


def _to_row(
    *,
    conversation_id: str,
    role: ChatMessageRole,
    parts: Sequence[dict[str, Any]],
    turn_index: int,
    status: ChatMessageStatus,
    run_id: str | None,
    sibling_group_id: str | None,
    version: int,
    is_active: bool,
) -> dict[str, Any]:
    """Map insert_message's arguments to the chat_messages column dict.

    Returns a new dict — never mutates any input (CLAUDE.md immutability).
    """
    return {
        "conversation_id": conversation_id,
        "run_id": run_id,
        "role": role,
        "parts": list(parts),
        "turn_index": turn_index,
        "sibling_group_id": sibling_group_id,
        "version": version,
        "is_active": is_active,
        "status": status,
    }


def _row_to_entity(row: Any) -> ChatMessage:
    """Map a chat_messages row dict back into the immutable ChatMessage entity.

    ``row`` is typed ``Any`` rather than ``dict[str, Any]``: postgrest-py's
    ``APIResponse.data`` is typed as ``list[JSON]`` (a recursive JSON value
    union) which mypy cannot narrow to a per-row dict without an explicit
    escape hatch (mirrors the same gap in supabase_cost_ledger_repository.py).
    """
    raw_parts = row.get("parts") or []
    return ChatMessage(
        id=str(row["id"]),
        conversation_id=str(row["conversation_id"]),
        role=row["role"],
        parts=tuple(raw_parts),
        turn_index=int(row["turn_index"]),
        status=row["status"],
        run_id=str(row["run_id"]) if row.get("run_id") else None,
        sibling_group_id=str(row["sibling_group_id"]) if row.get("sibling_group_id") else None,
        version=int(row["version"]),
        is_active=bool(row["is_active"]),
    )


class SupabaseChatMessageRepository:
    """Supabase implementation of ChatMessageRepository over chat_messages.

    Satisfies the ChatMessageRepository Protocol structurally (no explicit
    inheritance — keeps the domain port lint-imports clean, matching every
    other adapter in this codebase).
    """

    def __init__(self, *, client: Client) -> None:
        self._client = client

    async def insert_message(
        self,
        *,
        conversation_id: str,
        role: ChatMessageRole,
        parts: Sequence[dict[str, Any]],
        turn_index: int,
        status: ChatMessageStatus = "completed",
        run_id: str | None = None,
        sibling_group_id: str | None = None,
        version: int = 1,
        is_active: bool = True,
    ) -> ChatMessage:
        row = _to_row(
            conversation_id=conversation_id,
            role=role,
            parts=parts,
            turn_index=turn_index,
            status=status,
            run_id=run_id,
            sibling_group_id=sibling_group_id,
            version=version,
            is_active=is_active,
        )
        result = await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(row).execute())
        return _row_to_entity(result.data[0])

    async def list_active_context(self, conversation_id: str) -> list[ChatMessage]:
        result = await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .select("*")
                .eq("conversation_id", conversation_id)
                .eq("is_active", True)
                .order("turn_index")
                .execute()
            )
        )
        return [_row_to_entity(row) for row in (result.data or [])]

    async def mark_status(self, message_id: str, status: ChatMessageStatus) -> None:
        await asyncio.to_thread(
            lambda: self._client.table(_TABLE).update({"status": status}).eq("id", message_id).execute()
        )

    async def set_sibling_inactive(self, sibling_group_id: str) -> None:
        await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .update({"is_active": False})
                .eq("sibling_group_id", sibling_group_id)
                .execute()
            )
        )
