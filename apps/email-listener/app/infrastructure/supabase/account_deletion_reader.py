"""SupabaseAccountDeletionReader — implements AccountDeletionReader.

Derives the deletion scope from the DB, scoped strictly to one user_id: the
importers they own, and the raw_storage_keys of emails under those importers.
Runs BEFORE the web deletes the auth user (whose cascade would remove these
rows), so the reads always see live data.
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

from supabase import Client


class SupabaseAccountDeletionReader:
    """Supabase implementation of AccountDeletionReader."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def importer_ids_for_user(self, user_id: str) -> list[str]:
        if not user_id.strip():
            return []
        result = await asyncio.to_thread(
            lambda: self._client.table("importers").select("id").eq("user_id", user_id).execute()
        )
        rows = cast("list[dict[str, Any]]", result.data or [])
        return [str(row["id"]) for row in rows if row.get("id")]

    async def raw_storage_keys_for_user(self, user_id: str) -> list[str]:
        importer_ids = await self.importer_ids_for_user(user_id)
        if not importer_ids:
            return []
        result = await asyncio.to_thread(
            lambda: (
                self._client.table("emails")
                .select("raw_storage_key")
                .in_("importer_id", importer_ids)
                .not_.is_("raw_storage_key", "null")
                .execute()
            )
        )
        rows = cast("list[dict[str, Any]]", result.data or [])
        return [str(row["raw_storage_key"]) for row in rows if row.get("raw_storage_key")]
