"""The canvas emitters' per-field filter coverage, and the document that claims it (W13-1).

WHY THIS FILE EXISTS. `docs/INJECTION-SURFACE-AUDIT.md` has now shipped a FALSE
completeness claim about these four builders in three consecutive revisions:

    W9-1  -- "the sweep is complete" (it had missed `emit_canvas_recipe` entirely)
    W11-1 -- "all four canvas builders now filter, on both key and value positions"
             (`nodeType`/`handle` carried only isinstance+non-empty)
    W12-1 -- "all four canvas builders filter EVERY model-authored field they carry"
             (`inputs.<k>.kind` and the recipe `name` carried only isinstance+non-empty)

Each time the claim was refuted by ONE command against the committed tree, and each
time the fix was a rewritten sentence. Prose cannot be the thing that holds; so the
document's coverage table is now MACHINE-CHECKED against executed behaviour:

    test_derived_field_set_matches_the_declared_rows
        Executes each builder on a maximal payload and walks the PART it returns.
        A model-authored field that reaches a persisted part with no row in the
        table makes this fail -- the fifth field cannot be forgotten the way the
        first four were.
    test_declared_coverage_matches_executed_behaviour
        Runs one hostile probe per row and asserts the exact outcome the row
        claims. Rows that claim NO filter are probed too, so "not filtered" is a
        proven statement rather than an unexamined one -- and adding a filter
        without updating the table goes red just as loudly as removing one.
    test_declared_bounds_match_the_module_constants
        The Bound cell's numbers must be the live constants' values.
    test_every_citation_points_at_the_line_it_names
        `L<n> -- <snippet>` must be line n of the module, inside the function the
        row names. Line drift goes red, so a citation cannot rot into fiction.
    test_document_table_matches_the_declared_coverage
        The markdown table between the CANVAS-FIELD-COVERAGE markers must equal
        these rows cell-for-cell, in order.

Together: the document can only say what the code does. NOTE the honest limit --
`.github/workflows/ci-email-listener.yml` is path-filtered to
`apps/email-listener/**`, so a docs-ONLY edit does not trigger CI. This suite gates
every change to the emitters (and every local `uv run pytest`), which is where the
divergence has actually come from all three times, but it is not a gate on the
document in isolation.
"""

from __future__ import annotations

import ast
import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from app.application.use_cases import run_chat_turn_tool_loop
from app.application.use_cases.run_chat_turn_tool_loop import build_canvas_part

_MODULE_PATH = Path(__file__).resolve().parents[2] / "app" / "application" / "use_cases" / "run_chat_turn_tool_loop.py"
_DOC_PATH = Path(__file__).resolve().parents[4] / "docs" / "INJECTION-SURFACE-AUDIT.md"
_DOC_BEGIN = "<!-- CANVAS-FIELD-COVERAGE:BEGIN -->"
_DOC_END = "<!-- CANVAS-FIELD-COVERAGE:END -->"

# The literal map key used wherever a builder keys a map on a MODEL-AUTHORED
# string. Chosen to read as the `<k>` wildcard the table prints, so a derived path
# and a documented path are the same string with no translation step between them.
_K = "<k>"


# ---------------------------------------------------------------------------
# The declared coverage table (mirrored verbatim in the document)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Row:
    """One (field, guard) pair: what the table says, and the probe that proves it."""

    tool: str
    #: Part-relative path. `<k>` is a model-authored map key; `[]` is a list element.
    path: str
    #: Exact "Content filter" cell.
    content_filter: str
    #: Exact "Bound" cell.
    bound: str
    #: Line number + source snippet the "Enforcing line" cell cites.
    line: int
    snippet: str
    #: The module function the cited line must sit inside.
    function: str
    #: The hostile value the probe injects at `path`.
    probe: Any
    #: part-is-none | entry-gone | element-gone | field-gone | verbatim | literal
    expect: str
    #: "value" (probe the value) or "key" (probe the map key itself).
    position: str = "value"
    #: Module constants whose values must appear in `bound`.
    bound_consts: tuple[str, ...] = field(default_factory=tuple)


_NODE = "emit_canvas_node"
_CONNECT = "emit_canvas_connect"
_ISLAND = "emit_code_island"
_RECIPE = "emit_canvas_recipe"

_SERVER_AUTHORED = "n/a -- server-authored literal"
_NO_FILTER = "NONE"
_NO_BOUND = "--"

_ROWS: tuple[_Row, ...] = (
    # ---- emit_canvas_node -> canvas_add_node --------------------------------
    _Row(
        tool=_NODE,
        path="type",
        content_filter=_SERVER_AUTHORED,
        bound=_NO_BOUND,
        line=406,
        snippet='"type": "canvas_add_node"',
        function="_build_canvas_add_node_part",
        probe="__proto__",
        expect="literal",
    ),
    _Row(
        tool=_NODE,
        path="handle",
        content_filter="refuses part -- pollution key",
        bound=_NO_BOUND,
        line=392,
        snippet="handle in _FORBIDDEN_MANIFEST_KEYS",
        function="_build_canvas_add_node_part",
        probe="__proto__",
        expect="part-is-none",
    ),
    _Row(
        tool=_NODE,
        path="nodeType",
        content_filter="refuses part -- unsafe object index",
        bound=_NO_BOUND,
        line=394,
        snippet="_is_unsafe_object_index_value(node_type)",
        function="_build_canvas_add_node_part",
        probe="toString",
        expect="part-is-none",
    ),
    _Row(
        tool=_NODE,
        path="data",
        content_filter="refuses part -- spec/root at top level",
        bound=_NO_BOUND,
        line=352,
        snippet="key in data for key in _CANVAS_NODE_DATA_RESERVED_KEYS",
        function="_is_refused_canvas_node_data",
        probe={"spec": {"root": 1}},
        expect="part-is-none",
    ),
    _Row(
        tool=_NODE,
        path="data",
        content_filter="refuses part -- pollution key at any depth",
        bound="depth <= 12",
        bound_consts=("_CANVAS_DATA_MAX_DEPTH",),
        line=354,
        snippet="return _has_forbidden_key_deep(data)",
        function="_is_refused_canvas_node_data",
        probe={"a": {"b": {"__proto__": 1}}},
        expect="part-is-none",
    ),
    _Row(
        tool=_NODE,
        path="position",
        content_filter="refuses part -- pollution key at any depth",
        bound="depth <= 12",
        bound_consts=("_CANVAS_DATA_MAX_DEPTH",),
        line=412,
        snippet="if _has_forbidden_key_deep(position):",
        function="_build_canvas_add_node_part",
        probe={"x": {"constructor": 1}},
        expect="part-is-none",
    ),
    # ---- emit_canvas_connect -> canvas_connect -------------------------------
    _Row(
        tool=_CONNECT,
        path="type",
        content_filter=_SERVER_AUTHORED,
        bound=_NO_BOUND,
        line=431,
        snippet='"type": "canvas_connect"',
        function="_build_canvas_connect_part",
        probe="__proto__",
        expect="literal",
    ),
    _Row(
        tool=_CONNECT,
        path="sourceHandle",
        content_filter="refuses part -- pollution key",
        bound=_NO_BOUND,
        line=437,
        snippet='part["sourceHandle"] in _FORBIDDEN_MANIFEST_KEYS',
        function="_build_canvas_connect_part",
        probe="__proto__",
        expect="part-is-none",
    ),
    _Row(
        tool=_CONNECT,
        path="targetHandle",
        content_filter="refuses part -- pollution key",
        bound=_NO_BOUND,
        line=437,
        snippet='part["targetHandle"] in _FORBIDDEN_MANIFEST_KEYS',
        function="_build_canvas_connect_part",
        probe="constructor",
        expect="part-is-none",
    ),
    _Row(
        tool=_CONNECT,
        path="sourcePath",
        content_filter="refuses part -- pollution segment",
        bound=_NO_BOUND,
        line=439,
        snippet='_has_forbidden_path_segment(part["sourcePath"])',
        function="_build_canvas_connect_part",
        probe="data.__proto__.rows",
        expect="part-is-none",
    ),
    _Row(
        tool=_CONNECT,
        path="targetKey",
        content_filter="refuses part -- pollution segment",
        bound=_NO_BOUND,
        line=439,
        snippet='_has_forbidden_path_segment(part["targetKey"])',
        function="_build_canvas_connect_part",
        probe="prototype",
        expect="part-is-none",
    ),
    # ---- emit_code_island -> canvas_code_island ------------------------------
    _Row(
        tool=_ISLAND,
        path="type",
        content_filter=_SERVER_AUTHORED,
        bound=_NO_BOUND,
        line=596,
        snippet='"type": "canvas_code_island"',
        function="_build_canvas_code_island_part",
        probe="__proto__",
        expect="literal",
    ),
    _Row(
        tool=_ISLAND,
        path="intent",
        content_filter=_NO_FILTER,
        bound="<= 4096 chars",
        bound_consts=("_CODE_ISLAND_MAX_INTENT_CHARS",),
        line=583,
        snippet="intent = intent[:_CODE_ISLAND_MAX_INTENT_CHARS].rstrip()",
        function="_build_canvas_code_island_part",
        probe="__proto__",
        expect="verbatim",
    ),
    _Row(
        tool=_ISLAND,
        path="selectedNodeKeys",
        content_filter="refuses part -- empty survivor set",
        bound="<= 32 keys",
        bound_consts=("_CODE_ISLAND_MAX_SELECTED",),
        line=587,
        snippet="if not selected:",
        function="_build_canvas_code_island_part",
        probe=["__proto__", "constructor"],
        expect="part-is-none",
    ),
    _Row(
        tool=_ISLAND,
        path="selectedNodeKeys[]",
        content_filter="drops element -- pollution key",
        bound=_NO_BOUND,
        line=451,
        snippet="item in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_key_list",
        probe="__proto__",
        expect="element-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputBindings",
        content_filter="refuses part -- empty survivor set",
        bound="<= 16 entries",
        bound_consts=("_CODE_ISLAND_MAX_INPUTS",),
        line=590,
        snippet="if not bindings:",
        function="_build_canvas_code_island_part",
        probe={"__proto__": {"sourceNodeKey": "n1", "sourcePath": "data.rows"}},
        expect="part-is-none",
    ),
    _Row(
        tool=_ISLAND,
        path="inputBindings.<k>",
        position="key",
        content_filter="drops entry -- pollution key",
        bound=_NO_BOUND,
        line=476,
        snippet="target_key in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_input_bindings",
        probe="__proto__",
        expect="entry-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputBindings.<k>.sourceNodeKey",
        content_filter="drops entry -- pollution key",
        bound=_NO_BOUND,
        line=484,
        snippet="if source_node_key in _FORBIDDEN_MANIFEST_KEYS:",
        function="_clean_input_bindings",
        probe="__proto__",
        expect="entry-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputBindings.<k>.sourcePath",
        content_filter="drops entry -- pollution segment",
        bound=_NO_BOUND,
        line=488,
        snippet="if _has_forbidden_path_segment(source_path):",
        function="_clean_input_bindings",
        probe="data.__proto__.rows",
        expect="entry-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs",
        content_filter="refuses part -- empty survivor set",
        bound="<= 16 entries",
        bound_consts=("_CODE_ISLAND_MAX_INPUTS",),
        line=593,
        snippet="if not inputs:",
        function="_build_canvas_code_island_part",
        probe={"__proto__": {"kind": "table"}},
        expect="part-is-none",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>",
        position="key",
        content_filter="drops entry -- pollution key",
        bound=_NO_BOUND,
        line=550,
        snippet="target_key in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_inputs_manifest",
        probe="__proto__",
        expect="entry-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.kind",
        content_filter="drops entry -- pollution key",
        bound=_NO_BOUND,
        line=528,
        snippet="kind in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_manifest_entry",
        probe="__proto__",
        expect="entry-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.columns",
        content_filter="omits field -- non-list",
        bound="<= 64 keys",
        bound_consts=("_CODE_ISLAND_MAX_COLUMNS",),
        line=532,
        snippet="if isinstance(columns, list):",
        function="_clean_manifest_entry",
        probe="__proto__",
        expect="field-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.columns[]",
        content_filter="drops element -- pollution key",
        bound=_NO_BOUND,
        line=533,
        snippet='cleaned["columns"] = _clean_key_list(columns, _CODE_ISLAND_MAX_COLUMNS)',
        function="_clean_manifest_entry",
        probe="__proto__",
        expect="element-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.rowCount",
        content_filter="omits field -- non-int, bool, or negative",
        bound=_NO_BOUND,
        line=536,
        snippet="isinstance(row_count, int) and not isinstance(row_count, bool) and row_count >= 0",
        function="_clean_manifest_entry",
        probe=True,
        expect="field-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.sample",
        content_filter="omits field -- non-list",
        bound="<= 5 rows",
        bound_consts=("_CODE_ISLAND_MAX_SAMPLE_ROWS",),
        line=539,
        snippet="if isinstance(sample, list):",
        function="_clean_manifest_entry",
        probe="__proto__",
        expect="field-gone",
    ),
    _Row(
        tool=_ISLAND,
        path="inputs.<k>.sample[]",
        content_filter="drops element -- pollution key at any depth",
        bound="depth <= 12",
        bound_consts=("_CANVAS_DATA_MAX_DEPTH",),
        line=540,
        snippet="row for row in sample if not _has_forbidden_key_deep(row)",
        function="_clean_manifest_entry",
        probe={"a": {"__proto__": 1}},
        expect="element-gone",
    ),
    # ---- emit_canvas_recipe -> canvas_recipe ---------------------------------
    _Row(
        tool=_RECIPE,
        path="type",
        content_filter=_SERVER_AUTHORED,
        bound=_NO_BOUND,
        line=641,
        snippet='"type": "canvas_recipe"',
        function="_build_canvas_recipe_part",
        probe="__proto__",
        expect="literal",
    ),
    _Row(
        tool=_RECIPE,
        path="name",
        content_filter="refuses part -- pollution key (checked after strip/cap)",
        bound="<= 120 chars",
        bound_consts=("_CANVAS_RECIPE_MAX_NAME_CHARS",),
        line=634,
        snippet="if not name or name in _FORBIDDEN_MANIFEST_KEYS:",
        function="_build_canvas_recipe_part",
        probe="   __proto__   ",
        expect="part-is-none",
    ),
    _Row(
        tool=_RECIPE,
        path="nodeKeys",
        content_filter="refuses part -- empty survivor set",
        bound="<= 32 keys",
        bound_consts=("_CANVAS_RECIPE_MAX_NODE_KEYS",),
        line=637,
        snippet="if not node_keys:",
        function="_build_canvas_recipe_part",
        probe=["__proto__", ""],
        expect="part-is-none",
    ),
    _Row(
        tool=_RECIPE,
        path="nodeKeys[]",
        content_filter="drops element -- pollution key",
        bound=_NO_BOUND,
        line=451,
        snippet="item in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_key_list",
        probe="constructor",
        expect="element-gone",
    ),
    _Row(
        tool=_RECIPE,
        path="edgeKeys",
        content_filter=_NO_FILTER,
        bound="<= 64 keys",
        bound_consts=("_CANVAS_RECIPE_MAX_EDGE_KEYS",),
        line=639,
        snippet='edge_keys = _clean_key_list(raw.get("edgeKeys"), _CANVAS_RECIPE_MAX_EDGE_KEYS)',
        function="_build_canvas_recipe_part",
        probe=[],
        expect="verbatim",
    ),
    _Row(
        tool=_RECIPE,
        path="edgeKeys[]",
        content_filter="drops element -- pollution key",
        bound=_NO_BOUND,
        line=451,
        snippet="item in _FORBIDDEN_MANIFEST_KEYS",
        function="_clean_key_list",
        probe="prototype",
        expect="element-gone",
    ),
    _Row(
        tool=_RECIPE,
        path="sourceRef",
        content_filter="omits field -- pollution key at any depth",
        bound="<= 2048 serialized chars, depth <= 12",
        bound_consts=("_CANVAS_RECIPE_MAX_SOURCE_REF_CHARS", "_CANVAS_DATA_MAX_DEPTH"),
        line=649,
        snippet="and not _has_forbidden_key_deep(source_ref)",
        function="_build_canvas_recipe_part",
        probe={"meta": {"__proto__": 1}},
        expect="field-gone",
    ),
)


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------

# MAXIMAL: every optional field present, exactly ONE model-authored map key and
# ONE list element, so walking the emitted part yields each documented path once.
_MAXIMAL: dict[str, dict[str, Any]] = {
    _NODE: {"handle": "h1", "nodeType": "spreadsheet", "data": {"ok": 1}, "position": {"x": 1, "y": 2}},
    _CONNECT: {"sourceHandle": "h1", "targetHandle": "h2", "sourcePath": "data.rows", "targetKey": "rows"},
    _ISLAND: {
        "intent": "chart the rows",
        "selectedNodeKeys": ["n1"],
        "inputBindings": {_K: {"sourceNodeKey": "n1", "sourcePath": "data.rows"}},
        "inputs": {_K: {"kind": "table", "columns": ["c1"], "rowCount": 3, "sample": [{"c1": 1}]}},
    },
    _RECIPE: {"name": "Weekly digest", "nodeKeys": ["n1"], "edgeKeys": ["e1"], "sourceRef": {"kind": "thread"}},
}

# PROBE BASE: the maximal payload plus a CLEAN sibling in every map and list, so
# "the entry/element was dropped" is distinguishable from "the whole part died".
_PROBE_BASE: dict[str, dict[str, Any]] = {
    _NODE: copy.deepcopy(_MAXIMAL[_NODE]),
    _CONNECT: copy.deepcopy(_MAXIMAL[_CONNECT]),
    _ISLAND: {
        "intent": "chart the rows",
        "selectedNodeKeys": ["n1", "n2"],
        "inputBindings": {
            _K: {"sourceNodeKey": "n1", "sourcePath": "data.rows"},
            "keep": {"sourceNodeKey": "n2", "sourcePath": "data.cols"},
        },
        "inputs": {
            _K: {"kind": "table", "columns": ["c1", "c1b"], "rowCount": 3, "sample": [{"c1": 1}, {"c1b": 2}]},
            "keep": {"kind": "table", "columns": ["c2"], "rowCount": 1, "sample": [{"c2": 2}]},
        },
    },
    _RECIPE: {
        "name": "Weekly digest",
        "nodeKeys": ["n1", "n2"],
        "edgeKeys": ["e1", "e2"],
        "sourceRef": {"kind": "thread"},
    },
}

# The clean sibling that must SURVIVE whenever a row claims a drop rather than a
# refusal — keyed the same way in every map/list of the probe base.
_SURVIVORS: dict[str, Any] = {
    "selectedNodeKeys": "n2",
    "inputs.<k>.columns": "c1b",
    "inputs.<k>.sample": {"c1b": 2},
    "nodeKeys": "n2",
    "edgeKeys": "e2",
}

# Paths whose value is an OPAQUE model-authored subtree: the guard walks it deeply
# and the table describes the whole subtree in one row, so the path walker stops
# here instead of enumerating attacker-chosen inner keys.
_OPAQUE_SUBTREES = frozenset({"data", "position", "sourceRef", "inputs.<k>.sample[]"})

_PART_TYPE_BY_TOOL = {
    _NODE: "canvas_add_node",
    _CONNECT: "canvas_connect",
    _ISLAND: "canvas_code_island",
    _RECIPE: "canvas_recipe",
}


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def _derive_paths(value: Any, path: str) -> set[str]:
    """Every field path present in an emitted part, stopping at opaque subtrees."""
    found: set[str] = set()
    if path:
        found.add(path)
    if path in _OPAQUE_SUBTREES:
        return found
    if isinstance(value, dict):
        for key, item in value.items():
            found |= _derive_paths(item, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for item in value:
            found |= _derive_paths(item, f"{path}[]")
    return found


def _get_at(value: Any, path: str) -> Any:
    """Resolve a dotted part path (no `[]` segments); `""` is the part itself."""
    cursor = value
    if path:
        for segment in path.split("."):
            cursor = cursor[segment]
    return cursor


def _set_at(payload: dict[str, Any], path: str, value: Any) -> dict[str, Any]:
    """A COPY of `payload` with `path` set to `value`; `seg[]` replaces element 0."""
    out = copy.deepcopy(payload)
    cursor: Any = out
    segments = path.split(".")
    for index, segment in enumerate(segments):
        last = index == len(segments) - 1
        if segment.endswith("[]"):
            key = segment[:-2]
            if last:
                cursor[key] = [value, *cursor[key][1:]]
                return out
            cursor = cursor[key][0]
        elif last:
            cursor[segment] = value
        else:
            cursor = cursor[segment]
    return out


def _rename_key(payload: dict[str, Any], container_path: str, old: str, new: str) -> dict[str, Any]:
    """A COPY of `payload` with the map at `container_path` re-keyed `old` -> `new`."""
    out = copy.deepcopy(payload)
    container = _get_at(out, container_path)
    container[new] = container.pop(old)
    return out


def _probe_payload(row: _Row) -> dict[str, Any]:
    base = _PROBE_BASE[row.tool]
    if row.position == "key":
        container_path, _, leaf = row.path.rpartition(".")
        return _rename_key(base, container_path, leaf, row.probe)
    return _set_at(base, row.path, row.probe)


# ---------------------------------------------------------------------------
# Source + document readers
# ---------------------------------------------------------------------------


def _module_lines() -> list[str]:
    return _MODULE_PATH.read_text(encoding="utf-8").splitlines()


def _function_spans() -> dict[str, tuple[int, int]]:
    tree = ast.parse(_MODULE_PATH.read_text(encoding="utf-8"))
    spans: dict[str, tuple[int, int]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            spans[node.name] = (node.lineno, node.end_lineno or node.lineno)
    return spans


def _module_constant(name: str) -> Any:
    return getattr(run_chat_turn_tool_loop, name)


def _doc_cells(row: _Row) -> tuple[str, ...]:
    return (
        f"`{row.tool}`",
        f"`{row.path}`",
        row.content_filter,
        row.bound,
        f"L{row.line} -- `{row.snippet}`",
    )


def _doc_table_rows() -> list[tuple[str, ...]]:
    text = _DOC_PATH.read_text(encoding="utf-8")
    start = text.index(_DOC_BEGIN) + len(_DOC_BEGIN)
    block = text[start : text.index(_DOC_END)]
    rows: list[tuple[str, ...]] = []
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line.startswith("|"):
            continue
        cells = tuple(cell.strip() for cell in line.strip("|").split("|"))
        if cells[0] == "Tool" or set(cells[0]) <= {"-", ":"}:
            continue
        rows.append(cells)
    return rows


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("tool", sorted(_MAXIMAL))
def test_derived_field_set_matches_the_declared_rows(tool: str) -> None:
    """Execute the builder, walk the PART, and require a documented row per field.

    This is the forcing function the three false completeness claims lacked: a
    fifth model-authored field reaching a persisted part has no row here, and this
    fails until someone writes one.
    """
    part = build_canvas_part(tool, json.dumps(_MAXIMAL[tool]))
    assert part is not None, f"{tool}: the maximal payload must build a part"
    derived = _derive_paths(part, "")
    declared = {row.path for row in _ROWS if row.tool == tool}
    assert derived == declared, (
        f"{tool}: the emitted part's fields and the coverage table disagree.\n"
        f"  carried but undocumented: {sorted(derived - declared)}\n"
        f"  documented but not carried: {sorted(declared - derived)}"
    )


@pytest.mark.unit
@pytest.mark.parametrize("row", _ROWS, ids=lambda row: f"{row.tool}:{row.path}:{row.expect}")
def test_declared_coverage_matches_executed_behaviour(row: _Row) -> None:
    """Run the row's hostile probe and assert exactly the outcome the row claims."""
    part = build_canvas_part(row.tool, json.dumps(_probe_payload(row)))
    if row.expect == "part-is-none":
        assert part is None, f"{row.tool}.{row.path}: {row.content_filter!r} claimed, but the part built"
        return
    assert part is not None, f"{row.tool}.{row.path}: the part must survive for a {row.expect!r} row"
    _assert_survivor_outcome(row, part)


def _assert_survivor_outcome(row: _Row, part: dict[str, Any]) -> None:
    """The non-refusal expectations, split out to keep each branch readable."""
    if row.expect == "literal":
        assert part["type"] == _PART_TYPE_BY_TOOL[row.tool]
        return
    if row.expect == "verbatim":
        assert _get_at(part, row.path) == row.probe, (
            f"{row.tool}.{row.path}: documented as {row.content_filter!r}, but the value was changed"
        )
        return
    if row.expect == "entry-gone":
        container_path = row.path.split(".<k>")[0]
        container = _get_at(part, container_path)
        gone = row.probe if row.position == "key" else _K
        assert gone not in container, f"{row.tool}.{row.path}: the polluted entry survived in {container_path}"
        assert "keep" in container, f"{row.tool}.{row.path}: the CLEAN sibling entry was dropped too"
        return
    if row.expect == "element-gone":
        container_path = row.path[: -len("[]")]
        elements = _get_at(part, container_path)
        assert row.probe not in elements, f"{row.tool}.{row.path}: the polluted element survived"
        assert _SURVIVORS[container_path] in elements, f"{row.tool}.{row.path}: the CLEAN element was dropped too"
        return
    assert row.expect == "field-gone", f"unknown expectation {row.expect!r}"
    parent_path, _, leaf = row.path.rpartition(".")
    parent = _get_at(part, parent_path)
    assert leaf not in parent, f"{row.tool}.{row.path}: the field survived a non-conforming value"


@pytest.mark.unit
@pytest.mark.parametrize("row", _ROWS, ids=lambda row: f"{row.tool}:{row.path}:L{row.line}")
def test_declared_bounds_match_the_module_constants(row: _Row) -> None:
    """Every number in a Bound cell must be a live constant's value, not a memory."""
    numbers = {int(match) for match in re.findall(r"\d+", row.bound)}
    if not row.bound_consts:
        assert not numbers, f"{row.tool}.{row.path}: bound {row.bound!r} states a number with no constant behind it"
        return
    for name in row.bound_consts:
        value = _module_constant(name)
        assert value in numbers, f"{row.tool}.{row.path}: {name}={value} is not stated in the bound cell {row.bound!r}"
    assert numbers == {_module_constant(name) for name in row.bound_consts}


@pytest.mark.unit
@pytest.mark.parametrize("row", _ROWS, ids=lambda row: f"{row.tool}:{row.path}:L{row.line}")
def test_every_citation_points_at_the_line_it_names(row: _Row) -> None:
    """`L<n> -- <snippet>` must BE line n, inside the function the row names."""
    lines = _module_lines()
    assert 1 <= row.line <= len(lines), f"{row.tool}.{row.path}: cited line {row.line} is past end of module"
    source_line = lines[row.line - 1]
    assert row.snippet in source_line, (
        f"{row.tool}.{row.path}: L{row.line} is {source_line.strip()!r}, which does not contain {row.snippet!r}"
    )
    assert not source_line.lstrip().startswith("#"), f"{row.tool}.{row.path}: L{row.line} is a comment, not a guard"
    start, end = _function_spans()[row.function]
    assert start <= row.line <= end, (
        f"{row.tool}.{row.path}: L{row.line} is outside {row.function} (lines {start}-{end})"
    )


@pytest.mark.unit
def test_document_table_matches_the_declared_coverage() -> None:
    """The audit document's coverage table must equal these rows, cell for cell.

    The document cannot drift from the code because this test reads both.
    """
    assert _DOC_PATH.is_file(), f"the audit document is missing at {_DOC_PATH}"
    assert _doc_table_rows() == [_doc_cells(row) for row in _ROWS]


@pytest.mark.unit
def test_every_canvas_builder_appears_in_the_coverage_table() -> None:
    """A FIFTH emit tool cannot be added without its own rows.

    Findings B/C/D/E were each "the sweep forgot a field"; W9-1's was "the sweep
    forgot a whole builder" (`emit_canvas_recipe`). The other tests here enumerate
    the fields of the tools named in `_ROWS` — this one enumerates the tools
    themselves, straight off the live dispatch table, so neither omission has a
    quiet path back in.
    """
    dispatched = set(run_chat_turn_tool_loop._CANVAS_PART_BUILDERS)
    declared = {row.tool for row in _ROWS}
    assert dispatched == declared, (
        "the coverage table and the builder dispatch table disagree.\n"
        f"  dispatched but undocumented: {sorted(dispatched - declared)}\n"
        f"  documented but not dispatched: {sorted(declared - dispatched)}"
    )
    assert dispatched == set(run_chat_turn_tool_loop.CANVAS_EMIT_TOOL_NAMES)


@pytest.mark.unit
def test_every_row_states_a_filter_or_says_there_is_none() -> None:
    """No row may be blank or hedged — the vocabulary is closed and exhaustive."""
    allowed_prefixes = ("refuses part -- ", "drops entry -- ", "drops element -- ", "omits field -- ")
    for row in _ROWS:
        assert row.content_filter in {_NO_FILTER, _SERVER_AUTHORED} or row.content_filter.startswith(
            allowed_prefixes
        ), f"{row.tool}.{row.path}: {row.content_filter!r} is not one of the declared coverage classes"
