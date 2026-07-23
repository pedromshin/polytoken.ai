"""GetPipelineHealthUseCase — per-importer email-pipeline health counts (ST-04).

Aggregates the persisted lifecycle written by IngestInboundEmailUseCase:
  - received       : ALL emails for the importer (what landed, any status)
  - fully_analyzed : parse_status='parsed' (clean end-to-end)
  - degraded       : parse_status='degraded' (persisted + parsed, but a
                     never-raise LLM adapter silently fell back)
  - failed         : parse_status='failed', bucketed by the machine-decodable
                     stage prefix each parse_error entry carries
                     (app/domain/services/pipeline_health.py)

Exactness contract (ST-04): counts come from the repository's exact
server-side counts (PostgREST count='exact') and an internally paginated
parse_error read — NEVER a single capped row scan, so the numbers cannot
silently truncate at any table size. Legacy parse_error values with no
decodable stage prefix count under the 'unknown' stage rather than vanishing.

Architecture contract: imports ONLY domain ports and services.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import structlog

from app.domain.ports.email_repository import EmailRepository
from app.domain.services.pipeline_health import (
    DEGRADED_STAGE,
    PARSE_STATUS_DEGRADED,
    PARSE_STATUS_FAILED,
    PARSE_STATUS_PARSED,
    UNKNOWN_STAGE,
    decode_degraded_adapters,
    decode_failed_stages,
)

logger = structlog.get_logger(__name__)


@dataclass
class ImporterPipelineHealth:
    """Aggregated health counts for one importer."""

    importer_id: str
    received: int = 0
    fully_analyzed: int = 0
    degraded: int = 0
    failed: int = 0
    failed_by_stage: dict[str, int] = field(default_factory=dict)
    degraded_by_adapter: dict[str, int] = field(default_factory=dict)


class GetPipelineHealthUseCase:
    """Aggregate parse-status counts into per-importer health buckets."""

    def __init__(self, *, email_repo: EmailRepository) -> None:
        self._email_repo = email_repo

    async def execute(self, *, importer_ids: list[str]) -> list[ImporterPipelineHealth]:
        """Return one health bucket per importer in *importer_ids* (the caller's owned set).

        Importers with zero emails still get a (all-zero) bucket so the web
        panel can render every importer the caller owns. An empty importer_ids
        list returns [] — callers resolve ownership BEFORE calling (fail-closed,
        never "all importers").
        """
        buckets = [await self._importer_bucket(importer_id) for importer_id in importer_ids]
        logger.debug(
            "pipeline_health_aggregated",
            importer_count=len(importer_ids),
            email_count=sum(b.received for b in buckets),
        )
        return buckets

    async def _importer_bucket(self, importer_id: str) -> ImporterPipelineHealth:
        bucket = ImporterPipelineHealth(
            importer_id=importer_id,
            received=await self._email_repo.count_emails(importer_id),
            fully_analyzed=await self._email_repo.count_emails(importer_id, parse_status=PARSE_STATUS_PARSED),
            degraded=await self._email_repo.count_emails(importer_id, parse_status=PARSE_STATUS_DEGRADED),
            failed=await self._email_repo.count_emails(importer_id, parse_status=PARSE_STATUS_FAILED),
        )

        # failed_by_stage: one increment per (failed email, distinct stage).
        # adapter_degraded entries on a *failed* email are context, not the
        # failure cause — they bucket under degraded_by_adapter instead.
        failed_errors: list[str] = []
        if bucket.failed:
            failed_errors = await self._email_repo.list_parse_errors(importer_id, parse_status=PARSE_STATUS_FAILED)
        for parse_error in failed_errors:
            stages = [s for s in decode_failed_stages(parse_error) if not s.startswith(DEGRADED_STAGE)]
            for stage in stages or [UNKNOWN_STAGE]:
                bucket.failed_by_stage[stage] = bucket.failed_by_stage.get(stage, 0) + 1
            for adapter in decode_degraded_adapters(parse_error):
                bucket.degraded_by_adapter[adapter] = bucket.degraded_by_adapter.get(adapter, 0) + 1

        # Failed rows with a NULL parse_error (written outside the ingest
        # lifecycle) never reach the loop above — still count them, under
        # 'unknown', so failed_by_stage totals always cover bucket.failed.
        null_error_rows = bucket.failed - len(failed_errors)
        if null_error_rows > 0:
            bucket.failed_by_stage[UNKNOWN_STAGE] = bucket.failed_by_stage.get(UNKNOWN_STAGE, 0) + null_error_rows

        if bucket.degraded:
            degraded_errors = await self._email_repo.list_parse_errors(importer_id, parse_status=PARSE_STATUS_DEGRADED)
            for parse_error in degraded_errors:
                for adapter in decode_degraded_adapters(parse_error):
                    bucket.degraded_by_adapter[adapter] = bucket.degraded_by_adapter.get(adapter, 0) + 1

        return bucket


__all__ = [
    "GetPipelineHealthUseCase",
    "ImporterPipelineHealth",
]
