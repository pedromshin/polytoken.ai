"""Tests for the ST-04 pipeline-health vocabulary + aggregation.

Covers:
- app/domain/services/pipeline_health.py — stage-prefix decoding and the
  contextvar degradation collector (no-op outside a collector).
- app/application/use_cases/pipeline_health.py — exact per-importer buckets
  computed against a fake repository seeded with statuses (never a row scan).
"""

from __future__ import annotations

import asyncio

from app.application.use_cases.pipeline_health import GetPipelineHealthUseCase
from app.domain.services.pipeline_health import (
    UNKNOWN_STAGE,
    collect_adapter_degradations,
    decode_degraded_adapters,
    decode_failed_stages,
    decode_stage_prefix,
    degradation_entries,
    failure_entry,
    record_adapter_degradation,
)

# ---------------------------------------------------------------------------
# Domain: stage-prefix vocabulary
# ---------------------------------------------------------------------------


def test_failure_entry_formats_stage_prefixes() -> None:
    assert failure_entry("propose_regions", "RuntimeError('x')") == "propose_regions: RuntimeError('x')"
    assert failure_entry("attachment", "bl.pdf: boom", qualifier="0") == "attachment[0]: bl.pdf: boom"
    assert (
        failure_entry("adapter_degraded", "zero-vector", qualifier="embedding")
        == "adapter_degraded[embedding]: zero-vector"
    )


def test_decode_stage_prefix_roundtrips() -> None:
    assert decode_stage_prefix("attachment[3]: x.pdf: boom") == ("attachment", "3")
    assert decode_stage_prefix("propose_regions: boom") == ("propose_regions", None)
    assert decode_stage_prefix("adapter_degraded[classifier]: APIError") == ("adapter_degraded", "classifier")
    # Not entries: plain prose, uppercase, missing ": " separator.
    assert decode_stage_prefix("some plain text") is None
    assert decode_stage_prefix("Boom: upper case is not a stage") is None
    assert decode_stage_prefix("propose_regions:no-space") is None


def test_decode_failed_stages_buckets_and_dedupes() -> None:
    error = "attachment[0]: a.pdf: boom; attachment[1]: b.pdf: boom; propose_regions: RuntimeError('x')"
    # attachment[N] collapses into ONE 'attachment' bucket (indexes are not stages).
    assert decode_failed_stages(error) == ["attachment", "propose_regions"]


def test_decode_failed_stages_keeps_adapter_identity_for_degradations() -> None:
    error = "adapter_degraded[segmentation]: page 0 (+2 more); adapter_degraded[embedding]: zero-vector"
    assert decode_failed_stages(error) == [
        "adapter_degraded[segmentation]",
        "adapter_degraded[embedding]",
    ]


def test_decode_failed_stages_tolerates_legacy_and_hostile_text() -> None:
    # Legacy plain-repr rows bucket under 'unknown', never vanish.
    assert decode_failed_stages("RuntimeError('old style')") == [UNKNOWN_STAGE]
    assert decode_failed_stages(None) == []
    assert decode_failed_stages("") == []
    # An exception message containing "; " cannot forge a stage unless the
    # fragment matches the strict prefix grammar.
    error = failure_entry("propose_regions", "RuntimeError('multi; part; message')")
    assert decode_failed_stages(error) == ["propose_regions"]


def test_decode_degraded_adapters() -> None:
    error = (
        "attachment[0]: a.pdf: boom; "
        "adapter_degraded[classifier]: 5 region(s) left unclassified: APIError; "
        "adapter_degraded[embedding]: zero-vector fallback: ClientError"
    )
    assert decode_degraded_adapters(error) == ["classifier", "embedding"]
    assert decode_degraded_adapters("propose_regions: boom") == []
    assert decode_degraded_adapters(None) == []


# ---------------------------------------------------------------------------
# Domain: degradation collector
# ---------------------------------------------------------------------------


def test_record_adapter_degradation_is_noop_outside_collector() -> None:
    # Must never raise and never leak state into a later collector.
    record_adapter_degradation("segmentation", "orphan event")
    with collect_adapter_degradations() as events:
        pass
    assert events == []


def test_collector_sees_events_recorded_in_awaited_children() -> None:
    async def deep_adapter_call() -> None:
        record_adapter_degradation("embedding", "zero-vector fallback: ClientError")

    async def stage() -> None:
        await deep_adapter_call()

    async def run() -> list[str]:
        with collect_adapter_degradations() as events:
            await stage()
        return degradation_entries(events)

    entries = asyncio.run(run())
    assert entries == ["adapter_degraded[embedding]: zero-vector fallback: ClientError"]


def test_degradation_entries_group_per_adapter_with_more_suffix() -> None:
    with collect_adapter_degradations() as events:
        record_adapter_degradation("segmentation", "page 0: retries exhausted")
        record_adapter_degradation("segmentation", "page 1: retries exhausted")
        record_adapter_degradation("classifier", "3 region(s) left unclassified: APIError")
    assert degradation_entries(events) == [
        "adapter_degraded[segmentation]: page 0: retries exhausted (+1 more)",
        "adapter_degraded[classifier]: 3 region(s) left unclassified: APIError",
    ]


# ---------------------------------------------------------------------------
# Application: GetPipelineHealthUseCase against a fake repository
# ---------------------------------------------------------------------------


class FakeEmailRepo:
    """Fake EmailRepository exposing only the ST-04 read surface.

    Seeded with (parse_status, parse_error) rows per importer; count_emails
    answers with exact counts (mirroring PostgREST count='exact') and
    list_parse_errors returns every non-null error — no page caps.
    """

    def __init__(self, rows_by_importer: dict[str, list[tuple[str, str | None]]]) -> None:
        self._rows = rows_by_importer

    async def count_emails(self, importer_id: str, *, parse_status: str | None = None) -> int:
        rows = self._rows.get(importer_id, [])
        if parse_status is None:
            return len(rows)
        return sum(1 for status, _ in rows if status == parse_status)

    async def list_parse_errors(self, importer_id: str, *, parse_status: str) -> list[str]:
        return [
            error for status, error in self._rows.get(importer_id, []) if status == parse_status and error is not None
        ]


def test_health_buckets_match_seeded_statuses_exactly() -> None:
    repo = FakeEmailRepo(
        {
            "imp-a": [
                ("parsed", None),
                ("parsed", None),
                ("received", None),
                ("degraded", "adapter_degraded[segmentation]: page 0: retries exhausted (+1 more)"),
                ("failed", "attachment[0]: bl.pdf: RuntimeError('corrupt')"),
                ("failed", "attachment[0]: a.pdf: boom; propose_regions: RuntimeError('x')"),
                ("failed", "suggest_entity_types: TimeoutError()"),
            ],
            "imp-b": [],
        }
    )
    use_case = GetPipelineHealthUseCase(email_repo=repo)  # type: ignore[arg-type]

    buckets = asyncio.run(use_case.execute(importer_ids=["imp-a", "imp-b"]))

    assert [b.importer_id for b in buckets] == ["imp-a", "imp-b"]
    a = buckets[0]
    assert a.received == 7  # every email that landed, any status
    assert a.fully_analyzed == 2
    assert a.degraded == 1
    assert a.failed == 3
    # Per-stage buckets: one increment per (failed email, distinct stage).
    assert a.failed_by_stage == {
        "attachment": 2,
        "propose_regions": 1,
        "suggest_entity_types": 1,
    }
    assert a.degraded_by_adapter == {"segmentation": 1}

    # A zero-email importer still gets an (all-zero) bucket for the panel.
    b = buckets[1]
    assert (b.received, b.fully_analyzed, b.degraded, b.failed) == (0, 0, 0, 0)
    assert b.failed_by_stage == {}


def test_health_legacy_and_null_parse_errors_bucket_as_unknown() -> None:
    repo = FakeEmailRepo(
        {
            "imp-a": [
                ("failed", "RuntimeError('legacy plain repr')"),  # no prefix
                ("failed", None),  # manual write outside the lifecycle
            ],
        }
    )
    use_case = GetPipelineHealthUseCase(email_repo=repo)  # type: ignore[arg-type]

    (bucket,) = asyncio.run(use_case.execute(importer_ids=["imp-a"]))

    assert bucket.failed == 2
    assert bucket.failed_by_stage == {UNKNOWN_STAGE: 2}


def test_health_degradations_on_failed_emails_do_not_pollute_stage_buckets() -> None:
    repo = FakeEmailRepo(
        {
            "imp-a": [
                (
                    "failed",
                    "propose_regions: RuntimeError('x'); adapter_degraded[classifier]: APIError",
                ),
            ],
        }
    )
    use_case = GetPipelineHealthUseCase(email_repo=repo)  # type: ignore[arg-type]

    (bucket,) = asyncio.run(use_case.execute(importer_ids=["imp-a"]))

    assert bucket.failed_by_stage == {"propose_regions": 1}
    assert bucket.degraded_by_adapter == {"classifier": 1}


def test_health_empty_importer_ids_returns_empty_never_all() -> None:
    repo = FakeEmailRepo({"imp-a": [("parsed", None)]})
    use_case = GetPipelineHealthUseCase(email_repo=repo)  # type: ignore[arg-type]

    assert asyncio.run(use_case.execute(importer_ids=[])) == []
