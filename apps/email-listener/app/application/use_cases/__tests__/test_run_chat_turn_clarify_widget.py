"""Tests for RunChatTurn's emit_clarify_widget finalization (Phase 24-04 Task 1, D-02/D-09).

TDD RED->GREEN: a genui-capable model streams an emit_clarify_widget tool call;
_finalize_pending_tool must produce exactly one `interactive_widget` part
(widgetKind "clarify_widget"), a single pending chat_widget_interactions row
must be created via the injected ChatWidgetInteractionRepository with a
declared_response_schema DERIVED from the fields (required/select-enum/
checkbox-boolean/additionalProperties:false), a missing/empty submitLabel or
empty fields array DROPS the widget entirely (fail-closed, mirrors
emit_ui_spec's existing parse-failure drop), and run() calls
supersede_pending(conversation_id) exactly once right after inserting the new
user text message — while regenerate() never calls it (D-12's staleness covers
that path instead).

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
from app.domain.ports.chat_provider import StreamEnd, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"

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
_TEST_CLARIFY_WIDGET_TOOL: dict[str, Any] = {
    "name": "emit_clarify_widget",
    "description": "test",
    "input_schema": {},
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
        return ChatRun(
            id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running"
        )

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
    """In-memory ChatWidgetInteractionRepository test double — records create_pending/supersede_pending calls."""

    def __init__(self) -> None:
        self.create_pending_calls: list[dict[str, Any]] = []
        self.supersede_pending_calls: list[str] = []

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

    async def supersede_pending(self, conversation_id: str) -> int:
        self.supersede_pending_calls.append(conversation_id)
        return 0


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
) -> tuple[RunChatTurn, FakeChatMessageRepository]:
    messages = FakeChatMessageRepository()
    use_case = RunChatTurn(
        messages=messages,
        runs=FakeChatRunRepository(),
        conversations=FakeChatConversationRepository(),  # type: ignore[arg-type]
        router=_FakeRouter(provider),  # type: ignore[arg-type]
        breaker=FakeCostCircuitBreaker(),  # type: ignore[arg-type]
        ledger=FakeCostLedgerRepository(),  # type: ignore[arg-type]
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        widget_interactions=widget_interactions,
        interactive_widget_tools=(_TEST_CLARIFY_WIDGET_TOOL,),
    )
    return use_case, messages


_THREE_FIELD_JSON = (
    '{"title": "Tell us more", "submitLabel": "Send response", "fields": ['
    '{"name": "reason", "label": "Reason", "required": true}, '
    '{"name": "priority", "label": "Priority", "fieldType": "select", '
    '"options": [{"value": "low", "label": "Low"}, {"value": "high", "label": "High"}]}, '
    '{"name": "subscribe", "label": "Subscribe?", "fieldType": "checkbox"}'
    "]}"
)


# ---------------------------------------------------------------------------
# emit_clarify_widget -> interactive_widget part + pending row (D-01/D-09)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_emit_clarify_widget_finalizes_interactive_widget_part_and_creates_pending_row() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_clarify_widget", id="tool-1", partial_json=_THREE_FIELD_JSON),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    use_case, messages = _make_use_case(provider=provider, widget_interactions=widget_interactions)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id)
    ]

    assert events[-1].type == "completed"

    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    parts = assistant_messages[0].parts
    interactive_widget_parts = [p for p in parts if p.get("type") == "interactive_widget"]
    assert len(interactive_widget_parts) == 1

    widget_part = interactive_widget_parts[0]
    assert widget_part["widgetKind"] == "clarify_widget"
    assert widget_part["declaration"]["submitLabel"] == "Send response"
    assert len(widget_part["declaration"]["fields"]) == 3

    assert len(widget_interactions.create_pending_calls) == 1
    call = widget_interactions.create_pending_calls[0]
    assert call["widget_kind"] == "clarify_widget"
    schema = call["declared_response_schema"]
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["reason"]
    assert schema["properties"]["reason"] == {"type": "string"}
    assert schema["properties"]["priority"] == {"enum": ["low", "high"]}
    assert schema["properties"]["subscribe"] == {"type": "boolean"}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_submit_label_drops_the_widget() -> None:
    """A missing/empty submitLabel is a schema violation the model must never be able to emit
    around (UI-SPEC mandatory enforcement) — the run-loop drops the whole widget rather than
    persisting a non-conforming part (fail-closed, mirrors emit_ui_spec's parse-failure drop)."""
    tool_json = '{"fields": [{"name": "reason", "label": "Reason"}]}'
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_clarify_widget", id="tool-1", partial_json=tool_json),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    widget_interactions = FakeChatWidgetInteractionRepository()
    use_case, messages = _make_use_case(provider=provider, widget_interactions=widget_interactions)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert not any(p.get("type") == "interactive_widget" for p in assistant_messages[0].parts)
    assert widget_interactions.create_pending_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_empty_fields_array_drops_the_widget() -> None:
    tool_json = '{"submitLabel": "Send response", "fields": []}'
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_clarify_widget", id="tool-1", partial_json=tool_json),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, widget_interactions=FakeChatWidgetInteractionRepository())

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert not any(p.get("type") == "interactive_widget" for p in assistant_messages[0].parts)


# ---------------------------------------------------------------------------
# Typing supersedes durably (D-02): run() calls supersede_pending; regenerate() does not
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_run_calls_supersede_pending_exactly_once_after_inserting_user_message() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    widget_interactions = FakeChatWidgetInteractionRepository()
    use_case, messages = _make_use_case(provider=provider, widget_interactions=widget_interactions)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id):
        pass

    assert widget_interactions.supersede_pending_calls == [_CONVERSATION_ID]
    # The user message must exist BEFORE supersede_pending was invoked — this
    # test only proves the call happened once per run(), ordering relative to
    # persistence is exercised structurally (supersede_pending is called
    # synchronously right after the insert_message await in run()).
    user_messages = [m for m in messages.messages if m.role == "user"]
    assert len(user_messages) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_regenerate_does_not_call_supersede_pending() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    widget_interactions = FakeChatWidgetInteractionRepository()
    use_case, messages = _make_use_case(provider=provider, widget_interactions=widget_interactions)

    # Seed an existing assistant turn to regenerate.
    seeded = await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="user",
        parts=({"type": "text", "text": "Hi"},),
        turn_index=0,
        status="completed",
    )
    assistant = await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": "Hello"},),
        turn_index=0,
        status="completed",
        sibling_group_id="sib-1",
        version=1,
    )
    widget_interactions.supersede_pending_calls.clear()

    async for _ in use_case.regenerate(
        conversation_id=_CONVERSATION_ID, assistant_message_id=assistant.id, model_id=_GENUI_MODEL.id
    ):
        pass

    assert widget_interactions.supersede_pending_calls == []
    assert seeded.id  # keep the seeded user row referenced (lint)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_missing_widget_repository_does_not_crash_supersede() -> None:
    """No ChatWidgetInteractionRepository injected (default None, additive/back-compat) — run()
    must not attempt to call supersede_pending on it."""
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _messages = _make_use_case(provider=provider, widget_interactions=None)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id)
    ]

    assert events[-1].type == "completed"
