"""AccountDeletionReader port — the listener's OWN, tenant-safe view of what to
erase for a user being deleted.

Security (adversarial-review finding): the delete-data endpoint must NEVER trust
caller-supplied importer ids / raw keys — a holder of the shared API key (or a
buggy caller) could otherwise name another user's data. So the listener derives
the scope ITSELF from the authenticated X-User-Id: only importers the user owns,
and only raw-MIME keys belonging to emails under those importers. There is no
input path by which one user's deletion can reach another user's blobs.
"""

from __future__ import annotations

from typing import Protocol


class AccountDeletionReader(Protocol):
    """Server-derived deletion scope for a single user (tenant-safe by construction)."""

    async def importer_ids_for_user(self, user_id: str) -> list[str]:
        """The ids of every importer owned by *user_id* (empty if none)."""
        ...

    async def raw_storage_keys_for_user(self, user_id: str) -> list[str]:
        """Every non-null emails.raw_storage_key under the user's importers."""
        ...
