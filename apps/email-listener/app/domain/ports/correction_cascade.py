"""Correction-cascade ports — Phase 75 (CPF-01/02/03).

Domain abstractions the `CascadeCorrectionUseCase` composes to propagate one
confirmed merge across the graph. Defined as NEW ports (not extensions of the
existing repositories) so the cascade use-case is purely additive — the concrete
adapters are provided when the cascade is wired into the merge path (Plan 75-03);
until then the use-case is unit-tested against fakes and nothing existing changes.

All reads/writes are importer-scoped by the caller (the use-case derives
importer_id from the loaded survivor row, D-21) — an adapter must never widen
scope beyond the passed importer_id.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class EdgePromoter(Protocol):
    """The trust-ladder promotion seam — structurally satisfied by
    `PromoteEdgeUseCase` (application), injected so the cascade reuses the ONE
    canon-raise write path (with its fail-closed tier/active/tenant guards)
    rather than a second flip. `mechanism="merge_cascade"` distinguishes a
    cascade promotion from a plain human_promote in the promotion provenance."""

    async def execute(
        self,
        *,
        edge_id: str,
        importer_id: str,
        user_id: str | None = None,
        mechanism: str = ...,
        extra: dict[str, object] | None = None,
    ) -> dict[str, object]: ...


class CorrectionCascadeReader(Protocol):
    """Owner-scoped reads the cascade needs but that no existing port exposes."""

    async def find_promotable_suggestion_edge_ids(
        self,
        *,
        entity_instance_ids: Sequence[str],
        importer_id: str,
    ) -> list[str]:
        """The ids of ACTIVE suggestion-tier (INFERRED/AMBIGUOUS) knowledge edges
        whose target is one of `entity_instance_ids`, within `importer_id`. The
        promote guards are the source of truth for "promotable"; this is the
        candidate set the cascade feeds to the promoter (already-EXTRACTED /
        inactive edges the adapter may include are skipped by the promoter)."""
        ...

    async def find_email_ids_for_entity(
        self,
        *,
        entity_instance_id: str,
    ) -> list[str]:
        """Distinct email ids where `entity_instance_id` appears as a resolved
        component candidate (the inverse of the detail-page occurrence join) —
        the set the absorbed identity's past mail must be re-labeled over."""
        ...


class CorrectionPropagationWriter(Protocol):
    """Writes the `correction_propagations` ledger row (migration 0060)."""

    async def record(
        self,
        *,
        importer_id: str,
        survivor_entity_instance_id: str,
        absorbed_entity_instance_id: str,
        promoted_edge_ids: Sequence[str],
        affected_email_ids: Sequence[str],
        job_key: str,
    ) -> bool:
        """Insert ONE ledger row, ON CONFLICT (job_key) DO NOTHING. Returns True
        when a new row was written, False when this cascade's `job_key` already
        exists — the idempotency signal (CPF-02)."""
        ...
