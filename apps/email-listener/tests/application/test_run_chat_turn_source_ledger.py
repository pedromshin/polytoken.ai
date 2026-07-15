"""Tests for RCNV-01's auto-collect source ledger (Phase 56-02).

Two test groups in this one file (mirrors the plan's `files_modified` list --
adapter + hook coverage share a single test file):

  Adapter tests (SupabaseSourceLedgerRepository, call-shape via MagicMock, no
  live DB -- mirrors test_knowledge_graph_repository.py's convention):
    - `insert_entries([])` is a no-op -- never calls the DB.
    - `insert_entries([...])` upserts against the (conversation_id,
      tool_use_id, result_index) dedupe index.
    - `get` returns a SourceLedgerEntry when the row exists, None otherwise.

  Hook tests (RunChatTurn._run_server_tool_round, driven end-to-end via
  `.run()` against test-only ToolExecutor/ChatProvider doubles -- mirrors
  test_run_chat_turn_envelope_gate.py's exact harness):
    (a) a web_search result that passes the envelope gate -> insert_entries
        called once with one entry per result, url/title/snippet mapped,
        result_index enumerated, an entry with no url skipped.
    (b) an ineligible tool name -> no insert attempted (allowlist gate).
    (c) an is_error result -> no insert attempted.
    (d) a well-formed-but-oversized envelope that `cap_tool_output`
        truncates mid-JSON (Pitfall 1, 56-RESEARCH.md) -> the ledger's own
        json.loads fails, a warning is logged, the turn still completes
        normally (fail-open, never a raise), no insert.
    (e) no `source_ledger` collaborator wired -> the provider's `system`/
        `messages` payload is byte-identical to the SAME run WITH a wired
        collaborator (regression guard: the hook is a pure side-effect,
        never mutates the turn's own content path).

Fakes/`_make_use_case` scaffold copied locally from
test_run_chat_turn_envelope_gate.py (this repo's established per-test-file
convention -- avoids cross-file test coupling).
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.ports.source_ledger_repository import SourceLedgerEntry
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision
from app.infrastructure.supabase.source_ledger_repository import SupabaseSourceLedgerRepository

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"

_TOOL_ROUND_MODEL = ChatModel(
    id="test-source-ledger-tool-round-model",
    display_name="Test Tool-Round Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(
        tools=True, genui=False, streaming=True, context_tokens=200_000, max_tool_rounds=4
    ),
    best_for="testing",
)
_TEST_MODELS = {_TOOL_ROUND_MODEL.id: _TOOL_ROUND_MODEL}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only model."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn.get_model", _TEST_MODELS.get)


# ---------------------------------------------------------------------------
# Test doubles (local copies, per this repo's established convention)
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
        self.events: list[ChatRunEvent] = []
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
        event = ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]
        self.events.append(event)
        return event

    async def finish_run(self, *, run_id: str, status: str) -> None:
        del run_id, status


class FakeChatConversationRepository:
    """In-memory ChatConversationRepository test double.

    Only `touch` is implemented -- `email_repository` is never wired in
    these tests, so `_build_cluster_context_block` returns early without
    ever calling `get_thread_id` (mirrors envelope_gate's identical fake).
    """

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        del conversation_id, model_id, title


class FakeCostCircuitBreaker:
    """A CostCircuitBreaker test double that always allows (no cost-cap scenarios in this file)."""

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        del kwargs
        return PreTurnDecision.allow()

    def should_abort(self, running_cost: Decimal) -> bool:
        del running_cost
        return False

    def should_abort_round(self, round_cost: Decimal) -> bool:
        del round_cost
        return False

    def estimate_turn_cost(self, *, model: Any, prompt_tokens_est: int, max_output_tokens: int) -> Decimal:
        del model, prompt_tokens_est, max_output_tokens
        return Decimal("0")


class FakeCostLedgerRepository:
    """In-memory CostLedgerRepository test double."""

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

    def __init__(self, provider: Any) -> None:
        self._provider = provider

    def select(self, model_id: str) -> Any:
        del model_id
        return self._provider


class _MultiRoundFakeChatProvider:
    """A ChatProvider test double returning a DIFFERENT delta list per `.stream()` call.

    `rounds` is a list of delta lists, one per round; if `.stream()` is
    called MORE times than `len(rounds)`, the LAST list repeats.
    """

    def __init__(self, rounds: list[list[Any]]) -> None:
        self._rounds = rounds
        self.stream_calls: list[dict[str, Any]] = []

    async def stream(self, **kwargs: Any) -> Any:
        call_index = len(self.stream_calls)
        self.stream_calls.append(kwargs)
        deltas = self._rounds[call_index] if call_index < len(self._rounds) else self._rounds[-1]
        for delta in deltas:
            if isinstance(delta, BaseException):
                raise delta
            yield delta


class _ScriptedToolExecutor:
    """A ToolExecutor test double returning a fixed, pre-scripted result."""

    def __init__(self, content: str, *, is_error: bool = False) -> None:
        self._content = content
        self._is_error = is_error

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        del name, arguments, importer_id
        return ToolExecutionResult(tool_use_id="scripted", content=self._content, is_error=self._is_error)


class FakeSourceLedgerRepository:
    """In-memory SourceLedgerRepository test double -- records every insert_entries call."""

    def __init__(self) -> None:
        self.insert_entries_calls: list[list[SourceLedgerEntry]] = []
        self._by_id: dict[str, SourceLedgerEntry] = {}

    async def insert_entries(self, entries: Any) -> None:
        entries_list = list(entries)
        self.insert_entries_calls.append(entries_list)
        for entry in entries_list:
            self._by_id[entry.tool_use_id] = entry

    async def get(self, ledger_entry_id: str) -> SourceLedgerEntry | None:
        return self._by_id.get(ledger_entry_id)


def _make_use_case(
    *,
    provider: Any,
    tool_executors: dict[str, Any],
    source_ledger: Any = None,
) -> tuple[RunChatTurn, dict[str, Any]]:
    collaborators = {
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
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        tool_executors=tool_executors,
        source_ledger=source_ledger,
    )
    return use_case, collaborators


def _tool_round_deltas() -> list[list[Any]]:
    """Two rounds: model calls one server tool, then finishes with text."""
    return [
        [
            ToolCallDelta(tool_name="web_search", id="tool-1", partial_json='{"query":"acme"}'),
            StreamEnd(stop_reason="tool_use"),
        ],
        [TextDelta(text="Done."), StreamEnd(stop_reason="end_turn")],
    ]


# ---------------------------------------------------------------------------
# Adapter tests: SupabaseSourceLedgerRepository (call-shape, MagicMock, no live DB)
# ---------------------------------------------------------------------------


def _make_upsert_chain_mock(execute_return: Any) -> MagicMock:
    chain = MagicMock()
    chain.execute.return_value = execute_return
    chain.upsert.return_value = chain
    return chain


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_insert_entries_empty_sequence_is_noop_no_db_call() -> None:
    client = MagicMock()
    repo = SupabaseSourceLedgerRepository(client=client)

    await repo.insert_entries([])

    assert not client.table.called, "insert_entries([]) must never call the DB"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_insert_entries_upserts_on_dedupe_conflict_columns() -> None:
    execute_result = MagicMock()
    execute_result.data = [{"id": "row-1"}]
    chain = _make_upsert_chain_mock(execute_result)
    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseSourceLedgerRepository(client=client)
    entry = SourceLedgerEntry(
        conversation_id="conv-1",
        importer_id="importer-1",
        tool_name="web_search",
        tool_use_id="tool-1",
        result_index=0,
        url="https://example.com",
        title="Example",
        snippet="a snippet",
    )

    await repo.insert_entries([entry])

    client.table.assert_called_with("chat_source_ledger")
    assert chain.upsert.called, "insert_entries must call upsert"
    call = chain.upsert.call_args
    rows = call.args[0]
    assert rows[0]["conversation_id"] == "conv-1"
    assert rows[0]["url"] == "https://example.com"
    assert rows[0]["tool_use_id"] == "tool-1"
    assert rows[0]["result_index"] == 0
    assert call.kwargs["on_conflict"] == "conversation_id,tool_use_id,result_index"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_get_returns_entry_when_row_exists() -> None:
    row = {
        "id": "ledger-1",
        "conversation_id": "conv-1",
        "importer_id": "importer-1",
        "tool_name": "web_search",
        "tool_use_id": "tool-1",
        "result_index": 0,
        "url": "https://example.com",
        "title": "Example",
        "snippet": "a snippet",
        "knowledge_node_id": None,
        "captured_at": "2026-07-15T00:00:00Z",
    }
    execute_result = MagicMock()
    execute_result.data = row
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    maybe_single_chain = MagicMock()
    maybe_single_chain.execute.return_value = execute_result
    chain.maybe_single.return_value = maybe_single_chain
    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseSourceLedgerRepository(client=client)

    result = await repo.get("ledger-1")

    assert result is not None
    assert result.id == "ledger-1"
    assert result.url == "https://example.com"
    assert result.knowledge_node_id is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_adapter_get_returns_none_when_row_missing() -> None:
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    maybe_single_chain = MagicMock()
    maybe_single_chain.execute.return_value = None  # supabase-py's own no-row contract
    chain.maybe_single.return_value = maybe_single_chain
    client = MagicMock()
    client.table.return_value = chain
    repo = SupabaseSourceLedgerRepository(client=client)

    result = await repo.get("missing-id")

    assert result is None


# ---------------------------------------------------------------------------
# Hook tests: RunChatTurn._run_server_tool_round's auto-collect write
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_web_search_result_writes_one_ledger_entry_per_result_with_correct_mapping() -> None:
    envelope = {
        "mode": "web_search",
        "results": [
            {"title": "Result One", "url": "https://example.com/one", "snippet": "First snippet"},
            {"title": "Result Two", "url": "https://example.com/two", "snippet": None},
            {"title": "No URL", "snippet": "dropped -- missing url"},
        ],
    }
    provider = _MultiRoundFakeChatProvider(rounds=_tool_round_deltas())
    source_ledger = FakeSourceLedgerRepository()
    use_case, _fakes = _make_use_case(
        provider=provider,
        tool_executors={"web_search": _ScriptedToolExecutor(json.dumps(envelope, separators=(",", ":")))},
        source_ledger=source_ledger,
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="search acme", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert len(source_ledger.insert_entries_calls) == 1
    entries = source_ledger.insert_entries_calls[0]
    assert len(entries) == 2, "the urlless third result must be skipped"
    assert entries[0].conversation_id == _CONVERSATION_ID
    assert entries[0].tool_name == "web_search"
    assert entries[0].tool_use_id == "tool-1"
    assert entries[0].url == "https://example.com/one"
    assert entries[0].title == "Result One"
    assert entries[0].snippet == "First snippet"
    assert entries[0].result_index == 0
    assert entries[1].url == "https://example.com/two"
    assert entries[1].snippet is None
    assert entries[1].result_index == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_ineligible_tool_name_no_ledger_insert() -> None:
    envelope = {
        "results": [
            {
                "entity_instance_id": "ent-1",
                "display_name": "Acme Corp",
                "entity_type_id": "etype-1",
                "match_type": "id_exact",
                "score": 1.0,
            }
        ]
    }
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="lookup_entity", id="tool-1", partial_json="{}"),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Done."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    source_ledger = FakeSourceLedgerRepository()
    use_case, _fakes = _make_use_case(
        provider=provider,
        tool_executors={"lookup_entity": _ScriptedToolExecutor(json.dumps(envelope, separators=(",", ":")))},
        source_ledger=source_ledger,
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="look up acme", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert source_ledger.insert_entries_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_error_result_no_ledger_insert() -> None:
    provider = _MultiRoundFakeChatProvider(rounds=_tool_round_deltas())
    source_ledger = FakeSourceLedgerRepository()
    use_case, _fakes = _make_use_case(
        provider=provider,
        tool_executors={"web_search": _ScriptedToolExecutor("search failed", is_error=True)},
        source_ledger=source_ledger,
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="search acme", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert source_ledger.insert_entries_calls == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_malformed_envelope_after_truncation_logs_warning_never_raises() -> None:
    """Pitfall 1 (56-RESEARCH.md): a well-formed envelope that PASSES validate_tool_envelope
    (no forbidden fields, no citations) but is long enough that cap_tool_output's mid-string
    truncation -- which runs AFTER the gate -- breaks the JSON the ledger hook parses. The
    hook must fail open: warn and skip, never raise, never block the turn.
    """
    oversized_envelope = {
        "mode": "web_search",
        "results": [{"title": "T", "url": "https://example.com/x", "snippet": "S" * 2500}],
    }
    content = json.dumps(oversized_envelope, separators=(",", ":"))
    assert len(content) > 2000, "fixture must exceed MAX_TOOL_OUTPUT_CHARS to exercise the truncation path"

    provider = _MultiRoundFakeChatProvider(rounds=_tool_round_deltas())
    source_ledger = FakeSourceLedgerRepository()
    use_case, _fakes = _make_use_case(
        provider=provider,
        tool_executors={"web_search": _ScriptedToolExecutor(content)},
        source_ledger=source_ledger,
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="search acme", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed", "fail-open: the turn must complete normally, never raise"
    assert source_ledger.insert_entries_calls == [], "a JSON-broken-by-truncation envelope must never insert"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_no_source_ledger_collaborator_byte_identical_regression_guard() -> None:
    """No source_ledger wired -> provider payload identical to the SAME run WITH a wired
    (fake) collaborator -- proves the hook is a pure side-effect that never mutates the
    turn's own content path (mirrors test_run_chat_turn_thread_context.py's established
    byte-identical regression-guard pattern).
    """
    envelope = {
        "mode": "web_search",
        "results": [{"title": "Result One", "url": "https://example.com/one", "snippet": "s"}],
    }
    content = json.dumps(envelope, separators=(",", ":"))

    provider_unwired = _MultiRoundFakeChatProvider(rounds=_tool_round_deltas())
    use_case_unwired, _fakes_unwired = _make_use_case(
        provider=provider_unwired,
        tool_executors={"web_search": _ScriptedToolExecutor(content)},
        source_ledger=None,
    )
    async for _ in use_case_unwired.run(
        conversation_id=_CONVERSATION_ID, user_text="search acme", model_id=_TOOL_ROUND_MODEL.id
    ):
        pass

    provider_wired = _MultiRoundFakeChatProvider(rounds=_tool_round_deltas())
    use_case_wired, _fakes_wired = _make_use_case(
        provider=provider_wired,
        tool_executors={"web_search": _ScriptedToolExecutor(content)},
        source_ledger=FakeSourceLedgerRepository(),
    )
    async for _ in use_case_wired.run(
        conversation_id=_CONVERSATION_ID, user_text="search acme", model_id=_TOOL_ROUND_MODEL.id
    ):
        pass

    assert len(provider_unwired.stream_calls) == len(provider_wired.stream_calls)
    for unwired_call, wired_call in zip(provider_unwired.stream_calls, provider_wired.stream_calls, strict=True):
        assert unwired_call["system"] == wired_call["system"]
        assert unwired_call["messages"] == wired_call["messages"]
