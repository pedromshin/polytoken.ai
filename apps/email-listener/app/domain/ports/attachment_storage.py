"""AttachmentStorage port — domain abstraction over attachment blob storage."""

from __future__ import annotations

from typing import Protocol


class AttachmentStorage(Protocol):
    """Port for storing and retrieving attachment bytes by storage key.

    Concrete implementation lives in app.infrastructure.supabase.
    """

    async def store(self, storage_key: str, data: bytes, content_type: str) -> None:
        """Persist attachment bytes under the given storage key (idempotent)."""
        ...

    async def fetch(self, storage_key: str) -> bytes:
        """Return the attachment bytes stored under the given key."""
        ...

    async def delete_prefix(self, importer_id: str) -> None:
        """Remove every object under the ``{importer_id}/`` prefix (idempotent).

        Used by account-deletion to erase an importer's attachment blobs, which
        do NOT cascade with the Postgres delete. A missing prefix is a no-op.
        """
        ...
