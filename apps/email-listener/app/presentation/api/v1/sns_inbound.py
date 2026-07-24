"""POST /v1/emails/inbound-sns — handle SNS notifications from SES.

No auth — SNS cannot send X-API-Key headers.
Returns HTTP 200 for malformed/unprocessable payloads to prevent SNS retry storms.

Durable-ingestion cutover (Track 3a): when ``INGEST_ENQUEUE_ENABLED`` is set, a
Notification enqueues a durable ``ingest_inbound_email`` pointer job and a FAILED
enqueue returns 500 so SNS retries — strictly safer than the flag-OFF inline path's
silent-200 loss. Flag OFF (default) preserves the exact current inline behavior.
"""

from __future__ import annotations

import json

import structlog
from fastapi import APIRouter, Request, Response, status

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.domain.ports.job_enqueuer import JobEnqueuer
from app.infrastructure.sns.confirmation import confirm_subscription
from app.infrastructure.sns.ses_parser import EmailMeta, parse_ses_notification
from app.settings import get_settings

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/emails", tags=["emails-sns"])


@router.post("/inbound-sns", status_code=status.HTTP_200_OK)
async def receive_inbound_sns(request: Request) -> Response:
    """Handle SNS notifications from SES. No auth — SNS cannot send X-API-Key."""
    raw = await request.body()
    try:
        payload: dict[str, object] = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("sns_bad_json", body_preview=raw[:200].decode("utf-8", errors="replace"))
        return Response(status_code=status.HTTP_200_OK)  # return 200 to avoid SNS retry storm

    msg_type: str = str(payload.get("Type", ""))

    if msg_type == "SubscriptionConfirmation":
        subscribe_url = str(payload["SubscribeURL"])
        await confirm_subscription(subscribe_url)
        return Response(status_code=status.HTTP_200_OK)

    if msg_type == "Notification":
        try:
            meta = parse_ses_notification(str(payload["Message"]))
        except Exception:
            logger.exception("sns_parse_error", payload_keys=list(payload.keys()))
            return Response(status_code=status.HTTP_200_OK)

        logger.info(
            "email_received",
            message_id=meta["message_id"],
            sender=meta["sender"],
            recipients=meta["recipients"],
            subject=meta["subject"],
        )
        return await _process_notification(request, meta)

    logger.warning("sns_unknown_type", type=msg_type)
    return Response(status_code=status.HTTP_200_OK)


async def _process_notification(request: Request, meta: EmailMeta) -> Response:
    """Enqueue a durable job (flag ON) or run the inline pipeline (flag OFF, today's path)."""
    if get_settings().INGEST_ENQUEUE_ENABLED:
        # Durable path (Track 3a): enqueue a {ses_message_id, recipients} POINTER job —
        # the MIME is already durably in S3 — and let the co-located worker own the heavy
        # pipeline with retries + permanent dead-letter. job_key makes the enqueue
        # idempotent, so an SNS redelivery replaces the pending job. A failed ENQUEUE
        # returns 500 (SNS retries) — the whole point of 3a: no silent loss.
        try:
            enqueuer: JobEnqueuer = await request.app.state.dishka_container.get(JobEnqueuer)
            await enqueuer.enqueue(
                "ingest_inbound_email",
                {"ses_message_id": meta["message_id"], "recipients": list(meta["recipients"])},
                job_key=f"ingest:{meta['message_id']}",
            )
        except Exception:
            logger.exception("email_enqueue_error", message_id=meta["message_id"])
            return Response(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(status_code=status.HTTP_200_OK)

    # Flag OFF (default) — today's inline path, UNCHANGED. Resolve + ingest inside the
    # guard: any failure (DI misconfiguration, S3 fetch, DB write) still returns 200 to
    # stop SNS retry storms (the pre-3a behavior, silent loss and all).
    try:
        use_case: IngestInboundEmailUseCase = await request.app.state.dishka_container.get(
            IngestInboundEmailUseCase
        )
        await use_case.execute(meta["message_id"], recipients=meta["recipients"])
    except Exception:
        logger.exception("email_ingest_error", message_id=meta["message_id"])
    return Response(status_code=status.HTTP_200_OK)
