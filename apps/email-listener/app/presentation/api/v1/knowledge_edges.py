"""Knowledge edges API — human promotion endpoint (TIER-03).

POST /v1/knowledge/edges/{edge_id}/promote flips one ACTIVE INFERRED/AMBIGUOUS
edge to EXTRACTED, recording promotion provenance distinct from the synthesis
provenance (T-30-05/06/07/08). This is the only WRITE in the system that
raises trust in the knowledge graph — nothing else may promote (suggest-only
hard constraint).

Auth: X-API-Key (require_api_key) — the whole router is protected (T-30-04).
Tenancy (D-12, extended Phase 44-03 T-44-03-03): importer_id is supplied via
the request body Pydantic model, validated at the boundary — NEVER trusted
alone as an auth claim/header. The endpoint ALSO requires X-User-Id
(require_user_id, 401 without it); the use case's guard rejects a promotion
whose edge importer is not owned by that user, in addition to the existing
cross-tenant body-importer_id mismatch check, both before any write.
Errors: EdgeNotFound -> 404, EdgeNotPromotable -> 409 with a generic detail;
full rejection context (reason) is logged server-side via structlog.

Out of scope (Phase 32): no promote/dismiss UI affordance — this ships the
mechanic only.
"""

from uuid import UUID

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.application.use_cases.promote_edge import (
    EdgeNotFound,
    EdgeNotPromotable,
    PromoteEdgeUseCase,
)
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key
from app.presentation.middleware.user_context import require_user_id

router = APIRouter(
    prefix="/v1/knowledge/edges",
    tags=["knowledge"],
    dependencies=[Depends(require_api_key)],
)

logger = structlog.get_logger(__name__)

_NOT_FOUND_DETAIL = "Edge not found"
_NOT_PROMOTABLE_DETAIL = "Edge is not promotable"


class PromoteEdgeRequest(BaseModel):
    """Boundary-validated request body -- importer_id is NEVER an auth claim (D-12)."""

    importer_id: str


class PromoteEdgeView(BaseModel):
    edge_id: str
    tier: str


@router.post("/{edge_id}/promote")
@inject
async def promote_edge(
    edge_id: UUID,
    body: PromoteEdgeRequest,
    use_case: FromDishka[PromoteEdgeUseCase],
    user_id: str = Depends(require_user_id),
) -> ApiResponse[PromoteEdgeView]:
    """Promote one ACTIVE INFERRED/AMBIGUOUS edge to EXTRACTED (TIER-03, SC3/SC4).

    Fail-closed ordering (enforced inside the use case): load -> USER-ownership
    guard (Phase 44-03) -> tenant guard -> active guard -> tier guard -> CAS
    write. EdgeNotFound maps to 404; EdgeNotPromotable (inactive /
    already-EXTRACTED / cross-tenant / cross-user / CAS-conflict) maps to 409
    -- ALL are raised before any write.
    """
    try:
        result = await use_case.execute(edge_id=str(edge_id), importer_id=body.importer_id, user_id=user_id)
    except EdgeNotFound as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL) from exc
    except EdgeNotPromotable as exc:
        logger.warning("promote_edge_rejected", edge_id=str(edge_id), reason=exc.reason)
        raise HTTPException(status_code=409, detail=_NOT_PROMOTABLE_DETAIL) from exc

    return ApiResponse.ok(PromoteEdgeView(edge_id=str(result["edge_id"]), tier=str(result["tier"])))
