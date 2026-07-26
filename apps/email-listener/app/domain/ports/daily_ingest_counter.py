"""DailyIngestCounter port — a narrow read used by the ingest budget guard (A1).

Deliberately NOT a method on EmailRepository: the guard needs exactly one
server-timestamp-bounded count and nothing else, and widening the broad
EmailRepository Protocol would force every fake in the test suite to grow a
method it never exercises. SupabaseEmailRepository satisfies this structurally
(it grows the concrete method); the guard depends only on this one call, so it
is trivially faked in unit tests.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from datetime import datetime


class DailyIngestCounter(Protocol):
    """Count emails an importer had ingested since a server-clock instant."""

    async def count_received_since(self, importer_id: str, since: datetime) -> int:
        """Exact count of the importer's emails with ``created_at >= since``.

        MUST filter on ``created_at`` (the row-creation instant WE stamp at
        ingest), never ``received_at`` (a sender-controlled header a mail-bomb
        could backdate to slip under the cap). MUST be an exact server-side
        count, never a limited row scan.
        """
        ...
