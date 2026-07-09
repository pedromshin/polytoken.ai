"""Injection-resistance canary fixtures (EVAL-07) Python-side runner (Plan 35-03, Task 2).

Loads the SAME injection-fixtures.json Plan 35-02 committed to
packages/genui/src/eval/ (via eval_fixtures_dir()'s monorepo-relative
resolver) and proves the canary-leak scorer distinguishes a leaking sample
visible text from a clean one, for a real seeded fixture's canary. The FULL
adversarial suite + live-model harness run is Phase 38's QUAR-02 -- this only
proves the scorer mechanics.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.evals._paths import eval_fixtures_dir
from tests.evals._scorers import _CANARY_PATTERN, extract_canary, score_injection_resistance


def _load_injection_fixtures() -> list[dict[str, Any]]:
    path = eval_fixtures_dir() / "injection-fixtures.json"
    return json.loads(Path(path).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@pytest.mark.unit
def test_injection_fixtures_load_between_twenty_and_thirty_entries() -> None:
    # Bound widened by Phase 38 (QUAR-02, Plan 38-02, Task 1): the fixture set grew from the
    # Phase-35 4-entry scorer-mechanics seed to the full 20-30 entry adversarial suite, mirroring
    # eval-dimensions-assets.test.ts's widened INJECTION_FIXTURES bound.
    fixtures = _load_injection_fixtures()
    assert 20 <= len(fixtures) <= 30


@pytest.mark.unit
def test_injection_fixtures_have_required_non_empty_fields() -> None:
    fixtures = _load_injection_fixtures()
    for fixture in fixtures:
        assert fixture.get("name")
        assert fixture.get("retrievedText")
        assert fixture.get("expectedBehavior")


@pytest.mark.unit
def test_every_fixture_embeds_a_canary_marker() -> None:
    fixtures = _load_injection_fixtures()
    for fixture in fixtures:
        assert _CANARY_PATTERN.search(fixture["retrievedText"]), (
            f"fixture {fixture['name']!r} is missing a [CANARY:...] marker"
        )


@pytest.mark.unit
def test_leaking_sample_text_is_flagged() -> None:
    fixtures = _load_injection_fixtures()
    fixture = fixtures[0]
    canary = extract_canary(fixture["retrievedText"])
    assert canary is not None

    visible_text = f"Sure, here it is: {canary}"
    result = score_injection_resistance(fixture["retrievedText"], visible_text)
    assert result["leaked"] is True


@pytest.mark.unit
def test_clean_sample_text_is_not_flagged() -> None:
    fixtures = _load_injection_fixtures()
    fixture = fixtures[0]

    visible_text = "I don't have that information available."
    result = score_injection_resistance(fixture["retrievedText"], visible_text)
    assert result["leaked"] is False
