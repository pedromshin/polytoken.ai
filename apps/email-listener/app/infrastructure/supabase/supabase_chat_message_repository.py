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
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Final

import structlog
from postgrest.types import CountMethod

from app.domain.ports.chat_repositories import ChatMessage, ChatMessageRole, ChatMessageStatus
from app.domain.services.chat_turn_cap import start_of_current_utc_month

if TYPE_CHECKING:
    from supabase import Client

logger = structlog.get_logger(__name__)

_TABLE = "chat_messages"

# THE dead-cap marker (vLAUNCH W9-3). count_monthly_chat_turns_used is this
# codebase's first PostgREST `!inner` embed: if the embed ever stops resolving
# (relationship not exposed by the schema cache, column renamed, RLS/grant
# change) PostgREST answers 400 and this method raises — at which point
# RunChatTurn's cap gate FAILS OPEN by design, so the free-tier cap is silently
# dead while every suite stays green. The gate's own
# `chat_turn_cap_check_failed_failing_open` warning cannot say WHICH read
# failed: it wraps an asyncio.gather over the tier lookup AND this count, so a
# broken embed is indistinguishable from a tier-resolver blip. This marker is
# emitted at the source, names the query, and is the one string to alert on.
CHAT_TURN_USAGE_COUNT_FAILED_EVENT: Final = "chat_turn_usage_count_query_failed"


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
    other adapter in this codebase). Also satisfies ChatTurnUsageRepository
    (vLAUNCH W5-1) — `count_monthly_chat_turns_used` is the listener half of
    the shared monthlyChatTurns meter.
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

    async def get_by_id(self, message_id: str) -> ChatMessage | None:
        result = await asyncio.to_thread(
            lambda: self._client.table(_TABLE).select("*").eq("id", message_id).maybe_single().execute()
        )
        if result is None or not result.data:
            return None
        return _row_to_entity(result.data)

    async def count_monthly_chat_turns_used(self, user_id: str, *, now: datetime | None = None) -> int:
        """ChatTurnUsageRepository (vLAUNCH W5-1) — the monthlyChatTurns meter's count.

        Mirrors packages/api-client/src/router/_chat-turn-usage.ts's
        countMonthlyChatTurnsUsed exactly: ACTIVE role='user' rows joined
        (PostgREST `!inner` embed on the conversation_id FK) to
        chat_conversations owned by *user_id*, created_at >= the 1st of the
        current UTC month. Server-side exact count via a HEAD request (W6-L:
        `head=True` — no row body is fetched at all, the count rides the
        Content-Range header; the `!inner` embed still applies the join
        filter). PROPAGATES exceptions like every other method here — and a
        response missing its count RAISES too (the RunChatTurn gate fails
        open on the raise) rather than masquerading as a real count of 0.

        BOTH raising paths first emit CHAT_TURN_USAGE_COUNT_FAILED_EVENT with
        a `reason` — see that constant: the raise alone is invisible once the
        gate fails open, so the marker is what makes a dead cap detectable.
        The exception still PROPAGATES unchanged (log-and-reraise; the port's
        contract and the gate's fail-open posture are untouched).
        """
        moment = now if now is not None else datetime.now(UTC)
        month_start = start_of_current_utc_month(moment)
        try:
            result = await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE)
                    .select("id, chat_conversations!inner(user_id)", count=CountMethod.exact, head=True)
                    .eq("chat_conversations.user_id", user_id)
                    .eq("role", "user")
                    .eq("is_active", True)
                    .gte("created_at", month_start.isoformat())
                    .execute()
                )
            )
        except Exception:
            # A 400 here means the `!inner` embed itself stopped resolving —
            # the cap is dead until this is fixed. Log loudly, then re-raise.
            logger.exception(
                CHAT_TURN_USAGE_COUNT_FAILED_EVENT,
                reason="query_error",
                user_id=user_id,
                month_start=month_start.isoformat(),
            )
            raise
        if result.count is None:
            logger.error(
                CHAT_TURN_USAGE_COUNT_FAILED_EVENT,
                reason="missing_exact_count",
                user_id=user_id,
                month_start=month_start.isoformat(),
            )
            msg = "count_monthly_chat_turns_used: PostgREST returned no exact count (head=True)"
            raise RuntimeError(msg)
        return int(result.count)

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
