"""Tests for RunChatTurn — the chat agent/run orchestration loop (Phase 22-06).

TDD (SEAM-04, SEAM-03, D-16, D-18, D-26, D-01, D-03, D-10, D-12, D-20/D-21):
  Task 2 (this RED/GREEN cycle):
    1. Happy path: started -> (>=1 text_delta_checkpoint) -> usage -> completed;
       persists a user message + an assistant message with non-empty parts.
    2. A BLOCK pre-turn decision yields exactly one cost_capped event and the
       provider's stream() is NEVER called (fail-closed, D-21 pre-turn).
    3. History sent to the provider excludes is_active=False siblings and is
       trimmed when it exceeds the model's context_tokens budget (D-26).
    4. The first turn sets a truncated snippet title (not "Untitled conversation")
       and updates conversation.model_id (D-12/D-10).
  Task 3 (added in a later RED/GREEN cycle in this same file):
    5. Mid-stream cost abort -> cost_capped partial + ledger record.
    6. CancelledError -> stopped partial, re-raises.
    7. Provider error -> failed partial.
    8. regenerate() -> new active sibling, prior siblings retired.

Deviation note (matches 22-02/22-04 precedent): placed at
tests/application/test_run_chat_turn.py (not tests/unit/) since
run_chat_turn.py is an application use case, mirroring
tests/application/test_generate_code_island.py's existing convention.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

# ---------------------------------------------------------------------------
# Test doubles
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

_SMALL_CONTEXT_MODEL = ChatModel(
    id="test-small-context-model",
    display_name="Test Small Context Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=5),
    best_for="testing",
)

_TEST_MODELS = {model.id: model for model in (_SERVER_MODEL, _SMALL_CONTEXT_MODEL)}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only models.

    RunChatTurn resolves models via the REAL curated CHAT_MODEL_REGISTRY
    (chat_model_registry.get_model) — these tests use synthetic ChatModel
    fixtures instead (e.g. a tiny context_tokens=5 budget to exercise D-26
    trimming deterministically), so the module-level name is patched for
    every test in this file.
    """
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
            m if m.id != message_id else ChatMessage(**{**m.__dict__, "status": status})
            for m in self.messages
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
        self.runs[run_id] = {"conversation_id": conversation_id, "agent_id": agent_id, "model_id": model_id, "status": "running"}
        self._seq_by_run[run_id] = 0
        return ChatRun(id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running")

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

    def __init__(self) -> None:
        self.touches: list[dict[str, Any]] = []

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        self.touches.append({"conversation_id": conversation_id, "model_id": model_id, "title": title})


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas.

    Any BaseException instance placed in ``deltas`` is RAISED (not yielded) when
    reached — used to simulate a mid-stream CancelledError or a provider bug.
    """

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
    """A CostCircuitBreaker test double with a scripted pre-turn decision + abort behavior."""

    def __init__(self, *, decision: PreTurnDecision | None = None, abort_after: int | None = None) -> None:
        self._decision = decision or PreTurnDecision.allow()
        self._abort_after = abort_after
        self._abort_calls = 0
        self.pre_turn_calls: list[dict[str, Any]] = []

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        self.pre_turn_calls.append(kwargs)
        return self._decision

    def should_abort(self, running_cost: Decimal) -> bool:
        if self._abort_after is None:
            return False
        self._abort_calls += 1
        return self._abort_calls > self._abort_after

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
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_yields_started_checkpoint_usage_completed() -> None:
    provider = FakeChatProvider(
        [
            TextDelta(text="Hello"),
            TextDelta(text=", world!"),
            UsageDelta(input_tokens=10, output_tokens=5),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="Hi there", model_id=_SERVER_MODEL.id
        )
    ]

    event_types = [e.type for e in events]
    assert event_types[0] == "started"
    assert "text_delta_checkpoint" in event_types
    assert event_types[-2:] == ["usage", "completed"]

    messages: FakeChatMessageRepository = fakes["messages"]
    assert any(m.role == "user" for m in messages.messages)
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].parts
    assert assistant_messages[0].status == "completed"

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].input_tokens == 10
    assert ledger.recorded[0].output_tokens == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_happy_path_calls_provider_with_no_tools() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id):
        pass

    assert provider.stream_called
    call_kwargs = provider.stream_calls[0]
    assert call_kwargs["tools"] == ()


# ---------------------------------------------------------------------------
# Fail-closed pre-turn BLOCK (D-21)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_pre_turn_block_yields_single_cost_capped_event_no_provider_call() -> None:
    provider = FakeChatProvider([TextDelta(text="should never stream")])
    breaker = FakeCostCircuitBreaker(decision=PreTurnDecision.block("per_turn"))
    use_case, fakes = _make_use_case(provider=provider, breaker=breaker)

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id
        )
    ]

    assert len(events) == 1
    assert events[0].type == "cost_capped"
    assert not provider.stream_called

    # The user message IS persisted even when blocked (only the assistant call is withheld).
    messages: FakeChatMessageRepository = fakes["messages"]
    assert any(m.role == "user" for m in messages.messages)
    assert not any(m.role == "assistant" for m in messages.messages)


# ---------------------------------------------------------------------------
# History assembly (D-16, D-26)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_history_excludes_inactive_siblings() -> None:
    messages = FakeChatMessageRepository()
    # Turn 0: user + an inactive (retired) assistant sibling + the active one.
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID, role="user", parts=({"type": "text", "text": "Q1"},), turn_index=0
    )
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": "OLD retired answer"},),
        turn_index=0,
        sibling_group_id="sib-1",
        version=1,
        is_active=False,
    )
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": "NEW active answer"},),
        turn_index=0,
        sibling_group_id="sib-1",
        version=2,
        is_active=True,
    )

    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider, messages=messages)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Q2", model_id=_SERVER_MODEL.id):
        pass

    sent_messages = provider.stream_calls[0]["messages"]
    sent_texts = [
        part["text"]
        for message in sent_messages
        for part in message["content"]
        if part.get("type") == "text"
    ]
    assert "OLD retired answer" not in sent_texts
    assert "NEW active answer" in sent_texts


@pytest.mark.unit
@pytest.mark.asyncio
async def test_history_trimmed_to_context_budget() -> None:
    messages = FakeChatMessageRepository()
    long_text = "word " * 500  # long enough to blow a context_tokens=5 budget
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="user",
        parts=({"type": "text", "text": long_text},),
        turn_index=0,
    )
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": long_text},),
        turn_index=0,
    )

    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, _fakes = _make_use_case(provider=provider, messages=messages)

    async for _ in use_case.run(
        conversation_id=_CONVERSATION_ID, user_text="short", model_id=_SMALL_CONTEXT_MODEL.id
    ):
        pass

    sent_messages = provider.stream_calls[0]["messages"]
    # A tiny context_tokens budget must trim away at least the oldest long message.
    assert len(sent_messages) < 2


# ---------------------------------------------------------------------------
# First-turn title + remembered model (D-12, D-10)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_first_turn_sets_snippet_title_and_updates_model() -> None:
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, fakes = _make_use_case(provider=provider)

    async for _ in use_case.run(
        conversation_id=_CONVERSATION_ID, user_text="What is the capital of France?", model_id=_SERVER_MODEL.id
    ):
        pass

    conversations: FakeChatConversationRepository = fakes["conversations"]
    assert len(conversations.touches) == 1
    touch = conversations.touches[0]
    assert touch["model_id"] == _SERVER_MODEL.id
    assert touch["title"] is not None
    assert touch["title"] != "Untitled conversation"
    assert "France" in touch["title"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_second_turn_does_not_overwrite_title() -> None:
    messages = FakeChatMessageRepository()
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID, role="user", parts=({"type": "text", "text": "Q1"},), turn_index=0
    )
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID, role="assistant", parts=({"type": "text", "text": "A1"},), turn_index=0
    )

    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case, fakes = _make_use_case(provider=provider, messages=messages)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Q2", model_id=_SERVER_MODEL.id):
        pass

    conversations: FakeChatConversationRepository = fakes["conversations"]
    assert len(conversations.touches) == 1
    assert conversations.touches[0]["title"] is None


# ---------------------------------------------------------------------------
# Task 3: mid-stream cost abort -> cost_capped (D-21)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mid_stream_cost_abort_persists_partial_cost_capped() -> None:
    provider = FakeChatProvider(
        [
            TextDelta(text="a"),
            TextDelta(text="b"),
            TextDelta(text="c"),
            UsageDelta(input_tokens=10, output_tokens=5),
            StreamEnd(stop_reason="end_turn"),
        ]
    )
    # abort_after=1: the FIRST should_abort() call (after checkpoint "a") returns
    # False, the SECOND (after checkpoint "b") returns True -> abort before "c".
    breaker = FakeCostCircuitBreaker(abort_after=1)
    use_case, fakes = _make_use_case(provider=provider, breaker=breaker)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    event_types = [e.type for e in events]
    assert event_types[-1] == "cost_capped"
    assert "usage" not in event_types  # only the completed-path emits a separate usage event

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "cost_capped"
    accumulated = "".join(p["text"] for p in assistant_messages[0].parts if p.get("type") == "text")
    assert accumulated == "ab"
    assert "c" not in accumulated

    runs: FakeChatRunRepository = fakes["runs"]
    assert all(run["status"] == "cost_capped" for run in runs.runs.values())

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1  # usage-so-far recorded even though the stream never finished


# ---------------------------------------------------------------------------
# Task 3: cancellation -> stopped, re-raises (D-15)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cancellation_persists_partial_stopped_and_reraises() -> None:
    import asyncio

    provider = FakeChatProvider([TextDelta(text="partial"), asyncio.CancelledError()])
    use_case, fakes = _make_use_case(provider=provider)

    events: list[Any] = []
    with pytest.raises(asyncio.CancelledError):
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id):
            events.append(event)

    assert events[-1].type == "stopped"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "stopped"
    accumulated = "".join(p["text"] for p in assistant_messages[0].parts if p.get("type") == "text")
    assert accumulated == "partial"

    runs: FakeChatRunRepository = fakes["runs"]
    assert all(run["status"] == "stopped" for run in runs.runs.values())


# ---------------------------------------------------------------------------
# Task 3: provider failure -> failed (D-19 backend side)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stream_end_error_persists_partial_failed() -> None:
    provider = FakeChatProvider([TextDelta(text="partial"), StreamEnd(stop_reason="error")])
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    assert events[-1].type == "failed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "failed"

    runs: FakeChatRunRepository = fakes["runs"]
    assert all(run["status"] == "failed" for run in runs.runs.values())


@pytest.mark.unit
@pytest.mark.asyncio
async def test_provider_exception_persists_partial_failed() -> None:
    provider = FakeChatProvider([TextDelta(text="partial"), RuntimeError("boom")])
    use_case, fakes = _make_use_case(provider=provider)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_SERVER_MODEL.id)
    ]

    assert events[-1].type == "failed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "failed"


# ---------------------------------------------------------------------------
# Task 3: regenerate -> new active sibling (D-16)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_regenerate_retires_prior_sibling_and_creates_new_active_version() -> None:
    messages = FakeChatMessageRepository()
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID, role="user", parts=({"type": "text", "text": "Q1"},), turn_index=0
    )
    original = await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": "A1 original"},),
        turn_index=0,
        sibling_group_id="sib-0",
        version=1,
        is_active=True,
    )

    provider = FakeChatProvider([TextDelta(text="A1 regenerated"), StreamEnd(stop_reason="end_turn")])
    use_case, fakes = _make_use_case(provider=provider, messages=messages)

    events = [
        event
        async for event in use_case.regenerate(
            conversation_id=_CONVERSATION_ID, assistant_message_id=original.id, model_id=_SERVER_MODEL.id
        )
    ]

    assert events[-1].type == "completed"

    active = await messages.list_active_context(_CONVERSATION_ID)
    active_assistant = [m for m in active if m.role == "assistant"]
    assert len(active_assistant) == 1
    assert active_assistant[0].sibling_group_id == "sib-0"
    assert active_assistant[0].version == 2
    accumulated = "".join(p["text"] for p in active_assistant[0].parts if p.get("type") == "text")
    assert accumulated == "A1 regenerated"

    # The original version is retired (is_active=False) but not deleted.
    all_assistant = [m for m in messages.messages if m.role == "assistant"]
    assert len(all_assistant) == 2
    original_row = next(m for m in all_assistant if m.version == 1)
    assert original_row.is_active is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_regenerate_blocked_by_pre_turn_cost_does_not_retire_sibling() -> None:
    messages = FakeChatMessageRepository()
    await messages.insert_message(
        conversation_id=_CONVERSATION_ID, role="user", parts=({"type": "text", "text": "Q1"},), turn_index=0
    )
    original = await messages.insert_message(
        conversation_id=_CONVERSATION_ID,
        role="assistant",
        parts=({"type": "text", "text": "A1 original"},),
        turn_index=0,
        sibling_group_id="sib-0",
        version=1,
        is_active=True,
    )

    provider = FakeChatProvider([TextDelta(text="should never stream")])
    breaker = FakeCostCircuitBreaker(decision=PreTurnDecision.block("per_turn"))
    use_case, fakes = _make_use_case(provider=provider, messages=messages, breaker=breaker)

    events = [
        event
        async for event in use_case.regenerate(
            conversation_id=_CONVERSATION_ID, assistant_message_id=original.id, model_id=_SERVER_MODEL.id
        )
    ]

    assert len(events) == 1
    assert events[0].type == "cost_capped"
    assert not provider.stream_called

    # The original active sibling must NOT have been retired if the regenerate
    # attempt never actually got to run — otherwise the conversation would be
    # left with zero active assistant messages for that turn.
    active = await messages.list_active_context(_CONVERSATION_ID)
    active_assistant = [m for m in active if m.role == "assistant"]
    assert len(active_assistant) == 1
    assert active_assistant[0].id == original.id
