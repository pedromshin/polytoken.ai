"""POST /v1/emails/ingest-job — internal worker re-entry into the ingest pipeline (Track 3a A5).

The durable worker (graphile-worker) drains an ``ingest_inbound_email`` job and calls THIS
route with the job's ``{ses_message_id, recipients}`` pointer. Unlike the SNS receiver, it
deliberately does NOT swallow failures: any exception propagates to a 5xx so the worker throws
and graphile retries (up to ``max_attempts``) before dead-lettering — the durable counterpart
to the SNS enqueue's 500-on-failure. Guarded by ``require_api_key`` (``API_KEY`` is already a
container secret); called over localhost in-task, off the ALB idle-timeout path, so it can take
the full pipeline's time budget. At-least-once redelivery is safe: ingestion is idempotent
(``(importer_id, message_id)`` upsert + uuid5 attachment ids).
"""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.presentation.api.response import ApiResponse
from app.presentation.middleware.auth import require_api_key

router = APIRouter(prefix="/v1/emails", tags=["emails-internal"], dependencies=[Depends(require_api_key)])


class IngestJobIn(BaseModel):
    """The pointer payload the worker forwards from an ``ingest_inbound_email`` job."""

    ses_message_id: str = Field(min_length=1)
    recipients: list[str] = Field(default_factory=list)


class IngestJobAck(BaseModel):
    email_id: str
    parse_status: str


@router.post("/ingest-job", status_code=200)
@inject
async def run_ingest_job(
    payload: IngestJobIn,
    use_case: FromDishka[IngestInboundEmailUseCase],
) -> ApiResponse[IngestJobAck]:
    """Run the full ingest pipeline for one enqueued job.

    NO bare-except-200 here (the opposite of the SNS receiver's flag-off path): a failure
    must raise → FastAPI 500 → the worker throws → graphile retries. That 5xx-on-failure
    contract is precisely the property the durable queue depends on to not lose the email.
    """
    email = await use_case.execute(payload.ses_message_id, recipients=tuple(payload.recipients))
    return ApiResponse.ok(IngestJobAck(email_id=str(email.id), parse_status=email.parse_status))
