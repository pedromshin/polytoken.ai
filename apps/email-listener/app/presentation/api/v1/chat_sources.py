"""Chat sources API — canon promotion endpoint (Phase 63, RCNV-01 seam closure).

POST /v1/chat/sources/{ledger_id}/promote reshapes one `chat_source_ledger`
row onto the UNCHANGED promotion machinery via
`PromoteSourceLedgerEntryUseCase` (Phase 56-05's promotion-gate reuse seam —
zero new promotion code, see promote_source_ledger_entry.py's header). This
route is the wiring 56-05 deliberately deferred to the canon-curation UX.

Auth: X-API-Key (require_api_key) — the whole router is protected, mirroring
knowledge_edges.py. Tenancy: the endpoint ALSO requires X-User-Id
(require_user_id, 401 without it) and asserts the caller owns the ledger
row's conversation_id (assert_conversation_owned, imported from
chat_stream.py — 404 fail-closed, never 403, so a non-owned row's existence
is never disclosed) BEFORE the use case ever executes. importer_id arrives
via the Pydantic body, validated at the boundary — NEVER trusted alone as an
auth claim (D-12).

Errors: missing ledger row / non-owned conversation -> 404; a
non-"captured" use-case outcome (capture_failed) -> 409 with a generic
detail; full rejection context is logged server-side via structlog.
"""

from uuid import UUID

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.application.use_cases.promote_source_ledger_entry import PromoteSourceLedgerEntryUseCase
from app.domain.ports.chat_repositories import ChatConversationRepository
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.presentation.api.response import ApiResponse
from app.presentation.api.v1.chat_stream import assert_conversation_owned
from app.presentation.middleware.auth import require_api_key
from app.presentation.middleware.user_context import require_user_id

router = APIRouter(
    prefix="/v1/chat/sources",
    tags=["chat"],
    dependencies=[Depends(require_api_key)],
)

logger = structlog.get_logger(__name__)

_NOT_FOUND_DETAIL = "Source not found"
_NOT_PROMOTABLE_DETAIL = "Source is not promotable"

_STATUS_CAPTURED = "captured"


class PromoteSourceRequest(BaseModel):
    """Boundary-validated request body -- importer_id is NEVER an auth claim (D-12)."""

    importer_id: str


class PromoteSourceView(BaseModel):
    ledger_id: str
    node_id: str | None
    status: str


@router.post("/{ledger_id}/promote")
@inject
async def promote_source(
    ledger_id: UUID,
    body: PromoteSourceRequest,
    use_case: FromDishka[PromoteSourceLedgerEntryUseCase],
    source_ledger: FromDishka[SourceLedgerRepository],
    conversations: FromDishka[ChatConversationRepository],
    user_id: str = Depends(require_user_id),
) -> ApiResponse[PromoteSourceView]:
    """Promote one chat_source_ledger row into the knowledge graph (RCNV-01).

    Fail-closed ordering: ledger-row load (404 if absent) -> conversation
    ownership guard (404 if the row's conversation_id is not owned by
    X-User-Id) -> use case execute. A non-"captured" outcome maps to 409 —
    the use case never raises past execute() (capture_failed posture,
    mirrors SourceCaptureHandler).
    """
    entry = await source_ledger.get(str(ledger_id))
    if entry is None:
        raise HTTPException(status_code=404, detail=_NOT_FOUND_DETAIL)

    await assert_conversation_owned(conversations, user_id, entry.conversation_id)

    result = await use_case.execute(ledger_entry_id=str(ledger_id), importer_id=body.importer_id)
    status = str(result.get("status", ""))
    if status != _STATUS_CAPTURED:
        logger.warning("promote_source_rejected", ledger_id=str(ledger_id), status=status)
        raise HTTPException(status_code=409, detail=_NOT_PROMOTABLE_DETAIL)

    node_id = result.get("node_id")
    return ApiResponse.ok(
        PromoteSourceView(
            ledger_id=str(ledger_id),
            node_id=str(node_id) if node_id is not None else None,
            status=status,
        )
    )
