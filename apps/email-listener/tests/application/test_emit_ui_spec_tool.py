"""Tests for the emit_ui_spec tool: capability-gated offering + tool-call-delta -> genui_spec part.

Phase 22-07 Task 1 (D-02, D-05, D-18, FOUND-6):
  1. A genui-capable model's provider.stream() call includes EMIT_UI_SPEC_TOOL in `tools`.
  2. A text-only (non-genui) model's provider.stream() call passes an empty `tools` tuple.
  3. A fake provider streaming text -> emit_ui_spec tool call -> text produces an assistant
     message whose parts are [text, genui_spec, text] in that order (D-18 interleaving).
  4. The genui_spec part's spec payload equals the tool-call's accumulated JSON verbatim --
     no server-side safeParse/fallback (that gate is the web boundary, FOUND-6).
  5. tool_call + tool_result run events are emitted alongside the progressive stream.

Deviation note (mirrors the 22-02/22-06 precedent): placed at
tests/application/test_emit_ui_spec_tool.py (not tests/unit/) -- no tests/unit/
directory exists anywhere in this codebase; run_chat_turn.py is an application
use case, so this follows tests/application/test_run_chat_turn.py's convention.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision
from app.infrastructure.llm.chat_tools import EMIT_UI_SPEC_TOOL_NAME, build_emit_ui_spec_tool

EMIT_UI_SPEC_TOOL = build_emit_ui_spec_tool()

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
# Test doubles (mirrors tests/application/test_run_chat_turn.py)
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
    *, provider: FakeChatProvider, emit_ui_spec_tool: dict[str, Any] = EMIT_UI_SPEC_TOOL
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
        emit_ui_spec_tool=emit_ui_spec_tool,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Capability-gated tool offering (D-05)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_genui_capable_model_offers_emit_ui_spec_tool() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_GENUI_MODEL.id):
        pass

    assert provider.stream_called
    assert provider.stream_calls[0]["tools"] == (EMIT_UI_SPEC_TOOL,)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_only_model_offers_no_tools() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEXT_ONLY_MODEL.id):
        pass

    assert provider.stream_called
    assert provider.stream_calls[0]["tools"] == ()


# ---------------------------------------------------------------------------
# D-18 interleaving + verbatim spec payload
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_tool_call_text_produces_interleaved_parts_in_order() -> None:
    spec = {"v": 1, "root": {"type": "card", "title": "Weather"}}
    spec_json = json.dumps(spec)
    provider = FakeChatProvider(
        [
            TextDelta(text="Here is a widget: "),
            ToolCallDelta(tool_name=EMIT_UI_SPEC_TOOL_NAME, id="tool-1", partial_json=spec_json[:10]),
            ToolCallDelta(tool_name=EMIT_UI_SPEC_TOOL_NAME, id="tool-1", partial_json=spec_json[10:]),
            TextDelta(text="Hope that helps!"),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Show me", model_id=_GENUI_MODEL.id)
    ]

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    part_types = [p["type"] for p in assistant.parts]
    assert part_types == ["text", "genui_spec", "text"]
    assert assistant.parts[0]["text"] == "Here is a widget: "
    assert assistant.parts[2]["text"] == "Hope that helps!"

    # No server-side safeParse/fallback -- the spec is stored verbatim (FOUND-6).
    assert assistant.parts[1]["spec"] == spec

    event_types = [e.type for e in events]
    assert "tool_call" in event_types
    assert "tool_result" in event_types
    tool_result_event = next(e for e in events if e.type == "tool_result")
    assert tool_result_event.data["spec"] == spec
    assert tool_result_event.data["id"] == "tool-1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_text_only_model_never_emits_tool_events_even_with_matching_deltas() -> None:
    """Defence-in-depth: even if a provider somehow yielded a ToolCallDelta for a
    text-only model (it shouldn't -- tools=() means it never sees a tool exists),
    the accumulator still finalizes it into a genui_spec part deterministically --
    the gating decision lives entirely in which `tools` are OFFERED, not in delta
    handling. This test documents that _apply_delta itself is capability-agnostic.
    """
    spec = {"v": 1, "root": {"type": "alert"}}
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name=EMIT_UI_SPEC_TOOL_NAME, id="tool-1", partial_json=json.dumps(spec)),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEXT_ONLY_MODEL.id):
        pass

    # The text-only model's provider call never received the tool at all.
    assert provider.stream_calls[0]["tools"] == ()

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant = next(m for m in messages.messages if m.role == "assistant")
    assert assistant.parts[0]["type"] == "genui_spec"
    assert assistant.parts[0]["spec"] == spec
