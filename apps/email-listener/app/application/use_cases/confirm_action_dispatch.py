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

Phase 44-09 (TENA-03 gap closure): both `ConfirmActionHandler.execute()` and
its two concrete implementations gained an additive keyword-only
`user_id: str | None = None` param. `KnowledgeEdgeTierPromotionHandler`
forwards it into `PromoteEdgeUseCase.execute(user_id=...)` — this is the
exact call site the 44-08 sweep flagged as a permanent no-op for the 44-03
ownership guard; threading `user_id` through finally activates it for the
chat confirm_action path. `UnsupportedConfirmActionHandler` accepts and
ignores it (never promotes anything).

Phase 54-03 (CLUS-04/CLUS-05): a THIRD handler, `SourceCaptureHandler`, backs
`suggestionRef.kind == "source_capture"`. Unlike the edge-based handlers
above, there is no `knowledge_node_edges` row to derive tenant scope from —
`ConfirmActionHandler.execute()` gains three more additive keyword-only
params (`source_payload`/`conversation_id`/`thread_id`, all default None)
threaded from the submit path's stored declaration snapshot
(`submit_widget_interaction.py`). The two existing handlers accept-and-ignore
them (unused by an edge-tier promotion or the unsupported stub). On confirm,
`SourceCaptureHandler` writes exactly one INFERRED `knowledge_nodes` row
(reusing an existing active node for the same url — supersede-never-mutate)
plus one INFERRED `knowledge_node_edges` row carrying full provenance
(`{url, title, retrieved_at, conversation_id, thread_id}`) — promotable
through the UNCHANGED `PromoteEdgeUseCase` (CLUS-05, no new promotion
machinery). Reject performs NO write at all — same audit-on-the-row
convention as `KnowledgeEdgeTierPromotionHandler.execute`'s reject branch.
Never raises past `execute()`.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, Literal, Protocol

import structlog

from app.application.use_cases.promote_edge import EdgeNotFound, EdgeNotPromotable

if TYPE_CHECKING:
    from app.application.use_cases.promote_edge import PromoteEdgeUseCase
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)

ConfirmActionResult = dict[str, Any]
ConfirmActionKind = Literal["confirm", "reject"]

_MECHANISM_CHAT_CONFIRM_ACTION = "chat_confirm_action"

# SourceCaptureHandler's node/edge conventions (Phase 54-03, CLUS-04). Kept in
# lockstep with 54-02-PLAN.md's "SHARED CONTRACT" (WebSearchExecutor) and
# 54-06's clusterSummary count query -- literals must stay identical across
# all three plans.
_SOURCE_CAPTURE_SCOPE = "importer_global"
_SOURCE_CAPTURE_SCOPE_REF_TYPE = "web_source"
_SOURCE_CAPTURE_SOURCE = "web_search_capture"
_SOURCE_CAPTURE_TIER = "INFERRED"
_SOURCE_CAPTURE_RELATION_TYPE = "captured_from_web"
_SOURCE_CAPTURE_TARGET_REF_TYPE = "chat_conversation"


class ConfirmActionHandler(Protocol):
    """Port for a single `suggestionRef.kind`'s confirm/reject dispatch target."""

    async def execute(
        self,
        *,
        action: ConfirmActionKind,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
        user_id: str | None = None,
        source_payload: dict[str, object] | None = None,
        conversation_id: str | None = None,
        thread_id: str | None = None,
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
        user_id: str | None = None,
        source_payload: dict[str, object] | None = None,
        conversation_id: str | None = None,
        thread_id: str | None = None,
    ) -> ConfirmActionResult:
        del source_payload, conversation_id, thread_id  # unused -- this handler is edge-based, not source-based
        if action == "reject":
            return {"status": "rejected"}

        try:
            result = await self._promote_edge.execute(
                edge_id=suggestion_id,
                importer_id=importer_id,
                user_id=user_id,
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
        user_id: str | None = None,
        source_payload: dict[str, object] | None = None,
        conversation_id: str | None = None,
        thread_id: str | None = None,
    ) -> ConfirmActionResult:
        del source_payload, conversation_id, thread_id  # unused -- this stub never writes anything
        logger.warning(
            "confirm_action_unsupported_kind",
            suggestion_id=suggestion_id,
            action=action,
        )
        return {"status": "unsupported", "reason": "entity_merge_confirm is not yet supported via chat"}


class SourceCaptureHandler:
    """Dispatch target for `source_capture` (Phase 54-03, CLUS-04/CLUS-05).

    On confirm: reuses an existing active INFERRED node for the same url
    (`find_active_node`, supersede-never-mutate — never a duplicate node),
    or creates one, then ALWAYS inserts a fresh INFERRED
    `knowledge_node_edges` row attaching it to the conversation (the
    addressable half of "the cluster" available at this layer — 54-CONTEXT.md
    defines a cluster as thread + conversations + captured sources) with full
    provenance retained. The edge is promotable through the UNCHANGED
    `PromoteEdgeUseCase` — no new promotion machinery (CLUS-05).

    `reject` performs NO repository call at all — same audit-on-the-row
    convention as `KnowledgeEdgeTierPromotionHandler.execute`'s reject
    branch: the interaction row's own `submitted_value` IS the durable
    rejection record.

    Never raises past `execute()` — any repo failure (or a missing/malformed
    `source_payload`, which should never happen given the emission-time
    server re-read, but is defended here too) collapses to
    `{"status": "capture_failed"}`, logged, not re-raised (mirrors
    `KnowledgeEdgeTierPromotionHandler`'s `promote_failed` posture).
    """

    def __init__(self, *, knowledge_graph: KnowledgeGraphRepository) -> None:
        self._knowledge_graph = knowledge_graph

    async def execute(
        self,
        *,
        action: ConfirmActionKind,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
        user_id: str | None = None,
        source_payload: dict[str, object] | None = None,
        conversation_id: str | None = None,
        thread_id: str | None = None,
    ) -> ConfirmActionResult:
        del user_id, widget_interaction_id  # unused -- no per-user ownership resolver at this layer yet
        if action == "reject":
            return {"status": "rejected"}

        if not importer_id or not isinstance(source_payload, dict):
            logger.warning("source_capture_dispatch_missing_payload", suggestion_id=suggestion_id)
            return {"status": "capture_failed"}

        url = source_payload.get("url")
        if not isinstance(url, str) or not url:
            logger.warning("source_capture_dispatch_missing_url", suggestion_id=suggestion_id)
            return {"status": "capture_failed"}
        title_raw = source_payload.get("title")
        title = title_raw if isinstance(title_raw, str) and title_raw else url
        retrieved_at = source_payload.get("retrievedAt")
        # knowledge_nodes.scope_ref_id is a uuid COLUMN (migration 0006) — a
        # raw url string 22P02s against real Postgres (found live 2026-07-12).
        # uuid5(NAMESPACE_URL, url) is deterministic, so the same url always
        # keys the same node (supersede-never-mutate dedupe preserved); the
        # human-readable url stays in content and in the edge provenance.
        url_key = str(uuid.uuid5(uuid.NAMESPACE_URL, url))

        try:
            existing = await self._knowledge_graph.find_active_node(importer_id, _SOURCE_CAPTURE_SCOPE, url_key)
            if existing is not None:
                node_id = str(existing.get("id"))
            else:
                node_id = await self._knowledge_graph.upsert_node(
                    importer_id=importer_id,
                    title=title,
                    content=url,
                    scope=_SOURCE_CAPTURE_SCOPE,
                    scope_ref_id=url_key,
                    scope_ref_type=_SOURCE_CAPTURE_SCOPE_REF_TYPE,
                    source=_SOURCE_CAPTURE_SOURCE,
                    tier=_SOURCE_CAPTURE_TIER,
                )

            await self._knowledge_graph.insert_edge(
                source_node_id=node_id,
                target_ref_id=conversation_id,
                target_ref_type=_SOURCE_CAPTURE_TARGET_REF_TYPE if conversation_id else None,
                relation_type=_SOURCE_CAPTURE_RELATION_TYPE,
                tier=_SOURCE_CAPTURE_TIER,
                source=_SOURCE_CAPTURE_SOURCE,
                provenance={
                    "url": url,
                    "title": title,
                    "retrieved_at": retrieved_at,
                    "conversation_id": conversation_id,
                    "thread_id": thread_id,
                },
            )
        except Exception as exc:  # never raise -- the interaction row is already durably submitted
            logger.warning(
                "source_capture_dispatch_failed",
                suggestion_id=suggestion_id,
                error_type=type(exc).__name__,
            )
            return {"status": "capture_failed"}

        return {"status": "captured", "node_id": node_id}


__all__ = [
    "ConfirmActionHandler",
    "ConfirmActionKind",
    "ConfirmActionResult",
    "KnowledgeEdgeTierPromotionHandler",
    "SourceCaptureHandler",
    "UnsupportedConfirmActionHandler",
]
