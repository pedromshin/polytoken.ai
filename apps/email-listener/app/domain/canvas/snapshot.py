"""Canvas snapshot domain model (Phase 74, MORN-05).

A pure, JSON-serializable mirror of the web's ``CanvasSnapshotSchema``
(packages/api-client/src/router/chat/canvas-schema.ts) — the wire contract a
home-canvas layout row carries. The listener composes one of these headlessly
(no browser session) and the service-role writer persists it into
``chat_canvas_layouts``.

Domain-pure by design: only dataclasses + stdlib typing, so it satisfies the
"Domain has no external deps" import-linter contract and can be imported by BOTH
the application composer (which builds it) and the infrastructure writer (which
serializes it to row columns) without either importing the other.

The shape MUST stay field-compatible with the Zod schema — the web restore path
(`validateSavedRow`) re-validates every home row against ``CanvasSnapshotSchema``
and drops the board if it fails. Concretely a node is
``{id, type, position:{x,y}, data, width?, height?}`` and the snapshot is
``{nodes, edges, viewport?, sharedState, nodeRegistryVersion}``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CanvasNode:
    """One canvas node — id + type + position + a free-form ref-only data payload.

    ``data`` carries ONLY provenance/identity refs (never fetched content, never
    genui spec) — every home node type the composer emits (brief/review-queue/
    usage) reads its own live data client-side on render, so ``data`` is minimal.
    """

    id: str
    type: str
    position_x: float
    position_y: float
    data: Mapping[str, Any] = field(default_factory=dict)
    width: float | None = None
    height: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the exact node object shape ``CanvasSnapshotSchema`` expects.

        ``width``/``height`` are OMITTED when None (they are optional in the Zod
        schema, and a ``.strict()`` object rejects unknown keys but tolerates
        absent optionals).
        """
        node: dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "position": {"x": self.position_x, "y": self.position_y},
            "data": dict(self.data),
        }
        if self.width is not None:
            node["width"] = self.width
        if self.height is not None:
            node["height"] = self.height
        return node


@dataclass(frozen=True)
class CanvasSnapshot:
    """A whole home-board snapshot — the LWW unit the service-role writer persists.

    ``node_registry_version`` records the registry-version tag active at compose
    time (the web home board stamps the literal ``"home-v1"``; see
    apps/web/src/app/home/_components/home-board.tsx). It is a non-empty string
    by the Zod contract (``nodeRegistryVersion: z.string().min(1)``).
    """

    nodes: tuple[CanvasNode, ...] = ()
    edges: tuple[Mapping[str, Any], ...] = ()
    shared_state: Mapping[str, Any] = field(default_factory=dict)
    node_registry_version: str = ""
    viewport: Mapping[str, Any] | None = None

    def to_snapshot_dict(self) -> dict[str, Any]:
        """Serialize to the camelCase snapshot object the web schema validates.

        ``viewport`` is OMITTED when None (optional in the Zod schema).
        """
        snapshot: dict[str, Any] = {
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [dict(edge) for edge in self.edges],
            "sharedState": dict(self.shared_state),
            "nodeRegistryVersion": self.node_registry_version,
        }
        if self.viewport is not None:
            snapshot["viewport"] = dict(self.viewport)
        return snapshot

    def to_row_columns(self) -> dict[str, Any]:
        """Serialize to the snake_case ``chat_canvas_layouts`` content columns.

        Returns ONLY the content columns (nodes/edges/viewport/shared_state/
        node_registry_version); the tenancy columns (user_id/scope/
        conversation_id) are stamped by the writer from the job payload, never
        from here — so this serializer can never carry an identity.
        """
        return {
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [dict(edge) for edge in self.edges],
            "viewport": dict(self.viewport) if self.viewport is not None else None,
            "shared_state": dict(self.shared_state),
            "node_registry_version": self.node_registry_version,
        }
