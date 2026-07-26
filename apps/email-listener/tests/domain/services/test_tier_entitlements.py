"""Unit tests for app.domain.services.tier_entitlements.

Guards the Python half of the two-language cap map (mirrors
packages/billing/src/entitlements.ts). An unknown or None tier must degrade to
the free cap so a bad lookup never grants a larger allowance.
"""

from __future__ import annotations

from app.domain.services.tier_entitlements import daily_ingest_cap_for_tier


def test_free_tier_cap() -> None:
    assert daily_ingest_cap_for_tier("free") == 100


def test_pro_tier_cap() -> None:
    assert daily_ingest_cap_for_tier("pro") == 500


def test_power_tier_cap() -> None:
    assert daily_ingest_cap_for_tier("power") == 2000


def test_unknown_tier_falls_back_to_free() -> None:
    assert daily_ingest_cap_for_tier("nonsense") == 100


def test_none_tier_falls_back_to_free() -> None:
    assert daily_ingest_cap_for_tier(None) == 100
