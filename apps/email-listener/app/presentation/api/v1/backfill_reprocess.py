"""POST /v1/emails/backfill-reprocess — owner-scoped bulk reprocess (capability auth).

Re-runs the FULL ingestion pipeline (now including email-body extraction) over
a caller-supplied set of the owner's existing emails. Same capability-auth
model as /backfill: the request must carry a forwarding recipient
(``u-{token}@domain``) whose token resolves to a real user, and every target
email must belong to that user's importers (fail-closed 404/skip otherwise) —
so a request can only ever reprocess the token owner's own corpus.

Batched by design: the client passes explicit email_ids so a caller can pace
reprocessing (each email re-runs OCR/segmentation/entity resolution) and stay
under the ALB idle timeout.
"""

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver
from app.presentation.api.response import ApiResponse

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/emails", tags=["emails-backfill"])


class ReprocessIn(BaseModel):
    recipients: list[str] = Field(min_length=1)
    email_ids: list[str] = Field(min_length=1, max_length=25)


class ReprocessItem(BaseModel):
    email_id: str
    ok: bool
    superseded: int | None = None
    new_regions: int | None = None
    error: str | None = None


class ReprocessAck(BaseModel):
    reprocessed: int
    failed: int
    skipped_not_owned: int
    items: list[ReprocessItem]


@router.post("/backfill-reprocess", status_code=200)
@inject
async def backfill_reprocess(
    payload: ReprocessIn,
    forwarding_resolver: FromDishka[ForwardingAddressResolver],
    importer_resolver: FromDishka[ImporterResolver],
    emails: FromDishka[EmailRepository],
    reprocess: FromDishka[ReprocessEmailUseCase],
) -> ApiResponse[ReprocessAck]:
    owner = await forwarding_resolver.resolve_recipients(payload.recipients)
    if owner is None:
        raise HTTPException(status_code=401, detail="No recipient resolves to a known forwarding token")

    owned = set(await importer_resolver.list_importer_ids_for_user(owner))

    items: list[ReprocessItem] = []
    reprocessed = failed = skipped = 0
    for email_id in payload.email_ids:
        email = await emails.find_by_id(email_id)
        if email is None or email.importer_id not in owned:
            skipped += 1
            items.append(ReprocessItem(email_id=email_id, ok=False, error="not_found_or_not_owned"))
            continue
        try:
            ack = await reprocess.execute(email_id=email_id)
            reprocessed += 1
            items.append(
                ReprocessItem(
                    email_id=email_id,
                    ok=True,
                    superseded=int(ack["superseded_components"]),  # type: ignore[call-overload]
                    new_regions=int(ack["new_regions"]),  # type: ignore[call-overload]
                )
            )
        except Exception as exc:
            failed += 1
            logger.exception("backfill_reprocess_failed", email_id=email_id)
            items.append(ReprocessItem(email_id=email_id, ok=False, error=repr(exc)[:300]))

    return ApiResponse.ok(
        ReprocessAck(reprocessed=reprocessed, failed=failed, skipped_not_owned=skipped, items=items)
    )
