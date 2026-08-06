"""Entity-instances API — resolution candidates + idempotent backfill.

GET  /v1/entity-instances/{entity_instance_id}/candidates
    Run BlendedRAG resolution for the given entity instance; returns ranked candidates.
    Suggest-only (D-05): no writes. ValueError (not found) → 404.

POST /v1/entity-instances/backfill
    Re-run entity promotion for all confirmed entity components of the given importer.
    Idempotent (D-10). Returns total/succeeded/failed counts.

Auth: X-API-Key (require_api_key) — all routes protected at the router level.
"""

from typing import TYPE_CHECKING
from uuid import UUID

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.curate_entity_merge import (
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

if TYPE_CHECKING:
    from app.infrastructure.supabase.entity_resolution_repository import EntityCandidate

router = APIRouter(
    prefix="/v1/entity-instances",
    tags=["entity-instances"],
    dependencies=[Depends(require_api_key)],
)

_NOT_FOUND_DETAIL = "Entity instance not found"


# ── Request models ────────────────────────────────────────────────────────────


class BackfillRequest(BaseModel):
    importer_id: UUID


# ── Response views ────────────────────────────────────────────────────────────


class EntityCandidateView(BaseModel):
    entity_instance_id: str
    display_name: str
    rrf_score: float
    match_type: str
    similarity_score: float


class BackfillResultView(BaseModel):
    total: int
    succeeded: int
    failed: int


def _to_candidate_view(candidate: "EntityCandidate") -> EntityCandidateView:
    return EntityCandidateView(
        entity_instance_id=candidate.entity_instance_id,
        display_name=candidate.display_name,
        rrf_score=candidate.rrf_score,
        match_type=candidate.match_type,
        similarity_score=candidate.similarity_score,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{entity_instance_id}/candidates")
@inject
async def get_entity_candidates(
    entity_instance_id: UUID,
    use_case: FromDishka[ResolveEntityCandidatesUseCase],
) -> ApiResponse[list[EntityCandidateView]]:
    """Return top-N BlendedRAG resolution candidates for the given entity instance.

    Suggest-only (D-05): no writes occur. ValueError (not found) → 404.
    """
    try:
        candidates = await use_case.execute(entity_instance_id=str(entity_instance_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL) from exc
    return ApiResponse.ok([_to_candidate_view(c) for c in candidates])


@router.post("/backfill")
@inject
async def backfill_entity_identities(
    body: BackfillRequest,
    use_case: FromDishka[BackfillEntityIdentitiesUseCase],
) -> ApiResponse[BackfillResultView]:
    """Re-promote all confirmed entity components for the given importer (D-10 backfill).

    Idempotent: safe to run multiple times. Returns total/succeeded/failed counts.
    """
    result = await use_case.execute(importer_id=str(body.importer_id))
    return ApiResponse.ok(
        BackfillResultView(
            total=result["total"],
            succeeded=result["succeeded"],
            failed=result["failed"],
        )
    )


# ── Curation endpoints (D-20) ─────────────────────────────────────────────────


class CascadeSummaryView(BaseModel):
    """What the correction cascade touched (Plan 75-03, CPF-04) — additive, optional."""

    survivor_id: str
    absorbed_id: str
    promoted_edge_ids: list[str]
    affected_email_ids: list[str]


class MergeResultView(BaseModel):
    entity_instance_id: str
    target_id: str
    # Plan 75-03 (additive): present only when the flag-gated correction cascade
    # ran cleanly on a confirm; always None for reject and for flag-off confirms.
    cascade: CascadeSummaryView | None = None


class UnmergeResultView(BaseModel):
    entity_instance_id: str


@router.post("/{entity_instance_id}/merge/{target_id}/confirm")
@inject
async def confirm_entity_merge(
    entity_instance_id: UUID,
    target_id: UUID,
    use_case: FromDishka[ConfirmMergeUseCase],
) -> ApiResponse[MergeResultView]:
    """Confirm a human-selected merge suggestion (D-20).

    Sets was_selected=True on the candidate link (D-09) and appends the target's
    display_name as an alias on the surviving identity (D-11 flywheel).
    importer_id derived from the data row — never from the caller (D-21).
    ValueError (not found / cross-importer) → 404.
    """
    try:
        result = await use_case.execute(
            entity_instance_id=str(entity_instance_id),
            target_id=str(target_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL) from exc
    cascade_raw = result.get("cascade")
    return ApiResponse.ok(
        MergeResultView(
            entity_instance_id=str(result["entity_instance_id"]),
            target_id=str(result["target_id"]),
            cascade=CascadeSummaryView.model_validate(cascade_raw) if cascade_raw is not None else None,
        )
    )


@router.post("/{entity_instance_id}/merge/{target_id}/reject")
@inject
async def reject_entity_merge(
    entity_instance_id: UUID,
    target_id: UUID,
    use_case: FromDishka[RejectMergeUseCase],
) -> ApiResponse[MergeResultView]:
    """Reject (dismiss) a merge suggestion durably (D-20).

    Flags the candidate link as dismissed so it is not re-surfaced.
    Does NOT link the identities.
    ValueError (not found / cross-importer) → 404.
    """
    try:
        result = await use_case.execute(
            entity_instance_id=str(entity_instance_id),
            target_id=str(target_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL) from exc
    return ApiResponse.ok(
        MergeResultView(
            entity_instance_id=result["entity_instance_id"],
            target_id=result["target_id"],
        )
    )


@router.post("/{entity_instance_id}/unmerge")
@inject
async def unmerge_entity(
    entity_instance_id: UUID,
    use_case: FromDishka[UnmergeEntityUseCase],
) -> ApiResponse[UnmergeResultView]:
    """Undo a confirmed merge — supersede-never-mutate (D-20).

    Reactivates the previously-merged entity instance and clears its merge
    linkage.  Original rows are never deleted.
    ValueError (not found) → 404.
    """
    try:
        result = await use_case.execute(entity_instance_id=str(entity_instance_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL) from exc
    return ApiResponse.ok(UnmergeResultView(entity_instance_id=result["entity_instance_id"]))
