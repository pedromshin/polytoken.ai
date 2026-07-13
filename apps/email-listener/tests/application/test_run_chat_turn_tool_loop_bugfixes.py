"""Regression tests for the 2 latent LOOP-02 bugs fixed in run_chat_turn.py (Phase 34-02).

Bug 1 (UsageDelta overwrite): `_apply_delta`'s UsageDelta branch used to OVERWRITE
state.input_tokens/output_tokens instead of accumulating — harmless with one delta,
silently under-reports cost the moment a turn streams more than one UsageDelta (the
round loop landing in Plan 34-03 makes this the normal case, one delta per round).

Bug 2 (silent tool-call parse-failure drop): `_finalize_pending_tool` used to drop a
malformed/truncated tool call with only a `logger.warning`, persisting nothing visible
to the user (the 2026-07-06 truncated-tool-call salvage todo). Both terminal paths
(interactive-widget and emit_ui_spec) must now append a visible
`{"type": "text", "text": PARSE_FAILURE_TEXT}` part instead.

Fakes/`_make_use_case` scaffold copied locally from tests/application/test_run_chat_turn.py
(local copy per 34-02-PLAN.md's <action> — avoids coupling this file to that one).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_tool_loop import PARSE_FAILURE_TEXT
from app.domain.ports.chat_provider import StreamEnd, ToolCallDelta, UsageDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

# ---------------------------------------------------------------------------
# Test doubles (local copy of tests/application/test_run_chat_turn.py's scaffold)
# ---------------------------------------------------------------------------

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"

_SERVER_MODEL = ChatModel(
    id="test-server-model",
    display_name="Test Server Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=200_000),
    best_for="testing",
)

_TEST_MODELS = {_SERVER_MODEL.id: _SERVER_MODEL}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}
_TEST_PROPOSAL_CARDS_TOOL: dict[str, Any] = {"name": "emit_proposal_cards", "description": "test", "input_schema": {}}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only model."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


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
        self.messages = [
            m if m.id != message_id else ChatMessage(**{**m.__dict__, "status": status}) for m in self.messages
        ]

    async def set_sibling_inactive(self, sibling_group_id: str) -> None:
        self.messages = [
            m if m.sibling_group_id != sibling_group_id else ChatMessage(**{**m.__dict__, "is_active": False})
            for m in self.messages
        ]


class FakeChatRunRepository:
    """In-memory ChatRunRepository test double."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.events: list[ChatRunEvent] = []
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> Any:
        from app.domain.ports.chat_repositories import ChatRun

        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self.runs[run_id] = {
            "conversation_id": conversation_id,
            "agent_id": agent_id,
            "model_id": model_id,
            "status": "running",
        }
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
    """In-memory ChatConversationRepository test double — records touch() calls."""

    def __init__(self, *, owner: str | None = "user-owner-1") -> None:
        self.touches: list[dict[str, Any]] = []
        self._owner = owner

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        self.touches.append({"conversation_id": conversation_id, "model_id": model_id, "title": title})

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas."""

    def __init__(self, deltas: list[Any]) -> None:
        self._deltas = deltas
        self.stream_called = False
        self.stream_calls: list[dict[str, Any]] = []
        self.aclosed = False

    async def stream(self, **kwargs: Any) -> Any:
        self.stream_called = True
        self.stream_calls.append(kwargs)
        try:
            for delta in self._deltas:
                if isinstance(delta, BaseException):
                    raise delta
                yield delta
        finally:
            self.aclosed = True


class FakeCostCircuitBreaker:
    """A CostCircuitBreaker test double — always allows, never mid-stream aborts."""

    def __init__(self, *, decision: PreTurnDecision | None = None) -> None:
        self._decision = decision or PreTurnDecision.allow()
        self.pre_turn_calls: list[dict[str, Any]] = []

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        self.pre_turn_calls.append(kwargs)
        return self._decision

    def should_abort(self, running_cost: Decimal) -> bool:
        return False

    def should_abort_round(self, round_cost: Decimal) -> bool:
        return False

    def estimate_turn_cost(self, *, model: ChatModel, prompt_tokens_est: int, max_output_tokens: int) -> Decimal:
        price_in = Decimal(str(model.price_in_per_mtok))
        price_out = Decimal(str(model.price_out_per_mtok))
        return (Decimal(prompt_tokens_est) * price_in + Decimal(max_output_tokens) * price_out) / Decimal(1_000_000)


class FakeCostLedgerRepository:
    """In-memory CostLedgerRepository test double — records UsageEvent rows."""

    def __init__(self) -> None:
        self.recorded: list[UsageEvent] = []

    async def record(self, event: UsageEvent) -> None:
        self.recorded.append(event)

    async def sum_for_run(self, run_id: str) -> Decimal:  # pragma: no cover - unused
        return Decimal("0")

    async def sum_for_conversation(self, conversation_id: str) -> Decimal:  # pragma: no cover - unused
        return Decimal("0")

    async def sum_for_importer_day(self, importer_id: str, day: Any) -> Decimal:  # pragma: no cover - unused
        return Decimal("0")


class _FakeRouter:
    """Duck-typed ChatProviderRouter test double — returns a pre-set provider."""

    def __init__(self, provider: FakeChatProvider) -> None:
        self._provider = provider

    def select(self, model_id: str) -> FakeChatProvider:
        return self._provider


def _make_use_case(
    *,
    provider: FakeChatProvider,
    messages: FakeChatMessageRepository | None = None,
    runs: FakeChatRunRepository | None = None,
    conversations: FakeChatConversationRepository | None = None,
    breaker: FakeCostCircuitBreaker | None = None,
    ledger: FakeCostLedgerRepository | None = None,
    interactive_widget_tools: tuple[dict[str, Any], ...] = (),
) -> tuple[RunChatTurn, dict[str, Any]]:
    collaborators = {
        "messages": messages or FakeChatMessageRepository(),
        "runs": runs or FakeChatRunRepository(),
        "conversations": conversations or FakeChatConversationRepository(),
        "router": _FakeRouter(provider),
        "breaker": breaker or FakeCostCircuitBreaker(),
        "ledger": ledger or FakeCostLedgerRepository(),
    }
    use_case = RunChatTurn(
        messages=collaborators["messages"],
        runs=collaborators["runs"],
        conversations=collaborators["conversations"],
        router=collaborators["router"],
        breaker=collaborators["breaker"],
        ledger=collaborators["ledger"],
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        interactive_widget_tools=interactive_widget_tools,
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Task 1 (bug 1): UsageDelta accumulates across rounds instead of overwriting
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_delta_accumulates_summed_across_two_rounds() -> None:
    """Two UsageDelta events (10/20 then 5/7) must sum to 15/27, not overwrite to 5/7."""
    provider = FakeChatProvider(
        [
            UsageDelta(input_tokens=10, output_tokens=20),
            UsageDelta(input_tokens=5, output_tokens=7),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    usage_events = [e for e in events if e.type == "usage"]
    assert len(usage_events) == 1
    assert usage_events[0].data["input_tokens"] == 15
    assert usage_events[0].data["output_tokens"] == 27

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].input_tokens == 15
    assert ledger.recorded[0].output_tokens == 27


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_delta_single_round_passthrough_no_regression() -> None:
    """A single UsageDelta still reports exactly its own values (no double-count regression)."""
    provider = FakeChatProvider(
        [
            UsageDelta(input_tokens=10, output_tokens=5),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id):
        pass

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].input_tokens == 10
    assert ledger.recorded[0].output_tokens == 5


# ---------------------------------------------------------------------------
# chat_cost_ledger null user_id (23502) — the ledger row must carry the
# conversation owner's user_id (migrations 0031-0033 made the column NOT NULL;
# every server-locus insert failed silently until this fix)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_event_carries_conversation_owner_user_id() -> None:
    """The recorded UsageEvent must resolve user_id from the conversation owner."""
    provider = FakeChatProvider(
        [
            UsageDelta(input_tokens=10, output_tokens=20),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    conversations = FakeChatConversationRepository(owner="user-owner-1")
    use_case, fakes = _make_use_case(provider=provider, conversations=conversations)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id):
        pass

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].user_id == "user-owner-1"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_usage_event_owner_lookup_failure_never_breaks_the_turn() -> None:
    """An owner_user_id lookup failure degrades to user_id=None — the turn still completes."""

    class _RaisingConversations(FakeChatConversationRepository):
        async def owner_user_id(self, conversation_id: str) -> str | None:
            raise RuntimeError("boom")

    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, fakes = _make_use_case(provider=provider, conversations=_RaisingConversations())

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    assert events[-1].type == "completed"
    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].user_id is None


# ---------------------------------------------------------------------------
# Task 2 (bug 2): tool-call parse failure surfaces a visible text part
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_malformed_emit_ui_spec_json_surfaces_visible_text_part() -> None:
    """Truncated/invalid emit_ui_spec JSON must surface PARSE_FAILURE_TEXT, never drop silently."""
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_ui_spec", id="tool-1", partial_json='{"type": "SpecRoot", "chi'),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    assert events[-1].type == "completed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "completed"

    parts = assistant_messages[0].parts
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert any(p["text"] == PARSE_FAILURE_TEXT for p in text_parts)
    assert not any(p.get("type") == "genui_spec" for p in parts)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_malformed_proposal_cards_json_surfaces_visible_text_part() -> None:
    """Truncated/invalid emit_proposal_cards JSON must surface PARSE_FAILURE_TEXT, never drop silently."""
    provider = FakeChatProvider(
        [
            ToolCallDelta(tool_name="emit_proposal_cards", id="tool-1", partial_json='{"options": [invalid'),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, interactive_widget_tools=(_TEST_PROPOSAL_CARDS_TOOL,))

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    assert events[-1].type == "completed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "completed"

    parts = assistant_messages[0].parts
    text_parts = [p for p in parts if p.get("type") == "text"]
    assert any(p["text"] == PARSE_FAILURE_TEXT for p in text_parts)
    assert not any(p.get("type") == "interactive_widget" for p in parts)
