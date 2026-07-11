"""Tests for GenerateUiSpecUseCase (Task 3 + Task 14-03 + Task 17-04 TDD RED).

Verifies:
- quarantine → generator pipeline orchestration
- SHA-256 intent hash (never raw string) in GenerationEvent (D-19)
- One GenerationEvent row per execute() call (GEN-05)
- audit failure is swallowed, never propagates (T-13-10)
- SAFE_FALLBACK_SPEC returned when both calls degrade gracefully
- use_case imports NO infrastructure (lint-imports contract)

Cache tests (Phase 14-03, CACHE-01..04):
- D-02: Cache CHECK is step-0 BEFORE quarantine/generator/audit
- D-03: Cache hit returns cached spec; no quarantine/generator/audit calls
- D-11: Never persist when outcome == 'fallback' (SAFE_FALLBACK_SPEC)
- D-13: Registry-version in key → new version yields a miss (cold regen)
- D-17: Template persist errors never propagate
- cache_hit=True in result on cache hit; cache_hit=False on cold regen

Pack + RAG tests (Phase 17-04, D-08/RAG-01/RAG-02):
- style_pack_id is a cache-key dimension (T-17-20)
- retrieve() called before generate() on cache MISS (RAG-01)
- retrieved_ids + style_pack_id on result + GenerationEvent (D-08/D-14)
- cache HIT still short-circuits — no retrieval/generate/audit (Phase-14 semantics)
- _count_retrieved_overlap computed + logged per generation (RAG-02)
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.use_cases.generate_ui_spec import GenerateUiSpecResult, GenerateUiSpecUseCase
from app.domain.ports.generation_audit_repository import GenerationEvent
from app.domain.ports.retrieval_provider import RetrievalResult, RetrievedItem
from app.domain.ports.ui_spec_template_repository import CachedTemplate
from app.infrastructure.llm.genui_generator_adapter import SAFE_FALLBACK_SPEC, GeneratorResult
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
    generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)
    )
    return generator


@pytest.fixture
def mock_audit() -> MagicMock:
    audit = MagicMock()
    audit.record = AsyncMock(return_value=None)
    return audit


@pytest.fixture
def mock_templates() -> MagicMock:
    """Mock UiSpecTemplateRepository — default: cache miss on find_by_cache_key."""
    templates = MagicMock()
    templates.find_by_cache_key = AsyncMock(return_value=None)  # default: cache miss
    templates.persist = AsyncMock(return_value=None)
    templates.increment_use_count = AsyncMock(return_value=None)
    return templates


def _make_retrieval_result(
    *,
    item_ids: list[str] | None = None,
) -> RetrievalResult:
    """Return a RetrievalResult with synthetic component items."""
    if item_ids is None:
        item_ids = ["card", "grid"]
    items = tuple(
        RetrievedItem(id=item_id, kind="component", score=0.8, payload={"type": item_id})
        for item_id in item_ids
    )
    return RetrievalResult(items=items)


@pytest.fixture
def mock_retrieval() -> MagicMock:
    """Mock RetrievalProvider — default: returns 2-item RetrievalResult."""
    retrieval = MagicMock()
    retrieval.retrieve = AsyncMock(return_value=_make_retrieval_result())
    return retrieval


@pytest.fixture
def use_case(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> GenerateUiSpecUseCase:
    return GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )


@pytest.fixture
def use_case_with_retrieval(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
    mock_retrieval: MagicMock,
) -> GenerateUiSpecUseCase:
    """Use case with a retrieval provider wired in (Task 17-04)."""
    return GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
        retrieval_provider=mock_retrieval,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
async def test_execute_calls_generator_with_extraction(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
    mock_quarantine: MagicMock,
) -> None:
    """Generator adapter must receive the quarantine extraction + registry_version
    (and optionally style_pack_id + retrieval when a retrieval_provider is wired)."""
    extraction = _make_extraction(entity_type="table", intent_summary="Show data table")
    mock_quarantine.extract = AsyncMock(return_value=extraction)

    await use_case.execute(
        intent="Show data table",
        raw_content="col1, col2\nval1, val2",
        registry_version="v2",
    )
    call_kwargs = mock_generator.generate.call_args.kwargs
    assert call_kwargs["extraction"] == extraction
    assert call_kwargs["registry_version"] == "v2"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_execute_returns_spec_and_metadata(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """execute() returns GenerateUiSpecResult with the spec dict."""
    expected_spec = _valid_spec()
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=expected_spec, attempts=1, escalated=False)
    )

    result = await use_case.execute(
        intent="Test",
        raw_content="content",
        registry_version="v1",
    )
    assert isinstance(result, GenerateUiSpecResult)
    assert result.spec == expected_spec


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
async def test_audit_event_outcome_ok_on_valid_spec(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """GenerationEvent.outcome must be 'ok' when generator returns a valid spec."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)
    )

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.outcome == "ok"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_audit_event_outcome_fallback_when_generator_returns_fallback(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """GenerationEvent.outcome must be 'fallback' when SAFE_FALLBACK_SPEC is returned."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=3, escalated=True, is_fallback=True)
    )

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.outcome == "fallback"


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
async def test_execute_returns_fallback_spec_when_quarantine_returns_unknown(
    use_case: GenerateUiSpecUseCase,
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """When quarantine returns entity_type='unknown', generator still runs (best-effort)."""
    empty_extraction = QuarantineExtraction()  # entity_type='unknown', confidence='low'
    mock_quarantine.extract = AsyncMock(return_value=empty_extraction)
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=3, escalated=True, is_fallback=True)
    )

    result = await use_case.execute(
        intent="Unknown intent",
        raw_content="Garbage content",
        registry_version="v1",
    )
    assert result.spec == SAFE_FALLBACK_SPEC
    # Generator was still called (best-effort)
    mock_generator.generate.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
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


@pytest.mark.unit
@pytest.mark.asyncio
async def test_use_case_no_infrastructure_import() -> None:
    """Verify use case module does not import infrastructure at module level (lint-imports)."""
    import importlib
    import inspect
    import sys

    # Reload module to inspect its own imports
    mod_name = "app.application.use_cases.generate_ui_spec"
    mod = sys.modules[mod_name] if mod_name in sys.modules else importlib.import_module(mod_name)

    src = inspect.getsource(mod)
    # Must NOT have a top-level infra import
    assert "from app.infrastructure" not in src, (
        "use case must not import app.infrastructure — domain-pure (lint-imports contract)"
    )


# ---------------------------------------------------------------------------
# Cache tests (Phase 14-03, CACHE-01..04)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_hit_skips_quarantine_generator_and_audit(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """D-02/D-03: Cache hit must skip quarantine, generator, and audit entirely (zero-Bedrock-on-hit)."""
    cached_spec = {"v": 1, "root": {"type": "card", "title": "Cached Card"}}
    mock_templates.find_by_cache_key = AsyncMock(
        return_value=CachedTemplate(id="cached-id-123", spec_json=cached_spec)
    )
    use_case = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )

    result = await use_case.execute(
        intent="Show invoice",
        raw_content="Invoice #123",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    assert result.spec == cached_spec
    assert result.cache_hit is True
    mock_quarantine.extract.assert_not_called()
    mock_generator.generate.assert_not_called()
    mock_audit.record.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_hit_increments_use_count(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """D-03: On cache hit, increment_use_count is called with the template id."""
    cached_spec = {"v": 1, "root": {"type": "card", "title": "Hit"}}
    mock_templates.find_by_cache_key = AsyncMock(
        return_value=CachedTemplate(id="tmpl-abc", spec_json=cached_spec)
    )
    use_case = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )

    await use_case.execute(
        intent="Show invoice",
        raw_content="Invoice #123",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    mock_templates.increment_use_count.assert_called_once_with("tmpl-abc")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_miss_runs_pipeline_and_cache_hit_is_false(
    use_case: GenerateUiSpecUseCase,
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """On cache miss, the full pipeline runs and result.cache_hit is False."""
    # Default mock_templates has find_by_cache_key returning None (miss)
    result = await use_case.execute(
        intent="Show invoice",
        raw_content="Invoice #123",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    assert result.cache_hit is False
    mock_quarantine.extract.assert_called_once()
    mock_generator.generate.assert_called_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_persist_called_after_validated_spec(
    use_case: GenerateUiSpecUseCase,
    mock_templates: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """D-11: persist is called when outcome != 'fallback' (validated spec)."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)
    )

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    assert mock_templates.persist.call_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_persist_not_called_when_outcome_is_fallback(
    use_case: GenerateUiSpecUseCase,
    mock_templates: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """D-11: persist must NOT be called when generator returns SAFE_FALLBACK_SPEC."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=3, escalated=True, is_fallback=True)
    )

    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    mock_templates.persist.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_legitimate_alert_spec_with_fallback_title_is_cached_not_dropped(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """CR-02 regression: legitimate alert spec with title starting 'Unable to generate'
    must NOT be misclassified as a fallback. It must be cached and outcome='ok'.

    This covers the false-positive that the old content-sniffing approach in
    _determine_outcome() would have introduced: any alert spec with a matching
    title fragment would be silently dropped from cache.
    """
    # A real business component — e.g. an error-state card for a failed fetch.
    # The title happens to start with the same text as SAFE_FALLBACK_SPEC, but
    # this spec is NOT a fallback — is_fallback is False (default).
    legitimate_alert_spec = {
        "v": 1,
        "root": {
            "type": "alert",
            "title": "Unable to generate report: data source unavailable",
            "severity": "warning",
        },
    }
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(
            spec=legitimate_alert_spec,
            attempts=1,
            escalated=False,
            is_fallback=False,  # NOT a fallback — explicitly set (CR-02)
        )
    )
    use_case = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )

    result = await use_case.execute(
        intent="Show error state when data source fails",
        raw_content="{}",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    # Spec is returned correctly
    assert result.spec == legitimate_alert_spec
    assert result.cache_hit is False

    # MUST persist — not misclassified as fallback
    mock_templates.persist.assert_called_once()

    # Outcome must be 'ok', not 'fallback'
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert event.outcome == "ok", (
        f"Legitimate alert spec must have outcome='ok', not 'fallback'. Got: {event.outcome!r}"
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_persist_error_is_swallowed(
    use_case: GenerateUiSpecUseCase,
    mock_templates: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """D-17: persist failure must be swallowed — execute() must not raise."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)
    )
    mock_templates.persist = AsyncMock(side_effect=RuntimeError("DB down"))

    # Must not raise — persist is best-effort (D-17)
    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )
    assert result.spec == _valid_spec()


# ---------------------------------------------------------------------------
# D-05 outcome field tests (Phase 15-01)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_hit_outcome_is_ok(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """D-05.2: cache hit must set outcome='ok' (cached spec is pre-validated, never a fallback)."""
    cached_spec = {"v": 1, "root": {"type": "card", "title": "Cached"}}
    mock_templates.find_by_cache_key = AsyncMock(
        return_value=CachedTemplate(id="tmpl-x", spec_json=cached_spec)
    )
    use_case = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )

    result = await use_case.execute(
        intent="Show invoice",
        raw_content="Invoice #123",
        registry_version="v1",
        importer_id=None,
        catalog_id="global",
    )

    assert result.cache_hit is True
    assert result.outcome == "ok"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cold_ok_outcome(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """D-05.2: cold path with is_fallback=False, escalated=False => outcome='ok', cache_hit=False."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)
    )

    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )

    assert result.outcome == "ok"
    assert result.cache_hit is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cold_escalated_outcome(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """D-05.2: cold path with escalated=True, is_fallback=False => outcome='escalated'."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=_valid_spec(), attempts=3, escalated=True, is_fallback=False)
    )

    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )

    assert result.outcome == "escalated"
    assert result.cache_hit is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cold_fallback_outcome(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """D-05.2: cold path with is_fallback=True => outcome='fallback'."""
    mock_generator.generate = AsyncMock(
        return_value=GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=3, escalated=True, is_fallback=True)
    )

    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )

    assert result.outcome == "fallback"
    assert result.cache_hit is False


# ---------------------------------------------------------------------------
# Phase 17-04 tests: pack-aware cache + RAG-grounded generation
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_execute_accepts_style_pack_id_param(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """execute() must accept style_pack_id as a keyword arg (D-08)."""
    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        style_pack_id="brutalist",
    )
    assert result.spec is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_execute_style_pack_id_none_uses_default(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """execute() with style_pack_id=None must resolve to a default pack (no error)."""
    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        style_pack_id=None,
    )
    assert result.spec is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_two_packs_yield_two_distinct_cache_keys(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
) -> None:
    """D-08/T-17-20: a pack swap must MISS a spec cached under the other pack."""
    # Use case without retrieval — just testing cache-key isolation
    uc = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
    )

    # Capture the first cache-key lookup arg (polytoken-teal)
    key_calls: list[str] = []
    original_find = mock_templates.find_by_cache_key

    async def capture_key(key: str) -> None:  # type: ignore[return]
        key_calls.append(key)
        return await original_find(key)

    mock_templates.find_by_cache_key = capture_key

    await uc.execute(
        intent="Show invoice",
        raw_content="Invoice #1",
        registry_version="v1",
        style_pack_id="polytoken-teal",
    )
    await uc.execute(
        intent="Show invoice",
        raw_content="Invoice #1",
        registry_version="v1",
        style_pack_id="brutalist",
    )

    # Two distinct cache keys must have been used
    assert len(key_calls) == 2
    assert key_calls[0] != key_calls[1], (
        "Different style_pack_ids must produce different cache keys (T-17-20/D-08)"
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_miss_calls_retrieve_before_generate(
    use_case_with_retrieval: GenerateUiSpecUseCase,
    mock_retrieval: MagicMock,
    mock_generator: MagicMock,
) -> None:
    """RAG-01: on cache MISS, retrieve() must be called BEFORE generator.generate()."""
    call_order: list[str] = []

    async def track_retrieve(**kwargs: object) -> RetrievalResult:
        call_order.append("retrieve")
        return _make_retrieval_result()

    async def track_generate(**kwargs: object) -> GeneratorResult:
        call_order.append("generate")
        return GeneratorResult(spec=_valid_spec(), attempts=1, escalated=False)

    mock_retrieval.retrieve = AsyncMock(side_effect=track_retrieve)
    mock_generator.generate = AsyncMock(side_effect=track_generate)

    await use_case_with_retrieval.execute(
        intent="Show invoice",
        raw_content="content",
        registry_version="v1",
        style_pack_id="polytoken-teal",
    )

    assert call_order == ["retrieve", "generate"], (
        f"retrieve() must be called BEFORE generate(). Got order: {call_order}"
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_retrieve_passes_style_pack_id_and_intent(
    use_case_with_retrieval: GenerateUiSpecUseCase,
    mock_retrieval: MagicMock,
) -> None:
    """RAG-01: retrieve() must be called with the intent and style_pack_id."""
    await use_case_with_retrieval.execute(
        intent="Show invoice table",
        raw_content="content",
        registry_version="v1",
        style_pack_id="warm-editorial",
    )

    call_kwargs = mock_retrieval.retrieve.call_args.kwargs
    assert call_kwargs["intent"] == "Show invoice table"
    assert call_kwargs["style_pack_id"] == "warm-editorial"
    assert "top_k" in call_kwargs


@pytest.mark.unit
@pytest.mark.asyncio
async def test_generate_receives_retrieval_and_style_pack_id(
    use_case_with_retrieval: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
    mock_retrieval: MagicMock,
) -> None:
    """RAG-01: generator.generate() must receive retrieval + style_pack_id kwargs."""
    retrieval_result = _make_retrieval_result(item_ids=["card", "table"])
    mock_retrieval.retrieve = AsyncMock(return_value=retrieval_result)

    await use_case_with_retrieval.execute(
        intent="Show invoice",
        raw_content="content",
        registry_version="v1",
        style_pack_id="linear-clean",
    )

    call_kwargs = mock_generator.generate.call_args.kwargs
    assert call_kwargs.get("style_pack_id") == "linear-clean"
    assert call_kwargs.get("retrieval") == retrieval_result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_result_carries_style_pack_id_and_retrieved_ids(
    use_case_with_retrieval: GenerateUiSpecUseCase,
    mock_retrieval: MagicMock,
) -> None:
    """D-08/D-14: GenerateUiSpecResult must carry style_pack_id + retrieved_ids."""
    retrieval_result = _make_retrieval_result(item_ids=["card", "grid", "button"])
    mock_retrieval.retrieve = AsyncMock(return_value=retrieval_result)

    result = await use_case_with_retrieval.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        style_pack_id="brutalist",
    )

    assert hasattr(result, "style_pack_id"), "GenerateUiSpecResult must have style_pack_id field"
    assert hasattr(result, "retrieved_ids"), "GenerateUiSpecResult must have retrieved_ids field"
    assert result.style_pack_id == "brutalist"
    assert set(result.retrieved_ids) == {"card", "grid", "button"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_generation_event_carries_style_pack_id_and_retrieved_ids(
    use_case_with_retrieval: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
    mock_retrieval: MagicMock,
) -> None:
    """D-14: GenerationEvent must record style_pack_id + retrieved_ids (RAG-02 audit)."""
    retrieval_result = _make_retrieval_result(item_ids=["table", "card"])
    mock_retrieval.retrieve = AsyncMock(return_value=retrieval_result)

    await use_case_with_retrieval.execute(
        intent="Show invoice",
        raw_content="content",
        registry_version="v1",
        style_pack_id="corporate-saas",
    )

    event: GenerationEvent = mock_audit.record.call_args[0][0]
    assert hasattr(event, "style_pack_id"), "GenerationEvent must have style_pack_id field"
    assert hasattr(event, "retrieved_ids"), "GenerationEvent must have retrieved_ids field"
    assert hasattr(event, "retrieved_overlap_count"), "GenerationEvent must have retrieved_overlap_count field"
    assert event.style_pack_id == "corporate-saas"
    assert set(event.retrieved_ids) == {"table", "card"}
    assert isinstance(event.retrieved_overlap_count, int)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_hit_still_short_circuits_with_pack(
    mock_quarantine: MagicMock,
    mock_generator: MagicMock,
    mock_audit: MagicMock,
    mock_templates: MagicMock,
    mock_retrieval: MagicMock,
) -> None:
    """Phase-14 semantics preserved: cache HIT skips retrieval, generate, and audit."""
    cached_spec = {"v": 1, "root": {"type": "card", "title": "Cached"}}
    mock_templates.find_by_cache_key = AsyncMock(
        return_value=CachedTemplate(id="tmpl-hit", spec_json=cached_spec)
    )
    uc = GenerateUiSpecUseCase(
        quarantine=mock_quarantine,
        generator=mock_generator,
        audit=mock_audit,
        templates=mock_templates,
        retrieval_provider=mock_retrieval,
    )

    result = await uc.execute(
        intent="Show invoice",
        raw_content="Invoice #123",
        registry_version="v1",
        style_pack_id="polytoken-teal",
    )

    assert result.cache_hit is True
    assert result.spec == cached_spec
    mock_retrieval.retrieve.assert_not_called()
    mock_quarantine.extract.assert_not_called()
    mock_generator.generate.assert_not_called()
    mock_audit.record.assert_not_called()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_retrieval_provider_wired_still_works(
    use_case: GenerateUiSpecUseCase,
    mock_generator: MagicMock,
) -> None:
    """Use case without retrieval_provider must degrade gracefully (no error, retrieval=None to generate)."""
    result = await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
        style_pack_id="polytoken-teal",
    )
    assert result.spec is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_generation_event_style_pack_id_none_when_no_pack(
    use_case: GenerateUiSpecUseCase,
    mock_audit: MagicMock,
) -> None:
    """GenerationEvent.style_pack_id may be the resolved default when style_pack_id=None."""
    await use_case.execute(
        intent="Show details",
        raw_content="content",
        registry_version="v1",
    )
    event: GenerationEvent = mock_audit.record.call_args[0][0]
    # style_pack_id field must exist on GenerationEvent
    assert hasattr(event, "style_pack_id")


@pytest.mark.unit
def test_generation_event_has_style_pack_and_retrieved_fields() -> None:
    """GenerationEvent frozen dataclass must have style_pack_id + retrieved_ids + retrieved_overlap_count fields."""
    event = GenerationEvent(
        intent_hash="abc123",
        model_id="model-x",
        input_tokens=10,
        output_tokens=5,
        attempts=1,
        outcome="ok",
        spec_validation_passed=True,
        registry_version="v1",
        style_pack_id="polytoken-teal",
        retrieved_ids=("card", "grid"),
        retrieved_overlap_count=1,
    )
    assert event.style_pack_id == "polytoken-teal"
    assert event.retrieved_ids == ("card", "grid")
    assert event.retrieved_overlap_count == 1


@pytest.mark.unit
def test_generation_event_new_fields_have_defaults() -> None:
    """New GenerationEvent fields must have defaults so existing callers keep working."""
    event = GenerationEvent(
        intent_hash="abc123",
        model_id="model-x",
        input_tokens=10,
        output_tokens=5,
        attempts=1,
        outcome="ok",
        spec_validation_passed=True,
        registry_version="v1",
    )
    assert event.style_pack_id is None
    assert event.retrieved_ids == ()
    assert event.retrieved_overlap_count == 0


@pytest.mark.unit
def test_generate_ui_spec_result_has_style_pack_and_retrieved_ids() -> None:
    """GenerateUiSpecResult must carry style_pack_id + retrieved_ids with defaults."""
    result = GenerateUiSpecResult(spec={"v": 1, "root": {"type": "card"}})
    assert hasattr(result, "style_pack_id")
    assert hasattr(result, "retrieved_ids")
    assert result.style_pack_id is None
    assert result.retrieved_ids == ()


@pytest.mark.unit
def test_generate_ui_spec_result_accepts_style_pack_and_retrieved_ids() -> None:
    """GenerateUiSpecResult must accept style_pack_id + retrieved_ids values."""
    result = GenerateUiSpecResult(
        spec={"v": 1, "root": {"type": "card"}},
        style_pack_id="brutalist",
        retrieved_ids=("card", "grid"),
    )
    assert result.style_pack_id == "brutalist"
    assert result.retrieved_ids == ("card", "grid")
