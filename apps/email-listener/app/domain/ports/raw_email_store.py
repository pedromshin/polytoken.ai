"""RawEmailStore port — domain abstraction over the raw MIME object store."""

from __future__ import annotations

from typing import Protocol


class RawEmailStore(Protocol):
    """Port for fetching raw inbound email bytes keyed by SES message id.

    Concrete implementation lives in app.infrastructure.s3.
    """

    def key_for(self, message_id: str) -> str:
        """Return the storage key where the raw MIME for this message lives."""
        ...

    async def fetch(self, message_id: str) -> bytes:
        """Return the raw MIME bytes for the given SES message id."""
        ...

    async def delete_by_key(self, storage_key: str) -> None:
        """Delete the raw MIME object stored at ``storage_key`` (idempotent).

        Takes the persisted ``emails.raw_storage_key`` (a full key, not a bare
        message id) so account-deletion can erase raw MIME — which does NOT
        cascade with the Postgres delete. Routes the same way ``fetch`` does
        (by the key's last path segment) and tolerates a missing object.
        """
        ...


# Message-id namespace for backfilled (non-SES) emails. Ids carrying this
# prefix are stored/fetched via the writable BackfillRawEmailStore; everything
# else is an SES id served by the read-only S3 store. The prefix is part of
# the persisted raw_storage_key's last segment, so ReprocessEmailUseCase's
# rsplit("/")-derived bare id round-trips back to the same routing decision.
BACKFILL_MESSAGE_ID_PREFIX = "bf-"


class BackfillRawEmailStore(RawEmailStore, Protocol):
    """Writable raw-MIME store for backfilled emails (Gmail import, mbox replay).

    SES owns writes to the S3 inbound bucket (the ECS task role is
    deliberately read-only there), so backfilled raw MIME lands in a store the
    listener can write — Supabase Storage in the concrete implementation.
    """

    async def store(self, message_id: str, raw: bytes) -> None:
        """Persist the raw MIME bytes for the given backfill message id (upsert)."""
        ...
