"""Wiring/integration tests for the real lookup_entity + search_emails tool executors (Phase 36-02).

3 permanent regression guards (36-CONTEXT.md's "planner confirms the advertisement
path... and closes any gap if 34 left tool-def advertisement stub-only"):
  1. `_build_tool_offer` advertises REAL per-tool `input_schema.properties` for
     both tools -- not the Phase-34 placeholder empty-object stub.
  2. The real dishka container resolves `RunChatTurn` with both real
     `ToolExecutor` instances wired -- production `tool_executors` never
     silently reverts to `{}`.
  3. One full real-tool round trip (lookup_entity) produces a persisted
     `tool_invocation_result` whose content carries correct citations and
     never leaks raw source text.

Fakes/`_make_use_case` scaffold adapted from test_run_chat_turn_tool_loop_e2e.py
(this repo's established per-test-file convention -- each test file duplicates
its own small fakes rather than sharing a fixtures module).
"""

from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.container import create_container
from app.domain.entities.entity_type import EntityType
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.ports.entity_resolution_repository import EntityCandidate
from app.domain.services.chat_model_registry import get_model
from app.domain.services.cost_circuit_breaker import PreTurnDecision
from app.infrastructure.tools.lookup_entity_executor import (
    LOOKUP_ENTITY_TOOL_NAME,
    LookupEntityExecutor,
    build_lookup_entity_tool,
)
from app.infrastructure.tools.search_emails_executor import (
    SEARCH_EMAILS_TOOL_NAME,
    SearchEmailsExecutor,
    build_search_emails_tool,
)
from app.settings import get_settings

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"
# The real Bedrock Claude registry entry (max_tool_rounds=4, genui=True) -- no
# test-only model registry patching needed for these tests.
_REAL_TOOL_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
_ENTITY_TYPE_ID = "etype-0000-0000-0000-000000000001"
_ENTITY_INSTANCE_ID = "ent-fixture-0000-0000-000000000001"

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}


# ---------------------------------------------------------------------------
# Test doubles (local copies, per this repo's established convention --
# adapted from test_run_chat_turn_tool_loop_e2e.py's working shapes)
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
        self.create_run_calls: list[dict[str, Any]] = []
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> Any:
        from app.domain.ports.chat_repositories import ChatRun

        self.create_run_calls.append({"conversation_id": conversation_id, "agent_id": agent_id, "model_id": model_id})
        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self._seq_by_run[run_id] = 0
        return ChatRun(id=run_id, conversation_id=conversation_id, agent_id=agent_id, model_id=model_id, status="running")

    async def append_event(self, *, run_id: str, event_type: str, data: dict[str, Any]) -> ChatRunEvent:
        seq = self._seq_by_run.get(run_id, 0)
        self._seq_by_run[run_id] = seq + 1
        event = ChatRunEvent(id=f"evt-{run_id}-{seq}", run_id=run_id, seq=seq, type=event_type, data=data)  # type: ignore[arg-type]
        self.events.append(event)
        return event

    async def finish_run(self, *, run_id: str, status: str) -> None:
        del run_id, status


class FakeChatConversationRepository:
    """In-memory ChatConversationRepository test double."""

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        del conversation_id, model_id, title


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


class _FakeRouter:
    """Duck-typed ChatProviderRouter test double -- returns a pre-set provider."""

    def __init__(self, provider: Any) -> None:
        self._provider = provider

    def select(self, model_id: str) -> Any:
        del model_id
        return self._provider


class _LookupEntityRoundTripProvider:
    """A single-tool-round ChatProvider double: calls lookup_entity, then finalizes with text."""

    def __init__(self) -> None:
        self._rounds = [
            [
                ToolCallDelta(
                    tool_name=LOOKUP_ENTITY_TOOL_NAME, id="tool-1", partial_json='{"name_or_id": "Acme Corp"}'
                ),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Found Acme Corp."), StreamEnd(stop_reason="end_turn")],
        ]
        self.stream_calls: list[dict[str, Any]] = []

    async def stream(self, **kwargs: Any) -> Any:
        call_index = len(self.stream_calls)
        self.stream_calls.append(kwargs)
        deltas = self._rounds[call_index] if call_index < len(self._rounds) else self._rounds[-1]
        for delta in deltas:
            yield delta


class _FakeResolutionRepo:
    """Plain (non-Mock) SYNCHRONOUS fake -- mirrors 36-01's find_candidates convention."""

    def __init__(self, candidates: list[EntityCandidate]) -> None:
        self._candidates = candidates
        self.calls: list[dict[str, Any]] = []

    def find_candidates(self, **kwargs: Any) -> list[EntityCandidate]:
        self.calls.append(kwargs)
        return self._candidates


def _make_use_case(
    *,
    provider: Any | None = None,
    tool_executors: dict[str, Any],
    server_tool_defs: dict[str, Any] | None = None,
) -> tuple[RunChatTurn, dict[str, Any]]:
    collaborators = {
        "messages": FakeChatMessageRepository(),
        "runs": FakeChatRunRepository(),
        "conversations": FakeChatConversationRepository(),
        "router": _FakeRouter(provider or _LookupEntityRoundTripProvider()),
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
        server_tool_defs=server_tool_defs or {},
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Test 1: real per-tool schemas advertised (regression guard for the
# Phase-34 placeholder-stub gap 36-CONTEXT.md flagged)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_build_tool_offer_advertises_real_lookup_entity_and_search_emails_schemas() -> None:
    use_case, _fakes = _make_use_case(
        tool_executors={LOOKUP_ENTITY_TOOL_NAME: AsyncMock(), SEARCH_EMAILS_TOOL_NAME: AsyncMock()},
        server_tool_defs={
            LOOKUP_ENTITY_TOOL_NAME: build_lookup_entity_tool(),
            SEARCH_EMAILS_TOOL_NAME: build_search_emails_tool(),
        },
    )
    model = get_model(_REAL_TOOL_MODEL_ID)
    assert model is not None
    assert model.capabilities.max_tool_rounds == 4

    tools = use_case._build_tool_offer(model)

    lookup_tool = next(t for t in tools if t["name"] == LOOKUP_ENTITY_TOOL_NAME)
    assert "properties" in lookup_tool["input_schema"], "must not be the old empty-properties stub"
    assert "name_or_id" in lookup_tool["input_schema"]["properties"]

    search_tool = next(t for t in tools if t["name"] == SEARCH_EMAILS_TOOL_NAME)
    assert "properties" in search_tool["input_schema"], "must not be the old empty-properties stub"
    assert "query" in search_tool["input_schema"]["properties"]


# ---------------------------------------------------------------------------
# Test 2: real dishka container resolves BOTH real tool executors
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_container_wires_both_real_tool_executors(monkeypatch: pytest.MonkeyPatch) -> None:
    # This test is scoped to Phase 36's additive wiring proof (lookup_entity +
    # search_emails), independent of Phase 37/38's separate search_knowledge
    # exposure gate (tests/test_container.py's TestSearchKnowledgeExposureGate
    # owns that assertion) and Phase 54's separate web_search exposure gate
    # (tests/test_container.py's TestWebSearchExposureGate owns that one) --
    # explicitly force BOTH flags off so this test's meaning stays stable
    # regardless of either flag's current default (both flipped to True after
    # their respective adversarial suites passed).
    monkeypatch.setenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", "false")
    monkeypatch.setenv("WEB_SEARCH_TOOL_ENABLED", "false")
    get_settings.cache_clear()
    try:
        with (
            patch("app.container.get_supabase_client", return_value=MagicMock()),
            patch("app.container.get_anthropic_client", return_value=MagicMock()),
            patch("app.container.boto3") as boto3_mock,
        ):
            boto3_mock.client.return_value = MagicMock()
            container = create_container()
            run_chat_turn = asyncio.run(container.get(RunChatTurn))

        executors = run_chat_turn._tool_executors
        assert set(executors.keys()) == {LOOKUP_ENTITY_TOOL_NAME, SEARCH_EMAILS_TOOL_NAME}
        assert isinstance(executors[LOOKUP_ENTITY_TOOL_NAME], LookupEntityExecutor)
        assert isinstance(executors[SEARCH_EMAILS_TOOL_NAME], SearchEmailsExecutor)
    finally:
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Test 3: one real lookup_entity round trip -- grounded citations, no leakage
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_lookup_entity_round_trip_produces_grounded_citations() -> None:
    entity_instances = AsyncMock()
    entity_instances.find_by_id.return_value = None  # id miss -> name-search fallback

    entity_types = AsyncMock()
    entity_types.list_active.return_value = [
        EntityType(
            id=_ENTITY_TYPE_ID,
            importer_id=None,
            slug="company",
            label="Company",
            description=None,
            is_active=True,
            embedding=None,
            fields=(),
        )
    ]

    embedder = AsyncMock()
    embedder.embed.return_value = (0.1, 0.2)

    resolution_repo = _FakeResolutionRepo(
        candidates=[
            EntityCandidate(
                entity_instance_id=_ENTITY_INSTANCE_ID,
                display_name="Acme Corp",
                rrf_score=0.02,
                match_type="semantic",
                similarity_score=0.8,
            )
        ]
    )

    real_lookup_executor = LookupEntityExecutor(
        entity_instances=entity_instances,
        resolution_repo=resolution_repo,
        entity_types=entity_types,
        embedder=embedder,
    )

    use_case, fakes = _make_use_case(
        provider=_LookupEntityRoundTripProvider(),
        tool_executors={LOOKUP_ENTITY_TOOL_NAME: real_lookup_executor},
        server_tool_defs={LOOKUP_ENTITY_TOOL_NAME: build_lookup_entity_tool()},
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID,
            user_text="who is Acme Corp?",
            model_id=_REAL_TOOL_MODEL_ID,
            importer_id=_IMPORTER_ID,
        )
    ]

    assert events[-1].type == "completed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_message = next(m for m in messages.messages if m.role == "assistant")
    result_part = next(p for p in assistant_message.parts if p["type"] == "tool_invocation_result")
    content = result_part["content"]

    parsed = json.loads(content)
    citations = parsed["citations"]
    assert any(c["route"] == f"/entities/{_ENTITY_INSTANCE_ID}" for c in citations)
    assert "content_text" not in content
