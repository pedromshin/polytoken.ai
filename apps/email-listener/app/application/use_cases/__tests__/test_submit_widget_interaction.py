"""Tests for SubmitWidgetInteraction (Phase 24-02 Task 2, D-10/D-11/D-12/D-16).

TDD RED->GREEN: the ordering validate -> staleness -> CAS lock -> persist ->
continuation is fixed and never reordered. Every non-resume outcome
(not_found/stale/invalid/conflict) raises WidgetSubmitRejected BEFORE
try_submit is called and BEFORE any interaction_result message is inserted or
continuation event is yielded. A valid, first, non-stale submit resolves the
proposal payload from the STORED declaration (never trusting a client-
supplied value), inserts exactly one interaction_result user turn, and yields
the continuation runner's events.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.application.use_cases.submit_widget_interaction import (
    SubmitWidgetInteraction,
    WidgetSubmitRejected,
)
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction

_DECLARATION: dict[str, Any] = {
    "options": [
        {"id": "opt-0", "title": "Alpha", "value": {"id": "a"}},
        {"id": "opt-1", "title": "Beta", "description": "second", "value": {"id": "b"}},
    ]
}
_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["optionId"],
    "additionalProperties": False,
    "properties": {"optionId": {"enum": ["opt-0", "opt-1"]}},
}

# Phase 40-02 (CONF-02): a confirm_action declaration/schema pair, shaped exactly
# like Plan 40-01's build_confirm_action_declaration output.
_EDGE_ID = "edge-1"
_IMPORTER_ID = "imp-1"
_CONFIRM_ACTION_DECLARATION: dict[str, Any] = {
    "prompt": 'Promote this suggested "works_at" relationship to confirmed?',
    "options": [
        {"id": "confirm", "title": "Confirm", "description": "Confidence 0.8, currently INFERRED."},
        {"id": "reject", "title": "Reject"},
    ],
    "suggestionRef": {"kind": "knowledge_edge_tier_promotion", "id": _EDGE_ID},
    "tierSnapshot": "INFERRED",
}
_CONFIRM_ACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["optionId"],
    "additionalProperties": False,
    "properties": {"optionId": {"enum": ["confirm", "reject"]}},
}


def _interaction(**overrides: Any) -> WidgetInteraction:
    base: dict[str, Any] = {
        "id": "int-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "part_index": 0,
        "turn_index": 2,
        "widget_kind": "proposal_cards",
        "declaration": _DECLARATION,
        "declared_response_schema": _SCHEMA,
        "state": "pending",
        "sibling_group_id": None,
        "submitted_value": None,
    }
    base.update(overrides)
    return WidgetInteraction(**base)


def _confirm_action_interaction(**overrides: Any) -> WidgetInteraction:
    base: dict[str, Any] = {
        "id": "int-confirm-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "part_index": 0,
        "turn_index": 2,
        "widget_kind": "confirm_action",
        "declaration": _CONFIRM_ACTION_DECLARATION,
        "declared_response_schema": _CONFIRM_ACTION_SCHEMA,
        "state": "pending",
        "sibling_group_id": None,
        "submitted_value": None,
    }
    base.update(overrides)
    return WidgetInteraction(**base)


def _live_edge(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"id": _EDGE_ID, "importer_id": _IMPORTER_ID, "tier": "INFERRED", "is_active": True}
    base.update(overrides)
    return base


def _seed_message(turn_index: int = 2) -> ChatMessage:
    return ChatMessage(
        id="msg-0",
        conversation_id="conv-1",
        role="assistant",
        parts=({"type": "interactive_widget", "interactionId": "int-1", "widgetKind": "proposal_cards"},),
        turn_index=turn_index,
    )


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeChatWidgetInteractionRepository:
    """In-memory ChatWidgetInteractionRepository test double for the submit path."""

    def __init__(
        self,
        *,
        interaction: WidgetInteraction | None,
        stale: bool = False,
        try_submit_result: bool = True,
    ) -> None:
        self._interaction = interaction
        self._stale = stale
        self._try_submit_result = try_submit_result
        self.try_submit_calls: list[tuple[str, dict[str, Any]]] = []
        self.is_stale_calls: list[str] = []

    async def create_pending(self, **kwargs: Any) -> WidgetInteraction:  # pragma: no cover - unused this path
        raise NotImplementedError

    async def get(self, interaction_id: str) -> WidgetInteraction | None:
        if self._interaction is not None and self._interaction.id == interaction_id:
            return self._interaction
        return None

    async def try_submit(self, interaction_id: str, submitted_value: dict[str, Any]) -> bool:
        self.try_submit_calls.append((interaction_id, submitted_value))
        return self._try_submit_result

    async def is_stale(self, interaction: WidgetInteraction) -> bool:
        self.is_stale_calls.append(interaction.id)
        return self._stale


class FakeChatMessageRepository:
    """In-memory ChatMessageRepository test double — only insert_message/list_active_context needed."""

    def __init__(self, *, existing: list[ChatMessage] | None = None) -> None:
        self._existing = existing or []
        self.inserted: list[ChatMessage] = []

    async def insert_message(
        self,
        *,
        conversation_id: str,
        role: str,
        parts: Any,
        turn_index: int,
        status: str = "completed",
        run_id: str | None = None,
        sibling_group_id: str | None = None,
        version: int = 1,
        is_active: bool = True,
    ) -> ChatMessage:
        message = ChatMessage(
            id=f"msg-inserted-{len(self.inserted) + 1}",
            conversation_id=conversation_id,
            role=role,  # type: ignore[arg-type]
            parts=tuple(parts),
            turn_index=turn_index,
            status=status,  # type: ignore[arg-type]
            run_id=run_id,
            sibling_group_id=sibling_group_id,
            version=version,
            is_active=is_active,
        )
        self.inserted.append(message)
        return message

    async def list_active_context(self, conversation_id: str) -> list[ChatMessage]:
        return [m for m in self._existing if m.conversation_id == conversation_id]

    async def mark_status(self, message_id: str, status: str) -> None:  # pragma: no cover - unused
        pass

    async def set_sibling_inactive(self, sibling_group_id: str) -> None:  # pragma: no cover - unused
        pass


class FakeContinuationRunner:
    """A ContinuationRunner test double streaming a pre-configured event sequence."""

    def __init__(self, events: list[ChatRunEvent]) -> None:
        self._events = events
        self.calls: list[dict[str, Any]] = []

    async def continue_after_widget(self, *, conversation_id: str, model_id: str) -> Any:
        self.calls.append({"conversation_id": conversation_id, "model_id": model_id})
        for event in self._events:
            yield event


class FakeKnowledgeGraphRepository:
    """In-memory KnowledgeGraphRepository test double — only find_edge_by_id needed (CONF-02).

    `raises=True` simulates a DB hiccup during the live read (fail-closed -> stale).
    """

    def __init__(self, *, edge: dict[str, Any] | None = None, raises: bool = False) -> None:
        self._edge = edge
        self._raises = raises
        self.find_edge_by_id_calls: list[str] = []

    async def find_edge_by_id(self, edge_id: str) -> dict[str, Any] | None:
        self.find_edge_by_id_calls.append(edge_id)
        if self._raises:
            raise RuntimeError("simulated DB hiccup")
        return self._edge


class FakeConfirmActionHandler:
    """Records execute() calls; returns a pre-configured result (or raises, best-effort test)."""

    def __init__(self, *, result: dict[str, Any] | None = None, raises: bool = False) -> None:
        self._result = result if result is not None else {"status": "ok"}
        self._raises = raises
        self.execute_calls: list[dict[str, Any]] = []

    async def execute(
        self,
        *,
        action: str,
        suggestion_id: str,
        importer_id: str,
        widget_interaction_id: str,
    ) -> dict[str, Any]:
        self.execute_calls.append(
            {
                "action": action,
                "suggestion_id": suggestion_id,
                "importer_id": importer_id,
                "widget_interaction_id": widget_interaction_id,
            }
        )
        if self._raises:
            raise RuntimeError("simulated dispatch failure")
        return self._result


def _make_use_case(
    *,
    widget_interactions: FakeChatWidgetInteractionRepository,
    messages: FakeChatMessageRepository | None = None,
    runner: FakeContinuationRunner | None = None,
    knowledge_graph: FakeKnowledgeGraphRepository | None = None,
    confirm_action_dispatch: dict[str, FakeConfirmActionHandler] | None = None,
) -> tuple[SubmitWidgetInteraction, FakeChatMessageRepository, FakeContinuationRunner]:
    messages = messages or FakeChatMessageRepository(existing=[_seed_message()])
    runner = runner or FakeContinuationRunner([])
    knowledge_graph = knowledge_graph or FakeKnowledgeGraphRepository()
    use_case = SubmitWidgetInteraction(
        widget_interactions=widget_interactions,
        messages=messages,
        continuation_runner=runner,
        knowledge_graph=knowledge_graph,  # type: ignore[arg-type]
        confirm_action_dispatch=confirm_action_dispatch or {},  # type: ignore[arg-type]
    )
    return use_case, messages, runner


# ---------------------------------------------------------------------------
# Ordering: not_found / stale / invalid / conflict never resume (D-10/D-11/D-12)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_interaction_raises_not_found() -> None:
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=None)
    use_case, messages, runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1", interaction_id="missing-id", result={"optionId": "opt-0"}, model_id="m1"
        ):
            pass

    assert exc_info.value.reason == "not_found"
    assert not widget_interactions.try_submit_calls
    assert not messages.inserted
    assert not runner.calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_conversation_mismatch_raises_not_found() -> None:
    interaction = _interaction(conversation_id="other-conv")
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction)
    use_case, messages, _runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-0"}, model_id="m1"
        ):
            pass

    assert exc_info.value.reason == "not_found"
    assert not widget_interactions.try_submit_calls
    assert not messages.inserted


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stale_interaction_raises_and_never_calls_try_submit() -> None:
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=True)
    use_case, messages, runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-0"}, model_id="m1"
        ):
            pass

    assert exc_info.value.reason == "stale"
    assert widget_interactions.is_stale_calls == ["int-1"]
    assert not widget_interactions.try_submit_calls
    assert not messages.inserted
    assert not runner.calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_invalid_result_raises_and_never_calls_try_submit() -> None:
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    use_case, messages, runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-1",
            result={"optionId": "not-a-real-option"},
            model_id="m1",
        ):
            pass

    assert exc_info.value.reason == "invalid"
    assert not widget_interactions.try_submit_calls
    assert not messages.inserted
    assert not runner.calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_forged_extra_result_field_rejected_by_schema_before_resolution() -> None:
    """additionalProperties:false on the declared schema rejects any extra client key (T-24-01)."""
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    use_case, _messages, _runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-1",
            result={"optionId": "opt-0", "value": {"id": "forged"}},
            model_id="m1",
        ):
            pass

    assert exc_info.value.reason == "invalid"
    assert not widget_interactions.try_submit_calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_conflict_when_try_submit_returns_false() -> None:
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False, try_submit_result=False)
    use_case, messages, runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-0"}, model_id="m1"
        ):
            pass

    assert exc_info.value.reason == "conflict"
    assert widget_interactions.try_submit_calls == [("int-1", {"optionId": "opt-0"})]
    assert not messages.inserted
    assert not runner.calls


# ---------------------------------------------------------------------------
# Valid path: resolve from STORED declaration, persist, continuation (D-01/D-16)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_valid_submit_inserts_interaction_result_and_yields_continuation_events() -> None:
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False, try_submit_result=True)
    messages = FakeChatMessageRepository(existing=[_seed_message(turn_index=2)])
    events = [ChatRunEvent(type="started", data={}), ChatRunEvent(type="completed", data={})]
    runner = FakeContinuationRunner(events)
    use_case, messages, runner = _make_use_case(widget_interactions=widget_interactions, messages=messages, runner=runner)

    yielded = [
        event
        async for event in use_case.submit(
            conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-0"}, model_id="m1"
        )
    ]

    assert [e.type for e in yielded] == ["started", "completed"]
    assert widget_interactions.try_submit_calls == [("int-1", {"optionId": "opt-0"})]

    assert len(messages.inserted) == 1
    inserted = messages.inserted[0]
    assert inserted.role == "user"
    assert inserted.turn_index == 3  # next after the seeded turn_index=2 message
    assert len(inserted.parts) == 1
    part = inserted.parts[0]
    assert part["type"] == "interaction_result"
    assert part["interactionId"] == "int-1"
    assert part["widgetKind"] == "proposal_cards"
    assert part["summary"] == {"chosenTitle": "Alpha"}

    assert runner.calls == [{"conversation_id": "conv-1", "model_id": "m1"}]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolved_summary_uses_stored_declaration_for_the_chosen_option() -> None:
    """The client only ever submits an optionId — title/value are resolved from the STORED
    declaration server-side (T-24-01), proven here by resolving a DIFFERENT option (opt-1)."""
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    use_case, messages, _runner = _make_use_case(widget_interactions=widget_interactions)

    async for _ in use_case.submit(
        conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-1"}, model_id="m1"
    ):
        pass

    assert messages.inserted[0].parts[0]["summary"] == {"chosenTitle": "Beta"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_clarify_widget_summary_resolves_field_labels_from_stored_declaration() -> None:
    """Phase 24-04 (D-16): clarify_widget summary = one {label, value} entry per submitted
    field, with the label resolved from the STORED declaration (never a client-supplied one)."""
    interaction = _interaction(
        widget_kind="clarify_widget",
        declaration={
            "submitLabel": "Send response",
            "fields": [
                {"name": "reason", "label": "Reason"},
                {"name": "priority", "label": "Priority"},
            ],
        },
        declared_response_schema={
            "type": "object",
            "required": ["reason"],
            "additionalProperties": False,
            "properties": {"reason": {"type": "string"}, "priority": {"enum": ["low", "high"]}},
        },
    )
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    use_case, messages, _runner = _make_use_case(widget_interactions=widget_interactions)

    async for _ in use_case.submit(
        conversation_id="conv-1",
        interaction_id="int-1",
        result={"reason": "Need more time", "priority": "high"},
        model_id="m1",
    ):
        pass

    assert messages.inserted[0].parts[0]["summary"] == {
        "fields": [
            {"label": "Reason", "value": "Need more time"},
            {"label": "Priority", "value": "high"},
        ]
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_ordering_is_stale_check_before_cas_lock() -> None:
    """Staleness is checked BEFORE try_submit — a stale submit must never flip a pending row."""
    interaction = _interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=True)
    use_case, _messages, _runner = _make_use_case(widget_interactions=widget_interactions)

    with pytest.raises(WidgetSubmitRejected):
        async for _ in use_case.submit(
            conversation_id="conv-1", interaction_id="int-1", result={"optionId": "opt-0"}, model_id="m1"
        ):
            pass

    assert widget_interactions.is_stale_calls == ["int-1"]
    assert widget_interactions.try_submit_calls == []


# ---------------------------------------------------------------------------
# Phase 40-02 (CONF-02): confirm_action edge-tier staleness re-check + dispatch
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_stale_when_edge_tier_promoted_out_of_band() -> None:
    """THE MUST-TEST (CONF-02's headline safety property): emit a confirm_action widget,
    promote the SAME edge out-of-band via v1.5's existing REST promote_edge path (simulated
    by the fake KnowledgeGraphRepository returning a changed tier), submit the widget ->
    WidgetSubmitRejected(reason="stale") -- and prove ZERO interaction-row mutation
    (try_submit never called) AND ZERO edge double-mutation (dispatch handler's execute
    never called)."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge(tier="EXTRACTED"))
    dispatch_handler = FakeConfirmActionHandler()
    messages = FakeChatMessageRepository(existing=[])
    runner = FakeContinuationRunner([])
    use_case, messages, runner = _make_use_case(
        widget_interactions=widget_interactions,
        messages=messages,
        runner=runner,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": dispatch_handler},
    )

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        ):
            pass

    assert exc_info.value.reason == "stale"
    assert knowledge_graph.find_edge_by_id_calls == [_EDGE_ID]
    assert not widget_interactions.try_submit_calls, "no interaction-row mutation on a stale confirm-action"
    assert not dispatch_handler.execute_calls, "no dispatch call at all -- no edge double-mutation"
    assert not messages.inserted
    assert not runner.calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_stale_when_edge_deactivated_out_of_band() -> None:
    """Same MUST-test shape as the tier-changed variant, for is_active=False (the edge was
    deactivated/superseded out-of-band) -- also rejects stale before any mutation."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge(is_active=False))
    dispatch_handler = FakeConfirmActionHandler()
    use_case, messages, runner = _make_use_case(
        widget_interactions=widget_interactions,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": dispatch_handler},
    )

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        ):
            pass

    assert exc_info.value.reason == "stale"
    assert not widget_interactions.try_submit_calls
    assert not dispatch_handler.execute_calls
    assert not messages.inserted
    assert not runner.calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_stale_when_edge_lookup_raises() -> None:
    """Fail-closed: a DB error during the live re-read is treated identically to stale,
    never leaked as a raw exception."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(raises=True)
    use_case, _messages, _runner = _make_use_case(
        widget_interactions=widget_interactions,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": FakeConfirmActionHandler()},
    )

    with pytest.raises(WidgetSubmitRejected) as exc_info:
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        ):
            pass

    assert exc_info.value.reason == "stale"
    assert not widget_interactions.try_submit_calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_non_stale_confirm_dispatches_and_yields_continuation() -> None:
    """Non-stale confirm: edge tier still matches the snapshot -> submit succeeds, try_submit
    called once, the dispatch handler's execute(action="confirm", ...) called exactly once,
    _resolve_summary returns {chosenTitle: "Confirm"}, continuation events are yielded."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge())
    dispatch_handler = FakeConfirmActionHandler(result={"status": "promoted", "edge_id": _EDGE_ID, "tier": "EXTRACTED"})
    events = [ChatRunEvent(type="started", data={}), ChatRunEvent(type="completed", data={})]
    runner = FakeContinuationRunner(events)
    messages = FakeChatMessageRepository(existing=[_seed_message(turn_index=2)])
    use_case, messages, runner = _make_use_case(
        widget_interactions=widget_interactions,
        messages=messages,
        runner=runner,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": dispatch_handler},
    )

    yielded = [
        event
        async for event in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        )
    ]

    assert [e.type for e in yielded] == ["started", "completed"]
    assert widget_interactions.try_submit_calls == [("int-confirm-1", {"optionId": "confirm"})]
    assert len(dispatch_handler.execute_calls) == 1
    call = dispatch_handler.execute_calls[0]
    assert call["action"] == "confirm"
    assert call["suggestion_id"] == _EDGE_ID
    assert call["importer_id"] == _IMPORTER_ID
    assert call["widget_interaction_id"] == "int-confirm-1"
    assert messages.inserted[0].parts[0]["summary"] == {"chosenTitle": "Confirm"}
    assert runner.calls == [{"conversation_id": "conv-1", "model_id": "m1"}]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_non_stale_reject_dispatches_and_never_mutates_edge() -> None:
    """Non-stale reject: submit succeeds, dispatch handler's execute(action="reject", ...)
    called once, summary {chosenTitle: "Reject"} -- reject never mutates the edge (the
    dispatch handler itself is responsible for that; this test proves the CALL shape)."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge())
    dispatch_handler = FakeConfirmActionHandler(result={"status": "rejected"})
    messages = FakeChatMessageRepository(existing=[_seed_message(turn_index=2)])
    use_case, messages, _runner = _make_use_case(
        widget_interactions=widget_interactions,
        messages=messages,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": dispatch_handler},
    )

    async for _ in use_case.submit(
        conversation_id="conv-1",
        interaction_id="int-confirm-1",
        result={"optionId": "reject"},
        model_id="m1",
    ):
        pass

    assert widget_interactions.try_submit_calls == [("int-confirm-1", {"optionId": "reject"})]
    assert len(dispatch_handler.execute_calls) == 1
    assert dispatch_handler.execute_calls[0]["action"] == "reject"
    assert messages.inserted[0].parts[0]["summary"] == {"chosenTitle": "Reject"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_unregistered_suggestion_kind_never_crashes() -> None:
    """Defensive: an unknown/unregistered suggestionRef.kind (should never occur given
    40-01's tool schema) must not crash the submit path -- the staleness re-check and the
    dispatch lookup both skip cleanly, schema/CAS already gate what can reach here."""
    interaction = _confirm_action_interaction(
        declaration={**_CONFIRM_ACTION_DECLARATION, "suggestionRef": {"kind": "some_future_kind", "id": _EDGE_ID}},
    )
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge())
    dispatch_handler = FakeConfirmActionHandler()
    use_case, _messages, _runner = _make_use_case(
        widget_interactions=widget_interactions,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": dispatch_handler},
    )

    yielded = [
        event
        async for event in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        )
    ]

    assert yielded == []
    assert widget_interactions.try_submit_calls == [("int-confirm-1", {"optionId": "confirm"})]
    assert not knowledge_graph.find_edge_by_id_calls, "unregistered kind skips the live edge staleness re-check"
    assert not dispatch_handler.execute_calls, "unregistered kind resolves to a safe no-op dispatch"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_ordering_edge_staleness_check_before_cas_lock() -> None:
    """Source-ordering proof: the edge-tier staleness re-check runs BEFORE try_submit --
    a stale confirm-action must never flip a pending row (mirrors D-12's staleness placement)."""
    interaction = _confirm_action_interaction()
    widget_interactions = FakeChatWidgetInteractionRepository(interaction=interaction, stale=False)
    knowledge_graph = FakeKnowledgeGraphRepository(edge=_live_edge(tier="AMBIGUOUS"))
    use_case, _messages, _runner = _make_use_case(
        widget_interactions=widget_interactions,
        knowledge_graph=knowledge_graph,
        confirm_action_dispatch={"knowledge_edge_tier_promotion": FakeConfirmActionHandler()},
    )

    with pytest.raises(WidgetSubmitRejected):
        async for _ in use_case.submit(
            conversation_id="conv-1",
            interaction_id="int-confirm-1",
            result={"optionId": "confirm"},
            model_id="m1",
        ):
            pass

    assert knowledge_graph.find_edge_by_id_calls == [_EDGE_ID]
    assert widget_interactions.try_submit_calls == []
