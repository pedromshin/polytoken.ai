"""Tests for GenerateCodeIslandUseCase (PARALLEL multi-candidate + judge code-island path).

Verifies:
- quarantine (ONCE) → fan-out N candidates → judge → audit orchestration
- temperature spread across candidates (varied), generate() called N times
- all-fallback → fallback result; exactly-one-good → that one (judge skipped);
  >= 2 good → judge.rank picks winner; judge failure (returns 0) → first good
- candidate_count / judged populated on the result
- SHA-256 intent hash (never raw string) in GenerationEvent (D-19)
- One GenerationEvent row per execute() call, best-effort (GEN-05, T-13-10)
- audit failure is swallowed, never propagates (T-13-10)
- fallback path: is_fallback → outcome 'fallback', audit still called
- escalated path: escalated → outcome 'escalated'
- use_case imports NO infrastructure (lint-imports contract)
- registry_version marker + neutral spec-field defaults on the audit row
- _candidate_temperatures pure helper spread
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.use_cases.generate_code_island import (
    GenerateCodeIslandResult,
    GenerateCodeIslandUseCase,
    _candidate_temperatures,
)
from app.domain.ports.generation_audit_repository import GenerationEvent
from app.infrastructure.llm.genui_code_generator_adapter import (
    SAFE_FALLBACK_CODE,
    CodeGeneratorResult,
)
from app.infrastructure.llm.genui_code_judge_adapter import JudgeResult
from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_VALID_CODE = "const r = document.getElementById('island-root'); r.textContent = 'hi';"


def _make_extraction(
    *,
    entity_type: str = "card",
    intent_summary: str = "Build a card",
    confidence: str = "high",
    input_tokens: int = 10,
    output_tokens: int = 5,
) -> QuarantineExtraction:
    return QuarantineExtraction(
        entity_type=entity_type,
        intent_summary=intent_summary,
        confidence=confidence,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


@pytest.fixture
def mock_quarantine() -> MagicMock:
    quarantine = MagicMock()
    quarantine.extract = AsyncMock(return_value=_make_extraction())
    return quarantine


@pytest.fixture
def mock_code_generator() -> MagicMock:
    generator = MagicMock()
    generator.generate = AsyncMock(
        return_value=CodeGeneratorResult(code=_VALID_CODE, language="javascript", attempts=1, escalated=False)
    )
    return generator


@pytest.fixture
def mock_audit() -> MagicMock:
    audit = MagicMock()
    audit.record = AsyncMock(return_value=None)
    return audit


@pytest.fixture
def mock_judge() -> MagicMock:
    judge = MagicMock()
    judge.rank = AsyncMock(return_value=JudgeResult(best_index=0))
    return judge


@pytest.fixture
def use_case(
    mock_quarantine: MagicMock,
    mock_code_generator: MagicMock,
    mock_judge: MagicMock,
    mock_audit: MagicMock,
) -> GenerateCodeIslandUseCase:
    """Single-candidate use case (candidates=1) so existing single-path assertions hold.

    Multi-candidate fan-out + judge behaviour is exercised in dedicated tests below that
    build their own use case with candidates >= 2.
    """
    return GenerateCodeIslandUseCase(
        quarantine=mock_quarantine,
        code_generator=mock_code_generator,
        judge=mock_judge,
        audit=mock_audit,
        candidates=1,
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_quarantine_then_generate(
    use_case: GenerateCodeIslandUseCase,
    mock_quarantine: MagicMock,
    mock_code_generator: MagicMock,
) -> None:
    """execute() runs quarantine then code-generate and returns ok code."""
    result = await use_case.execute(intent="Build a dashboard", raw_content="rows...")

    assert isinstance(result, GenerateCodeIslandResult)
    assert result.code == _VALID_CODE
    assert result.language == "javascript"
    assert result.outcome == "ok"
    assert result.attempts == 1

    mock_quarantine.extract.assert_awaited_once()
    # Raw content goes ONLY through quarantine (SAFE-01).
    q_kwargs = mock_quarantine.extract.call_args.kwargs
    assert q_kwargs["intent"] == "Build a dashboard"
    assert q_kwargs["raw_content"] == "rows..."

    # Generator receives the extraction, never raw prose (SAFE-02).
    g_kwargs = mock_code_generator.generate.call_args.kwargs
    assert isinstance(g_kwargs["extraction"], QuarantineExtraction)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_intent_hash_is_sha256_not_raw(
    use_case: GenerateCodeIslandUseCase,
    mock_audit: MagicMock,
) -> None:
    """The audit row must store SHA-256(intent), never the raw intent string (D-19)."""
    intent = "Build a very secret dashboard"
    await use_case.execute(intent=intent)

    mock_audit.record.assert_awaited_once()
    event: GenerationEvent = mock_audit.record.call_args.args[0]
    expected = hashlib.sha256(intent.encode()).hexdigest()
    assert event.intent_hash == expected
    assert intent not in event.intent_hash


@pytest.mark.unit
@pytest.mark.asyncio
async def test_audit_row_uses_code_island_registry_and_neutral_spec_fields(
    use_case: GenerateCodeIslandUseCase,
    mock_audit: MagicMock,
) -> None:
    """Audit row uses the code-island registry marker + neutral spec-specific defaults."""
    await use_case.execute(intent="Build a widget", importer_id="imp-1")

    event: GenerationEvent = mock_audit.record.call_args.args[0]
    assert event.registry_version == "code-island-v1"
    assert event.spec_node_count is None
    assert event.spec_depth is None
    assert event.style_pack_id is None
    assert event.retrieved_ids == ()
    assert event.retrieved_overlap_count == 0
    assert event.importer_id == "imp-1"
    assert event.outcome == "ok"
    assert event.spec_validation_passed is True


# ---------------------------------------------------------------------------
# Fallback path
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fallback_outcome_when_generator_returns_fallback(
    use_case: GenerateCodeIslandUseCase,
    mock_code_generator: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """is_fallback=True → outcome 'fallback', SAFE_FALLBACK_CODE, audit still best-effort called."""
    mock_code_generator.generate = AsyncMock(
        return_value=CodeGeneratorResult(
            code=SAFE_FALLBACK_CODE, language="javascript", attempts=3, escalated=True, is_fallback=True
        )
    )

    result = await use_case.execute(intent="garbage")

    assert result.outcome == "fallback"
    assert result.code == SAFE_FALLBACK_CODE
    assert result.attempts == 3
    # Audit is still recorded on the fallback path (best-effort).
    mock_audit.record.assert_awaited_once()
    event: GenerationEvent = mock_audit.record.call_args.args[0]
    assert event.outcome == "fallback"
    assert event.spec_validation_passed is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_escalated_outcome(
    use_case: GenerateCodeIslandUseCase,
    mock_code_generator: MagicMock,
) -> None:
    """escalated=True (not fallback) → outcome 'escalated'."""
    mock_code_generator.generate = AsyncMock(
        return_value=CodeGeneratorResult(
            code=_VALID_CODE, language="javascript", attempts=3, escalated=True, is_fallback=False
        )
    )

    result = await use_case.execute(intent="Build something tricky")

    assert result.outcome == "escalated"
    assert result.code == _VALID_CODE


# ---------------------------------------------------------------------------
# Audit best-effort (T-13-10)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_audit_failure_is_swallowed(
    use_case: GenerateCodeIslandUseCase,
    mock_audit: MagicMock,
) -> None:
    """An audit repository error must NOT propagate; execute() returns the code normally."""
    mock_audit.record = AsyncMock(side_effect=RuntimeError("db down"))

    result = await use_case.execute(intent="Build a card")

    assert result.code == _VALID_CODE
    assert result.outcome == "ok"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_one_audit_row_per_execute(
    use_case: GenerateCodeIslandUseCase,
    mock_audit: MagicMock,
) -> None:
    """Exactly one GenerationEvent is recorded per execute() call (GEN-05)."""
    await use_case.execute(intent="Build a card")
    assert mock_audit.record.await_count == 1


# ---------------------------------------------------------------------------
# Parallel multi-candidate fan-out + judge
# ---------------------------------------------------------------------------


def _make_use_case(
    *,
    quarantine: MagicMock,
    code_generator: MagicMock,
    judge: MagicMock,
    audit: MagicMock,
    candidates: int,
) -> GenerateCodeIslandUseCase:
    return GenerateCodeIslandUseCase(
        quarantine=quarantine,
        code_generator=code_generator,
        judge=judge,
        audit=audit,
        candidates=candidates,
    )


def _good(code: str, *, escalated: bool = False) -> CodeGeneratorResult:
    return CodeGeneratorResult(code=code, language="javascript", attempts=1, escalated=escalated, is_fallback=False)


def _fallback() -> CodeGeneratorResult:
    return CodeGeneratorResult(
        code=SAFE_FALLBACK_CODE, language="javascript", attempts=3, escalated=True, is_fallback=True
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fans_out_n_candidates_with_varied_temperatures(
    mock_quarantine: MagicMock,
    mock_judge: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """execute() calls generate() N times (N=candidates) with distinct temperatures."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_good("A"), _good("B"), _good("C")])
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=mock_judge, audit=mock_audit, candidates=3
    )

    result = await uc.execute(intent="Build a Twitter clone")

    assert generator.generate.await_count == 3
    temps = [c.kwargs["temperature"] for c in generator.generate.call_args_list]
    assert temps == [0.4, 0.7, 1.0]
    # Quarantine runs exactly ONCE regardless of N.
    mock_quarantine.extract.assert_awaited_once()
    assert result.candidate_count == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_all_fallback_returns_fallback_result(
    mock_quarantine: MagicMock,
    mock_judge: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """When every candidate falls back, the result is a fallback (judge NOT called)."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_fallback(), _fallback(), _fallback()])
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=mock_judge, audit=mock_audit, candidates=3
    )

    result = await uc.execute(intent="garbage")

    assert result.outcome == "fallback"
    assert result.code == SAFE_FALLBACK_CODE
    assert result.candidate_count == 3
    assert result.judged is False
    mock_judge.rank.assert_not_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_exactly_one_good_skips_judge(
    mock_quarantine: MagicMock,
    mock_judge: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """Exactly one non-fallback candidate → that one is used, judge NOT called."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_fallback(), _good("ONLY_GOOD"), _fallback()])
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=mock_judge, audit=mock_audit, candidates=3
    )

    result = await uc.execute(intent="Build a card")

    assert result.code == "ONLY_GOOD"
    assert result.outcome == "ok"
    assert result.candidate_count == 3
    assert result.judged is False
    mock_judge.rank.assert_not_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_two_or_more_good_calls_judge_and_returns_winner(
    mock_quarantine: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """>= 2 non-fallback candidates → judge.rank picks the winner, judged=True."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_good("CAND0"), _good("CAND1"), _good("CAND2")])
    judge = MagicMock()
    judge.rank = AsyncMock(return_value=JudgeResult(best_index=2, input_tokens=200, output_tokens=30))
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=judge, audit=mock_audit, candidates=3
    )

    result = await uc.execute(intent="Build a distinctive dashboard")

    judge.rank.assert_awaited_once()
    rank_kwargs = judge.rank.call_args.kwargs
    assert rank_kwargs["intent_summary"] == "Build a card"  # from _make_extraction default
    assert rank_kwargs["candidates"] == ["CAND0", "CAND1", "CAND2"]
    assert result.code == "CAND2"
    assert result.judged is True
    assert result.candidate_count == 3

    # D-22: the judge's REAL usage is added to extraction's (Call A) usage in the audit row.
    event = mock_audit.record.call_args.args[0]
    assert event.input_tokens == 10 + 200  # extraction default (10) + judge (200)
    assert event.output_tokens == 5 + 30  # extraction default (5) + judge (30)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_judge_failure_returns_first_good(
    mock_quarantine: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """The judge returns 0 on failure (never raises) → the first good candidate wins."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_good("FIRST_GOOD"), _good("SECOND_GOOD"), _fallback()])
    judge = MagicMock()
    judge.rank = AsyncMock(return_value=JudgeResult(best_index=0))  # judge-failure contract
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=judge, audit=mock_audit, candidates=3
    )

    result = await uc.execute(intent="Build something")

    judge.rank.assert_awaited_once()
    assert result.code == "FIRST_GOOD"
    assert result.judged is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_judge_out_of_range_index_is_clamped(
    mock_quarantine: MagicMock,
    mock_audit: MagicMock,
) -> None:
    """A judge index beyond the good-candidate range is clamped to the last good one."""
    generator = MagicMock()
    generator.generate = AsyncMock(side_effect=[_good("G0"), _good("G1")])
    judge = MagicMock()
    judge.rank = AsyncMock(return_value=JudgeResult(best_index=99))
    uc = _make_use_case(
        quarantine=mock_quarantine, code_generator=generator, judge=judge, audit=mock_audit, candidates=2
    )

    result = await uc.execute(intent="Build something")

    assert result.code == "G1"
    assert result.judged is True


# ---------------------------------------------------------------------------
# _candidate_temperatures pure helper
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_candidate_temperatures_single() -> None:
    """N == 1 → the balanced default [0.7]."""
    assert _candidate_temperatures(1) == [0.7]


@pytest.mark.unit
def test_candidate_temperatures_three_evenly_spaced() -> None:
    """N == 3 → [0.4, 0.7, 1.0]."""
    assert _candidate_temperatures(3) == [0.4, 0.7, 1.0]


@pytest.mark.unit
def test_candidate_temperatures_endpoints_are_extremes() -> None:
    """For N >= 2 the spread endpoints are always 0.4 (low) and 1.0 (high)."""
    for n in (2, 3, 4, 5):
        temps = _candidate_temperatures(n)
        assert len(temps) == n
        assert temps[0] == 0.4
        assert temps[-1] == 1.0
        # strictly increasing
        assert all(temps[i] < temps[i + 1] for i in range(n - 1))
