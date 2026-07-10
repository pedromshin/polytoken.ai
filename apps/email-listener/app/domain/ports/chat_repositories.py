"""Chat persistence ports — chat_messages / chat_runs / chat_run_events / chat_conversations.

Phase 22-06 (FOUND-1, D-16, D-18, SEAM-03/04, D-27, D-10, D-12): the Python-side
persistence ports RunChatTurn writes through. Frozen entities mirror the Drizzle
columns from 22-01 (chat_messages / chat_runs / chat_run_events / chat_conversations)
exactly — no shape drift between the TS schema and this Python domain model.

- ChatMessageRepository: insert_message / list_active_context / mark_status /
  set_sibling_inactive. Regenerate (D-16) uses set_sibling_inactive to retire an
  assistant turn's prior sibling versions before a new active version is inserted.
- ChatRunRepository: create_run / append_event / finish_run. chat_run_events is
  append-only (T-22-22 repudiation mitigation) — the adapter must NEVER update or
  delete a run_event row; append_event always writes a NEW row with an
  incremented seq.
- ChatConversationRepository: touch() — the ONLY chat_conversations write the
  turn loop needs (D-10 remembered model + D-12 first-turn snippet title). Full
  conversation CRUD (create/list/rename/delete) is a separate, web-owned surface
  (tRPC/Drizzle, 22-05); this port lets the PYTHON turn loop update the same row's
  model_id/updated_at/title without an HTTP round-trip back through Next.js. Not
  named in the 22-06 plan's Task 1 action text — added here (Rule 2: missing
  critical functionality) because the plan's own must_haves truth ("conversation
  title is set ... and conversation.model_id + updated_at are updated") requires
  it and no such port existed yet (see 22-06-SUMMARY.md deviations).

Immutability (CLAUDE.md): every entity is a frozen dataclass; `parts` is a tuple,
never a list, so a caller cannot mutate a persisted message's content in place.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

ChatMessageRole = Literal["user", "assistant", "system"]
ChatMessageStatus = Literal["streaming", "completed", "stopped", "failed", "cost_capped", "interrupted"]
ChatRunStatus = Literal["running", "completed", "stopped", "failed", "cost_capped", "interrupted"]
ChatRunEventType = Literal[
    "started",
    "text_delta_checkpoint",
    "tool_call",
    "tool_result",
    "usage",
    "completed",
    "stopped",
    "failed",
    "cost_capped",
    "interrupted",
    # Phase 39 (TUI-01): "server_tool_call"/"server_tool_result" are
    # transport-only SSE mirror types for the in-progress/completed
    # tool-round UI affordance -- never passed to
    # ChatRunRepository.append_event, never part of the chat_run_events
    # table's CHECK constraint, no migration required (see
    # _run_server_tool_round's 2 non-persisted ChatRunEvent constructions).
    "server_tool_call",
    "server_tool_result",
]


@dataclass(frozen=True)
class ChatMessage:
    """One chat_messages row (FOUND-1 canonical typed-parts message, D-16 sibling-version).

    parts: the freely-interleaved Anthropic content-block tuple, stored verbatim
        as emitted (D-18). Empty for a partial that was cut off before any
        content streamed (e.g. an immediate cancel/failure).
    sibling_group_id: shared by every version of one assistant turn (D-16). None
        only for a role='user' row (users never have sibling versions).
    """

    id: str
    conversation_id: str
    role: ChatMessageRole
    parts: tuple[dict[str, Any], ...]
    turn_index: int
    status: ChatMessageStatus = "completed"
    run_id: str | None = None
    sibling_group_id: str | None = None
    version: int = 1
    is_active: bool = True


@dataclass(frozen=True)
class ChatRun:
    """One chat_runs row — one agent, one run per turn today (SEAM-04, D-27)."""

    id: str
    conversation_id: str
    agent_id: str
    model_id: str
    status: ChatRunStatus


@dataclass(frozen=True)
class ChatRunEvent:
    """One chat_run_events row (SEAM-03, D-27) — append-only, ordered by seq.

    id/run_id/seq are None for an in-memory event that was never persisted
    (the fail-closed pre-turn BLOCK path has no run row to attach an event to —
    chat_run_events.run_id is NOT NULL — so that single cost_capped event is
    yielded to the caller without a backing row).
    """

    type: ChatRunEventType
    data: dict[str, Any]
    id: str | None = None
    run_id: str | None = None
    seq: int | None = None


@dataclass(frozen=True)
class ChatConversation:
    """One chat_conversations row (only the fields the turn loop reads/writes)."""

    id: str
    title: str
    model_id: str


class ChatMessageRepository(Protocol):
    """Port for chat_messages reads/writes."""

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
        """Insert one new chat_messages row and return it (id populated)."""
        ...

    async def list_active_context(self, conversation_id: str) -> list[ChatMessage]:
        """Return ACTIVE-sibling messages for a conversation, ordered by turn_index ascending (D-16).

        Regenerated-but-retired sibling versions (is_active=False) are excluded —
        only the row a caller should feed into subsequent model context.
        """
        ...

    async def mark_status(self, message_id: str, status: ChatMessageStatus) -> None:
        """Update a single message row's status column in place."""
        ...

    async def set_sibling_inactive(self, sibling_group_id: str) -> None:
        """Mark every row sharing sibling_group_id as is_active=False (D-16 regenerate)."""
        ...


class ChatRunRepository(Protocol):
    """Port for chat_runs / chat_run_events reads/writes.

    append_event MUST NEVER update or delete an existing chat_run_events row
    (T-22-22) — every call inserts a new row with seq = previous max + 1.
    """

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> ChatRun:
        """Insert a new chat_runs row with status='running' and return it."""
        ...

    async def append_event(self, *, run_id: str, event_type: ChatRunEventType, data: dict[str, Any]) -> ChatRunEvent:
        """Insert one new, append-only chat_run_events row with a monotonically increasing seq."""
        ...

    async def finish_run(self, *, run_id: str, status: ChatRunStatus) -> None:
        """Set the run's terminal status + ended_at."""
        ...


class ChatConversationRepository(Protocol):
    """Port for chat_conversations reads/writes the turn loop and presentation layer perform.

    touch() is the turn loop's one write (D-10, D-12). owner_user_id (Phase
    44-09, TENA-03 gap closure) is a read used ONLY by the presentation
    layer's fail-closed ownership gate (assert_conversation_owned in
    chat_stream.py) — mirrors emails.py's `_assert_importer_owned` posture:
    never trust a client-supplied conversation_id for scoping without
    checking the caller actually owns it.
    """

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        """Update model_id + updated_at; also set title when provided (first-turn snippet)."""
        ...

    async def owner_user_id(self, conversation_id: str) -> str | None:
        """Return the owning user_id for conversation_id, or None if the row does not exist.

        Single-column read on chat_conversations.user_id (NOT NULL, migrations
        0031-0033) — never a join. Used exclusively by the presentation-layer
        fail-closed ownership gate; the domain/application layers never call
        this directly.
        """
        ...
