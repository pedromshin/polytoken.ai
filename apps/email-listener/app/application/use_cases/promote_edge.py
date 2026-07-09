"""PromoteEdgeUseCase — load -> guard -> flip -> persist (TIER-03, T-30-05/06/07/08).

Backs POST /v1/knowledge/edges/{id}/promote (Task 3): the only place in the
system a knowledge_node_edges row's tier may ever flip to EXTRACTED. Mirrors
Phase-24 SubmitWidgetInteraction's fail-closed ordering discipline -- every
rejection reason (not-found / cross-tenant / inactive / already-EXTRACTED) is
raised as a typed exception BEFORE `promote_edge` (the write) is ever called.

Ordering is fixed and never reordered:
  1. load the edge (+ its owning importer_id via the repo join) -- EdgeNotFound
     if missing (404)
  2. tenant-ownership guard (edge's source node importer_id == caller's
     importer_id) -- checked BEFORE the tier/active checks so cross-tenant
     probing can't distinguish "wrong tenant" from "already extracted"
     (T-30-07, information-disclosure disposition)
  3. active guard -- inactive (deactivated/superseded) edges are never
     promotable
  4. tier guard -- only INFERRED/AMBIGUOUS (suggestion-tier) edges are
     promotable; already-EXTRACTED is rejected
  5. CAS write via `promote_edge` (repo-level defense-in-depth, T-30-06) --
     a False return means a concurrent promote/dismiss beat this call, and is
     ALSO rejected (no partial/duplicate promotion)

On success, promotion={promoted_at (UTC ISO8601), from_tier, mechanism:
'human_promote'} is written to the promotion column -- distinct from the
synthesis provenance column, which this use case never touches (T-30-08).

Domain-pure: the only collaborator is KnowledgeGraphRepository (a domain
port) -- zero app.infrastructure import (lint-imports enforced).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

_SUGGESTION_TIERS = ("INFERRED", "AMBIGUOUS")
_TIER_EXTRACTED = "EXTRACTED"
_MECHANISM_HUMAN_PROMOTE = "human_promote"

EdgeNotPromotableReason = Literal["tenant_mismatch", "inactive", "not_promotable", "conflict"]


class EdgeNotFound(Exception):  # noqa: N818 - mirrors WidgetSubmitRejected naming idiom (plan-fixed name)
    """Raised when no edge exists for the given id (maps to 404)."""


class EdgeNotPromotable(Exception):  # noqa: N818 - mirrors WidgetSubmitRejected naming idiom
    """Raised for every promotion-guard rejection (maps to a 4xx).

    `reason` is the caller-safe discriminator; `message` is a short,
    non-leaking description (CLAUDE.md guardrail — detailed context stays
    server-side only).
    """

    def __init__(self, reason: EdgeNotPromotableReason, message: str = "") -> None:
        super().__init__(message or reason)
        self.reason = reason
        self.message = message


class PromoteEdgeUseCase:
    """Guarded, audit-recording promotion of exactly one suggestion-tier edge to EXTRACTED."""

    def __init__(self, *, knowledge: KnowledgeGraphRepository) -> None:
        self._knowledge = knowledge

    async def execute(
        self,
        *,
        edge_id: str,
        importer_id: str,
        mechanism: str = _MECHANISM_HUMAN_PROMOTE,
        extra: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """Promote one ACTIVE INFERRED/AMBIGUOUS edge owned by `importer_id` to EXTRACTED.

        Raises EdgeNotFound / EdgeNotPromotable for every rejection path
        BEFORE `promote_edge` (the write) is called. Returns
        {edge_id, tier: 'EXTRACTED'} on success.

        `mechanism`/`extra` (Phase 40-02, CONF-02) are additive keyword-only
        params for non-REST promotion provenance — e.g. a chat confirm_action
        dispatch passes `mechanism="chat_confirm_action"` and
        `extra={"widget_interaction_id": ...}` so the promotion record is
        distinguishable from a plain REST `human_promote`. Callers that omit
        both get the exact same `promotion` dict as before this change.
        """
        edge = await self._knowledge.find_edge_by_id(edge_id)
        if edge is None:
            raise EdgeNotFound(f"edge {edge_id} not found")

        if edge.get("importer_id") != importer_id:
            raise EdgeNotPromotable("tenant_mismatch", "edge does not belong to this importer")

        if not edge.get("is_active"):
            raise EdgeNotPromotable("inactive", "edge is not active")

        from_tier = edge.get("tier")
        if from_tier not in _SUGGESTION_TIERS:
            raise EdgeNotPromotable("not_promotable", "edge is not in a promotable tier")

        promotion: dict[str, object] = {
            "promoted_at": datetime.now(UTC).isoformat(),
            "from_tier": from_tier,
            "mechanism": mechanism,
            **(extra or {}),
        }
        updated = await self._knowledge.promote_edge(edge_id=edge_id, promotion=promotion)
        if not updated:
            raise EdgeNotPromotable("conflict", "edge was already promoted or changed concurrently")

        return {"edge_id": edge_id, "tier": _TIER_EXTRACTED}


__all__ = ["EdgeNotFound", "EdgeNotPromotable", "EdgeNotPromotableReason", "PromoteEdgeUseCase"]
