"""Tests for RunChatTurn's monthlyChatTurns pre-insert gate (vLAUNCH W5-1, A7).

The listener-side ENFORCEMENT mirror of packages/api-client/src/router/chat/
turn-cap.ts's enforceChatTurnCap, wired into run() BEFORE the role='user'
message row is written. Semantics under test are the TS gate's, verbatim:

  - FREE at/over cap  -> rejected: exactly one un-persisted 'cost_capped' run
    event carrying the friendly CHAT_TURN_CAP_MESSAGE, no user row inserted,
    the provider never even selected a stream (the same pre-turn BLOCK
    mechanism the cost breaker already uses — chat_run_events.run_id is NOT
    NULL, so a turn rejected before a run exists yields an in-memory event).
  - FREE under cap    -> proceeds; the user row IS inserted; turn completes.
  - PRO/POWER at cap  -> NEVER blocked; the turn proceeds.
  - Tier lookup error -> FAIL OPEN (turn proceeds).
  - Count error       -> FAIL OPEN (turn proceeds).
  - Unknown tier      -> read as 'free' (blocked at free's cap).
  - Owner unresolvable-> FAIL OPEN (turn proceeds).
  - Unwired collaborators (additive default None) -> gate structurally OFF.

Test doubles mirror test_run_chat_turn_interactive_widget.py's shape (hand-
authored fakes, no infrastructure import — the import-linter contract applies
to co-located application tests too).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.chat_turn_cap import CHAT_TURN_CAP_MESSAGE
from app.domain.services.cost_circuit_breaker import PreTurnDecision

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"
_OWNER_USER_ID = "user-1"

_TEXT_MODEL = ChatModel(
    id="test-text-model",
    display_name="Test Text Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=False, genui=False, streaming=True, context_tokens=200_000),
    best_for="testing",
)
_TEST_MODELS = {_TEXT_MODEL.id: _TEXT_MODEL}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}


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

    async def get_by_id(self, message_id: str) -> ChatMessage | None:  # pragma: no cover - unused this plan
        return next((m for m in self.messages if m.id == message_id), None)

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
    """In-memory ChatConversationRepository test double with a fixed owner."""

    def __init__(self, owner: str | None = _OWNER_USER_ID) -> None:
        self._owner = owner

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas."""

    def __init__(self, deltas: list[Any] | None = None) -> None:
        self._deltas = (
            deltas
            if deltas is not None
            else [
                TextDelta(text="Hello"),
                UsageDelta(input_tokens=1, output_tokens=1),
                StreamEnd(stop_reason="end_turn"),
            ]
        )
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

    def should_abort_round(self, running_cost: Decimal) -> bool:
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


class FakeUserTierResolver:
    """UserTierResolver test double — fixed tier, or raising when told to."""

    def __init__(self, tier: str = "free", *, error: Exception | None = None) -> None:
        self._tier = tier
        self._error = error
        self.calls: list[str] = []

    async def tier_for_user(self, user_id: str) -> str:
        self.calls.append(user_id)
        if self._error is not None:
            raise self._error
        return self._tier


class FakeChatTurnUsageRepository:
    """ChatTurnUsageRepository test double — fixed used-count, or raising when told to."""

    def __init__(self, used: int = 0, *, error: Exception | None = None) -> None:
        self._used = used
        self._error = error
        self.calls: list[str] = []

    async def count_monthly_chat_turns_used(self, user_id: str, *, now: datetime | None = None) -> int:
        self.calls.append(user_id)
        if self._error is not None:
            raise self._error
        return self._used


def _make_use_case(
    *,
    provider: FakeChatProvider,
    user_tiers: FakeUserTierResolver | None,
    chat_turn_usage: FakeChatTurnUsageRepository | None,
    conversations: FakeChatConversationRepository | None = None,
) -> tuple[RunChatTurn, FakeChatMessageRepository]:
    messages = FakeChatMessageRepository()
    use_case = RunChatTurn(
        messages=messages,
        runs=FakeChatRunRepository(),
        conversations=conversations or FakeChatConversationRepository(),  # type: ignore[arg-type]
        router=_FakeRouter(provider),  # type: ignore[arg-type]
        breaker=FakeCostCircuitBreaker(),  # type: ignore[arg-type]
        ledger=FakeCostLedgerRepository(),  # type: ignore[arg-type]
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        user_tiers=user_tiers,
        chat_turn_usage=chat_turn_usage,
    )
    return use_case, messages


async def _run_events(use_case: RunChatTurn) -> list[ChatRunEvent]:
    return [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEXT_MODEL.id)
    ]


# ---------------------------------------------------------------------------
# The gate: free at cap rejected BEFORE insert; everyone else proceeds
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_free_at_cap_is_rejected_before_the_user_message_is_inserted() -> None:
    provider = FakeChatProvider()
    usage = FakeChatTurnUsageRepository(used=200)
    use_case, messages = _make_use_case(
        provider=provider, user_tiers=FakeUserTierResolver("free"), chat_turn_usage=usage
    )

    events = await _run_events(use_case)

    assert [e.type for e in events] == ["cost_capped"]
    assert events[0].data["message"] == CHAT_TURN_CAP_MESSAGE
    assert events[0].data["breached_cap"] == "monthly_chat_turns"
    # Un-persisted pre-turn event — no run row exists to attach it to.
    assert events[0].run_id is None
    # Rejected BEFORE insert: no user row, no assistant row, no provider call.
    assert messages.messages == []
    assert provider.stream_calls == []
    # The count was scoped to the conversation OWNER's server-resolved id.
    assert usage.calls == [_OWNER_USER_ID]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_free_over_cap_is_rejected() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("free"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=5_000),
    )

    events = await _run_events(use_case)

    assert [e.type for e in events] == ["cost_capped"]
    assert messages.messages == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_free_under_cap_proceeds_and_inserts_the_user_message() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("free"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=199),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]
    assert len(provider.stream_calls) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_pro_at_cap_is_never_blocked() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("pro"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=2_000),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_power_at_any_count_is_never_blocked() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("power"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=1_000_000),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unknown_tier_is_treated_as_free_and_blocked_at_cap() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("enterprise"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=200),
    )

    events = await _run_events(use_case)

    assert [e.type for e in events] == ["cost_capped"]
    assert messages.messages == []


# ---------------------------------------------------------------------------
# W6-L: an ALLOWED paid tier at/over its finite cap surfaces over_limit on the
# terminal 'completed' event (additive — the data stays {} otherwise)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_paid_over_cap_completed_event_carries_the_over_limit_marker() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("pro"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=2_000),
    )

    events = await _run_events(use_case)

    completed = events[-1]
    assert completed.type == "completed"
    assert completed.data["over_limit"] is True
    assert completed.data["breached_cap"] == "monthly_chat_turns"
    # Still ALLOWED — the marker never blocks the paid turn.
    assert [m.role for m in messages.messages] == ["user", "assistant"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_under_cap_completed_event_omits_the_over_limit_fields() -> None:
    provider = FakeChatProvider()
    use_case, _messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("pro"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=42),
    )

    events = await _run_events(use_case)

    completed = events[-1]
    assert completed.type == "completed"
    # Additive contract: a normal turn's completed data stays byte-identical.
    assert completed.data == {}


# ---------------------------------------------------------------------------
# Failure posture: FAIL OPEN on any lookup error (mirror of enforceChatTurnCap)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tier_lookup_error_fails_open() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("free", error=RuntimeError("subscriptions table unreachable")),
        chat_turn_usage=FakeChatTurnUsageRepository(used=200),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_count_error_fails_open() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("free"),
        chat_turn_usage=FakeChatTurnUsageRepository(used=0, error=RuntimeError("count query failed")),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unresolvable_owner_fails_open() -> None:
    provider = FakeChatProvider()
    usage = FakeChatTurnUsageRepository(used=200)
    use_case, messages = _make_use_case(
        provider=provider,
        user_tiers=FakeUserTierResolver("free"),
        chat_turn_usage=usage,
        conversations=FakeChatConversationRepository(owner=None),
    )

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]
    # Without a server-resolved owner there is nothing to count against.
    assert usage.calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unwired_collaborators_leave_the_gate_structurally_off() -> None:
    provider = FakeChatProvider()
    use_case, messages = _make_use_case(provider=provider, user_tiers=None, chat_turn_usage=None)

    events = await _run_events(use_case)

    assert events[-1].type == "completed"
    assert [m.role for m in messages.messages] == ["user", "assistant"]
