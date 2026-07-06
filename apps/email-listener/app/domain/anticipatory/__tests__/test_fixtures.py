"""Tests for the three scripted anticipatory-prompting fixtures (D-02).

Covers: each builder returns a frozen AnticipatoryStateSnapshot; each satisfies
the firing invariant its trigger depends on (idle threshold / panel presence /
short ambiguous text); every collection field is a tuple, never a list (D-06
read-only proof — a trigger cannot mutate what it was handed).
"""

from __future__ import annotations

import dataclasses

import pytest

from app.domain.anticipatory.candidate import AnticipatoryStateSnapshot
from app.domain.anticipatory.fixtures import (
    IDLE_THRESHOLD_SECONDS,
    ambiguous_intent_snapshot,
    completed_artifact_snapshot,
    idle_after_genui_snapshot,
)


@pytest.mark.unit
def test_idle_after_genui_snapshot_satisfies_idle_invariant() -> None:
    snapshot = idle_after_genui_snapshot()

    assert isinstance(snapshot, AnticipatoryStateSnapshot)
    assert snapshot.last_activity_epoch_s is not None
    assert snapshot.now_epoch_s - snapshot.last_activity_epoch_s >= IDLE_THRESHOLD_SECONDS
    assert snapshot.last_user_text is None
    assert len(snapshot.run_events) >= 1
    assert snapshot.run_events[-1]["type"] == "completed"


@pytest.mark.unit
def test_completed_artifact_snapshot_has_settled_panel() -> None:
    snapshot = completed_artifact_snapshot()

    assert isinstance(snapshot, AnticipatoryStateSnapshot)
    assert len(snapshot.canvas_panels) >= 1
    assert snapshot.canvas_panels[0]["status"] == "settled"
    # Recent activity — must NOT also satisfy the idle invariant.
    assert snapshot.last_activity_epoch_s is not None
    assert snapshot.now_epoch_s - snapshot.last_activity_epoch_s < IDLE_THRESHOLD_SECONDS


@pytest.mark.unit
def test_ambiguous_intent_snapshot_has_short_last_user_text() -> None:
    snapshot = ambiguous_intent_snapshot()

    assert isinstance(snapshot, AnticipatoryStateSnapshot)
    assert snapshot.last_user_text
    assert len(snapshot.last_user_text.split()) <= 4
    # Recent activity — must NOT also satisfy the idle invariant.
    assert snapshot.last_activity_epoch_s is not None
    assert snapshot.now_epoch_s - snapshot.last_activity_epoch_s < IDLE_THRESHOLD_SECONDS


@pytest.mark.unit
@pytest.mark.parametrize(
    "snapshot",
    [idle_after_genui_snapshot(), completed_artifact_snapshot(), ambiguous_intent_snapshot()],
)
def test_every_fixture_collection_field_is_a_tuple(snapshot: AnticipatoryStateSnapshot) -> None:
    assert isinstance(snapshot.run_events, tuple)
    assert isinstance(snapshot.canvas_panels, tuple)
    assert isinstance(snapshot.widget_interactions, tuple)


@pytest.mark.unit
@pytest.mark.parametrize(
    "snapshot",
    [idle_after_genui_snapshot(), completed_artifact_snapshot(), ambiguous_intent_snapshot()],
)
def test_every_fixture_is_frozen(snapshot: AnticipatoryStateSnapshot) -> None:
    with pytest.raises(dataclasses.FrozenInstanceError):
        snapshot.last_user_text = "mutated"  # type: ignore[misc]
