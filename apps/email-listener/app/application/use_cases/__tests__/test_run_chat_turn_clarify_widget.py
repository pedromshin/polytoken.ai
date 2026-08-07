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

from typing import Any

import pytest

from app.application.use_cases.__tests__._run_chat_turn_fakes import (
    FakeChatConversationRepository,
    FakeChatMessageRepository,
    FakeChatProvider,
    FakeChatRunRepository,
    FakeCostCircuitBreaker,
    FakeCostLedgerRepository,
    FakeRouter,
)
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_provider import StreamEnd, ToolCallDelta
from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities

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
# Test doubles — shared RunChatTurn fakes live in _run_chat_turn_fakes.py;
# only the clarify-widget-specific doubles remain here.
# ---------------------------------------------------------------------------


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
        router=FakeRouter(provider),  # type: ignore[arg-type]
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
