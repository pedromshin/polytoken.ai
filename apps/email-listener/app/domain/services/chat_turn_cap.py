"""Chat-turn cap policy — the listener-side MIRROR of the web's turn-cap gate.

THE policy mirror of packages/api-client/src/router/chat/turn-cap.ts (vLAUNCH
ASSUMPTIONS A7: unflagged, chat path ONLY — mail ingest untouched). The TS gate
enforces the `monthlyChatTurns` entitlement on browser-locus turns (tRPC
mutations); this module is the SAME policy decision for server-locus turns —
RunChatTurn.run(), the FastAPI listener's chat path, which inserts the
role='user' row the shared meter counts. The two must never drift:

  - NUMBERS: app.domain.services.tier_entitlements.MONTHLY_CHAT_TURNS_BY_TIER
    (the hand-mirrored copy of @polytoken/billing's entitlements.ts — free 200
    / pro 2000 / power None=unlimited). Read here, never redefined.
  - COUNTING semantics live in the ChatTurnUsageRepository port (mirroring
    packages/api-client/src/router/_chat-turn-usage.ts): ACTIVE role='user'
    chat_messages rows in the user's OWN conversations, created_at >= the 1st
    of the current UTC month. `start_of_current_utc_month` below is the
    byte-mirror of that file's startOfCurrentUtcMonth.
  - POLICY (decide_chat_turn_cap — pure, I/O-free, mirrors decideChatTurnCap):
      FREE at/over its cap -> BLOCKED (the caller yields the friendly
        CHAT_TURN_CAP_MESSAGE; user id / tier / used are logged server-side
        only, never sent to the client).
      PRO/POWER -> NEVER hard-blocked. At/over a finite cap the decision
        carries over_limit=True (power's cap is None = unlimited, so it can
        never read over-limit at all).
      Unknown tier -> read as 'free' via as_known_tier (fail-closed for
        POLICY — an unrecognized tier must not accidentally read as paid).
  - FAILURE posture is owned by the CALLER (RunChatTurn's gate): FAIL OPEN on
    ANY tier/count/owner lookup error — an outage must never lock users out
    of chat. Only the deliberate free-at-cap decision ever blocks.

Pure domain: stdlib only, no infrastructure import.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from app.domain.services.tier_entitlements import monthly_chat_turns_for_tier

_FREE_TIER: Final = "free"

# User-facing block message (FREE tier at cap). Friendly by design — the
# server-side log carries the detail (user id, tier, used count). Mirrors the
# TS gate's CHAT_TURN_CAP_MESSAGE role in turn-cap.ts.
CHAT_TURN_CAP_MESSAGE: Final = (
    "You've used all of this month's included chat turns on the free plan. Upgrade to keep chatting."
)

# The `breached_cap` marker the rejection event carries — distinguishes this
# gate's pre-turn block from the cost breaker's ('per_turn'/'daily'/...).
MONTHLY_CHAT_TURNS_BREACHED_CAP: Final = "monthly_chat_turns"


@dataclass(frozen=True)
class ChatTurnCapDecision:
    """Mirror of turn-cap.ts's ChatTurnCapDecision."""

    # False ONLY for the free tier at/over its cap.
    allowed: bool
    # True whenever a finite cap is met/exceeded (paid tiers stay allowed).
    over_limit: bool


def as_known_tier(value: str | None) -> str:
    """Narrow a subscriptions.tier value (or its absence) to a known tier.

    Anything unknown reads as 'free' — the fail-closed default for POLICY
    (mirror of turn-cap.ts asKnownTier).
    """
    return value if value in ("pro", "power") else _FREE_TIER


def decide_chat_turn_cap(tier: str, monthly_chat_turns_used: int) -> ChatTurnCapDecision:
    """The pure policy decision (see module doc) — mirror of decideChatTurnCap.

    Reads the cap from tier_entitlements' mirror of @polytoken/billing;
    never redefines the numbers.
    """
    cap = monthly_chat_turns_for_tier(tier)
    if cap is None:
        # Unlimited (power) — no cap to be over.
        return ChatTurnCapDecision(allowed=True, over_limit=False)
    if monthly_chat_turns_used < cap:
        return ChatTurnCapDecision(allowed=True, over_limit=False)
    # At/over cap: ONLY free hard-blocks; paid tiers stay fail-open with the
    # over_limit marker.
    return ChatTurnCapDecision(allowed=tier != _FREE_TIER, over_limit=True)


def start_of_current_utc_month(now: datetime) -> datetime:
    """00:00:00 UTC on the 1st of *now*'s UTC month.

    Byte-mirror of _chat-turn-usage.ts's startOfCurrentUtcMonth
    (getUTCFullYear/getUTCMonth semantics): a non-UTC wall-clock date must
    NOT shift the month, so *now* is converted to UTC first. A naive datetime
    is read as already-UTC.
    """
    utc_now = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    return datetime(utc_now.year, utc_now.month, 1, tzinfo=UTC)
