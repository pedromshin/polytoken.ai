"""confirm_action_dispatch — the CONF-02 explicit 2-entry use-case table.

Backs `SubmitWidgetInteraction.prepare()`'s post-CAS dispatch step: once a
`confirm_action` widget interaction has been durably submitted (the
interaction row's own CAS `try_submit` already succeeded), this module
resolves WHICH use case actually runs from the STORED declaration's
`suggestionRef.kind` — never from client-supplied data (T-40-06).

Two handlers only, matching the two `suggestionRef.kind` values Plan 40-01
registered (`run_chat_turn_confirm_action.SUGGESTION_KIND_EDGE_TIER_
PROMOTION`/`SUGGESTION_KIND_ENTITY_MERGE_CONFIRM`):

- `KnowledgeEdgeTierPromotionHandler` wraps `PromoteEdgeUseCase` for
  `knowledge_edge_tier_promotion` — the only kind reachable via the
  `emit_confirm_action` tool's own JSON schema this phase.
- `UnsupportedConfirmActionHandler` is a registered-but-unsupported stub for
  `entity_merge_confirm` — `component_entity_candidate_links` is pair-keyed
  (entity_instance_id, target_id), not addressable by a single
  `suggestionRef.id` (see `curate_entity_merge.py`'s `ConfirmMergeUseCase`,
  which takes a PAIR, not one id). Inventing a surrogate key for this is
  explicitly out of scope this phase (40-CONTEXT.md) — this handler exists
  ONLY so a dict.get lookup by kind never raises a raw KeyError.

Neither handler ever raises past `execute()` — a dispatch failure runs AFTER
the interaction row's own CAS has already succeeded, so the turn must still
complete cleanly (T-40-07's accepted residual race: `PromoteEdgeUseCase`'s
own CAS is the second, independent guard against a concurrent promotion).

Domain-pure: the only collaborator is `PromoteEdgeUseCase` (an application
use case, not infrastructure) — zero `app.infrastructure` import.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, Protocol

import structlog

from app.application.use_cases.promote_edge import EdgeNotFound, EdgeNotPromotable

if TYPE_CHECKING:
    from app.application.use_cases.promote_edge import PromoteEdgeUseCase

logger = structlog.get_logger(__name__)

ConfirmActionResult = dict[str, Any]
ConfirmActionKind = Literal["confirm", "reject"]

_MECHANISM_CHAT_CONFIRM_ACTION = "chat_confirm_action"


class ConfirmActionHandler(Protocol):
    """Port for a single `suggestionRef.kind`'s confirm/reject dispatch target."""

    async def execute(
        self,
        *,
        action: ConfirmActionKind,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
    ) -> ConfirmActionResult: ...


class KnowledgeEdgeTierPromotionHandler:
    """Dispatch target for `knowledge_edge_tier_promotion` — wraps PromoteEdgeUseCase.

    `reject` performs NO promote_edge call at all — audit-on-the-row
    convention: the interaction row's own `submitted_value`, already
    persisted by the CAS step in `SubmitWidgetInteraction.prepare()` BEFORE
    this handler ever runs, IS the durable rejection record. The edge is
    left untouched — still a live suggestion elsewhere, never deleted
    (40-CONTEXT.md's "rejection must NOT delete" constraint).
    """

    def __init__(self, *, promote_edge: PromoteEdgeUseCase) -> None:
        self._promote_edge = promote_edge

    async def execute(
        self,
        *,
        action: ConfirmActionKind,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
    ) -> ConfirmActionResult:
        if action == "reject":
            return {"status": "rejected"}

        try:
            result = await self._promote_edge.execute(
                edge_id=suggestion_id,
                importer_id=importer_id,
                mechanism=_MECHANISM_CHAT_CONFIRM_ACTION,
                extra={"widget_interaction_id": widget_interaction_id},
            )
        except (EdgeNotFound, EdgeNotPromotable) as exc:
            logger.warning(
                "confirm_action_promote_failed",
                edge_id=suggestion_id,
                reason=getattr(exc, "reason", None) or str(exc),
            )
            return {"status": "promote_failed"}

        return {"status": "promoted", **result}


class UnsupportedConfirmActionHandler:
    """Registered-but-unsupported stub for `entity_merge_confirm` (40-CONTEXT.md's pair-keyed blocker).

    `component_entity_candidate_links` is pair-keyed
    (entity_instance_id, target_id) — `curate_entity_merge.ConfirmMergeUseCase`
    takes that PAIR, not a single addressable id, so a single
    `suggestionRef.id` cannot address one merge candidate without inventing
    a surrogate key. 40-CONTEXT.md forbids inventing one this phase. This
    handler exists ONLY so the dispatch table has its full 2 entries
    (CONF-02) and a lookup by kind never raises a raw KeyError — it never
    raises, always returns a clear `unsupported` result.
    """

    async def execute(
        self,
        *,
        action: ConfirmActionKind,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
    ) -> ConfirmActionResult:
        logger.warning(
            "confirm_action_unsupported_kind",
            suggestion_id=suggestion_id,
            action=action,
        )
        return {"status": "unsupported", "reason": "entity_merge_confirm is not yet supported via chat"}


__all__ = [
    "ConfirmActionHandler",
    "ConfirmActionKind",
    "ConfirmActionResult",
    "KnowledgeEdgeTierPromotionHandler",
    "UnsupportedConfirmActionHandler",
]
