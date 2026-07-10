"""SupabaseChatConversationRepository — chat_conversations reads/writes.

touch() is the turn loop's one write (D-10, D-12): a Rule 2 addition (not in
the 22-06 plan's literal files_modified list) so the turn loop can remember
the last-used model (D-10) and set the first-turn snippet title (D-12)
directly from Python, without a round-trip through the web-owned tRPC
conversation CRUD surface (22-05). See 22-06-SUMMARY.md.

owner_user_id() (Phase 44-09, TENA-03 gap closure) is a single-column read
backing the presentation-layer's fail-closed ownership gate
(assert_conversation_owned in chat_stream.py) — never a join.

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded
to a thread-pool worker via asyncio.to_thread().
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

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

    async def owner_user_id(self, conversation_id: str) -> str | None:
        """Return the owning user_id for conversation_id, or None if the row does not exist.

        Single-column equality read on chat_conversations.user_id (NOT NULL,
        migrations 0031-0033) — never a join. A null column value (should
        never happen given the NOT NULL constraint, but treated defensively)
        also resolves to None — fail-closed/unowned rather than raising.
        """
        response = await asyncio.to_thread(
            lambda: self._client.table(_TABLE).select("user_id").eq("id", conversation_id).limit(1).execute()
        )
        rows = response.data
        if not rows:
            return None
        row = cast("dict[str, Any]", rows[0])
        user_id = row.get("user_id")
        return str(user_id) if user_id is not None else None
