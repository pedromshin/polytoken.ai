"""AssembleMorningBoardUseCase — the overnight home-board assembly (Phase 74, MORN-03/06).

Drives the deterministic composer and persists the result to the caller's
home-scoped canvas through the ``HomeCanvasWriter`` port. Invoked by the
internal ``POST /v1/home/assemble-job`` route (mirroring the ingest-job re-entry
seam) with an EXPLICIT ``user_id`` from the durable job payload — no session.

SHIP-DARK (MORN-06): the ``enabled`` flag mirrors the anticipatory spike's
single-off-switch discipline (EvaluateAnticipatoryCandidates short-circuits when
``enabled=False``). When False the use case composes NOTHING and writes NOTHING —
``execute`` returns an un-assembled outcome before it ever touches the composer or
the writer. The composition provider passes ``get_settings().MORNING_BOARD_ENABLED``
here, so the feature is fully dark until that flag is flipped True.

RAISE-ON-FAILURE (MORN-03): this use case does NOT swallow. A writer failure
propagates to the route → FastAPI 500 → the worker throws → graphile retries.
That is the opposite of the SNS receiver's swallow-to-200 path and the same
contract ingest_job.py depends on.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.application.use_cases.compose_morning_board import compose_morning_board_snapshot
from app.domain.ports.home_canvas_writer import HomeCanvasWriter


@dataclass(frozen=True)
class AssembleMorningBoardOutcome:
    """Result of one assembly attempt.

    ``assembled`` is False when the feature is dark (nothing composed/written);
    ``node_count`` is the number of nodes persisted (0 when dark).
    """

    assembled: bool
    node_count: int


class AssembleMorningBoardUseCase:
    """Compose the morning board and persist it to a user's home canvas."""

    def __init__(self, writer: HomeCanvasWriter, *, enabled: bool) -> None:
        self._writer = writer
        self._enabled = enabled

    async def execute(self, user_id: str) -> AssembleMorningBoardOutcome:
        """Assemble + persist the home board for ``user_id``.

        Short-circuits (no compose, no write) when the feature is dark. Otherwise
        composes the deterministic snapshot and writes it keyed on ``user_id``.
        Any writer failure propagates (raise-on-failure, MORN-03).
        """
        if not self._enabled:
            return AssembleMorningBoardOutcome(assembled=False, node_count=0)

        snapshot = compose_morning_board_snapshot()
        await self._writer.write_home_snapshot(user_id, snapshot)
        return AssembleMorningBoardOutcome(assembled=True, node_count=len(snapshot.nodes))
