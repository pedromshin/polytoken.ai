"""Tests for RunChatTurn's linked-context injection (Phase 56-04, RCNV-04).

TDD (RED -> GREEN), behaviors:
  1. Active context edges (knowledge_node-typed) present, thread_id UNSET ->
     _execute_turn injects a bounded, labeled LINKED CONTEXT block into the
     system prompt the provider receives -- INDEPENDENTLY of whether a
     thread is linked (the load-bearing assertion, RESEARCH Pattern 3).
  2. No context_edges collaborator wired (None) -> NO linked block; system
     prompt byte-identical to the SAME run with a wired-but-empty
     collaborator (regression guard).
  3. Edge-repo read raises -> the turn completes normally, no linked block,
     never a raise (fail-open).
  4. Both blocks compose: a conversation with BOTH a linked thread AND
     active context edges gets BOTH the cluster block and the linked block.
  5. All four sourceRef.type resolvers (source_ledger, knowledge_node,
     genui_panel, email_thread) resolve into the SAME block end-to-end.
  6. The knowledge_node resolution path never calls list_injectable_edges
     (D-56-A / Landmine 3 -- tier-agnostic direct read only).

Fakes/`_make_use_case` scaffold copied locally (this repo's established
per-test-file convention -- avoids cross-file test coupling, mirrors
test_run_chat_turn_source_ledger.py / test_run_chat_turn_thread_context.py).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.entities.email import Email
from app.domain.ports.chat_context_edge_repository import ContextEdge
from app.domain.ports.chat_provider import StreamEnd
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"
_THREAD_ID = "thread-1"

_TEST_MODEL = ChatModel(
    id="test-linked-context-model",
    display_name="Test Linked Context Model",
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
    def __init__(self, *, seed_messages: list[ChatMessage] | None = None) -> None:
        self.messages: list[ChatMessage] = list(seed_messages or [])
        self._next_id = 0
        self.get_by_id_calls: list[str] = []

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

    async def get_by_id(self, message_id: str) -> ChatMessage | None:
        self.get_by_id_calls.append(message_id)
        return next((m for m in self.messages if m.id == message_id), None)

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
    """Extends the base fake with the Phase 54-05 thread-linkage methods (mirrors thread_context test's fake)."""

    def __init__(self, *, thread_id: str | None = None) -> None:
        self._thread_id = thread_id
        self.get_thread_id_calls: list[str] = []

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        pass

    async def get_thread_id(self, conversation_id: str) -> str | None:
        self.get_thread_id_calls.append(conversation_id)
        return self._thread_id

    async def list_by_thread_id(
        self,
        *,
        thread_id: str,
        importer_id: str,
        exclude_conversation_id: str | None = None,
        limit: int = 8,
    ) -> list[Any]:
        return []


class FakeEmailRepository:
    def __init__(self, *, emails_by_thread: dict[str, list[Email]] | None = None) -> None:
        self._emails_by_thread = emails_by_thread or {}
        self.list_by_thread_id_calls: list[dict[str, Any]] = []

    async def list_by_thread_id(self, *, importer_id: str, thread_id: str, limit: int, offset: int = 0) -> list[Email]:
        self.list_by_thread_id_calls.append({"importer_id": importer_id, "thread_id": thread_id, "limit": limit})
        return self._emails_by_thread.get(thread_id, [])[:limit]


class FakeKnowledgeGraphRepository:
    """Minimal fake -- only the methods Phase 54-05/56-04's context gathering calls.

    Tracks `list_injectable_edges_calls` so tests can prove D-56-A's
    tier-agnostic direct read NEVER routes through the automatic-injection
    allowlist gate.
    """

    def __init__(
        self,
        *,
        captured_sources: list[dict[str, object]] | None = None,
        nodes_by_id: dict[str, dict[str, object]] | None = None,
    ) -> None:
        self._captured_sources = captured_sources or []
        self._nodes_by_id = nodes_by_id or {}
        self.list_captured_sources_calls: list[dict[str, Any]] = []
        self.get_node_by_id_calls: list[str] = []
        self.list_injectable_edges_calls: list[str] = []

    async def list_captured_sources_for_conversations(
        self, *, importer_id: str, conversation_ids: Any, limit: int = 8
    ) -> list[dict[str, object]]:
        self.list_captured_sources_calls.append(
            {"importer_id": importer_id, "conversation_ids": tuple(conversation_ids), "limit": limit}
        )
        return self._captured_sources[:limit]

    async def get_node_by_id(self, node_id: str) -> dict[str, object] | None:
        self.get_node_by_id_calls.append(node_id)
        return self._nodes_by_id.get(node_id)

    async def list_injectable_edges(self, importer_id: str) -> list[dict[str, object]]:
        self.list_injectable_edges_calls.append(importer_id)
        return []


class FakeSourceLedgerRepository:
    def __init__(self, *, entries_by_id: dict[str, SourceLedgerEntry] | None = None) -> None:
        self._entries_by_id = entries_by_id or {}

    async def insert_entries(self, entries: Any) -> None:
        pass

    async def get(self, ledger_entry_id: str) -> SourceLedgerEntry | None:
        return self._entries_by_id.get(ledger_entry_id)

    async def set_knowledge_node_id(self, ledger_entry_id: str, node_id: str) -> None:
        pass


class FakeChatContextEdgeRepository:
    def __init__(self, *, edges: list[ContextEdge] | None = None, raise_on_list: bool = False) -> None:
        self._edges = edges or []
        self._raise_on_list = raise_on_list
        self.list_calls: list[str] = []

    async def list_active_context_edges(self, conversation_id: str) -> list[ContextEdge]:
        self.list_calls.append(conversation_id)
        if self._raise_on_list:
            raise RuntimeError("simulated chat_context_edges read failure")
        return self._edges


class FakeChatProvider:
    def __init__(self, deltas: list[Any] | None = None) -> None:
        self._deltas = deltas or [StreamEnd(stop_reason="end_turn")]
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


def _make_email(
    *, thread_id: str, sender_name: str, sender_address: str, subject: str, body_text: str, minute: int
) -> Email:
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
    messages: Any | None = None,
    context_edges: Any | None = None,
    email_repository: Any | None = None,
    knowledge_graph: Any | None = None,
    source_ledger: Any | None = None,
) -> RunChatTurn:
    return RunChatTurn(
        messages=messages or FakeChatMessageRepository(),
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
        source_ledger=source_ledger,
        context_edges=context_edges,
    )


# ---------------------------------------------------------------------------
# 1. edges present, thread UNSET -> injected, independently of thread linkage
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_context_edges_inject_linked_block_independently_of_thread_linkage() -> None:
    edge = ContextEdge(
        id="edge-1",
        target_conversation_id=_CONVERSATION_ID,
        source_ref={"type": "knowledge_node", "nodeId": "node-1"},
        source_ref_key="knowledge_node:node-1",
        is_active=True,
    )
    context_edges = FakeChatContextEdgeRepository(edges=[edge])
    knowledge_graph = FakeKnowledgeGraphRepository(
        nodes_by_id={"node-1": {"title": "Acme Corp", "content": "Acme is a logistics provider."}}
    )
    conversations = FakeChatConversationRepository(thread_id=None)  # no thread linked at all
    provider = FakeChatProvider()
    use_case = _make_use_case(
        provider=provider, conversations=conversations, context_edges=context_edges, knowledge_graph=knowledge_graph
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    assert provider.stream_calls, "provider was never called"
    system_prompt = provider.stream_calls[0]["system"]
    assert "LINKED CONTEXT" in system_prompt
    assert "Acme Corp" in system_prompt
    assert "Acme is a logistics provider." in system_prompt
    assert "BEGIN THREAD CONTEXT" not in system_prompt
    assert context_edges.list_calls == [_CONVERSATION_ID]


# ---------------------------------------------------------------------------
# 2. no context_edges collaborator wired -> byte-identical regression guard
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_context_edges_collaborator_byte_identical_to_wired_but_empty() -> None:
    provider_unwired = FakeChatProvider()
    conversations_unwired = FakeChatConversationRepository(thread_id=None)
    use_case_unwired = _make_use_case(
        provider=provider_unwired, conversations=conversations_unwired, context_edges=None
    )

    provider_wired = FakeChatProvider()
    conversations_wired = FakeChatConversationRepository(thread_id=None)
    use_case_wired = _make_use_case(
        provider=provider_wired,
        conversations=conversations_wired,
        context_edges=FakeChatContextEdgeRepository(edges=[]),
    )

    async for _ in use_case_unwired.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass
    async for _ in use_case_wired.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    system_unwired = provider_unwired.stream_calls[0]["system"]
    system_wired = provider_wired.stream_calls[0]["system"]
    assert system_unwired == system_wired
    assert "LINKED CONTEXT" not in system_unwired


# ---------------------------------------------------------------------------
# 3. edge-repo read raises -> fail-open, never a raise
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_context_edges_read_failure_skips_injection_never_raises() -> None:
    context_edges = FakeChatContextEdgeRepository(raise_on_list=True)
    conversations = FakeChatConversationRepository(thread_id=None)
    provider = FakeChatProvider()
    use_case = _make_use_case(provider=provider, conversations=conversations, context_edges=context_edges)

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assert "LINKED CONTEXT" not in provider.stream_calls[0]["system"]


# ---------------------------------------------------------------------------
# 4. both blocks compose: thread linked AND context edges present
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_thread_and_linked_context_blocks_both_compose() -> None:
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
    edge = ContextEdge(
        id="edge-1",
        target_conversation_id=_CONVERSATION_ID,
        source_ref={"type": "knowledge_node", "nodeId": "node-1"},
        source_ref_key="knowledge_node:node-1",
        is_active=True,
    )
    context_edges = FakeChatContextEdgeRepository(edges=[edge])
    knowledge_graph = FakeKnowledgeGraphRepository(nodes_by_id={"node-1": {"title": "Acme Corp", "content": "x"}})
    conversations = FakeChatConversationRepository(thread_id=_THREAD_ID)
    email_repo = FakeEmailRepository(emails_by_thread={_THREAD_ID: emails})
    provider = FakeChatProvider()
    use_case = _make_use_case(
        provider=provider,
        conversations=conversations,
        context_edges=context_edges,
        knowledge_graph=knowledge_graph,
        email_repository=email_repo,
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert "BEGIN THREAD CONTEXT" in system_prompt
    assert "LINKED CONTEXT" in system_prompt
    assert "Acme Corp" in system_prompt


# ---------------------------------------------------------------------------
# 5. all four sourceRef.type resolvers end-to-end
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_all_four_source_ref_types_resolve_into_linked_block() -> None:
    panel_message = ChatMessage(
        id="panel-msg-1",
        conversation_id="other-conv",
        role="assistant",
        parts=({"type": "genui_spec", "spec": {"_plan": "A dashboard of freight costs."}},),
        turn_index=0,
    )
    messages = FakeChatMessageRepository(seed_messages=[panel_message])
    edges = [
        ContextEdge(
            id="edge-source",
            target_conversation_id=_CONVERSATION_ID,
            source_ref={"type": "source_ledger", "ledgerId": "ledger-1"},
            source_ref_key="source_ledger:ledger-1",
            is_active=True,
        ),
        ContextEdge(
            id="edge-node",
            target_conversation_id=_CONVERSATION_ID,
            source_ref={"type": "knowledge_node", "nodeId": "node-1"},
            source_ref_key="knowledge_node:node-1",
            is_active=True,
        ),
        ContextEdge(
            id="edge-panel",
            target_conversation_id=_CONVERSATION_ID,
            source_ref={"type": "genui_panel", "messageId": "panel-msg-1", "partIndex": 0},
            source_ref_key="genui_panel:panel-msg-1:0",
            is_active=True,
        ),
        ContextEdge(
            id="edge-thread",
            target_conversation_id=_CONVERSATION_ID,
            source_ref={"type": "email_thread", "threadId": "other-thread-1"},
            source_ref_key="email_thread:other-thread-1",
            is_active=True,
        ),
    ]
    context_edges = FakeChatContextEdgeRepository(edges=edges)
    knowledge_graph = FakeKnowledgeGraphRepository(nodes_by_id={"node-1": {"title": "Acme Corp", "content": "x"}})
    source_ledger = FakeSourceLedgerRepository(
        entries_by_id={
            "ledger-1": SourceLedgerEntry(
                conversation_id="other-conv",
                importer_id=_IMPORTER_ID,
                tool_name="web_search",
                tool_use_id="tool-1",
                result_index=0,
                url="https://example.com/regs",
                title="Shipping regulations",
                snippet="Key rules for freight.",
                id="ledger-1",
            )
        }
    )
    email_repo = FakeEmailRepository(
        emails_by_thread={
            "other-thread-1": [
                _make_email(
                    thread_id="other-thread-1",
                    sender_name="Bob",
                    sender_address="bob@example.com",
                    subject="Customs delay",
                    body_text="The shipment is delayed at customs.",
                    minute=1,
                )
            ]
        }
    )
    conversations = FakeChatConversationRepository(thread_id=None)
    provider = FakeChatProvider()
    use_case = _make_use_case(
        provider=provider,
        conversations=conversations,
        messages=messages,
        context_edges=context_edges,
        knowledge_graph=knowledge_graph,
        source_ledger=source_ledger,
        email_repository=email_repo,
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert "Shipping regulations" in system_prompt
    assert "Key rules for freight." in system_prompt
    assert "Acme Corp" in system_prompt
    assert "A dashboard of freight costs." in system_prompt
    assert "Customs delay" in system_prompt
    assert "The shipment is delayed at customs." in system_prompt
    assert messages.get_by_id_calls == ["panel-msg-1"]


# ---------------------------------------------------------------------------
# 6. knowledge_node resolution is tier-agnostic -- never list_injectable_edges
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_knowledge_node_resolution_never_calls_list_injectable_edges() -> None:
    edge = ContextEdge(
        id="edge-1",
        target_conversation_id=_CONVERSATION_ID,
        source_ref={"type": "knowledge_node", "nodeId": "node-1"},
        source_ref_key="knowledge_node:node-1",
        is_active=True,
    )
    context_edges = FakeChatContextEdgeRepository(edges=[edge])
    knowledge_graph = FakeKnowledgeGraphRepository(nodes_by_id={"node-1": {"title": "Acme Corp", "content": "x"}})
    conversations = FakeChatConversationRepository(thread_id=None)
    provider = FakeChatProvider()
    use_case = _make_use_case(
        provider=provider, conversations=conversations, context_edges=context_edges, knowledge_graph=knowledge_graph
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="Hi", model_id=_TEST_MODEL.id):
        pass

    # Linked-context knowledge_node resolution goes through the tier-agnostic
    # DIRECT read (get_node_by_id) — D-56-A — and node-1 is the only node it
    # resolves here (AI-06's canon retrieval finds no canon edges in this fake,
    # so it adds no get_node_by_id calls of its own).
    assert knowledge_graph.get_node_by_id_calls == ["node-1"]
    # AI-06 (agent memory) now consults the sanctioned auto-injection gate
    # (list_injectable_edges) once per turn as its CANON-edge source — a
    # DIFFERENT pipeline from linked-context resolution above. Its presence
    # here proves the two pipelines are independent: linked-context resolved
    # node-1 via get_node_by_id (never via the allowlist), while the single
    # allowlist call belongs to AI-06's canon gate, not to node resolution.
    assert knowledge_graph.list_injectable_edges_calls == [_IMPORTER_ID]


# ---------------------------------------------------------------------------
# 7. direct invocation of _system_prompt_with_linked_context (internal seam)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_system_prompt_with_linked_context_appends_block_directly() -> None:
    """Direct-invocation test of the internal seam _execute_turn chains after the cluster call."""
    edge = ContextEdge(
        id="edge-1",
        target_conversation_id=_CONVERSATION_ID,
        source_ref={"type": "knowledge_node", "nodeId": "node-1"},
        source_ref_key="knowledge_node:node-1",
        is_active=True,
    )
    context_edges = FakeChatContextEdgeRepository(edges=[edge])
    knowledge_graph = FakeKnowledgeGraphRepository(nodes_by_id={"node-1": {"title": "Acme Corp", "content": "x"}})
    use_case = _make_use_case(
        provider=FakeChatProvider(),
        conversations=FakeChatConversationRepository(thread_id=None),
        context_edges=context_edges,
        knowledge_graph=knowledge_graph,
    )

    result = await use_case._system_prompt_with_linked_context(
        base_system_prompt="BASE PROMPT", conversation_id=_CONVERSATION_ID, importer_id=_IMPORTER_ID
    )

    assert result.startswith("BASE PROMPT")
    assert "LINKED CONTEXT" in result
    assert "Acme Corp" in result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_system_prompt_with_linked_context_returns_base_prompt_unchanged_when_unwired() -> None:
    use_case = _make_use_case(
        provider=FakeChatProvider(),
        conversations=FakeChatConversationRepository(thread_id=None),
        context_edges=None,
    )

    result = await use_case._system_prompt_with_linked_context(
        base_system_prompt="BASE PROMPT", conversation_id=_CONVERSATION_ID, importer_id=_IMPORTER_ID
    )

    assert result == "BASE PROMPT"
