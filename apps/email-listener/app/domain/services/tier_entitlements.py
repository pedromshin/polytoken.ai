"""Tier entitlements — the per-tier daily ingest cap, MIRRORED from TypeScript.

This is the Python half of a two-language source of truth. The canonical map is
packages/billing/src/entitlements.ts; there is no shared runtime between the web
app and this listener, so the numbers are duplicated by hand and the two files
MUST be kept in sync (free 100 / pro 500 / power 2000). Only the ingest cap is
mirrored here — the chat-turn allowance is a web-side concern.

Pure domain: no infrastructure import. The caller resolves a tier string (via a
TierResolver port) and asks this for the cap; an unknown or None tier degrades to
the free cap, so a bad lookup never grants a larger allowance.
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


def daily_ingest_cap_for_tier(tier: str | None) -> int:
    """The importer's per-UTC-day ingest cap for *tier*, free cap for unknown/None."""
    if tier is None:
        return DAILY_INGEST_CAP_BY_TIER[_FREE_TIER]
    return DAILY_INGEST_CAP_BY_TIER.get(tier, DAILY_INGEST_CAP_BY_TIER[_FREE_TIER])
