"""Tests for AssembleMorningBoardUseCase (Phase 74, MORN-06).

MORN-06 (ship-dark): when ``enabled=False`` the use case composes NOTHING and
writes NOTHING — the writer is never called. When ``enabled=True`` it composes
the deterministic snapshot and writes it keyed on the payload user_id.

This is the use-case-level flag gate (sibling to how EvaluateAnticipatoryCandidates
short-circuits on ``enabled=False``); the route-level 200-no-op and the settings
default are covered in test_home_assemble.py and test_settings_morning_board.py.
"""

from __future__ import annotations

import asyncio

import pytest

from app.application.use_cases.assemble_morning_board import AssembleMorningBoardUseCase
from app.domain.canvas.snapshot import CanvasSnapshot


class _RecordingWriter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, CanvasSnapshot]] = []

    async def write_home_snapshot(self, user_id: str, snapshot: CanvasSnapshot) -> None:
        self.calls.append((user_id, snapshot))


def test_disabled_flag_composes_and_writes_nothing() -> None:
    writer = _RecordingWriter()
    use_case = AssembleMorningBoardUseCase(writer=writer, enabled=False)

    outcome = asyncio.run(use_case.execute("user-a"))

    assert outcome.assembled is False
    assert outcome.node_count == 0
    assert writer.calls == []  # ship-dark: the writer was never touched


def test_enabled_flag_composes_and_writes_keyed_on_user() -> None:
    writer = _RecordingWriter()
    use_case = AssembleMorningBoardUseCase(writer=writer, enabled=True)

    outcome = asyncio.run(use_case.execute("user-a"))

    assert outcome.assembled is True
    assert outcome.node_count == 3
    assert len(writer.calls) == 1
    written_user_id, written_snapshot = writer.calls[0]
    assert written_user_id == "user-a"  # payload user_id, never a session
    assert len(written_snapshot.nodes) == 3


def test_writer_failure_propagates() -> None:
    """MORN-03 at the use-case layer: a writer failure is NOT swallowed."""

    class _BoomWriter:
        async def write_home_snapshot(self, user_id: str, snapshot: CanvasSnapshot) -> None:
            raise RuntimeError("write boom")

    use_case = AssembleMorningBoardUseCase(writer=_BoomWriter(), enabled=True)

    with pytest.raises(RuntimeError, match="write boom"):
        asyncio.run(use_case.execute("user-a"))
