"""The monthlyChatTurns pre-insert gate (vLAUNCH W5-1 / W6-L; carved from run_chat_turn.py, W7-1).

Listener-side ENFORCEMENT mirror of packages/api-client/src/router/chat/
turn-cap.ts, applied to the server-locus chat path ONLY (RunChatTurn.run(),
the one entrypoint that inserts the role='user' row the shared meter
counts). Policy + message live in app.domain.services.chat_turn_cap; this
module owns the fail-open owner/tier/count lookups, the decision, and the
ONE un-persisted rejection event. Moved VERBATIM out of RunChatTurn — the
instance collaborators became explicit keyword parameters, nothing else
changed.

Architecture contract (lint-imports): imports only domain ports/services and
standard library / structlog — same as the facade.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

from app.domain.ports.chat_repositories import ChatRunEvent
from app.domain.services.chat_turn_cap import (
    CHAT_TURN_CAP_MESSAGE,
    MONTHLY_CHAT_TURNS_BREACHED_CAP,
    as_known_tier,
    decide_chat_turn_cap,
)

if TYPE_CHECKING:
    from app.domain.ports.chat_repositories import ChatConversationRepository
    from app.domain.ports.chat_turn_usage_repository import ChatTurnUsageRepository
    from app.domain.ports.tier_resolver import UserTierResolver

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class _ChatTurnCapGateOutcome:
    """Outcome of the pre-insert monthlyChatTurns gate (vLAUNCH W5-1 / W6-L).

    `rejection` is the ONE un-persisted 'cost_capped' event to yield (FREE
    tier at/over cap), or None when the turn may proceed. `over_limit` is
    True ONLY for an ALLOWED paid tier at/over its finite cap — run() threads
    it through _execute_turn so the terminal 'completed' event surfaces the
    marker additively (existing clients ignore unknown fields). A fail-open /
    unwired / blocked outcome always carries over_limit=False (a blocked
    turn never reaches 'completed', so the marker would be meaningless).
    """

    rejection: ChatRunEvent | None
    over_limit: bool


async def _chat_turn_cap_gate(
    *,
    conversation_id: str,
    conversations: ChatConversationRepository,
    user_tiers: UserTierResolver | None,
    chat_turn_usage: ChatTurnUsageRepository | None,
) -> _ChatTurnCapGateOutcome:
    """The monthlyChatTurns pre-insert gate — MIRROR of enforceChatTurnCap (vLAUNCH W5-1).

    Policy mirror of packages/api-client/src/router/chat/turn-cap.ts,
    applied to the server-locus chat path ONLY (run(); regenerate/
    continue_after_widget never insert a role='user' row, so they never
    consume a turn and are not gated — matching the TS meter's unit).

    The outcome carries the ONE un-persisted rejection event to yield when
    the FREE tier is at/over its cap (the same pre-turn BLOCK mechanism as
    the cost breaker: chat_run_events.run_id is NOT NULL, so a turn
    rejected before a run exists yields an in-memory event carrying the
    friendly message in `data`), or rejection=None when the turn may
    proceed — plus the over_limit marker for an ALLOWED paid tier at/over
    its finite cap (W6-L: threaded to the terminal 'completed' event, no
    longer log-only).

    FAIL-OPEN on ANY owner/tier/count lookup failure — an outage must
    never lock users out of chat; only the deliberate free-at-cap
    decision blocks (turn-cap.ts's exact posture). Unwired collaborators
    (either None) leave the gate structurally OFF. The user id is
    SERVER-resolved from the conversation owner — never client input.
    """
    if user_tiers is None or chat_turn_usage is None:
        return _ChatTurnCapGateOutcome(rejection=None, over_limit=False)
    try:
        owner_user_id = await conversations.owner_user_id(conversation_id)
        if owner_user_id is None:
            # The transport's ownership gate 404s a non-owned/absent
            # conversation before run() starts, so an unresolvable owner
            # here is an anomaly — fail open, never lock chat.
            logger.warning("chat_turn_cap_owner_missing_failing_open", conversation_id=conversation_id)
            return _ChatTurnCapGateOutcome(rejection=None, over_limit=False)
        # W6-L: the tier and count reads are independent — run them
        # concurrently (one round-trip of latency, not two). gather sits
        # INSIDE the same fail-open try, so the degradation is identical:
        # ANY exception from either read -> fail open, logged below.
        raw_tier, used = await asyncio.gather(
            user_tiers.tier_for_user(owner_user_id),
            chat_turn_usage.count_monthly_chat_turns_used(owner_user_id),
        )
        tier = as_known_tier(raw_tier)
        decision = decide_chat_turn_cap(tier, used)
    except Exception:
        # FAIL-OPEN for everyone (mirror of enforceChatTurnCap's catch).
        logger.warning("chat_turn_cap_check_failed_failing_open", conversation_id=conversation_id, exc_info=True)
        return _ChatTurnCapGateOutcome(rejection=None, over_limit=False)
    if decision.allowed:
        if decision.over_limit:
            # Paid tier at/over its finite cap — allowed by policy
            # (PRO/POWER are never hard-blocked); logged for the meter
            # AND surfaced on the terminal 'completed' event (W6-L).
            logger.info("chat_turn_cap_over_limit_allowed", user_id=owner_user_id, tier=tier, used=used)
        return _ChatTurnCapGateOutcome(rejection=None, over_limit=decision.over_limit)
    # Server-side detail; the client only ever sees CHAT_TURN_CAP_MESSAGE.
    logger.warning("chat_turn_cap_blocked", user_id=owner_user_id, tier=tier, used=used)
    return _ChatTurnCapGateOutcome(
        rejection=ChatRunEvent(
            type="cost_capped",
            data={"breached_cap": MONTHLY_CHAT_TURNS_BREACHED_CAP, "message": CHAT_TURN_CAP_MESSAGE},
        ),
        over_limit=False,
    )
