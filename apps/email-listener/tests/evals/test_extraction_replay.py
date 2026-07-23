"""Extraction replay harness: per-field accuracy (E2) + regression vs baseline (E3).

Everything here except the RUN_EXTRACTION_EVAL-gated live test is offline —
no LLM, no DB, no network — and runs in the DEFAULT pytest sweep:

- Scoring-logic tests are behavioral: constructed GOOD and BAD predictions
  must SEPARATE (mirroring tests/evals/test_research_eval_rubric.py's rule
  that an eval scorer which cannot separate good from bad is worthless).
- The frozen-set tests recompute per-field accuracy over the committed
  dataset and hold it to the committed baseline: the dataset hash must match
  (frozen means frozen), accuracy must not regress, and the recomputed report
  must equal the baseline exactly (any intentional change goes through
  scripts.extraction_eval.update_baseline in a reviewed diff).

The live replay (real AnthropicAutofiller against Bedrock) is LLM-dependent
and stays behind RUN_EXTRACTION_EVAL=1, exactly like the RUN_GENUI_EVAL /
RUN_RESEARCH_EVAL gates.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from scripts.extraction_eval.dataset import (
    EvalRecord,
    aggregate_scores,
    dataset_sha256,
    format_report,
    ground_truth_fields,
    load_dataset,
    normalize_value,
    replay_with_extractor,
    report_to_dict,
    score_fields,
    score_record,
)

_EVALS_DIR = Path(__file__).parent
_DATASET = _EVALS_DIR / "datasets" / "extraction-eval-v1.jsonl"
_BASELINE = _EVALS_DIR / "datasets" / "extraction-eval-v1.baseline.json"

# Gate the LLM-dependent live replay behind an env flag, exactly like
# RUN_GENUI_EVAL — keeps it out of the default unit sweep.
_RUN_EVAL = os.environ.get("RUN_EXTRACTION_EVAL") == "1"


def _record(
    extracted: dict[str, object],
    corrected: dict[str, object] | None,
) -> EvalRecord:
    return EvalRecord(
        record_id="r-test",
        entity_type_slug="commercial_invoice",
        component_text="synthetic",
        extracted_fields=extracted,
        corrected_fields=corrected,
        confidence_score=0.5,
        created_at="2026-07-01T00:00:00+00:00",
    )


# ---------------------------------------------------------------------------
# Ground truth semantics
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_ground_truth_is_corrected_overlay_over_extracted() -> None:
    record = _record({"a": "x", "b": "y"}, {"b": "Y-fixed", "c": "added"})
    assert ground_truth_fields(record) == {"a": "x", "b": "Y-fixed", "c": "added"}


@pytest.mark.unit
def test_ground_truth_without_corrections_is_extracted_verbatim() -> None:
    record = _record({"a": "x"}, None)
    assert ground_truth_fields(record) == {"a": "x"}


# ---------------------------------------------------------------------------
# Scoring separates good from bad (behavioral, not smoke)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_score_record_marks_corrected_fields_wrong_and_uncorrected_right() -> None:
    record = _record(
        {"invoice_number": "INV-1", "vendor_name": "Acme", "total_amount": 100.0},
        {"vendor_name": "Acme Co., Ltd."},
    )
    assert score_record(record) == {"invoice_number": True, "vendor_name": False, "total_amount": True}


@pytest.mark.unit
def test_score_record_counts_field_added_by_correction_as_extraction_miss() -> None:
    record = _record({"a": "x"}, {"vessel_name": "MSC AURORA"})
    scores = score_record(record)
    assert scores["vessel_name"] is False
    assert scores["a"] is True


@pytest.mark.unit
def test_score_fields_separates_perfect_from_broken_predictions() -> None:
    truth = {"a": "x", "b": 2.0, "c": "z"}
    perfect = score_fields({"a": "x", "b": 2, "c": " z "}, truth)
    broken = score_fields({"a": "WRONG", "c": None}, truth)

    assert all(perfect.values()), f"perfect prediction must score 1.0 per field: {perfect}"
    assert not any(broken.values()), f"broken prediction must score 0.0 per field: {broken}"


@pytest.mark.unit
def test_normalization_is_conservative() -> None:
    assert normalize_value(" USD ") == normalize_value("USD")  # whitespace
    assert normalize_value(100) == normalize_value(100.0)  # int vs float
    assert normalize_value({"b": 1, "a": 2}) == normalize_value({"a": 2, "b": 1})  # key order
    assert normalize_value("100") != normalize_value(100)  # NO cross-type coercion
    assert normalize_value(True) != normalize_value(1.0)  # bool is not a number


@pytest.mark.unit
def test_extra_predicted_fields_are_ignored_for_now() -> None:
    """Documented E2 limitation (see README): hallucinated extras don't count yet."""
    scores = score_fields({"a": "x", "hallucinated": "!"}, {"a": "x"})
    assert scores == {"a": True}


# ---------------------------------------------------------------------------
# Frozen set: E2 report computes + E3 regression gate vs committed baseline
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_frozen_dataset_loads_and_scores_deterministically() -> None:
    meta, records = load_dataset(_DATASET)
    report = aggregate_scores(records)

    assert report.record_count == meta.record_count > 0
    assert 0.0 <= report.overall_accuracy <= 1.0
    # The seed set deliberately contains corrections — a suspiciously perfect
    # eval set (like the EchoToolExecutor identity round-trip the audit
    # flagged) proves nothing about the scorer.
    assert report.overall_accuracy < 1.0
    assert format_report(report)  # human-readable report renders


@pytest.mark.unit
def test_e3_dataset_is_actually_frozen_baseline_hash_matches() -> None:
    baseline = json.loads(_BASELINE.read_text(encoding="utf-8"))
    assert baseline["dataset_file"] == _DATASET.name
    assert dataset_sha256(_DATASET) == baseline["dataset_sha256"], (
        "committed dataset changed without a baseline update — regenerate via "
        "`uv run python -m scripts.extraction_eval.update_baseline --dataset "
        "tests/evals/datasets/extraction-eval-v1.jsonl` and commit both"
    )


@pytest.mark.unit
def test_e3_per_field_accuracy_does_not_regress_vs_committed_baseline() -> None:
    baseline = json.loads(_BASELINE.read_text(encoding="utf-8"))
    _, records = load_dataset(_DATASET)
    report = aggregate_scores(records)

    # Baseline accuracies are stored rounded to 6 dp — compare like for like.
    assert round(report.overall_accuracy, 6) >= baseline["overall_accuracy"] - 1e-9, (
        f"overall accuracy regressed: {report.overall_accuracy:.6f} < baseline {baseline['overall_accuracy']}"
    )
    for slug, expected in baseline["per_field"].items():
        actual = report.per_field.get(slug)
        assert actual is not None, f"field {slug} present in baseline but absent from recomputed report"
        assert round(actual.accuracy, 6) >= expected["accuracy"] - 1e-9, (
            f"field {slug} regressed: {actual.accuracy:.6f} < baseline {expected['accuracy']}"
        )


@pytest.mark.unit
def test_e3_baseline_is_in_sync_with_scoring_code() -> None:
    """Exact-equality sync gate: scoring-semantics drift (even an improvement)
    must surface as an explicit baseline regeneration in a reviewed diff."""
    baseline = json.loads(_BASELINE.read_text(encoding="utf-8"))
    meta, records = load_dataset(_DATASET)
    recomputed = report_to_dict(
        aggregate_scores(records),
        dataset_version=meta.dataset_version,
        dataset_file=_DATASET.name,
        dataset_sha256_hex=dataset_sha256(_DATASET),
    )
    assert recomputed == baseline, (
        "recomputed report differs from committed baseline — if intentional, run "
        "scripts.extraction_eval.update_baseline and commit the diff"
    )


# ---------------------------------------------------------------------------
# Replay harness wiring (stub extractors — default sweep)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_replay_with_perfect_extractor_scores_one() -> None:
    _, records = load_dataset(_DATASET)

    async def perfect(record: EvalRecord) -> dict[str, object]:
        return ground_truth_fields(record)

    report = await replay_with_extractor(records, perfect)
    assert report.overall_accuracy == 1.0
    assert report.record_count == len(records)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_replay_with_empty_extractor_scores_zero() -> None:
    _, records = load_dataset(_DATASET)

    async def empty(record: EvalRecord) -> dict[str, object]:
        return {}

    report = await replay_with_extractor(records, empty)
    assert report.overall_accuracy == 0.0


# ---------------------------------------------------------------------------
# LLM-dependent live replay — RUN_EXTRACTION_EVAL=1 only (E2 live / E5 / E6 later)
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.skipif(not _RUN_EVAL, reason="Set RUN_EXTRACTION_EVAL=1 to replay extraction against Bedrock")
@pytest.mark.asyncio
async def test_live_replay_against_frozen_set_reports_per_field_accuracy() -> None:
    """Replays the frozen set through the REAL AnthropicAutofiller and prints
    the per-field report. Reporting-only for now: no accuracy floor is
    asserted until the dataset is a real SQL snapshot (README, E2-live)."""
    from anthropic import AsyncAnthropicBedrock

    from app.domain.entities.entity_type import EntityType, EntityTypeField
    from app.infrastructure.llm.autofill_adapter import AnthropicAutofiller
    from app.settings import get_settings

    settings = get_settings()
    autofiller = AnthropicAutofiller(
        client=AsyncAnthropicBedrock(aws_region=settings.bedrock_region),
        model_id=settings.bedrock_model_id,
    )

    def _entity_type_for(record: EvalRecord) -> EntityType:
        fields = tuple(
            EntityTypeField(
                id=f"eval-{record.record_id}-{i}",
                slug=slug,
                label=slug.replace("_", " ").title(),
                data_type="text",
                is_identifier=False,
                is_required=False,
                description=None,
                sort_order=i,
            )
            for i, slug in enumerate(sorted(ground_truth_fields(record)))
        )
        return EntityType(
            id=f"eval-{record.entity_type_slug}",
            importer_id=None,
            slug=record.entity_type_slug,
            label=record.entity_type_slug.replace("_", " ").title(),
            description=None,
            is_active=True,
            embedding=None,
            fields=fields,
        )

    async def live(record: EvalRecord) -> dict[str, object]:
        result = await autofiller.autofill(
            region_text=record.component_text,
            entity_type=_entity_type_for(record),
            knowledge_base_text="",
        )
        return result.extracted_fields

    _, records = load_dataset(_DATASET)
    report = await replay_with_extractor(records, live)

    print()
    print(format_report(report))
    assert report.record_count == len(records)
    assert report.field_total > 0
