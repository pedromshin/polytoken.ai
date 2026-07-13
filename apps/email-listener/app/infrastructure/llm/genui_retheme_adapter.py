"""GenuiRethemeAdapter — PANL-04's one-shot NL re-theme resolution (RethemeResolverPort).

Security/correctness contracts:
  - ONE Bedrock forced-tool-use call — NO repair loop, NO screenshot judging
    (locked, 52-CONTEXT.md / 52-05-PLAN.md).
  - Forced tool-use: emit_retheme tool constrains style_pack_id to
    STYLE_PACK_IDS and token_overrides to ALLOWED_OVERRIDE_KEYS
    (additionalProperties: false) at the Bedrock tool-schema level — a FIRST
    belt; ResolveRethemeUseCase (application layer) re-validates the parsed
    result as a SECOND belt; the tRPC web boundary is the AUTHORITATIVE gate
    (GEN-03/D-08, T-52-05-01/02).
  - temperature=0 (deterministic pack/override choice for a given instruction).
  - asyncio.timeout wraps the call (mirrors genui_generator_adapter's D-17).
  - This adapter never swallows failures itself: a missing tool_use block, a
    missing/non-string style_pack_id, a timeout, or any transport error all
    propagate as an exception. ResolveRethemeUseCase is the sole catcher
    (mirrors the port's documented raise-on-failure contract) — this class
    intentionally does NOT return a fallback value itself.

No eval/exec/compile on this path (D-24, mirrors genui_generator_adapter).
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, cast

import structlog

from app.domain.ports.retheme_resolver import ALLOWED_OVERRIDE_KEYS, RethemeResolution
from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS

if TYPE_CHECKING:
    from anthropic import AsyncAnthropicBedrock
    from anthropic.types import ToolParam

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# emit_retheme tool definition — forced tool-use (mirrors D-02's emit_ui_spec)
# ---------------------------------------------------------------------------

_EMIT_TOOL_NAME = "emit_retheme"


def _build_emit_retheme_tool() -> dict[str, Any]:
    """Build the emit_retheme tool dict — style_pack_id enum + bounded token_overrides."""
    return {
        "name": _EMIT_TOOL_NAME,
        "description": (
            "Emit the resolved re-theme choice for this instruction: a single "
            "best-fit style_pack_id, plus OPTIONAL bounded token_overrides. "
            "Return ONLY via this tool — no prose."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "style_pack_id": {
                    "type": "string",
                    "enum": list(STYLE_PACK_IDS),
                    "description": "The single best-fit style pack id for the instruction.",
                },
                "token_overrides": {
                    "type": "object",
                    "description": (
                        "OPTIONAL bounded presentational nudges. Keys MUST be "
                        "drawn only from the allowed set; omit entirely when no "
                        "nudge is warranted."
                    ),
                    "properties": {key: {"type": "string"} for key in ALLOWED_OVERRIDE_KEYS},
                    "additionalProperties": False,
                },
            },
            "required": ["style_pack_id"],
            "additionalProperties": False,
        },
    }


# ---------------------------------------------------------------------------
# System prompt (static, trusted — the instruction is placed in the user
# turn only inside a delimited section; this block never interpolates
# untrusted content).
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEXT = (
    "You are a design-system re-theme resolver. Given a natural-language "
    "instruction describing a desired visual mood, and a catalog of available "
    "style packs, pick the SINGLE best-fit pack and optionally propose a small "
    "number of bounded token nudges.\n\n"
    "Rules:\n"
    "- Output ONLY via the emit_retheme tool — no prose.\n"
    "- Always choose exactly one style_pack_id from the catalog provided.\n"
    "- token_overrides is OPTIONAL — omit it (or leave it empty) when the "
    "chosen pack alone already satisfies the instruction. Only propose a "
    "nudge when the instruction asks for something the pack swap alone "
    "cannot express.\n"
    "- token_overrides keys MUST be drawn only from the allowed set provided "
    "in the user message — never invent a new key.\n"
    "- Color-family override VALUES (primary/accent/secondary) MUST be an HSL "
    "channel triplet string, e.g. '220 14% 10%' — never a hex code, name, or "
    "rgb()/hsl() function wrapper.\n"
    "- The 'radius' override VALUE MUST be a raw CSS length with a rem or px "
    "unit, e.g. '0.75rem' or '9999px' — never a bare word like 'high' or "
    "'large', and never a unitless number.\n"
    "- The 'spacing-density' override VALUE MUST be a raw CSS length in rem, "
    "e.g. '1.25rem' — never a bare word or a px/unitless value.\n"
    "- This is a ONE-SHOT decision: there is no follow-up turn to refine your "
    "answer, so commit to your best single choice."
)


def _build_system_blocks() -> list[dict[str, Any]]:
    """Static system prompt as a single block (no cache_control — single-shot, low-volume call)."""
    return [{"type": "text", "text": _SYSTEM_PROMPT_TEXT}]


# ---------------------------------------------------------------------------
# Prompt assembly (pure, separately-tested helper — 52-05-PLAN.md Task 1)
# ---------------------------------------------------------------------------

# Short personality blurbs mirroring packages/genui/src/theme/packs.ts's own
# `description` field per pack — kept here (not in genui_style_packs.py,
# which is a strict STYLE_PACK_IDS-parity-only module) since this text is
# prompt-assembly detail, not an identity contract.
_PACK_PERSONALITIES: Mapping[str, str] = {
    "polytoken-teal": (
        "Default brand palette — dark teal primary, clean light surface. Professional, calm, trustworthy."
    ),
    "linear-clean": (
        "Monochrome precision-SaaS — slate tones, tight radius. Engineered, minimal, no-nonsense clarity."
    ),
    "warm-editorial": (
        "Editorial warmth — amber primary, sand surface, serif typography. Human, inviting, magazine-like."
    ),
    "brutalist": (
        "Bold high-contrast brutalism — pure black primary, zero radius, "
        "monospace type. Stark, raw, unapologetically bold."
    ),
    "corporate-saas": (
        "Enterprise trust palette — confident blue, conservative corners. Formal, dependable, boardroom-ready."
    ),
    "playful-rounded": (
        "Friendly and vibrant — purple primary, high radius, warm shadows. Playful, energetic, approachable."
    ),
}


def build_retheme_messages(
    instruction: str,
    current_style_pack_id: str | None,
    pack_catalog: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Pure helper: assemble the single user-turn message for the emit_retheme call.

    PURE (no I/O, no Bedrock call) so it is independently unit-testable —
    52-05-PLAN.md Task 1's acceptance criteria requires asserting on the
    assembled content directly. Lists every pack in pack_catalog with its
    personality blurb and the allowed override-key list, then asks the model
    to pick the best-fit pack + optional bounded nudges.

    Args:
        instruction: Free-text NL instruction (untrusted; placed verbatim
            inside a delimited <INSTRUCTION> section — never interpolated
            into the system prompt).
        current_style_pack_id: The panel's current pack id, or None.
        pack_catalog: Mapping of pack id -> short personality description.
            Callers pass _PACK_PERSONALITIES in production; tests may pass a
            smaller/different fixture map (the helper itself has no
            dependency on the real registry).

    Returns:
        A one-element messages list (role="user") ready for
        AsyncAnthropicBedrock.messages.create(messages=...).
    """
    catalog_lines = "\n".join(f"  - {pack_id}: {description}" for pack_id, description in pack_catalog.items())
    allowed_keys_line = ", ".join(ALLOWED_OVERRIDE_KEYS)
    current_pack_line = current_style_pack_id if current_style_pack_id is not None else "(none set — base default)"

    user_content = (
        "<STYLE_PACK_CATALOG>\n"
        f"{catalog_lines}\n"
        "</STYLE_PACK_CATALOG>\n\n"
        f"Current style pack: {current_pack_line}\n"
        f"Allowed token_overrides keys: {allowed_keys_line}\n\n"
        f"<INSTRUCTION>{instruction}</INSTRUCTION>\n\n"
        "Call emit_retheme with the single best-fit style_pack_id (and, only "
        "if warranted, bounded token_overrides using ONLY the allowed keys "
        "above)."
    )
    return [{"role": "user", "content": user_content}]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class RethemeResolutionError(Exception):
    """Raised when the Bedrock response cannot be parsed into a RethemeResolution.

    Caught solely by ResolveRethemeUseCase (application layer) — this adapter
    never swallows it itself, per the port's documented raise-on-failure
    contract.
    """


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class GenuiRethemeAdapter:
    """RethemeResolverPort implementation: ONE Bedrock forced tool-use call.

    No repair loop, no screenshot judging (locked). Reuses the SAME
    AsyncAnthropicBedrock client as GenuiGeneratorAdapter (DI singleton,
    container.py) — no new Bedrock transport.
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        model_id: str,
        max_tokens: int = 512,
        timeout_seconds: float = 15.0,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._timeout_seconds = timeout_seconds

    async def resolve(
        self,
        *,
        instruction: str,
        current_style_pack_id: str | None,
    ) -> RethemeResolution:
        """Resolve instruction -> RethemeResolution via ONE forced tool-use call.

        Raises:
            Exception: on timeout, transport error, missing tool_use block, or
                a missing/non-string style_pack_id in the parsed tool input.
                Callers (ResolveRethemeUseCase) are solely responsible for
                catching this and degrading to a fallback.
        """
        emit_tool = _build_emit_retheme_tool()
        system_blocks = _build_system_blocks()
        messages = build_retheme_messages(instruction, current_style_pack_id, _PACK_PERSONALITIES)

        if TYPE_CHECKING:
            emit_tool_typed: ToolParam = cast("ToolParam", emit_tool)
        else:
            emit_tool_typed = emit_tool

        async with asyncio.timeout(self._timeout_seconds):
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self._model_id,
                max_tokens=self._max_tokens,
                temperature=0,
                system=system_blocks,
                tools=[emit_tool_typed],
                tool_choice={"type": "tool", "name": _EMIT_TOOL_NAME},
                messages=messages,
            )

        candidate = self._parse_response(response)
        if candidate is None:
            raise RethemeResolutionError("Model did not call emit_retheme tool")

        style_pack_id = candidate.get("style_pack_id")
        if not isinstance(style_pack_id, str) or not style_pack_id:
            raise RethemeResolutionError("emit_retheme returned a missing/non-string style_pack_id")

        raw_overrides = candidate.get("token_overrides")
        token_overrides: dict[str, str] = {}
        if isinstance(raw_overrides, dict):
            token_overrides = {str(key): str(value) for key, value in raw_overrides.items()}

        return RethemeResolution(style_pack_id=style_pack_id, token_overrides=token_overrides)

    def _parse_response(self, response: Any) -> dict[str, Any] | None:
        """Extract the tool input dict from the emit_retheme tool_use block."""
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            try:
                return dict(block.input)
            except (TypeError, ValueError):
                logger.warning("genui_retheme_parse_failed", exc_info=True)
                return None
        return None
