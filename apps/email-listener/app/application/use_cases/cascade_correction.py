"""CascadeCorrectionUseCase — Phase 75 (CPF-01/02/03), the correction flywheel.

When a human confirms a merge (survivor S absorbs T), this propagates the single
correction across the graph:

  1. **promote** the active INFERRED/AMBIGUOUS sender→S/T suggestion edges to
     EXTRACTED canon — reusing `PromoteEdgeUseCase` (the ONE canon-raise write,
     with its fail-closed guards) so an already-EXTRACTED or inactive edge is
     never double-flipped (CPF-01);
  2. **enqueue** an idempotent async re-label fan-out over the absorbed
     identity's past emails (job_key = `cascade:{S}:{T}`), so their candidate
     links re-point onto the survivor without racing the request;
  3. **record** one importer-scoped `correction_propagations` ledger row LAST
     (so a half-run never claims completion), ON CONFLICT (job_key) DO NOTHING —
     the idempotency + audit anchor (CPF-02/03).

Standalone + best-effort by construction: it is NOT yet wired into
`ConfirmMergeUseCase` (Plan 75-03 does that, catching any failure so the merge
never breaks). Architecture: imports ONLY domain ports (+ the promote use-case's
own exceptions) — no infrastructure import (lint-imports enforced). D-21:
importer_id is derived from the loaded survivor row, never a caller arg.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

from app.application.use_cases.promote_edge import EdgeNotFound, EdgeNotPromotable

if TYPE_CHECKING:
    from app.domain.ports.correction_cascade import (
        CorrectionCascadeReader,
        CorrectionPropagationWriter,
        EdgePromoter,
    )
    from app.domain.ports.entity_instance_repository import EntityInstanceRepository
    from app.domain.ports.job_enqueuer import JobEnqueuer

logger = structlog.get_logger(__name__)

_CASCADE_MECHANISM = "merge_cascade"
_RELABEL_IDENTIFIER = "cascade_relabel"


@dataclass(frozen=True)
class CascadeSummary:
    """What one cascade touched — the shape surfaced to the confirm endpoint (CPF-04)."""

    survivor_id: str
    absorbed_id: str
    promoted_edge_ids: list[str]
    affected_email_ids: list[str]
    ledger_written: bool


class CascadeCorrectionUseCase:
    """Propagate one confirmed merge (survivor absorbs target) across the graph."""

    def __init__(
        self,
        *,
        entity_instances: EntityInstanceRepository,
        edge_promoter: EdgePromoter,
        cascade_reader: CorrectionCascadeReader,
        propagations: CorrectionPropagationWriter,
        job_enqueuer: JobEnqueuer,
    ) -> None:
        self._entity_instances = entity_instances
        self._edge_promoter = edge_promoter
        self._cascade_reader = cascade_reader
        self._propagations = propagations
        self._job_enqueuer = job_enqueuer

    async def execute(self, *, survivor_id: str, absorbed_id: str) -> CascadeSummary:
        """Cascade the merge of `absorbed_id` into `survivor_id`.

        importer_id is derived from the loaded survivor row (D-21). Returns the
        summary of what was touched. Safe to re-run: the promote guards +
        job_key + ON CONFLICT ledger make a second run a no-op (CPF-02).
        """
        log = logger.bind(survivor_id=survivor_id, absorbed_id=absorbed_id)

        # D-21: importer from the loaded survivor row, never a caller arg.
        survivor = await self._entity_instances.find_by_id(survivor_id)
        if survivor is None:
            log.warning("cascade_survivor_not_found")
            return CascadeSummary(survivor_id, absorbed_id, [], [], ledger_written=False)
        importer_id = survivor.importer_id
        log = log.bind(importer_id=importer_id)

        # 1. Promote the suggestion edges touching either identity. The reader
        # returns candidates; the promoter's own guards decide promotability, so
        # an already-EXTRACTED/inactive/gone edge is skipped, never double-flipped.
        candidate_edge_ids = await self._cascade_reader.find_promotable_suggestion_edge_ids(
            entity_instance_ids=[survivor_id, absorbed_id],
            importer_id=importer_id,
        )
        promoted_edge_ids: list[str] = []
        for edge_id in candidate_edge_ids:
            try:
                await self._edge_promoter.execute(
                    edge_id=edge_id,
                    importer_id=importer_id,
                    mechanism=_CASCADE_MECHANISM,
                )
            except (EdgeNotPromotable, EdgeNotFound):
                # Already EXTRACTED / inactive / concurrently gone — skip (CPF-01).
                continue
            promoted_edge_ids.append(edge_id)

        # 2. The absorbed identity's past emails — enqueue an idempotent re-label
        # fan-out (job_key dedupes an at-least-once redelivery).
        affected_email_ids = await self._cascade_reader.find_email_ids_for_entity(
            entity_instance_id=absorbed_id,
        )
        job_key = f"cascade:{survivor_id}:{absorbed_id}"
        if affected_email_ids:
            await self._job_enqueuer.enqueue(
                _RELABEL_IDENTIFIER,
                {
                    "survivor_id": survivor_id,
                    "absorbed_id": absorbed_id,
                    "email_ids": list(affected_email_ids),
                },
                job_key=job_key,
            )

        # 3. Ledger LAST — a half-run never claims completion; ON CONFLICT DO
        # NOTHING makes a re-run write no duplicate (CPF-02/03).
        ledger_written = await self._propagations.record(
            importer_id=importer_id,
            survivor_entity_instance_id=survivor_id,
            absorbed_entity_instance_id=absorbed_id,
            promoted_edge_ids=promoted_edge_ids,
            affected_email_ids=affected_email_ids,
            job_key=job_key,
        )

        log.info(
            "cascade_done",
            promoted=len(promoted_edge_ids),
            affected_emails=len(affected_email_ids),
            ledger_written=ledger_written,
        )
        return CascadeSummary(
            survivor_id,
            absorbed_id,
            promoted_edge_ids,
            list(affected_email_ids),
            ledger_written,
        )
