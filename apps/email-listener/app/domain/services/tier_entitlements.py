"""Tier entitlements — per-tier consumption allowances, MIRRORED from TypeScript.

This is the Python half of a two-language source of truth. The canonical map is
packages/billing/src/entitlements.ts; there is no shared runtime between the web
app and this listener, so the numbers are duplicated by hand and the two files
MUST be kept in sync:

  - dailyIngestEmailCap  (free 100 / pro 500  / power 2000) — the importer's
    per-UTC-day ingest cap (IngestBudgetGuard).
  - monthlyChatTurns     (free 200 / pro 2000 / power None=unlimited) — the
    per-UTC-month chat-turn allowance (vLAUNCH W5-1: the listener-side mirror
    of the web's turn-cap gate; policy lives in
    app.domain.services.chat_turn_cap, never here).

Pure domain: no infrastructure import. The caller resolves a tier string (via a
TierResolver/UserTierResolver port) and asks this for the cap; an unknown or
None tier degrades to the free cap, so a bad lookup never grants a larger
allowance.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Final

_FREE_TIER: Final = "free"

# Frozen mirror of ENTITLEMENTS[*].dailyIngestEmailCap in
# packages/billing/src/entitlements.ts — keep the two in sync.
DAILY_INGEST_CAP_BY_TIER: Final[MappingProxyType[str, int]] = MappingProxyType(
    {
        "free": 100,
        "pro": 500,
        "power": 2000,
    }
)

# Frozen mirror of ENTITLEMENTS[*].monthlyChatTurns in
# packages/billing/src/entitlements.ts — keep the two in sync.
# None = unlimited (power), exactly as the TS side's `null`.
MONTHLY_CHAT_TURNS_BY_TIER: Final[MappingProxyType[str, int | None]] = MappingProxyType(
    {
        "free": 200,
        "pro": 2000,
        "power": None,
    }
)


def daily_ingest_cap_for_tier(tier: str | None) -> int:
    """The importer's per-UTC-day ingest cap for *tier*, free cap for unknown/None."""
    if tier is None:
        return DAILY_INGEST_CAP_BY_TIER[_FREE_TIER]
    return DAILY_INGEST_CAP_BY_TIER.get(tier, DAILY_INGEST_CAP_BY_TIER[_FREE_TIER])


def monthly_chat_turns_for_tier(tier: str | None) -> int | None:
    """The per-UTC-month chat-turn allowance for *tier* (None = unlimited).

    Unknown/None tiers degrade to the FREE allowance — `.get()`-with-default
    won't do here because None is power's legitimate "unlimited" value, so
    membership is checked explicitly.
    """
    if tier is None or tier not in MONTHLY_CHAT_TURNS_BY_TIER:
        return MONTHLY_CHAT_TURNS_BY_TIER[_FREE_TIER]
    return MONTHLY_CHAT_TURNS_BY_TIER[tier]
