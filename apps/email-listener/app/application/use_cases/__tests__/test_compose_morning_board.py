"""Tests for the deterministic morning-board composer (Phase 74, MORN-05).

MORN-05: the composed snapshot validates against the canvas snapshot shape (the
web's ``CanvasSnapshotSchema``, mirrored structurally here since it is a TS/Zod
schema) AND every node type it emits is a REAL registered type. The registered
type set is transcribed from apps/web/src/app/chat/_canvas/node-type-registry.ts
— any drift between the composer's emitted types and that allowlist fails here.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

from app.application.use_cases.compose_morning_board import (
    HOME_REGISTRY_VERSION,
    compose_morning_board_snapshot,
)

# The registered canvas node types — transcribed verbatim from
# apps/web/src/app/chat/_canvas/node-type-registry.ts NODE_TYPE_REGISTRY keys.
# The web restore degrades an UNknown type to a placeholder (never blanks), but
# the composer must still only emit real types (MORN-05).
_REGISTERED_NODE_TYPES = frozenset(
    {
        "chat",
        "genui-panel",
        "knowledge-preview",
        "email-thread",
        "document",
        "source",
        "directory",
        "browser",
        "editor",
        "desktop",
        "circle-pack",
        "spreadsheet",
        "file",
        "entity",
        "knowledge-search",
        "review-queue",
        "rule-suggestions",
        "pipeline-health",
        "brief",
        "usage",
        "documents",
        "references",
        "search-all",
        "conversations",
    }
)

# The starter set the MVP composer is contracted to place.
_EXPECTED_STARTER_TYPES = ("brief", "review-queue", "usage")


def _assert_valid_snapshot_shape(snapshot: dict[str, Any]) -> None:
    """Structural mirror of CanvasSnapshotSchema (canvas-schema.ts).

    Enforces the load-bearing constraints the Zod schema enforces so a shape the
    web would reject fails HERE: strict node keys, position {x,y} numbers,
    data an object without spec/root/proto keys, edges/sharedState present, and a
    non-empty string nodeRegistryVersion.
    """
    assert set(snapshot.keys()) <= {
        "nodes",
        "edges",
        "viewport",
        "sharedState",
        "nodeRegistryVersion",
    }, "snapshot has an unexpected top-level key (schema is .strict())"
    assert {"nodes", "edges", "sharedState", "nodeRegistryVersion"} <= set(snapshot.keys())

    assert isinstance(snapshot["nodes"], list)
    assert isinstance(snapshot["edges"], list)
    assert isinstance(snapshot["sharedState"], dict)
    assert isinstance(snapshot["nodeRegistryVersion"], str)
    assert len(snapshot["nodeRegistryVersion"]) >= 1  # z.string().min(1)

    seen_ids: set[str] = set()
    for node in snapshot["nodes"]:
        assert set(node.keys()) <= {"id", "type", "position", "width", "height", "data"}, (
            "node has an unexpected key (canvasNodeSchema is .strict())"
        )
        assert {"id", "type", "position", "data"} <= set(node.keys())
        assert isinstance(node["id"], str)
        assert node["id"]  # z.string().min(1)
        assert isinstance(node["type"], str)
        assert node["type"]  # z.string().min(1)
        assert node["id"] not in seen_ids, "duplicate node id"
        seen_ids.add(node["id"])

        pos = node["position"]
        assert set(pos.keys()) == {"x", "y"}
        assert isinstance(pos["x"], (int, float))
        assert isinstance(pos["y"], (int, float))

        data = node["data"]
        assert isinstance(data, dict)
        assert "spec" not in data  # D-05
        assert "root" not in data  # D-05
        for forbidden in ("__proto__", "constructor", "prototype"):
            assert forbidden not in data


def test_composer_output_validates_against_snapshot_shape() -> None:
    snapshot = compose_morning_board_snapshot().to_snapshot_dict()
    _assert_valid_snapshot_shape(snapshot)
    assert snapshot["nodeRegistryVersion"] == HOME_REGISTRY_VERSION == "home-v1"
    assert snapshot["edges"] == []  # MVP: no edges


def test_composer_emits_only_registered_node_types() -> None:
    snapshot = compose_morning_board_snapshot().to_snapshot_dict()
    emitted = [node["type"] for node in snapshot["nodes"]]

    assert emitted == list(_EXPECTED_STARTER_TYPES)
    for node_type in emitted:
        assert node_type in _REGISTERED_NODE_TYPES, (
            f"composer emitted unregistered node type {node_type!r} "
            f"(not in node-type-registry.ts)"
        )


def test_composer_nodes_do_not_overlap() -> None:
    """The hardcoded grid must be non-overlapping (a calm, readable board)."""
    nodes = compose_morning_board_snapshot().nodes
    assert len(nodes) == 3
    # Single row: x intervals [x, x+width) must be pairwise disjoint.
    intervals = sorted((n.position_x, n.position_x + (n.width or 0.0)) for n in nodes)
    for (_, prev_end), (next_start, _) in pairwise(intervals):
        assert next_start >= prev_end, "starter nodes overlap horizontally"


def test_composer_is_deterministic() -> None:
    """Same output every call — a nightly re-run overwrites the same nodes (LWW)."""
    first = compose_morning_board_snapshot().to_snapshot_dict()
    second = compose_morning_board_snapshot().to_snapshot_dict()
    assert first == second
