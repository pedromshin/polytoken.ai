"""PromoteEdgeUseCase — load -> guard -> flip -> persist (TIER-03, T-30-05/06/07/08).

Backs POST /v1/knowledge/edges/{id}/promote (Task 3): the only place in the
system a knowledge_node_edges row's tier may ever flip to EXTRACTED. Mirrors
Phase-24 SubmitWidgetInteraction's fail-closed ordering discipline -- every
rejection reason (not-found / cross-tenant / inactive / already-EXTRACTED) is
raised as a typed exception BEFORE `promote_edge` (the write) is ever called.

Ordering is fixed and never reordered:
  1. load the edge (+ its owning importer_id via the repo join) -- EdgeNotFound
     if missing (404)
  2. USER-ownership guard (Phase 44-03, T-44-03-03): when `user_id` is
     supplied, the edge's importer_id must be in the set the caller OWNS
     (resolved via the injected `importers` port) -- a client-supplied body
     importer_id is never sufficient on its own. `user_id` is optional
     (defaults to None) so pre-Phase-44 callers that don't yet carry a
     per-request user id (e.g. the chat confirm_action dispatch path,
     confirm_action_dispatch.py) are unaffected -- this guard is a no-op
     unless `user_id` is provided.
  3. tenant-ownership guard (edge's source node importer_id == caller-
     supplied importer_id) -- checked BEFORE the tier/active checks so
     cross-tenant probing can't distinguish "wrong tenant" from "already
     extracted" (T-30-07, information-disclosure disposition)
  4. active guard -- inactive (deactivated/superseded) edges are never
     promotable
  5. tier guard -- only INFERRED/AMBIGUOUS (suggestion-tier) edges are
     promotable; already-EXTRACTED is rejected
  6. CAS write via `promote_edge` (repo-level defense-in-depth, T-30-06) --
     a False return means a concurrent promote/dismiss beat this call, and is
     ALSO rejected (no partial/duplicate promotion)

On success, promotion={promoted_at (UTC ISO8601), from_tier, mechanism:
'human_promote'} is written to the promotion column -- distinct from the
synthesis provenance column, which this use case never touches (T-30-08).

Domain-pure: collaborators are KnowledgeGraphRepository + ImporterResolver
(both domain ports) -- zero app.infrastructure import (lint-imports enforced).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.domain.ports.importer_resolver import ImporterResolver
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

    def __init__(self, *, knowledge: KnowledgeGraphRepository, importers: ImporterResolver | None = None) -> None:
        self._knowledge = knowledge
        # Optional (Phase 44-03): only required when a caller passes user_id
        # to execute(). Pre-Phase-44 callers/tests that never pass user_id
        # never touch this collaborator.
        self._importers = importers

    async def execute(
        self,
        *,
        edge_id: str,
        importer_id: str,
        user_id: str | None = None,
        mechanism: str = _MECHANISM_HUMAN_PROMOTE,
        extra: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """Promote one ACTIVE INFERRED/AMBIGUOUS edge owned by `importer_id` to EXTRACTED.

        Raises EdgeNotFound / EdgeNotPromotable for every rejection path
        BEFORE `promote_edge` (the write) is called. Returns
        {edge_id, tier: 'EXTRACTED'} on success.

        `user_id` (Phase 44-03, T-44-03-03) is optional keyword-only: when
        supplied (the REST promote endpoint always supplies it, resolved from
        the enforced X-User-Id header), the edge's importer_id must be one
        this user OWNS -- resolved via the injected `importers` port --
        BEFORE the existing body-importer_id equality check runs. Omitting
        `user_id` preserves the exact pre-44-03 behavior (only the body
        importer_id is checked), which is what non-REST callers still do
        (e.g. the chat confirm_action dispatch path).

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

        edge_importer_id = edge.get("importer_id")

        if user_id is not None:
            if self._importers is None:
                raise RuntimeError("PromoteEdgeUseCase requires an importers collaborator when user_id is provided")
            owned_importer_ids = await self._importers.list_importer_ids_for_user(user_id)
            if edge_importer_id not in owned_importer_ids:
                raise EdgeNotPromotable("tenant_mismatch", "edge does not belong to this user")

        if edge_importer_id != importer_id:
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
