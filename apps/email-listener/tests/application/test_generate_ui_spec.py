"""Tests for GenerateUiSpecUseCase (Task 3 TDD RED).

Verifies:
- quarantine → generator pipeline orchestration
- SHA-256 intent hash (never raw string) in GenerationEvent (D-19)
- One GenerationEvent row per execute() call (GEN-05)
- audit failure is swallowed, never propagates (T-13-10)
- SAFE_FALLBACK_SPEC returned when both calls degrade gracefully
- use_case imports NO infrastructure (lint-imports contract)
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase, GenerateUiSpecResult
from app.domain.ports.generation_audit_repository import GenerationEvent
from app.infrastructure.llm.genui_generator_adapter import SAFE_FALLBACK_SPEC
from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------


def _make_extraction(
    *,
    entity_type: str = "card",
    intent_summary: str = "Display a card",
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


def _valid_spec() -> dict:
    return {"v": 1, "root": {"type": "card", "title": "Test Card"}}


@pytest.fixture
def mock_quarantine() -> MagicMock:
    quarantine = MagicMock()
    quarantine.extract = AsyncMock(return_value=_make_extraction())
    return quarantine


@pytest.fixture
def mock_generator() -> MagicMock:
    generator = MagicMock()
    generator.generate = AsyncMock(return_value=_valid_spec())
    return generator


@pytest.fixture
def mock_audit() -> MagicMock:
    audit = MagicMock()
    audit.record = AsyncMock(return_value=None)
    return audit


@pytest.fixture
def use_case(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
) -> GenerateUiSpecUseCase:
    return GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_execute_calls_quarantine_with_intent_and_content(
    use_case: GenerateUiSpecUseCase,
    mock_quarantine: MagicMock,
) -> None:
    """Quarantine adapter must receive the raw intent + raw content."""
    await use_case.execute(
        intent="Show invoice details",
        raw_content="Invoice #123: $500",
        registry_version="v1",
    )
    mock_quarantine.extract.assert_called_once_with(
        intent="Show invoice details",
        raw_content="Invoice #123: $500",
    )


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_execute_calls_generator_with_extraction(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
    mock_quarantine: MagicMock,
) -> None:
    """Generator adapter must receive the quarantine extraction + registry_version."""
    extraction = _make_extraction(entity_type="table", intent_summary="Show data table")
    mock_quarantine.extract = AsyncMock(return_value=extraction)

    await use_case.execute(
        intent="Show data table",
        raw_content="col1, col2\nval1, val2",
        registry_version="v2",
    )
    mock_generator.generate.assert_called_once_with(
        extraction=extraction,
        registry_version="v2",
    )


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_execute_returns_spec_and_metadata(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """execute() returns GenerateUiSpecResult with the spec dict."""
    expected_spec = _valid_spec()
    mock_generator.generate = AsyncMock(return_value=expected_spec)

    result = await use_case.execute(
        intent="Test",
        raw_content="content",
        registry_version="v1",
    )
    assert isinstance(result, GenerateUiSpecResult)
    assert result.spec == expected_spec


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_execute_records_one_audit_event_per_call(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
) -> None:
    """Exactly one GenerationEvent must be recorded per execute() (GEN-05)."""
    await use_case.execute(
        intent="Display summary",
        raw_content="Summary text",
        registry_version="v1",
    )
    assert mock_audit.record.call_count == 1


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_uses_sha256_hash_not_raw_intent(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
) -> None:
    """intent_hash in GenerationEvent must be SHA-256 of the intent, NEVER the raw string (D-19)."""
    raw_intent = "Display invoice summary"
    expected_hash = hashlib.sha256(raw_intent.encode()).hexdigest()

    await use_case.execute(
        intent=raw_intent,
        raw_content="content",
        registry_version="v1",
    )
    call_args = mock_audit.record.call_args
    event: GenerationEvent = call_args[0][0]
    assert event.intent_hash == expected_hash
    assert raw_intent not in event.intent_hash  # hash is not the literal string


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_outcome_ok_on_valid_spec(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """GenerationEvent.outcome must be 'ok' when generator returns a valid spec."""
    mock_generator.generate = AsyncMock(return_value=_valid_spec())

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.outcome == "ok"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_outcome_fallback_when_generator_returns_fallback(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """GenerationEvent.outcome must be 'fallback' when SAFE_FALLBACK_SPEC is returned."""
    mock_generator.generate = AsyncMock(return_value=SAFE_FALLBACK_SPEC)

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.outcome == "fallback"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_failure_is_swallowed_not_propagated(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
) -> None:
    """Audit failures must be swallowed — execute() must not raise (T-13-10)."""
    mock_audit.record = AsyncMock(side_effect=RuntimeError("DB down"))

    # Should NOT raise even though audit fails
    result = await use_case.execute(
        intent="Display invoice",
        raw_content="content",
        registry_version="v1",
    )
    # Result must still be returned
    assert result.spec is not None


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_execute_returns_fallback_spec_when_quarantine_returns_unknown(
    use_case: GenerateUiSpecUseCase,
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """When quarantine returns entity_type='unknown', generator still runs (best-effort)."""
    empty_extraction = QuarantineExtraction()  # entity_type='unknown', confidence='low'
    mock_quarantine.extract = AsyncMock(return_value=empty_extraction)
    mock_generator.generate = AsyncMock(return_value=SAFE_FALLBACK_SPEC)

    result = await use_case.execute(
        intent="Unknown intent",
        raw_content="Garbage content",
        registry_version="v1",
    )
    assert result.spec == SAFE_FALLBACK_SPEC
    # Generator was still called (best-effort)
    mock_generator.generate.assert_called_once()


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_registry_version_matches_input(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
) -> None:
    """GenerationEvent.registry_version must match the execute() parameter."""
    await use_case.execute(
        intent="Test",
        raw_content="content",
        registry_version="catalog-v3.5.1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.registry_version == "catalog-v3.5.1"


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_model_id_is_set(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_quarantine: MagicMock,
) -> None:
    """GenerationEvent.model_id must be a non-empty string."""
    mock_quarantine.extract = AsyncMock(return_value=_make_extraction(input_tokens=20, output_tokens=15))

    await use_case.execute(
        intent="Test",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert isinstance(event.model_id, str)
    assert len(event.model_id) > 0


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_audit_event_tokens_reflect_quarantine_extraction(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_quarantine: MagicMock,
) -> None:
    """GenerationEvent token counts must reflect the quarantine extraction usage."""
    mock_quarantine.extract = AsyncMock(
        return_value=_make_extraction(input_tokens=100, output_tokens=50)
    )

    await use_case.execute(
        intent="Test",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    # Tokens come from the quarantine extraction (at minimum)
    assert event.input_tokens >= 100
    assert event.output_tokens >= 50


@pytest.mark.unit()
@pytest.mark.asyncio()
async def test_use_case_no_infrastructure_import() -> None:
    """Verify use case module does not import infrastructure at module level (lint-imports)."""
    import importlib
    import inspect
    import sys

    # Reload module to inspect its own imports
    mod_name = "app.application.use_cases.generate_ui_spec"
    if mod_name in sys.modules:
        mod = sys.modules[mod_name]
    else:
        mod = importlib.import_module(mod_name)

    src = inspect.getsource(mod)
    # Must NOT have a top-level infra import
    assert "from app.infrastructure" not in src, (
        "use case must not import app.infrastructure — domain-pure (lint-imports contract)"
    )
