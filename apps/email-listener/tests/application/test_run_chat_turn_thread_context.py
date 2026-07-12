"""Tests for RunChatTurn's thread+cluster context injection (Phase 54-05, CLUS-02/CLUS-06).

TDD (RED -> GREEN), behaviors:
  1. thread_id set -> _execute_turn injects a bounded, labeled thread-context
     section into the system prompt the provider receives.
  2. thread_id unset -> NO block injected; system prompt is byte-identical to
     a run with no email_repository collaborator wired at all (regression
     guard).
  3. feature-detect: get_thread_id raises (mirrors an absent 0036 column, or
     an older collaborator that doesn't implement the method at all) -> the
     turn completes normally, no block injected, never a 500.
  4. an enormous thread's injected block never exceeds the assembler's
     combined budget in the provider payload.
  5. sibling-conversation and captured-source reads are scoped to
     importer_id (no cross-tenant cluster bleed) -- asserted via the fake
     collaborators' recorded call kwargs.
  6. no email_repository collaborator wired at all -> no block injected
     (feature entirely opt-in, mirrors knowledge_graph's additive-default
     posture).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import _SYSTEM_PROMPT, RunChatTurn
from app.domain.entities.email import Email
from app.domain.ports.chat_provider import StreamEnd, TextDelta
from app.domain.ports.chat_repositories import ChatConversation, ChatMessage, ChatRunEvent
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.thread_cluster_context import DEFAULT_TOTAL_BUDGET_CHARS

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"
_THREAD_ID = "thread-1"

_TEST_MODEL = ChatModel(
    id="test-cluster-context-model",
    display_name="Test Cluster Context Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=200_000),
    best_for="testing",
)
_TEST_MODELS = {_TEST_MODEL.id: _TEST_MODEL}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeChatMessageRepository:
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
    def __init__(self) -> None:
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> Any:
        from app.domain.ports.chat_repositories import ChatRun

        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self._seq_by_run[run_id] = 0
        return ChatRun(id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running")

    async def append_event(self, *, run_id: str, event_type: str, data: dict[str, Any]) -> ChatRunEvent:
        seq = self._seq_by_run.get(run_id, 0)
        self._seq_by_run[run_id] = seq + 1
        return ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]

    async def finish_run(self, *, run_id: str, status: str) -> None:
        pass


class FakeChatConversationRepository:
    """Extends the base fake with the Phase 54-05 thread-linkage methods.

    `thread_id`/`siblings`/`raise_on_get_thread_id` are test-scenario knobs;
    every call is recorded so tests can assert tenant-scoping (importer_id).
    """

    def __init__(
        self,
        *,
        thread_id: str | None = None,
        siblings: list[ChatConversation] | None = None,
        raise_on_get_thread_id: bool = False,
    ) -> None:
        self._thread_id = thread_id
        self._siblings = siblings or []
        self._raise_on_get_thread_id = raise_on_get_thread_id
        self.get_thread_id_calls: list[str] = []
        self.list_by_thread_id_calls: list[dict[str, Any]] = []

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass

    async def get_thread_id(self, conversation_id: str) -> str | None:
        self.get_thread_id_calls.append(conversation_id)
        if self._raise_on_get_thread_id:
            raise RuntimeError("simulated 0036-unapplied read failure")
        return self._thread_id

    async def list_by_thread_id(
        self,
        *,
        thread_id: str,
        importer_id: str,
        exclude_conversation_id: str | None = None,
        limit: int = 8,
    ) -> list[ChatConversation]:
        self.list_by_thread_id_calls.append(
            {"thread_id": thread_id, "importer_id": importer_id, "exclude_conversation_id": exclude_conversation_id}
        )
        return [s for s in self._siblings if s.id != exclude_conversation_id][:limit]


class FakeChatConversationRepositoryNoThreadSupport:
    """Mirrors an OLDER collaborator that predates Phase 54-05 -- no get_thread_id at all.

    Exercises the AttributeError branch of RunChatTurn's fail-open cluster-
    context gathering (a caller that hasn't upgraded its collaborator must
    never crash).
    """

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass


class FakeEmailRepository:
    def __init__(self, *, emails_by_thread: dict[str, list[Email]] | None = None) -> None:
        self._emails_by_thread = emails_by_thread or {}
        self.list_by_thread_id_calls: list[dict[str, Any]] = []

    async def list_by_thread_id(self, *, importer_id: str, thread_id: str, limit: int, offset: int = 0) -> list[Email]:
        self.list_by_thread_id_calls.append({"importer_id": importer_id, "thread_id": thread_id, "limit": limit})
        return self._emails_by_thread.get(thread_id, [])[:limit]


class FakeKnowledgeGraphRepository:
    """Minimal fake -- only the method Phase 54-05's cluster-context gathering calls."""

    def __init__(self, *, captured_sources: list[dict[str, object]] | None = None) -> None:
        self._captured_sources = captured_sources or []
        self.list_captured_sources_calls: list[dict[str, Any]] = []

    async def list_captured_sources_for_conversations(
        self, *, importer_id: str, conversation_ids: Any, limit: int = 8
    ) -> list[dict[str, object]]:
        self.list_captured_sources_calls.append(
            {"importer_id": importer_id, "conversation_ids": tuple(conversation_ids), "limit": limit}
        )
        return self._captured_sources[:limit]


class FakeChatProvider:
    def __init__(self, deltas: list[Any]) -> None:
        self._deltas = deltas
        self.stream_calls: list[dict[str, Any]] = []

    async def stream(self, **kwargs: Any) -> Any:
        self.stream_calls.append(kwargs)
        for delta in self._deltas:
            yield delta


class FakeCostCircuitBreaker:
    async def check_pre_turn(self, **kwargs: Any) -> Any:
        from app.domain.services.cost_circuit_breaker import PreTurnDecision

        return PreTurnDecision.allow()

    def should_abort(self, running_cost: Any) -> bool:
        return False

    def should_abort_round(self, round_cost: Any) -> bool:
        return False

    def estimate_turn_cost(self, *, model: Any, prompt_tokens_est: int, max_output_tokens: int) -> Any:
        from decimal import Decimal

        return Decimal("0")


class FakeCostLedgerRepository:
    async def record(self, event: Any) -> None:
        pass


class _FakeRouter:
    def __init__(self, provider: FakeChatProvider) -> None:
        self._provider = provider

    def select(self, model_id: str) -> FakeChatProvider:
        return self._provider


def _make_email(*, thread_id: str, sender_name: str, sender_address: str, subject: str, body_text: str, minute: int) -> Email:
    return Email(
        id=f"email-{minute}",
        importer_id=_IMPORTER_ID,
        message_id=f"msg-{minute}@example.com",
        in_reply_to=None,
        references_ids=(),
        received_at=datetime(2026, 7, 1, 10, minute, tzinfo=UTC),
        sender_address=sender_address,
        sender_name=sender_name,
        to_addresses=("recipient@example.com",),
        cc_addresses=(),
        subject=subject,
        body_html=None,
        body_text=body_text,
        raw_storage_key=None,
        parse_status="parsed",
        parse_error=None,
        parsed_at=None,
        created_at=datetime(2026, 7, 1, 10, minute, tzinfo=UTC),
        thread_id=thread_id,
    )


def _make_use_case(
    *,
    provider: FakeChatProvider,
    conversations: Any,
    email_repository: Any | None = None,
    knowledge_graph: Any | None = None,
) -> RunChatTurn:
    return RunChatTurn(
        messages=FakeChatMessageRepository(),
        runs=FakeChatRunRepository(),
        conversations=conversations,
        router=_FakeRouter(provider),
        breaker=FakeCostCircuitBreaker(),
        ledger=FakeCostLedgerRepository(),
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        knowledge_graph=knowledge_graph,
        email_repository=email_repository,
    )


# ---------------------------------------------------------------------------
# 1. thread_id set -> block injected
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_thread_linked_turn_injects_bounded_thread_context_block() -> None:
    emails = [
        _make_email(
            thread_id=_THREAD_ID,
            sender_name="Alice",
            sender_address="alice@example.com",
            subject="Shipment update",
            body_text="The container has cleared customs.",
            minute=0,
        )
    ]
    conversations = FakeChatConversationRepository(thread_id=_THREAD_ID)
    email_repo = FakeEmailRepository(emails_by_thread={_THREAD_ID: emails})
    provider = FakeChatProvider([TextDelta(text="ok"), StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(provider=provider, conversations=conversations, email_repository=email_repo)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    assert provider.stream_calls, "provider was never called"
    system_prompt = provider.stream_calls[0]["system"]
    assert "BEGIN THREAD CONTEXT" in system_prompt
    assert "Shipment update" in system_prompt
    assert "The container has cleared customs." in system_prompt
    assert conversations.get_thread_id_calls == [_CONVERSATION_ID]


# ---------------------------------------------------------------------------
# 2. thread_id unset -> byte-identical to no-collaborator baseline
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_thread_unlinked_turn_is_byte_identical_to_no_email_repository_baseline() -> None:
    provider_a = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    conversations_a = FakeChatConversationRepository(thread_id=None)
    email_repo = FakeEmailRepository()
    use_case_a = _make_use_case(provider=provider_a, conversations=conversations_a, email_repository=email_repo)

    provider_b = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    conversations_b = FakeChatConversationRepositoryNoThreadSupport()
    use_case_b = _make_use_case(provider=provider_b, conversations=conversations_b, email_repository=None)

    async for _ in use_case_a.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass
    async for _ in use_case_b.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    system_a = provider_a.stream_calls[0]["system"]
    system_b = provider_b.stream_calls[0]["system"]
    assert system_a == system_b
    assert "BEGIN THREAD CONTEXT" not in system_a


# ---------------------------------------------------------------------------
# 3. feature-detect: get_thread_id raises -> clean skip, never a 500
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_thread_id_failure_skips_injection_never_raises() -> None:
    conversations = FakeChatConversationRepository(raise_on_get_thread_id=True)
    email_repo = FakeEmailRepository()
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(provider=provider, conversations=conversations, email_repository=email_repo)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assert "BEGIN THREAD CONTEXT" not in provider.stream_calls[0]["system"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_conversations_collaborator_missing_get_thread_id_skips_injection_never_raises() -> None:
    """An OLDER ChatConversationRepository (no get_thread_id at all) must never crash the turn."""
    conversations = FakeChatConversationRepositoryNoThreadSupport()
    email_repo = FakeEmailRepository()
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(provider=provider, conversations=conversations, email_repository=email_repo)

    events = [
        event
        async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assert "BEGIN THREAD CONTEXT" not in provider.stream_calls[0]["system"]


# ---------------------------------------------------------------------------
# 4. enormous thread never exceeds the assembler's combined budget
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_enormous_thread_never_exceeds_assembler_budget_in_provider_payload() -> None:
    huge_emails = [
        _make_email(
            thread_id=_THREAD_ID,
            sender_name=f"Sender {i}",
            sender_address=f"sender{i}@example.com",
            subject="Huge thread",
            body_text="word " * 2000,
            minute=i % 59,
        )
        for i in range(50)
    ]
    conversations = FakeChatConversationRepository(thread_id=_THREAD_ID)
    email_repo = FakeEmailRepository(emails_by_thread={_THREAD_ID: huge_emails})
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(provider=provider, conversations=conversations, email_repository=email_repo)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert "BEGIN THREAD CONTEXT" in system_prompt
    # The injected block is the system prompt minus the (small, fixed) base
    # prompt -- bounding its length bounds the assembler's own contribution.
    injected_len = len(system_prompt) - len(_SYSTEM_PROMPT)
    assert injected_len <= DEFAULT_TOTAL_BUDGET_CHARS + 200  # small header/joiner slack


# ---------------------------------------------------------------------------
# 5. tenant scoping: sibling/source reads scoped to importer_id
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sibling_and_source_reads_scoped_to_importer_id() -> None:
    emails = [
        _make_email(
            thread_id=_THREAD_ID,
            sender_name="Alice",
            sender_address="alice@example.com",
            subject="Shipment update",
            body_text="body",
            minute=0,
        )
    ]
    siblings = [ChatConversation(id="conv-2", title="Sibling chat", model_id=_TEST_MODEL.id)]
    conversations = FakeChatConversationRepository(thread_id=_THREAD_ID, siblings=siblings)
    email_repo = FakeEmailRepository(emails_by_thread={_THREAD_ID: emails})
    knowledge_graph = FakeKnowledgeGraphRepository(
        captured_sources=[{"title": "A source", "content": "https://example.com/a"}]
    )
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(
        provider=provider, conversations=conversations, email_repository=email_repo, knowledge_graph=knowledge_graph
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    assert conversations.list_by_thread_id_calls == [
        {"thread_id": _THREAD_ID, "importer_id": _IMPORTER_ID, "exclude_conversation_id": _CONVERSATION_ID}
    ]
    assert len(knowledge_graph.list_captured_sources_calls) == 1
    call = knowledge_graph.list_captured_sources_calls[0]
    assert call["importer_id"] == _IMPORTER_ID
    assert _CONVERSATION_ID in call["conversation_ids"]
    assert "conv-2" in call["conversation_ids"]

    system_prompt = provider.stream_calls[0]["system"]
    assert "Sibling chat" in system_prompt
    assert "A source" in system_prompt
    assert "https://example.com/a" in system_prompt


# ---------------------------------------------------------------------------
# 6. no email_repository wired at all -> feature entirely opt-in
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_email_repository_wired_skips_injection_entirely() -> None:
    conversations = FakeChatConversationRepository(thread_id=_THREAD_ID)
    provider = FakeChatProvider([StreamEnd(stop_reason="end_turn")])
    use_case = _make_use_case(provider=provider, conversations=conversations, email_repository=None)

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    assert "BEGIN THREAD CONTEXT" not in provider.stream_calls[0]["system"]
    # get_thread_id is never even called when there's no email_repository to
    # make use of a thread_id -- the read is skipped, not just its result discarded.
    assert conversations.get_thread_id_calls == []
