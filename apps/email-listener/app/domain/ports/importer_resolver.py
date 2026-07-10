"""ImporterResolver port — domain abstraction over sender-to-importer resolution."""

from __future__ import annotations

from typing import Protocol


class ImporterResolver(Protocol):
    """Find-or-create an importer record keyed by forwarding-sender address.

    Returns the importer_id (UUID string) for the given sender.
    Malformed senders (no parseable domain) fall back to a configured default
    without creating any DB row — ingestion never hard-fails on a bad From header.
    """

    async def resolve(self, sender_address: str) -> str:
        """Resolve a sender address to an importer_id.

        Args:
            sender_address: The forwarding sender's email address
                (e.g. "maria@exporter.com").

        Returns:
            The importer_id UUID string for the resolved (or created) importer.
            Returns the configured default_importer_id for malformed senders.
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
