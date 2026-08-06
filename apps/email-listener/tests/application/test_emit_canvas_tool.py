"""Tests for the canvas emit tools (Phase 73 Wave A): tool-call-delta -> canvas parts.

Mirrors tests/application/test_emit_ui_spec_tool.py's structure:
  1. A fake provider streaming text -> emit_canvas_node -> emit_canvas_connect -> text
     produces an assistant message whose parts are
     [text, canvas_add_node, canvas_connect, text] in that order (D-18 interleaving).
  2. Each canvas part matches the FROZEN wire contract EXACTLY (type strings + field
     names) — the web half is written against these shapes verbatim.
  3. tool_call + tool_result run events fire for each canvas call.
  4. A bad-JSON canvas tool call fails CLOSED into a visible PARSE_FAILURE_TEXT part.
  5. The tools are offered to a genui-capable model only when emit_canvas_tools is wired.

Placed at tests/application/ (not tests/unit/) per this codebase's convention
(mirrors test_emit_ui_spec_tool.py — run_chat_turn.py is an application use case).
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_tool_loop import PARSE_FAILURE_TEXT
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision
from app.infrastructure.llm.chat_tools import (
    EMIT_CANVAS_CONNECT_TOOL_NAME,
    EMIT_CANVAS_NODE_TOOL_NAME,
    EMIT_CANVAS_RECIPE_TOOL_NAME,
    EMIT_CODE_ISLAND_TOOL_NAME,
    build_emit_canvas_connect_tool,
    build_emit_canvas_node_tool,
    build_emit_canvas_recipe_tool,
    build_emit_code_island_tool,
)

EMIT_CANVAS_NODE_TOOL = build_emit_canvas_node_tool()
EMIT_CANVAS_CONNECT_TOOL = build_emit_canvas_connect_tool()
EMIT_CODE_ISLAND_TOOL = build_emit_code_island_tool()
EMIT_CANVAS_RECIPE_TOOL = build_emit_canvas_recipe_tool()
_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}

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

_TEXT_ONLY_MODEL = ChatModel(
    id="test-text-only-model",
    display_name="Test Text-Only Model",
    transport="openrouter",
    execution_locus="server",
    price_in_per_mtok=0.5,
    price_out_per_mtok=1.0,
    capabilities=ChatModelCapabilities(tools=True, genui=False, streaming=True, context_tokens=64_000),
    best_for="testing",
)

_TEST_MODELS = {model.id: model for model in (_GENUI_MODEL, _TEXT_ONLY_MODEL)}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only models."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


# ---------------------------------------------------------------------------
# Test doubles (mirrors tests/application/test_emit_ui_spec_tool.py)
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
        self.events: list[ChatRunEvent] = []
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
        event = ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]
        self.events.append(event)
        return event

    async def finish_run(self, *, run_id: str, status: str) -> None:
        self.runs[run_id]["status"] = status


class FakeChatConversationRepository:
    """In-memory ChatConversationRepository test double."""

    def __init__(self) -> None:
        self.touches: list[dict[str, Any]] = []

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        self.touches.append({"conversation_id": conversation_id, "model_id": model_id, "title": title})


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas."""

    def __init__(self, deltas: list[Any]) -> None:
        self._deltas = deltas
        self.stream_called = False
        self.stream_calls: list[dict[str, Any]] = []

    async def stream(self, **kwargs: Any) -> Any:
        self.stream_called = True
        self.stream_calls.append(kwargs)
        for delta in self._deltas:
            yield delta


class FakeCostCircuitBreaker:
    """A CostCircuitBreaker test double that always allows and never mid-stream aborts."""

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        return PreTurnDecision.allow()

    def should_abort(self, running_cost: Decimal) -> bool:
        return False

    def should_abort_round(self, round_cost: Decimal) -> bool:
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
    emit_canvas_tools: tuple[dict[str, Any], ...] = (
        EMIT_CANVAS_NODE_TOOL,
        EMIT_CANVAS_CONNECT_TOOL,
        EMIT_CODE_ISLAND_TOOL,
        EMIT_CANVAS_RECIPE_TOOL,
    ),
) -> tuple[RunChatTurn, dict[str, Any]]:
    collaborators: dict[str, Any] = {
        "messages": FakeChatMessageRepository(),
        "runs": FakeChatRunRepository(),
        "conversations": FakeChatConversationRepository(),
        "router": _FakeRouter(provider),
        "breaker": FakeCostCircuitBreaker(),
        "ledger": FakeCostLedgerRepository(),
    }
    use_case = RunChatTurn(
        messages=collaborators["messages"],
        runs=collaborators["runs"],
        conversations=collaborators["conversations"],
        router=collaborators["router"],
        breaker=collaborators["breaker"],
        ledger=collaborators["ledger"],
        emit_ui_spec_tool=_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        emit_canvas_tools=emit_canvas_tools,
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Tool offering gated on genui + wiring
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_genui_model_offers_both_canvas_tools_when_wired() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id):
        pass

    offered = provider.stream_calls[0]["tools"]
    offered_names = [t["name"] for t in offered]
    assert EMIT_CANVAS_NODE_TOOL_NAME in offered_names
    assert EMIT_CANVAS_CONNECT_TOOL_NAME in offered_names
    assert EMIT_CODE_ISLAND_TOOL_NAME in offered_names
    assert EMIT_CANVAS_RECIPE_TOOL_NAME in offered_names


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_only_model_never_offers_canvas_tools() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEXT_ONLY_MODEL.id):
        pass

    assert provider.stream_calls[0]["tools"] == ()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unwired_canvas_tools_are_not_offered() -> None:
    """Default (unwired) emit_canvas_tools is a no-op — the tools are absent (fail-closed)."""
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider, emit_canvas_tools=())

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id):
        pass

    offered_names = [t["name"] for t in provider.stream_calls[0]["tools"]]
    assert EMIT_CANVAS_NODE_TOOL_NAME not in offered_names
    assert EMIT_CANVAS_CONNECT_TOOL_NAME not in offered_names
    assert EMIT_CODE_ISLAND_TOOL_NAME not in offered_names
    assert EMIT_CANVAS_RECIPE_TOOL_NAME not in offered_names


# ---------------------------------------------------------------------------
# D-18 interleaving + frozen canvas part shapes
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_canvas_node_then_connect_produce_frozen_parts_in_order() -> None:
    node_json = json.dumps(
        {"handle": "sheet", "nodeType": "spreadsheet", "data": {"rows": 2}, "position": {"x": 5, "y": 6}}
    )
    connect_json = json.dumps(
        {"sourceHandle": "sheet", "targetHandle": "tile", "sourcePath": "data", "targetKey": "input"}
    )
    provider = FakeChatProvider(
        [
            TextDelta(text="Drawing: "),
            ToolCallDelta(tool_name=EMIT_CANVAS_NODE_TOOL_NAME, id="tool-1", partial_json=node_json[:12]),
            ToolCallDelta(tool_name=EMIT_CANVAS_NODE_TOOL_NAME, id="tool-1", partial_json=node_json[12:]),
            ToolCallDelta(tool_name=EMIT_CANVAS_CONNECT_TOOL_NAME, id="tool-2", partial_json=connect_json),
            TextDelta(text="Done."),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="draw", model_id=_GENUI_MODEL.id)
    ]

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    part_types = [p["type"] for p in assistant.parts]
    assert part_types == ["text", "canvas_add_node", "canvas_connect", "text"]

    # Frozen canvas_add_node shape (verbatim, incl. optional position present here).
    assert assistant.parts[1] == {
        "type": "canvas_add_node",
        "handle": "sheet",
        "nodeType": "spreadsheet",
        "data": {"rows": 2},
        "position": {"x": 5, "y": 6},
    }
    # Frozen canvas_connect shape (verbatim, all four required strings).
    assert assistant.parts[2] == {
        "type": "canvas_connect",
        "sourceHandle": "sheet",
        "targetHandle": "tile",
        "sourcePath": "data",
        "targetKey": "input",
    }

    event_types = [e.type for e in events]
    assert event_types.count("tool_call") >= 2
    assert event_types.count("tool_result") == 2
    tool_result_events = [e for e in events if e.type == "tool_result"]
    assert {e.data["id"] for e in tool_result_events} == {"tool-1", "tool-2"}
    assert tool_result_events[0].data["part"]["type"] == "canvas_add_node"
    assert tool_result_events[1].data["part"]["type"] == "canvas_connect"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_canvas_node_omits_position_key_when_absent() -> None:
    node_json = json.dumps({"handle": "tile", "nodeType": "document", "data": {"title": "Notes"}})
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CANVAS_NODE_TOOL_NAME, id="tool-1", partial_json=node_json),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="draw", model_id=_GENUI_MODEL.id):
        pass

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    node_part = next(p for p in assistant.parts if p["type"] == "canvas_add_node")
    assert "position" not in node_part
    assert node_part == {
        "type": "canvas_add_node",
        "handle": "tile",
        "nodeType": "document",
        "data": {"title": "Notes"},
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_code_island_call_produces_frozen_part() -> None:
    """Phase 76-05 (BTAP-07): emit_code_island finalizes into a `canvas_code_island` part."""
    island_json = json.dumps(
        {
            "intent": "reconcile these invoices against the bank rows",
            "selectedNodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
            "inputBindings": {
                "invoices": {"sourceNodeKey": "spreadsheet:inv", "sourcePath": "published.inv"},
                "bank": {"sourceNodeKey": "spreadsheet:bank", "sourcePath": "published.bank"},
            },
            "inputs": {
                "invoices": {"kind": "spreadsheet", "columns": ["id", "vendor", "amount"], "rowCount": 3},
                "bank": {"kind": "spreadsheet", "columns": ["date", "amount"], "rowCount": 12},
            },
        }
    )
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CODE_ISLAND_TOOL_NAME, id="tool-1", partial_json=island_json[:20]),
            ToolCallDelta(tool_name=EMIT_CODE_ISLAND_TOOL_NAME, id="tool-1", partial_json=island_json[20:]),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="build me a reconciler", model_id=_GENUI_MODEL.id
        )
    ]

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    island_part = next(p for p in assistant.parts if p["type"] == "canvas_code_island")
    assert island_part == {
        "type": "canvas_code_island",
        "intent": "reconcile these invoices against the bank rows",
        "inputs": {
            "invoices": {"kind": "spreadsheet", "columns": ["id", "vendor", "amount"], "rowCount": 3},
            "bank": {"kind": "spreadsheet", "columns": ["date", "amount"], "rowCount": 12},
        },
        "inputBindings": {
            "invoices": {"sourceNodeKey": "spreadsheet:inv", "sourcePath": "published.inv"},
            "bank": {"sourceNodeKey": "spreadsheet:bank", "sourcePath": "published.bank"},
        },
        "selectedNodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
    }

    tool_result_events = [e for e in events if e.type == "tool_result"]
    assert tool_result_events[-1].data["part"]["type"] == "canvas_code_island"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_bad_json_code_island_call_fails_closed_to_parse_failure_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CODE_ISLAND_TOOL_NAME, id="tool-1", partial_json='{"intent": "x", "sel'),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="build", model_id=_GENUI_MODEL.id):
        pass

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    part_types = [p["type"] for p in assistant.parts]
    assert "canvas_code_island" not in part_types
    text_part = next(p for p in assistant.parts if p["type"] == "text")
    assert text_part["text"] == PARSE_FAILURE_TEXT


@pytest.mark.unit
@pytest.mark.asyncio
async def test_canvas_recipe_call_produces_frozen_part() -> None:
    """Phase 73C-R3: emit_canvas_recipe finalizes into a `canvas_recipe` part."""
    recipe_json = json.dumps(
        {
            "name": "Invoice reconciliation",
            "nodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
            "edgeKeys": ["e1"],
            "sourceRef": {"kind": "gmail_query", "query": "from:billing"},
        }
    )
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CANVAS_RECIPE_TOOL_NAME, id="tool-1", partial_json=recipe_json[:16]),
            ToolCallDelta(tool_name=EMIT_CANVAS_RECIPE_TOOL_NAME, id="tool-1", partial_json=recipe_json[16:]),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="name this group", model_id=_GENUI_MODEL.id
        )
    ]

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    recipe_part = next(p for p in assistant.parts if p["type"] == "canvas_recipe")
    assert recipe_part == {
        "type": "canvas_recipe",
        "name": "Invoice reconciliation",
        "nodeKeys": ["spreadsheet:inv", "spreadsheet:bank"],
        "edgeKeys": ["e1"],
        "sourceRef": {"kind": "gmail_query", "query": "from:billing"},
    }

    tool_result_events = [e for e in events if e.type == "tool_result"]
    assert tool_result_events[-1].data["part"]["type"] == "canvas_recipe"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_bad_json_canvas_recipe_call_fails_closed_to_parse_failure_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CANVAS_RECIPE_TOOL_NAME, id="tool-1", partial_json='{"name": "x", "node'),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="name it", model_id=_GENUI_MODEL.id):
        pass

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    part_types = [p["type"] for p in assistant.parts]
    assert "canvas_recipe" not in part_types
    text_part = next(p for p in assistant.parts if p["type"] == "text")
    assert text_part["text"] == PARSE_FAILURE_TEXT


# ---------------------------------------------------------------------------
# Fail-closed on malformed JSON
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_bad_json_canvas_call_fails_closed_to_parse_failure_text() -> None:
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_CANVAS_NODE_TOOL_NAME, id="tool-1", partial_json='{"handle": "x", "node'),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="draw", model_id=_GENUI_MODEL.id):
        pass

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    part_types = [p["type"] for p in assistant.parts]
    assert "canvas_add_node" not in part_types
    text_part = next(p for p in assistant.parts if p["type"] == "text")
    assert text_part["text"] == PARSE_FAILURE_TEXT
