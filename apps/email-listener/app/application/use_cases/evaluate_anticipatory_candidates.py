"""EvaluateAnticipatoryCandidates — the ANTIC-02 gate chain (D-08/D-10/D-11/D-12/D-13).

Every `AnticipatoryCandidate` the Plan 25-01 trigger layer proposes must pass
BOTH of two INDEPENDENT gates before it can ever reach the user (D-08):

    gate #1 — appropriateness eval (D-07): an `AppropriatenessJudge` scores the
        candidate 0-1; below `appropriateness_threshold` -> suppressed_by_eval.
    gate #2 — frequency cap (D-10): an `AnticipatoryCapStore` reports how many
        candidates were already shown in the conversation's short window AND
        in the last day; at either limit -> suppressed_by_cap.

INDEPENDENCE (D-08) is architectural, not just behavioral: the cap is checked
FIRST only as a COST OPTIMIZATION (it is free; the judge call is a paid Bedrock
call) — a cap denial skips the judge call entirely, but this is never a
substitution. The cap can only DENY a candidate; it never approves one on the
eval's behalf, and a cap-denied candidate's suppression is never overridden by
what the eval would have said. A candidate is `shown` only when BOTH checks
independently pass, proven by this module's companion test file's
"independence" test (the SAME candidate is shown / suppressed_by_cap /
suppressed_by_eval purely as a function of which one input changes).

Every candidate's lifecycle is recorded as ordered `AnticipatoryLifecycleEvent`
records (D-13) and emitted via structlog (`anticipatory_lifecycle`) — this is
the go/no-go false-positive-rate evidence Plan 25-03 rests on.

A `shown` candidate maps (`to_proposal_card_declaration`) onto the UNCHANGED
Phase-24 proposal-card declaration shape (D-11) — the existing
`derive_declared_response_schema("proposal_cards", ...)` + explicit-accept
submit round trip is reused verbatim; this module never invokes a turn or any
side effect beyond the two gate ports.

`enabled=False` short-circuits everything (D-12): `run_triggers` is not even
called, so zero triggers evaluate, the judge is never consulted, the cap store
is never touched, and zero lifecycle events are produced.

Domain ports only: this use case depends on `AppropriatenessJudge` and
`AnticipatoryCapStore` (both `app.domain.ports.anticipatory_ports`) — never a
concrete `app.infrastructure` adapter (lint-imports enforced, "Application
does not import infrastructure").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import structlog

from app.domain.anticipatory.candidate import (
    AnticipatoryCandidate,
    AnticipatoryLifecycleEvent,
    AnticipatoryStateSnapshot,
    TriggerId,
)
from app.domain.anticipatory.triggers import run_triggers
from app.domain.ports.anticipatory_ports import AnticipatoryCapStore, AppropriatenessJudge, CapDecision

logger = structlog.get_logger(__name__)

_SECONDS_PER_DAY = 86400.0

# D-11: the single accept option's label — the actual proposed text is carried
# as the option's `value` (candidate.proposed_prompt_text — see candidate.py's
# own docstring) and again as the card's `prompt` (the anticipatory question
# itself is what the user reads and accepts/dismisses).
_ACCEPT_OPTION_TITLE = "Yes, let's do that"


@dataclass(frozen=True)
class AnticipatoryPipelineResult:
    """The gate chain's output for one `evaluate()` call — D-13 ordered evidence trail."""

    shown: tuple[AnticipatoryCandidate, ...] = ()
    events: tuple[AnticipatoryLifecycleEvent, ...] = ()


_EMPTY_RESULT = AnticipatoryPipelineResult()


class EvaluateAnticipatoryCandidates:
    """The ANTIC-02 gate chain: trigger -> [cap check] -> [appropriateness eval] -> shown.

    Constructor takes the two domain PORTS (never concrete adapters) — a
    caller wires a `BedrockAppropriatenessJudgeAdapter` + `InMemoryAnticipatoryCapStore`
    in production/tests, or `StubAppropriatenessJudge` + `InMemoryAnticipatoryCapStore`
    in deterministic fixture-driven tests (D-09).
    """

    def __init__(self, *, judge: AppropriatenessJudge, cap_store: AnticipatoryCapStore) -> None:
        self._judge = judge
        self._cap_store = cap_store

    async def evaluate(
        self,
        snapshot: AnticipatoryStateSnapshot,
        *,
        enabled: bool,
        idle_threshold_seconds: float,
        appropriateness_threshold: float,
        cap_per_window: int,
        cap_window_minutes: int,
        cap_per_day: int,
        cooldowns: set[TriggerId] | frozenset[TriggerId] = frozenset(),
    ) -> AnticipatoryPipelineResult:
        """Run the full gate chain over every candidate `run_triggers` proposes.

        `cooldowns` (D-11 dismissal seam): trigger_ids a prior
        `record_candidate_outcome(..., "dismissed", ...)` call registered for
        this conversation are filtered out before a `proposed` event is even
        recorded — a dismissed trigger stays fully quiet until the caller
        clears the cooldown (a later plan's concern; the spike only proves
        the registration + filtering seam).
        """
        if not enabled:  # D-12: the global off switch — nothing runs, nothing is recorded.
            return _EMPTY_RESULT

        candidates = [
            candidate
            for candidate in run_triggers(snapshot, enabled=True, idle_threshold_seconds=idle_threshold_seconds)
            if candidate.trigger_id not in cooldowns
        ]

        events: list[AnticipatoryLifecycleEvent] = []
        shown: list[AnticipatoryCandidate] = []

        for candidate in candidates:
            events.append(self._emit(AnticipatoryLifecycleEvent(type="proposed", data=_candidate_data(candidate))))

            # Gate #2 first (free) — a cost optimization only, NEVER a substitute for gate #1 (D-08).
            cap_decision = await self._check_cap(
                conversation_id=snapshot.conversation_id,
                now_epoch_s=snapshot.now_epoch_s,
                cap_per_window=cap_per_window,
                cap_window_minutes=cap_window_minutes,
                cap_per_day=cap_per_day,
            )
            if not cap_decision.allowed:
                events.append(
                    self._emit(
                        AnticipatoryLifecycleEvent(
                            type="suppressed_by_cap",
                            data={**_candidate_data(candidate), "reason": cap_decision.reason},
                        )
                    )
                )
                continue

            # Gate #1 — the appropriateness eval (D-07); only reached when the cap has room.
            score = await self._judge.score(
                proposed_prompt_text=candidate.proposed_prompt_text,
                rationale=candidate.rationale,
                context_summary=_build_context_summary(snapshot),
            )
            if score.score < appropriateness_threshold:
                events.append(
                    self._emit(
                        AnticipatoryLifecycleEvent(
                            type="suppressed_by_eval",
                            data={**_candidate_data(candidate), "score": score.score, "reason": score.reason},
                        )
                    )
                )
                continue

            # Both gates independently passed -> shown (D-11 handoff point).
            await self._cap_store.record_shown(
                conversation_id=snapshot.conversation_id, at_epoch_s=snapshot.now_epoch_s
            )
            events.append(
                self._emit(
                    AnticipatoryLifecycleEvent(type="shown", data={**_candidate_data(candidate), "score": score.score})
                )
            )
            shown.append(candidate)

        return AnticipatoryPipelineResult(shown=tuple(shown), events=tuple(events))

    async def _check_cap(
        self,
        *,
        conversation_id: str,
        now_epoch_s: float,
        cap_per_window: int,
        cap_window_minutes: int,
        cap_per_day: int,
    ) -> CapDecision:
        """D-10: BOTH the short window AND the daily ceiling are independently enforced."""
        window_since = now_epoch_s - (cap_window_minutes * 60.0)
        window_count = await self._cap_store.count_shown(conversation_id=conversation_id, since_epoch_s=window_since)
        if window_count >= cap_per_window:
            return CapDecision(allowed=False, reason=f"window cap reached ({window_count}/{cap_per_window})")

        day_since = now_epoch_s - _SECONDS_PER_DAY
        day_count = await self._cap_store.count_shown(conversation_id=conversation_id, since_epoch_s=day_since)
        if day_count >= cap_per_day:
            return CapDecision(allowed=False, reason=f"day cap reached ({day_count}/{cap_per_day})")

        return CapDecision(allowed=True, reason="within caps")

    @staticmethod
    def _emit(event: AnticipatoryLifecycleEvent) -> AnticipatoryLifecycleEvent:
        """Emit one lifecycle event via structlog (D-13) and return it unchanged."""
        logger.info("anticipatory_lifecycle", lifecycle_type=event.type, **event.data)
        return event


def to_proposal_card_declaration(candidate: AnticipatoryCandidate) -> dict[str, Any]:
    """Map a shown candidate to a Phase-24 proposal-card declaration (D-11, unchanged reuse).

    A single accept option whose `value` is `candidate.proposed_prompt_text`
    (candidate.py's own contract: this is "the exact text that would become
    the Phase-24 proposal-card option value if this candidate survives the
    gate chain"). The card's `prompt` is the anticipatory question itself —
    what the user actually reads before accepting or dismissing. Nothing here
    fires anything: the existing `SubmitWidgetInteraction` explicit-accept
    round trip (Phase 24, unmodified) is what a user's click resolves through.
    """
    return {
        "options": [
            {"id": "opt-0", "title": _ACCEPT_OPTION_TITLE, "value": candidate.proposed_prompt_text},
        ],
        "prompt": candidate.proposed_prompt_text,
    }


def record_candidate_outcome(
    candidate: AnticipatoryCandidate,
    outcome: Literal["accepted", "dismissed"],
    *,
    cooldowns: set[TriggerId],
) -> AnticipatoryLifecycleEvent:
    """Record a shown candidate's terminal user decision (D-13).

    "dismissed" registers `candidate.trigger_id` into `cooldowns` (mutated in
    place — the caller owns this conversation-scoped registry) so a later
    `evaluate()` call passed the SAME `cooldowns` object skips that trigger's
    candidates entirely (D-11's dismissal-suppresses-a-cooldown seam).
    """
    if outcome == "dismissed":
        cooldowns.add(candidate.trigger_id)
    event = AnticipatoryLifecycleEvent(type=outcome, data=_candidate_data(candidate))
    logger.info("anticipatory_lifecycle", lifecycle_type=event.type, **event.data)
    return event


def _candidate_data(candidate: AnticipatoryCandidate) -> dict[str, Any]:
    """The stable subset of a candidate's fields carried on every lifecycle event."""
    return {
        "trigger_id": candidate.trigger_id,
        "proposed_prompt_text": candidate.proposed_prompt_text,
    }


def _build_context_summary(snapshot: AnticipatoryStateSnapshot) -> str:
    """A NEUTRAL context summary for the judge (T-25-03) — shape/metadata only, never raw chat PII.

    `candidate.proposed_prompt_text`/`candidate.rationale` are the only
    free-text that reaches the judge (both already trigger-authored, neutral
    strings); this summary adds counts/booleans about the surrounding state,
    never `last_user_text` itself or any message body.
    """
    idle_seconds = max(0.0, snapshot.now_epoch_s - (snapshot.last_activity_epoch_s or snapshot.now_epoch_s))
    return (
        f"run_events={len(snapshot.run_events)} "
        f"canvas_panels={len(snapshot.canvas_panels)} "
        f"has_last_user_text={snapshot.last_user_text is not None} "
        f"idle_seconds={idle_seconds:.0f}"
    )


__all__ = [
    "AnticipatoryPipelineResult",
    "EvaluateAnticipatoryCandidates",
    "record_candidate_outcome",
    "to_proposal_card_declaration",
]
