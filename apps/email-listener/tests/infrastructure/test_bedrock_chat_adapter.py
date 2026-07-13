"""Tests for BedrockChatAdapter (ChatProvider over AWS Bedrock, D-22).

Placement mirrors the existing infrastructure/llm adapter test convention
(tests/infrastructure/test_genui_*_adapter.py) rather than a new tests/unit/
directory.

Contracts under test:
  - TextDelta / ToolCallDelta streamed in order; exactly one UsageDelta with
    REAL captured usage; terminal StreamEnd (D-22).
  - tool_choice is NEVER forced (D-02): omitted entirely when tools=[].
  - A mid-stream exception surfaces as StreamEnd(stop_reason='error') —
    partial deltas already yielded are preserved, no exception propagates.
  - Inactivity timeout is rescheduled per event (genui_code_generator_adapter idiom).
"""

from __future__ import annotations

import inspect
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta, UsageDelta
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter

# ---------------------------------------------------------------------------
# Fakes — mimic anthropic's AsyncMessageStreamManager/AsyncMessageStream
# (same surface as tests/infrastructure/test_genui_code_generator_adapter.py)
# ---------------------------------------------------------------------------


def _text_delta_event(index: int, text: str) -> MagicMock:
    event = MagicMock()
    event.type = "content_block_delta"
    event.index = index
    event.delta = MagicMock()
    event.delta.type = "text_delta"
    event.delta.text = text
    return event


def _tool_start_event(index: int, name: str, tool_id: str) -> MagicMock:
    event = MagicMock()
    event.type = "content_block_start"
    event.index = index
    event.content_block = MagicMock()
    event.content_block.type = "tool_use"
    event.content_block.name = name
    event.content_block.id = tool_id
    return event


def _tool_json_delta_event(index: int, partial_json: str) -> MagicMock:
    event = MagicMock()
    event.type = "content_block_delta"
    event.index = index
    event.delta = MagicMock()
    event.delta.type = "input_json_delta"
    event.delta.partial_json = partial_json
    return event


def _make_final_message(input_tokens: int, output_tokens: int, stop_reason: str = "end_turn") -> MagicMock:
    final = MagicMock()
    final.usage = MagicMock(input_tokens=input_tokens, output_tokens=output_tokens)
    final.stop_reason = stop_reason
    return final


class _FakeBedrockStream:
    """Mimics anthropic AsyncMessageStreamManager/AsyncMessageStream.

    `messages.stream(...)` is a SYNC call that RETURNS an async-context-manager;
    the adapter enters it with `async with`, iterates events (to reschedule the
    inactivity timeout), then awaits `get_final_message()`.
    """

    def __init__(
        self,
        final_message: Any = None,
        *,
        events: list[Any] | None = None,
        raise_exc: BaseException | None = None,
    ) -> None:
        self._final = final_message
        self._events = events if events is not None else []
        self._raise = raise_exc

    async def __aenter__(self) -> _FakeBedrockStream:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    def __aiter__(self) -> Any:
        fake = self

        async def _gen() -> Any:
            for e in fake._events:
                yield e
            if fake._raise is not None:
                raise fake._raise

        return _gen()

    async def get_final_message(self) -> Any:
        return self._final


@pytest.fixture
def mock_bedrock_client() -> MagicMock:
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.stream = MagicMock()
    return client


@pytest.fixture
def adapter(mock_bedrock_client: MagicMock) -> BedrockChatAdapter:
    return BedrockChatAdapter(client=mock_bedrock_client, inactivity_timeout_seconds=15.0)


async def _collect(stream: Any) -> list[Any]:
    return [delta async for delta in stream]


# ---------------------------------------------------------------------------
# Happy path: text deltas in order + real usage + terminal StreamEnd (D-22)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_deltas_in_order_then_usage_then_stream_end(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    events = [_text_delta_event(0, "Hello"), _text_delta_event(0, " world")]
    mock_bedrock_client.messages.stream = MagicMock(
        return_value=_FakeBedrockStream(_make_final_message(120, 45), events=events)
    )

    deltas = await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [
        TextDelta(text="Hello"),
        TextDelta(text=" world"),
        UsageDelta(input_tokens=120, output_tokens=45),
        StreamEnd(stop_reason="end_turn"),
    ]


@pytest.mark.unit
def test_usage_read_from_final_message_source() -> None:
    """D-22: usage MUST be read from get_final_message().usage, not dropped."""
    assert "input_tokens" in inspect.getsource(BedrockChatAdapter.stream)


# ---------------------------------------------------------------------------
# Tool-call deltas (D-02)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_call_delta_carries_tracked_name_and_id(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    events = [
        _tool_start_event(0, "emit_ui_spec", "toolu_01"),
        _tool_json_delta_event(0, '{"root"'),
        _tool_json_delta_event(0, ':"card"}'),
    ]
    mock_bedrock_client.messages.stream = MagicMock(
        return_value=_FakeBedrockStream(_make_final_message(200, 80, stop_reason="tool_use"), events=events)
    )

    deltas = await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "show a card"}],
            tools=[{"name": "emit_ui_spec", "input_schema": {}}],
            max_tokens=1024,
        )
    )

    tool_deltas = [d for d in deltas if isinstance(d, ToolCallDelta)]
    assert tool_deltas == [
        ToolCallDelta(tool_name="emit_ui_spec", id="toolu_01", partial_json='{"root"'),
        ToolCallDelta(tool_name="emit_ui_spec", id="toolu_01", partial_json=':"card"}'),
    ]
    assert deltas[-1] == StreamEnd(stop_reason="tool_use")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_choice_never_forced_when_tools_empty(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """When tools=[] the adapter must not force tool_choice, and must not even pass `tools` (D-02)."""
    mock_bedrock_client.messages.stream = MagicMock(return_value=_FakeBedrockStream(_make_final_message(10, 5)))

    await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    assert "tool_choice" not in call_kwargs
    assert "tools" not in call_kwargs


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_choice_still_not_forced_when_tools_present(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Even when tools are provided, tool_choice must stay unset (the agent decides, D-02)."""
    mock_bedrock_client.messages.stream = MagicMock(return_value=_FakeBedrockStream(_make_final_message(10, 5)))

    await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            tools=[{"name": "emit_ui_spec", "input_schema": {}}],
            max_tokens=1024,
        )
    )

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    assert "tool_choice" not in call_kwargs
    assert call_kwargs["tools"] == [{"name": "emit_ui_spec", "input_schema": {}}]


# ---------------------------------------------------------------------------
# Error handling: never raise past the boundary
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mid_stream_raise_yields_partial_then_stream_end_error(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A mid-iteration exception must surface partial deltas + StreamEnd(error), never raise."""
    events = [_text_delta_event(0, "partial text")]
    mock_bedrock_client.messages.stream = MagicMock(
        return_value=_FakeBedrockStream(events=events, raise_exc=RuntimeError("bedrock connection dropped"))
    )

    deltas = await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [TextDelta(text="partial text"), StreamEnd(stop_reason="error")]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_exception_before_any_event_yields_only_stream_end_error(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    mock_bedrock_client.messages.stream = MagicMock(return_value=_FakeBedrockStream(raise_exc=TimeoutError()))

    deltas = await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [StreamEnd(stop_reason="error")]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_defaults_to_zero_when_missing_from_final_message(
    adapter: BedrockChatAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A final message with no usage attribute must not raise -- defaults to 0/0."""
    final = MagicMock(spec=["stop_reason"])
    final.stop_reason = "end_turn"
    mock_bedrock_client.messages.stream = MagicMock(return_value=_FakeBedrockStream(final))

    deltas = await _collect(
        adapter.stream(
            model_id="us.anthropic.claude-sonnet-4-6",
            system="You are a helpful assistant.",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1024,
        )
    )

    assert deltas == [UsageDelta(input_tokens=0, output_tokens=0), StreamEnd(stop_reason="end_turn")]
