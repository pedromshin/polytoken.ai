"""Shared RunChatTurn test doubles (vLAUNCH W7-2 test-double consolidation).

The hand-authored fake collaborators previously copy-pasted across the five
RunChatTurn/SubmitWidgetInteraction suites in this package now live here once.
Each fake carries the UNION of the capabilities the individual copies had
grown (superset fake), so every suite keeps only its scenario-specific
doubles locally:

- FakeChatMessageRepository: `.messages` (seeded + inserted, the RunChatTurn
  suites' view) AND `.inserted` (insert_message-only, the
  SubmitWidgetInteraction suite's view); optional `existing=` seeding.
- FakeChatConversationRepository: configurable `owner` for owner_user_id()
  (the cap suite's gate scoping) — harmless default for suites that only
  need touch().
- FakeChatProvider: optional deltas defaulting to a minimal completed text
  turn (text + usage + end).
- FakeCostCircuitBreaker: always-allow, including should_abort_round (the
  cap suite's superset).

Application-layer test code — imports domain ports/services only, never
app.infrastructure (the import-linter "Application does not import
infrastructure" contract applies to this package too). Not collected by
pytest (python_files = test_*.py).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRun, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.services.chat_model_registry import ChatModel
from app.domain.services.cost_circuit_breaker import PreTurnDecision

OWNER_USER_ID = "user-1"


class FakeChatMessageRepository:
    """In-memory ChatMessageRepository test double (run + submit union).

    `.messages` holds every row (seeded ``existing`` + inserted); `.inserted`
    records only rows written through insert_message.
    """

    def __init__(self, *, existing: list[ChatMessage] | None = None) -> None:
        self.messages: list[ChatMessage] = list(existing or [])
        self.inserted: list[ChatMessage] = []
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
        self.inserted.append(message)
        return message

    async def list_active_context(self, conversation_id: str) -> list[ChatMessage]:
        active = [m for m in self.messages if m.conversation_id == conversation_id and m.is_active]
        return sorted(active, key=lambda m: m.turn_index)

    async def get_by_id(self, message_id: str) -> ChatMessage | None:  # pragma: no cover - unused in most suites
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
    """In-memory ChatConversationRepository test double with a configurable owner."""

    def __init__(self, owner: str | None = OWNER_USER_ID) -> None:
        self._owner = owner

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner


class FakeChatProvider:
    """A ChatProvider test double streaming a pre-configured sequence of deltas.

    With no deltas given, streams a minimal completed text turn.
    """

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


class FakeRouter:
    """Duck-typed ChatProviderRouter test double — returns a pre-set provider."""

    def __init__(self, provider: FakeChatProvider) -> None:
        self._provider = provider

    def select(self, model_id: str) -> FakeChatProvider:
        return self._provider
