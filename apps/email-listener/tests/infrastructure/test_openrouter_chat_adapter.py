"""Tests for OpenRouterChatAdapter (ChatProvider over OpenAI-compatible SSE, D-07, D-22).

Placement mirrors the existing infrastructure/llm adapter test convention
(tests/infrastructure/test_genui_*_adapter.py) rather than a new tests/unit/
directory.

Uses httpx.MockTransport (built into httpx — no respx dependency needed) to
fake the OpenRouter HTTP surface without any network access.

Contracts under test:
  - TextDeltas parsed from SSE `data:` lines; one UsageDelta from the final
    `usage` object (prompt_tokens/completion_tokens -> input/output, D-22);
    terminal StreamEnd. `[DONE]` sentinel terminates cleanly.
  - Tool-call deltas parsed from OpenAI-compatible `tool_calls` chunks.
  - A missing OPENROUTER_API_KEY raises immediately (fail-closed, D-07) —
    never silently degrades into a generic HTTP error.
  - A non-2xx OpenRouter response yields StreamEnd(stop_reason='error') and
    does not raise.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta, UsageDelta
from app.infrastructure.llm.openrouter_chat_adapter import OpenRouterChatAdapter

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def _sse_body(chunks: list[dict[str, Any]]) -> bytes:
    """Build an OpenAI-compatible SSE response body from a list of chunk dicts."""
    lines = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
    lines += "data: [DONE]\n\n"
    return lines.encode()


def _mock_client(status_code: int, body: bytes) -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, content=body, headers={"content-type": "text/event-stream"})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _collect(stream: Any) -> list[Any]:
    return [delta async for delta in stream]


# ---------------------------------------------------------------------------
# Happy path: SSE text deltas + real usage + terminal StreamEnd (D-22)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_deltas_parsed_then_usage_then_stream_end() -> None:
    body = _sse_body(
        [
            {"choices": [{"index": 0, "delta": {"content": "Hello"}}]},
            {"choices": [{"index": 0, "delta": {"content": " world"}}]},
            {
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 50, "completion_tokens": 20},
            },
        ]
    )
    http_client = _mock_client(200, body)
    adapter = OpenRouterChatAdapter(
        api_key="test-key",
        base_url="https://openrouter.ai/api/v1",
        http_client=http_client,
        inactivity_timeout_seconds=15.0,
    )

    deltas = await _collect(
        adapter.stream(
            model_id="deepseek/deepseek-chat",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [
        TextDelta(text="Hello"),
        TextDelta(text=" world"),
        UsageDelta(input_tokens=50, output_tokens=20),
        StreamEnd(stop_reason="end_turn"),
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_done_sentinel_terminates_cleanly_with_no_trailing_deltas() -> None:
    """The [DONE] sentinel itself must not produce any delta -- only the terminal StreamEnd."""
    body = _sse_body([{"choices": [{"index": 0, "delta": {"content": "hi"}}]}])
    http_client = _mock_client(200, body)
    adapter = OpenRouterChatAdapter(api_key="test-key", http_client=http_client, inactivity_timeout_seconds=15.0)

    deltas = await _collect(
        adapter.stream(
            model_id="deepseek/deepseek-chat",
            system="",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [TextDelta(text="hi"), StreamEnd(stop_reason="end_turn")]


# ---------------------------------------------------------------------------
# Tool-call deltas (OpenAI-compatible tool_calls chunks)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_call_delta_parsed_from_sse() -> None:
    body = _sse_body(
        [
            {
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "call_1", "function": {"name": "emit_ui_spec", "arguments": ""}}
                            ]
                        },
                    }
                ]
            },
            {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"root":'}}]}}]},
            {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": '"card"}'}}]}}]},
        ]
    )
    http_client = _mock_client(200, body)
    adapter = OpenRouterChatAdapter(api_key="test-key", http_client=http_client, inactivity_timeout_seconds=15.0)

    deltas = await _collect(
        adapter.stream(
            model_id="z-ai/glm-4.6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "show a card"}],
            tools=[{"type": "function", "function": {"name": "emit_ui_spec"}}],
            max_tokens=1024,
        )
    )

    tool_deltas = [d for d in deltas if isinstance(d, ToolCallDelta)]
    assert tool_deltas == [
        ToolCallDelta(tool_name="emit_ui_spec", id="call_1", partial_json='{"root":'),
        ToolCallDelta(tool_name="emit_ui_spec", id="call_1", partial_json='"card"}'),
    ]
    assert deltas[-1] == StreamEnd(stop_reason="end_turn")


# ---------------------------------------------------------------------------
# Fail-closed on missing key (D-07)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_api_key_raises_fail_closed() -> None:
    """A missing OPENROUTER_API_KEY must raise immediately -- never silently degrade (D-07)."""
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200, content=b"")))
    adapter = OpenRouterChatAdapter(api_key="", http_client=http_client, inactivity_timeout_seconds=15.0)

    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        await _collect(
            adapter.stream(
                model_id="deepseek/deepseek-chat",
                system="",
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=1024,
            )
        )


# ---------------------------------------------------------------------------
# Non-2xx response: StreamEnd(error), never raise
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_non_2xx_response_yields_stream_end_error_not_raise() -> None:
    http_client = _mock_client(500, b"Internal Server Error")
    adapter = OpenRouterChatAdapter(api_key="test-key", http_client=http_client, inactivity_timeout_seconds=15.0)

    deltas = await _collect(
        adapter.stream(
            model_id="deepseek/deepseek-chat",
            system="",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [StreamEnd(stop_reason="error")]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_401_response_yields_stream_end_error_not_raise() -> None:
    """An auth failure from OpenRouter itself must not raise past this boundary."""
    http_client = _mock_client(401, b'{"error": "invalid api key"}')
    adapter = OpenRouterChatAdapter(api_key="bad-key", http_client=http_client, inactivity_timeout_seconds=15.0)

    deltas = await _collect(
        adapter.stream(
            model_id="deepseek/deepseek-chat",
            system="",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [StreamEnd(stop_reason="error")]


# ---------------------------------------------------------------------------
# Authorization header + payload shape
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_authorization_header_carries_bearer_token() -> None:
    captured: dict[str, Any] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, content=_sse_body([{"choices": [{"index": 0, "delta": {"content": "ok"}}]}]))

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = OpenRouterChatAdapter(api_key="secret-key-123", http_client=http_client, inactivity_timeout_seconds=15.0)

    await _collect(
        adapter.stream(
            model_id="deepseek/deepseek-chat",
            system="You are helpful.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert captured["authorization"] == "Bearer secret-key-123"
    assert captured["body"]["stream"] is True
    assert captured["body"]["model"] == "deepseek/deepseek-chat"
    assert captured["body"]["messages"][0] == {"role": "system", "content": "You are helpful."}
    assert captured["body"]["messages"][1] == {"role": "user", "content": "hi"}
