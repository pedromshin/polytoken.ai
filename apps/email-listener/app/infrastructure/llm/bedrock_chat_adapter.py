"""BedrockChatAdapter — streams chat deltas via AWS Bedrock (Anthropic) + real usage capture (D-22).

Generalizes the genui_code_generator_adapter streaming idiom (messages.stream +
asyncio.timeout with per-event reschedule) into a ChatProvider implementation:
  - Iterates content_block_start / content_block_delta events, yielding
    TextDelta for text deltas and ToolCallDelta for tool-use partial JSON.
  - Inactivity timeout is rescheduled on EVERY event — a slow-but-steady
    multi-minute stream completes; only a genuine stall fails.
  - After the stream closes, get_final_message().usage carries the REAL
    input/output token counts (D-22 — never dropped) — yielded as exactly one
    UsageDelta, then a terminal StreamEnd.
  - tool_choice is NEVER forced here (D-02): the agent decides whether/when to
    call a tool. When `tools` is empty the model never even sees a tool exists.
  - Prompt caching (COST-01/D-21, mirroring genui_generator_adapter): a
    cache_control ephemeral breakpoint (Bedrock cachePoint) is placed on the
    LAST system block and on the LAST tool definition. Prompt render order is
    tools -> system -> messages, so the two breakpoints cache the full static
    prefix (tool schemas + system prompt) at cache-read pricing on every
    subsequent turn. Lossless: content is never altered — only cache_control
    markers are added, on copies (caller-provided dicts are never mutated).
  - Never raises past this boundary: any exception mid-stream surfaces as
    StreamEnd(stop_reason='error') — no unhandled exception escapes.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

import structlog

from app.domain.ports.chat_provider import ChatDelta, StreamEnd, TextDelta, ToolCallDelta, UsageDelta

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Sequence

    from anthropic import AsyncAnthropicBedrock

logger = structlog.get_logger(__name__)

DEFAULT_CHAT_INACTIVITY_TIMEOUT_SECONDS = 90.0

_EPHEMERAL_CACHE_CONTROL: dict[str, str] = {"type": "ephemeral"}


def _system_with_cache_point(system: str | list[dict[str, Any]]) -> str | list[dict[str, Any]]:
    """Return `system` with a cache_control ephemeral breakpoint on its last block.

    A plain string is converted to the list-of-blocks form (cache_control
    requires block format — same conversion the genui adapter's
    _build_system_blocks performs, COST-01/D-21). A list gets a COPY of its
    last dict block with cache_control added; the caller's blocks are never
    mutated. An empty string/list and a block that already carries
    cache_control pass through unchanged (max-4-breakpoints budget stays with
    the caller in that case).
    """
    if isinstance(system, str):
        if not system:
            return system
        return [{"type": "text", "text": system, "cache_control": dict(_EPHEMERAL_CACHE_CONTROL)}]
    if not system:
        return system
    blocks = list(system)
    last = blocks[-1]
    if isinstance(last, dict) and "cache_control" not in last:
        blocks[-1] = {**last, "cache_control": dict(_EPHEMERAL_CACHE_CONTROL)}
    return blocks


def _tools_with_cache_point(tools: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the tool list with a cache_control ephemeral breakpoint on the LAST tool.

    Tools render first in the prompt (tools -> system -> messages), so one
    breakpoint on the final tool definition caches the entire tools-schema
    prefix (COST-01). The last tool dict is shallow-copied — the
    composition-time tool dicts built once in container.py are never mutated.
    """
    tool_list = list(tools)
    if not tool_list:
        return tool_list
    last = tool_list[-1]
    if isinstance(last, dict) and "cache_control" not in last:
        tool_list[-1] = {**last, "cache_control": dict(_EPHEMERAL_CACHE_CONTROL)}
    return tool_list


class BedrockChatAdapter:
    """ChatProvider implementation over AWS Bedrock's Anthropic Messages API.

    Authentication is via the ambient ECS task IAM role (the shared
    AsyncAnthropicBedrock client, same as every other Bedrock adapter in this
    codebase) — no API key.
    """

    def __init__(
        self,
        *,
        client: AsyncAnthropicBedrock,
        inactivity_timeout_seconds: float = DEFAULT_CHAT_INACTIVITY_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._timeout_seconds = inactivity_timeout_seconds

    async def stream(
        self,
        *,
        model_id: str,
        system: str | list[dict[str, Any]],
        messages: Sequence[dict[str, Any]],
        tools: Sequence[dict[str, Any]] = (),
        max_tokens: int,
        temperature: float = 1.0,
    ) -> AsyncIterator[ChatDelta]:
        """Stream chat deltas from Bedrock; yields real usage before the terminal StreamEnd.

        Never raises: any exception (timeout, transport error, malformed
        response) is logged server-side and surfaces as a single
        StreamEnd(stop_reason='error') instead of propagating.
        """
        stream_kwargs: dict[str, Any] = {
            "model": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            # COST-01/D-21: cache_control ephemeral on the last system block —
            # combined with the tools breakpoint below, the full static prefix
            # (tools -> system) is served at cache-read pricing on later turns.
            "system": _system_with_cache_point(system),
            "messages": list(messages),
        }
        # D-02: tool_choice is never forced on the chat path — "auto" (the SDK
        # default when tools are present) lets the agent decide whether to call
        # a tool at all. Omitting `tools` entirely when empty means the model
        # never even sees a tool exists.
        if tools:
            # COST-01: cache_control ephemeral on the LAST tool caches the
            # entire tools-schema prefix (tools render before system).
            stream_kwargs["tools"] = _tools_with_cache_point(tools)

        tool_use_by_index: dict[int, tuple[str, str]] = {}
        loop = asyncio.get_running_loop()

        try:
            async with self._client.messages.stream(**stream_kwargs) as bedrock_stream:  # type: ignore[call-overload]
                async with asyncio.timeout(self._timeout_seconds) as cm:
                    async for event in bedrock_stream:
                        cm.reschedule(loop.time() + self._timeout_seconds)
                        delta = self._delta_from_event(event, tool_use_by_index)
                        if delta is not None:
                            yield delta
                final = await bedrock_stream.get_final_message()
        except Exception:
            logger.warning("bedrock_chat_stream_failed", model_id=model_id, exc_info=True)
            yield StreamEnd(stop_reason="error")
            return

        usage = getattr(final, "usage", None)
        yield UsageDelta(
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
        )
        yield StreamEnd(stop_reason=getattr(final, "stop_reason", None) or "end_turn")

    @staticmethod
    def _delta_from_event(
        event: Any,
        tool_use_by_index: dict[int, tuple[str, str]],
    ) -> ChatDelta | None:
        """Translate one Bedrock stream event into zero or one typed delta.

        content_block_start (tool_use) only records the (name, id) pair for
        later input_json_delta events at the same index — it never yields
        itself. content_block_delta yields TextDelta / ToolCallDelta; any
        other event type (message_start, message_delta, message_stop,
        content_block_stop, thinking/citation deltas) is ignored here.
        """
        event_type = getattr(event, "type", None)
        if event_type == "content_block_start":
            block = event.content_block
            if getattr(block, "type", None) == "tool_use":
                tool_use_by_index[event.index] = (block.name, block.id)
            return None
        if event_type != "content_block_delta":
            return None

        delta = event.delta
        delta_type = getattr(delta, "type", None)
        if delta_type == "text_delta":
            return TextDelta(text=delta.text)
        if delta_type == "input_json_delta":
            tool_name, tool_id = tool_use_by_index.get(event.index, ("", ""))
            return ToolCallDelta(tool_name=tool_name, id=tool_id, partial_json=delta.partial_json)
        return None
