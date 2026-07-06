"""Scripted chat+canvas state fixtures for the anticipatory-prompting SPIKE (D-02).

Three deterministic `AnticipatoryStateSnapshot` builders — one per Phase-25 trigger
(triggers.py). D-02: the SPIKE is exercised against scripted fixtures, not live
Bedrock; these ARE the deterministic exercise inputs, imported by Plan 25-02's
full-chain test and Plan 25-03's findings harness, so they live here as a
first-class importable module rather than test-local helpers.

Domain-pure: imports only from app.domain.anticipatory.candidate (no app.settings
import — the idle threshold used to construct the idle fixture is hardcoded below
as `IDLE_THRESHOLD_SECONDS`, deliberately mirroring (not importing)
settings.ANTICIPATORY_IDLE_THRESHOLD_SECONDS's default, keeping this module
settings-agnostic like triggers.py).
"""

from __future__ import annotations

from app.domain.anticipatory.candidate import AnticipatoryStateSnapshot

# A fixed reference epoch (2023-11-14T22:13:20Z) for reproducible fixtures — never
# wall-clock `time.time()`, so a fixture-driven test is deterministic across runs.
_BASE_NOW_EPOCH_S = 1_700_000_000.0

# Mirrors settings.ANTICIPATORY_IDLE_THRESHOLD_SECONDS's default (45.0). Hardcoded
# rather than imported to keep this module domain-pure / settings-agnostic.
IDLE_THRESHOLD_SECONDS = 45.0

# Buffer past the idle threshold so the invariant holds comfortably even if the
# threshold constant above ever drifts slightly relative to settings.py.
_IDLE_BUFFER_SECONDS = 15.0


def _base_now() -> float:
    """Shared reproducible "now" for every fixture builder's default argument."""
    return _BASE_NOW_EPOCH_S


def idle_after_genui_snapshot(now_epoch_s: float = _base_now()) -> AnticipatoryStateSnapshot:
    """Targets `detect_idle_after_genui`.

    The most recent run_event is a settled `completed` turn that emitted a
    `genui_spec`, and `last_activity_epoch_s` is far enough in the past that
    `now_epoch_s - last_activity_epoch_s >= IDLE_THRESHOLD_SECONDS`. No newer
    user text — the user has gone idle after the assistant's genui turn settled.
    """
    last_activity_epoch_s = now_epoch_s - IDLE_THRESHOLD_SECONDS - _IDLE_BUFFER_SECONDS
    return AnticipatoryStateSnapshot(
        conversation_id="conv-idle-after-genui",
        now_epoch_s=now_epoch_s,
        run_events=(
            {
                "type": "completed",
                "data": {"emitted_part_type": "genui_spec", "message_id": "msg-genui-settled-1"},
            },
        ),
        last_activity_epoch_s=last_activity_epoch_s,
        canvas_panels=(),
        last_user_text=None,
        widget_interactions=(),
    )


def completed_artifact_snapshot(now_epoch_s: float = _base_now()) -> AnticipatoryStateSnapshot:
    """Targets `detect_completed_artifact`.

    `canvas_panels` contains one settled panel with a rendered artifact carrying
    an obvious next-best-action (a table with an export suggestion), and no
    follow-up user turn came after it — recent activity, so this does NOT also
    trip the idle trigger.
    """
    settled_panel = {
        "id": "panel-table-1",
        "status": "settled",
        "node_type": "table",
        "next_best_action": "export this table as a CSV",
    }
    return AnticipatoryStateSnapshot(
        conversation_id="conv-completed-artifact",
        now_epoch_s=now_epoch_s,
        run_events=(
            {
                "type": "completed",
                "data": {"emitted_part_type": "genui_spec", "message_id": "msg-artifact-settled-1"},
            },
        ),
        last_activity_epoch_s=now_epoch_s - 5.0,
        canvas_panels=(settled_panel,),
        last_user_text=None,
        widget_interactions=(),
    )


def ambiguous_intent_snapshot(now_epoch_s: float = _base_now()) -> AnticipatoryStateSnapshot:
    """Targets `detect_ambiguous_intent`.

    `last_user_text` is deterministically underspecified — short (below the
    trigger's token-count floor) AND drawn from the trigger's frozen vague-phrase
    set (no ML, D-04) — with a recent, non-idle `last_activity_epoch_s`.
    """
    return AnticipatoryStateSnapshot(
        conversation_id="conv-ambiguous-intent",
        now_epoch_s=now_epoch_s,
        run_events=(),
        last_activity_epoch_s=now_epoch_s - 3.0,
        canvas_panels=(),
        last_user_text="make it better",
        widget_interactions=(),
    )


__all__ = [
    "IDLE_THRESHOLD_SECONDS",
    "ambiguous_intent_snapshot",
    "completed_artifact_snapshot",
    "idle_after_genui_snapshot",
]
