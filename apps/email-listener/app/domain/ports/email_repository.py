"""EmailRepository port — domain abstraction over email persistence."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from app.domain.entities.email import Email


class EmailRepository(Protocol):
    """Port for persisting and retrieving Email domain entities.

    Concrete implementations live in app.infrastructure.supabase.
    """

    async def save(self, email: Email) -> Email:
        """Upsert an email row; returns the persisted entity."""
        ...

    async def find_by_id(self, email_id: str) -> Email | None:
        """Return the email with the given id, or None if not found."""
        ...

    async def find_by_message_id(self, importer_id: str, message_id: str) -> Email | None:
        """Return the email matching (importer_id, message_id), or None."""
        ...

    async def list_by_importer(self, importer_id: str | None, limit: int, offset: int) -> list[Email]:
        """Return emails newest received_at first; importer_id=None lists across all importers (D-18)."""
        ...

    async def list_by_importer_ids(self, importer_ids: list[str], limit: int, offset: int) -> list[Email]:
        """Return emails newest received_at first, scoped to the given importer ids (Phase 44, TENA-03).

        Used to list across a caller's OWNED importer set (never all importers)
        when no single importer_id filter is supplied. An empty importer_ids
        list must return an empty result — never all rows.
        """
        ...

    async def list_by_thread_id(self, *, importer_id: str, thread_id: str, limit: int, offset: int = 0) -> list[Email]:
        """Return a thread's member emails, scoped to importer_id, newest first (Phase 54-05, CLUS-02).

        A thread_id from a foreign importer resolves to [] — never a
        cross-tenant leak (T-54-05-02). Bounded by limit; callers needing a
        token-budget-bounded body must further truncate the returned
        emails' body_text themselves (this port makes no truncation
        decisions).
        """
        ...

    async def list_by_thread_id_for_importers(
        self, *, importer_ids: Sequence[str], thread_id: str, limit: int, offset: int = 0
    ) -> list[Email]:
        """Return a thread's member emails across the caller's OWNED importer set, newest first.

        Multi-importer sibling of `list_by_thread_id` (chat-context fix): real
        emails live under per-(user, sender-domain) importers, so a thread read
        scoped to one importer id (e.g. the default) silently returns [] for a
        caller whose emails span several owned importers. An empty importer_ids
        must return [] — never all rows (same fail-closed contract as
        `list_by_importer_ids`). A thread_id from a foreign importer still
        resolves to [] — never a cross-tenant leak.
        """
        ...

    async def update_parse_status(
        self, email_id: str, status: str, error: str | None, *, parsed_at: datetime | None = None
    ) -> None:
        """Update the parse_status/parse_error/parsed_at fields for an email (ING-6).

        parsed_at is stamped on a successful transition to 'parsed' (and to
        'degraded' — the email did parse, ST-04) and cleared (None) on any
        failure transition — it is always written.
        """
        ...

    async def count_emails(self, importer_id: str, *, parse_status: str | None = None) -> int:
        """Exact email count for one importer, optionally filtered by parse_status (ST-04).

        MUST be an exact server-side count (e.g. PostgREST count='exact'),
        never a limited row scan — the pipeline-health endpoint's numbers may
        not silently truncate at any page size.
        """
        ...

    async def list_parse_errors(self, importer_id: str, *, parse_status: str) -> list[str]:
        """All non-null parse_error values for the importer's emails in *parse_status* (ST-04).

        Implementations MUST paginate internally until exhausted (never a
        single capped page) — used to bucket failed_by_stage exactly.
        """
        ...
