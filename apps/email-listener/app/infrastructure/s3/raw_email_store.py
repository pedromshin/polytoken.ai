"""S3RawEmailStore — implements RawEmailStore port.

SES writes raw MIME to s3://{bucket}/{prefix}{sesMessageId}. Auth is the
default boto3 credential chain (ECS task IAM role in staging/prod, local
AWS profile in development) — no static keys.
"""

from __future__ import annotations

import asyncio
from typing import Any


class S3RawEmailStore:
    """Fetches raw inbound email bytes from the SES S3 inbound bucket."""

    def __init__(self, bucket: str, prefix: str, client: Any) -> None:
        self._bucket = bucket
        self._prefix = prefix
        self._client = client

    def key_for(self, message_id: str) -> str:
        """Return the S3 object key for the given SES message id."""
        return f"{self._prefix}{message_id}"

    async def fetch(self, message_id: str) -> bytes:
        """Download and return the raw MIME bytes for the given SES message id.

        boto3's ``get_object`` + the streaming ``Body.read()`` are synchronous
        network calls; both are offloaded to a worker thread via asyncio.to_thread
        so the shared uvicorn event loop stays free during the S3 round-trip (WR-06).
        """

        def _download() -> bytes:
            response = self._client.get_object(Bucket=self._bucket, Key=self.key_for(message_id))
            body: bytes = response["Body"].read()
            return body

        return await asyncio.to_thread(_download)

    async def delete_by_key(self, storage_key: str) -> None:
        """Delete the raw MIME object at the given full S3 key (idempotent).

        ``storage_key`` is the persisted ``emails.raw_storage_key`` (already the
        full ``{prefix}{message_id}`` key), so it is used verbatim — no key_for.
        S3's ``delete_object`` is idempotent (a missing key still returns 2xx),
        satisfying the deletion contract's retry-safety requirement. The blocking
        boto3 call is offloaded to a worker thread like ``fetch``.
        """

        def _delete() -> None:
            self._client.delete_object(Bucket=self._bucket, Key=storage_key)

        await asyncio.to_thread(_delete)
