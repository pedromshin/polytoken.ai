"""Tests for the QUAR-01 envelope gate wiring + tool-round hardening line (Phase 38-01).

Drives `RunChatTurn._execute_turn`'s round loop against test-only `ToolExecutor`
doubles via a `FakeChatProvider` returning a DIFFERENT delta list per
`.stream()` call -- proving:
  - Test 1: a poisoned executor output (a forbidden raw-body field) is
    replaced with the fixed `_TOOL_ENVELOPE_INVALID_TEXT` string, never the
    raw poisoned content, and marked `isError=True` in the persisted part.
  - Test 2: the SAME safe replacement text (not the raw poisoned JSON) is
    what round 2's synthetic `tool_result` message carries.
  - Test 3: a tool-round-eligible turn's `system` prompt carries the exact
    `_TOOL_RESULT_HARDENING_LINE`.
  - Test 4: an OpenRouter-style (`max_tool_rounds=0`) turn's `system` is the
    unmodified `_SYSTEM_PROMPT` -- hardening line absent.
  - Test 5: a `max_tool_rounds > 0` model with EMPTY `tool_executors` is ALSO
    unmodified -- the gate is on tool-round ELIGIBILITY, not just model
    capability.
  - Test 6: a well-formed, real-shaped envelope passes through unchanged
    (regression: the gate never mangles legitimate content).

Fakes/`_make_use_case` scaffold copied locally from
test_run_chat_turn_tool_loop_e2e.py (this repo's established per-test-file
convention -- avoids cross-file test coupling).
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import (
    _SYSTEM_PROMPT,
    _TOOL_ENVELOPE_INVALID_TEXT,
    _TOOL_RESULT_HARDENING_LINE,
    RunChatTurn,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"

# A Bedrock-style model with the round-loop capability gate OPEN
# (max_tool_rounds=4) -- mirrors the 2 real Bedrock Claude registry entries.
_TOOL_ROUND_MODEL = ChatModel(
    id="test-envelope-gate-tool-round-model",
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

# An OpenRouter-style model -- max_tool_rounds defaults to 0 (T-34-05 gate).
_OPENROUTER_MODEL = ChatModel(
    id="test-envelope-gate-openrouter-model",
    display_name="Test OpenRouter Model",
    transport="openrouter",
    execution_locus="server",
    price_in_per_mtok=0.5,
    price_out_per_mtok=1.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=64_000),
    best_for="testing",
)

_TEST_MODELS = {model.id: model for model in (_TOOL_ROUND_MODEL, _OPENROUTER_MODEL)}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}

_POISONED_CONTENT = '{"results":[{"content_text":"LEAKED"}],"citations":[]}'

# A well-formed, real-shaped envelope -- mirrors LookupEntityExecutor's own
# result shape (Phase 36-01).
_WELL_FORMED_CONTENT = json.dumps(
    {
        "results": [
            {
                "entity_instance_id": "ent-1",
                "display_name": "Acme Corp",
                "entity_type_id": "etype-1",
                "match_type": "id_exact",
                "score": 1.0,
            }
        ],
        "citations": [{"kind": "entity", "id": "ent-1", "route": "/entities/ent-1"}],
    },
    separators=(",", ":"),
)


@pytest.fixture(autouse=True)
def _patch_model_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitute run_chat_turn's get_model() lookup with this file's test-only models."""
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
        self.create_run_calls: list[dict[str, Any]] = []
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> Any:
        from app.domain.ports.chat_repositories import ChatRun

        self.create_run_calls.append({"conversation_id": conversation_id, "agent_id": agent_id, "model_id": model_id})
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
    """In-memory ChatConversationRepository test double."""

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


def _make_use_case(
    *,
    provider: Any,
    tool_executors: dict[str, Any],
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
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# Test 1/2: a poisoned envelope is quarantined -- never a raw passthrough
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_poisoned_envelope_replaced_with_invalid_text_and_marked_error() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="lookup_entity", id="tool-1", partial_json="{}"),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Done."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(
        provider=provider, tool_executors={"lookup_entity": _ScriptedToolExecutor(_POISONED_CONTENT)}
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="look something up", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_message = messages.messages[-1]
    result_part = next(p for p in assistant_message.parts if p["type"] == "tool_invocation_result")
    assert result_part["content"] == _TOOL_ENVELOPE_INVALID_TEXT
    assert result_part["isError"] is True

    for part in assistant_message.parts:
        assert "LEAKED" not in json.dumps(part), "the poisoned raw content must never reach a persisted part"
    for event in events:
        assert "LEAKED" not in json.dumps(event.data), "the poisoned raw content must never reach an emitted event"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_poisoned_envelope_safe_replacement_fed_to_next_round_not_raw() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="lookup_entity", id="tool-1", partial_json="{}"),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Done."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, _fakes = _make_use_case(
        provider=provider, tool_executors={"lookup_entity": _ScriptedToolExecutor(_POISONED_CONTENT)}
    )

    async for _ in use_case.run(
        conversation_id=_CONVERSATION_ID, user_text="look something up", model_id=_TOOL_ROUND_MODEL.id
    ):
        pass

    assert len(provider.stream_calls) == 2, "exactly 2 provider.stream() calls -- one per round"
    round_two_messages = str(provider.stream_calls[1]["messages"])
    assert "LEAKED" not in round_two_messages, "round 2 must never see the raw poisoned content"
    assert _TOOL_ENVELOPE_INVALID_TEXT in round_two_messages, "round 2 must see the safe replacement text instead"


# ---------------------------------------------------------------------------
# Test 3/4/5: the tool-round hardening line appears ONLY when eligible
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_round_eligible_turn_system_prompt_carries_hardening_line() -> None:
    provider = _MultiRoundFakeChatProvider(rounds=[[StreamEnd(stop_reason="end_turn")]])
    use_case, _fakes = _make_use_case(
        provider=provider, tool_executors={"lookup_entity": _ScriptedToolExecutor(_WELL_FORMED_CONTENT)}
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert _TOOL_RESULT_HARDENING_LINE in system_prompt


@pytest.mark.unit
@pytest.mark.asyncio
async def test_openrouter_model_system_prompt_unmodified_no_hardening_line() -> None:
    provider = _MultiRoundFakeChatProvider(rounds=[[StreamEnd(stop_reason="end_turn")]])
    use_case, _fakes = _make_use_case(
        provider=provider, tool_executors={"lookup_entity": _ScriptedToolExecutor(_WELL_FORMED_CONTENT)}
    )

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_OPENROUTER_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert system_prompt == _SYSTEM_PROMPT
    assert _TOOL_RESULT_HARDENING_LINE not in system_prompt


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tool_round_capable_model_with_empty_executors_system_prompt_unmodified() -> None:
    """max_tool_rounds > 0 alone is not enough -- eligibility also needs a non-empty tool_executors mapping."""
    provider = _MultiRoundFakeChatProvider(rounds=[[StreamEnd(stop_reason="end_turn")]])
    use_case, _fakes = _make_use_case(provider=provider, tool_executors={})

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id):
        pass

    system_prompt = provider.stream_calls[0]["system"]
    assert system_prompt == _SYSTEM_PROMPT
    assert _TOOL_RESULT_HARDENING_LINE not in system_prompt


# ---------------------------------------------------------------------------
# Test 6: regression -- a well-formed envelope passes through unmangled
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_well_formed_envelope_passes_through_unmodified() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="lookup_entity", id="tool-1", partial_json="{}"),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Found it."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(
        provider=provider, tool_executors={"lookup_entity": _ScriptedToolExecutor(_WELL_FORMED_CONTENT)}
    )

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="who is Acme Corp?", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    messages: FakeChatMessageRepository = fakes["messages"]
    result_part = next(p for p in messages.messages[-1].parts if p["type"] == "tool_invocation_result")
    assert result_part["content"] == _WELL_FORMED_CONTENT
    assert result_part["isError"] is False
