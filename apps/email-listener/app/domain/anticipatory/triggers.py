"""Three deterministic (no-ML) anticipatory triggers + flag-gated entry (D-04/D-06/D-12).

Each trigger is a pure function — no I/O, no writes, no ports (D-06 — observation
is read-only + side-effect-free). A trigger PROPOSES an `AnticipatoryCandidate`;
it never fires anything. `run_triggers` is the single entry point: it short-
circuits to `[]` immediately when `enabled` is False (D-12 — the global off
switch means zero candidates are ever produced), otherwise it runs every trigger
and collects the non-None candidates.

Triggers stay settings-agnostic and domain-pure (no `app.settings` import,
mirroring `widget_result_validator.py`'s posture) — the caller (Plan 25-02's use
case) passes `enabled=settings.ANTICIPATORY_PROMPTING_ENABLED` and
`idle_threshold_seconds=settings.ANTICIPATORY_IDLE_THRESHOLD_SECONDS`.
"""

from __future__ import annotations

from typing import Protocol

from app.domain.anticipatory.candidate import AnticipatoryCandidate, AnticipatoryStateSnapshot, SourceStateRef

# D-04: ambiguous-intent trigger is deterministic, no LLM. A `last_user_text` is
# treated as ambiguous when it is short (at or below this token-count floor) OR
# it matches one of the frozen vague phrases below — either condition alone is
# sufficient (documented discretion; tuned against the ambiguous_intent_snapshot
# fixture, not exhaustive of real-world ambiguity).
_AMBIGUOUS_TOKEN_COUNT_FLOOR = 4
_VAGUE_PHRASES: frozenset[str] = frozenset(
    {
        "do the thing",
        "make it better",
        "fix it",
        "improve it",
        "you know what i mean",
        "do something with this",
    }
)

# Settled run_event `data.emitted_part_type` values that count as a "genui turn"
# for the idle trigger (mirrors the interactive_widget/genui_spec part shapes
# from run_chat_turn_widgets.py / the 24-CONTEXT interfaces contract).
_GENUI_EMITTED_PART_TYPES = frozenset({"genui_spec", "interactive_widget"})


class AnticipatoryTrigger(Protocol):
    """Common call signature every trigger in `TRIGGERS` implements.

    Every trigger accepts the same keyword-only `idle_threshold_seconds` even
    though only `detect_idle_after_genui` uses it — this keeps `run_triggers`
    able to call every trigger uniformly without a per-trigger dispatch table.
    """

    def __call__(
        self, snapshot: AnticipatoryStateSnapshot, *, idle_threshold_seconds: float
    ) -> AnticipatoryCandidate | None: ...


def detect_idle_after_genui(
    snapshot: AnticipatoryStateSnapshot, *, idle_threshold_seconds: float
) -> AnticipatoryCandidate | None:
    """Fires when the most recent run_event is a settled genui turn AND the user
    has been idle for at least `idle_threshold_seconds` since then.
    """
    if snapshot.last_activity_epoch_s is None or not snapshot.run_events:
        return None

    latest_event = snapshot.run_events[-1]
    if latest_event.get("type") != "completed":
        return None

    data = latest_event.get("data", {})
    if data.get("emitted_part_type") not in _GENUI_EMITTED_PART_TYPES:
        return None

    idle_seconds = snapshot.now_epoch_s - snapshot.last_activity_epoch_s
    if idle_seconds < idle_threshold_seconds:
        return None

    message_id = str(data.get("message_id", "unknown"))
    return AnticipatoryCandidate(
        trigger_id="idle_after_genui",
        proposed_prompt_text="Want me to build on that, or try something different?",
        rationale=(
            f"No activity for {idle_seconds:.0f}s after a settled genui turn (threshold {idle_threshold_seconds:.0f}s)."
        ),
        source_refs=(SourceStateRef(kind="run_event", ref_id=message_id),),
    )


def detect_completed_artifact(
    snapshot: AnticipatoryStateSnapshot, *, idle_threshold_seconds: float
) -> AnticipatoryCandidate | None:
    """Fires when a settled canvas panel carries an obvious next-best-action and
    no follow-up turn came after it.
    """
    del idle_threshold_seconds  # unused by this trigger; part of the shared Protocol signature

    for panel in snapshot.canvas_panels:
        if panel.get("status") != "settled":
            continue
        next_best_action = panel.get("next_best_action")
        if not next_best_action:
            continue

        panel_id = str(panel.get("id", "unknown"))
        return AnticipatoryCandidate(
            trigger_id="completed_artifact",
            proposed_prompt_text=f"Want me to {next_best_action}?",
            rationale=f"Panel {panel_id} settled with an obvious next-best-action and no follow-up turn.",
            source_refs=(SourceStateRef(kind="canvas_panel", ref_id=panel_id),),
        )

    return None


def detect_ambiguous_intent(
    snapshot: AnticipatoryStateSnapshot, *, idle_threshold_seconds: float
) -> AnticipatoryCandidate | None:
    """Fires when `last_user_text` matches the documented deterministic ambiguity
    rule (short OR a known vague phrase) — no LLM (D-04).
    """
    del idle_threshold_seconds  # unused by this trigger; part of the shared Protocol signature

    text = snapshot.last_user_text
    if not text:
        return None

    normalized = text.strip().lower()
    if not normalized:
        return None

    token_count = len(normalized.split())
    is_short = token_count <= _AMBIGUOUS_TOKEN_COUNT_FLOOR
    is_vague_phrase = normalized in _VAGUE_PHRASES
    if not (is_short or is_vague_phrase):
        return None

    return AnticipatoryCandidate(
        trigger_id="ambiguous_intent",
        proposed_prompt_text=f'Could you say a bit more about what "{text}" means here?',
        rationale=(
            f"last_user_text ({token_count} token(s)) matched the deterministic ambiguity rule "
            "(short and/or a known vague phrase)."
        ),
        source_refs=(SourceStateRef(kind="user_message", ref_id=normalized[:50]),),
    )


# D-04: the three starter deterministic triggers this SPIKE ships, in evaluation order.
TRIGGERS: tuple[AnticipatoryTrigger, ...] = (
    detect_idle_after_genui,
    detect_completed_artifact,
    detect_ambiguous_intent,
)


def run_triggers(
    snapshot: AnticipatoryStateSnapshot,
    *,
    enabled: bool,
    idle_threshold_seconds: float,
) -> list[AnticipatoryCandidate]:
    """Flag-gated single entry point (D-12) — the whole trigger layer is dark
    unless `enabled` is True. Runs every trigger in `TRIGGERS` and collects the
    non-None candidates; never mutates `snapshot` (D-06).
    """
    if not enabled:
        return []

    candidates: list[AnticipatoryCandidate] = []
    for trigger in TRIGGERS:
        candidate = trigger(snapshot, idle_threshold_seconds=idle_threshold_seconds)
        if candidate is not None:
            candidates.append(candidate)
    return candidates


__all__ = [
    "TRIGGERS",
    "AnticipatoryTrigger",
    "detect_ambiguous_intent",
    "detect_completed_artifact",
    "detect_idle_after_genui",
    "run_triggers",
]
