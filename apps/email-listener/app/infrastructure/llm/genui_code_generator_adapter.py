"""GenuiCodeGeneratorAdapter — Call B of the code-island generation path.

This is a PARALLEL path to the declarative spec generator (genui_generator_adapter).
Instead of emitting a schema-bound SpecRoot dict, it emits ARBITRARY self-contained
plain-JavaScript "island" code via Bedrock forced tool-use. The declarative spec
path is untouched by this module.

Security/correctness contracts (mirror genui_generator_adapter):
  - SAFE-02 (D-09): Raw prose NEVER enters the generator prompt.
    Only the structured QuarantineExtraction (entity_type, intent_summary,
    confidence) is passed via <DATA_SECTION> JSON.
  - D-02: Forced tool-use (emit_code_island tool; tool_choice type=tool).
  - D-05: Haiku for attempts 1-2, Sonnet escalation on attempt 3.
  - D-07: SAFE_FALLBACK_CODE — hardcoded Python constant (never loaded from file)
    returned after 3 failures or on timeout/exception.
  - D-16: max_tokens set on every call.
  - D-17: asyncio.timeout wraps every call.
  - D-18: temperature=0 on every call.
  - D-21: cache_control ephemeral on the static system prompt block.

No eval/exec/compile anywhere on this path (D-24). The emitted code is treated as
inert text here — a downstream AST allowlist hard-blocks unsafe constructs before
it is ever executed.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# SAFE_FALLBACK_CODE (D-07) — hardcoded constant, NOT loaded from file.
# A tiny, safe, self-contained JS program that appends an accessible message to
# #island-root. Uses only DOM APIs — no imports, no eval/Function, no network,
# no storage. Returned on timeout, exception, or after all attempts are exhausted.
# ---------------------------------------------------------------------------

SAFE_FALLBACK_CODE: str = (
    "const root = document.getElementById('island-root');\n"
    "const message = document.createElement('p');\n"
    "message.setAttribute('role', 'alert');\n"
    "message.textContent = 'Unable to generate a widget for this request';\n"
    "root.appendChild(message);\n"
)

# ---------------------------------------------------------------------------
# Emit-code-island tool definition (D-02)
# Hand-written input_schema — code is free-form (no spec.schema.json).
# ---------------------------------------------------------------------------

_EMIT_TOOL_NAME = "emit_code_island"

_EMIT_CODE_ISLAND_TOOL: dict[str, Any] = {
    "name": _EMIT_TOOL_NAME,
    "description": (
        "Emit a single self-contained plain-JavaScript program that builds the "
        "requested UI against a fresh document. Return ONLY the code via this tool "
        "— no prose or explanations."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": (
                    "The self-contained plain-JavaScript island program. Vanilla DOM "
                    "APIs only — no imports, no JSX, no React, no network, no storage."
                ),
            },
            "language": {
                "type": "string",
                "enum": ["javascript"],
                "description": "Programming language of the emitted code. Always 'javascript'.",
            },
        },
        "required": ["code", "language"],
        "additionalProperties": False,
    },
}

if TYPE_CHECKING:
    _EMIT_TOOL: ToolParam = cast("ToolParam", _EMIT_CODE_ISLAND_TOOL)
else:
    _EMIT_TOOL = _EMIT_CODE_ISLAND_TOOL


# ---------------------------------------------------------------------------
# System prompt (static, trusted — never interpolated with untrusted content)
# cache_control ephemeral applied as list-of-blocks (D-21)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEXT = (
    "You are a UI code generator. "
    "Your task is to produce a single self-contained plain-JavaScript program using the "
    "emit_code_island tool, for ANY design the user asks for.\n\n"
    "You will receive a structured data section (<DATA_SECTION>) containing:\n"
    "  - entity_type: the UI component type hint from classification\n"
    "  - intent_summary: a brief description of what to display\n"
    "  - confidence: classification confidence level\n\n"
    "Runtime contract:\n"
    "- The program runs against a fresh document that already contains a mount point: "
    'a <div id="island-root">. Build the UI by appending DOM nodes to it using the '
    "standard DOM APIs (document.createElement, element.appendChild, textContent, "
    "setAttribute, addEventListener, style properties, etc.).\n"
    "- The program must be a single self-contained plain-JavaScript program that runs DIRECTLY "
    "as a classic <script> (NOT a module). Build the UI purely by DOM mutation.\n"
    "- It is NOT a module: NO `import`, NO `export`, NO `exports`, NO `module.exports`, NO "
    "`require`, NO JSX, NO React or any other framework. Do NOT wrap the output in module or "
    "CommonJS boilerplate. Just write statements that create and append DOM nodes.\n\n"
    "Hard restrictions (these are also hard-blocked downstream by an AST allowlist — "
    "code that violates them is rejected):\n"
    "- NO import / export / exports / module.exports / require of any kind.\n"
    "- NO eval, no Function constructor, no setTimeout/setInterval with string arguments.\n"
    "- NO network access: no fetch, no XMLHttpRequest, no WebSocket, no EventSource.\n"
    "- NO window.parent, window.top, or window.opener access.\n"
    "- NO document.cookie.\n"
    "- NO localStorage, sessionStorage, or indexedDB.\n"
    "- OFFLINE only: no external assets, stylesheets, fonts, images, or URLs (they are blocked "
    "by CSP). Use inline CSS; for imagery use CSS gradients/shapes or inline SVG (data: URIs "
    "for <img> are allowed), never remote URLs.\n\n"
    "DESIGN QUALITY — this is the point (do NOT emit generic boilerplate):\n"
    "- Produce a POLISHED, DISTINCTIVE, production-grade design that genuinely LOOKS like the "
    "thing requested — not a plain stack of default-styled cards. If asked for a Twitter clone, "
    "it should read as Twitter (dense timeline, avatars, engagement icons, sticky nav rail, "
    "compose box); if asked for a specific brand, match its actual look and feel.\n"
    "- Use rich, intentional CSS: a real layout (CSS grid/flex, sidebars, sticky headers), a "
    "cohesive color system, a modern system-font stack (e.g. -apple-system, Segoe UI, Roboto), "
    "a type scale, spacing rhythm, borders/dividers, shadows, rounded corners, hover/focus "
    "states, and subtle transitions. Support the requested aesthetic (dark mode if implied).\n"
    "- Make it interactive where the domain implies it (tabs, toggles, like buttons that "
    "increment, a working compose box) using addEventListener + local JS state.\n"
    "- Populate with realistic, specific, representative content (real-sounding names, copy, "
    "numbers) — never lorem ipsum or 'Item 1/2/3'.\n\n"
    "Rules:\n"
    "- Output ONLY via the emit_code_island tool — no prose, no markdown, no code fences.\n"
    "- Build a concrete, complete UI; keep it accessible (labels, alt text, aria where needed, "
    "sufficient contrast). Do NOT describe it or emit placeholder/meta-commentary.\n"
    'Call emit_code_island with { code, language: "javascript" }.'
)


def _build_system_blocks() -> list[dict[str, Any]]:
    """System prompt as a single cache_control ephemeral block (D-21).

    The prompt is static trusted content, so the whole block stays cacheable
    (COST-01 / D-21): the big prefix is cached and per-request input carries only
    the DATA_SECTION.
    """
    return [
        {
            "type": "text",
            "text": _SYSTEM_PROMPT_TEXT,
            "cache_control": {"type": "ephemeral"},
        }
    ]


# ---------------------------------------------------------------------------
# CodeGeneratorResult — structured output from generate()
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CodeGeneratorResult:
    """Immutable result of a GenuiCodeGeneratorAdapter.generate() call.

    Mirrors GeneratorResult from the declarative path: exposes the emitted code,
    the number of attempts made, whether the escalation model (Sonnet) was used,
    and an explicit is_fallback flag so the use case can record accurate audit data.
    """

    code: str
    """The emitted JavaScript island code, or SAFE_FALLBACK_CODE on total failure."""

    language: str
    """Emitted language — always 'javascript' (fallback uses 'javascript' too)."""

    attempts: int
    """Number of generation attempts made (1-3)."""

    escalated: bool
    """True when the Sonnet escalation model was used on attempt 3."""

    is_fallback: bool = False
    """True when code is SAFE_FALLBACK_CODE (timeout, exception, or all attempts
    exhausted). Set structurally by the adapter — never inferred from code content."""


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class GenuiCodeGeneratorAdapter:
    """Call B (code-island path): emit_code_island forced tool-use with escalation.

    Receives only the structured QuarantineExtraction — NEVER raw prose (SAFE-02).
    Returns arbitrary self-contained JavaScript code, or SAFE_FALLBACK_CODE on
    total failure. This is a parallel path to GenuiGeneratorAdapter; neither touches
    the other's schema, prompt, or fallback constant.
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
        importer_id: str | None = None,
    ) -> CodeGeneratorResult:
        """Generate a self-contained JavaScript island from the quarantine extraction.

        Args:
            extraction: Structured output from Call A (quarantine adapter). Only this
                structured data crosses to the generator — never raw prose (SAFE-02).
            importer_id: Optional importer context (logged for traceability only).

        Returns:
            CodeGeneratorResult with code (emitted JavaScript or SAFE_FALLBACK_CODE),
            the number of attempts made, and whether Sonnet escalation occurred.
            Never raises — returns a fallback CodeGeneratorResult on any exception.
        """
        try:
            return await self._generation_loop(extraction=extraction)
        except Exception:
            logger.warning(
                "genui_code_generator_failed",
                model_id=self._model_id,
                importer_id=importer_id,
                exc_info=True,
            )
            return CodeGeneratorResult(
                code=SAFE_FALLBACK_CODE,
                language="javascript",
                attempts=1,
                escalated=False,
                is_fallback=True,
            )

    async def _generation_loop(
        self,
        *,
        extraction: QuarantineExtraction,
    ) -> CodeGeneratorResult:
        """Run up to 3 attempts; escalate to Sonnet on attempt 3 (D-05).

        Tracks the number of attempts made and whether the Sonnet escalation model
        was used so the caller can record accurate audit data.
        """
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
            "Generate a self-contained JavaScript island using the emit_code_island tool."
        )

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": initial_user_content},
        ]

        _max_attempts = 3
        for attempt in range(_max_attempts):
            # Attempt 3 (index 2) escalates to Sonnet (D-05)
            escalated_this_attempt = attempt == 2
            model_id = self._escalation_model_id if escalated_this_attempt else self._model_id

            response = await self._stream_message(
                model_id=model_id, system_blocks=system_blocks, messages=messages
            )

            candidate = self._parse_response(response)
            if candidate is not None:
                code, language = candidate
                return CodeGeneratorResult(
                    code=code,
                    language=language,
                    attempts=attempt + 1,
                    escalated=escalated_this_attempt,
                )

            logger.warning(
                "genui_code_generator_no_tool_use",
                attempt=attempt + 1,
                max_attempts=_max_attempts,
            )

            # Feed a retry instruction for the next attempt (mirror repair loop)
            if attempt < _max_attempts - 1:
                messages = [
                    *messages,
                    {
                        "role": "assistant",
                        "content": response.content,  # type: ignore[attr-defined]
                    },
                    {
                        "role": "user",
                        "content": (
                            "The previous response did not call emit_code_island with valid "
                            "output. Please call emit_code_island again with a self-contained "
                            "JavaScript program and language='javascript'."
                        ),
                    },
                ]

        # All 3 attempts failed → SAFE_FALLBACK_CODE (D-07)
        logger.error(
            "genui_code_generator_all_attempts_failed",
            max_attempts=_max_attempts,
        )
        return CodeGeneratorResult(
            code=SAFE_FALLBACK_CODE,
            language="javascript",
            attempts=_max_attempts,
            escalated=True,
            is_fallback=True,
        )

    async def _stream_message(
        self,
        *,
        model_id: str,
        system_blocks: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> Any:
        """Stream the generation, enforcing an INACTIVITY timeout between events.

        Bedrock InvokeModel is non-streaming — it buffers the ENTIRE completion before
        returning response headers — so a total-time timeout is fragile: a large custom UI
        (thousands of tokens at Bedrock throughput) reliably exceeds any fixed cap and falls
        back. Streaming yields events continuously; we reschedule the deadline on every event,
        so we fail ONLY if the stream stalls for `self._timeout_seconds` (a genuinely stuck
        call), letting a slow-but-steady multi-minute generation complete. Returns the
        accumulated final Message (the forced tool_use block is fully parsed).
        """
        loop = asyncio.get_running_loop()
        start = loop.time()
        # Logs the ACTUAL timeout this (possibly cached/stale) process is using + streaming timing,
        # so a stale-settings vs slow-Bedrock diagnosis is unambiguous from the logs.
        logger.info(
            "genui_code_stream_start",
            model_id=model_id,
            timeout_seconds=self._timeout_seconds,
            max_tokens=self._max_tokens,
        )
        first_event_at: float | None = None
        async with self._client.messages.stream(  # type: ignore[call-overload]
            model=model_id,
            max_tokens=self._max_tokens,
            temperature=0,
            system=system_blocks,
            tools=[_EMIT_TOOL],
            tool_choice={"type": "tool", "name": _EMIT_TOOL_NAME},
            messages=messages,
        ) as stream:
            async with asyncio.timeout(self._timeout_seconds) as cm:
                async for _event in stream:
                    if first_event_at is None:
                        first_event_at = loop.time()
                        logger.info(
                            "genui_code_stream_first_event",
                            elapsed_s=round(first_event_at - start, 2),
                        )
                    # Each streamed event = activity → push the inactivity deadline forward.
                    cm.reschedule(loop.time() + self._timeout_seconds)
                final = await stream.get_final_message()
        logger.info("genui_code_stream_done", elapsed_s=round(loop.time() - start, 2))
        return final

    def _parse_response(self, response: Any) -> tuple[str, str] | None:
        """Extract (code, language) from the emit_code_island tool_use block.

        Returns None if no valid tool_use block with a non-empty string code is
        present. The language is clamped to 'javascript' (defence-in-depth: the
        model may ignore the enum in constrained-decoding mode).
        """
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                raw_input: dict[str, Any] = dict(block.input)
            except (TypeError, ValueError):
                logger.warning("genui_code_generator_parse_failed", exc_info=True)
                return None
            code = raw_input.get("code")
            if not isinstance(code, str) or not code.strip():
                logger.warning("genui_code_generator_empty_code")
                return None
            language = raw_input.get("language")
            # Clamp to the only allowed language (defence-in-depth)
            if language != "javascript":
                language = "javascript"
            return (code, language)
        return None
