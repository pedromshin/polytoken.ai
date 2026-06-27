"""Tests for SupabaseGenerationAuditRepository — best-effort audit insert.

TDD (Phase 13-02, GEN-05, D-19):
  1. Successful record issues exactly one insert with the mapped D-19 columns.
  2. Client whose insert raises has exception swallowed; record() returns None.

These tests use AsyncMock for the Supabase client — no live DB required.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domain.ports.generation_audit_repository import GenerationAuditRepository, GenerationEvent
from app.infrastructure.supabase.supabase_generation_audit_repository import (
    SupabaseGenerationAuditRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SAMPLE_EVENT = GenerationEvent(
    intent_hash="sha256:abc123",
    model_id="anthropic.claude-3-haiku-20240307-v1:0",
    input_tokens=512,
    output_tokens=256,
    attempts=1,
    outcome="ok",
    spec_validation_passed=True,
    spec_node_count=14,
    spec_depth=3,
    registry_version="v1.2.0",
    latency_ms=1234,
    importer_id="00000000-0000-0000-0003-000000000001",
)


def _make_client(*, insert_raises: Exception | None = None) -> MagicMock:
    """Build a MagicMock Supabase client with a chainable .table().insert().execute() path."""
    client = MagicMock()

    execute_mock = MagicMock()
    if insert_raises is not None:
        execute_mock.side_effect = insert_raises
    else:
        execute_mock.return_value = MagicMock(data=[{"id": "some-uuid"}])

    insert_mock = MagicMock()
    insert_mock.execute = execute_mock

    table_mock = MagicMock()
    table_mock.insert = MagicMock(return_value=insert_mock)

    client.table = MagicMock(return_value=table_mock)
    return client


# ---------------------------------------------------------------------------
# Test 1: successful record — correct table + mapped columns
# ---------------------------------------------------------------------------


def test_record_calls_insert_with_mapped_columns() -> None:
    """Successful record issues exactly one insert into genui_generation_events."""
    client = _make_client()
    repo: GenerationAuditRepository = SupabaseGenerationAuditRepository(client)

    asyncio.run(repo.record(_SAMPLE_EVENT))

    client.table.assert_called_once_with("genui_generation_events")
    insert_call_args: dict[str, Any] = client.table.return_value.insert.call_args[0][0]

    assert insert_call_args["intent_hash"] == "sha256:abc123"
    assert insert_call_args["model_id"] == "anthropic.claude-3-haiku-20240307-v1:0"
    assert insert_call_args["input_tokens"] == 512
    assert insert_call_args["output_tokens"] == 256
    assert insert_call_args["attempts"] == 1
    assert insert_call_args["outcome"] == "ok"
    assert insert_call_args["spec_validation_passed"] is True
    assert insert_call_args["spec_node_count"] == 14
    assert insert_call_args["spec_depth"] == 3
    assert insert_call_args["registry_version"] == "v1.2.0"
    assert insert_call_args["latency_ms"] == 1234
    assert insert_call_args["importer_id"] == "00000000-0000-0000-0003-000000000001"

    # execute() must have been called
    client.table.return_value.insert.return_value.execute.assert_called_once()


# ---------------------------------------------------------------------------
# Test 2: failing insert — exception is swallowed, record() returns None
# ---------------------------------------------------------------------------


def test_record_swallows_insert_exception() -> None:
    """Client whose insert raises has the exception swallowed; record returns None."""
    client = _make_client(insert_raises=RuntimeError("DB unavailable"))
    repo: GenerationAuditRepository = SupabaseGenerationAuditRepository(client)

    # Must not raise
    result = asyncio.run(repo.record(_SAMPLE_EVENT))
    assert result is None


# ---------------------------------------------------------------------------
# Test 3: structural — GenerationEvent is frozen (immutable)
# ---------------------------------------------------------------------------


def test_generation_event_is_frozen() -> None:
    """GenerationEvent dataclass must be frozen (immutable, D-19)."""
    with pytest.raises((AttributeError, TypeError)):
        object.__setattr__(_SAMPLE_EVENT, "intent_hash", "mutated")


# ---------------------------------------------------------------------------
# Test 4: structural — SupabaseGenerationAuditRepository satisfies the Protocol
# ---------------------------------------------------------------------------


def test_adapter_satisfies_protocol() -> None:
    """SupabaseGenerationAuditRepository must structurally satisfy GenerationAuditRepository."""
    client = _make_client()
    repo = SupabaseGenerationAuditRepository(client)
    # Protocol structural check — repo must have an async record() method
    assert callable(getattr(repo, "record", None))
