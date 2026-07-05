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
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, Protocol

from app.domain.services.widget_result_validator import validate_result_against_schema

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from app.domain.ports.chat_repositories import ChatMessageRepository, ChatRunEvent
    from app.domain.ports.chat_widget_interaction_repository import (
        ChatWidgetInteractionRepository,
        WidgetInteraction,
    )

WidgetSubmitRejectionReason = Literal["not_found", "stale", "invalid", "conflict"]


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
    ) -> None:
        self._widget_interactions = widget_interactions
        self._messages = messages
        self._continuation_runner = continuation_runner

    async def prepare(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
    ) -> AsyncIterator[ChatRunEvent]:
        """Run steps 1-6 and return the (unstarted) continuation event stream.

        Raises WidgetSubmitRejected for every non-resume outcome; callers MUST
        await this before attempting to iterate the returned stream, and must
        catch WidgetSubmitRejected here — none of it is raised while iterating
        the returned continuation.
        """
        interaction = await self._widget_interactions.get(interaction_id)
        if interaction is None or interaction.conversation_id != conversation_id:
            raise WidgetSubmitRejected("not_found", "widget interaction not found")

        if await self._widget_interactions.is_stale(interaction):
            raise WidgetSubmitRejected("stale", "this widget is no longer active")

        outcome = validate_result_against_schema(result, interaction.declared_response_schema)
        if not outcome.ok:
            raise WidgetSubmitRejected("invalid", outcome.reason)

        submitted = await self._widget_interactions.try_submit(interaction_id, result)
        if not submitted:
            raise WidgetSubmitRejected("conflict", "this widget has already been answered")

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

        return self._continuation_runner.continue_after_widget(
            conversation_id=conversation_id, model_id=model_id
        )

    async def submit(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
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
        )
        async for event in continuation:
            yield event

    async def _next_turn_index(self, conversation_id: str) -> int:
        history = await self._messages.list_active_context(conversation_id)
        return max((m.turn_index for m in history), default=-1) + 1


def _resolve_summary(interaction: WidgetInteraction, result: dict[str, Any]) -> dict[str, Any]:
    """Resolve the compact interaction_result summary server-side from the STORED declaration.

    T-24-01: the client only ever submits an optionId (proposal_cards) — the
    real chosen option (title) is looked up from the declaration stored at
    EMIT time, never trusted from the client body. The declared_response_schema's
    additionalProperties:false already rejects any extra client-supplied key
    upstream in validate_result_against_schema — this function only ever sees
    a schema-conforming `result`.
    """
    if interaction.widget_kind == "proposal_cards":
        option_id = result.get("optionId")
        options = interaction.declaration.get("options", [])
        match = next((option for option in options if option.get("id") == option_id), None)
        chosen_title = match["title"] if match else ""
        return {"chosenTitle": chosen_title}
    raise ValueError(f"no result resolver registered for widget_kind {interaction.widget_kind!r}")


__all__ = ["ContinuationRunner", "SubmitWidgetInteraction", "WidgetSubmitRejected", "WidgetSubmitRejectionReason"]
