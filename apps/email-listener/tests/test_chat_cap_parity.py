"""Cross-language chat-turn-cap parity: Python constants vs THE committed fixture.

packages/billing/src/chat-cap-parity.json is the single source of truth for the
monthlyChatTurns numbers and the free-tier cap message (see its $comment). The
TS gate's suite asserts the TS constants (turn-cap.ts / entitlements.ts) equal
that fixture; THIS suite asserts the Python mirror (chat_turn_cap.py /
tier_entitlements.py) does too — so a one-sided edit reds the drifted side's
suite instead of shipping silent divergence. JSON null == Python None ==
unlimited.

Fixture path resolution mirrors tests/evals/_paths.py's eval_fixtures_dir
bounded monorepo-relative walk-up: TEST-ONLY, dev/CI always run from a full
monorepo checkout, never inside the deployed container — so no env-var
override branch is needed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.services.chat_turn_cap import CHAT_TURN_CAP_MESSAGE
from app.domain.services.tier_entitlements import MONTHLY_CHAT_TURNS_BY_TIER

_THIS_FILE = Path(__file__).resolve()


def _parity_fixture_path() -> Path:
    """Resolve packages/billing/src/chat-cap-parity.json via a bounded walk-up.

    This file lives at apps/email-listener/tests/test_chat_cap_parity.py --
    depth 3 to the repo root (one shallower than tests/evals/_paths.py's
    depth 4, same pattern). Raises RuntimeError if the bound is exceeded or
    the fixture doesn't exist on disk.
    """
    parents = _THIS_FILE.parents
    if len(parents) > 3:
        candidate = parents[3] / "packages" / "billing" / "src" / "chat-cap-parity.json"
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        "Could not resolve packages/billing/src/chat-cap-parity.json from "
        f"{_THIS_FILE}. Expected apps/email-listener/tests/test_chat_cap_parity.py "
        "to sit at depth 3 below the monorepo root -- this resolver is test-only "
        "and assumes a full monorepo checkout (never runs inside the deployed "
        "container)."
    )


def _load_parity_fixture() -> dict[str, Any]:
    raw = json.loads(_parity_fixture_path().read_text(encoding="utf-8"))
    assert isinstance(raw, dict)
    return raw


@pytest.mark.unit
def test_cap_message_matches_the_parity_fixture_byte_for_byte() -> None:
    fixture = _load_parity_fixture()
    assert fixture["capMessage"] == CHAT_TURN_CAP_MESSAGE


@pytest.mark.unit
def test_monthly_chat_turn_numbers_match_the_parity_fixture() -> None:
    fixture = _load_parity_fixture()
    # JSON null loads as None — power's "unlimited" compares directly.
    assert dict(MONTHLY_CHAT_TURNS_BY_TIER) == fixture["monthlyChatTurns"]
