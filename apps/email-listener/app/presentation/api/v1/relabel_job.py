"""POST /v1/emails/relabel-job — internal worker re-entry for the cascade re-label fan-out (75-04).

The durable worker (graphile-worker) drains a ``cascade_relabel`` job — enqueued by the
listener's own CascadeCorrectionUseCase on a confirmed merge (identifier ``cascade_relabel``,
job_key ``cascade:{survivor}:{absorbed}``) — and forwards its payload
``{survivor_id, absorbed_id, email_ids}`` VERBATIM to this route (apps/worker/src/tasks.ts).

Mirrors ingest_job.py (the shipped worker re-entry convention): guarded by
``require_api_key`` (``API_KEY`` is already a container secret), called over localhost
in-task, off the ALB idle-timeout path. NOT backfill_reprocess.py — its forwarding-token
auth cannot be satisfied by the job payload.

Fail-closed fan-out semantics:
  - unknown survivor → 404 (no importer scope derivable — nothing is reprocessed; the
    worker retries → dead-letters, surfacing the anomaly rather than swallowing it);
  - importer_id is derived from the LOADED survivor row (D-21), never the payload;
  - each email is checked against that importer — a mismatching or missing email is
    SKIPPED, never reprocessed (a cross-tenant email id in a payload must not trigger
    a foreign reprocess);
  - a per-email reprocess failure is collected as an outcome, never raised mid-loop —
    one bad email must not abort (or endlessly retry) the rest of the fan-out.
At-least-once redelivery is safe: reprocess supersedes only its own prior pending set
(idempotent by construction, see reprocess_email.py).

NOTE: no ``from __future__ import annotations`` here — stringified annotations break
FastAPI's ApiResponse[...] response-model resolution (mirrors ingest_job.py).
"""

import structlog
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/emails", tags=["emails-internal"], dependencies=[Depends(require_api_key)])

_STATUS_REPROCESSED = "reprocessed"
_STATUS_SKIPPED_NOT_FOUND = "skipped_not_found"
_STATUS_SKIPPED_IMPORTER_MISMATCH = "skipped_importer_mismatch"
_STATUS_FAILED = "failed"


class RelabelJobIn(BaseModel):
    """The payload the worker forwards from a ``cascade_relabel`` job — EXACTLY what
    CascadeCorrectionUseCase enqueues (cascade_correction.py's ``_RELABEL_IDENTIFIER``)."""

    survivor_id: str = Field(min_length=1)
    absorbed_id: str = Field(min_length=1)
    # Bounded so a crafted payload cannot demand unbounded serial reprocess work;
    # the cascade's own fan-out stays far below this in practice.
    email_ids: list[str] = Field(default_factory=list, max_length=1000)


class RelabelEmailOutcome(BaseModel):
    email_id: str
    status: str


class RelabelJobAck(BaseModel):
    survivor_id: str
    absorbed_id: str
    outcomes: list[RelabelEmailOutcome]


@router.post("/relabel-job", status_code=200)
@inject
async def run_relabel_job(
    payload: RelabelJobIn,
    entity_instances: FromDishka[EntityInstanceRepository],
    emails: FromDishka[EmailRepository],
    reprocess: FromDishka[ReprocessEmailUseCase],
) -> ApiResponse[RelabelJobAck]:
    """Re-label the absorbed identity's past emails by re-running the ingest pipeline per email.

    importer scope comes from the LOADED survivor row (D-21); every email is re-checked
    against it fail-closed. Per-email outcomes are collected — the loop never raises.
    """
    log = logger.bind(survivor_id=payload.survivor_id, absorbed_id=payload.absorbed_id)

    survivor = await entity_instances.find_by_id(payload.survivor_id)
    if survivor is None:
        log.warning("relabel_job_survivor_not_found")
        raise HTTPException(status_code=404, detail="Entity instance not found")
    importer_id = survivor.importer_id
    log = log.bind(importer_id=importer_id)

    outcomes: list[RelabelEmailOutcome] = []
    for email_id in payload.email_ids:
        email = await emails.find_by_id(email_id)
        if email is None:
            log.warning("relabel_job_email_not_found", email_id=email_id)
            outcomes.append(RelabelEmailOutcome(email_id=email_id, status=_STATUS_SKIPPED_NOT_FOUND))
            continue
        if email.importer_id != importer_id:
            # Fail-closed tenant guard: a payload email outside the survivor's
            # importer is never reprocessed (and never distinguishable beyond
            # this server-side log).
            log.warning("relabel_job_importer_mismatch", email_id=email_id)
            outcomes.append(RelabelEmailOutcome(email_id=email_id, status=_STATUS_SKIPPED_IMPORTER_MISMATCH))
            continue
        try:
            await reprocess.execute(email_id=email_id)
        except Exception:
            # Never raise mid-loop — one bad email must not abort the fan-out.
            log.exception("relabel_job_email_failed", email_id=email_id)
            outcomes.append(RelabelEmailOutcome(email_id=email_id, status=_STATUS_FAILED))
            continue
        outcomes.append(RelabelEmailOutcome(email_id=email_id, status=_STATUS_REPROCESSED))

    log.info(
        "relabel_job_done",
        total=len(outcomes),
        reprocessed=sum(1 for o in outcomes if o.status == _STATUS_REPROCESSED),
    )
    return ApiResponse.ok(
        RelabelJobAck(
            survivor_id=payload.survivor_id,
            absorbed_id=payload.absorbed_id,
            outcomes=outcomes,
        )
    )
