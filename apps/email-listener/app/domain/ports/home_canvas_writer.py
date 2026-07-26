"""HomeCanvasWriter port — the service-role home-board write seam (Phase 74, MORN-04).

The overnight morning-board job has NO browser session: it cannot ride the
web's ``saveHomeCanvasLayout`` (a ``protectedProcedure`` keyed on
``ctx.user.id``). This port is the server-side counterpart — a whole-snapshot
last-write-wins write into ``chat_canvas_layouts`` keyed on an EXPLICIT
``user_id`` supplied by the job payload.

TENANCY (MORN-04, mirrors home-canvas.ts:15-23): the write filter is
``(user_id, scope = 'home')``. ``user_id`` is stamped from the argument, never a
session and never a snapshot field, so a write for user A can NEVER land on user
B's home row — cross-tenant writes are structurally impossible. The concrete
adapter is one home board per user (the partial-unique-index home row), so the
write is an idempotent overwrite, not an append.
"""

from __future__ import annotations

from typing import Protocol

from app.domain.canvas.snapshot import CanvasSnapshot


class HomeCanvasWriter(Protocol):
    """Persist a composed snapshot to the caller's home-scoped canvas board."""

    async def write_home_snapshot(self, user_id: str, snapshot: CanvasSnapshot) -> None:
        """Upsert ``snapshot`` onto the home board owned by ``user_id``.

        Whole-snapshot LWW: nodes/edges/viewport/shared_state/
        node_registry_version are overwritten in full. The row is keyed on
        ``(user_id, scope='home')`` with a NULL ``conversation_id`` — the same
        home-row shape ``writeHomeBlob`` upserts (canvas-store-backend.ts).

        Args:
            user_id: the home board's owner — the EXPLICIT tenancy anchor from
                the job payload. Stamped onto the row; never taken from the
                snapshot.
            snapshot: the composed board to persist.
        """
        ...
