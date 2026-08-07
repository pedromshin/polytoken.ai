"""ChatTurnUsageRepository port — the monthlyChatTurns meter's count (vLAUNCH W5-1).

The Python half of the ONE definition of "how many monthly chat turns has this
user used" — mirroring packages/api-client/src/router/_chat-turn-usage.ts's
countMonthlyChatTurnsUsed byte-for-byte in semantics:

  ACTIVE user-role chat_messages rows in the user's OWN conversations
  (chat_messages.conversation_id -> chat_conversations.user_id = user_id)
  with created_at >= the 1st of the current UTC month.

  - role = 'user': assistant/system rows never count — a "turn" is the user's
    send, not the model's reply.
  - is_active = true: only the active sibling of a regenerated/edited turn
    counts (logical turns, not row count).
  - UTC month window: the allowance resets at 00:00 UTC on the 1st
    (app.domain.services.chat_turn_cap.start_of_current_utc_month).

STRICTLY caller-scoped: implementations must count against a SERVER-resolved
user id (RunChatTurn derives it from the conversation owner), never client
input. Failure policy is deliberately NOT decided here — implementations RAISE
on any query error; the caller (RunChatTurn's chat-turn cap gate) FAILS OPEN,
mirroring turn-cap.ts's posture (an outage must never lock users out of chat).
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class ChatTurnUsageRepository(Protocol):
    """Count a user's chat turns used in the current UTC month (see module doc)."""

    async def count_monthly_chat_turns_used(self, user_id: str, *, now: datetime | None = None) -> int:
        """The user's active user-role message count since the UTC month start.

        `now` is injectable for deterministic tests only; production callers
        omit it. RAISES on a genuine query error (the gate fails open).
        """
        ...
