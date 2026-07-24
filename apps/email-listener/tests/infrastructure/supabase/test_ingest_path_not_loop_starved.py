"""Loop-starvation guard for the Track-3a `asyncio.to_thread` ingest wrapping.

supabase-py's Client is synchronous, so a `.execute()` called inline inside an
`async def` blocks the single shared uvicorn event loop for the whole network
round-trip — one slow email can freeze every other in-flight request. Track-3a
A1 wraps every ingest-path blocking call in `asyncio.to_thread(...)` so the work
runs on a worker thread and the loop stays free.

These tests demonstrate that PROPERTY (the loop keeps making progress while a
blocking call runs) rather than measuring exact timings. They are deliberately
timing-TOLERANT — generous margins, only relative/floor assertions — so they
assert the behavior without becoming flaky on a busy CI box.

Style mirrors tests/infrastructure/supabase/test_thread_repository.py: no live
DB, MagicMock chain, driven via asyncio.run().
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock

from app.infrastructure.supabase.component_repository import SupabaseComponentRepository

# A "slow" synchronous callable blocks noticeably longer than one loop tick, so a
# starved loop and a free loop are unambiguously distinguishable. Kept small to
# keep the suite fast; the assertions use large tolerances, never exact counts.
_SLOW_SECONDS = 0.4
_TICK_SECONDS = 0.01
# During _SLOW_SECONDS a free loop ticks ~_SLOW_SECONDS/_TICK_SECONDS (~40) times.
# Require only a small fraction of that so the test never flakes under load.
_MIN_TICKS = 4


async def _count_ticks_during(blocking_coro_factory: object) -> int:
    """Run a fast "loop tick" coroutine concurrently with the blocking work.

    ``blocking_coro_factory`` is a zero-arg callable returning the awaitable that
    performs the (nominally blocking) work. Returns how many times the tick
    coroutine advanced while that work was in flight — a proxy for "the event
    loop was NOT starved".
    """
    ticks = 0
    done = False

    async def ticker() -> None:
        nonlocal ticks
        while not done:
            await asyncio.sleep(_TICK_SECONDS)
            ticks += 1

    ticker_task = asyncio.create_task(ticker())
    try:
        await blocking_coro_factory()  # type: ignore[operator]
    finally:
        done = True
        await ticker_task
    return ticks


def _slow_sync_call() -> str:
    """A synthetic blocking synchronous callable (stand-in for `.execute()`)."""
    time.sleep(_SLOW_SECONDS)
    return "done"


def test_to_thread_offload_keeps_event_loop_responsive() -> None:
    """`asyncio.to_thread` yields the loop; the same call inline starves it.

    Off-loop (the A1 idiom) the concurrent ticker keeps advancing; the on-loop
    control (calling the blocking function directly in a coroutine) demonstrably
    makes less progress. The comparison is what proves the offload works — it is
    independent of the absolute machine speed.
    """

    async def offloaded() -> None:
        # Exactly the A1 idiom: the blocking sync call runs on a worker thread.
        result = await asyncio.to_thread(_slow_sync_call)
        assert result == "done"

    async def on_loop_control() -> None:
        # The pre-A1 behavior: blocking call runs directly on the event loop.
        _slow_sync_call()

    offloaded_ticks = asyncio.run(_count_ticks_during(offloaded))
    control_ticks = asyncio.run(_count_ticks_during(on_loop_control))

    # The loop kept ticking while the blocking work ran off-thread.
    assert offloaded_ticks >= _MIN_TICKS
    # ...and it demonstrably ticked more than when the same work blocked the loop.
    assert offloaded_ticks > control_ticks


def test_wrapped_repo_execute_runs_off_the_event_loop() -> None:
    """A real wrapped repo method (find_by_email_id) offloads its `.execute()`.

    The injected client's `.execute()` blocks for _SLOW_SECONDS; because the
    repository wraps it in `asyncio.to_thread`, a concurrent ticker still makes
    progress — proving the blocking round-trip left the loop free.
    """

    def _slow_execute() -> MagicMock:
        time.sleep(_SLOW_SECONDS)
        return MagicMock(data=[])

    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.execute.side_effect = _slow_execute

    client = MagicMock()
    client.table.return_value = chain

    repo = SupabaseComponentRepository(client)

    captured: list[object] = []

    async def call_repo() -> None:
        captured.append(await repo.find_by_email_id("email-1"))

    ticks = asyncio.run(_count_ticks_during(call_repo))

    assert captured == [[]]  # the wrapped method returned normally
    assert ticks >= _MIN_TICKS  # the loop was not starved during the blocking .execute()
    chain.execute.assert_called_once()
