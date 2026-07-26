"""SupabaseAttachmentStorage — implements AttachmentStorage port.

Stores attachment bytes in a private Supabase Storage bucket. The bucket is
created lazily on first store (idempotent — creation errors for an existing
bucket are swallowed) so all environments work without manual provisioning.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any

import structlog
from supabase import Client

logger = structlog.get_logger(__name__)

# Supabase Storage caps a single `list` page; walk with limit/offset paging.
_LIST_PAGE = 100
# Batch size for `remove` calls (one round-trip per batch of object paths).
_REMOVE_BATCH = 100


def _chunks(items: Sequence[str], size: int) -> Iterator[list[str]]:
    for start in range(0, len(items), size):
        yield list(items[start : start + size])


class SupabaseAttachmentStorage:
    """Supabase Storage implementation of AttachmentStorage."""

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
            logger.debug("attachment_bucket_exists", bucket=self._bucket)
        self._bucket_ensured = True

    async def store(self, storage_key: str, data: bytes, content_type: str) -> None:
        """Upload attachment bytes (upsert — safe on SNS redelivery)."""
        self._ensure_bucket()
        self._client.storage.from_(self._bucket).upload(
            path=storage_key,
            file=data,
            file_options={"content-type": content_type, "upsert": "true"},
        )

    async def fetch(self, storage_key: str) -> bytes:
        """Download attachment bytes by storage key."""
        return self._client.storage.from_(self._bucket).download(storage_key)

    async def delete_prefix(self, importer_id: str) -> None:
        """Remove every object under the ``{importer_id}/`` prefix (idempotent).

        Attachment keys are ``{importer_id}/{email_id}/{attachment_id}/...`` — a
        nested tree, and Supabase Storage's ``list`` is non-recursive and paged,
        so we walk the tree page-by-page collecting leaf object paths, then
        ``remove`` them in batches. A missing prefix simply yields no keys (no
        error), so calling this for an importer with no attachments — or twice —
        is a no-op, satisfying the deletion contract's retry-safety requirement.
        """
        prefix = importer_id.strip().rstrip("/")
        if not prefix:
            # CRITICAL GUARD: a blank importer_id ("" / "/" / whitespace) would make
            # _list_page_all("") walk the BUCKET ROOT and delete EVERY user's
            # attachments. Never allow it. Fail loud — the caller isolates per-id, so
            # one bad id logs + is skipped, it does not wipe the bucket.
            raise ValueError("delete_prefix requires a non-empty importer_id")
        keys = self._collect_keys(prefix)
        for batch in _chunks(keys, _REMOVE_BATCH):
            self._client.storage.from_(self._bucket).remove(batch)

    def _collect_keys(self, prefix: str) -> list[str]:
        """Depth-first walk of the object tree under ``prefix`` → leaf object paths.

        Supabase returns folder entries with ``id is None`` (recurse into them)
        and file entries with a non-null ``id`` (a removable leaf).
        """
        keys: list[str] = []
        for entry in self._list_page_all(prefix):
            name = entry.get("name")
            if not name:
                continue
            path = f"{prefix}/{name}" if prefix else name
            if entry.get("id") is None:
                keys.extend(self._collect_keys(path))
            else:
                keys.append(path)
        return keys

    def _list_page_all(self, prefix: str) -> list[dict[str, Any]]:
        """Return ALL immediate children of ``prefix``, paging past the API limit."""
        items: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = self._client.storage.from_(self._bucket).list(
                prefix,
                {"limit": _LIST_PAGE, "offset": offset},
            )
            if not page:
                break
            items.extend(page)
            if len(page) < _LIST_PAGE:
                break
            offset += _LIST_PAGE
        return items
