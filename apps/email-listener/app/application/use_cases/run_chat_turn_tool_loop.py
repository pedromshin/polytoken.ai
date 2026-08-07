"""Pure tool-loop helpers for the bounded mid-turn round loop (Phase 34, LOOP-01).

Split out of run_chat_turn.py (mirrors run_chat_turn_widgets.py's pattern):
pure functions only, no I/O, no ports -- importing only `app.domain.*` +
stdlib keeps this module trivially unit-testable and free of the
import-linter's "Application does not import infrastructure" contract.

None of this is wired into `_execute_turn` yet -- Plan 34-03 consumes these
helpers to build the actual streaming round loop. This module only freezes
the contracts and pure logic: part builders for the two new message-part
types (`tool_invocation` / `tool_invocation_result` -- NOT reusing
`interactive_widget`, which carries pending-for-human semantics), the
synthetic native `tool_result` content block the Bedrock adapter accepts
verbatim, a three-way dispatch classifier, and an output-size cap.

"Never silent" is this phase's behavioral motto (LOOP-02/LOOP-03):
PARSE_FAILURE_TEXT and ROUND_CAP_EXHAUSTED_TEXT are the exact visible-text
constants the loop surfaces instead of a bare silent drop/stop.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from app.application.use_cases.run_chat_turn_widgets import INTERACTIVE_WIDGET_TOOL_NAMES
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS

if TYPE_CHECKING:
    from collections.abc import Callable, Collection, Sequence

    from app.domain.ports.tool_executor import ToolExecutionResult

# Mirrors app.infrastructure.llm.chat_tools.EMIT_UI_SPEC_TOOL_NAME -- defined
# locally (not imported) because the import-linter forbids
# app.application -> app.infrastructure.
EMIT_UI_SPEC_TOOL_NAME = "emit_ui_spec"

# Phase 73 Wave A (canvas emit): mirror the emit-a-part tool names locally
# (same import-linter rationale as EMIT_UI_SPEC_TOOL_NAME above -- the builders
# live in app.infrastructure.llm.chat_tools, which this layer may not import).
# These two tools finalize into `canvas_add_node` / `canvas_connect` message
# parts (build_canvas_part below); like emit_ui_spec they are emit-a-part tools,
# NOT server-executor tools, so classify_tool_dispatch routes them to "canvas"
# (never "server") and their part is built at finalize time.
EMIT_CANVAS_NODE_TOOL_NAME = "emit_canvas_node"
EMIT_CANVAS_CONNECT_TOOL_NAME = "emit_canvas_connect"
# Phase 76-05 (BTAP-07): emit_code_island rides the SAME canvas emit-a-part
# machinery — it finalizes into a `canvas_code_island` part (build_canvas_part
# below) carrying the grounding-flow inputs the web half (Plan 76-04) consumes.
EMIT_CODE_ISLAND_TOOL_NAME = "emit_code_island"
# Phase 73C-R3 (recipe seam): emit_canvas_recipe rides the SAME machinery — it
# finalizes into a `canvas_recipe` part (build_canvas_part below) the web
# reconcile validates against the LIVE canvas before creating the row.
EMIT_CANVAS_RECIPE_TOOL_NAME = "emit_canvas_recipe"
CANVAS_EMIT_TOOL_NAMES: tuple[str, ...] = (
    EMIT_CANVAS_NODE_TOOL_NAME,
    EMIT_CANVAS_CONNECT_TOOL_NAME,
    EMIT_CODE_ISLAND_TOOL_NAME,
    EMIT_CANVAS_RECIPE_TOOL_NAME,
)

# Bounded-manifest / binding caps for emit_code_island's `canvas_code_island`
# part (re-enforced HERE server-side — the tool's input_schema only GUIDES the
# model, the part builder is the real gate, mirroring emit_canvas_node/connect).
# Columns mirror packages/capabilities/src/table.ts MAX_TABLE_COLUMNS=64; sample
# rows stay TINY per the SPEC risk note ("Keep the sample tiny; the full rows
# only ever reach the sandbox"). Pollution-keyed targetKeys are dropped.
_CODE_ISLAND_MAX_INPUTS = 16
_CODE_ISLAND_MAX_COLUMNS = 64
_CODE_ISLAND_MAX_SAMPLE_ROWS = 5
_CODE_ISLAND_MAX_SELECTED = 32
_FORBIDDEN_MANIFEST_KEYS = frozenset({"__proto__", "constructor", "prototype"})

# W9-1: nesting cap for the model-authored `canvas_add_node` payload and for the
# code-island sample rows. This is a NEW server-side bound, NOT parity with the
# tRPC persist boundary -- canvas-schema.ts has no depth cap on `node.data` (its
# only size guards are MAX_SHARED_STATE_SERIALIZED_CHARS, which covers
# sharedState only, and the node/edge COUNT caps). It exists so an agent cannot
# smuggle an unbounded blob into a JSONB message part, and so the recursive
# pollution-key walk below is itself bounded.
#
# The behaviour change this implies is real and deliberate: a `data` payload
# nested deeper than this now yields None -> the visible PARSE_FAILURE_TEXT,
# where before it produced a part. No emitted payload in the repo's fixtures or
# tests approaches this depth; the value is a judgement call, not a measured
# ceiling, and the tests below pin the exact boundary (12 accepted, 13 refused).
_CANVAS_DATA_MAX_DEPTH = 12

# Mirror of canvas-schema.ts's `nodeDataSchema` D-05 refinement, which rejects a
# node.data carrying a top-level `spec`/`root` key (specs rehydrate from
# chat_messages by provenance ref; layout rows never duplicate them). The web
# reconcile copies an emitted part's `data` into the node verbatim
# (`use-canvas-persistence.ts:214-225`), so without this an agent could emit a
# node that renders and then fails EVERY saveCanvasLayout -- the availability
# bug, not just a security one. Top-level only, matching the TS refinement
# exactly (`!("spec" in data) && !("root" in data)`).
_CANVAS_NODE_DATA_RESERVED_KEYS = frozenset({"spec", "root"})

# Recipe caps for emit_canvas_recipe's `canvas_recipe` part (Phase 73C-R3) —
# re-enforced HERE server-side exactly like the code-island caps above (the
# tool's input_schema only GUIDES the model; the part builder is the real
# gate). Mirror chat_tools.py's _CANVAS_RECIPE_* constants.
_CANVAS_RECIPE_MAX_NAME_CHARS = 120
_CANVAS_RECIPE_MAX_NODE_KEYS = 32
_CANVAS_RECIPE_MAX_EDGE_KEYS = 64
# Serialized-size bound on the OPTIONAL sourceRef object — over the cap the
# field is omitted entirely (fail-closed-to-omission; a recipe row stays a
# grouping, never an unbounded model-authored blob).
_CANVAS_RECIPE_MAX_SOURCE_REF_CHARS = 2048

# Visible-surface text (LOOP-02/LOOP-03, "never silent" motto). Exact strings
# -- consumed verbatim by Plans 34-02/34-03.
PARSE_FAILURE_TEXT = (
    "I couldn't parse that lookup result, so I stopped before using it. Could you rephrase your request?"
)
ROUND_CAP_EXHAUSTED_TEXT = "I couldn't fully resolve that after several lookups. Here's what I have so far."

# A model may emit SEVERAL tool_use blocks in ONE streamed response (observed
# live 2026-07-12: two web_search calls per response). Every block still gets
# a tool_result fed back (API contract), but only the first
# MAX_SERVER_CALLS_PER_ROUND execute — the rest get this is_error result
# without executing, bounding per-round work the same way _MAX_TOOL_ROUNDS
# bounds rounds.
MAX_SERVER_CALLS_PER_ROUND = 5
PARALLEL_CALL_OVERFLOW_TEXT = "Too many tool calls in one step — this call was not executed."

# Surfaced by _finalize_state for a server-tool call that was queued/pending
# when the turn terminated (mid-stream failure/stop) — never a silent drop,
# never a bogus genui_spec part.
SERVER_CALL_NOT_EXECUTED_TEXT = "[a lookup was interrupted before it could run]"

# Appended (as a text block after the tool_result blocks) to the LAST allowed
# round's fed-back user message, paired with that final stream offering no
# server tools: the model must spend the final round answering, not asking
# for another lookup and stranding the user with ROUND_CAP_EXHAUSTED_TEXT.
FINAL_ROUND_NUDGE_TEXT = (
    "That was the final lookup round available this turn. Do not request any more lookups — "
    "write your final answer now from the results above (emit a UI panel if it helps)."
)


def build_tool_invocation_part(tool_name: str, tool_use_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Build the `tool_invocation` message part recording a dispatched server-tool call."""
    return {
        "type": "tool_invocation",
        "toolUseId": tool_use_id,
        "toolName": tool_name,
        "arguments": arguments,
    }


def build_tool_invocation_result_part(result: ToolExecutionResult, tool_name: str) -> dict[str, Any]:
    """Build the `tool_invocation_result` message part recording an executor's outcome."""
    return {
        "type": "tool_invocation_result",
        "toolUseId": result.tool_use_id,
        "toolName": tool_name,
        "content": result.content,
        "isError": result.is_error,
    }


def build_synthetic_tool_result_message(result: ToolExecutionResult) -> dict[str, Any]:
    """Build the native Bedrock `tool_result` user message for the next round.

    The Bedrock adapter accepts native `tool_result` content blocks verbatim
    -- preferred over string fencing so the model sees a first-class
    tool-result block rather than text pretending to be one.
    """
    return build_synthetic_tool_results_message([result])


def build_synthetic_tool_results_message(results: Sequence[ToolExecutionResult]) -> dict[str, Any]:
    """Build ONE user message carrying a `tool_result` block per executed call.

    When a response contains several tool_use blocks, the API expects ALL
    their tool_results in the SAME next user message — one message per
    result would orphan the earlier tool_use blocks.
    """
    return {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": result.tool_use_id,
                "content": result.content,
                "is_error": result.is_error,
            }
            for result in results
        ],
    }


def classify_tool_dispatch(tool_name: str, server_tool_names: Collection[str]) -> str:
    """Classify a completed tool call into one of five dispatch branches.

    Precedence: server tools first (an executor mapping entry always wins
    even if a name were to collide with a widget/emit_ui_spec/canvas name),
    then the existing terminal widget tools, then emit_ui_spec, then the
    Phase 73 canvas emit-a-part tools, else "unknown".

    "canvas" (like "emit_ui_spec") is an emit-a-part branch, NOT a server
    branch — the round loop leaves the pending call to be finalized into its
    `canvas_add_node`/`canvas_connect` part after the stream ends; only
    "server" ever routes into the executor round.
    """
    if tool_name in server_tool_names:
        return "server"
    if tool_name in INTERACTIVE_WIDGET_TOOL_NAMES:
        return "widget"
    if tool_name == EMIT_UI_SPEC_TOOL_NAME:
        return "emit_ui_spec"
    if tool_name in CANVAS_EMIT_TOOL_NAMES:
        return "canvas"
    return "unknown"


def build_canvas_part(tool_name: str, raw_json: str) -> dict[str, Any] | None:
    """Parse a finalized canvas emit tool call's accumulated JSON into a message part.

    Returns None (dropped -> caller appends the visible PARSE_FAILURE_TEXT) when
    tool_name is not a canvas emit tool, the JSON never parses, or the parsed
    shape is unusable (missing/empty required fields) -- fail-closed, mirroring
    run_chat_turn_widgets.build_interactive_widget_part. The returned part shapes
    are FROZEN (the web half is written against them verbatim):

        canvas_add_node:    {"type","handle","nodeType","data"[, "position"]}
        canvas_connect:     {"type","sourceHandle","targetHandle","sourcePath","targetKey"}
        canvas_code_island: {"type","intent","inputs","inputBindings","selectedNodeKeys"}
        canvas_recipe:      {"type","name","nodeKeys","edgeKeys"[, "sourceRef"]}
    """
    try:
        raw: Any = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    builder = _CANVAS_PART_BUILDERS.get(tool_name)
    return builder(raw) if builder is not None else None


def _has_forbidden_key_deep(value: Any, *, depth: int = 0) -> bool:
    """True when a pollution key appears at ANY depth, or the structure is too deep (W9-1).

    The emitting-side mirror of the tRPC persist boundary's `hasForbiddenKeyDeep`
    (`packages/api-client/src/router/chat/canvas-schema.ts`) and of the sibling
    code-island builders' `_FORBIDDEN_MANIFEST_KEYS` filter. Over-deep nesting
    counts as forbidden so an agent cannot push an unbounded blob straight into
    a JSONB part, and so this walk is itself bounded.
    """
    if depth > _CANVAS_DATA_MAX_DEPTH:
        return True
    if isinstance(value, dict):
        return any(
            (isinstance(key, str) and key in _FORBIDDEN_MANIFEST_KEYS)
            or _has_forbidden_key_deep(item, depth=depth + 1)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_has_forbidden_key_deep(item, depth=depth + 1) for item in value)
    return False


def _has_forbidden_path_segment(path: str) -> bool:
    """True when a dotted path contains a pollution segment (W9-1).

    Emitting-side mirror of canvas-schema.ts's `hasForbiddenPathSegment`: the
    web resolves `sourcePath`/`targetKey` as dotted paths into node data, so
    `data.__proto__.x` is a traversal primitive, not a key name.
    """
    return any(segment in _FORBIDDEN_MANIFEST_KEYS for segment in path.split("."))


def _is_refused_canvas_node_data(data: dict[str, Any]) -> bool:
    """True when node `data` carries anything the canvas layout boundary would reject.

    Two rules, both mirroring `canvas-schema.ts`'s `nodeDataSchema`: a top-level
    `spec`/`root` key (D-05, top-level only -- `!("spec" in data)`), and a pollution
    key at any depth. `_has_forbidden_key_deep` additionally applies the
    emitting-side-only depth bound; see `_CANVAS_DATA_MAX_DEPTH`.
    """
    if any(key in data for key in _CANVAS_NODE_DATA_RESERVED_KEYS):
        return True
    return _has_forbidden_key_deep(data)


def _build_canvas_add_node_part(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build the frozen `canvas_add_node` part; None (dropped) when malformed.

    `data` is free-form BY DESIGN (the node's payload, not a shape this tool
    constrains) but it is MODEL-AUTHORED, and the model reads untrusted content
    (mail bodies, web/research results). Three refusals apply (W9-1):

    - pollution keys at any depth -- parity with canvas-schema.ts's
      `hasForbiddenKeyDeep` refinement on `node.data`;
    - a top-level `spec`/`root` key -- parity with the same schema's D-05
      refinement, so an emitted node can never render-but-never-save;
    - nesting past `_CANVAS_DATA_MAX_DEPTH` -- NOT parity; a new emitting-side
      bound, see that constant.
    """
    handle = raw.get("handle")
    node_type = raw.get("nodeType")
    data = raw.get("data")
    if not isinstance(handle, str) or not handle:
        return None
    if not isinstance(node_type, str) or not node_type:
        return None
    if not isinstance(data, dict):
        return None
    if _is_refused_canvas_node_data(data):
        return None
    part: dict[str, Any] = {"type": "canvas_add_node", "handle": handle, "nodeType": node_type, "data": data}
    # position is OPTIONAL -- the key is included ONLY when the model supplied a
    # position object (omitting it signals "auto-place" to the web, per the
    # frozen wire contract).
    position = raw.get("position")
    if isinstance(position, dict):
        if _has_forbidden_key_deep(position):
            return None
        part["position"] = position
    return part


def _build_canvas_connect_part(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build the frozen `canvas_connect` part; None (dropped) when any field is missing/empty.

    `sourcePath`/`targetKey` are dotted paths the web walks into node data, so a
    pollution segment is refused here exactly as canvas-schema.ts refuses it at
    the persist boundary (W9-1).
    """
    part: dict[str, Any] = {"type": "canvas_connect"}
    for key in ("sourceHandle", "targetHandle", "sourcePath", "targetKey"):
        value = raw.get(key)
        if not isinstance(value, str) or not value:
            return None
        part[key] = value
    if _has_forbidden_path_segment(part["sourcePath"]) or _has_forbidden_path_segment(part["targetKey"]):
        return None
    return part


def _clean_key_list(value: Any, cap: int) -> list[str]:
    """Filter to non-empty, non-pollution string keys; dedupe (order-preserving); cap."""
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item or item in _FORBIDDEN_MANIFEST_KEYS:
            continue
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
        if len(out) >= cap:
            break
    return out


def _clean_input_bindings(value: Any) -> dict[str, dict[str, str]]:
    """Keep only well-formed `targetKey -> {sourceNodeKey, sourcePath}` entries; cap count.

    `sourcePath` is the SAME kind of field as `canvas_connect`'s: the web walks it
    as a dotted path into node data (`resolveCanvasPath`, `canvas-store.ts:65-69`,
    reached from `build-tool-flow.ts:199`). W11-1: it gets the SAME per-segment
    refusal `_build_canvas_connect_part` applies -- before this it was checked only
    for `isinstance(str) and non-empty`, so `data.__proto__.polluted` was persisted
    verbatim while the identically-named field on the sibling builder refused it.
    """
    if not isinstance(value, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for target_key, binding in value.items():
        if not isinstance(target_key, str) or not target_key or target_key in _FORBIDDEN_MANIFEST_KEYS:
            continue
        if not isinstance(binding, dict):
            continue
        source_node_key = binding.get("sourceNodeKey")
        source_path = binding.get("sourcePath")
        if not isinstance(source_node_key, str) or not source_node_key:
            continue
        if source_node_key in _FORBIDDEN_MANIFEST_KEYS:
            continue
        if not isinstance(source_path, str) or not source_path:
            continue
        if _has_forbidden_path_segment(source_path):
            continue
        out[target_key] = {"sourceNodeKey": source_node_key, "sourcePath": source_path}
        if len(out) >= _CODE_ISLAND_MAX_INPUTS:
            break
    return out


def _clean_manifest_entry(entry: Any) -> dict[str, Any] | None:
    """Build one bounded manifest entry `{kind[, columns, rowCount, sample]}`; None if unusable.

    W11-1: `columns` and `sample` are model-authored too. `columns` entries become
    object keys downstream, so pollution names are dropped exactly as
    `_clean_key_list` drops them; `sample` rows were previously copied VERBATIM --
    only sliced to `_CODE_ISLAND_MAX_SAMPLE_ROWS` -- so `[{"__proto__": {...}}]`
    landed in the persisted part with no key filter and no depth cap. Offending
    rows are now dropped individually (the entry survives with its clean rows,
    mirroring how `_clean_key_list` drops bad keys rather than the whole list).
    """
    if not isinstance(entry, dict):
        return None
    kind = entry.get("kind")
    if not isinstance(kind, str) or not kind:
        return None
    cleaned: dict[str, Any] = {"kind": kind}
    columns = entry.get("columns")
    if isinstance(columns, list):
        cols = [c for c in columns if isinstance(c, str) and c not in _FORBIDDEN_MANIFEST_KEYS][
            :_CODE_ISLAND_MAX_COLUMNS
        ]
        cleaned["columns"] = cols
    row_count = entry.get("rowCount")
    # bool is an int subclass -- exclude it explicitly so True/False never poses as a count.
    if isinstance(row_count, int) and not isinstance(row_count, bool) and row_count >= 0:
        cleaned["rowCount"] = row_count
    sample = entry.get("sample")
    if isinstance(sample, list):
        cleaned["sample"] = [row for row in sample if not _has_forbidden_key_deep(row)][:_CODE_ISLAND_MAX_SAMPLE_ROWS]
    return cleaned


def _clean_inputs_manifest(value: Any) -> dict[str, dict[str, Any]]:
    """Keep only well-formed manifest entries keyed by a safe targetKey; cap count + shape."""
    if not isinstance(value, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for target_key, entry in value.items():
        if not isinstance(target_key, str) or not target_key or target_key in _FORBIDDEN_MANIFEST_KEYS:
            continue
        cleaned = _clean_manifest_entry(entry)
        if cleaned is None:
            continue
        out[target_key] = cleaned
        if len(out) >= _CODE_ISLAND_MAX_INPUTS:
            break
    return out


def _build_canvas_code_island_part(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build the frozen `canvas_code_island` part (Phase 76-05, BTAP-07).

    None (dropped -> caller appends the visible PARSE_FAILURE_TEXT) when the
    intent is missing/empty or NONE of selectedNodeKeys / inputBindings / inputs
    survive validation -- fail-closed, mirroring _build_canvas_connect_part. The
    manifest + bindings are bounded/capped and pollution-keyed entries dropped so
    the persisted part can never blow the sharedState bound or carry a full
    dataset. The FROZEN shape (the web half of Plan 76-04 is written against it):

        {"type","intent","inputs","inputBindings","selectedNodeKeys"}
    """
    intent = raw.get("intent")
    if not isinstance(intent, str) or not intent:
        return None
    selected = _clean_key_list(raw.get("selectedNodeKeys"), _CODE_ISLAND_MAX_SELECTED)
    if not selected:
        return None
    bindings = _clean_input_bindings(raw.get("inputBindings"))
    if not bindings:
        return None
    inputs = _clean_inputs_manifest(raw.get("inputs"))
    if not inputs:
        return None
    return {
        "type": "canvas_code_island",
        "intent": intent,
        "inputs": inputs,
        "inputBindings": bindings,
        "selectedNodeKeys": selected,
    }


def _build_canvas_recipe_part(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build the frozen `canvas_recipe` part (Phase 73C-R3, recipe seam).

    None (dropped -> caller appends the visible PARSE_FAILURE_TEXT) when the
    name is missing/empty or NO nodeKeys survive validation -- fail-closed,
    mirroring _build_canvas_code_island_part. Name + key lists are re-capped
    server-side and pollution-keyed entries dropped; `sourceRef` is included
    ONLY when the model supplied an object (mirrors canvas_add_node's optional
    position), and is OMITTED when it carries a pollution key at ANY depth or
    its serialized size exceeds the cap (fail-closed-to-omission -- the field is
    optional, so dropping it costs a grouping hint, not the recipe). W11-1: the
    pollution filter used to be a TOP-LEVEL dict comprehension, so
    `{"meta": {"__proto__": {...}}}` was persisted verbatim -- the shallow
    version of the bug the sibling canvas builders had already fixed. The FROZEN
    shape (the web reconcile is written against it):

        {"type","name","nodeKeys","edgeKeys"[, "sourceRef"]}
    """
    name = raw.get("name")
    if not isinstance(name, str):
        return None
    name = name.strip()[:_CANVAS_RECIPE_MAX_NAME_CHARS].rstrip()
    if not name:
        return None
    node_keys = _clean_key_list(raw.get("nodeKeys"), _CANVAS_RECIPE_MAX_NODE_KEYS)
    if not node_keys:
        return None
    edge_keys = _clean_key_list(raw.get("edgeKeys"), _CANVAS_RECIPE_MAX_EDGE_KEYS)
    part: dict[str, Any] = {
        "type": "canvas_recipe",
        "name": name,
        "nodeKeys": node_keys,
        "edgeKeys": edge_keys,
    }
    source_ref = raw.get("sourceRef")
    if (
        isinstance(source_ref, dict)
        and not _has_forbidden_key_deep(source_ref)
        and len(json.dumps(source_ref, ensure_ascii=False)) <= _CANVAS_RECIPE_MAX_SOURCE_REF_CHARS
    ):
        part["sourceRef"] = source_ref
    return part


# One frozen-part builder per canvas emit tool — the dispatch table
# build_canvas_part consults (defined after the builders it references).
_CANVAS_PART_BUILDERS: dict[str, Callable[[dict[str, Any]], dict[str, Any] | None]] = {
    EMIT_CANVAS_NODE_TOOL_NAME: _build_canvas_add_node_part,
    EMIT_CANVAS_CONNECT_TOOL_NAME: _build_canvas_connect_part,
    EMIT_CODE_ISLAND_TOOL_NAME: _build_canvas_code_island_part,
    EMIT_CANVAS_RECIPE_TOOL_NAME: _build_canvas_recipe_part,
}


def cap_tool_output(text: str, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    """Truncate `text` to `limit` chars, appending a visible truncation marker when cut."""
    if len(text) <= limit:
        return text
    return text[:limit] + " …[truncated]"


__all__ = [
    "CANVAS_EMIT_TOOL_NAMES",
    "EMIT_CANVAS_CONNECT_TOOL_NAME",
    "EMIT_CANVAS_NODE_TOOL_NAME",
    "EMIT_CANVAS_RECIPE_TOOL_NAME",
    "EMIT_CODE_ISLAND_TOOL_NAME",
    "EMIT_UI_SPEC_TOOL_NAME",
    "FINAL_ROUND_NUDGE_TEXT",
    "MAX_SERVER_CALLS_PER_ROUND",
    "PARALLEL_CALL_OVERFLOW_TEXT",
    "PARSE_FAILURE_TEXT",
    "ROUND_CAP_EXHAUSTED_TEXT",
    "SERVER_CALL_NOT_EXECUTED_TEXT",
    "build_canvas_part",
    "build_synthetic_tool_result_message",
    "build_synthetic_tool_results_message",
    "build_tool_invocation_part",
    "build_tool_invocation_result_part",
    "cap_tool_output",
    "classify_tool_dispatch",
]
