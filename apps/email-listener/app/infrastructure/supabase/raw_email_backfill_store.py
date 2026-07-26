"""SupabaseRawEmailBackfillStore — implements BackfillRawEmailStore port.

Stores backfilled raw MIME (Gmail import / mbox replay) in a private Supabase
Storage bucket. SES-delivered mail never lands here — the ECS task role is
read-only on the SES S3 bucket, so backfill needed a store the listener can
write. Mirrors SupabaseAttachmentStorage's lazy idempotent bucket
provisioning so all environments work without manual setup.
"""

from __future__ import annotations

import structlog
from supabase import Client

logger = structlog.get_logger(__name__)

_KEY_PREFIX = "backfill/"


class SupabaseRawEmailBackfillStore:
    """Supabase Storage implementation of BackfillRawEmailStore."""

    def __init__(self, client: Client, bucket: str) -> None:
        self._client = client
        self._bucket = bucket
        self._bucket_ensured = False

    def _ensure_bucket(self) -> None:
        if self._bucket_ensured:
            return
        try:
            self._client.storage.create_bucket(self._bucket)
        except Exception:
            logger.debug("raw_email_bucket_exists", bucket=self._bucket)
        self._bucket_ensured = True

    def key_for(self, message_id: str) -> str:
        """Return the storage key for a backfill message id.

        The bare message id must stay the LAST path segment: reprocess derives
        the id back via raw_storage_key.rsplit("/", 1)[-1].
        """
        return f"{_KEY_PREFIX}{message_id}"

    async def store(self, message_id: str, raw: bytes) -> None:
        """Upload raw MIME bytes (upsert — safe under client retries)."""
        self._ensure_bucket()
        self._client.storage.from_(self._bucket).upload(
            path=self.key_for(message_id),
            file=raw,
            file_options={"content-type": "message/rfc822", "upsert": "true"},
        )

    async def fetch(self, message_id: str) -> bytes:
        """Download raw MIME bytes by backfill message id."""
        return self._client.storage.from_(self._bucket).download(self.key_for(message_id))

    async def delete_by_key(self, storage_key: str) -> None:
        """Delete the raw MIME object at the given full storage key (idempotent).

        ``storage_key`` is the persisted ``emails.raw_storage_key`` — already the
        full ``backfill/{message_id}`` key — so it is removed verbatim, not via
        key_for. Supabase ``remove`` of an absent path returns without error,
        satisfying the deletion contract's retry-safety requirement.
        """
        self._client.storage.from_(self._bucket).remove([storage_key])
