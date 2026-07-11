"""SupabaseChatWidgetInteractionRepository — chat_widget_interactions adapter.

Phase 24-01 (D-01, D-10, D-11, D-12): the DB-level safety-primitive spine for
agent<->user widget round-trips.

Like `SupabaseChatMessageRepository`, this is NOT best-effort — a pending
widget's stored declared schema and its double-submit lock are correctness
data, so every method here PROPAGATES exceptions rather than swallowing them.

try_submit is the DB-level compare-and-swap (D-11): the conditional UPDATE
carries BOTH `eq("id", interaction_id)` AND `eq("state", "pending")`.
Postgres only updates rows matching every `eq()` predicate, so a second
submit against an already-submitted/superseded/stale row matches zero rows —
`try_submit` returns False without any read-then-write race window.

is_stale (D-12) queries chat_messages directly: the emitting message's
`is_active` flag (a regenerate that switched the active sibling flips this to
False) and whether a strictly-newer `turn_index` exists in the same
conversation (a later turn superseded this pending widget).

supersede_pending (Phase 24-04, D-02) is a conditional UPDATE mirroring
try_submit's own idiom: `eq("conversation_id", ...)` + `eq("state", "pending")`
— every pending row in the conversation flips to `superseded` in one
statement (typing supersedes durably, survives reload).

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded
to a thread-pool worker via asyncio.to_thread().
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction, WidgetKind

if TYPE_CHECKING:
    from supabase import Client

_TABLE = "chat_widget_interactions"
_MESSAGES_TABLE = "chat_messages"


def _row_to_entity(row: Any) -> WidgetInteraction:
    """Map a chat_widget_interactions row dict back into the immutable entity.

    ``row`` is typed ``Any`` rather than ``dict[str, Any]``: postgrest-py's
    ``APIResponse.data`` is typed as ``list[JSON]`` (a recursive JSON value
    union) which mypy cannot narrow to a per-row dict without an explicit
    escape hatch (mirrors the same gap in supabase_chat_message_repository.py).
    """
    return WidgetInteraction(
        id=str(row["id"]),
        conversation_id=str(row["conversation_id"]),
        message_id=str(row["message_id"]),
        part_index=int(row["part_index"]),
        turn_index=int(row["turn_index"]),
        sibling_group_id=str(row["sibling_group_id"]) if row.get("sibling_group_id") else None,
        widget_kind=row["widget_kind"],
        declaration=dict(row.get("declaration") or {}),
        declared_response_schema=dict(row.get("declared_response_schema") or {}),
        state=row["state"],
        submitted_value=dict(row["submitted_value"]) if row.get("submitted_value") else None,
    )


class SupabaseChatWidgetInteractionRepository:
    """Supabase implementation of ChatWidgetInteractionRepository over chat_widget_interactions.

    Satisfies the ChatWidgetInteractionRepository Protocol structurally (no
    explicit inheritance) — matches every other adapter in this codebase.
    """

    def __init__(self, *, client: Client) -> None:
        self._client = client

    async def create_pending(
        self,
        *,
        conversation_id: str,
        message_id: str,
        part_index: int,
        turn_index: int,
        widget_kind: WidgetKind,
        declaration: dict[str, Any],
        declared_response_schema: dict[str, Any],
        sibling_group_id: str | None = None,
        interaction_id: str | None = None,
    ) -> WidgetInteraction:
        row: dict[str, Any] = {
            "conversation_id": conversation_id,
            "message_id": message_id,
            "part_index": part_index,
            "turn_index": turn_index,
            "sibling_group_id": sibling_group_id,
            "widget_kind": widget_kind,
            "declaration": declaration,
            "declared_response_schema": declared_response_schema,
            "state": "pending",
        }
        # Phase 24-02: when the caller pre-generated the id (so it can be embedded
        # in the interactive_widget part's interactionId before this row exists),
        # pass it through explicitly instead of relying on gen_random_uuid().
        if interaction_id is not None:
            row["id"] = interaction_id
        result = await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(row).execute())
        return _row_to_entity(result.data[0])

    async def get(self, interaction_id: str) -> WidgetInteraction | None:
        result = await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .select("*")
                .eq("id", interaction_id)
                .limit(1)
                .execute()
            )
        )
        rows = result.data or []
        if not rows:
            return None
        return _row_to_entity(rows[0])

    async def try_submit(self, interaction_id: str, submitted_value: dict[str, Any]) -> bool:
        result = await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .update(
                    {
                        "state": "submitted",
                        "submitted_value": submitted_value,
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                )
                .eq("id", interaction_id)
                .eq("state", "pending")
                .execute()
            )
        )
        return len(result.data or []) == 1

    async def is_stale(self, interaction: WidgetInteraction) -> bool:
        message_result = await asyncio.to_thread(
            lambda: (
                self._client.table(_MESSAGES_TABLE)
                .select("is_active")
                .eq("id", interaction.message_id)
                .limit(1)
                .execute()
            )
        )
        message_rows = message_result.data or []
        first_message_row = message_rows[0] if message_rows else None
        if isinstance(first_message_row, dict) and not bool(first_message_row.get("is_active", True)):
            return True

        newer_turn_result = await asyncio.to_thread(
            lambda: (
                self._client.table(_MESSAGES_TABLE)
                .select("id")
                .eq("conversation_id", interaction.conversation_id)
                .gt("turn_index", interaction.turn_index)
                .limit(1)
                .execute()
            )
        )
        return bool(newer_turn_result.data)

    async def supersede_pending(self, conversation_id: str) -> int:
        result = await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .update({"state": "superseded", "updated_at": datetime.now(UTC).isoformat()})
                .eq("conversation_id", conversation_id)
                .eq("state", "pending")
                .execute()
            )
        )
        return len(result.data or [])
