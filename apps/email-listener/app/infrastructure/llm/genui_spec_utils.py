"""genui_spec_utils.py — Shared spec-tree utilities used by the generator adapter and eval rubric.

These functions were previously private to genui_generator_adapter (underscore-prefixed).
Promoting them to a public shared module (WR-02) removes the cross-module private-symbol
import from rubric.py and gives both callers a stable public contract.

Named exports: count_nodes, validate_spec
"""

from __future__ import annotations

from typing import Any

import jsonschema

from app.infrastructure.llm.genui_artifacts import load_spec_schema

# ---------------------------------------------------------------------------
# Bounds constants (D-20) — shared with the adapter
# ---------------------------------------------------------------------------

MAX_SPEC_NODES: int = 200
MAX_SPEC_DEPTH: int = 8


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def count_nodes(node: Any, depth: int = 0) -> tuple[int, int]:
    """Recursively count nodes and max depth in a spec node tree.

    Args:
        node: A spec node dict (or any value — non-dicts return (0, depth)).
        depth: Current recursion depth (root node = 0).

    Returns:
        (total_nodes, max_depth) tuple.
    """
    if not isinstance(node, dict):
        return (0, depth)

    total = 1
    max_d = depth

    for key, value in node.items():
        if key == "children" and isinstance(value, list):
            for child in value:
                child_count, child_depth = count_nodes(child, depth + 1)
                total += child_count
                max_d = max(max_d, child_depth)
        elif isinstance(value, dict):
            child_count, child_depth = count_nodes(value, depth + 1)
            total += child_count
            max_d = max(max_d, child_depth)

    return (total, max_d)


def validate_spec(candidate: dict[str, Any]) -> str | None:
    """Validate candidate against the spec JSON schema and node-count/depth bounds.

    Args:
        candidate: A SpecRoot dict to validate.

    Returns:
        None if valid; an error string describing the first violation otherwise.
    """
    spec_schema = load_spec_schema()
    validator = jsonschema.Draft7Validator(spec_schema)
    errors = list(validator.iter_errors(candidate))
    if errors:
        return str(errors[0].message)

    root_node = candidate.get("root")
    if root_node is not None:
        node_count, node_depth = count_nodes(root_node)
        if node_count > MAX_SPEC_NODES:
            return f"Spec exceeds MAX_SPEC_NODES={MAX_SPEC_NODES} (found {node_count} nodes)"
        if node_depth > MAX_SPEC_DEPTH:
            return f"Spec exceeds MAX_SPEC_DEPTH={MAX_SPEC_DEPTH} (found depth {node_depth})"

    return None


__all__ = ["MAX_SPEC_DEPTH", "MAX_SPEC_NODES", "count_nodes", "validate_spec"]
