"""Deterministic morning-board composer (Phase 74, MORN-05).

A PURE fold from "nothing" into a schema-valid ``CanvasSnapshot`` — the MVP
places a small, fixed starter SET of ref-only nodes on the home board:

  - ``brief``        — the daily morning brief card.
  - ``review-queue`` — the top slice of the entity merge-review queue.
  - ``usage``        — the spend meter.

These three are REF-ONLY node types: each fetches its own live data client-side
on render (see apps/web/src/app/chat/_canvas/node-data-schemas.ts — their
node.data schemas are all ``{ label?: string }`` strict), so ``node.data`` is
minimal (an empty object here). The composer never reads email content, S3, or
any live user data — it only decides the STARTER LAYOUT; the nodes rehydrate
themselves on the web.

DETERMINISTIC by construction: hardcoded ids, positions, and dimensions in a
simple non-overlapping horizontal grid (no layout engine, no randomness) so a
re-run produces byte-identical output and the LWW overwrite is stable. Pure —
no I/O, no DI, no infrastructure import — so it stays inside the "Application
does not import infrastructure" import-linter contract.

The registry-version tag stamped is ``HOME_REGISTRY_VERSION`` ("home-v1"),
matching the literal the web home board writes
(apps/web/src/app/home/_components/home-board.tsx). The web restore path
re-validates the whole snapshot against ``CanvasSnapshotSchema`` and degrades any
node type it doesn't recognize to an inert placeholder — it never blanks.
"""

from __future__ import annotations

from app.domain.canvas.snapshot import CanvasNode, CanvasSnapshot

# The registry-version tag the web home board stamps on its own snapshots
# (home-board.tsx `HOME_REGISTRY_VERSION`). A non-empty string per the Zod
# contract (`nodeRegistryVersion: z.string().min(1)`); NOT the content-hash the
# /chat canvas uses (node-registry-version.ts) — the home board has its own tag.
HOME_REGISTRY_VERSION = "home-v1"

# Grid geometry — a single non-overlapping row. X spacing (card width + gap)
# strictly exceeds the card width, so the cards can never overlap.
_CARD_WIDTH = 360.0
_CARD_HEIGHT = 320.0
_CARD_GAP = 48.0
_ROW_Y = 0.0

# The starter node set: (node id, registered node type). The ids are stable so a
# nightly re-run overwrites the SAME nodes (LWW) rather than accumulating. The
# types are cross-checked against node-type-registry.ts — all three are real
# registered types (brief / review-queue / usage).
_STARTER_NODES: tuple[tuple[str, str], ...] = (
    ("morning-brief", "brief"),
    ("morning-review-queue", "review-queue"),
    ("morning-usage", "usage"),
)


def compose_morning_board_snapshot() -> CanvasSnapshot:
    """Compose the deterministic starter home board.

    Returns a ``CanvasSnapshot`` with the three starter nodes laid out in a
    non-overlapping row, no edges (MVP), an empty shared state, and the
    ``home-v1`` registry-version tag. Pure — same output every call.
    """
    nodes = tuple(
        CanvasNode(
            id=node_id,
            type=node_type,
            position_x=index * (_CARD_WIDTH + _CARD_GAP),
            position_y=_ROW_Y,
            data={},
            width=_CARD_WIDTH,
            height=_CARD_HEIGHT,
        )
        for index, (node_id, node_type) in enumerate(_STARTER_NODES)
    )
    return CanvasSnapshot(
        nodes=nodes,
        edges=(),
        shared_state={},
        node_registry_version=HOME_REGISTRY_VERSION,
        viewport=None,
    )
