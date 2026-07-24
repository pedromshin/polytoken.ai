"""SupabaseThreadRepository — implements ThreadResolver port.

Find-or-create(-or-merge) the thread_id for an inbound email, scoped to its
importer (T-45-03-01: every query below filters .eq("importer_id", ...) —
cross-importer/cross-tenant matching is structurally impossible).

Resolution tiers (mirrors app.domain.services.thread_grouping's algorithm,
applied incrementally per-email instead of batch Union-Find):

- Tier 0 + Tier 1 (THRD-01/THRD-02): neighbor search via Message-ID linkage
  in both directions — this email's own In-Reply-To/References/embedded ids
  point at an existing email (forward), or an already-ingested email's
  In-Reply-To/References already points at this email's message_id
  (backward, e.g. out-of-order SNS delivery).
- Tier 2 (THRD-02): when no header-linked neighbor exists, a conservative
  normalized-subject + time-window fallback — ambiguous or empty-subject
  matches never merge (false-split beats false-merge).
- Merge: when neighbors span more than one existing thread, the emails of
  every non-canonical thread are reassigned to the deterministic
  (lexicographically smallest) canonical thread_id.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any, cast

from supabase import Client

from app.domain.services.thread_grouping import (
    DEFAULT_TIER2_WINDOW,
    extract_embedded_message_ids,
    normalize_subject,
)


def _distinct_thread_ids(rows: list[dict[str, Any]]) -> set[str]:
    return {str(row["thread_id"]) for row in rows if row.get("thread_id")}


class SupabaseThreadRepository:
    """Supabase implementation of ThreadResolver.

    Every candidate query is scoped to importer_id — resolution never reads
    or matches emails outside the given importer (same-importer invariant).
    """

    def __init__(self, client: Client, *, tier2_window: timedelta = DEFAULT_TIER2_WINDOW) -> None:
        self._client = client
        self._tier2_window = tier2_window

    async def resolve(
        self,
        *,
        importer_id: str,
        message_id: str,
        in_reply_to: str | None,
        references_ids: tuple[str, ...],
        subject: str | None,
        received_at: datetime,
        body_text: str | None,
        body_html: str | None,
    ) -> str:
        candidate_ids = set(references_ids)
        if in_reply_to:
            candidate_ids.add(in_reply_to)
        candidate_ids.update(extract_embedded_message_ids(body_text, body_html))
        # Guard against a malformed/self-referential header creating a self-loop.
        candidate_ids.discard(message_id)

        thread_ids: set[str] = set()

        if candidate_ids:
            forward = await asyncio.to_thread(
                lambda: (
                    self._client.table("emails")
                    .select("thread_id")
                    .eq("importer_id", importer_id)
                    .in_("message_id", sorted(candidate_ids))
                    .execute()
                )
            )
            thread_ids.update(_distinct_thread_ids(cast("list[dict[str, Any]]", forward.data)))

        backward_reply = await asyncio.to_thread(
            lambda: (
                self._client.table("emails")
                .select("thread_id")
                .eq("importer_id", importer_id)
                .eq("in_reply_to", message_id)
                .execute()
            )
        )
        thread_ids.update(_distinct_thread_ids(cast("list[dict[str, Any]]", backward_reply.data)))

        backward_ref = await asyncio.to_thread(
            lambda: (
                self._client.table("emails")
                .select("thread_id")
                .eq("importer_id", importer_id)
                .contains("references_ids", [message_id])
                .execute()
            )
        )
        thread_ids.update(_distinct_thread_ids(cast("list[dict[str, Any]]", backward_ref.data)))

        if len(thread_ids) == 1:
            return next(iter(thread_ids))

        if not thread_ids:
            tier2_thread_id = await self._tier2_fallback(
                importer_id=importer_id, subject=subject, received_at=received_at
            )
            if tier2_thread_id is not None:
                return tier2_thread_id
            return await self._create_thread(importer_id=importer_id, subject=subject)

        return await self._merge_threads(importer_id=importer_id, thread_ids=thread_ids)

    async def _tier2_fallback(self, *, importer_id: str, subject: str | None, received_at: datetime) -> str | None:
        """Conservative normalized-subject + time-window fallback.

        Refuses (returns None) on empty/generic subject or an ambiguous
        (>= 2 distinct threads) match — false-split beats false-merge.
        """
        normalized = normalize_subject(subject)
        if not normalized:
            return None

        window_start = (received_at - self._tier2_window).isoformat()
        window_end = (received_at + self._tier2_window).isoformat()
        result = await asyncio.to_thread(
            lambda: (
                self._client.table("emails")
                .select("subject, thread_id")
                .eq("importer_id", importer_id)
                .gte("received_at", window_start)
                .lte("received_at", window_end)
                .execute()
            )
        )
        rows = cast("list[dict[str, Any]]", result.data)
        matching_thread_ids = {
            str(row["thread_id"])
            for row in rows
            if row.get("thread_id") and normalize_subject(cast("str | None", row.get("subject"))) == normalized
        }
        if len(matching_thread_ids) == 1:
            return next(iter(matching_thread_ids))
        return None

    async def _create_thread(self, *, importer_id: str, subject: str | None) -> str:
        result = await asyncio.to_thread(
            lambda: self._client.table("threads").insert({"importer_id": importer_id, "subject": subject}).execute()
        )
        row = cast("dict[str, Any]", result.data[0])
        return str(row["id"])

    async def _merge_threads(self, *, importer_id: str, thread_ids: set[str]) -> str:
        """Merge multiple thread_ids into their deterministic canonical (min) id.

        Reassigns every losing thread's emails to the canonical thread_id
        within this importer — the losing thread rows themselves are left in
        place (harmless orphans; emails.thread_id is ON DELETE SET NULL, not
        a hard dependency, so an empty thread row is not corruption).
        """
        canonical = min(thread_ids)
        losing_ids = [thread_id for thread_id in thread_ids if thread_id != canonical]
        await asyncio.to_thread(
            lambda: (
                self._client.table("emails")
                .update({"thread_id": canonical})
                .eq("importer_id", importer_id)
                .in_("thread_id", losing_ids)
                .execute()
            )
        )
        return canonical
