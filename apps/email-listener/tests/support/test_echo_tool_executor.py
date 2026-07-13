"""Tests for the EchoToolExecutor test double (Phase 34, LOOP-01)."""

from __future__ import annotations

import json

import pytest

from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS, ToolExecutionResult
from tests.support.echo_tool_executor import EchoToolExecutor

_IMPORTER_ID = "imp-test-0000-0000-0000-000000000001"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_echo_round_trips_arguments() -> None:
    executor = EchoToolExecutor()
    arguments = {"tool_use_id": "tu_1", "query": "hello"}
    result = await executor.execute(name="echo", arguments=arguments, importer_id=_IMPORTER_ID)

    assert isinstance(result, ToolExecutionResult)
    assert result.tool_use_id == "tu_1"
    assert result.is_error is False
    assert json.loads(result.content) == arguments


@pytest.mark.unit
@pytest.mark.asyncio
async def test_echo_defaults_tool_use_id_when_absent() -> None:
    executor = EchoToolExecutor()
    result = await executor.execute(name="echo", arguments={"query": "hi"}, importer_id=_IMPORTER_ID)
    assert result.tool_use_id == "echo"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_echo_forced_error_returns_is_error_true() -> None:
    executor = EchoToolExecutor()
    result = await executor.execute(
        name="echo", arguments={"tool_use_id": "tu_2", "__force_error__": True}, importer_id=_IMPORTER_ID
    )
    assert result.is_error is True
    assert result.tool_use_id == "tu_2"
    assert result.content


@pytest.mark.unit
@pytest.mark.asyncio
async def test_echo_output_is_capped() -> None:
    executor = EchoToolExecutor()
    result = await executor.execute(name="echo", arguments={"payload": "x" * 5000}, importer_id=_IMPORTER_ID)
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS + len(" …[truncated]")
    assert result.content.endswith("…[truncated]")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_echo_sleep_flag_delays_before_returning() -> None:
    import time

    executor = EchoToolExecutor()
    start = time.monotonic()
    await executor.execute(name="echo", arguments={"__sleep__": 0.05}, importer_id=_IMPORTER_ID)
    elapsed = time.monotonic() - start
    assert elapsed >= 0.04
