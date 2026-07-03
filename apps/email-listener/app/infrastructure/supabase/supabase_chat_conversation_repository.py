"""SupabaseChatConversationRepository — the turn loop's one chat_conversations write (D-10, D-12).

Rule 2 addition (not in the 22-06 plan's literal files_modified list): the turn
loop needs to remember the last-used model (D-10) and set the first-turn
snippet title (D-12) directly from Python, without a round-trip through the
web-owned tRPC conversation CRUD surface (22-05). See 22-06-SUMMARY.md.

WR-06: supabase-py's Client is synchronous; the blocking call is offloaded to a
thread-pool worker via asyncio.to_thread().
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from supabase import Client

_TABLE = "chat_conversations"


class SupabaseChatConversationRepository:
    """Supabase implementation of ChatConversationRepository over chat_conversations."""

    def __init__(self, *, client: Client) -> None:
        self._client = client

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        row: dict[str, Any] = {"model_id": model_id, "updated_at": datetime.now(UTC).isoformat()}
        if title is not None:
            row["title"] = title
        await asyncio.to_thread(
            lambda: self._client.table(_TABLE).update(row).eq("id", conversation_id).execute()
        )
