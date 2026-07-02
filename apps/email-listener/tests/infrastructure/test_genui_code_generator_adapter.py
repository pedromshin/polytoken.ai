"""Tests for GenuiCodeGeneratorAdapter (Call B — code-island generation).

This is the PARALLEL path to the declarative generator. Contracts mirror
test_genui_generator_adapter:
  - Generator NEVER receives raw prose (SAFE-02, D-09): only the structured
    QuarantineExtraction as <DATA_SECTION> JSON.
  - Forced tool-use: emit_code_island tool with a HAND-WRITTEN input_schema (D-02).
  - max_tokens always set (D-16); temperature=0 (D-18).
  - asyncio.timeout wraps every call (D-17).
  - Attempt 1-2: primary model (Haiku); attempt 3: escalation (Sonnet) (D-05).
  - After 3 failures → SAFE_FALLBACK_CODE + is_fallback (D-07).
  - cache_control ephemeral on the static system prompt block (D-21).
  - On timeout/exception: return SAFE_FALLBACK_CODE, never raise.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.infrastructure.llm.genui_code_generator_adapter import (
    _EMIT_CODE_ISLAND_TOOL,
    SAFE_FALLBACK_CODE,
    GenuiCodeGeneratorAdapter,
)
from app.infrastructure.llm.genui_quarantine_adapter import QuarantineExtraction

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_CODE = (
    "const root = document.getElementById('island-root');\n"
    "const h = document.createElement('h1');\n"
    "h.textContent = 'Hello';\n"
    "root.appendChild(h);\n"
)


def _make_code_tool_response(code: str = _VALID_CODE, language: str = "javascript") -> MagicMock:
    """Build a mock Bedrock response with an emit_code_island tool_use block."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"code": code, "language": language}
    response = MagicMock()
    response.content = [block]
    response.usage = MagicMock(input_tokens=200, output_tokens=100)
    return response


def _make_no_tool_response() -> MagicMock:
    """Build a mock Bedrock response with NO tool_use block (text only)."""
    block = MagicMock()
    block.type = "text"
    block.text = "I cannot do that."
    response = MagicMock()
    response.content = [block]
    response.usage = MagicMock(input_tokens=100, output_tokens=50)
    return response


def _make_extraction(entity_type: str = "card", summary: str = "Build a dashboard") -> QuarantineExtraction:
    return QuarantineExtraction(
        entity_type=entity_type,
        intent_summary=summary,
        confidence="high",
        input_tokens=100,
        output_tokens=50,
    )


class _FakeStream:
    """Mimics anthropic AsyncMessageStreamManager/AsyncMessageStream.

    `messages.stream(...)` is a SYNC call that RETURNS an async-context-manager;
    the adapter enters it with `async with`, iterates events (to reschedule the
    inactivity timeout), then awaits `get_final_message()`. This fake reproduces
    that surface so the adapter's streaming path can be exercised without Bedrock.
    """

    def __init__(
        self,
        final_message: Any = None,
        *,
        events: list[Any] | None = None,
        raise_exc: BaseException | None = None,
    ) -> None:
        self._final = final_message
        self._events = events if events is not None else [MagicMock()]
        self._raise = raise_exc

    async def __aenter__(self) -> _FakeStream:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    def __aiter__(self) -> Any:
        fake = self

        async def _gen() -> Any:
            if fake._raise is not None:
                raise fake._raise
            for e in fake._events:
                yield e

        return _gen()

    async def get_final_message(self) -> Any:
        if self._raise is not None:
            raise self._raise
        return self._final


def _install_stream(
    client: MagicMock,
    final: Any = None,
    *,
    side_effect: list[Any] | None = None,
) -> None:
    """Wire client.messages.stream to return _FakeStream(s).

    `stream` itself is a SYNC MagicMock (called without await); it returns the
    async-context-manager. Use `final` for a single response, or `side_effect`
    (a list of _FakeStream instances) for multi-attempt scenarios.
    """
    if side_effect is not None:
        client.messages.stream = MagicMock(side_effect=side_effect)
    else:
        client.messages.stream = MagicMock(return_value=_FakeStream(final))


@pytest.fixture
def mock_bedrock_client() -> MagicMock:
    client = MagicMock()
    client.messages = MagicMock()
    client.messages.stream = MagicMock()
    return client


@pytest.fixture
def adapter(mock_bedrock_client: MagicMock) -> GenuiCodeGeneratorAdapter:
    return GenuiCodeGeneratorAdapter(
        client=mock_bedrock_client,
        model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        escalation_model_id="us.anthropic.claude-sonnet-4-6",
        max_tokens=3000,
        timeout_seconds=15.0,
    )


# ---------------------------------------------------------------------------
# Forced-tool schema shape (D-02)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_emit_tool_schema_shape_is_hand_written() -> None:
    """emit_code_island input_schema must be the exact hand-written shape (D-02)."""
    schema = _EMIT_CODE_ISLAND_TOOL["input_schema"]
    assert _EMIT_CODE_ISLAND_TOOL["name"] == "emit_code_island"
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"code", "language"}
    assert schema["properties"]["code"]["type"] == "string"
    assert schema["properties"]["language"]["type"] == "string"
    assert schema["properties"]["language"]["enum"] == ["javascript"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_forced_emit_code_island_tool(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """tool_choice must force emit_code_island tool (D-02)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    await adapter.generate(extraction=_make_extraction())

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    assert call_kwargs["tool_choice"]["type"] == "tool"
    assert call_kwargs["tool_choice"]["name"] == "emit_code_island"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_max_tokens_and_default_temperature_set(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """max_tokens set + default temperature (0.7) threaded to the stream call (D-16, D-18)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    await adapter.generate(extraction=_make_extraction())

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    assert call_kwargs["max_tokens"] == 3000
    assert call_kwargs["temperature"] == 0.7


@pytest.mark.unit
@pytest.mark.asyncio
async def test_temperature_is_threaded_into_stream_call(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A caller-supplied temperature must be passed straight to messages.stream (D-18)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    await adapter.generate(extraction=_make_extraction(), temperature=0.4)

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    assert call_kwargs["temperature"] == 0.4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cache_control_on_system_prompt(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """System prompt must use cache_control ephemeral on the static block (D-21)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    await adapter.generate(extraction=_make_extraction())

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    system = call_kwargs.get("system")
    assert isinstance(system, list), "System must be list-of-blocks for cache_control"
    has_ephemeral = any(
        isinstance(b, dict) and b.get("cache_control", {}).get("type") == "ephemeral"
        for b in system
    )
    assert has_ephemeral, "At least one system block must have cache_control.type=ephemeral (D-21)"


# ---------------------------------------------------------------------------
# SAFE-02: Generator never receives raw prose
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_extraction_appears_as_data_section(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Structured extraction must appear in <DATA_SECTION> in the user turn (SAFE-02)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    extraction = _make_extraction(entity_type="table", summary="Build a table of emails")
    await adapter.generate(extraction=extraction)

    call_kwargs = mock_bedrock_client.messages.stream.call_args.kwargs
    messages: list[dict[str, Any]] = call_kwargs["messages"]
    user_msgs = [m for m in messages if m.get("role") == "user"]
    assert len(user_msgs) >= 1

    user_content = str(user_msgs[0]["content"])
    assert "<DATA_SECTION>" in user_content
    assert "table" in user_content
    assert "Build a table of emails" in user_content


# ---------------------------------------------------------------------------
# Happy path: parse code from tool_use
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_returns_code(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Happy path: first attempt returns parsed code + language, no escalation."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response())

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == _VALID_CODE
    assert result.language == "javascript"
    assert result.attempts == 1
    assert result.escalated is False
    assert result.is_fallback is False
    assert mock_bedrock_client.messages.stream.call_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_language_clamped_to_javascript(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A hallucinated non-js language must be clamped to 'javascript' (defence-in-depth)."""
    _install_stream(mock_bedrock_client, final=_make_code_tool_response(language="python"))

    result = await adapter.generate(extraction=_make_extraction())

    assert result.language == "javascript"
    assert result.is_fallback is False


# ---------------------------------------------------------------------------
# Escalation Haiku → Sonnet on repeated failure (D-05)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_escalation_on_third_attempt(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Attempts 1-2 use primary (Haiku); attempt 3 uses escalation (Sonnet) (D-05)."""
    # All responses lack a tool_use block → all attempts fail.
    _install_stream(
        mock_bedrock_client,
        side_effect=[
            _FakeStream(_make_no_tool_response()),
            _FakeStream(_make_no_tool_response()),
            _FakeStream(_make_no_tool_response()),
        ],
    )

    await adapter.generate(extraction=_make_extraction())

    calls = mock_bedrock_client.messages.stream.call_args_list
    assert len(calls) == 3
    assert calls[0].kwargs["model"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert calls[1].kwargs["model"] == "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert calls[2].kwargs["model"] == "us.anthropic.claude-sonnet-4-6"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_succeeds_on_second_attempt(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """First attempt has no tool_use, second attempt returns code → valid result on Haiku."""
    _install_stream(
        mock_bedrock_client,
        side_effect=[
            _FakeStream(_make_no_tool_response()),
            _FakeStream(_make_code_tool_response()),
        ],
    )

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == _VALID_CODE
    assert result.attempts == 2
    assert result.escalated is False
    assert result.is_fallback is False
    assert mock_bedrock_client.messages.stream.call_count == 2


# ---------------------------------------------------------------------------
# Total failure → SAFE_FALLBACK_CODE + is_fallback (D-07)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_all_attempts_fail_returns_fallback(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """No tool_use on all 3 attempts returns SAFE_FALLBACK_CODE + is_fallback (D-07)."""
    _install_stream(
        mock_bedrock_client,
        side_effect=[
            _FakeStream(_make_no_tool_response()),
            _FakeStream(_make_no_tool_response()),
            _FakeStream(_make_no_tool_response()),
        ],
    )

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == SAFE_FALLBACK_CODE
    assert result.language == "javascript"
    assert result.attempts == 3
    assert result.escalated is True
    assert result.is_fallback is True
    assert mock_bedrock_client.messages.stream.call_count == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_code_string_triggers_fallback(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """A tool_use block with an empty/whitespace code string must not be accepted."""
    _install_stream(
        mock_bedrock_client,
        side_effect=[
            _FakeStream(_make_code_tool_response(code="   ")),
            _FakeStream(_make_code_tool_response(code="   ")),
            _FakeStream(_make_code_tool_response(code="   ")),
        ],
    )

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == SAFE_FALLBACK_CODE
    assert result.is_fallback is True


# ---------------------------------------------------------------------------
# Timeout / error handling (D-17)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_timeout_returns_fallback(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """asyncio.TimeoutError must return SAFE_FALLBACK_CODE, not raise (D-17)."""
    _install_stream(
        mock_bedrock_client,
        side_effect=[_FakeStream(raise_exc=TimeoutError())],
    )

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == SAFE_FALLBACK_CODE
    assert result.escalated is False
    assert result.is_fallback is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_exception_returns_fallback(
    adapter: GenuiCodeGeneratorAdapter,
    mock_bedrock_client: MagicMock,
) -> None:
    """Any Bedrock exception must return SAFE_FALLBACK_CODE, not raise."""
    _install_stream(
        mock_bedrock_client,
        side_effect=[_FakeStream(raise_exc=RuntimeError("Bedrock error"))],
    )

    result = await adapter.generate(extraction=_make_extraction())

    assert result.code == SAFE_FALLBACK_CODE
    assert result.escalated is False
    assert result.is_fallback is True


# ---------------------------------------------------------------------------
# SAFE_FALLBACK_CODE constant (D-07)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_safe_fallback_code_is_safe_string() -> None:
    """SAFE_FALLBACK_CODE must be a plain string that targets #island-root, offline (D-07)."""
    assert isinstance(SAFE_FALLBACK_CODE, str)
    assert "island-root" in SAFE_FALLBACK_CODE
    assert "Unable to generate a widget for this request" in SAFE_FALLBACK_CODE
    # Must not use any forbidden constructs.
    for banned in ("import", "require(", "eval(", "Function(", "fetch(", "localStorage", "document.cookie"):
        assert banned not in SAFE_FALLBACK_CODE
