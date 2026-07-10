"""POST /v1/emails/inbound-sns — handle SNS notifications from SES.

No auth — SNS cannot send X-API-Key headers.
Always returns HTTP 200 to prevent SNS retry storms on malformed payloads.
"""

from __future__ import annotations

import json

import structlog
from fastapi import APIRouter, Request, Response, status

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.infrastructure.sns.confirmation import confirm_subscription
from app.infrastructure.sns.ses_parser import parse_ses_notification

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

        # Resolve + ingest inside the guard: any failure (DI misconfiguration,
        # S3 fetch, DB write) must still return 200 to stop SNS retry storms.
        try:
            use_case: IngestInboundEmailUseCase = await request.app.state.dishka_container.get(
                IngestInboundEmailUseCase
            )
            await use_case.execute(meta["message_id"], recipients=meta["recipients"])
        except Exception:
            logger.exception("email_ingest_error", message_id=meta["message_id"])
        return Response(status_code=status.HTTP_200_OK)

    logger.warning("sns_unknown_type", type=msg_type)
    return Response(status_code=status.HTTP_200_OK)
