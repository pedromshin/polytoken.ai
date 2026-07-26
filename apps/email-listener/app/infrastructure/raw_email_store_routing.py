"""RoutingRawEmailStore — routes raw-MIME reads by message-id namespace.

SES-delivered ids resolve against the read-only S3 inbound store; backfill
ids (BACKFILL_MESSAGE_ID_PREFIX) resolve against the writable Supabase store.
Injected as THE RawEmailStore, so IngestInboundEmailUseCase and
ReprocessEmailUseCase work identically for live and backfilled emails — the
reprocess round-trip (raw_storage_key -> bare id -> fetch) re-routes to the
same store that originally persisted the bytes.

Composes two injected ports; imports domain only (import-linter clean).
"""

from __future__ import annotations

from app.domain.ports.raw_email_store import (
    BACKFILL_MESSAGE_ID_PREFIX,
    BackfillRawEmailStore,
    RawEmailStore,
)


class RoutingRawEmailStore:
    """Prefix-routing composite of the SES (S3) and backfill (Supabase) stores."""

    def __init__(self, ses_store: RawEmailStore, backfill_store: BackfillRawEmailStore) -> None:
        self._ses_store = ses_store
        self._backfill_store = backfill_store

    def _route(self, message_id: str) -> RawEmailStore:
        if message_id.startswith(BACKFILL_MESSAGE_ID_PREFIX):
            return self._backfill_store
        return self._ses_store

    def key_for(self, message_id: str) -> str:
        return self._route(message_id).key_for(message_id)

    async def fetch(self, message_id: str) -> bytes:
        return await self._route(message_id).fetch(message_id)

    async def delete_by_key(self, storage_key: str) -> None:
        """Delete a raw MIME object by its persisted full key, routed like fetch.

        The stored ``raw_storage_key`` carries the bare message id as its LAST
        path segment (SES: ``{prefix}{id}``; backfill: ``backfill/{id}``), the
        same round-trip ReprocessEmailUseCase relies on. Deriving the id via
        ``rsplit("/", 1)[-1]`` re-selects the store that originally persisted the
        bytes, then the full key is deleted verbatim there.
        """
        message_id = storage_key.rsplit("/", 1)[-1]
        await self._route(message_id).delete_by_key(storage_key)
