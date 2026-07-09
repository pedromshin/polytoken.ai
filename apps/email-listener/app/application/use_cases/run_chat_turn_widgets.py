"""Interactive-widget finalization helpers for RunChatTurn (Phase 24-02/24-04, D-01/D-04/D-09).

Split out of run_chat_turn.py to stay under the CLAUDE.md 800-line file cap.
Pure functions only (no I/O, no ports) — this keeps run_chat_turn.py's own
"imports only domain ports/services" architecture contract unaffected.

Turns a finalized emit_proposal_cards/emit_clarify_widget tool call's
accumulated JSON into the `interactive_widget` message-part shape from
24-CONTEXT.md's <interfaces> contract (mirrored verbatim in 24-01-PLAN.md's
<interfaces> block), and derives the `declared_response_schema` persisted
alongside it on the chat_widget_interactions row (D-01/D-10 — later submits
are re-validated against this STORED schema, never a client-supplied one).

A malformed/unusable tool call is DROPPED (returns None) rather than
persisting a non-conforming widget — mirrors emit_ui_spec's existing
parse-failure drop in run_chat_turn.py's _finalize_pending_tool (fail-closed).
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.application.use_cases.run_chat_turn_confirm_action import EMIT_CONFIRM_ACTION_TOOL_NAME

PROPOSAL_CARDS_TOOL_NAME = "emit_proposal_cards"
CLARIFY_WIDGET_TOOL_NAME = "emit_clarify_widget"

# Tool names this module knows how to finalize into an interactive_widget part
# (D-04: at most one pending widget per turn). emit_confirm_action (Phase
# 40-01) is listed here so `_finalize_pending_tool`'s pure/mid-stream call
# sites treat an UNFINALIZED confirm_action call the same safe way as any
# other recognized-but-not-yet-handled widget tool name -- the ACTUAL
# finalization (live edge re-read) happens in RunChatTurn._finalize_confirm_
# action, which clears pending_tool_* BEFORE this dispatch ever sees it at
# turn-end (see run_chat_turn.py).
INTERACTIVE_WIDGET_TOOL_NAMES: tuple[str, ...] = (
    PROPOSAL_CARDS_TOOL_NAME,
    CLARIFY_WIDGET_TOOL_NAME,
    EMIT_CONFIRM_ACTION_TOOL_NAME,
)

# Field types the clarify-widget tool's input_schema allows (chat_tools.py's
# _CLARIFY_WIDGET_FIELD_SCHEMA enum) — mirrors packages/genui/src/form/
# validate-form.ts's FieldType union (the subset this tool exposes).
_CLARIFY_FIELD_TYPES = frozenset({"text", "textarea", "select", "radio", "checkbox", "number", "email"})


def build_interactive_widget_part(tool_name: str, raw_json: str) -> dict[str, Any] | None:
    """Parse a finalized interactive-widget tool call's accumulated JSON into a part.

    Returns None (dropped) when tool_name is not a recognized interactive-widget
    tool, the JSON never parses, or the parsed shape has no usable
    options/fields (fail-closed — never persists a non-conforming widget).
    """
    if tool_name == PROPOSAL_CARDS_TOOL_NAME:
        return _build_proposal_cards_part(raw_json)
    if tool_name == CLARIFY_WIDGET_TOOL_NAME:
        return _build_clarify_widget_part(raw_json)
    return None


def _build_proposal_cards_part(raw_json: str) -> dict[str, Any] | None:
    try:
        raw: Any = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    options = raw.get("options")
    if not isinstance(options, list) or not options:
        return None

    declared_options: list[dict[str, Any]] = []
    for index, option in enumerate(options):
        if not isinstance(option, dict):
            return None
        title = option.get("title")
        if not isinstance(title, str) or not title:
            return None
        # id is server-assigned + index-derived (D-05) — never trusts a
        # model-supplied id, so downstream option lookups are unambiguous.
        declared_option: dict[str, Any] = {"id": f"opt-{index}", "title": title, "value": option.get("value")}
        description = option.get("description")
        if isinstance(description, str):
            declared_option["description"] = description
        declared_options.append(declared_option)

    declaration: dict[str, Any] = {"options": declared_options}
    prompt = raw.get("prompt")
    if isinstance(prompt, str):
        declaration["prompt"] = prompt

    return {
        "type": "interactive_widget",
        "interactionId": str(uuid.uuid4()),
        "widgetKind": "proposal_cards",
        "declaration": declaration,
    }


def _build_clarify_widget_part(raw_json: str) -> dict[str, Any] | None:
    """Parse a finalized emit_clarify_widget tool call into an interactive_widget part.

    Fail-closed (D-09/UI-SPEC MANDATORY): a missing/empty submitLabel or an
    empty/malformed fields array drops the whole widget — the schema's own
    `required`/`minLength`/`minItems` constraints SHOULD prevent this at the
    provider level, but a truncated/cut-off tool call can still arrive
    malformed, so this parser re-asserts the same fail-closed posture
    _build_proposal_cards_part already has.
    """
    try:
        raw: Any = json.loads(raw_json) if raw_json else {}
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None

    submit_label = raw.get("submitLabel")
    if not isinstance(submit_label, str) or not submit_label:
        return None

    fields = raw.get("fields")
    if not isinstance(fields, list) or not fields:
        return None

    declared_fields: list[dict[str, Any]] = []
    for field in fields:
        declared_field = _build_clarify_field(field)
        if declared_field is None:
            return None
        declared_fields.append(declared_field)

    declaration: dict[str, Any] = {"submitLabel": submit_label, "fields": declared_fields}
    title = raw.get("title")
    if isinstance(title, str):
        declaration["title"] = title
    description = raw.get("description")
    if isinstance(description, str):
        declaration["description"] = description

    return {
        "type": "interactive_widget",
        "interactionId": str(uuid.uuid4()),
        "widgetKind": "clarify_widget",
        "declaration": declaration,
    }


def _build_clarify_field(field: Any) -> dict[str, Any] | None:
    """Parse one clarify-widget field entry — None (whole widget dropped) when malformed."""
    if not isinstance(field, dict):
        return None
    name = field.get("name")
    label = field.get("label")
    if not isinstance(name, str) or not name or not isinstance(label, str) or not label:
        return None

    declared: dict[str, Any] = {"name": name, "label": label}
    field_type = field.get("fieldType")
    if isinstance(field_type, str) and field_type in _CLARIFY_FIELD_TYPES:
        declared["fieldType"] = field_type
    if isinstance(field.get("required"), bool):
        declared["required"] = field["required"]
    for passthrough_key in ("placeholder", "helpText"):
        value = field.get(passthrough_key)
        if isinstance(value, str):
            declared[passthrough_key] = value

    options = field.get("options")
    if isinstance(options, list):
        declared_options: list[dict[str, str]] = []
        for option in options:
            if not isinstance(option, dict):
                continue
            value = option.get("value")
            opt_label = option.get("label")
            if isinstance(value, str) and isinstance(opt_label, str):
                declared_options.append({"value": value, "label": opt_label})
        if declared_options:
            declared["options"] = declared_options

    return declared


def build_create_pending_kwargs(message_parts: Any) -> dict[str, Any] | None:
    """Find message.parts' interactive_widget part (if any) and build its create_pending() kwargs.

    D-04: at most one pending interactive widget per turn — the first (and
    only) interactive_widget part found is used. Returns None when no such
    part exists (the caller should not call create_pending at all). Callers
    merge in conversation_id/message_id/turn_index/sibling_group_id, which
    this pure function has no access to.
    """
    for part_index, part in enumerate(message_parts):
        if part.get("type") != "interactive_widget":
            continue
        widget_kind = part["widgetKind"]
        declaration = part["declaration"]
        return {
            "interaction_id": part["interactionId"],
            "part_index": part_index,
            "widget_kind": widget_kind,
            "declaration": declaration,
            "declared_response_schema": derive_declared_response_schema(widget_kind, declaration),
        }
    return None


def derive_declared_response_schema(widget_kind: str, declaration: dict[str, Any]) -> dict[str, Any]:
    """Derive the STORED response schema a later submit is re-validated against (D-01/D-10).

    proposal_cards: an enum-of-option-ids schema — the client can only submit
    one of the server-assigned option ids (T-24-01: the real payload is
    resolved server-side from the stored declaration, never trusted from the
    client, a later plan's SubmitWidgetInteraction concern).

    clarify_widget (Phase 24-04, T-24-20): derived from the DECLARED fields —
    the model never authors this schema. select/radio fields with options
    become an enum of their option values; checkbox becomes boolean; number
    becomes number; everything else becomes string. A field's `required: true`
    adds its name to the schema's `required` array. `additionalProperties:
    false` always — a submit for an undeclared field name is rejected (T-24-23).

    confirm_action (Phase 40-01, CONF-01): reuses the proposal_cards branch
    verbatim — a confirm_action declaration's two server-assigned options
    (`confirm`/`reject`) naturally produce `{"optionId": {"enum": ["confirm",
    "reject"]}}`, which IS the frozen `{action: confirm|reject}` contract
    CONF-01 requires, just keyed as `optionId` to reuse the existing
    proposal-card wire format end-to-end (zero new web components).
    """
    if widget_kind in ("proposal_cards", "confirm_action"):
        option_ids = [option["id"] for option in declaration.get("options", [])]
        return {
            "type": "object",
            "required": ["optionId"],
            "additionalProperties": False,
            "properties": {"optionId": {"enum": option_ids}},
        }
    if widget_kind == "clarify_widget":
        return _derive_clarify_response_schema(declaration.get("fields", []))
    raise ValueError(f"no declared_response_schema deriver registered for widget_kind {widget_kind!r}")


def _derive_clarify_response_schema(fields: list[dict[str, Any]]) -> dict[str, Any]:
    """Field-by-field schema derivation for clarify_widget (D-01/D-10, T-24-20)."""
    properties: dict[str, Any] = {}
    required: list[str] = []
    for field in fields:
        name = field["name"]
        field_type = field.get("fieldType", "text")
        options = field.get("options")
        if field_type in ("select", "radio") and options:
            properties[name] = {"enum": [option["value"] for option in options]}
        elif field_type == "checkbox":
            properties[name] = {"type": "boolean"}
        elif field_type == "number":
            properties[name] = {"type": "number"}
        else:
            properties[name] = {"type": "string"}
        if field.get("required"):
            required.append(name)
    return {
        "type": "object",
        "required": required,
        "additionalProperties": False,
        "properties": properties,
    }


def content_block_stand_in(part: dict[str, Any]) -> dict[str, Any]:
    """Compact text stand-in for interactive_widget/interaction_result parts (history replay).

    Mirrors _provider_content_blocks' existing genui_spec stand-in (Phase
    22-07): neither shape is a valid Anthropic content block on its own, so
    replaying either verbatim (e.g. as a bare tool_use block with no paired
    tool_result) would violate the API's block-alternation contract.
    """
    part_type = part.get("type")
    if part_type == "interactive_widget":
        widget_kind = part.get("widgetKind", "widget")
        declaration_json = json.dumps(part.get("declaration", {}), ensure_ascii=False)
        return {"type": "text", "text": f"[emitted {widget_kind} interactive widget: {declaration_json}]"}
    if part_type == "interaction_result":
        widget_kind = part.get("widgetKind", "widget")
        summary_json = json.dumps(part.get("summary", {}), ensure_ascii=False)
        return {"type": "text", "text": f"[user responded to {widget_kind} widget: {summary_json}]"}
    return part


__all__ = [
    "CLARIFY_WIDGET_TOOL_NAME",
    "INTERACTIVE_WIDGET_TOOL_NAMES",
    "PROPOSAL_CARDS_TOOL_NAME",
    "build_create_pending_kwargs",
    "build_interactive_widget_part",
    "content_block_stand_in",
    "derive_declared_response_schema",
]
