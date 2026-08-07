"""Tests for the pure mid-turn tool-loop helpers (Phase 34, LOOP-01)."""

from __future__ import annotations

import json

import pytest

from app.application.use_cases.run_chat_turn_tool_loop import (
    PARSE_FAILURE_TEXT,
    ROUND_CAP_EXHAUSTED_TEXT,
    build_canvas_part,
    build_synthetic_tool_result_message,
    build_tool_invocation_part,
    build_tool_invocation_result_part,
    cap_tool_output,
    classify_tool_dispatch,
)
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS, ToolExecutionResult

# ---------------------------------------------------------------------------
# Part builders
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_tool_invocation_part_shape() -> None:
    part = build_tool_invocation_part("lookup_entity", "tu_1", {"entity_id": "e1"})
    assert part == {
        "type": "tool_invocation",
        "toolUseId": "tu_1",
        "toolName": "lookup_entity",
        "arguments": {"entity_id": "e1"},
    }


@pytest.mark.unit
def test_build_tool_invocation_result_part_shape() -> None:
    result = ToolExecutionResult(tool_use_id="tu_1", content="hello", is_error=False)
    part = build_tool_invocation_result_part(result, "lookup_entity")
    assert part == {
        "type": "tool_invocation_result",
        "toolUseId": "tu_1",
        "toolName": "lookup_entity",
        "content": "hello",
        "isError": False,
    }


@pytest.mark.unit
def test_build_tool_invocation_result_part_carries_is_error() -> None:
    result = ToolExecutionResult(tool_use_id="tu_2", content="boom", is_error=True)
    part = build_tool_invocation_result_part(result, "search_emails")
    assert part["isError"] is True
    assert part["content"] == "boom"


# ---------------------------------------------------------------------------
# Synthetic tool_result content block
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_synthetic_tool_result_message_shape() -> None:
    result = ToolExecutionResult(tool_use_id="tu_3", content="the answer", is_error=False)
    message = build_synthetic_tool_result_message(result)
    assert message["role"] == "user"
    assert message["content"] == [
        {
            "type": "tool_result",
            "tool_use_id": "tu_3",
            "content": "the answer",
            "is_error": False,
        }
    ]


@pytest.mark.unit
def test_build_synthetic_tool_result_message_carries_error_flag() -> None:
    result = ToolExecutionResult(tool_use_id="tu_4", content="failed", is_error=True)
    message = build_synthetic_tool_result_message(result)
    block = message["content"][0]
    assert block["is_error"] is True
    assert block["tool_use_id"] == "tu_4"
    assert block["content"] == "failed"


# ---------------------------------------------------------------------------
# classify_tool_dispatch
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_classify_dispatch_emit_ui_spec() -> None:
    assert classify_tool_dispatch("emit_ui_spec", set()) == "emit_ui_spec"


@pytest.mark.unit
def test_classify_dispatch_widget() -> None:
    assert classify_tool_dispatch("emit_proposal_cards", set()) == "widget"
    assert classify_tool_dispatch("emit_clarify_widget", set()) == "widget"


@pytest.mark.unit
def test_classify_dispatch_server() -> None:
    assert classify_tool_dispatch("echo", {"echo"}) == "server"


@pytest.mark.unit
def test_classify_dispatch_unknown() -> None:
    assert classify_tool_dispatch("nope", set()) == "unknown"


@pytest.mark.unit
def test_classify_dispatch_canvas() -> None:
    """Phase 73/76-05: canvas emit tools route to the emit-a-part 'canvas' branch, never 'server'."""
    assert classify_tool_dispatch("emit_canvas_node", set()) == "canvas"
    assert classify_tool_dispatch("emit_canvas_connect", set()) == "canvas"
    assert classify_tool_dispatch("emit_code_island", set()) == "canvas"
    assert classify_tool_dispatch("emit_canvas_recipe", set()) == "canvas"


@pytest.mark.unit
def test_classify_dispatch_server_takes_precedence_over_widget() -> None:
    """A server_tool_names entry must win even if it collides with a widget/emit_ui_spec name."""
    assert classify_tool_dispatch("emit_proposal_cards", {"emit_proposal_cards"}) == "server"
    assert classify_tool_dispatch("emit_ui_spec", {"emit_ui_spec"}) == "server"


# ---------------------------------------------------------------------------
# build_canvas_part (Phase 73 Wave A — frozen wire contract)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_canvas_add_node_part_with_position() -> None:
    raw = '{"handle": "sheet", "nodeType": "spreadsheet", "data": {"rows": 3}, "position": {"x": 10, "y": 20}}'
    part = build_canvas_part("emit_canvas_node", raw)
    assert part == {
        "type": "canvas_add_node",
        "handle": "sheet",
        "nodeType": "spreadsheet",
        "data": {"rows": 3},
        "position": {"x": 10, "y": 20},
    }


@pytest.mark.unit
def test_build_canvas_add_node_part_omits_absent_position() -> None:
    """position is OPTIONAL — the key must be absent entirely when the model gives none."""
    part = build_canvas_part("emit_canvas_node", '{"handle": "tile", "nodeType": "document", "data": {}}')
    assert part == {"type": "canvas_add_node", "handle": "tile", "nodeType": "document", "data": {}}
    assert "position" not in part


@pytest.mark.unit
def test_build_canvas_connect_part_shape() -> None:
    raw = '{"sourceHandle": "sheet", "targetHandle": "tile", "sourcePath": "data", "targetKey": "input"}'
    part = build_canvas_part("emit_canvas_connect", raw)
    assert part == {
        "type": "canvas_connect",
        "sourceHandle": "sheet",
        "targetHandle": "tile",
        "sourcePath": "data",
        "targetKey": "input",
    }


@pytest.mark.unit
def test_build_canvas_part_fail_closed_on_bad_json() -> None:
    assert build_canvas_part("emit_canvas_node", "{not json") is None


@pytest.mark.unit
def test_build_canvas_part_fail_closed_on_missing_required_fields() -> None:
    # missing nodeType
    assert build_canvas_part("emit_canvas_node", '{"handle": "x", "data": {}}') is None
    # data not an object
    assert build_canvas_part("emit_canvas_node", '{"handle": "x", "nodeType": "chat", "data": "nope"}') is None
    # missing targetKey
    assert (
        build_canvas_part("emit_canvas_connect", '{"sourceHandle": "a", "targetHandle": "b", "sourcePath": "data"}')
        is None
    )


@pytest.mark.unit
def test_build_canvas_part_unknown_tool_name_returns_none() -> None:
    assert build_canvas_part("emit_ui_spec", '{"handle": "x", "nodeType": "chat", "data": {}}') is None


# ---------------------------------------------------------------------------
# W9-1 — prototype-pollution parity with the sibling builders + the TS boundary
#
# `_clean_key_list` / `_clean_input_bindings` (code-island) already filter
# _FORBIDDEN_MANIFEST_KEYS, and the tRPC persist boundary rejects the same keys
# at any depth (canvas-schema.ts `hasForbiddenKeyDeep`). `canvas_add_node`'s
# free-form `data` and `canvas_connect`'s dotted paths were the ONLY canvas-part
# fields with no such filter -- model-authored, and the model reads untrusted
# email / web-search content. These assert the emitter now fails closed too.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize("key", ["__proto__", "constructor", "prototype"])
def test_build_canvas_add_node_part_rejects_top_level_pollution_key(key: str) -> None:
    raw = json.dumps({"handle": "x", "nodeType": "chat", "data": {key: {"polluted": True}}})
    assert build_canvas_part("emit_canvas_node", raw) is None


@pytest.mark.unit
def test_build_canvas_add_node_part_rejects_nested_pollution_key() -> None:
    """The key is reachable at ANY depth, including inside a list."""
    nested = '{"handle": "x", "nodeType": "chat", "data": {"a": {"b": {"__proto__": {"z": 1}}}}}'
    assert build_canvas_part("emit_canvas_node", nested) is None

    in_list = '{"handle": "x", "nodeType": "chat", "data": {"rows": [{"ok": 1}, {"constructor": {}}]}}'
    assert build_canvas_part("emit_canvas_node", in_list) is None


@pytest.mark.unit
def test_build_canvas_add_node_part_rejects_pollution_key_in_position() -> None:
    raw = '{"handle": "x", "nodeType": "chat", "data": {}, "position": {"x": 1, "y": 2, "__proto__": {}}}'
    assert build_canvas_part("emit_canvas_node", raw) is None


@pytest.mark.unit
def test_build_canvas_add_node_part_rejects_data_nested_past_the_depth_cap() -> None:
    """An unbounded blob is refused rather than persisted verbatim into JSONB."""
    nested: dict[str, object] = {}
    for _ in range(40):
        nested = {"a": nested}
    raw = json.dumps({"handle": "x", "nodeType": "chat", "data": nested})
    assert build_canvas_part("emit_canvas_node", raw) is None


@pytest.mark.unit
def test_build_canvas_add_node_part_still_accepts_ordinary_nested_data() -> None:
    """Behaviour-preserving: a normal nested payload is unaffected."""
    raw = '{"handle": "sheet", "nodeType": "spreadsheet", "data": {"rows": [{"a": 1}], "meta": {"n": {"deep": 2}}}}'
    part = build_canvas_part("emit_canvas_node", raw)
    assert part == {
        "type": "canvas_add_node",
        "handle": "sheet",
        "nodeType": "spreadsheet",
        "data": {"rows": [{"a": 1}], "meta": {"n": {"deep": 2}}},
    }


@pytest.mark.unit
@pytest.mark.parametrize("field", ["sourcePath", "targetKey"])
def test_build_canvas_connect_part_rejects_a_pollution_path_segment(field: str) -> None:
    """Mirrors canvas-schema.ts `hasForbiddenPathSegment` on the emitting side."""
    fields = {"sourceHandle": "a", "targetHandle": "b", "sourcePath": "data", "targetKey": "input"}
    fields[field] = "data.__proto__.x"
    assert build_canvas_part("emit_canvas_connect", json.dumps(fields)) is None


@pytest.mark.unit
def test_build_canvas_connect_part_still_accepts_ordinary_dotted_paths() -> None:
    raw = '{"sourceHandle": "a", "targetHandle": "b", "sourcePath": "data.rows.0", "targetKey": "input"}'
    part = build_canvas_part("emit_canvas_connect", raw)
    assert part is not None
    assert part["sourcePath"] == "data.rows.0"


# ---------------------------------------------------------------------------
# build_canvas_part — canvas_code_island (Phase 76-05, BTAP-07 frozen contract)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_code_island_part_full_shape() -> None:
    raw = json.dumps(
        {
            "intent": "reconcile these invoices against the bank rows",
            "selectedNodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
            "inputBindings": {
                "invoices": {"sourceNodeKey": "spreadsheet:inv", "sourcePath": "published.inv"},
                "bank": {"sourceNodeKey": "spreadsheet:bank", "sourcePath": "published.bank"},
            },
            "inputs": {
                "invoices": {
                    "kind": "spreadsheet",
                    "columns": ["id", "vendor", "amount"],
                    "rowCount": 3,
                    "sample": [{"id": 1, "vendor": "Acme", "amount": 100}],
                },
                "bank": {"kind": "spreadsheet", "columns": ["date", "description", "amount"], "rowCount": 12},
            },
        }
    )
    part = build_canvas_part("emit_code_island", raw)
    assert part == {
        "type": "canvas_code_island",
        "intent": "reconcile these invoices against the bank rows",
        "inputs": {
            "invoices": {
                "kind": "spreadsheet",
                "columns": ["id", "vendor", "amount"],
                "rowCount": 3,
                "sample": [{"id": 1, "vendor": "Acme", "amount": 100}],
            },
            "bank": {"kind": "spreadsheet", "columns": ["date", "description", "amount"], "rowCount": 12},
        },
        "inputBindings": {
            "invoices": {"sourceNodeKey": "spreadsheet:inv", "sourcePath": "published.inv"},
            "bank": {"sourceNodeKey": "spreadsheet:bank", "sourcePath": "published.bank"},
        },
        "selectedNodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
    }


@pytest.mark.unit
def test_build_code_island_part_minimal_manifest_omits_optional_keys() -> None:
    """A manifest entry with only `kind` carries no columns/rowCount/sample keys."""
    raw = json.dumps(
        {
            "intent": "summarize",
            "selectedNodeKeys": ["n1"],
            "inputBindings": {"data": {"sourceNodeKey": "n1", "sourcePath": "published.n1"}},
            "inputs": {"data": {"kind": "document"}},
        }
    )
    part = build_canvas_part("emit_code_island", raw)
    assert part is not None
    assert part["inputs"] == {"data": {"kind": "document"}}


@pytest.mark.unit
def test_build_code_island_part_caps_columns_and_sample() -> None:
    raw = json.dumps(
        {
            "intent": "big table",
            "selectedNodeKeys": ["n1"],
            "inputBindings": {"t": {"sourceNodeKey": "n1", "sourcePath": "data"}},
            "inputs": {
                "t": {
                    "kind": "spreadsheet",
                    "columns": [f"c{i}" for i in range(200)],
                    "sample": [{"i": i} for i in range(50)],
                }
            },
        }
    )
    part = build_canvas_part("emit_code_island", raw)
    assert part is not None
    entry = part["inputs"]["t"]
    assert len(entry["columns"]) == 64  # MAX columns (mirrors table.ts MAX_TABLE_COLUMNS)
    assert len(entry["sample"]) == 5  # tiny sample cap


@pytest.mark.unit
def test_build_code_island_part_drops_pollution_keys() -> None:
    """Prototype-pollution targetKeys are stripped from bindings AND manifest."""
    raw = json.dumps(
        {
            "intent": "x",
            "selectedNodeKeys": ["n1", "__proto__"],
            "inputBindings": {
                "safe": {"sourceNodeKey": "n1", "sourcePath": "data"},
                "__proto__": {"sourceNodeKey": "n1", "sourcePath": "data"},
            },
            "inputs": {
                "safe": {"kind": "document"},
                "constructor": {"kind": "document"},
            },
        }
    )
    part = build_canvas_part("emit_code_island", raw)
    assert part is not None
    assert part["selectedNodeKeys"] == ["n1"]
    assert list(part["inputBindings"].keys()) == ["safe"]
    assert list(part["inputs"].keys()) == ["safe"]


@pytest.mark.unit
def test_build_code_island_part_fail_closed_on_bad_json() -> None:
    assert build_canvas_part("emit_code_island", "{not json") is None


@pytest.mark.unit
def test_build_code_island_part_fail_closed_on_missing_or_empty_fields() -> None:
    base = {
        "intent": "x",
        "selectedNodeKeys": ["n1"],
        "inputBindings": {"t": {"sourceNodeKey": "n1", "sourcePath": "data"}},
        "inputs": {"t": {"kind": "document"}},
    }
    # missing / empty intent
    assert build_canvas_part("emit_code_island", json.dumps({**base, "intent": ""})) is None
    assert build_canvas_part("emit_code_island", json.dumps({k: v for k, v in base.items() if k != "intent"})) is None
    # no usable selectedNodeKeys
    assert build_canvas_part("emit_code_island", json.dumps({**base, "selectedNodeKeys": []})) is None
    # no usable bindings (binding missing sourcePath)
    assert (
        build_canvas_part("emit_code_island", json.dumps({**base, "inputBindings": {"t": {"sourceNodeKey": "n1"}}}))
        is None
    )
    # no usable manifest (entry missing kind)
    assert build_canvas_part("emit_code_island", json.dumps({**base, "inputs": {"t": {"columns": ["a"]}}})) is None


# ---------------------------------------------------------------------------
# build_canvas_part — canvas_recipe (Phase 73C-R3 frozen contract)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_canvas_recipe_part_full_shape() -> None:
    raw = json.dumps(
        {
            "name": "Invoice reconciliation",
            "nodeKeys": ["spreadsheet:inv", "spreadsheet:bank", "code-island:recon"],
            "edgeKeys": ["e1", "e2"],
            "sourceRef": {"kind": "gmail_query", "query": "from:billing"},
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part == {
        "type": "canvas_recipe",
        "name": "Invoice reconciliation",
        "nodeKeys": ["spreadsheet:inv", "spreadsheet:bank", "code-island:recon"],
        "edgeKeys": ["e1", "e2"],
        "sourceRef": {"kind": "gmail_query", "query": "from:billing"},
    }


@pytest.mark.unit
def test_build_canvas_recipe_part_omits_absent_source_ref_and_defaults_edge_keys() -> None:
    """sourceRef is OPTIONAL (key absent when not an object); edgeKeys defaults to []."""
    part = build_canvas_part("emit_canvas_recipe", '{"name": "My recipe", "nodeKeys": ["n1"]}')
    assert part == {"type": "canvas_recipe", "name": "My recipe", "nodeKeys": ["n1"], "edgeKeys": []}
    assert "sourceRef" not in part
    # A non-object sourceRef is dropped, never stored.
    part = build_canvas_part("emit_canvas_recipe", '{"name": "R", "nodeKeys": ["n1"], "sourceRef": "nope"}')
    assert part is not None
    assert "sourceRef" not in part


@pytest.mark.unit
def test_build_canvas_recipe_part_recaps_name_and_key_lists() -> None:
    """Server-side re-caps: name 120 chars, nodeKeys 32, edgeKeys 64 (schema only guides)."""
    raw = json.dumps(
        {
            "name": "x" * 300,
            "nodeKeys": [f"n{i}" for i in range(50)],
            "edgeKeys": [f"e{i}" for i in range(100)],
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part is not None
    assert len(part["name"]) == 120
    assert len(part["nodeKeys"]) == 32
    assert len(part["edgeKeys"]) == 64


@pytest.mark.unit
def test_build_canvas_recipe_part_drops_pollution_keys_and_dedupes() -> None:
    raw = json.dumps(
        {
            "name": "  Safe recipe  ",
            "nodeKeys": ["n1", "__proto__", "n1", "constructor", "n2"],
            "edgeKeys": ["e1", "prototype", "e1"],
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part is not None
    assert part["name"] == "Safe recipe"  # trimmed
    assert part["nodeKeys"] == ["n1", "n2"]
    assert part["edgeKeys"] == ["e1"]


@pytest.mark.unit
def test_build_canvas_recipe_part_source_ref_passes_through_when_small_and_clean() -> None:
    """A normal small object sourceRef is stored unchanged (minus nothing)."""
    raw = json.dumps(
        {
            "name": "R",
            "nodeKeys": ["n1"],
            "sourceRef": {"kind": "gmail_query", "query": "from:billing"},
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part is not None
    assert part["sourceRef"] == {"kind": "gmail_query", "query": "from:billing"}


@pytest.mark.unit
def test_build_canvas_recipe_part_drops_pollution_keys_inside_source_ref() -> None:
    """Top-level __proto__/constructor/prototype keys never reach the stored part."""
    raw = json.dumps(
        {
            "name": "R",
            "nodeKeys": ["n1"],
            "sourceRef": {
                "kind": "gmail_query",
                "__proto__": {"polluted": True},
                "constructor": "x",
                "prototype": [],
            },
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part is not None
    assert part["sourceRef"] == {"kind": "gmail_query"}


@pytest.mark.unit
def test_build_canvas_recipe_part_omits_oversized_source_ref() -> None:
    """Serialized sourceRef over 2048 chars -> the OPTIONAL field is omitted entirely."""
    raw = json.dumps(
        {
            "name": "R",
            "nodeKeys": ["n1"],
            "sourceRef": {"kind": "gmail_query", "blob": "x" * 3000},
        }
    )
    part = build_canvas_part("emit_canvas_recipe", raw)
    assert part is not None
    assert "sourceRef" not in part


@pytest.mark.unit
def test_build_canvas_recipe_part_omits_non_dict_source_ref() -> None:
    """Any non-object sourceRef (list, string, number, null) is omitted, part still built."""
    for bad_ref in ('["nope"]', '"nope"', "7", "null"):
        raw = '{"name": "R", "nodeKeys": ["n1"], "sourceRef": ' + bad_ref + "}"
        part = build_canvas_part("emit_canvas_recipe", raw)
        assert part is not None
        assert "sourceRef" not in part


@pytest.mark.unit
def test_build_canvas_recipe_part_fail_closed() -> None:
    # bad JSON
    assert build_canvas_part("emit_canvas_recipe", "{not json") is None
    # missing / empty / non-string name
    assert build_canvas_part("emit_canvas_recipe", '{"nodeKeys": ["n1"]}') is None
    assert build_canvas_part("emit_canvas_recipe", '{"name": "   ", "nodeKeys": ["n1"]}') is None
    assert build_canvas_part("emit_canvas_recipe", '{"name": 7, "nodeKeys": ["n1"]}') is None
    # no usable nodeKeys (missing, empty, non-string entries, pollution-only)
    assert build_canvas_part("emit_canvas_recipe", '{"name": "R"}') is None
    assert build_canvas_part("emit_canvas_recipe", '{"name": "R", "nodeKeys": []}') is None
    assert build_canvas_part("emit_canvas_recipe", '{"name": "R", "nodeKeys": [1, "", null]}') is None
    assert build_canvas_part("emit_canvas_recipe", '{"name": "R", "nodeKeys": ["__proto__"]}') is None


# ---------------------------------------------------------------------------
# cap_tool_output
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cap_tool_output_leaves_short_text_untouched() -> None:
    assert cap_tool_output("hello") == "hello"


@pytest.mark.unit
def test_cap_tool_output_truncates_and_marks_long_text() -> None:
    long_text = "x" * 5000
    capped = cap_tool_output(long_text)
    assert len(capped) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
    assert capped.endswith("…[truncated]")


@pytest.mark.unit
def test_cap_tool_output_respects_custom_limit() -> None:
    capped = cap_tool_output("x" * 100, limit=10)
    assert capped.startswith("x" * 10)
    assert capped.endswith("…[truncated]")


# ---------------------------------------------------------------------------
# Visible-surface text constants (LOOP-02/LOOP-03 "never silent" motto)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_failure_text_is_nonempty_and_visible() -> None:
    assert PARSE_FAILURE_TEXT
    assert "parse" in PARSE_FAILURE_TEXT.lower()


@pytest.mark.unit
def test_round_cap_exhausted_text_is_nonempty_and_visible() -> None:
    assert ROUND_CAP_EXHAUSTED_TEXT
    assert "resolve" in ROUND_CAP_EXHAUSTED_TEXT.lower()
