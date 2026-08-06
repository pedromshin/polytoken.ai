"""build_emit_ui_spec_tool / build_emit_proposal_cards_tool — chat tool builders.

Phase 22-07 (STREAM-02, D-02, D-05), corrected after live testing (2026-07-04):
the tool's input IS the SpecRoot document itself, constrained by the real
Bedrock-valid SpecRoot JSON schema from the genui artifacts (the same schema
the studio's forced-tool generator uses). The original hand-written
`{"spec": {"type": "object"}}` wrapper gave the model ZERO grammar (every
emission was invented and rejected by the strict web-boundary safeParse) and
persisted the wrapper object as the spec — so genui-in-chat ALWAYS fell back.

Unlike the studio's forced-tool-use path, emit_ui_spec is OFFERED (never
forced) on the chat turn — the agent decides whether/when to call it (D-02).
The accumulated tool JSON is persisted as the genui_spec part VERBATIM — no
server-side schema validation or fallback happens here (that gate is the web
boundary, FOUND-6); the input_schema exists to make the model emit something
that will actually survive that gate.

Phase 24-02 (DCUI-03, D-01/D-04/D-05): emit_proposal_cards is a SECOND,
dedicated interactive tool (D-03) — offered alongside emit_ui_spec to
genui-capable models. Calling it ENDS the turn with a pending, schema-bearing
widget (D-01/D-04); unlike emit_ui_spec's SpecRoot schema (loaded from the
committed genui artifacts), emit_proposal_cards' input_schema is small and
hand-authored directly from the 24-CONTEXT.md <interfaces> contract — no
artifact loader needed. Both tools satisfy the same Bedrock-valid contract
(root `type: object`, `additionalProperties: false`, no root `$ref`).

Layering note: the chat agent (run_chat_turn.py, application layer) does NOT
import this module directly — the "Application does not import infrastructure"
import-linter contract forbids app.application -> app.infrastructure. Instead,
RunChatTurn accepts tool definitions as plain `dict[str, Any]` constructor
parameters, and app/container.py (the composition root, exempt from that
contract) calls build_emit_ui_spec_tool()/build_emit_proposal_cards_tool() and
wires them in.

Phase 24-04 (DCUI-02, D-09): emit_clarify_widget is a THIRD interactive tool —
its declaration drives the UNMODIFIED Phase-19 form engine client-side. The
UI-SPEC's MANDATORY posture ("a bare 'Submit' default is never reachable in
practice") is enforced HERE, in the schema itself: `submitLabel` is `required`
with `minLength: 1` — not left to prompt guidance.

Phase 40-01 (CONF-01): emit_confirm_action is a FOURTH interactive tool — the
model supplies ONLY a `suggestionRef {kind, id}` (+ an optional short
`rationale`), NEVER a tier/node-id/mutation parameter. The server re-reads the
live suggestion at emission time (run_chat_turn.py's `_finalize_confirm_action`)
and derives the frozen confirm/reject widget declaration — the model
structurally cannot supply anything beyond an id to look up, enforced by
`additionalProperties: false` at both the root and the nested `suggestionRef`
object plus `suggestionRef.kind`'s enum (T-40-01).

Phase 54-03 (CLUS-04): `suggestionRef.kind` enum gains a SECOND value,
"source_capture" — proposing a captured web_search result as an INFERRED
knowledge node. Its `id` is NOT a database row id (unlike
"knowledge_edge_tier_promotion"'s edge id) — it is a `{toolUseId}:{index}`
composite the model builds itself from ITS OWN prior web_search tool_use id
(visible in this same turn) plus the 0-based position of the result inside
that call's `results` array. The server re-reads the actual url/title from
the PERSISTED tool result by this id — the model never supplies source
content directly (T-54-03-01).

Cache stability (COST-01/D-21, phase 999.15): every builder here returns a
DETERMINISTIC dict — static name/description strings and schemas that are
either module-level constants or loaded from the committed genui artifacts.
Built once at composition time (container.py) and reused verbatim per turn,
the tool list is byte-stable across requests, which is what lets
BedrockChatAdapter place a cache_control ephemeral breakpoint (Bedrock
cachePoint) on the LAST tool and serve the whole tools-schema prefix at
cache-read pricing. Do NOT interpolate per-request/per-user values into
these builders — that would silently invalidate the prompt cache.
BedrockChatAdapter adds the breakpoint on a COPY, so the dicts returned
here are never mutated.
"""

from __future__ import annotations

from typing import Any

from app.infrastructure.llm.genui_artifacts import load_spec_schema

EMIT_UI_SPEC_TOOL_NAME = "emit_ui_spec"
EMIT_PROPOSAL_CARDS_TOOL_NAME = "emit_proposal_cards"
EMIT_CLARIFY_WIDGET_TOOL_NAME = "emit_clarify_widget"
EMIT_CONFIRM_ACTION_TOOL_NAME = "emit_confirm_action"
EMIT_CANVAS_NODE_TOOL_NAME = "emit_canvas_node"
EMIT_CANVAS_CONNECT_TOOL_NAME = "emit_canvas_connect"
EMIT_CODE_ISLAND_TOOL_NAME = "emit_code_island"
EMIT_CANVAS_RECIPE_TOOL_NAME = "emit_canvas_recipe"

_DESCRIPTION = (
    "Emit a declarative UI spec (a SpecRoot JSON document) for the trusted genui renderer "
    "when an interactive widget or structured visual summary would serve the user's request "
    "better than plain text (dashboards, comparisons, forms, structured data). The input MUST "
    "strictly conform to this tool's JSON schema — only the registered component types and "
    "their declared props render; anything else is rejected and shown as an error to the user. "
    "The spec renders through the Catalog -> Spec -> Registry -> Renderer pipeline (no code "
    "execution). Only call this when a UI genuinely helps — a normal conversational reply "
    "does not need it. You may interleave prose before/after the tool call."
)


def build_emit_ui_spec_tool() -> dict[str, Any]:
    """Build the emit_ui_spec tool dict with the real SpecRoot schema as input_schema.

    The schema comes from the committed genui artifacts via load_spec_schema()
    (root `type: object`, no root $ref — Bedrock-valid; the loader asserts this).
    Loaded once at composition time (container.py), not per turn.
    """
    return {
        "name": EMIT_UI_SPEC_TOOL_NAME,
        "description": _DESCRIPTION,
        "input_schema": load_spec_schema(),
    }


_PROPOSAL_CARDS_DESCRIPTION = (
    "Offer the user a small set of clickable proposal cards when a short list of structured "
    "options would resolve their request faster than free text (e.g. choosing among a few "
    "candidate actions, records, or configurations). Each option's `value` is the exact "
    "structured payload used when the user picks it — do not rely on prose to convey the "
    "choice. Calling this tool ENDS your turn: you will not see the user's choice until they "
    "explicitly click a card and the conversation resumes with their selection. Only call this "
    "when a genuinely small, well-defined set of choices exists (max 8) — otherwise reply "
    "normally."
)

# Hand-authored, Bedrock-valid input_schema (root type:object, additionalProperties:false, no
# root $ref) — the exact contract from 24-CONTEXT.md's <interfaces> block. `value` is
# intentionally schema-free ({}) since it is the agent-chosen structured payload for that
# option, not a shape this tool constrains.
_PROPOSAL_CARDS_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["options"],
    "additionalProperties": False,
    "properties": {
        "prompt": {"type": "string"},
        "options": {
            "type": "array",
            "minItems": 1,
            "maxItems": 8,
            "items": {
                "type": "object",
                "required": ["title", "value"],
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "value": {},
                },
            },
        },
    },
}

# Load-time assertion mirroring emit_ui_spec's _assert_bedrock_input_schema guard
# (genui_artifacts.py) — fail fast if this hand-authored schema ever regresses.
assert _PROPOSAL_CARDS_INPUT_SCHEMA["type"] == "object", (
    "emit_proposal_cards input_schema root must be type:object (Bedrock tool-input contract)"
)


def build_emit_proposal_cards_tool() -> dict[str, Any]:
    """Build the emit_proposal_cards tool dict (Phase 24-02, D-01/D-03/D-04/D-05).

    Offered (never forced) alongside emit_ui_spec to genui-capable models — the
    agent decides whether/when to call it. A completed call finalizes into an
    `interactive_widget` part (run_chat_turn.py) that ends the turn; no
    server-side content validation happens here (the options/value payload is
    stored verbatim and re-validated only at SUBMIT time against the derived
    declared_response_schema, D-10).
    """
    return {
        "name": EMIT_PROPOSAL_CARDS_TOOL_NAME,
        "description": _PROPOSAL_CARDS_DESCRIPTION,
        "input_schema": _PROPOSAL_CARDS_INPUT_SCHEMA,
    }


_CLARIFY_WIDGET_DESCRIPTION = (
    "Ask the user a structured clarifying question via a small form (text/select/checkbox/"
    "radio/etc. fields) when their free-text answer would be ambiguous or you need several "
    "discrete pieces of information at once. `submitLabel` MUST be a specific verb+noun phrase "
    "describing what submitting the form does (e.g. 'Send response', 'Confirm details') — never "
    "a generic word like 'Submit' or 'OK'. Calling this tool ENDS your turn: you will not see the "
    "user's answers until they explicitly submit the form and the conversation resumes with the "
    "structured values. Only call this when a genuinely small, well-defined set of fields (max "
    "12) would resolve the ambiguity — otherwise reply normally."
)

# Hand-authored, Bedrock-valid input_schema (root type:object, additionalProperties:false, no
# root $ref) mirroring packages/genui/src/form/validate-form.ts's FormFieldSpec shape 1:1 so the
# web builder (24-04-PLAN.md's buildClarifyWidgetSpec) can map fields verbatim. `submitLabel` is
# REQUIRED with `minLength: 1` — the UI-SPEC's MANDATORY enforcement lives in this schema, not in
# prompt guidance, so a bare/empty submitLabel is structurally unreachable.
_CLARIFY_WIDGET_FIELD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name", "label"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "label": {"type": "string"},
        "fieldType": {"enum": ["text", "textarea", "select", "radio", "checkbox", "number", "email"]},
        "required": {"type": "boolean"},
        "placeholder": {"type": "string"},
        "helpText": {"type": "string"},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["value", "label"],
                "additionalProperties": False,
                "properties": {"value": {"type": "string"}, "label": {"type": "string"}},
            },
        },
    },
}

_CLARIFY_WIDGET_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["submitLabel", "fields"],
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "submitLabel": {"type": "string", "minLength": 1},
        "fields": {
            "type": "array",
            "minItems": 1,
            "maxItems": 12,
            "items": _CLARIFY_WIDGET_FIELD_SCHEMA,
        },
    },
}

# Load-time assertion mirroring emit_ui_spec's _assert_bedrock_input_schema guard
# (genui_artifacts.py) — fail fast if this hand-authored schema ever regresses.
assert _CLARIFY_WIDGET_INPUT_SCHEMA["type"] == "object", (
    "emit_clarify_widget input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CLARIFY_WIDGET_INPUT_SCHEMA["properties"]["submitLabel"]["minLength"] == 1, (
    "emit_clarify_widget submitLabel must require minLength:1 (UI-SPEC MANDATORY enforcement)"
)


def build_emit_clarify_widget_tool() -> dict[str, Any]:
    """Build the emit_clarify_widget tool dict (Phase 24-04, D-02/D-09, DCUI-02).

    Offered (never forced) alongside emit_ui_spec/emit_proposal_cards to
    genui-capable models. A completed call finalizes into an
    `interactive_widget` part (widgetKind "clarify_widget") that ends the
    turn; the declared_response_schema a later submit is re-validated against
    is DERIVED server-side from the emitted fields (run_chat_turn_widgets.py),
    never model-authored.
    """
    return {
        "name": EMIT_CLARIFY_WIDGET_TOOL_NAME,
        "description": _CLARIFY_WIDGET_DESCRIPTION,
        "input_schema": _CLARIFY_WIDGET_INPUT_SCHEMA,
    }


_CONFIRM_ACTION_DESCRIPTION = (
    "Ask the user to confirm or reject a specific, already-identified suggestion — either a "
    "knowledge relationship you found while helping them (kind: knowledge_edge_tier_promotion, "
    "id: the suggestion's own id), or a web_search result worth capturing as a knowledge source "
    "for this cluster (kind: source_capture, id: '{the exact toolUseId of your OWN prior "
    "web_search tool call}:{the 0-based index of the result in that call's results array}'). "
    "Copy the toolUseId EXACTLY, character for character, including its full prefix (e.g. "
    "'toolu_bdrk_01Ab...:0' for the first result) — never shorten, re-type, or invent it. "
    "Supply ONLY a suggestionRef {kind, id} — NEVER a "
    "tier, node id, url, title, or any other mutation parameter; the server re-reads the live "
    "suggestion/result and derives the confirm/reject options itself. An optional short "
    "`rationale` may explain why you're surfacing it. Calling this tool ENDS your turn: you will "
    "not see the user's choice until they explicitly click Confirm or Reject and the conversation "
    "resumes with their decision. Only call this when a specific, already-identified suggestion "
    "exists — never to propose a new, unidentified action."
)

# Hand-authored, Bedrock-valid input_schema (root type:object, additionalProperties:false, no
# root $ref) — the exact contract from 40-01-PLAN.md's <interfaces>/<action> blocks, extended by
# 54-03-PLAN.md (CLUS-04). "knowledge_edge_tier_promotion" and "source_capture" are BOTH offered
# to the model (40-CONTEXT.md's allowlist ordering + 54-CONTEXT.md's suggest-only capture) —
# "entity_merge_confirm" stays registered server-side in Plan 40-02's dispatch table but is
# structurally unreachable via this tool's schema.
_CONFIRM_ACTION_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["suggestionRef"],
    "additionalProperties": False,
    "properties": {
        "suggestionRef": {
            "type": "object",
            "required": ["kind", "id"],
            "additionalProperties": False,
            "properties": {
                "kind": {"enum": ["knowledge_edge_tier_promotion", "source_capture"]},
                "id": {"type": "string", "minLength": 1, "maxLength": 100},
            },
        },
        "rationale": {"type": "string", "maxLength": 280},
    },
}

# Load-time assertion mirroring emit_ui_spec's _assert_bedrock_input_schema guard
# (genui_artifacts.py) — fail fast if this hand-authored schema ever regresses.
assert _CONFIRM_ACTION_INPUT_SCHEMA["type"] == "object", (
    "emit_confirm_action input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CONFIRM_ACTION_INPUT_SCHEMA["additionalProperties"] is False, (
    "emit_confirm_action input_schema root must forbid additionalProperties (T-40-01)"
)
assert _CONFIRM_ACTION_INPUT_SCHEMA["properties"]["suggestionRef"]["additionalProperties"] is False, (
    "emit_confirm_action suggestionRef must forbid additionalProperties (T-40-01)"
)


def build_emit_confirm_action_tool() -> dict[str, Any]:
    """Build the emit_confirm_action tool dict (Phase 40-01, CONF-01, T-40-01).

    Offered (never forced) alongside the other interactive tools to
    genui-capable models. A completed call finalizes into an
    `interactive_widget` part (widgetKind "confirm_action") ONLY when the
    server's live re-read of the referenced suggestion succeeds
    (run_chat_turn.py's `_finalize_confirm_action`); otherwise it fails into
    a visible text fallback. The model never sees or supplies tier/mutation
    parameters — only an id to look up.
    """
    return {
        "name": EMIT_CONFIRM_ACTION_TOOL_NAME,
        "description": _CONFIRM_ACTION_DESCRIPTION,
        "input_schema": _CONFIRM_ACTION_INPUT_SCHEMA,
    }


# Phase 73 Wave A (canvas emit): emit_canvas_node / emit_canvas_connect are two
# NEW model-callable tools that let the chat agent DRAW on the canvas. They
# MIRROR the emit_ui_spec emit-a-part path EXACTLY — they are NOT registry/
# executor tools, run NO server executor, and touch NO mail/SES/S3/Lambda path.
# Their only effect: a completed call appends a `canvas_add_node` /
# `canvas_connect` message PART (persisted verbatim as JSONB) that the web
# client materializes onto the canvas on the post-turn history refetch. Offered
# (never forced) ONLY to genui-capable models, and ONLY when the
# CANVAS_EMIT_TOOL_ENABLED flag is set (default OFF, structural omission in
# composition/chat_turn_providers.py). Both schemas are Bedrock-valid (root is
# an object, additionalProperties false, no root $ref) with load-time
# assertions mirroring the emit_proposal_cards/emit_confirm_action guards above.
#
# `nodeType` is a plain string, NOT a hard enum: the web validates it against
# its live node registry and degrades an unknown type to a placeholder, so
# maintaining a 24-type enum here would only invite drift (a known landmine).
# The common types are LISTED in the description so the model picks well.
_CANVAS_NODE_TYPE_HINT = (
    "chat, genui-panel, email-thread, document, spreadsheet, entity, knowledge-search, "
    "review-queue, rule-suggestions, pipeline-health, brief, usage, documents, references, "
    "search-all, conversations, source, knowledge-preview"
)

_CANVAS_NODE_DESCRIPTION = (
    "Draw a NEW node on the user's canvas when a persistent, spatially-arranged surface would "
    "serve the request better than an inline reply (e.g. laying out a document, spreadsheet, "
    "entity, or panel the user can keep and connect to others). Provide a short `handle` — a "
    "turn-local label you choose (e.g. 'sheet', 'tile') that later emit_canvas_connect calls "
    "reference to wire this node up. `nodeType` is the kind of node to render; common types are: "
    f"{_CANVAS_NODE_TYPE_HINT}. `data` is the node's free-form data payload. `position` is "
    "OPTIONAL — omit it entirely to let the canvas auto-place the node. Only call this when a "
    "canvas node genuinely helps; a normal conversational reply does not need it."
)

# Hand-authored, Bedrock-valid input_schema. `data` is intentionally schema-free
# ({"type": "object"}) — it is the node's free-form payload, not a shape this
# tool constrains (mirrors emit_proposal_cards' schema-free `value`). `position`
# is optional (not in `required`): omitting it signals "auto-place" to the web.
_CANVAS_NODE_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["handle", "nodeType", "data"],
    "additionalProperties": False,
    "properties": {
        "handle": {"type": "string", "minLength": 1},
        "nodeType": {"type": "string", "minLength": 1},
        "data": {"type": "object"},
        "position": {
            "type": "object",
            "required": ["x", "y"],
            "additionalProperties": False,
            "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
        },
    },
}

# Load-time assertions mirroring emit_proposal_cards'/_CONFIRM_ACTION's guards.
assert _CANVAS_NODE_INPUT_SCHEMA["type"] == "object", (
    "emit_canvas_node input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CANVAS_NODE_INPUT_SCHEMA["additionalProperties"] is False, (
    "emit_canvas_node input_schema root must forbid additionalProperties"
)


def build_emit_canvas_node_tool() -> dict[str, Any]:
    """Build the emit_canvas_node tool dict (Phase 73 Wave A, canvas emit).

    Offered (never forced) alongside emit_ui_spec to genui-capable models, and
    only behind the CANVAS_EMIT_TOOL_ENABLED flag. A completed call finalizes
    into a `canvas_add_node` message part (turn_state.py's `_finalize_pending_
    tool`), stored verbatim — no server-side validation here (the web registry
    is the gate; unknown nodeTypes degrade to a placeholder).
    """
    return {
        "name": EMIT_CANVAS_NODE_TOOL_NAME,
        "description": _CANVAS_NODE_DESCRIPTION,
        "input_schema": _CANVAS_NODE_INPUT_SCHEMA,
    }


_CANVAS_CONNECT_DESCRIPTION = (
    "Wire one canvas node's output into another node's input, AFTER you have created BOTH nodes "
    "with emit_canvas_node this turn. `sourceHandle`/`targetHandle` are the exact `handle` labels "
    "you gave those two nodes. `sourcePath` is the dotted path into the source node's data to read "
    "from (conceptually 'data'); `targetKey` is the key on the target node to feed it into "
    "(conceptually 'input'). Supply all four explicitly. Only call this to connect nodes that "
    "already exist by handle in this same turn."
)

# Hand-authored, Bedrock-valid input_schema. All four fields are required
# strings (the frozen wire contract the web half is already written against).
_CANVAS_CONNECT_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["sourceHandle", "targetHandle", "sourcePath", "targetKey"],
    "additionalProperties": False,
    "properties": {
        "sourceHandle": {"type": "string", "minLength": 1},
        "targetHandle": {"type": "string", "minLength": 1},
        "sourcePath": {"type": "string", "minLength": 1},
        "targetKey": {"type": "string", "minLength": 1},
    },
}

# Load-time assertions mirroring emit_proposal_cards'/_CONFIRM_ACTION's guards.
assert _CANVAS_CONNECT_INPUT_SCHEMA["type"] == "object", (
    "emit_canvas_connect input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CANVAS_CONNECT_INPUT_SCHEMA["additionalProperties"] is False, (
    "emit_canvas_connect input_schema root must forbid additionalProperties"
)


def build_emit_canvas_connect_tool() -> dict[str, Any]:
    """Build the emit_canvas_connect tool dict (Phase 73 Wave A, canvas emit).

    Offered (never forced) alongside emit_canvas_node to genui-capable models,
    behind the same CANVAS_EMIT_TOOL_ENABLED flag. A completed call finalizes
    into a `canvas_connect` message part (turn_state.py's `_finalize_pending_
    tool`), stored verbatim.
    """
    return {
        "name": EMIT_CANVAS_CONNECT_TOOL_NAME,
        "description": _CANVAS_CONNECT_DESCRIPTION,
        "input_schema": _CANVAS_CONNECT_INPUT_SCHEMA,
    }


# Phase 76-05 (BTAP-07, seam 5): emit_code_island is a THIRD canvas emit-a-part
# tool — "the agent writes you a throwaway app wired to your real files". It
# rides the EXACT same machinery as emit_canvas_node/emit_canvas_connect (an
# emit-a-part tool, NOT a registry/executor tool; runs NO server executor;
# touches NO mail/SES/S3/Lambda path) and sits behind the SAME
# CANVAS_EMIT_TOOL_ENABLED flag (default OFF, structural omission in
# composition/chat_turn_providers.py). Its only effect: a completed call
# appends a `canvas_code_island` message PART (persisted verbatim as JSONB)
# carrying the grounding-flow inputs BTAP's web flow (Plan 76-04) consumes —
# { intent, inputs (bounded manifest), inputBindings, selectedNodeKeys }. The
# web half reads the selected nodes' bounded `shared.published.{nodeKey}`
# projections, generates the island code, persists it, and materializes ONE
# `code-island` node wired by one data-edge per source.
#
# The `inputs` manifest is a SHAPE DESCRIPTION + tiny sample (columns ≤ 64,
# sample rows ≤ 5, keyed by targetKey) — NEVER the full dataset. Per the SPEC
# it is model-visible by design (unlike raw_content, which stays quarantined),
# but it MUST stay capped so it never becomes a backdoor for the whole table.
_CODE_ISLAND_DESCRIPTION = (
    "Build the user a bespoke, disposable mini-app (a 'code-island') grounded in the DATA of two "
    "or more canvas nodes they have selected — e.g. 'reconcile these invoices against the bank "
    "rows'. Call this AFTER the user has selected the source data nodes you want to wire in. "
    "`intent` is the plain-language task the generated app performs. `selectedNodeKeys` are the "
    "keys of the selected source nodes. `inputBindings` maps each input `targetKey` (a short name "
    "the generated app reads, e.g. 'invoices') to { sourceNodeKey, sourcePath } — which selected "
    "node it draws from and the dotted path into that node's published data. `inputs` is a bounded "
    "MANIFEST keyed by the same targetKeys: per key a { kind, columns?, rowCount?, sample? } SHAPE "
    "description so the generated code knows the data's structure. Keep `sample` TINY (a few rows "
    "at most) and NEVER paste the whole dataset — the full rows reach only the sandbox, never you. "
    "Only call this when a grounded, data-wired app genuinely helps; a normal reply does not need it."
)

# Bounded-manifest / binding caps (mirror packages/capabilities/src/table.ts's
# MAX_TABLE_COLUMNS=64 for columns; sample rows kept TINY per the SPEC risk note
# "Keep the sample tiny; the full rows only ever reach the sandbox"). These bound
# what the model may express in the input_schema; build_canvas_part re-enforces
# them server-side (the schema only GUIDES the model — the part builder is the
# real gate, mirroring emit_canvas_node/connect).
_CODE_ISLAND_MAX_INPUTS = 16
_CODE_ISLAND_MAX_COLUMNS = 64
_CODE_ISLAND_MAX_SAMPLE_ROWS = 5
_CODE_ISLAND_MAX_SELECTED = 32

# Hand-authored, Bedrock-valid input_schema (root type:object,
# additionalProperties:false, no root $ref). `inputBindings` and `inputs` are
# map-style objects keyed by an arbitrary targetKey, expressed via
# `additionalProperties: {schema}` (valid JSON Schema, accepted by Bedrock);
# `sample` rows are schema-free ({}) tiny data payloads, capped by maxItems.
_CODE_ISLAND_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["intent", "inputs", "inputBindings", "selectedNodeKeys"],
    "additionalProperties": False,
    "properties": {
        "intent": {"type": "string", "minLength": 1},
        "selectedNodeKeys": {
            "type": "array",
            "minItems": 1,
            "maxItems": _CODE_ISLAND_MAX_SELECTED,
            "items": {"type": "string", "minLength": 1},
        },
        "inputBindings": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "required": ["sourceNodeKey", "sourcePath"],
                "additionalProperties": False,
                "properties": {
                    "sourceNodeKey": {"type": "string", "minLength": 1},
                    "sourcePath": {"type": "string", "minLength": 1},
                },
            },
        },
        "inputs": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "required": ["kind"],
                "additionalProperties": False,
                "properties": {
                    "kind": {"type": "string", "minLength": 1},
                    "columns": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": _CODE_ISLAND_MAX_COLUMNS,
                    },
                    "rowCount": {"type": "integer", "minimum": 0},
                    "sample": {"type": "array", "maxItems": _CODE_ISLAND_MAX_SAMPLE_ROWS},
                },
            },
        },
    },
}

# Load-time assertions mirroring emit_canvas_node/connect's guards.
assert _CODE_ISLAND_INPUT_SCHEMA["type"] == "object", (
    "emit_code_island input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CODE_ISLAND_INPUT_SCHEMA["additionalProperties"] is False, (
    "emit_code_island input_schema root must forbid additionalProperties"
)


def build_emit_code_island_tool() -> dict[str, Any]:
    """Build the emit_code_island tool dict (Phase 76-05, BTAP-07, canvas emit).

    Offered (never forced) alongside emit_canvas_node/emit_canvas_connect to
    genui-capable models, behind the SAME CANVAS_EMIT_TOOL_ENABLED flag. A
    completed call finalizes into a `canvas_code_island` message part
    (run_chat_turn_tool_loop.build_canvas_part), stored verbatim — no
    server-side generation happens here; the web half runs the grounding flow
    (read published projections -> generate -> persist -> materialize node +
    data-edges).
    """
    return {
        "name": EMIT_CODE_ISLAND_TOOL_NAME,
        "description": _CODE_ISLAND_DESCRIPTION,
        "input_schema": _CODE_ISLAND_INPUT_SCHEMA,
    }


# Phase 73C-R3 (recipe seam): emit_canvas_recipe is a FOURTH canvas emit-a-part
# tool — the agent NAMES a wired canvas selection as a persisted recipe (a
# `canvas_recipes` row). It rides the EXACT same machinery as the three tools
# above (an emit-a-part tool, NOT a registry/executor tool; runs NO server
# executor; touches NO mail/SES/S3/Lambda path) and sits behind the SAME
# CANVAS_EMIT_TOOL_ENABLED flag (default OFF, structural omission in
# composition/chat_turn_providers.py). Its only effect: a completed call
# appends a `canvas_recipe` message PART (persisted verbatim as JSONB). The web
# reconcile (agent-recipe-reconcile.ts) NEVER trusts the model's keys — it
# validates every node/edge key against the LIVE canvas, drops unknown keys,
# and creates the row via the owner-gated canvasRecipes.create only when ≥1
# member node is actually present.
_CANVAS_RECIPE_DESCRIPTION = (
    "Name a wired group of canvas nodes as a saved RECIPE the user can see and reuse — call this "
    "AFTER the nodes exist and are wired (e.g. once you have laid out a dataflow worth keeping). "
    "`name` is a short human label for the recipe (max 120 chars). `nodeKeys` are the exact keys "
    "of the member nodes on the user's canvas (max 32); `edgeKeys` optionally lists the member "
    "wire keys (max 64). `sourceRef` is an OPTIONAL small object recording where the recipe's "
    "data came from, for later re-polling — omit it unless you have a concrete source to record. "
    "Only keys that actually exist on the user's canvas are kept — never invent keys. Only call "
    "this when a group genuinely deserves a persistent name; a normal reply does not need it."
)

# Caps the input_schema advertises; _build_canvas_recipe_part re-enforces them
# server-side (the schema only GUIDES the model — the part builder is the real
# gate, mirroring emit_code_island). Name cap is this seam's own (a label,
# under canvasRecipes.create's 200); key caps mirror the recipe-seam contract.
_CANVAS_RECIPE_MAX_NAME_CHARS = 120
_CANVAS_RECIPE_MAX_NODE_KEYS = 32
_CANVAS_RECIPE_MAX_EDGE_KEYS = 64

# Hand-authored, Bedrock-valid input_schema (root type:object,
# additionalProperties:false, no root $ref). `sourceRef` is intentionally
# schema-free ({"type": "object"}) — an opaque re-poll descriptor the LCAN-09
# worker seam defines later (mirrors emit_canvas_node's schema-free `data`).
_CANVAS_RECIPE_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name", "nodeKeys"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": _CANVAS_RECIPE_MAX_NAME_CHARS},
        "nodeKeys": {
            "type": "array",
            "minItems": 1,
            "maxItems": _CANVAS_RECIPE_MAX_NODE_KEYS,
            "items": {"type": "string", "minLength": 1},
        },
        "edgeKeys": {
            "type": "array",
            "maxItems": _CANVAS_RECIPE_MAX_EDGE_KEYS,
            "items": {"type": "string", "minLength": 1},
        },
        "sourceRef": {"type": "object"},
    },
}

# Load-time assertions mirroring emit_canvas_node/connect/code_island's guards.
assert _CANVAS_RECIPE_INPUT_SCHEMA["type"] == "object", (
    "emit_canvas_recipe input_schema root must be type:object (Bedrock tool-input contract)"
)
assert _CANVAS_RECIPE_INPUT_SCHEMA["additionalProperties"] is False, (
    "emit_canvas_recipe input_schema root must forbid additionalProperties"
)


def build_emit_canvas_recipe_tool() -> dict[str, Any]:
    """Build the emit_canvas_recipe tool dict (Phase 73C-R3, recipe seam).

    Offered (never forced) alongside the other canvas emit tools to
    genui-capable models, behind the SAME CANVAS_EMIT_TOOL_ENABLED flag. A
    completed call finalizes into a `canvas_recipe` message part
    (run_chat_turn_tool_loop.build_canvas_part), stored verbatim — no
    server-side row creation happens here; the web half validates the keys
    against the live canvas and creates the `canvas_recipes` row idempotently.
    """
    return {
        "name": EMIT_CANVAS_RECIPE_TOOL_NAME,
        "description": _CANVAS_RECIPE_DESCRIPTION,
        "input_schema": _CANVAS_RECIPE_INPUT_SCHEMA,
    }
