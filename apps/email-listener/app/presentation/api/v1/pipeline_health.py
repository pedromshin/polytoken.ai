"""Pipeline health read API (ST-04) — GET /v1/pipeline/health.

Per-importer counts of received / fully-analyzed / degraded / failed-at-stage-X
emails, aggregated from the lifecycle IngestInboundEmailUseCase persists
(emails.parse_status + stage-prefixed parse_error).

Auth mirrors the sibling routers (emails.py): X-API-Key (require_api_key) at
the router level, X-User-Id (require_user_id) per endpoint. Tenancy (Phase 44,
TENA-03): counts are scoped to the caller's OWNED importer ids via
ImporterResolver.list_importer_ids_for_user — a client-supplied importer list
is never trusted, and a caller who owns no importers gets an empty importer
list, never "all importers".

RESPONSE SHAPE IS A WIRE CONTRACT with the already-merged web panel: the Next
proxy (apps/web/src/app/api/pipeline/health/route.ts) forwards this body
VERBATIM to shapePipelineHealth (apps/web/src/lib/pipeline-health.ts), whose
zod schema expects ``{ importers: [{ importer_id, label?, received,
fully_analyzed, failed_by_stage }] }`` at the TOP LEVEL — deliberately NOT the
ApiResponse envelope the other routers use. Extra fields (degraded, failed,
degraded_by_adapter) are additive; zod strips unknown keys.
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.application.use_cases.pipeline_health import GetPipelineHealthUseCase, ImporterPipelineHealth
from app.domain.ports.importer_resolver import ImporterResolver
from app.presentation.middleware.auth import require_api_key
from app.presentation.middleware.user_context import require_user_id

router = APIRouter(prefix="/v1/pipeline", tags=["pipeline"], dependencies=[Depends(require_api_key)])


class ImporterHealthOut(BaseModel):
    importer_id: str
    received: int
    fully_analyzed: int
    failed_by_stage: dict[str, int]
    # Additive fields beyond the web panel's minimum contract:
    degraded: int
    failed: int
    degraded_by_adapter: dict[str, int]


class PipelineHealthOut(BaseModel):
    importers: list[ImporterHealthOut]


def _importer_out(bucket: ImporterPipelineHealth) -> ImporterHealthOut:
    return ImporterHealthOut(
        importer_id=bucket.importer_id,
        received=bucket.received,
        fully_analyzed=bucket.fully_analyzed,
        failed_by_stage=dict(sorted(bucket.failed_by_stage.items())),
        degraded=bucket.degraded,
        failed=bucket.failed,
        degraded_by_adapter=dict(sorted(bucket.degraded_by_adapter.items())),
    )


@router.get("/health")
@inject
async def pipeline_health(
    health: FromDishka[GetPipelineHealthUseCase],
    importer_repo: FromDishka[ImporterResolver],
    user_id: str = Depends(require_user_id),
) -> PipelineHealthOut:
    """Per-importer pipeline health for the caller's owned importers (exact counts)."""
    owned_importer_ids = await importer_repo.list_importer_ids_for_user(user_id)
    buckets = await health.execute(importer_ids=owned_importer_ids)
    return PipelineHealthOut(importers=[_importer_out(b) for b in buckets])
