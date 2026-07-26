"""SupabaseTierResolver — implements TierResolver.

Resolves an importer to its owning user's subscription tier in two reads:
importer_id -> importers.user_id -> subscriptions(tier, status) for that user.
A tier is honoured only when the subscription is in an active/trialing state
(mirroring @polytoken/billing's duplicate-active guard); any other status, or a
missing importer / subscription row, resolves to 'free'. Genuine query errors
propagate (the budget guard fails open on the raise, never capping real mail).
"""

from __future__ import annotations

import asyncio
from typing import Any, cast

from supabase import Client

_FREE_TIER = "free"
# The subscription statuses under which the paid tier is actually entitled
# (matches @polytoken/billing's active/trialing check).
_ENTITLED_STATUSES = frozenset({"active", "trialing"})


class SupabaseTierResolver:
    """Supabase implementation of TierResolver."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def tier_for_importer(self, importer_id: str) -> str:
        if not importer_id.strip():
            return _FREE_TIER
        user_id = await self._user_id_for_importer(importer_id)
        if user_id is None:
            return _FREE_TIER
        return await self._tier_for_user(user_id)

    async def _user_id_for_importer(self, importer_id: str) -> str | None:
        result = await asyncio.to_thread(
            lambda: self._client.table("importers").select("user_id").eq("id", importer_id).limit(1).execute()
        )
        rows = cast("list[dict[str, Any]]", result.data or [])
        if not rows:
            return None
        user_id = rows[0].get("user_id")
        return str(user_id) if user_id else None

    async def _tier_for_user(self, user_id: str) -> str:
        result = await asyncio.to_thread(
            lambda: self._client.table("subscriptions").select("tier, status").eq("user_id", user_id).limit(1).execute()
        )
        rows = cast("list[dict[str, Any]]", result.data or [])
        if not rows:
            return _FREE_TIER
        row = rows[0]
        if row.get("status") not in _ENTITLED_STATUSES:
            return _FREE_TIER
        return str(row.get("tier") or _FREE_TIER)
