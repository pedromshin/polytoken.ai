"""ChatWidgetInteractionRepository port — chat_widget_interactions persistence (DCUI-03/04).

Phase 24-01 (D-01, D-10, D-11, D-12): the safety-primitive spine for agent<->user
widget round-trips. A `WidgetInteraction` mirrors one chat_widget_interactions row
exactly — the AUTHORITATIVE mutable lifecycle state + STORED declared response
schema + submitted value (never the immutable-as-emitted `interactive_widget`
message part, which only carries the interactionId — see 24-CONTEXT.md
<interfaces>).

- create_pending: inserts a row with state='pending' at emit time.
- get: returns a row by id, or None. Does NOT enforce conversation ownership —
  callers (the submit endpoint, a later plan) check that separately.
- try_submit: the DB-level double-submit lock (D-11). A conditional
  pending->submitted UPDATE; returns True only when exactly one row flipped.
  A second call against an already-submitted/superseded/stale row returns
  False (rowcount 0) — client-side disable is cosmetic only.
- is_stale: True when the emitting message is no longer the active sibling
  (a regenerate switched siblings) OR a strictly-newer turn_index exists in
  the conversation (D-12).

Immutability (CLAUDE.md): WidgetInteraction is a frozen dataclass.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

WidgetInteractionState = Literal["pending", "submitted", "superseded", "stale"]
WidgetKind = Literal["proposal_cards", "clarify_widget", "confirm_action"]


@dataclass(frozen=True)
class WidgetInteraction:
    """One chat_widget_interactions row (D-01/D-10/D-11/D-12)."""

    id: str
    conversation_id: str
    message_id: str
    part_index: int
    turn_index: int
    widget_kind: WidgetKind
    declaration: dict[str, Any]
    declared_response_schema: dict[str, Any]
    state: WidgetInteractionState
    sibling_group_id: str | None = None
    submitted_value: dict[str, Any] | None = None


class ChatWidgetInteractionRepository(Protocol):
    """Port for chat_widget_interactions reads/writes."""

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
        """Insert a new pending chat_widget_interactions row and return it (id populated).

        interaction_id (Phase 24-02 addition, additive/optional): the interactive_widget
        message part's `interactionId` field is the client-visible FK to this row, and it
        must be embedded in the part BEFORE this row exists (the part is persisted first,
        as part of the assistant chat_messages insert). When provided, the caller
        pre-generated this id so the part and the row share it. Falls back to the column's
        own `DEFAULT gen_random_uuid()` (24-01's original contract) when omitted.
        """
        ...

    async def get(self, interaction_id: str) -> WidgetInteraction | None:
        """Return the interaction row by id, or None if it does not exist."""
        ...

    async def try_submit(self, interaction_id: str, submitted_value: dict[str, Any]) -> bool:
        """Conditionally UPDATE pending->submitted (D-11 CAS).

        Returns True only when exactly one row transitioned; False when the
        row was already submitted/superseded/stale (the DB-level double-submit
        lock — a second submit matches zero rows).
        """
        ...

    async def is_stale(self, interaction: WidgetInteraction) -> bool:
        """True when the emitting message is inactive or a newer turn exists (D-12)."""
        ...

    async def supersede_pending(self, conversation_id: str) -> int:
        """Transition every state='pending' row in conversation_id to 'superseded' (D-02).

        Phase 24-04: called by RunChatTurn.run() immediately after inserting
        a new user text message — typing durably supersedes any pending
        widget server-side, so the state survives reload. NOT called by
        regenerate() (a regenerate is not typing; D-12's staleness covers
        that path instead). Returns the number of rows transitioned.
        """
        ...
