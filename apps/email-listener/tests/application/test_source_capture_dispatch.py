"""Tests for SourceCaptureHandler + RunChatTurn's source_capture finalize branch (Phase 54-03, CLUS-04).

Two sections:

1. SourceCaptureHandler (confirm_action_dispatch.py) in isolation, mirroring
   test_confirm_action_dispatch.py's AsyncMock-free hand-rolled-fake style —
   confirm upserts an INFERRED node + edge with full provenance (reusing an
   existing node for a duplicate url, never a second node); reject writes
   nothing; a repo failure never raises past execute().

2. RunChatTurn._finalize_confirm_action's source_capture branch, mirroring
   test_run_chat_turn_confirm_action.py's FakeChatMessageRepository/
   FakeChatProvider doubles — a pending emit_confirm_action(kind=
   source_capture) call is re-read server-side from a PERSISTED
   web_search tool_invocation_result part by its {toolUseId}:{index} id
   (T-54-03-01); a missing/foreign/out-of-range id collapses to
   CONFIRM_ACTION_UNAVAILABLE_TEXT.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_confirm_action import CONFIRM_ACTION_UNAVAILABLE_TEXT
from app.domain.ports.chat_provider import StreamEnd, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

_IMPORTER_ID = "importer-1"
_OTHER_IMPORTER_ID = "importer-2"
_CONVERSATION_ID = "conv-1"
_URL = "https://example.com/article"

# ---------------------------------------------------------------------------
# Section 1: SourceCaptureHandler in isolation
# ---------------------------------------------------------------------------


class FakeKnowledgeGraphRepository:
    """Records find_active_node/upsert_node/insert_edge calls; can be told to raise."""

    def __init__(self, *, raise_on: str | None = None) -> None:
        self._raise_on = raise_on
        self._nodes: dict[tuple[str, str, str], dict[str, object]] = {}
        self._next_id = 0
        self.find_active_node_calls: list[tuple[str, str, str | None]] = []
        self.upsert_node_calls: list[dict[str, object]] = []
        self.insert_edge_calls: list[dict[str, object]] = []

    async def find_active_node(
        self, importer_id: str, scope: str, scope_ref_id: str | None
    ) -> dict[str, object] | None:
        self.find_active_node_calls.append((importer_id, scope, scope_ref_id))
        if self._raise_on == "find_active_node":
            raise RuntimeError("simulated DB hiccup")
        return self._nodes.get((importer_id, scope, scope_ref_id or ""))

    async def upsert_node(self, **kwargs: Any) -> str:
        self.upsert_node_calls.append(kwargs)
        if self._raise_on == "upsert_node":
            raise RuntimeError("simulated DB hiccup")
        self._next_id += 1
        node_id = f"node-{self._next_id}"
        self._nodes[(kwargs["importer_id"], kwargs["scope"], kwargs["scope_ref_id"] or "")] = {"id": node_id}
        return node_id

    async def insert_edge(self, **kwargs: Any) -> None:
        self.insert_edge_calls.append(kwargs)
        if self._raise_on == "insert_edge":
            raise RuntimeError("simulated DB hiccup")


def _source_payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {"url": _URL, "title": "An Article", "retrievedAt": "2026-07-12T00:00:00+00:00"}
    base.update(overrides)
    return base


def test_confirm_with_valid_payload_upserts_inferred_node_and_edge_with_provenance() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id="thread-1",
        )
    )

    assert result["status"] == "captured"
    node_id = result["node_id"]

    assert len(knowledge.upsert_node_calls) == 1
    upsert_call = knowledge.upsert_node_calls[0]
    assert upsert_call["importer_id"] == _IMPORTER_ID
    assert upsert_call["tier"] == "INFERRED"
    assert upsert_call["source"] == "web_search_capture"
    assert upsert_call["scope"] == "importer_global"
    assert upsert_call["scope_ref_type"] == "web_source"
    # scope_ref_id is a uuid COLUMN (migration 0006) — a raw url string 22P02s
    # against real Postgres (found live 2026-07-12). The deterministic
    # uuid5(NAMESPACE_URL, url) keys the same url to the same node.
    assert upsert_call["scope_ref_id"] == str(uuid.uuid5(uuid.NAMESPACE_URL, _URL))
    assert upsert_call["content"] == _URL, "the real url string lives in content"
    assert upsert_call["title"] == "An Article"

    assert len(knowledge.insert_edge_calls) == 1
    edge_call = knowledge.insert_edge_calls[0]
    assert edge_call["source_node_id"] == node_id
    assert edge_call["tier"] == "INFERRED"
    assert edge_call["source"] == "web_search_capture"
    assert edge_call["provenance"] == {
        "url": _URL,
        "title": "An Article",
        "retrieved_at": "2026-07-12T00:00:00+00:00",
        "conversation_id": _CONVERSATION_ID,
        "thread_id": "thread-1",
    }


def test_duplicate_confirm_of_same_url_reuses_existing_node_never_creates_second() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)
    kwargs = {
        "action": "confirm",
        "importer_id": _IMPORTER_ID,
        "widget_interaction_id": "wi-1",
        "source_payload": _source_payload(),
        "conversation_id": _CONVERSATION_ID,
        "thread_id": None,
    }

    first = asyncio.run(handler.execute(suggestion_id="toolu_1:0", **kwargs))
    second = asyncio.run(handler.execute(suggestion_id="toolu_2:0", **kwargs))

    assert first["status"] == "captured"
    assert second["status"] == "captured"
    assert first["node_id"] == second["node_id"]
    assert len(knowledge.upsert_node_calls) == 1, "never a second node for the same url"
    assert len(knowledge.insert_edge_calls) == 2, "each confirm still records its own edge"


def test_reject_writes_nothing_and_returns_rejected() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="reject",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id="thread-1",
        )
    )

    assert result == {"status": "rejected"}
    assert knowledge.find_active_node_calls == []
    assert knowledge.upsert_node_calls == []
    assert knowledge.insert_edge_calls == []


def test_missing_source_payload_returns_capture_failed_without_raising() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=None,
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )

    assert result == {"status": "capture_failed"}
    assert knowledge.upsert_node_calls == []


def test_source_payload_missing_url_returns_capture_failed_without_raising() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=_source_payload(url=""),
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )

    assert result == {"status": "capture_failed"}
    assert knowledge.upsert_node_calls == []


def test_missing_importer_id_returns_capture_failed_without_raising() -> None:
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id="",
            widget_interaction_id="wi-1",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )

    assert result == {"status": "capture_failed"}
    assert knowledge.upsert_node_calls == []


@pytest.mark.parametrize("raise_on", ["find_active_node", "upsert_node", "insert_edge"])
def test_repo_error_at_any_step_returns_capture_failed_without_raising(raise_on: str) -> None:
    knowledge = FakeKnowledgeGraphRepository(raise_on=raise_on)
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    result = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )

    assert result == {"status": "capture_failed"}


def test_cross_tenant_capture_scoped_by_the_exact_importer_id_passed() -> None:
    """A capture for tenant A must never read/reuse tenant B's node for the same url."""
    knowledge = FakeKnowledgeGraphRepository()
    handler = SourceCaptureHandler(knowledge_graph=knowledge)

    tenant_a = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_1:0",
            importer_id=_IMPORTER_ID,
            widget_interaction_id="wi-1",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )
    tenant_b = asyncio.run(
        handler.execute(
            action="confirm",
            suggestion_id="toolu_2:0",
            importer_id=_OTHER_IMPORTER_ID,
            widget_interaction_id="wi-2",
            source_payload=_source_payload(),
            conversation_id=_CONVERSATION_ID,
            thread_id=None,
        )
    )

    assert tenant_a["node_id"] != tenant_b["node_id"], "tenants must never share a captured node"
    assert len(knowledge.upsert_node_calls) == 2
    url_key = str(uuid.uuid5(uuid.NAMESPACE_URL, _URL))
    assert knowledge.find_active_node_calls == [
        (_IMPORTER_ID, "importer_global", url_key),
        (_OTHER_IMPORTER_ID, "importer_global", url_key),
    ]


# ---------------------------------------------------------------------------
# Section 2: RunChatTurn._finalize_confirm_action's source_capture branch
# ---------------------------------------------------------------------------

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
_TEST_CONFIRM_ACTION_TOOL: dict[str, Any] = {
    "name": "emit_confirm_action",
    "description": "test",
    "input_schema": {},
}

_WEB_SEARCH_ENVELOPE = json.dumps(
    {
        "mode": "web_search",
        "results": [
            {"title": "First Result", "url": "https://a.example/1", "snippet": "..."},
            {"title": "Second Result", "url": "https://a.example/2", "snippet": "..."},
        ],
    }
)


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


class FakeChatMessageRepository:
    """In-memory ChatMessageRepository test double, mirrors test_run_chat_turn_confirm_action.py."""

    def __init__(self, *, seeded: list[ChatMessage] | None = None) -> None:
        self.messages: list[ChatMessage] = list(seeded or [])
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
    def __init__(self) -> None:
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> ChatRun:
        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self._seq_by_run[run_id] = 0
        return ChatRun(
            id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running"
        )

    async def append_event(self, *, run_id: str, event_type: str, data: dict[str, Any]) -> ChatRunEvent:
        seq = self._seq_by_run.get(run_id, 0)
        self._seq_by_run[run_id] = seq + 1
        return ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]

    async def finish_run(self, *, run_id: str, status: str) -> None:
        pass


class FakeChatConversationRepository:
    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass


class FakeChatWidgetInteractionRepository:
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

    async def get(self, interaction_id: str) -> WidgetInteraction | None:  # pragma: no cover - unused
        return None

    async def try_submit(self, interaction_id: str, submitted_value: dict[str, Any]) -> bool:  # pragma: no cover
        return False

    async def is_stale(self, interaction: WidgetInteraction) -> bool:  # pragma: no cover - unused
        return False

    async def supersede_pending(self, conversation_id: str) -> int:  # pragma: no cover - regression only
        return 0


class FakeChatProvider:
    def __init__(self, deltas: list[Any]) -> None:
        self._deltas = deltas

    async def stream(self, **kwargs: Any) -> Any:
        for delta in self._deltas:
            yield delta


class FakeCostCircuitBreaker:
    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        return PreTurnDecision.allow()

    def should_abort(self, running_cost: Decimal) -> bool:
        return False

    def estimate_turn_cost(self, *, model: ChatModel, prompt_tokens_est: int, max_output_tokens: int) -> Decimal:
        return Decimal("0")


class FakeCostLedgerRepository:
    async def record(self, event: UsageEvent) -> None:
        pass


class _FakeRouter:
    def __init__(self, provider: FakeChatProvider) -> None:
        self._provider = provider

    def select(self, model_id: str) -> FakeChatProvider:
        return self._provider


def _seed_web_search_message(*, tool_use_id: str = "toolu_1", turn_index: int = 0) -> ChatMessage:
    return ChatMessage(
        id="msg-web-search",
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=(
            {
                "type": "tool_invocation_result",
                "toolUseId": tool_use_id,
                "toolName": "web_search",
                "content": _WEB_SEARCH_ENVELOPE,
                "isError": False,
            },
        ),
        turn_index=turn_index,
    )


def _make_use_case(
    *, provider: FakeChatProvider, seeded: list[ChatMessage] | None = None
) -> tuple[RunChatTurn, FakeChatMessageRepository]:
    messages = FakeChatMessageRepository(seeded=seeded)
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
        widget_interactions=FakeChatWidgetInteractionRepository(),
        interactive_widget_tools=(_TEST_CONFIRM_ACTION_TOOL,),
        knowledge_graph=None,
    )
    return use_case, messages


def _source_capture_tool_json(*, result_id: str) -> str:
    return json.dumps({"suggestionRef": {"kind": "source_capture", "id": result_id}, "rationale": "On topic."})


async def _run_turn(use_case: RunChatTurn) -> list[ChatRunEvent]:
    return [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="Capture that", model_id=_GENUI_MODEL.id
        )
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_finalizes_confirm_action_widget_when_result_found() -> None:
    seeded = [_seed_web_search_message(tool_use_id="toolu_1")]
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="toolu_1:0"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=seeded)

    events = await _run_turn(use_case)

    assert events[-1].type == "completed"
    assistant_messages = [m for m in messages.messages if m.role == "assistant" and m.id != "msg-web-search"]
    assert len(assistant_messages) == 1
    parts = assistant_messages[0].parts
    widget_parts = [p for p in parts if p.get("type") == "interactive_widget"]
    assert len(widget_parts) == 1
    declaration = widget_parts[0]["declaration"]
    assert declaration["suggestionRef"] == {"kind": "source_capture", "id": "toolu_1:0"}
    assert declaration["sourcePayload"]["url"] == "https://a.example/1"
    assert declaration["sourcePayload"]["title"] == "First Result"
    assert declaration["sourcePayload"]["retrievedAt"]
    assert declaration["importerId"] == _IMPORTER_ID
    assert not [p for p in parts if p.get("type") == "text"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_second_result_index_resolves_the_second_entry() -> None:
    seeded = [_seed_web_search_message(tool_use_id="toolu_1")]
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="toolu_1:1"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=seeded)

    await _run_turn(use_case)

    assistant_messages = [m for m in messages.messages if m.role == "assistant" and m.id != "msg-web-search"]
    widget_part = next(p for p in assistant_messages[0].parts if p.get("type") == "interactive_widget")
    assert widget_part["declaration"]["sourcePayload"]["url"] == "https://a.example/2"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_out_of_range_index_finalizes_unavailable_text() -> None:
    seeded = [_seed_web_search_message(tool_use_id="toolu_1")]
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="toolu_1:9"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=seeded)

    await _run_turn(use_case)

    assistant_messages = [m for m in messages.messages if m.role == "assistant" and m.id != "msg-web-search"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_foreign_tool_use_id_finalizes_unavailable_text() -> None:
    """A result id referencing a toolUseId never persisted in this conversation -- no leak."""
    seeded = [_seed_web_search_message(tool_use_id="toolu_1")]
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="toolu_does_not_exist:0"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=seeded)

    await _run_turn(use_case)

    assistant_messages = [m for m in messages.messages if m.role == "assistant" and m.id != "msg-web-search"]
    parts = assistant_messages[0].parts
    assert not [p for p in parts if p.get("type") == "interactive_widget"]
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_malformed_result_id_finalizes_unavailable_text() -> None:
    """No ':' separator -- parse_source_capture_result_id fails closed."""
    seeded = [_seed_web_search_message(tool_use_id="toolu_1")]
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="not-composite"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=seeded)

    await _run_turn(use_case)

    assistant_messages = [m for m in messages.messages if m.role == "assistant" and m.id != "msg-web-search"]
    parts = assistant_messages[0].parts
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT


@pytest.mark.unit
@pytest.mark.asyncio
async def test_source_capture_no_web_search_history_finalizes_unavailable_text() -> None:
    """No web_search tool_invocation_result part exists at all in this conversation."""
    provider = FakeChatProvider(
        [
            ToolCallDelta(
                tool_name="emit_confirm_action",
                id="tool-1",
                partial_json=_source_capture_tool_json(result_id="toolu_1:0"),
            ),
            StreamEnd(stop_reason="tool_use"),
        ]
    )
    use_case, messages = _make_use_case(provider=provider, seeded=None)

    await _run_turn(use_case)

    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    parts = assistant_messages[0].parts
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert text_parts[0]["text"] == CONFIRM_ACTION_UNAVAILABLE_TEXT
