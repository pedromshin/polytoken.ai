"""ImporterResolver port — domain abstraction over sender-to-importer resolution."""

from __future__ import annotations

from typing import Protocol


class ImporterResolver(Protocol):
    """Find-or-create an importer record keyed by forwarding-sender address.

    Returns the importer_id (UUID string) for the given sender.
    Malformed senders (no parseable domain) fall back to a configured default
    without creating any DB row — ingestion never hard-fails on a bad From header.
    """

    async def resolve(self, sender_address: str, *, user_id: str | None = None) -> str:
        """Resolve a sender address to an importer_id.

        Args:
            sender_address: The forwarding sender's email address
                (e.g. "maria@exporter.com").
            user_id: The forwarding-token-resolved owner (Phase 45, THRD-04),
                keyword-only and optional — mirrors PromoteEdgeUseCase's
                optional-user_id pattern (44-03). When provided AND a new
                importer must be created (no existing row for the sender's
                domain), the new row is anchored to this user_id. When None
                and no existing importer matches, the resolver falls back to
                default_importer_id rather than inserting a user_id-less row
                (importers.user_id is NOT NULL since Phase 44 — T-45-05-02).

        Returns:
            The importer_id UUID string for the resolved (or created) importer.
            Returns the configured default_importer_id for malformed senders,
            and also for a brand-new sender domain when user_id is None.
        """
        ...

    async def list_importer_ids_for_user(self, user_id: str) -> list[str]:
        """Return the importer ids owned by user_id (Phase 44, TENA-03).

        Returns an empty list when the user owns no importers — callers MUST
        treat an empty list as "no accessible rows", never as "all importers"
        (fail-closed; this is the owned-importer scoping primitive every
        user-scoped FastAPI endpoint resolves ownership through).
        """
        ...
