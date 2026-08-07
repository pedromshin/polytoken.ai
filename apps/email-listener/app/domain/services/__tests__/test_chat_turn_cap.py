"""Tests for the chat-turn cap policy mirror (vLAUNCH W5-1, ASSUMPTIONS A7).

The listener-side mirror of packages/api-client/src/router/chat/turn-cap.ts's
`decideChatTurnCap` + `asKnownTier` and of _chat-turn-usage.ts's
`startOfCurrentUtcMonth`. Semantics under test are the TS gate's, verbatim:

  - FREE at/over its cap -> blocked (allowed=False, over_limit=True).
  - PRO at/over its finite cap -> allowed with over_limit=True (never blocked).
  - POWER cap is None = unlimited -> can never read over-limit at all.
  - Unknown/absent tier reads as 'free' (fail-closed for POLICY).
  - Month window starts at 00:00 UTC on the 1st (getUTCFullYear/getUTCMonth
    semantics — a non-UTC wall-clock date must NOT shift the month).

Numbers are asserted against tier_entitlements' mirror of
packages/billing/src/entitlements.ts (free 200 / pro 2000 / power None) —
and the pre-existing ingest-cap numbers are pinned untouched.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.domain.services.chat_turn_cap import (
    CHAT_TURN_CAP_MESSAGE,
    as_known_tier,
    decide_chat_turn_cap,
    start_of_current_utc_month,
)
from app.domain.services.tier_entitlements import (
    DAILY_INGEST_CAP_BY_TIER,
    MONTHLY_CHAT_TURNS_BY_TIER,
    monthly_chat_turns_for_tier,
)

# ---------------------------------------------------------------------------
# Entitlement numbers — the two-file mirror of entitlements.ts
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_monthly_chat_turns_numbers_mirror_entitlements_ts() -> None:
    assert dict(MONTHLY_CHAT_TURNS_BY_TIER) == {"free": 200, "pro": 2000, "power": None}


@pytest.mark.unit
def test_existing_ingest_cap_numbers_unchanged() -> None:
    assert dict(DAILY_INGEST_CAP_BY_TIER) == {"free": 100, "pro": 500, "power": 2000}


@pytest.mark.unit
def test_monthly_chat_turns_for_tier_degrades_unknown_and_none_to_free() -> None:
    assert monthly_chat_turns_for_tier("free") == 200
    assert monthly_chat_turns_for_tier("pro") == 2000
    assert monthly_chat_turns_for_tier("power") is None
    assert monthly_chat_turns_for_tier(None) == 200
    assert monthly_chat_turns_for_tier("enterprise") == 200


# ---------------------------------------------------------------------------
# as_known_tier — mirror of turn-cap.ts asKnownTier
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_as_known_tier_narrows_to_known_tiers_and_defaults_free() -> None:
    assert as_known_tier("pro") == "pro"
    assert as_known_tier("power") == "power"
    assert as_known_tier("free") == "free"
    assert as_known_tier(None) == "free"
    assert as_known_tier("") == "free"
    assert as_known_tier("enterprise") == "free"


# ---------------------------------------------------------------------------
# decide_chat_turn_cap — mirror of turn-cap.ts decideChatTurnCap
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_free_under_cap_is_allowed() -> None:
    decision = decide_chat_turn_cap("free", 199)
    assert decision.allowed is True
    assert decision.over_limit is False


@pytest.mark.unit
def test_free_at_cap_is_blocked() -> None:
    decision = decide_chat_turn_cap("free", 200)
    assert decision.allowed is False
    assert decision.over_limit is True


@pytest.mark.unit
def test_free_over_cap_is_blocked() -> None:
    decision = decide_chat_turn_cap("free", 5_000)
    assert decision.allowed is False
    assert decision.over_limit is True


@pytest.mark.unit
def test_pro_at_cap_is_allowed_with_over_limit_marker() -> None:
    decision = decide_chat_turn_cap("pro", 2000)
    assert decision.allowed is True
    assert decision.over_limit is True


@pytest.mark.unit
def test_power_is_unlimited_and_never_over_limit() -> None:
    decision = decide_chat_turn_cap("power", 1_000_000)
    assert decision.allowed is True
    assert decision.over_limit is False


@pytest.mark.unit
def test_unknown_tier_via_as_known_tier_is_capped_like_free() -> None:
    decision = decide_chat_turn_cap(as_known_tier("enterprise"), 200)
    assert decision.allowed is False


@pytest.mark.unit
def test_unknown_tier_passed_raw_is_narrowed_inside_and_blocked_at_cap() -> None:
    # W6-L fail-closed fix: decide_chat_turn_cap narrows AT ENTRY — an
    # un-narrowed 'enterprise' must read as free (blocked), never as paid.
    decision = decide_chat_turn_cap("enterprise", 200)
    assert decision.allowed is False
    assert decision.over_limit is True


@pytest.mark.unit
def test_cap_message_is_the_exact_friendly_copy() -> None:
    assert CHAT_TURN_CAP_MESSAGE == (
        "You've used all of this month's included chat turns on the free plan. "
        "Upgrade to keep chatting — your allowance resets at the start of next month (UTC)."
    )


# ---------------------------------------------------------------------------
# start_of_current_utc_month — mirror of _chat-turn-usage.ts startOfCurrentUtcMonth
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_month_start_is_first_of_month_at_midnight_utc() -> None:
    now = datetime(2026, 8, 7, 15, 30, 45, tzinfo=UTC)
    assert start_of_current_utc_month(now) == datetime(2026, 8, 1, tzinfo=UTC)


@pytest.mark.unit
def test_month_boundary_last_instant_of_month_still_maps_to_that_month() -> None:
    now = datetime(2026, 8, 31, 23, 59, 59, tzinfo=UTC)
    assert start_of_current_utc_month(now) == datetime(2026, 8, 1, tzinfo=UTC)


@pytest.mark.unit
def test_month_boundary_first_instant_of_next_month_resets_the_window() -> None:
    now = datetime(2026, 9, 1, 0, 0, 0, tzinfo=UTC)
    assert start_of_current_utc_month(now) == datetime(2026, 9, 1, tzinfo=UTC)


@pytest.mark.unit
def test_month_start_uses_the_utc_month_not_the_local_wall_clock_month() -> None:
    # 2026-09-01T05:30+10:00 is still 2026-08-31T19:30 UTC — the window must be
    # August's (getUTCFullYear/getUTCMonth semantics, byte-mirrored from TS).
    now = datetime(2026, 9, 1, 5, 30, tzinfo=timezone(timedelta(hours=10)))
    assert start_of_current_utc_month(now) == datetime(2026, 8, 1, tzinfo=UTC)
