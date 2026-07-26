"""DeleteImporterDataUseCase — listener-owned blob erasure for account deletion.

Deleting the Supabase auth user cascade-deletes ~all Postgres rows, but the raw
MIME objects and attachment blobs the listener owns do NOT cascade. This use case
erases them for one user being deleted.

TENANT SAFETY (adversarial-review finding): the scope is DERIVED from the
authenticated user_id via AccountDeletionReader — never from caller-supplied ids.
So no input can make one user's deletion touch another user's blobs. It erases:

- each raw MIME object (by raw_storage_key) via the ROUTED raw store, and
- every object under each owned ``{importer_id}/`` prefix in the attachments bucket.

Per-item isolated (a single failing key/prefix is logged, does not abort the
rest), and every delete is idempotent — so the whole call is safe to retry.
Returns counts AND ``complete`` (True iff every derived item deleted without
error): the web caller gates the irreversible auth-user cascade on ``complete``,
so a partial blob-delete failure never strands data behind a destroyed pointer.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

from app.domain.ports.account_deletion_reader import AccountDeletionReader
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.raw_email_store import RawEmailStore

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class DeleteImporterDataResult:
    """Counts of items that deleted without raising, plus overall completeness."""

    deleted_raw: int
    deleted_attachment_prefixes: int
    requested_raw: int
    requested_attachment_prefixes: int

    @property
    def complete(self) -> bool:
        """True iff every derived raw key + importer prefix deleted cleanly."""
        return (
            self.deleted_raw == self.requested_raw
            and self.deleted_attachment_prefixes == self.requested_attachment_prefixes
        )


class DeleteImporterDataUseCase:
    """Erases the listener-owned blobs for a user being deleted (scope self-derived)."""

    def __init__(
        self,
        reader: AccountDeletionReader,
        raw_store: RawEmailStore,
        attachment_storage: AttachmentStorage,
    ) -> None:
        self._reader = reader
        self._raw_store = raw_store
        self._attachment_storage = attachment_storage

    async def execute(self, user_id: str) -> DeleteImporterDataResult:
        if not user_id.strip():
            raise ValueError("delete_importer_data requires a non-empty user_id")

        importer_ids = await self._reader.importer_ids_for_user(user_id)
        raw_storage_keys = await self._reader.raw_storage_keys_for_user(user_id)

        deleted_raw = 0
        for storage_key in raw_storage_keys:
            try:
                await self._raw_store.delete_by_key(storage_key)
                deleted_raw += 1
            except Exception:
                # Per-item isolation: one bad key must not abort the erasure.
                logger.warning(
                    "delete_importer_data.raw_delete_failed",
                    raw_storage_key=storage_key,
                    exc_info=True,
                )

        deleted_prefixes = 0
        for importer_id in importer_ids:
            try:
                await self._attachment_storage.delete_prefix(importer_id)
                deleted_prefixes += 1
            except Exception:
                logger.warning(
                    "delete_importer_data.attachment_prefix_delete_failed",
                    importer_id=importer_id,
                    exc_info=True,
                )

        result = DeleteImporterDataResult(
            deleted_raw=deleted_raw,
            deleted_attachment_prefixes=deleted_prefixes,
            requested_raw=len(raw_storage_keys),
            requested_attachment_prefixes=len(importer_ids),
        )
        logger.info(
            "delete_importer_data.done",
            user_id=user_id,
            deleted_raw=deleted_raw,
            deleted_attachment_prefixes=deleted_prefixes,
            requested_raw=result.requested_raw,
            requested_importers=result.requested_attachment_prefixes,
            complete=result.complete,
        )
        return result
