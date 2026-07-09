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
object plus `suggestionRef.kind`'s single-value enum (T-40-01).
"""

from __future__ import annotations

from typing import Any

from app.infrastructure.llm.genui_artifacts import load_spec_schema

EMIT_UI_SPEC_TOOL_NAME = "emit_ui_spec"
EMIT_PROPOSAL_CARDS_TOOL_NAME = "emit_proposal_cards"
EMIT_CLARIFY_WIDGET_TOOL_NAME = "emit_clarify_widget"
EMIT_CONFIRM_ACTION_TOOL_NAME = "emit_confirm_action"

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
    "Ask the user to confirm or reject a specific, already-identified knowledge suggestion "
    "(e.g. an inferred/ambiguous relationship you found while helping them). Supply ONLY a "
    "suggestionRef {kind, id} identifying the suggestion — NEVER a tier, node id, or any other "
    "mutation parameter; the server re-reads the live suggestion and derives the confirm/reject "
    "options itself. An optional short `rationale` may explain why you're surfacing it. Calling "
    "this tool ENDS your turn: you will not see the user's choice until they explicitly click "
    "Confirm or Reject and the conversation resumes with their decision. Only call this when a "
    "specific, already-identified suggestion exists — never to propose a new, unidentified action."
)

# Hand-authored, Bedrock-valid input_schema (root type:object, additionalProperties:false, no
# root $ref) — the exact contract from 40-01-PLAN.md's <interfaces>/<action> blocks. Only
# "knowledge_edge_tier_promotion" is offered to the model this phase (40-CONTEXT.md's allowlist
# ordering) — "entity_merge_confirm" stays registered server-side in Plan 40-02's dispatch table
# but is structurally unreachable via this tool's schema.
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
                "kind": {"enum": ["knowledge_edge_tier_promotion"]},
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
