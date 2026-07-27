"""SupabaseHomeCanvasLayoutWriter — service-role home-board writer (Phase 74, MORN-04).

The server-side counterpart to the web's ``writeHomeBlob``
(packages/api-client/src/router/chat/canvas-store-backend.ts:177-209): a
whole-snapshot last-write-wins upsert into ``chat_canvas_layouts`` for a
home-scoped row, keyed on an EXPLICIT ``user_id`` (from the job payload, never a
session).

TENANCY (MORN-04): every read/write filters ``(user_id, scope='home')`` and the
insert STAMPS those two columns itself, so a write for user A can never touch
user B's row and a home write can never clobber a conversation row. The literal
``scope='home'`` filter mirrors home-canvas.ts's ownership invariant.

Upsert strategy: supabase-py (PostgREST) cannot target the home PARTIAL unique
index (``ON user_id WHERE scope='home'``) via ``on_conflict`` — PostgREST emits
``ON CONFLICT (user_id)`` with no predicate, which Postgres rejects for a partial
index. So this does a keyed read-then-write: find the existing home row for the
user, UPDATE it in place (keyed on user_id+scope) if present, else INSERT a new
home row. Safe as LWW here because there is one home board per user and a single
overnight writer — no concurrent browser save races the 5am run (per the SPEC).

WR-06: supabase-py's Client is synchronous; every blocking call is offloaded to a
thread-pool worker via ``asyncio.to_thread()`` so the event loop stays free.
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog
from supabase import Client

from app.domain.canvas.snapshot import CanvasSnapshot

logger = structlog.get_logger(__name__)

_TABLE = "chat_canvas_layouts"
_HOME_SCOPE = "home"


class SupabaseHomeCanvasLayoutWriter:
    """Supabase implementation of the HomeCanvasWriter port over chat_canvas_layouts.

    Satisfies the HomeCanvasWriter Protocol structurally (mirrors the other
    Supabase adapters — no explicit Protocol inheritance keeps the domain port
    lint-imports clean).
    """

    def __init__(self, client: Client) -> None:
        self._client = client

    async def write_home_snapshot(self, user_id: str, snapshot: CanvasSnapshot) -> None:
        """Upsert the home-scoped snapshot for ``user_id`` (whole-snapshot LWW).

        Keyed on ``(user_id, scope='home')`` for BOTH the existence probe and the
        update filter — the tenancy wall (MORN-04). Raises on any failure
        (MORN-03): the caller must see a write failure, never a silent success.
        """
        columns = snapshot.to_row_columns()

        existing = await asyncio.to_thread(
            lambda: (
                self._client.table(_TABLE)
                .select("id")
                .eq("user_id", user_id)
                .eq("scope", _HOME_SCOPE)
                .limit(1)
                .execute()
            )
        )

        if existing.data:
            await asyncio.to_thread(
                lambda: (
                    self._client.table(_TABLE).update(columns).eq("user_id", user_id).eq("scope", _HOME_SCOPE).execute()
                )
            )
            logger.info("home_canvas_snapshot_updated", user_id=user_id, node_count=len(snapshot.nodes))
            return

        insert_row: dict[str, Any] = {
            **columns,
            "user_id": user_id,
            "scope": _HOME_SCOPE,
            "conversation_id": None,
        }
        await asyncio.to_thread(lambda: self._client.table(_TABLE).insert(insert_row).execute())
        logger.info("home_canvas_snapshot_inserted", user_id=user_id, node_count=len(snapshot.nodes))
