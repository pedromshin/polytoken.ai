"""SubmitWidgetInteraction — validate -> staleness -> CAS lock -> persist -> continuation.

Phase 24-02 Task 2 (DCUI-03, D-10/D-11/D-12/D-16): the use case FastAPI's
POST /v1/chat/widget/submit endpoint (Task 3) delegates to. Every non-resume
outcome (not_found/stale/invalid/conflict) raises a typed WidgetSubmitRejected
BEFORE any continuation event is yielded — the endpoint maps these to
pre-stream HTTP status codes (404/409/422/409) so a rejection NEVER surfaces
mid-stream (T-24-02/T-24-03).

Ordering is fixed and never reordered:
  1. load interaction + ownership check (interaction.conversation_id ==
     conversation_id) -- 404 if missing or wrong conversation (T-24-04)
  2. staleness check (is_stale) -- rejected BEFORE the CAS lock so a stale
     submit never flips a still-pending row it shouldn't (D-12)
  3. re-validate the submitted result against the STORED declared schema
     (D-10) -- never a client-supplied schema (T-24-01)
  4. CAS try_submit (D-11) -- the DB-level double-submit lock
  5. resolve the structured result server-side from the STORED declaration
     (T-24-01: a proposal_cards submit is only ever an optionId; the client
     can never inject an arbitrary payload)
  6. insert the interaction_result user turn (D-16 compact transcript entry)
  7. yield the continuation ChatRunEvents from the injected ContinuationRunner

`prepare()` performs steps 1-6 and returns the (not-yet-iterated) continuation
async iterator — this lets a caller (the Task 3 endpoint) `await prepare()`,
catch WidgetSubmitRejected and map it to a pre-stream HTTP status code, and
only THEN wrap a successful result in a StreamingResponse. `submit()` is a
thin async-generator convenience wrapper over the same logic for callers (and
tests) that just want to iterate start-to-finish.

Domain-pure: collaborators are typed via Protocols (ChatWidgetInteractionRepository/
ChatMessageRepository domain ports; ContinuationRunner a narrow local Protocol
over RunChatTurn.continue_after_widget) -- zero app.infrastructure import
(mirrors generate_ui_spec.py's "Application does not import infrastructure"
posture).

Phase 40-02 (CONF-02): a `confirm_action` interaction additionally re-checks
the referenced `knowledge_node_edges` row's LIVE tier against the
`tierSnapshot` recorded in the declaration at emission time. This runs
immediately after step 2 (staleness) and BEFORE step 3 (schema re-validation)
-- so an out-of-band promotion/deactivation (another chat, the /knowledge
canvas, a plain REST promote) is caught BEFORE any interaction-row mutation,
mirroring D-12's existing turn-staleness placement. This check is a no-op for
every other widget_kind (proposal_cards/clarify_widget). After the CAS
succeeds, a best-effort dispatch call resolves the confirm/reject use case
from the STORED declaration's `suggestionRef.kind` via an explicit 2-entry
table (confirm_action_dispatch.py, T-40-06) -- a dispatch failure is logged
and swallowed, never re-raised, since the interaction row is already durably
submitted by that point.

Phase 44-09 (TENA-03 gap closure): `prepare()`/`submit()` gained an additive
keyword-only `user_id: str | None = None` param, threaded into
`_dispatch_confirm_action` -> `ConfirmActionHandler.execute()` ->
`KnowledgeEdgeTierPromotionHandler.execute()` ->
`PromoteEdgeUseCase.execute(user_id=...)` -- this finally feeds the optional
user-ownership guard `PromoteEdgeUseCase` gained in 44-03 but which the chat
confirm_action dispatch path never fed. The endpoint
(chat_widget.py's `submit_widget`) already asserts conversation ownership
BEFORE calling `prepare()`, so `prepare()` itself does NOT re-check
conversation ownership -- `user_id` here exists purely to feed the promotion
guard. `user_id` stays optional (default None) so existing
`SubmitWidgetInteraction` unit tests / non-endpoint callers are unaffected;
the endpoint always supplies the real value in production.

Phase 54-03 (CLUS-04/CLUS-05): `_dispatch_confirm_action` gained a per-kind
argument-resolution step (`_resolve_confirm_action_dispatch_args`) for
`source_capture`. There is no `knowledge_node_edges` row to derive tenant
scope from for this kind (unlike `knowledge_edge_tier_promotion`'s
ALREADY-FETCHED `edge`) -- `importer_id`/`sourcePayload`/`threadId` are
instead read back from the STORED declaration snapshot
`RunChatTurn._finalize_source_capture` froze server-side at emission time
(mirrors `tierSnapshot`'s existing precedent: the declaration is
server-built and trusted, never client-supplied). `conversation_id` comes
straight from the interaction row itself. `SourceCaptureHandler` is
registered in the SAME `confirm_action_dispatch` table (container.py) --
`_reject_if_confirm_action_edge_stale`'s existing kind check already no-ops
for `source_capture` (only `knowledge_edge_tier_promotion` has a live
tier-staleness re-check to perform), so no change was needed there.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

import structlog

from app.application.use_cases.run_chat_turn_confirm_action import (
    SUGGESTION_KIND_EDGE_TIER_PROMOTION,
    SUGGESTION_KIND_SOURCE_CAPTURE,
)
from app.domain.services.widget_result_validator import validate_result_against_schema

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping

    from app.application.use_cases.confirm_action_dispatch import ConfirmActionHandler, ConfirmActionKind
    from app.domain.ports.chat_repositories import ChatMessageRepository, ChatRunEvent
    from app.domain.ports.chat_widget_interaction_repository import (
        ChatWidgetInteractionRepository,
        WidgetInteraction,
    )
    from app.domain.ports.knowledge_graph_repository import KnowledgeGraphRepository

logger = structlog.get_logger(__name__)

WidgetSubmitRejectionReason = Literal["not_found", "stale", "invalid", "conflict"]

_WIDGET_KIND_CONFIRM_ACTION = "confirm_action"


class WidgetSubmitRejected(Exception):  # noqa: N818 - plan-fixed name (24-CONTEXT.md/24-04-PLAN.md reference it verbatim)
    """Raised for every non-resume outcome (D-10/D-11/D-12, T-24-04 ownership).

    `reason` is the caller-safe discriminator the endpoint maps to an HTTP
    status code; `message` is a short, friendly, non-leaking description
    (CLAUDE.md guardrail — detailed errors stay server-side only).
    """

    def __init__(self, reason: WidgetSubmitRejectionReason, message: str = "") -> None:
        super().__init__(message or reason)
        self.reason = reason
        self.message = message


class ContinuationRunner(Protocol):
    """Narrow seam over RunChatTurn — only the one method this use case needs."""

    def continue_after_widget(self, *, conversation_id: str, model_id: str) -> AsyncIterator[ChatRunEvent]: ...


class SubmitWidgetInteraction:
    """validate -> staleness -> CAS lock -> persist result -> continuation (D-01/D-10/D-11/D-12/D-16)."""

    def __init__(
        self,
        *,
        widget_interactions: ChatWidgetInteractionRepository,
        messages: ChatMessageRepository,
        continuation_runner: ContinuationRunner,
        knowledge_graph: KnowledgeGraphRepository,
        confirm_action_dispatch: Mapping[str, ConfirmActionHandler] = MappingProxyType({}),
    ) -> None:
        self._widget_interactions = widget_interactions
        self._messages = messages
        self._continuation_runner = continuation_runner
        # Phase 40-02 (CONF-02): the live edge-tier re-read collaborator +
        # the explicit finite dispatch table (T-40-06) -- confirm_action_dispatch
        # defaults to an empty mapping so a caller that never registers a kind
        # gets a safe no-op dispatch rather than a crash.
        self._knowledge_graph = knowledge_graph
        self._confirm_action_dispatch = confirm_action_dispatch

    async def prepare(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
        user_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        """Run steps 1-6 and return the (unstarted) continuation event stream.

        Raises WidgetSubmitRejected for every non-resume outcome; callers MUST
        await this before attempting to iterate the returned stream, and must
        catch WidgetSubmitRejected here — none of it is raised while iterating
        the returned continuation.

        `user_id` (Phase 44-09) is optional and threaded through to
        `_dispatch_confirm_action` purely to feed `PromoteEdgeUseCase`'s
        user-ownership guard — this method does NOT re-check conversation
        ownership itself (the endpoint already asserted it).
        """
        interaction = await self._widget_interactions.get(interaction_id)
        if interaction is None or interaction.conversation_id != conversation_id:
            raise WidgetSubmitRejected("not_found", "widget interaction not found")

        if await self._widget_interactions.is_stale(interaction):
            raise WidgetSubmitRejected("stale", "this widget is no longer active")

        edge = await self._reject_if_confirm_action_edge_stale(interaction)

        outcome = validate_result_against_schema(result, interaction.declared_response_schema)
        if not outcome.ok:
            raise WidgetSubmitRejected("invalid", outcome.reason)

        submitted = await self._widget_interactions.try_submit(interaction_id, result)
        if not submitted:
            raise WidgetSubmitRejected("conflict", "this widget has already been answered")

        await self._dispatch_confirm_action(interaction, result, edge, user_id)

        summary = _resolve_summary(interaction, result)
        turn_index = await self._next_turn_index(conversation_id)
        await self._messages.insert_message(
            conversation_id=conversation_id,
            role="user",
            parts=(
                {
                    "type": "interaction_result",
                    "interactionId": interaction.id,
                    "widgetKind": interaction.widget_kind,
                    "summary": summary,
                },
            ),
            turn_index=turn_index,
        )

        return self._continuation_runner.continue_after_widget(conversation_id=conversation_id, model_id=model_id)

    async def submit(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
        user_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        """Convenience async-generator wrapper over prepare() — validate/lock/persist, then stream.

        WidgetSubmitRejected propagates out of the FIRST advance of the
        returned generator (before any event is yielded), since everything up
        to and including the `await self.prepare(...)` call runs before this
        function's own `yield` statement.
        """
        continuation = await self.prepare(
            conversation_id=conversation_id,
            interaction_id=interaction_id,
            result=result,
            model_id=model_id,
            user_id=user_id,
        )
        async for event in continuation:
            yield event

    async def _next_turn_index(self, conversation_id: str) -> int:
        history = await self._messages.list_active_context(conversation_id)
        return max((m.turn_index for m in history), default=-1) + 1

    async def _reject_if_confirm_action_edge_stale(self, interaction: WidgetInteraction) -> dict[str, object] | None:
        """CONF-02: re-check the referenced edge's LIVE tier before any mutation.

        No-op (returns None) unless `widget_kind == "confirm_action"` AND the
        stored `suggestionRef.kind` is the one kind this check knows how to
        verify (`knowledge_edge_tier_promotion`) -- an unregistered/unknown
        kind is defensively skipped (schema/CAS already gate what can reach
        here). MUST run before `try_submit` -- no interaction-row mutation
        may happen on a stale confirm-action (mirrors D-12's existing
        turn-staleness placement).

        Fail-closed: a DB error during the live read is treated identically
        to a tier/is_active mismatch (raises `stale`), never leaked. Returns
        the already-fetched edge dict on success so `_dispatch_confirm_action`
        can reuse it without a second DB read.
        """
        if interaction.widget_kind != _WIDGET_KIND_CONFIRM_ACTION:
            return None

        suggestion_ref = interaction.declaration.get("suggestionRef", {})
        kind = suggestion_ref.get("kind")
        if kind != SUGGESTION_KIND_EDGE_TIER_PROMOTION:
            return None

        suggestion_id = suggestion_ref.get("id")
        tier_snapshot = interaction.declaration.get("tierSnapshot")

        try:
            edge = await self._knowledge_graph.find_edge_by_id(suggestion_id)
        except Exception:  # fail-closed -- a DB hiccup is treated identically to stale
            logger.warning("confirm_action_staleness_check_failed", suggestion_id=suggestion_id)
            edge = None

        if edge is None or not edge.get("is_active") or edge.get("tier") != tier_snapshot:
            raise WidgetSubmitRejected("stale", "this suggestion is no longer available")

        return edge

    async def _dispatch_confirm_action(
        self,
        interaction: WidgetInteraction,
        result: dict[str, Any],
        edge: dict[str, object] | None,
        user_id: str | None,
    ) -> None:
        """CONF-02 best-effort post-CAS dispatch (T-40-06).

        Resolves the confirm/reject use case from the STORED declaration's
        `suggestionRef.kind` via the explicit finite dispatch table -- never
        from client-supplied data. Runs strictly AFTER `try_submit` has
        already succeeded, so the interaction row is durably submitted
        regardless of this call's outcome: any failure here is logged and
        swallowed, NEVER re-raised past this point.

        `importer_id`/`source_payload`/`conversation_id`/`thread_id` are
        resolved per-kind by `_resolve_confirm_action_dispatch_args` (Phase
        54-03) -- never a new caller-supplied parameter on `prepare()`
        itself (D-21-style). `user_id` (Phase 44-09) is forwarded to the
        handler so `KnowledgeEdgeTierPromotionHandler` can finally feed
        `PromoteEdgeUseCase`'s 44-03 user-ownership guard.
        """
        if interaction.widget_kind != _WIDGET_KIND_CONFIRM_ACTION:
            return

        suggestion_ref = interaction.declaration.get("suggestionRef", {})
        kind = suggestion_ref.get("kind")
        handler = self._confirm_action_dispatch.get(kind)
        if handler is None:
            return

        suggestion_id = suggestion_ref.get("id")
        # Already schema-validated to be "confirm"/"reject" by this point
        # (validate_result_against_schema, above) -- safe to narrow.
        action = cast("ConfirmActionKind", result.get("optionId"))
        importer_id, source_payload, conversation_id, thread_id = _resolve_confirm_action_dispatch_args(
            kind=kind, interaction=interaction, edge=edge
        )

        try:
            await handler.execute(
                action=action,
                suggestion_id=suggestion_id,
                importer_id=importer_id,
                widget_interaction_id=interaction.id,
                user_id=user_id,
                source_payload=source_payload,
                conversation_id=conversation_id,
                thread_id=thread_id,
            )
        except Exception:  # best-effort -- the interaction row is already durably submitted
            logger.warning("confirm_action_dispatch_failed", suggestion_id=suggestion_id, kind=kind)


def _resolve_confirm_action_dispatch_args(
    *,
    kind: str,
    interaction: WidgetInteraction,
    edge: dict[str, object] | None,
) -> tuple[str, dict[str, Any] | None, str | None, str | None]:
    """Resolve (importer_id, source_payload, conversation_id, thread_id) per suggestionRef.kind.

    `knowledge_edge_tier_promotion` derives `importer_id` from the
    ALREADY-FETCHED `edge` (unchanged CONF-02 posture) and needs neither a
    source payload nor thread/conversation ids. `source_capture` (Phase
    54-03) has no edge to join through -- its `importer_id`/`sourcePayload`/
    `threadId` are instead read back from the declaration snapshot
    `RunChatTurn._finalize_source_capture` froze server-side at emission
    time (mirrors `tierSnapshot`'s existing precedent: the declaration is
    server-built and trusted); `conversation_id` comes straight from the
    interaction row. Any other/unregistered kind resolves to
    `("", None, None, None)` -- defensive, mirrors the existing
    empty-importer_id fallback (the dispatch lookup above already no-ops
    for a kind with no registered handler).
    """
    if kind == SUGGESTION_KIND_SOURCE_CAPTURE:
        importer_id = cast("str", interaction.declaration.get("importerId") or "")
        source_payload = interaction.declaration.get("sourcePayload")
        thread_id = interaction.declaration.get("threadId")
        return importer_id, source_payload, interaction.conversation_id, thread_id

    importer_id = cast("str", edge.get("importer_id", "")) if edge is not None else ""
    return importer_id, None, None, None


def _resolve_summary(interaction: WidgetInteraction, result: dict[str, Any]) -> dict[str, Any]:
    """Resolve the compact interaction_result summary server-side from the STORED declaration.

    T-24-01: the client only ever submits an optionId (proposal_cards) — the
    real chosen option (title) is looked up from the declaration stored at
    EMIT time, never trusted from the client body. The declared_response_schema's
    additionalProperties:false already rejects any extra client-supplied key
    upstream in validate_result_against_schema — this function only ever sees
    a schema-conforming `result`.
    """
    if interaction.widget_kind in ("proposal_cards", _WIDGET_KIND_CONFIRM_ACTION):
        # confirm_action's declaration.options are shaped identically to
        # proposal_cards' (Phase 40-01) -- {chosenTitle: "Confirm" | "Reject"}
        # reuses this branch verbatim (Phase 40-02, CONF-02).
        option_id = result.get("optionId")
        options = interaction.declaration.get("options", [])
        match = next((option for option in options if option.get("id") == option_id), None)
        chosen_title = match["title"] if match else ""
        return {"chosenTitle": chosen_title}
    if interaction.widget_kind == "clarify_widget":
        # Phase 24-04 (D-16): one {label, value} entry per DECLARED field that
        # the submitted result actually carries a key for — mirrors
        # proposal_cards' own "resolve from the STORED declaration" posture
        # (the field labels come from the declaration, never trusted from a
        # client-supplied summary).
        fields = interaction.declaration.get("fields", [])
        field_summaries = [
            {"label": field.get("label", field.get("name", "")), "value": result[field["name"]]}
            for field in fields
            if field.get("name") in result
        ]
        return {"fields": field_summaries}
    raise ValueError(f"no result resolver registered for widget_kind {interaction.widget_kind!r}")


__all__ = ["ContinuationRunner", "SubmitWidgetInteraction", "WidgetSubmitRejected", "WidgetSubmitRejectionReason"]
