"""SNS subscription confirmation helper."""

from __future__ import annotations

import httpx
import structlog

from app.infrastructure.sns.verification import SnsSignatureError, is_sns_host

logger = structlog.get_logger(__name__)


async def confirm_subscription(subscribe_url: str) -> None:
    """GET the SubscribeURL to confirm an SNS HTTP subscription.

    Host-pinned to ``sns.<region>.amazonaws.com`` as defense-in-depth against SSRF:
    the handler already rejects a non-SNS SubscribeURL, but any caller of this
    helper is protected regardless.
    """
    if not is_sns_host(subscribe_url):
        logger.warning("sns_subscribe_url_rejected", url=subscribe_url)
        raise SnsSignatureError(f"SubscribeURL host not allowed: {subscribe_url!r}")
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(subscribe_url)
        response.raise_for_status()
    logger.info("sns_subscription_confirmed", url=subscribe_url)
