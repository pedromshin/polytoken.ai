"""Tests for the three deterministic anticipatory triggers + run_triggers (D-04/D-06/D-12).

Covers: each fixture (fixtures.py) drives exactly its own trigger and no other;
run_triggers([...], enabled=False) always returns []; a "quiet" fixture (not idle,
no panel, non-ambiguous) yields [] even when enabled; the input snapshot is never
mutated by run_triggers (read-only, D-06).
"""

from __future__ import annotations

import dataclasses

import pytest

from app.domain.anticipatory.candidate import AnticipatoryCandidate, AnticipatoryStateSnapshot
from app.domain.anticipatory.fixtures import (
    IDLE_THRESHOLD_SECONDS,
    ambiguous_intent_snapshot,
    completed_artifact_snapshot,
    idle_after_genui_snapshot,
)
from app.domain.anticipatory.triggers import (
    detect_ambiguous_intent,
    detect_completed_artifact,
    detect_idle_after_genui,
    run_triggers,
)

_QUIET_SNAPSHOT = AnticipatoryStateSnapshot(
    conversation_id="conv-quiet",
    now_epoch_s=idle_after_genui_snapshot().now_epoch_s,
    run_events=(),
    last_activity_epoch_s=idle_after_genui_snapshot().now_epoch_s - 5.0,
    canvas_panels=(),
    last_user_text="please add a detailed shipping label with the full postal address",
    widget_interactions=(),
)


@pytest.mark.unit
def test_idle_fixture_yields_exactly_one_idle_candidate() -> None:
    snapshot = idle_after_genui_snapshot()

    candidates = run_triggers(snapshot, enabled=True, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert len(candidates) == 1
    candidate = candidates[0]
    assert isinstance(candidate, AnticipatoryCandidate)
    assert candidate.trigger_id == "idle_after_genui"
    assert candidate.proposed_prompt_text
    assert candidate.rationale
    assert len(candidate.source_refs) >= 1


@pytest.mark.unit
def test_completed_artifact_fixture_yields_exactly_one_next_best_action_candidate() -> None:
    snapshot = completed_artifact_snapshot()

    candidates = run_triggers(snapshot, enabled=True, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.trigger_id == "completed_artifact"
    assert "csv" in candidate.proposed_prompt_text.lower()
    assert candidate.rationale
    assert len(candidate.source_refs) >= 1


@pytest.mark.unit
def test_ambiguous_intent_fixture_yields_exactly_one_clarifying_candidate() -> None:
    snapshot = ambiguous_intent_snapshot()

    candidates = run_triggers(snapshot, enabled=True, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.trigger_id == "ambiguous_intent"
    assert candidate.proposed_prompt_text
    assert candidate.rationale
    assert len(candidate.source_refs) >= 1


@pytest.mark.unit
def test_idle_fixture_does_not_fire_the_other_two_triggers() -> None:
    snapshot = idle_after_genui_snapshot()

    assert detect_completed_artifact(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None
    assert detect_ambiguous_intent(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None


@pytest.mark.unit
def test_completed_artifact_fixture_does_not_fire_the_other_two_triggers() -> None:
    snapshot = completed_artifact_snapshot()

    assert detect_idle_after_genui(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None
    assert detect_ambiguous_intent(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None


@pytest.mark.unit
def test_ambiguous_intent_fixture_does_not_fire_the_other_two_triggers() -> None:
    snapshot = ambiguous_intent_snapshot()

    assert detect_idle_after_genui(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None
    assert detect_completed_artifact(snapshot, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS) is None


@pytest.mark.unit
@pytest.mark.parametrize(
    "snapshot",
    [idle_after_genui_snapshot(), completed_artifact_snapshot(), ambiguous_intent_snapshot()],
)
def test_run_triggers_returns_empty_when_disabled(snapshot: AnticipatoryStateSnapshot) -> None:
    candidates = run_triggers(snapshot, enabled=False, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert candidates == []


@pytest.mark.unit
def test_quiet_snapshot_yields_no_candidates_even_when_enabled() -> None:
    candidates = run_triggers(_QUIET_SNAPSHOT, enabled=True, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert candidates == []


@pytest.mark.unit
def test_run_triggers_never_mutates_the_input_snapshot() -> None:
    snapshot = idle_after_genui_snapshot()
    before = dataclasses.replace(snapshot)

    run_triggers(snapshot, enabled=True, idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    assert snapshot == before
