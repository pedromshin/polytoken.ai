"""Tests for SupabaseJobEnqueuer (Track 3a, A2).

Covers the enqueue seam's contract WITHOUT a live Supabase: the adapter must
- call ``client.rpc("enqueue_job", {...})`` with the four wrapper params
  (``p_identifier``/``p_payload``/``p_max_attempts``/``p_job_key``), defaulting
  ``max_attempts`` to 8 and ``job_key`` to None;
- run the blocking ``.execute()`` off the event loop via ``asyncio.to_thread``;
- return the wrapper's ``bigint`` job id from ``result.data`` (scalar or
  single-element list).
"""

from __future__ import annotations

import threading
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.infrastructure.jobs.supabase_job_enqueuer import SupabaseJobEnqueuer


def _client_returning(data: Any) -> tuple[MagicMock, MagicMock]:
    """Build a MagicMock Supabase client whose rpc(...).execute() returns .data == data.

    Returns (client, rpc_mock) so the test can assert the exact rpc call args.
    """
    execute_result = MagicMock()
    execute_result.data = data
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = execute_result
    client = MagicMock()
    client.rpc.return_value = rpc_chain
    return client, client.rpc


@pytest.mark.asyncio
async def test_enqueue_calls_wrapper_with_all_four_params_and_returns_id() -> None:
    client, rpc = _client_returning(4242)
    enqueuer = SupabaseJobEnqueuer(client=client)

    job_id = await enqueuer.enqueue(
        "ingest_inbound_email",
        {"ses_message_id": "m1", "recipients": ["u-tok@x"]},
        max_attempts=8,
        job_key="ingest:m1",
    )

    assert job_id == 4242
    rpc.assert_called_once()
    name, params = rpc.call_args.args
    assert name == "enqueue_job"
    assert params == {
        "p_identifier": "ingest_inbound_email",
        "p_payload": {"ses_message_id": "m1", "recipients": ["u-tok@x"]},
        "p_max_attempts": 8,
        "p_job_key": "ingest:m1",
    }


@pytest.mark.asyncio
async def test_enqueue_defaults_max_attempts_and_job_key() -> None:
    client, rpc = _client_returning(7)
    enqueuer = SupabaseJobEnqueuer(client=client)

    await enqueuer.enqueue("deep_research", {"run_id": "r1"})

    _, params = rpc.call_args.args
    assert params["p_max_attempts"] == 8
    assert params["p_job_key"] is None


@pytest.mark.asyncio
async def test_enqueue_unwraps_single_element_list_scalar() -> None:
    client, _ = _client_returning([99])
    enqueuer = SupabaseJobEnqueuer(client=client)

    assert await enqueuer.enqueue("ingest_inbound_email", {}) == 99


@pytest.mark.asyncio
async def test_enqueue_runs_execute_off_the_event_loop() -> None:
    """The blocking .execute() must run via asyncio.to_thread — assert it lands on a worker thread."""
    calling_thread = threading.get_ident()
    seen: dict[str, Any] = {}

    execute_result = MagicMock()
    execute_result.data = 1

    def _record_execute() -> Any:
        seen["execute_thread"] = threading.get_ident()
        return execute_result

    rpc_chain = MagicMock()
    rpc_chain.execute.side_effect = _record_execute
    client = MagicMock()
    client.rpc.return_value = rpc_chain

    enqueuer = SupabaseJobEnqueuer(client=client)
    await enqueuer.enqueue("ingest_inbound_email", {"a": 1})

    # to_thread offloads to a distinct worker thread, never the calling (event-loop) thread.
    assert seen["execute_thread"] != calling_thread
