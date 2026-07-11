"""GenuiGeneratorAdapter — Call B of the dual-LLM generation pipeline.

Security/correctness contracts:
  - SAFE-02 (D-09): Raw prose NEVER enters the generator prompt.
    Only the structured QuarantineExtraction (entity_type, intent_summary,
    confidence) is passed to Call B via <DATA_SECTION> JSON.
  - D-02: Forced tool-use (emit_ui_spec tool; tool_choice type=tool).
  - D-06/GEN-02: Bounded repair loop — max 3 attempts.
    On each invalid attempt, the validation error is fed back as context.
  - D-05: Haiku for attempts 1-2, Sonnet escalation on attempt 3.
  - D-07: SAFE_FALLBACK_SPEC — hardcoded Python constant (never loaded from file)
    returned after 3 failures or on timeout/exception.
  - D-13/D-20: jsonschema Draft7Validator (matches spec's draft-07 declaration)
    + MAX_SPEC_NODES=200, MAX_SPEC_DEPTH=8 bounds.
  - D-16: max_tokens=3000 set on every call.
  - D-17: asyncio.timeout wraps every call.
  - D-18: temperature=0 on every call.
  - D-21: cache_control ephemeral on the static system prompt block.

No eval/exec/compile on this path (D-24).
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.domain.ports.retrieval_provider import RetrievalResult
from app.infrastructure.llm.genui_artifacts import load_prompt_payload, load_spec_schema
from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction
from app.infrastructure.llm.genui_spec_utils import validate_spec as _validate_spec

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Bounds constants (D-20) — defined in genui_spec_utils (WR-02).
# Callers that need MAX_SPEC_NODES / MAX_SPEC_DEPTH should import them from
# app.infrastructure.llm.genui_spec_utils directly.

# ---------------------------------------------------------------------------
# SAFE_FALLBACK_SPEC (D-07) — hardcoded constant, NOT loaded from file.
# This avoids Docker-vs-dev path drift and ensures the fallback is always
# available without filesystem access.
# ---------------------------------------------------------------------------

SAFE_FALLBACK_SPEC: dict[str, Any] = {
    "v": 1,
    "root": {
        "type": "alert",
        "title": "Unable to generate a view for this request",
    },
}

# ---------------------------------------------------------------------------
# Emit-UI-Spec tool definition (D-02)
# Input schema = spec.schema.json (loaded lazily on first use)
# ---------------------------------------------------------------------------

_EMIT_TOOL_NAME = "emit_ui_spec"


def _build_emit_tool(spec_schema: dict[str, Any]) -> dict[str, Any]:
    """Build the emit_ui_spec tool dict with spec.schema.json as input_schema."""
    return {
        "name": _EMIT_TOOL_NAME,
        "description": (
            "Emit a UI spec that strictly conforms to the SpecRoot JSON schema. "
            "Return ONLY valid, renderable spec JSON — no prose or explanations."
        ),
        "input_schema": spec_schema,
    }


# ---------------------------------------------------------------------------
# System prompt (static, trusted — never interpolated with untrusted content)
# cache_control ephemeral applied as list-of-blocks (D-21)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEXT = (
    "You are a UI spec generator. "
    "Your task is to produce a single valid SpecRoot JSON document using the emit_ui_spec tool.\n\n"
    "You will receive a structured data section (<DATA_SECTION>) containing:\n"
    "  - entity_type: the UI component type hint from classification\n"
    "  - intent_summary: a brief description of what to display\n"
    "  - confidence: classification confidence level\n\n"
    "Rules:\n"
    "- Output ONLY via the emit_ui_spec tool — no prose.\n"
    "- The spec must conform strictly to the SpecRoot schema; use only the allowed "
    "component types and procedure names.\n"
    "- Do NOT include raw document content or user-supplied prose in the spec.\n"
    "- BUILD a concrete, composed UI that actually represents the requested interface — "
    "do NOT merely describe it. Compose multiple real components with `stack` and `grid`: "
    "e.g. a homepage = a `grid` of section `card`s; a feed/list = a `stack` of several "
    "representative item `card`s, each with real-looking heading/body text, `badge`s, and "
    "`button`s.\n"
    "- NEVER emit placeholder or meta-commentary content. Do NOT produce specs whose text "
    'says things like "this is a placeholder", "consider breaking this into components", or '
    '"to build this, design each component separately". Emit the actual UI, populated with '
    "concise, realistic, representative copy for the requested domain.\n"
    "- Use the component catalog below (descriptions, slot/children rules) to choose and "
    "compose components well; render layout containers (`stack`, `grid`, `card`) with real "
    "child components rather than leaving them empty.\n"
    "- Stay within bounds: at most ~200 total nodes and ~8 levels of nesting. Favor a clear, "
    "complete layout over exhaustive detail.\n"
    "- Declared-state display: to show a value from `state` (a slot in the spec's `state` "
    "array, matching a StateDeclaration `name`), bind it through a `dataRef`-bound `list` "
    "node (`dataRef: 'state.<name>'` iterates an array) or `conditional` node "
    "(`dataRef: 'state.<name>'`, `operator`: eq/neq/gt/lt/truthy/falsy, branching `then`/"
    "`else` into a plain `text` node with realistic static copy per branch). NEVER put a "
    '`{{mustache}}` placeholder like `{"type":"text","content":"{{count}}"}` inside a '
    "`text` node's `content` — `content` is a plain string and is never interpolated at "
    "render time, so a literal `{{count}}` renders as literal text, not the live value.\n"
    "- setState semantics (absolute vs. increment): each `state` entry's `actions` array "
    "declares named mutations (`toggle`, `set`, `reset`, `increment`, `decrement`). A "
    "button's `onClick: {type:'setState', key, value}` fires the action named `key` "
    "(which must match one of that state entry's `actions[].name` — NOT the state's own "
    "`name`). `increment`/`decrement` always change the value by exactly ±1 and "
    "IGNORE any `value` passed on the button. `set` assigns an absolute value (the "
    "button's `value` if provided, else the action's own configured `value`); `toggle` "
    "flips a boolean; `reset` restores the state's `initial` value. Always bind the "
    "display node's `dataRef` to the SAME `state.<name>` that the button's setState "
    "action mutates, so the rendered UI reflects state changes live.\n"
    "Call emit_ui_spec with a valid SpecRoot JSON object."
)


def _format_catalog_reference() -> str:
    """Build a deterministic, cache-stable catalog reference from the prompt payload.

    Injects each component's description + slot/children rules, the action rules, and
    the allowed binding procedures so the model composes with full vocabulary context.
    The payload is trusted static content (the committed genui-prompt.json artifact) —
    never user input — so it is safe in the system prompt. Deterministic ordering keeps
    the prompt prefix stable for cache_control hits (COST-01 / D-21).
    """
    payload = load_prompt_payload()
    lines: list[str] = ["Component catalog (use ONLY these component types):"]
    for comp in payload.get("components", []):
        type_name = comp.get("type", "?")
        description = comp.get("description", "")
        accepts_children = comp.get("acceptsChildren", False)
        slots = comp.get("slots", []) or []
        traits: list[str] = []
        if accepts_children:
            traits.append("accepts children")
        if slots:
            traits.append("slots: " + ", ".join(slots))
        suffix = f" ({'; '.join(traits)})" if traits else ""
        lines.append(f"- {type_name}: {description}{suffix}")

    action_rules = payload.get("actionRules", {})
    if action_rules:
        rule_text = " ".join(str(v) for v in action_rules.values())
        lines.append(f"\nAction rules: {rule_text}")

    procedures = payload.get("allowedProcedures", [])
    if procedures:
        lines.append("Allowed binding procedures: " + ", ".join(procedures))

    return "\n".join(lines)


def _build_system_blocks() -> list[dict[str, Any]]:
    """System prompt (rules + injected component catalog) as a single cached block.

    The catalog reference (genui-prompt.json) was previously unused — wiring it here
    gives the generator full component-vocabulary context (descriptions, slot/children
    rules, action rules, allowed procedures) instead of only the bare tool schema, which
    is what made it emit placeholder/meta specs. It is static trusted content, so the
    whole block stays cache_control ephemeral (COST-01 / D-21): the big prefix is cached
    and per-request input carries only the DATA_SECTION.
    """
    text = f"{_SYSTEM_PROMPT_TEXT}\n\n{_format_catalog_reference()}"
    return [
        {
            "type": "text",
            "text": text,
            "cache_control": {"type": "ephemeral"},
        }
    ]


# ---------------------------------------------------------------------------
# Dynamic user-turn injection helpers (17-04 / COST-01 / T-17-21 / SAFE-02)
#
# These functions build per-request content injected into initial_user_content
# ONLY. _build_system_blocks() MUST NOT be called or modified here.
# ---------------------------------------------------------------------------

# W3C-DTCG token aliases shared by all style packs (21 canonical slots).
# Injected per-request so the model knows which token names to use for theming.
_TOKEN_ALIASES: tuple[str, ...] = (
    "color.background",
    "color.foreground",
    "color.card",
    "color.cardForeground",
    "color.popover",
    "color.popoverForeground",
    "color.primary",
    "color.primaryForeground",
    "color.secondary",
    "color.secondaryForeground",
    "color.muted",
    "color.mutedForeground",
    "color.accent",
    "color.accentForeground",
    "color.destructive",
    "color.destructiveForeground",
    "color.border",
    "color.input",
    "color.ring",
    "radius.base",
    "typography.body.family",
)


def _build_pack_token_section(style_pack_id: str) -> str:
    """Build the pack token table for injection into initial_user_content (DYNAMIC user turn).

    Injects the active pack identifier and 21 W3C-DTCG token aliases so the model
    can reference them in the generated spec. This is per-request content — it goes
    into the DYNAMIC user turn, never into _build_system_blocks() (COST-01/T-17-21).

    No eval/exec/compile used (D-24). Pure string construction from trusted constants.

    Args:
        style_pack_id: The validated active style pack identifier.

    Returns:
        A structured text section to prepend to initial_user_content.
    """
    token_lines = "\n".join(f"  - {alias}" for alias in _TOKEN_ALIASES)
    return (
        f"<STYLE_PACK_SECTION>\n"
        f"Active style pack: {style_pack_id}\n"
        f"Use the following W3C-DTCG design token aliases when referencing colors, "
        f"radius, and typography in the spec:\n"
        f"{token_lines}\n"
        f"</STYLE_PACK_SECTION>"
    )


def _build_exemplar_section(retrieval: RetrievalResult) -> str:
    """Build the retrieved exemplars section for injection into initial_user_content.

    Exemplars are injected as structured JSON data inside <EXEMPLARS_SECTION> framing
    (SAFE-02: structured data, never raw prose). Only items with kind='exemplar' or
    kind='template' are included — component-catalog items are already in the system
    prompt via _format_catalog_reference(), so duplicating them would waste tokens.

    No eval/exec/compile used (D-24). JSON serialized from trusted RetrievedItem payloads.

    Args:
        retrieval: RetrievalResult from the active RetrievalProvider.retrieve() call.
            Must have at least one item (caller asserts retrieval.items is non-empty).

    Returns:
        A structured text section to append to initial_user_content.
    """
    exemplar_items = [
        item for item in retrieval.items if item.kind in ("exemplar", "template")
    ]
    if not exemplar_items:
        return ""

    items_data = [
        {
            "id": item.id,
            "kind": item.kind,
            "score": item.score,
            "payload": item.payload,
        }
        for item in exemplar_items
    ]
    items_json = json.dumps(items_data, ensure_ascii=False, separators=(", ", ": "))
    return (
        f"<EXEMPLARS_SECTION>\n"
        f"Retrieved exemplars for reference (use as structural inspiration only — "
        f"do NOT copy raw content verbatim):\n"
        f"{items_json}\n"
        f"</EXEMPLARS_SECTION>"
    )


# ---------------------------------------------------------------------------
# Spec validation helpers (D-13, D-20)
# ---------------------------------------------------------------------------
# _validate_spec is imported from genui_spec_utils (WR-02).
# External callers should import the PUBLIC name (validate_spec / count_nodes)
# from app.infrastructure.llm.genui_spec_utils directly.


# ---------------------------------------------------------------------------
# GeneratorResult — structured output from generate() (WR-03/04/05)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GeneratorResult:
    """Immutable result of a GenuiGeneratorAdapter.generate() call.

    Exposes the actual spec, number of attempts made, whether the
    escalation model (Sonnet) was used on the final attempt, and an
    explicit is_fallback flag — enabling the use case to record accurate
    audit data and make reliable persist/cache decisions (CR-02, WR-03/04/05).
    """

    spec: dict[str, Any]
    """The validated SpecRoot dict, or SAFE_FALLBACK_SPEC on total failure."""

    attempts: int
    """Number of repair-loop attempts made (1-3)."""

    escalated: bool
    """True when the Sonnet escalation model was used on attempt 3."""

    is_fallback: bool = False
    """True when spec is SAFE_FALLBACK_SPEC (timeout, exception, or all attempts
    exhausted). Set structurally by the adapter — never inferred from spec content
    (CR-02: eliminates false-positive for legitimate alert specs)."""

    input_tokens: int = 0
    """Real cumulative input tokens across every repair-loop attempt (D-22).
    0 when the top-level exception handler returns SAFE_FALLBACK_SPEC before
    any response was received."""

    output_tokens: int = 0
    """Real cumulative output tokens across every repair-loop attempt (D-22)."""


def _extract_usage(response: Any) -> tuple[int, int]:
    """Read real (input_tokens, output_tokens) off a Bedrock response (D-22).

    Mirrors GenuiQuarantineAdapter's existing `.usage` capture idiom — defends
    against a missing/partial `usage` attribute rather than assuming its shape.
    """
    usage = getattr(response, "usage", None)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    return input_tokens, output_tokens


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class GenuiGeneratorAdapter:
    """Call B: emit_ui_spec forced tool-use with repair loop and escalation (D-02/D-05/D-06).

    Receives only the structured QuarantineExtraction — NEVER raw prose (SAFE-02).
    Returns a validated SpecRoot dict, or SAFE_FALLBACK_SPEC on total failure.
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        model_id: str,
        escalation_model_id: str,
        max_tokens: int = 3000,
        timeout_seconds: float = 15.0,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._escalation_model_id = escalation_model_id
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds

    async def generate(
        self,
        *,
        extraction: QuarantineExtraction,
        registry_version: str,
        raw_prose_for_test_assertion: str | None = None,
        style_pack_id: str | None = None,
        retrieval: RetrievalResult | None = None,
    ) -> GeneratorResult:
        """Generate a validated SpecRoot dict from the quarantine extraction.

        Args:
            extraction: Structured output from Call A (quarantine adapter).
            registry_version: Registry/catalog version string for audit.
            raw_prose_for_test_assertion: IGNORED at runtime — accepted only so tests
                can verify the adapter does NOT include raw prose in its prompts.
            style_pack_id: Active style pack identifier (17-04). When provided, the
                W3C-DTCG token table for this pack is injected into initial_user_content
                (DYNAMIC user turn). Must NOT affect _build_system_blocks() (COST-01/T-17-21).
            retrieval: Ranked retrieval result from the RetrievalProvider (17-04/RAG-02).
                Retrieved exemplars are injected as structured data into initial_user_content
                (SAFE-02 DATA framing). None = no exemplar injection (backward compat).

        Returns:
            GeneratorResult with spec (validated SpecRoot or SAFE_FALLBACK_SPEC),
            the number of attempts made, and whether Sonnet escalation occurred.
            Never raises — returns a fallback GeneratorResult on any exception.
        """
        try:
            return await self._repair_loop(
                extraction=extraction,
                style_pack_id=style_pack_id,
                retrieval=retrieval,
            )
        except Exception:
            logger.warning(
                "genui_generator_failed",
                model_id=self._model_id,
                registry_version=registry_version,
                exc_info=True,
            )
            return GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=1, escalated=False, is_fallback=True)

    async def _repair_loop(
        self,
        *,
        extraction: QuarantineExtraction,
        style_pack_id: str | None = None,
        retrieval: RetrievalResult | None = None,
    ) -> GeneratorResult:
        """Run up to 3 attempts; feed validation errors back for repair (D-06/GEN-02).

        Tracks the number of attempts made and whether the Sonnet escalation model
        was used, so the caller can record accurate audit data (WR-03/04/05).

        style_pack_id and retrieval are injected into initial_user_content ONLY —
        _build_system_blocks() is never touched (COST-01 / T-17-21).
        """
        spec_schema = load_spec_schema()
        emit_tool = _build_emit_tool(spec_schema)
        system_blocks = _build_system_blocks()

        # Initial user message with structured extraction only (SAFE-02)
        data_section = json.dumps(
            {
                "entity_type": extraction.entity_type,
                "intent_summary": extraction.intent_summary,
                "confidence": extraction.confidence,
            },
            ensure_ascii=False,
        )
        initial_user_content = (
            f"<DATA_SECTION>{data_section}</DATA_SECTION>\n\n"
            "Generate a SpecRoot JSON using the emit_ui_spec tool."
        )

        # Inject pack token table into DYNAMIC user turn (COST-01 / T-17-21 — NOT system)
        if style_pack_id is not None:
            token_section = _build_pack_token_section(style_pack_id)
            initial_user_content = token_section + "\n\n" + initial_user_content

        # Inject retrieved exemplars as structured DATA framing (SAFE-02 / RAG-02)
        if retrieval is not None and retrieval.items:
            exemplar_section = _build_exemplar_section(retrieval)
            initial_user_content = initial_user_content + "\n\n" + exemplar_section

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": initial_user_content},
        ]

        # D-22: real token usage accumulated across every repair-loop attempt —
        # each attempt is a real, billed Bedrock call, so all of them count
        # toward this turn's total cost, not just the one that succeeds.
        total_input_tokens = 0
        total_output_tokens = 0

        _max_attempts = 3
        for attempt in range(_max_attempts):
            # Attempt 3 (index 2) escalates to Sonnet (D-05)
            escalated_this_attempt = attempt == 2
            model_id = self._escalation_model_id if escalated_this_attempt else self._model_id

            if TYPE_CHECKING:
                emit_tool_typed: ToolParam = cast("ToolParam", emit_tool)
            else:
                emit_tool_typed = emit_tool

            async with asyncio.timeout(self._timeout_seconds):
                response = await self._client.messages.create(  # type: ignore[call-overload]
                    model=model_id,
                    max_tokens=self._max_tokens,
                    temperature=0,
                    system=system_blocks,
                    tools=[emit_tool_typed],
                    tool_choice={"type": "tool", "name": _EMIT_TOOL_NAME},
                    messages=messages,
                )

            # D-22: capture this attempt's real usage before parsing/validating.
            attempt_input_tokens, attempt_output_tokens = _extract_usage(response)
            total_input_tokens += attempt_input_tokens
            total_output_tokens += attempt_output_tokens

            # Parse candidate from tool_use block
            candidate = self._parse_response(response)
            if candidate is None:
                error_msg: str | None = "Model did not call emit_ui_spec tool"
                logger.warning(
                    "genui_generator_no_tool_use",
                    attempt=attempt + 1,
                )
            else:
                # Validate against schema + bounds (D-13, D-20)
                error_msg = _validate_spec(candidate)
                if error_msg is None:
                    # Valid spec — return with actual attempt count and escalation flag
                    return GeneratorResult(
                        spec=candidate,
                        attempts=attempt + 1,
                        escalated=escalated_this_attempt,
                        input_tokens=total_input_tokens,
                        output_tokens=total_output_tokens,
                    )

            logger.warning(
                "genui_generator_invalid_spec",
                attempt=attempt + 1,
                max_attempts=_max_attempts,
                error=error_msg,
            )

            # Feed validation error back for next attempt (D-06)
            if attempt < _max_attempts - 1:
                # Append assistant + repair user messages for context
                messages = [
                    *messages,
                    {
                        "role": "assistant",
                        "content": response.content,  # type: ignore[attr-defined]
                    },
                    {
                        "role": "user",
                        "content": (
                            f"The previous spec was invalid: {error_msg}\n\n"
                            "Please fix the issues and call emit_ui_spec again with a valid SpecRoot."
                        ),
                    },
                ]

        # All 3 attempts failed → SAFE_FALLBACK_SPEC (D-07)
        logger.error(
            "genui_generator_all_attempts_failed",
            max_attempts=_max_attempts,
        )
        return GeneratorResult(
            spec=SAFE_FALLBACK_SPEC,
            attempts=_max_attempts,
            escalated=True,
            is_fallback=True,
            input_tokens=total_input_tokens,
            output_tokens=total_output_tokens,
        )

    def _parse_response(self, response: Any) -> dict[str, Any] | None:
        """Extract the spec dict from the emit_ui_spec tool_use block.

        Returns None if no tool_use block is present.
        """
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                return dict(block.input)
            except (TypeError, ValueError):
                logger.warning("genui_generator_parse_failed", exc_info=True)
                return None
        return None
