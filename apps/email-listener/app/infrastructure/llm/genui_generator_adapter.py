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

import jsonschema
import structlog

from app.infrastructure.llm.genui_artifacts import load_spec_schema
from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Bounds constants (D-20)
# ---------------------------------------------------------------------------

MAX_SPEC_NODES = 200
MAX_SPEC_DEPTH = 8

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
    "- The spec must conform strictly to the SpecRoot schema.\n"
    "- Use only the allowed component types and procedure names from the schema.\n"
    "- Do NOT include raw document content or user-supplied prose in the spec.\n"
    "- Keep the spec minimal and focused on the stated intent.\n"
    "Call emit_ui_spec with a valid SpecRoot JSON object."
)


def _build_system_blocks() -> list[dict[str, Any]]:
    """System prompt as list-of-blocks with cache_control ephemeral (D-21)."""
    return [
        {
            "type": "text",
            "text": _SYSTEM_PROMPT_TEXT,
            "cache_control": {"type": "ephemeral"},
        }
    ]


# ---------------------------------------------------------------------------
# Spec validation helpers (D-13, D-20)
# ---------------------------------------------------------------------------


def _count_nodes(node: Any, depth: int = 0) -> tuple[int, int]:
    """Recursively count nodes and max depth in a spec node tree.

    Returns (total_nodes, max_depth).
    """
    if not isinstance(node, dict):
        return (0, depth)

    total = 1
    max_d = depth

    for key, value in node.items():
        if key == "children" and isinstance(value, list):
            for child in value:
                child_count, child_depth = _count_nodes(child, depth + 1)
                total += child_count
                max_d = max(max_d, child_depth)
        elif isinstance(value, dict):
            child_count, child_depth = _count_nodes(value, depth + 1)
            total += child_count
            max_d = max(max_d, child_depth)

    return (total, max_d)


def _validate_spec(candidate: dict[str, Any]) -> str | None:
    """Validate candidate against spec schema and bounds.

    Returns None if valid, or an error string describing the first violation.
    """
    spec_schema = load_spec_schema()
    validator = jsonschema.Draft7Validator(spec_schema)
    errors = list(validator.iter_errors(candidate))
    if errors:
        # Return the first error message (clean, for repair feedback)
        return errors[0].message

    # Bounds check (D-20)
    root_node = candidate.get("root")
    if root_node is not None:
        node_count, node_depth = _count_nodes(root_node)
        if node_count > MAX_SPEC_NODES:
            return f"Spec exceeds MAX_SPEC_NODES={MAX_SPEC_NODES} (found {node_count} nodes)"
        if node_depth > MAX_SPEC_DEPTH:
            return f"Spec exceeds MAX_SPEC_DEPTH={MAX_SPEC_DEPTH} (found depth {node_depth})"

    return None


# ---------------------------------------------------------------------------
# GeneratorResult — structured output from generate() (WR-03/04/05)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GeneratorResult:
    """Immutable result of a GenuiGeneratorAdapter.generate() call.

    Exposes the actual spec, number of attempts made, and whether the
    escalation model (Sonnet) was used on the final attempt — enabling the
    use case to record accurate audit data (WR-03/04/05).
    """

    spec: dict[str, Any]
    """The validated SpecRoot dict, or SAFE_FALLBACK_SPEC on total failure."""

    attempts: int
    """Number of repair-loop attempts made (1–3)."""

    escalated: bool
    """True when the Sonnet escalation model was used on attempt 3."""


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
    ) -> GeneratorResult:
        """Generate a validated SpecRoot dict from the quarantine extraction.

        Args:
            extraction: Structured output from Call A (quarantine adapter).
            registry_version: Registry/catalog version string for audit.
            raw_prose_for_test_assertion: IGNORED at runtime — accepted only so tests
                can verify the adapter does NOT include raw prose in its prompts.

        Returns:
            GeneratorResult with spec (validated SpecRoot or SAFE_FALLBACK_SPEC),
            the number of attempts made, and whether Sonnet escalation occurred.
            Never raises — returns a fallback GeneratorResult on any exception.
        """
        try:
            return await self._repair_loop(extraction=extraction)
        except Exception:
            logger.warning(
                "genui_generator_failed",
                model_id=self._model_id,
                registry_version=registry_version,
                exc_info=True,
            )
            return GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=1, escalated=False)

    async def _repair_loop(
        self,
        *,
        extraction: QuarantineExtraction,
    ) -> GeneratorResult:
        """Run up to 3 attempts; feed validation errors back for repair (D-06/GEN-02).

        Tracks the number of attempts made and whether the Sonnet escalation model
        was used, so the caller can record accurate audit data (WR-03/04/05).
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

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": initial_user_content},
        ]

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

            # Parse candidate from tool_use block
            candidate = self._parse_response(response)
            if candidate is None:
                error_msg = "Model did not call emit_ui_spec tool"
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
        return GeneratorResult(spec=SAFE_FALLBACK_SPEC, attempts=_max_attempts, escalated=True)

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
