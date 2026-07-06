"""Anticipatory-prompting SPIKE contracts (Phase 25, ANTIC-01) — D-05/D-06/D-13.

The trigger/heuristic layer (triggers.py) observes chat+canvas state and PROPOSES
structured candidates; it never fires anything. These four frozen dataclasses are
the one shape every downstream stage (Plan 25-02's eval + cap gate chain, Plan
25-03's findings harness) operates on:

- SourceStateRef: a read-only pointer to the observed run-event/panel/message that
  triggered a candidate (never the observed object itself — keeps the candidate
  small and serializable).
- AnticipatoryStateSnapshot: the read-only observation INPUT. Every collection
  field is a `tuple`, never a `list` — a trigger receiving this snapshot has no
  mutable collection to mutate even by accident, enforcing D-06 (observation is
  read-only + side-effect-free) at the type level, not just by convention.
- AnticipatoryCandidate: a trigger's structured proposal OUTPUT (D-05) — a
  candidate is a typed proposal, never free text.
- AnticipatoryLifecycleEvent: D-13's lifecycle record shape (proposed ->
  {suppressed_by_eval | suppressed_by_cap | shown} -> {accepted | dismissed}),
  mirroring ChatRunEvent's type+data shape (app.domain.ports.chat_repositories)
  so the same run-event substrate can carry it (D-14 — no new DB surface if
  avoidable).

Domain-pure: no imports from app.application or app.infrastructure (lint-imports
enforces "Domain has no external deps").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# D-13: the six lifecycle tokens a candidate's life passes through.
AnticipatoryLifecycleType = Literal[
    "proposed",
    "suppressed_by_eval",
    "suppressed_by_cap",
    "shown",
    "accepted",
    "dismissed",
]

# D-04: the three starter deterministic triggers this SPIKE ships.
TriggerId = Literal["idle_after_genui", "completed_artifact", "ambiguous_intent"]


@dataclass(frozen=True)
class SourceStateRef:
    """A read-only pointer to the observed state that drove a candidate.

    kind: what was observed (e.g. "run_event", "canvas_panel", "user_message").
    ref_id: the id of that observed thing — never the object itself.
    """

    kind: str
    ref_id: str


@dataclass(frozen=True)
class AnticipatoryStateSnapshot:
    """Read-only observation input a trigger evaluates (D-06).

    Every collection field is a `tuple`, never a `list`, so a trigger cannot
    mutate the snapshot it was handed even in error. `run_events` entries mirror
    `ChatRunEvent`'s `{type, data}` shape (app.domain.ports.chat_repositories);
    `canvas_panels` and `widget_interactions` entries are similarly loose
    `dict[str, Any]` bags — this snapshot is a fixture-shaped projection (D-02),
    not a 1:1 mirror of any single persistence row.
    """

    conversation_id: str
    now_epoch_s: float
    run_events: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    last_activity_epoch_s: float | None = None
    canvas_panels: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    last_user_text: str | None = None
    widget_interactions: tuple[dict[str, Any], ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class AnticipatoryCandidate:
    """A trigger's structured proposal (D-05) — never free text, never fired.

    trigger_id: which trigger produced this candidate.
    proposed_prompt_text: the exact text that would become the Phase-24
        proposal-card option value if this candidate survives the gate chain.
    rationale: human-readable "why now" — the spike's evidence trail for the
        go/no-go false-positive-rate argument.
    source_refs: what observed state justified firing (at least one ref).
    """

    trigger_id: TriggerId
    proposed_prompt_text: str
    rationale: str
    source_refs: tuple[SourceStateRef, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class AnticipatoryLifecycleEvent:
    """D-13 lifecycle record — mirrors ChatRunEvent's type+data shape.

    Reusing the existing run-event type+data envelope (rather than a bespoke
    shape) is what lets D-14 avoid a new DB table: this event can be appended to
    the existing chat_run_events substrate if the caller chooses to persist it.
    """

    type: AnticipatoryLifecycleType
    data: dict[str, Any] = field(default_factory=dict)


__all__ = [
    "AnticipatoryCandidate",
    "AnticipatoryLifecycleEvent",
    "AnticipatoryLifecycleType",
    "AnticipatoryStateSnapshot",
    "SourceStateRef",
    "TriggerId",
]
