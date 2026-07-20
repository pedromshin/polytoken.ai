"""Mail-rule ACTIONS expressed as registry capabilities (MAIL-02 generality proof).

Each rule action (suggest-forward, suggest-label, suggest-extract-to-sheet) is a
`Capability` built with `define_capability`, so it is resolved and (once a human
blesses it) executed through the SAME `CapabilityRegistry` the chat tool loop
reads from (Phase 68 / REG-02). This proves the registry abstraction generalises
beyond its first consumer.

## Why these are `risk="read"`

Every capability here is the *suggest form* of its action. Its executor NEVER
performs the underlying side effect -- it returns a proposal payload
(`applied: false`) describing what a human could choose to do. Because it does
not forward, label, or write anything, it reads honestly as `risk="read"`
(INV-4: `risk` is DATA describing what the executor actually does). The real
write happens only after a human blesses the suggestion, through a separate
write-risk action -- exactly the entity-resolution INFERRED-until-blessed stance.

## Layering (INV-2)

Application layer. Imports only the domain `ToolExecutor` result type and the
application-layer registry constructor -- never `app.infrastructure`.
"""

from __future__ import annotations

import json
from typing import Any

from app.application.capabilities.registry import Capability, define_capability
from app.domain.ports.tool_executor import ToolExecutionResult

# --- Capability ids -- the stable resolution keys (== each tool_def["name"]) ---
SUGGEST_FORWARD_EMAIL_CAPABILITY_ID = "suggest_forward_email"
SUGGEST_APPLY_LABEL_CAPABILITY_ID = "suggest_apply_label"
SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID = "suggest_extract_to_sheet"

# The status stamped on every payload -- the machine-readable proof that this is
# a proposal, not a performed action. Mirrors the "INFERRED / dashed" stance.
_SUGGESTED_STATUS = "suggested"


class MailRuleSuggestExecutor:
    """A `ToolExecutor` that EMITS a suggested action -- and never applies it.

    Bound to exactly one action name at construction. `execute` echoes the
    caller's arguments back inside a proposal envelope stamped
    `{"status": "suggested", "applied": false}`. There is deliberately no branch
    that performs the real forward / label / extract: the write is a downstream,
    human-blessed step. Satisfies the port structurally (async `execute`,
    never raises past the boundary).
    """

    def __init__(self, *, action: str) -> None:
        self._action = action

    async def execute(
        self, *, name: str, arguments: dict[str, Any], importer_id: str
    ) -> ToolExecutionResult:
        del name  # this instance serves exactly one action
        envelope = {
            "action": self._action,
            "status": _SUGGESTED_STATUS,
            "applied": False,  # invariant: the suggest form NEVER auto-applies
            "importer_id": importer_id,
            "arguments": arguments,
        }
        content = json.dumps(envelope, separators=(",", ":"))
        return ToolExecutionResult(tool_use_id="", content=content, is_error=False)


def _build_suggest_forward_email_tool() -> dict[str, Any]:
    return {
        "name": SUGGEST_FORWARD_EMAIL_CAPABILITY_ID,
        "description": (
            "Propose forwarding this email to a recipient. Suggest-only: it returns a "
            "proposal a human can confirm; it does not send anything."
        ),
        "input_schema": {
            "type": "object",
            "required": ["to_address"],
            "additionalProperties": False,
            "properties": {
                "to_address": {
                    "type": "string",
                    "maxLength": 320,
                    "description": "The address to propose forwarding the email to.",
                },
                "note": {
                    "type": "string",
                    "maxLength": 500,
                    "description": "Optional note explaining why the forward is suggested.",
                },
            },
        },
    }


def _build_suggest_apply_label_tool() -> dict[str, Any]:
    return {
        "name": SUGGEST_APPLY_LABEL_CAPABILITY_ID,
        "description": (
            "Propose applying a label to this email. Suggest-only: it returns a proposal a "
            "human can confirm; it does not modify the mailbox."
        ),
        "input_schema": {
            "type": "object",
            "required": ["label"],
            "additionalProperties": False,
            "properties": {
                "label": {
                    "type": "string",
                    "maxLength": 100,
                    "description": "The label to propose applying.",
                },
            },
        },
    }


def _build_suggest_extract_to_sheet_tool() -> dict[str, Any]:
    return {
        "name": SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID,
        "description": (
            "Propose extracting structured fields from this email into a sheet. Suggest-only: "
            "it returns a proposal a human can confirm; it writes nothing."
        ),
        "input_schema": {
            "type": "object",
            "required": ["sheet"],
            "additionalProperties": False,
            "properties": {
                "sheet": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "The target sheet name or id to propose extracting into.",
                },
                "fields": {
                    "type": "array",
                    "maxItems": 32,
                    "items": {"type": "string", "maxLength": 100},
                    "description": "Optional field names to propose extracting.",
                },
            },
        },
    }


def define_mail_rule_capabilities() -> list[Capability]:
    """Build the mail-rule action capabilities -- the entry helper the composition
    root wires into a `CapabilityRegistry` (do NOT edit `container.py` here).

    Returns the three suggest-form actions a `Rule` can reference by id. Keeping
    this a pure factory (no container import) mirrors how the chat tools are
    declared in `container.py` from `define_capability(...)` -- the orchestrator
    merges this list into the registry declaration at integration time.
    """
    return [
        define_capability(
            executor=MailRuleSuggestExecutor(action=SUGGEST_FORWARD_EMAIL_CAPABILITY_ID),
            tool_def=_build_suggest_forward_email_tool(),
            risk="read",
            cost="free",
        ),
        define_capability(
            executor=MailRuleSuggestExecutor(action=SUGGEST_APPLY_LABEL_CAPABILITY_ID),
            tool_def=_build_suggest_apply_label_tool(),
            risk="read",
            cost="free",
        ),
        define_capability(
            executor=MailRuleSuggestExecutor(action=SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID),
            tool_def=_build_suggest_extract_to_sheet_tool(),
            risk="read",
            cost="free",
        ),
    ]


__all__ = [
    "SUGGEST_APPLY_LABEL_CAPABILITY_ID",
    "SUGGEST_EXTRACT_TO_SHEET_CAPABILITY_ID",
    "SUGGEST_FORWARD_EMAIL_CAPABILITY_ID",
    "MailRuleSuggestExecutor",
    "define_mail_rule_capabilities",
]
