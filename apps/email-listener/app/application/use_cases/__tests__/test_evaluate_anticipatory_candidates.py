"""Tests for EvaluateAnticipatoryCandidates — the gate chain (D-08/D-10/D-11/D-12/D-13).

RED (this file) -> GREEN (evaluate_anticipatory_candidates.py). Exercises the
Plan 25-01 idle_after_genui fixture through both independent gates using this
plan's stub judge + a test-local in-memory cap store double — no live Bedrock
call (D-09).

FakeAnticipatoryCapStore (below) mirrors InMemoryAnticipatoryCapStore's
behavior exactly but is defined LOCALLY rather than imported from
app.infrastructure.anticipatory — this test file lives under
app.application.use_cases, and the "Application does not import
infrastructure" lint-imports contract forbids that cross-layer import
(mirrors test_submit_widget_interaction.py's FakeChatWidgetInteractionRepository
convention; the REAL InMemoryAnticipatoryCapStore is exercised via Task 3's
container/DI resolution test instead).
"""

from __future__ import annotations

import pytest

from app.application.use_cases.evaluate_anticipatory_candidates import (
    AnticipatoryPipelineResult,
    EvaluateAnticipatoryCandidates,
    record_candidate_outcome,
    to_proposal_card_declaration,
)
from app.application.use_cases.run_chat_turn_widgets import derive_declared_response_schema
from app.domain.anticipatory.candidate import (
    AnticipatoryCandidate,
    AnticipatoryStateSnapshot,
    SourceStateRef,
    TriggerId,
)
from app.domain.anticipatory.fixtures import idle_after_genui_snapshot
from app.domain.anticipatory.stubs import StubAppropriatenessJudge

_APPROPRIATENESS_THRESHOLD = 0.75
_CAP_PER_WINDOW = 1
_CAP_WINDOW_MINUTES = 10
_CAP_PER_DAY = 3
_IDLE_THRESHOLD_SECONDS = 45.0


class FakeAnticipatoryCapStore:
    """In-process AnticipatoryCapStore test double — mirrors InMemoryAnticipatoryCapStore.

    Defined locally (not imported from app.infrastructure) to keep this
    application-layer test file lint-imports-clean.
    """

    def __init__(self) -> None:
        self._shown_by_conversation: dict[str, list[float]] = {}

    def seed(self, conversation_id: str, timestamps: list[float]) -> None:
        self._shown_by_conversation.setdefault(conversation_id, []).extend(timestamps)

    async def count_shown(self, *, conversation_id: str, since_epoch_s: float) -> int:
        timestamps = self._shown_by_conversation.get(conversation_id, [])
        return sum(1 for ts in timestamps if ts >= since_epoch_s)

    async def record_shown(self, *, conversation_id: str, at_epoch_s: float) -> None:
        self._shown_by_conversation.setdefault(conversation_id, []).append(at_epoch_s)


async def _evaluate(
    pipeline: EvaluateAnticipatoryCandidates,
    snapshot: AnticipatoryStateSnapshot,
    *,
    enabled: bool = True,
    cooldowns: set[TriggerId] | frozenset[TriggerId] = frozenset(),
) -> AnticipatoryPipelineResult:
    """Call pipeline.evaluate() with this test module's fixed gate tunables."""
    return await pipeline.evaluate(
        snapshot,
        enabled=enabled,
        idle_threshold_seconds=_IDLE_THRESHOLD_SECONDS,
        appropriateness_threshold=_APPROPRIATENESS_THRESHOLD,
        cap_per_window=_CAP_PER_WINDOW,
        cap_window_minutes=_CAP_WINDOW_MINUTES,
        cap_per_day=_CAP_PER_DAY,
        cooldowns=cooldowns,
    )


# ---------------------------------------------------------------------------
# Both gates active — independent checks (D-08)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_both_gates_pass_shows_candidate_and_records_shown() -> None:
    snapshot = idle_after_genui_snapshot()
    cap_store = FakeAnticipatoryCapStore()
    pipeline = EvaluateAnticipatoryCandidates(judge=StubAppropriatenessJudge(score_value=0.9), cap_store=cap_store)

    result = await _evaluate(pipeline, snapshot)

    assert [e.type for e in result.events] == ["proposed", "shown"]
    assert len(result.shown) == 1
    assert result.shown[0].trigger_id == "idle_after_genui"
    assert await cap_store.count_shown(conversation_id=snapshot.conversation_id, since_epoch_s=0.0) == 1


@pytest.mark.asyncio
async def test_cap_suppresses_even_when_eval_would_approve() -> None:
    """D-10: the cap denies even though the (never-consulted-for-nothing) eval would pass."""
    snapshot = idle_after_genui_snapshot()
    cap_store = FakeAnticipatoryCapStore()
    cap_store.seed(snapshot.conversation_id, [snapshot.now_epoch_s - 60.0])  # already at the per-window limit
    pipeline = EvaluateAnticipatoryCandidates(judge=StubAppropriatenessJudge(score_value=0.9), cap_store=cap_store)

    result = await _evaluate(pipeline, snapshot)

    assert [e.type for e in result.events] == ["proposed", "suppressed_by_cap"]
    assert result.shown == ()
    # record_shown must NOT have been called again for the suppressed candidate.
    assert await cap_store.count_shown(conversation_id=snapshot.conversation_id, since_epoch_s=0.0) == 1


@pytest.mark.asyncio
async def test_eval_suppresses_when_cap_has_room() -> None:
    """D-07: a below-threshold score suppresses even though the cap has room."""
    snapshot = idle_after_genui_snapshot()
    cap_store = FakeAnticipatoryCapStore()
    pipeline = EvaluateAnticipatoryCandidates(judge=StubAppropriatenessJudge(score_value=0.3), cap_store=cap_store)

    result = await _evaluate(pipeline, snapshot)

    assert [e.type for e in result.events] == ["proposed", "suppressed_by_eval"]
    assert result.shown == ()
    assert await cap_store.count_shown(conversation_id=snapshot.conversation_id, since_epoch_s=0.0) == 0


@pytest.mark.asyncio
async def test_independence_same_candidate_three_outcomes() -> None:
    """Proves D-08: the SAME candidate is shown / suppressed_by_cap / suppressed_by_eval
    depending only on which gate is made to fail — neither check substitutes for the other.
    """
    snapshot = idle_after_genui_snapshot()

    shown_result = await _evaluate(
        EvaluateAnticipatoryCandidates(
            judge=StubAppropriatenessJudge(score_value=0.9), cap_store=FakeAnticipatoryCapStore()
        ),
        snapshot,
    )
    assert [e.type for e in shown_result.events] == ["proposed", "shown"]

    full_cap_store = FakeAnticipatoryCapStore()
    full_cap_store.seed(snapshot.conversation_id, [snapshot.now_epoch_s - 60.0])
    cap_result = await _evaluate(
        EvaluateAnticipatoryCandidates(judge=StubAppropriatenessJudge(score_value=0.9), cap_store=full_cap_store),
        snapshot,
    )
    assert [e.type for e in cap_result.events] == ["proposed", "suppressed_by_cap"]

    eval_result = await _evaluate(
        EvaluateAnticipatoryCandidates(
            judge=StubAppropriatenessJudge(score_value=0.3), cap_store=FakeAnticipatoryCapStore()
        ),
        snapshot,
    )
    assert [e.type for e in eval_result.events] == ["proposed", "suppressed_by_eval"]


@pytest.mark.asyncio
async def test_daily_ceiling_suppresses_even_with_window_room() -> None:
    """D-10: both windows (per-window AND per-day) are independently enforced."""
    snapshot = idle_after_genui_snapshot()
    cap_store = FakeAnticipatoryCapStore()
    window_seconds = _CAP_WINDOW_MINUTES * 60.0
    # 3 prior shows, all OUTSIDE the 10-minute window but WITHIN the 24h day window.
    old_timestamps = [snapshot.now_epoch_s - window_seconds - (60.0 * i) for i in range(1, _CAP_PER_DAY + 1)]
    cap_store.seed(snapshot.conversation_id, old_timestamps)
    pipeline = EvaluateAnticipatoryCandidates(judge=StubAppropriatenessJudge(score_value=0.9), cap_store=cap_store)

    result = await _evaluate(pipeline, snapshot)

    assert [e.type for e in result.events] == ["proposed", "suppressed_by_cap"]


# ---------------------------------------------------------------------------
# Explicit-accept mapping (D-11) — Phase-24 proposal-card reuse, unchanged
# ---------------------------------------------------------------------------


def test_to_proposal_card_declaration_round_trips_with_phase_24() -> None:
    candidate = AnticipatoryCandidate(
        trigger_id="idle_after_genui",
        proposed_prompt_text="Want me to build on that, or try something different?",
        rationale="idle after a settled genui turn",
        source_refs=(SourceStateRef(kind="run_event", ref_id="msg-1"),),
    )

    declaration = to_proposal_card_declaration(candidate)

    assert declaration["options"] == [
        {
            "id": "opt-0",
            "title": declaration["options"][0]["title"],
            "value": candidate.proposed_prompt_text,
        }
    ]
    assert declaration["prompt"] == candidate.proposed_prompt_text

    schema = derive_declared_response_schema("proposal_cards", declaration)
    assert schema["properties"]["optionId"]["enum"] == ["opt-0"]
    assert schema["required"] == ["optionId"]
    assert schema["additionalProperties"] is False


# ---------------------------------------------------------------------------
# Outcome recording (D-13) — accepted/dismissed + dismissal cooldown
# ---------------------------------------------------------------------------


def test_record_candidate_outcome_accepted_appends_event_and_no_cooldown() -> None:
    candidate = AnticipatoryCandidate(
        trigger_id="completed_artifact",
        proposed_prompt_text="Want me to export this table as a CSV?",
        rationale="settled panel with a next-best-action",
    )
    cooldowns: set[TriggerId] = set()

    event = record_candidate_outcome(candidate, "accepted", cooldowns=cooldowns)

    assert event.type == "accepted"
    assert cooldowns == set()


@pytest.mark.asyncio
async def test_record_candidate_outcome_dismissed_registers_cooldown_suppressing_next_evaluation() -> None:
    snapshot = idle_after_genui_snapshot()
    candidate = AnticipatoryCandidate(
        trigger_id="idle_after_genui",
        proposed_prompt_text="Want me to build on that, or try something different?",
        rationale="idle after a settled genui turn",
    )
    cooldowns: set[TriggerId] = set()

    event = record_candidate_outcome(candidate, "dismissed", cooldowns=cooldowns)

    assert event.type == "dismissed"
    assert "idle_after_genui" in cooldowns

    pipeline = EvaluateAnticipatoryCandidates(
        judge=StubAppropriatenessJudge(score_value=0.9), cap_store=FakeAnticipatoryCapStore()
    )
    result = await _evaluate(pipeline, snapshot, cooldowns=cooldowns)

    assert result.events == ()
    assert result.shown == ()


# ---------------------------------------------------------------------------
# Flag OFF (D-12) — the whole pipeline short-circuits
# ---------------------------------------------------------------------------


class _ExplodingJudge:
    """A judge/cap-store double that fails the test if ever called (flag-OFF proof)."""

    async def score(self, **_kwargs: object) -> object:
        raise AssertionError("judge must never be called when the pipeline is disabled")


class _ExplodingCapStore:
    async def count_shown(self, **_kwargs: object) -> int:
        raise AssertionError("cap store must never be called when the pipeline is disabled")

    async def record_shown(self, **_kwargs: object) -> None:
        raise AssertionError("cap store must never be called when the pipeline is disabled")


@pytest.mark.asyncio
async def test_flag_off_short_circuits_everything() -> None:
    snapshot = idle_after_genui_snapshot()
    pipeline = EvaluateAnticipatoryCandidates(judge=_ExplodingJudge(), cap_store=_ExplodingCapStore())  # type: ignore[arg-type]

    result = await _evaluate(pipeline, snapshot, enabled=False)

    assert result.shown == ()
    assert result.events == ()
