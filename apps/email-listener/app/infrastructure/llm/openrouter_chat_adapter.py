"""OpenRouterChatAdapter — OpenAI-compatible SSE chat stream + usage capture (D-07, D-22).

The second real ChatProvider implementation (BedrockChatAdapter is the first).
Streams over OpenRouter's OpenAI-compatible `/chat/completions` endpoint via
httpx (already a project dependency — no new package):
  - POSTs with `stream: true`; parses `data: {...}` SSE lines into
    TextDelta / ToolCallDelta; the `[DONE]` sentinel terminates cleanly.
  - Reads the terminal chunk's `usage` object into exactly one UsageDelta
    (prompt_tokens -> input_tokens, completion_tokens -> output_tokens; D-22 —
    the same real-usage contract as BedrockChatAdapter), then a StreamEnd.
  - OPENROUTER_API_KEY is read server-side only (settings.openrouter_api_key
    property, T-22-06). A missing key is a configuration error: this adapter
    raises immediately rather than attempting the request and silently
    degrading into a generic HTTP error (fail-closed, D-07).
  - A non-2xx OpenRouter response is NOT a configuration error — it surfaces
    as StreamEnd(stop_reason='error') with the body logged server-side only
    (never leaked to the caller), matching BedrockChatAdapter's "never raise
    past this boundary" contract for provider/network failures.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

import structlog

from app.domain.ports.chat_provider import ChatDelta, StreamEnd, TextDelta, ToolCallDelta, UsageDelta

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Sequence

    import httpx

logger = structlog.get_logger(__name__)

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_CHAT_INACTIVITY_TIMEOUT_SECONDS = 90.0

_DONE_SENTINEL = "[DONE]"


class OpenRouterChatAdapter:
    """ChatProvider implementation over OpenRouter's OpenAI-compatible SSE endpoint."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_OPENROUTER_BASE_URL,
        http_client: httpx.AsyncClient,
        inactivity_timeout_seconds: float = DEFAULT_CHAT_INACTIVITY_TIMEOUT_SECONDS,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._http_client = http_client
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
        """Stream chat deltas from OpenRouter; yields real usage before the terminal StreamEnd.

        Raises RuntimeError immediately (fail-closed, D-07) when OPENROUTER_API_KEY
        is unconfigured — this is a startup-style misconfiguration, not a
        streamable provider error. All other failures (network, non-2xx,
        malformed SSE) surface as StreamEnd(stop_reason='error') instead of raising.
        """
        if not self._api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY is not configured. Set it via the settings/secret "
                "manager before invoking OpenRouterChatAdapter (fail-closed, D-07)."
            )

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": _to_openai_messages(system, messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        if tools:
            payload["tools"] = list(tools)

        headers = {"Authorization": f"Bearer {self._api_key}"}
        tool_call_names: dict[int, tuple[str, str]] = {}
        loop = asyncio.get_running_loop()

        try:
            async with self._http_client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    logger.warning(
                        "openrouter_chat_http_error",
                        model_id=model_id,
                        status_code=response.status_code,
                        body=body.decode(errors="replace")[:2000],
                    )
                    yield StreamEnd(stop_reason="error")
                    return

                async with asyncio.timeout(self._timeout_seconds) as cm:
                    async for line in response.aiter_lines():
                        cm.reschedule(loop.time() + self._timeout_seconds)
                        stripped = line.strip()
                        if not stripped.startswith("data:"):
                            continue
                        data = stripped[len("data:") :].strip()
                        if data == _DONE_SENTINEL:
                            break
                        for delta in self._deltas_from_chunk(data, tool_call_names):
                            yield delta

            yield StreamEnd(stop_reason="end_turn")
        except Exception:
            logger.warning("openrouter_chat_stream_failed", model_id=model_id, exc_info=True)
            yield StreamEnd(stop_reason="error")

    @staticmethod
    def _deltas_from_chunk(
        data: str,
        tool_call_names: dict[int, tuple[str, str]],
    ) -> list[ChatDelta]:
        """Parse one SSE `data:` payload (already stripped of prefix + [DONE]) into typed deltas."""
        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            logger.warning("openrouter_chat_bad_chunk")
            return []

        deltas: list[ChatDelta] = []

        usage = chunk.get("usage")
        if usage:
            deltas.append(
                UsageDelta(
                    input_tokens=usage.get("prompt_tokens", 0) or 0,
                    output_tokens=usage.get("completion_tokens", 0) or 0,
                )
            )

        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if content:
                deltas.append(TextDelta(text=content))

            for tool_call in delta.get("tool_calls") or []:
                index = tool_call.get("index", 0)
                function = tool_call.get("function") or {}
                name = function.get("name")
                tool_id = tool_call.get("id") or ""
                if name:
                    tool_call_names[index] = (name, tool_id)
                tracked_name, tracked_id = tool_call_names.get(index, (name or "", tool_id))
                arguments = function.get("arguments")
                if arguments:
                    deltas.append(ToolCallDelta(tool_name=tracked_name, id=tracked_id, partial_json=arguments))

        return deltas


def _to_openai_messages(
    system: str | list[dict[str, Any]],
    messages: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Translate Anthropic-shaped system/messages into OpenAI-compatible chat messages.

    Keeps this adapter's public message shape identical to BedrockChatAdapter's
    (both accept the same Anthropic-style system/messages the chat agent builds
    once) while OpenRouter's OpenAI-compatible endpoint needs a flat
    `[{role, content}, ...]` list with a leading system message. Only text
    content is flattened here — tool_use/tool_result block translation is a
    Phase 24 concern (no OpenRouter registry entry is genui-capable in Phase 22,
    so no tool round-trip needs to cross this adapter yet).
    """
    openai_messages: list[dict[str, Any]] = []
    system_text = _flatten_text_blocks(system)
    if system_text:
        openai_messages.append({"role": "system", "content": system_text})

    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        openai_messages.append({"role": role, "content": _flatten_text_blocks(content)})

    return openai_messages


def _flatten_text_blocks(blocks: str | list[Any]) -> str:
    """Join every text block's `text` field into one string; strings pass through unchanged."""
    if isinstance(blocks, str):
        return blocks
    parts: list[str] = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "".join(parts)
