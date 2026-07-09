"""Tests for RunChatTurn's emit_confirm_action finalization (Phase 40-01 Task 3, CONF-01).

A genui-capable model streams an emit_confirm_action tool call;
`_finalize_confirm_action` re-reads the live `knowledge_node_edges` row named
by the call's `suggestionRef.id` via the injected KnowledgeGraphRepository and
either finalizes exactly one `interactive_widget` part (widgetKind
"confirm_action", frozen confirm/reject declaration, a matching
create_pending() call) when the edge is valid, or a visible
CONFIRM_ACTION_UNAVAILABLE_TEXT text part (no widget, create_pending never
called) when the edge is missing/cross-importer/inactive/wrong-tier. A
malformed call (missing suggestionRef, or a rejected kind) never reaches the
knowledge_graph lookup at all and finalizes into PARSE_FAILURE_TEXT instead.
A regression case proves emit_proposal_cards is unaffected by this plan's
changes (`_finalize_confirm_action` no-ops when the pending tool name isn't
emit_confirm_action).

Deviation note: mirrors test_run_chat_turn_interactive_widget.py's own
precedent (co-located __tests__/, hand-authored test-double tool dicts rather
than importing app.infrastructure.llm.chat_tools — the import-linter
"Application does not import infrastructure" contract applies to this file
too since it is nested under app.application).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_confirm_action import CONFIRM_ACTION_UNAVAILABLE_TEXT
from app.application.use_cases.run_chat_turn_tool_loop import PARSE_FAILURE_TEXT
from app.domain.ports.chat_provider import StreamEnd, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

_IMPORTER_ID = "importer-1"
_OTHER_IMPORTER_ID = "importer-2"
_CONVERSATION_ID = "conv-1"
_EDGE_ID = "edge-1"

_GENUI_MODEL = ChatModel(
    id="test-genui-model",
    display_name="Test GenUI Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=200_000),
    best_for="testing",
)
_TEST_MODELS = {_GENUI_MODEL.id: _GENUI_MODEL}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}
_TEST_PROPOSAL_CARDS_TOOL: dict[str, Any] = {
    "name": "emit_proposal_cards",
    "description": "test",
    "input_schema": {},
}
_TEST_CONFIRM_ACTION_TOOL: dict[str, Any] = {
    "name": "emit_confirm_action",
    "description": "test",
    "input_schema": {},
}

_VALID_EDGE: dict[str, object] = {
    "id": _EDGE_ID,
    "importer_id": _IMPORTER_ID,
    "is_active": True,
    "tier": "INFERRED",
    "relation_type": "works_at",
    "confidence": 0.75,
}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only model."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


# ---------------------------------------------------------------------------
# Test doubles (mirrors test_run_chat_turn_interactive_widget.py's shape)
# ---------------------------------------------------------------------------


class FakeChatMessageRepository:
    """In-memory ChatMessageRepository test double."""

    def __init__(self) -> None:
        self.messages: list[ChatMessage] = []
        self._next_id = 0

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
        self._next_id += 1
        message = ChatMessage(
            id=f"msg-{self._next_id}",
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
        self.messages.append(message)
        return message

    async def list_active_context(self, conversation_id: str) -> list[ChatMessage]:
        active = [m for m in self.messages if m.conversation_id == conversation_id and m.is_active]
        return sorted(active, key=lambda m: m.turn_index)

    async def mark_status(self, message_id: str, status: str) -> None:
        pass

    async def set_sibling_inactive(self, sibling_group_id: str) -> None:
        pass


class FakeChatRunRepository:
    """In-memory ChatRunRepository test double."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> ChatRun:
        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self.runs[run_id] = {"status": "running"}
        self._seq_by_run[run_id] = 0
        return ChatRun(id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running")

    async def append_event(self, *, run_id: str, event_type: str, data: dict[str, Any]) -> ChatRunEvent:
        seq = self._seq_by_run.get(run_id, 0)
        self._seq_by_run[run_id] = seq + 1
        return ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]

    async def finish_run(self, *, run_id: str, status: str) -> None:
        self.runs[run_id]["status"] = status


class FakeChatConversationRepository:
    """In-memory ChatConversationRepository test double."""

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass


class FakeChatWidgetInteractionRepository:
    """In-memory ChatWidgetInteractionRepository test double — records create_pending calls."""

    def __init__(self) -> None:
        self.create_pending_calls: list[dict[str, Any]] = []

    async def create_pending(self, **kwargs: Any) -> WidgetInteraction:
        self.create_pending_calls.append(kwargs)
        return WidgetInteraction(
            id=kwargs.get("interaction_id") or "generated-id",
            conversation_id=kwargs["conversation_id"],
            message_id=kwargs["message_id"],
            part_index=kwargs["part_index"],
            turn_index=kwargs["turn_index"],
            widget_kind=kwargs["widget_kind"],
            declaration=kwargs["declaration"],
            declared_response_schema=kwargs["declared_response_schema"],
            state="pending",
            sibling_group_id=kwargs.get("sibling_group_id"),
        )

    async def get(self, interaction_id: str) -> WidgetInteraction | None:  # pragma: no cover - unused this plan
        return None

    async def try_submit(self, interaction_id: str, submitted_value: dict[str, Any]) -> bool:  # pragma: no cover
        return False

    async def is_stale(self, interaction: WidgetInteraction) -> bool:  # pragma: no cover - unused this plan
        return False

    async def supersede_pending(self, conversation_id: str) -> int:  # pragma: no cover - regression only
        return 0


class FakeKnowledgeGraphRepository:
    """Records find_edge_by_id calls; returns a pre-configured dict[str, object] | None."""

    def __init__(self, edge: dict[str, object] | None) -> None:
        self._edge = edge
        self.find_edge_by_id_calls: list[str] = []

    async def find_edge_by_id(self, edge_id: str) -> dict[str, object] | None:
        self.find_edge_by_id_calls.append(edge_id)
        return self._edge


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas."""

    def __init__(self, deltas: list[Any]) -> None:
        self._deltas = deltas
        self.stream_calls: list[dict[str, Any]] = []

    async def stream(self, **kwargs: Any) -> Any:
        self.stream_calls.append(kwargs)
        for delta in self._deltas:
            yield delta


class FakeCostCircuitBreaker:
    """A CostCircuitBreaker test double that always allows and never mid-stream aborts."""

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        return PreTurnDecision.allow()

    def should_abort(self, running_cost: Decimal) -> bool:
        return False

    def estimate_turn_cost(self, *, model: ChatModel, prompt_tokens_est: int, max_output_tokens: int) -> Decimal:
        return Decimal("0")


class FakeCostLedgerRepository:
    """In-memory CostLedgerRepository test double."""

    def __init__(self) -> None:
        self.recorded: list[UsageEvent] = []

    async def record(self, event: UsageEvent) -> None:
        self.recorded.append(event)


class _FakeRouter:
    """Duck-typed ChatProviderRouter test double — returns a pre-set provider."""

    def __init__(self, provider: FakeChatProvider) -> None:
        self._provider = provider

    def select(self, model_id: str) -> FakeChatProvider:
        return self._provider


def _make_use_case(
    *,
    provider: FakeChatProvider,
    widget_interactions: FakeChatWidgetInteractionRepository | None = None,
    knowledge_graph: FakeKnowledgeGraphRepository | None = None,
) -> tuple[RunChatTurn, FakeChatMessageRepository]:
    messages = FakeChatMessageRepository()
    use_case = RunChatTurn(
        messages=messages,
        runs=FakeChatRunRepository(),
        conversations=FakeChatConversationRepository(),
        router=_FakeRouter(provider),
        breaker=FakeCostCircuitBreaker(),
        ledger=FakeCostLedgerRepository(),
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        widget_interactions=widget_interactions,
        interactive_widget_tools=(_TEST_PROPOSAL_CARDS_TOOL, _TEST_CONFIRM_ACTION_TOOL),
        knowledge_graph=knowledge_graph,  # type: ignore[arg-type]
    )
    return use_case, messages


async def _run_turn(use_case: RunChatTurn) -> list[ChatRunEvent]:
    return [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id)
    ]


def _confirm_action_tool_json(*, edge_id: str = _EDGE_ID, kind: str = "knowledge_edge_tier_promotion") -> str:
    return f'{{"suggestionRef": {{"kind": "{kind}", "id": "{edge_id}"}}, "rationale": "Two docs agree."}}'


# ---------------------------------------------------------------------------
# Valid live edge -> confirm_action interactive_widget part + pending row
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_valid_live_edge_finalizes_confirm_action_widget_and_creates_pending_row() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    knowledge_graph = FakeKnowledgeGraphRepository(edge=dict(_VALID_EDGE))
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assert knowledge_graph.find_edge_by_id_calls == [_EDGE_ID]

    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    parts = assistant_messages[0].parts
    interactive_widget_parts = [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert len(interactive_widget_parts) == 1
    assert not text_parts

    widget_part = interactive_widget_parts[0]
    assert widget_part["widgetKind"] == "confirm_action"
    declaration = widget_part["declaration"]
    assert declaration["options"] == [
        {"id": "confirm", "title": "Confirm", "description": "Confidence 0.75, currently INFERRED. Two docs agree."},
        {"id": "reject", "title": "Reject"},
    ]
    assert declaration["suggestionRef"] == {"kind": "knowledge_edge_tier_promotion", "id": _EDGE_ID}
    assert declaration["tierSnapshot"] == "INFERRED"

    assert len(widget_interactions.create_pending_calls) == 1
    call = widget_interactions.create_pending_calls[0]
    assert call["widget_kind"] == "confirm_action"
    assert call["declared_response_schema"] == {
        "type": "object",
        "required": ["optionId"],
        "additionalProperties": False,
        "properties": {"optionId": {"enum": ["confirm", "reject"]}},
    }
    assert call["interaction_id"] == widget_part["interactionId"]


# ---------------------------------------------------------------------------
# Edge-unavailable cases (T-40-02): all collapse into the SAME visible text
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_edge_not_found_finalizes_unavailable_text_and_never_creates_pending_row() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    knowledge_graph = FakeKnowledgeGraphRepository(edge=None)
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert len(text_parts) == 1
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
    assert widget_interactions.create_pending_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_edge_cross_importer_finalizes_unavailable_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    foreign_edge = {**_VALID_EDGE, "importer_id": _OTHER_IMPORTER_ID}
    knowledge_graph = FakeKnowledgeGraphRepository(edge=foreign_edge)
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
    assert widget_interactions.create_pending_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_edge_inactive_finalizes_unavailable_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    inactive_edge = {**_VALID_EDGE, "is_active": False}
    knowledge_graph = FakeKnowledgeGraphRepository(edge=inactive_edge)
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
    assert widget_interactions.create_pending_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_edge_wrong_tier_finalizes_unavailable_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    extracted_edge = {**_VALID_EDGE, "tier": "EXTRACTED"}
    knowledge_graph = FakeKnowledgeGraphRepository(edge=extracted_edge)
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
    assert widget_interactions.create_pending_calls == []


# ---------------------------------------------------------------------------
# Malformed call (T-40-04): never reaches the knowledge_graph lookup
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_malformed_call_missing_suggestion_ref_finalizes_parse_failure_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json='{"rationale": "no ref"}'),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    knowledge_graph = FakeKnowledgeGraphRepository(edge=dict(_VALID_EDGE))
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assert knowledge_graph.find_edge_by_id_calls == []
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == PARSE_FAILURE_TEXT
    assert widget_interactions.create_pending_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_malformed_call_wrong_kind_finalizes_parse_failure_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_confirm_action_tool_json(kind="entity_merge_confirm"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    knowledge_graph = FakeKnowledgeGraphRepository(edge=dict(_VALID_EDGE))
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assert knowledge_graph.find_edge_by_id_calls == []
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == PARSE_FAILURE_TEXT
    assert widget_interactions.create_pending_calls == []


# ---------------------------------------------------------------------------
# Regression: emit_proposal_cards still works unaffected by this plan
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emit_proposal_cards_regression_unaffected_by_confirm_action_wiring() -> None:
    tool_json = '{"prompt": "Pick one", "options": [{"title": "Alpha", "value": {"id": "a"}}]}'
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_proposal_cards", id="tool-1", partial_json=tool_json),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    knowledge_graph = FakeKnowledgeGraphRepository(edge=dict(_VALID_EDGE))
    use_case, messages = _make_use_case(
        provider=provider, widget_interactions=widget_interactions, knowledge_graph=knowledge_graph
    )

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    # _finalize_confirm_action must no-op for a non-confirm_action pending tool.
    assert knowledge_graph.find_edge_by_id_calls == []

    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    interactive_widget_parts = [p for p in parts if p.get("type") == "interactive_widget"]
    assert len(interactive_widget_parts) == 1
    assert interactive_widget_parts[0]["widgetKind"] == "proposal_cards"

    assert len(widget_interactions.create_pending_calls) == 1
    assert widget_interactions.create_pending_calls[0]["widget_kind"] == "proposal_cards"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_genui_capable_model_offers_all_three_widget_tools() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _messages = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id):
        pass

    assert provider.stream_calls[0]["tools"] == (
        _TEST_EMIT_UI_SPEC_TOOL,
        _TEST_PROPOSAL_CARDS_TOOL,
        _TEST_CONFIRM_ACTION_TOOL,
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_knowledge_graph_repository_falls_back_to_unavailable_text() -> None:
    """No KnowledgeGraphRepository injected (default None, additive/back-compat):

    emit_confirm_action always finalizes into the unavailable-text fallback —
    never a crash, never a silently-dropped part.
    """
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_confirm_action", id="tool-1", partial_json=_confirm_action_tool_json()),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, knowledge_graph=None)

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
