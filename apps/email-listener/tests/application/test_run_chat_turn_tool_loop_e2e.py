"""End-to-end tests for the bounded mid-turn server-tool round loop (Phase 34-03).

Drives `RunChatTurn._execute_turn`'s round loop against the test-only
`EchoToolExecutor` (Plan 34-01) via a `FakeChatProvider` that returns a
DIFFERENT delta list per `.stream()` call -- proving:
  - LOOP-01: a server-tool round (tool call -> tool_invocation_result ->
    continued streaming) completes INSIDE the same `_execute_turn` call --
    exactly one ChatRun, no recursion.
  - The round loop is capped at `_MAX_TOOL_ROUNDS` (4) behind
    `ChatModelCapabilities.max_tool_rounds` -- an OpenRouter-style model
    (max_tool_rounds=0) never enters a round (T-34-05).
  - LOOP-03: exhausting the round cap ends the turn with a visible
    "couldn't fully resolve" text part, never a bare `stopped` state.
  - Each server-tool round persists tool_invocation/tool_invocation_result
    parts, emits a ToolResultDelta-derived tool_result run event, and a
    per-tool timeout/exception becomes an is_error result without raising
    out of the loop (T-34-01).
  - `self._breaker.should_abort(...)` is re-checked at the round boundary.

Fakes/`_make_use_case` scaffold copied locally from `test_run_chat_turn.py`
(this repo's established per-test-file convention, confirmed by 34-02's own
plan deviation note -- avoids cross-file test coupling).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_tool_loop import (
    FINAL_ROUND_NUDGE_TEXT,
    MAX_SERVER_CALLS_PER_ROUND,
    ROUND_CAP_EXHAUSTED_TEXT,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, ToolCallDelta, UsageDelta
from app.domain.ports.chat_repositories import ChatMessage, ChatRunEvent
from app.domain.ports.cost_ledger_repository import UsageEvent
from app.domain.ports.tool_executor import ToolExecutionResult
from app.domain.services.chat_model_registry import ChatModel, ChatModelCapabilities
from app.domain.services.cost_circuit_breaker import PreTurnDecision
from tests.support.echo_tool_executor import EchoToolExecutor

# ---------------------------------------------------------------------------
# Test fixtures: models
# ---------------------------------------------------------------------------

_IMPORTER_ID = "importer-1"
_CONVERSATION_ID = "conv-1"

# A Bedrock-style model with the round-loop capability gate OPEN
# (max_tool_rounds=4) -- mirrors the 2 real Bedrock Claude registry entries.
_TOOL_ROUND_MODEL = ChatModel(
    id="test-tool-round-model",
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

# A Bedrock-style model with BOTH genui and the round loop enabled -- mirrors
# the real registry entries the live chat uses (emit_ui_spec AND web_search
# offered in the same stream).
_GENUI_TOOL_ROUND_MODEL = ChatModel(
    id="test-genui-tool-round-model",
    display_name="Test Genui Tool-Round Model",
    transport="bedrock",
    execution_locus="server",
    price_in_per_mtok=3.0,
    price_out_per_mtok=15.0,
    capabilities=ChatModelCapabilities(
        tools=True, genui=True, streaming=True, context_tokens=200_000, max_tool_rounds=4
    ),
    best_for="testing",
)

# An OpenRouter-style model -- max_tool_rounds defaults to 0 (T-34-05 gate).
# genui=True here specifically so the gate test proves the max_tool_rounds
# check in isolation (emit_ui_spec IS still offered; "echo" must NOT be) --
# not merely "no tools offered at all" for an unrelated reason.
_OPENROUTER_MODEL = ChatModel(
    id="test-openrouter-model",
    display_name="Test OpenRouter Model",
    transport="openrouter",
    execution_locus="server",
    price_in_per_mtok=0.5,
    price_out_per_mtok=1.0,
    capabilities=ChatModelCapabilities(tools=True, genui=True, streaming=True, context_tokens=64_000),
    best_for="testing",
)

_TEST_MODELS = {model.id: model for model in (_TOOL_ROUND_MODEL, _GENUI_TOOL_ROUND_MODEL, _OPENROUTER_MODEL)}

_TEST_EMIT_UI_SPEC_TOOL: dict[str, Any] = {"name": "emit_ui_spec", "description": "test", "input_schema": {}}


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
        self.runs: dict[str, dict[str, Any]] = {}
        self.events: list[ChatRunEvent] = []
        self.create_run_calls: list[dict[str, Any]] = []
        self._next_run_id = 0
        self._seq_by_run: dict[str, int] = {}

    async def create_run(self, *, conversation_id: str, agent_id: str, model_id: str) -> Any:
        from app.domain.ports.chat_repositories import ChatRun

        self.create_run_calls.append(
            {"conversation_id": conversation_id, "agent_id": agent_id, "model_id": model_id}
        )
        self._next_run_id += 1
        run_id = f"run-{self._next_run_id}"
        self.runs[run_id] = {
            "conversation_id": conversation_id,
            "agent_id": agent_id,
            "model_id": model_id,
            "status": "running",
        }
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
    """In-memory ChatConversationRepository test double."""

    def __init__(self) -> None:
        self.touches: list[dict[str, Any]] = []

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        self.touches.append({"conversation_id": conversation_id, "model_id": model_id, "title": title})


class _MultiRoundFakeChatProvider:
    """A ChatProvider test double returning a DIFFERENT delta list per `.stream()` call.

    `rounds` is a list of delta lists, one per round; if `.stream()` is
    called MORE times than `len(rounds)`, the LAST list repeats -- drives the
    round-cap-exhaustion test (an "always calls a tool" provider) without
    the test author needing to repeat the same round 5 times by hand.
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


class FakeCostCircuitBreaker:
    """A CostCircuitBreaker test double with a scripted pre-turn decision + abort behavior."""

    def __init__(
        self,
        *,
        decision: PreTurnDecision | None = None,
        abort_after: int | None = None,
        round_abort_after: int | None = None,
    ) -> None:
        self._decision = decision or PreTurnDecision.allow()
        self._abort_after = abort_after
        self._abort_calls = 0
        self._round_abort_after = round_abort_after
        self._round_abort_calls = 0
        self.pre_turn_calls: list[dict[str, Any]] = []
        self.should_abort_calls = 0
        self.should_abort_round_calls = 0

    async def check_pre_turn(self, **kwargs: Any) -> PreTurnDecision:
        self.pre_turn_calls.append(kwargs)
        return self._decision

    def should_abort(self, running_cost: Decimal) -> bool:
        self.should_abort_calls += 1
        if self._abort_after is None:
            return False
        self._abort_calls += 1
        return self._abort_calls > self._abort_after

    def should_abort_round(self, round_cost: Decimal) -> bool:
        self.should_abort_round_calls += 1
        if self._round_abort_after is None:
            return False
        self._round_abort_calls += 1
        return self._round_abort_calls > self._round_abort_after

    def estimate_turn_cost(self, *, model: ChatModel, prompt_tokens_est: int, max_output_tokens: int) -> Decimal:
        price_in = Decimal(str(model.price_in_per_mtok))
        price_out = Decimal(str(model.price_out_per_mtok))
        return (Decimal(prompt_tokens_est) * price_in + Decimal(max_output_tokens) * price_out) / Decimal(1_000_000)


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
        return self._provider


class _RaisingToolExecutor:
    """A ToolExecutor test double that always raises -- drives the generic-Exception path."""

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        del name, arguments, importer_id
        raise RuntimeError("boom")


class _CountingEchoToolExecutor:
    """Wraps EchoToolExecutor, counting `.execute()` calls (bounds the round cap, LOOP-03)."""

    def __init__(self) -> None:
        self._delegate = EchoToolExecutor()
        self.call_count = 0

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        self.call_count += 1
        return await self._delegate.execute(name=name, arguments=arguments, importer_id=importer_id)


def _make_use_case(
    *,
    provider: Any,
    tool_executors: dict[str, Any],
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
        emit_ui_spec_tool=_TEST_EMIT_UI_SPEC_TOOL,
        default_importer_id=_IMPORTER_ID,
        max_output_tokens=1000,
        tool_executors=tool_executors,
    )
    return use_case, collaborators


# ---------------------------------------------------------------------------
# LOOP-01: a server-tool round completes inside the SAME run, continues streaming
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_round_continues_streaming_within_single_run() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # Round 1: the model calls the echo tool.
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"q": "hi"}'),
                UsageDelta(input_tokens=10, output_tokens=20),
                StreamEnd(stop_reason="tool_use"),
            ],
            # Round 2: the model continues with plain text (SAME run).
            [
                TextDelta(text="Done!"),
                UsageDelta(input_tokens=5, output_tokens=3),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="look something up", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"

    runs: FakeChatRunRepository = fakes["runs"]
    assert len(runs.create_run_calls) == 1, "a multi-round turn must create exactly ONE ChatRun (SEAM-04)"

    event_types = [e.type for e in runs.events]
    assert "tool_call" in event_types
    assert "tool_result" in event_types

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    parts = assistant_messages[0].parts
    part_types = [p["type"] for p in parts]
    assert "tool_invocation" in part_types
    assert "tool_invocation_result" in part_types
    assert part_types[-1] == "text"
    assert parts[-1]["text"] == "Done!"

    invocation_part = next(p for p in parts if p["type"] == "tool_invocation")
    assert invocation_part["toolName"] == "echo"
    result_part = next(p for p in parts if p["type"] == "tool_invocation_result")
    assert result_part["toolName"] == "echo"
    assert result_part["isError"] is False

    ledger: FakeCostLedgerRepository = fakes["ledger"]
    assert len(ledger.recorded) == 1
    assert ledger.recorded[0].input_tokens == 15, "usage must accumulate (sum) across both rounds' UsageDeltas"
    assert ledger.recorded[0].output_tokens == 23

    assert len(provider.stream_calls) == 2, "exactly 2 provider.stream() calls -- one per round"
    round_two_messages = provider.stream_calls[1]["messages"]
    round_two_content = str(round_two_messages)
    assert "tool_result" in round_two_content, "round 2 must see the native tool_result block fed back"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_two_server_tool_calls_in_one_stream_both_execute() -> None:
    """TWO server-tool calls in one streamed response must BOTH execute in the round.

    Live regression (2026-07-12, CLUS-07 dry run): the model emitted two web_search
    calls per response; only the last pending call was dispatched at StreamEnd — the
    first was mangled into a bogus genui_spec part ({'query': ...}), rendering as the
    SAFE_FALLBACK 'Could not generate a view' panel and polluting history replay.
    Anthropic's protocol: every tool_use block gets a tool_result in the next user
    message.
    """
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"q": "first"}'),
                ToolCallDelta(tool_name="echo", id="tool-2", partial_json='{"q": "second"}'),
                StreamEnd(stop_reason="tool_use"),
            ],
            [
                TextDelta(text="Done!"),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="two lookups", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    parts = assistant_messages[0].parts
    invocation_ids = [p["toolUseId"] for p in parts if p["type"] == "tool_invocation"]
    result_ids = [p["toolUseId"] for p in parts if p["type"] == "tool_invocation_result"]
    assert invocation_ids == ["tool-1", "tool-2"], "both calls must be recorded, in emission order"
    assert result_ids == ["tool-1", "tool-2"], "both calls must produce results"
    assert not any(
        p.get("type") == "genui_spec" for p in parts
    ), "a server-tool call must NEVER be mangled into a genui_spec part"

    assert len(provider.stream_calls) == 2
    round_two_messages = provider.stream_calls[1]["messages"]
    assistant_replay = next(m for m in reversed(round_two_messages) if m["role"] == "assistant")
    tool_use_ids = [b["id"] for b in assistant_replay["content"] if b.get("type") == "tool_use"]
    assert tool_use_ids == ["tool-1", "tool-2"], "the replayed assistant message must carry BOTH tool_use blocks"
    tool_result_message = round_two_messages[-1]
    assert tool_result_message["role"] == "user"
    tool_result_ids = [b["tool_use_id"] for b in tool_result_message["content"] if b.get("type") == "tool_result"]
    assert tool_result_ids == ["tool-1", "tool-2"], "every tool_use must get a matching tool_result (API contract)"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_call_finalized_by_text_then_stream_end_still_executes() -> None:
    """A server-tool call finalized by a LATER TextDelta (pending=None at StreamEnd) must still execute."""
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"q": "hi"}'),
                TextDelta(text="Searching now."),
                StreamEnd(stop_reason="end_turn"),
            ],
            [
                TextDelta(text="Done!"),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="lookup", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert len(provider.stream_calls) == 2, "the queued call must still trigger a round"

    messages: FakeChatMessageRepository = fakes["messages"]
    parts = next(m for m in messages.messages if m.role == "assistant").parts
    part_types = [p["type"] for p in parts]
    assert "tool_invocation" in part_types
    assert "tool_invocation_result" in part_types
    assert not any(p.get("type") == "genui_spec" for p in parts)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_parallel_server_calls_beyond_per_round_cap_get_error_results() -> None:
    """Calls beyond MAX_SERVER_CALLS_PER_ROUND are not executed but still get (error) tool_results fed back."""
    n_calls = MAX_SERVER_CALLS_PER_ROUND + 1
    deltas: list[Any] = [
        ToolCallDelta(tool_name="echo", id=f"tool-{i}", partial_json='{"q": "x"}') for i in range(n_calls)
    ]
    deltas.append(StreamEnd(stop_reason="tool_use"))
    provider = _MultiRoundFakeChatProvider(
        rounds=[deltas, [TextDelta(text="Done!"), StreamEnd(stop_reason="end_turn")]]
    )
    counting_executor = _CountingEchoToolExecutor()
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": counting_executor})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="many lookups", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert counting_executor.call_count == MAX_SERVER_CALLS_PER_ROUND, "overflow calls must NOT execute"

    round_two_messages = provider.stream_calls[1]["messages"]
    tool_result_blocks = [
        b for b in round_two_messages[-1]["content"] if b.get("type") == "tool_result"
    ]
    assert len(tool_result_blocks) == n_calls, "EVERY tool_use still needs a tool_result (API contract)"
    overflow_block = tool_result_blocks[-1]
    assert overflow_block["is_error"] is True

    messages: FakeChatMessageRepository = fakes["messages"]
    parts = next(m for m in messages.messages if m.role == "assistant").parts
    overflow_results = [
        p for p in parts if p["type"] == "tool_invocation_result" and p["isError"] is True
    ]
    assert len(overflow_results) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_final_round_offers_no_server_tools_and_carries_answer_nudge() -> None:
    """The last allowed stream must offer NO server tools and the last round's fed-back
    message must end with FINAL_ROUND_NUDGE_TEXT — so the model answers instead of
    burning the cap on another lookup (live 2026-07-12: every research turn ended
    capped with no answer)."""
    provider = _MultiRoundFakeChatProvider(
        rounds=[[ToolCallDelta(tool_name="echo", id="tool-x", partial_json='{"q": "again"}'),
                 StreamEnd(stop_reason="tool_use")]]
    )
    counting_executor = _CountingEchoToolExecutor()
    use_case, _fakes = _make_use_case(provider=provider, tool_executors={"echo": counting_executor})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="keep looking", model_id=_GENUI_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert len(provider.stream_calls) == 5, "4 executed rounds + 1 final stream"

    # Rounds 0-3 offer the server tool; the FINAL stream must not.
    for call_index in range(4):
        names = [t["name"] for t in provider.stream_calls[call_index]["tools"]]
        assert "echo" in names, f"stream {call_index} must still offer the server tool"
    final_names = [t["name"] for t in provider.stream_calls[4]["tools"]]
    assert "echo" not in final_names, "the final stream must NOT offer server tools"
    assert "emit_ui_spec" in final_names, "genui tools stay offered so the model can still emit a panel"

    # Only the LAST round's fed-back message carries the nudge.
    final_feedback = provider.stream_calls[4]["messages"][-1]
    assert final_feedback["role"] == "user"
    assert final_feedback["content"][-1] == {"type": "text", "text": FINAL_ROUND_NUDGE_TEXT}
    earlier_feedback = provider.stream_calls[1]["messages"][-1]
    assert all(
        block.get("text") != FINAL_ROUND_NUDGE_TEXT for block in earlier_feedback["content"]
    ), "earlier rounds must NOT carry the nudge"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_genui_spec_lead_part_replayed_as_text_stand_in_never_raw() -> None:
    """A genui_spec part finalized BEFORE a server-tool call in the same stream must be
    replayed to the provider as the '[emitted UI spec: ...]' text stand-in, never as a
    raw {'type': 'genui_spec'} block.

    Live regression (2026-07-12): the model emitted a UI panel then called web_search in
    one response; the raw genui_spec dict entered round 2's assistant message and Bedrock
    400'd with \"Input tag 'genui_spec' ... does not match any of the expected tags\".
    """
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # Round 1: emit_ui_spec completes (finalized by the DIFFERENT-id delta
            # that follows), then the model calls the echo server tool.
            [
                ToolCallDelta(tool_name="emit_ui_spec", id="tool-1", partial_json='{"type": "SpecRoot"}'),
                ToolCallDelta(tool_name="echo", id="tool-2", partial_json='{"q": "hi"}'),
                StreamEnd(stop_reason="tool_use"),
            ],
            # Round 2: plain text completion (SAME run).
            [
                TextDelta(text="Done!"),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="research this", model_id=_GENUI_TOOL_ROUND_MODEL.id
        )
    ]

    assert events[-1].type == "completed"
    assert len(provider.stream_calls) == 2, "the server-tool round must still complete (one stream per round)"

    round_two_messages = provider.stream_calls[1]["messages"]
    assistant_blocks = [
        block
        for message in round_two_messages
        if message["role"] == "assistant"
        for block in message["content"]
    ]
    assert all(
        block.get("type") != "genui_spec" for block in assistant_blocks
    ), "a raw genui_spec block must NEVER reach the provider (Anthropic rejects unknown content tags)"
    stand_ins = [
        block
        for block in assistant_blocks
        if block.get("type") == "text" and block.get("text", "").startswith("[emitted UI spec:")
    ]
    assert stand_ins, "the spec must survive as the text stand-in (same conversion as history replay)"

    # The persisted canonical part is UNCHANGED: still a real genui_spec part.
    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert any(p.get("type") == "genui_spec" for p in assistant_messages[0].parts)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_forced_error_result_does_not_raise_and_completes() -> None:
    """An executor-returned is_error result feeds back into the SAME round loop and completes."""
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"__force_error__": true}'),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Sorry, that failed."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "completed"
    messages: FakeChatMessageRepository = fakes["messages"]
    result_part = next(p for p in messages.messages[-1].parts if p["type"] == "tool_invocation_result")
    assert result_part["isError"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_execution_exception_becomes_error_result_loop_continues() -> None:
    """An executor that RAISES never escapes the loop -- becomes an is_error result (T-34-01)."""
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [ToolCallDelta(tool_name="raiser", id="tool-1", partial_json="{}"), StreamEnd(stop_reason="tool_use")],
            [TextDelta(text="Recovered."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"raiser": _RaisingToolExecutor()})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "completed", "an executor exception must never raise out of the loop"
    messages: FakeChatMessageRepository = fakes["messages"]
    result_part = next(p for p in messages.messages[-1].parts if p["type"] == "tool_invocation_result")
    assert result_part["isError"] is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_execution_timeout_becomes_error_result(monkeypatch: pytest.MonkeyPatch) -> None:
    """asyncio.wait_for's TimeoutError never escapes the loop -- becomes an is_error result."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn._TOOL_EXECUTION_TIMEOUT_SECONDS", 0.01)
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"__sleep__": 1}'),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Timed out, sorry."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "completed"
    messages: FakeChatMessageRepository = fakes["messages"]
    result_part = next(p for p in messages.messages[-1].parts if p["type"] == "tool_invocation_result")
    assert result_part["isError"] is True


# ---------------------------------------------------------------------------
# T-34-01: breaker re-checked at the round boundary
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_breaker_rechecked_at_round_boundary_cost_caps_before_next_round() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # No TextDelta/UsageDelta in round 1 -- should_abort is NEVER
            # called mid-stream, isolating the round-BOUNDARY re-check.
            [ToolCallDelta(tool_name="echo", id="tool-1", partial_json="{}"), StreamEnd(stop_reason="tool_use")],
            [TextDelta(text="never reached"), StreamEnd(stop_reason="end_turn")],
        ]
    )
    # abort_after=0: the FIRST should_abort() call (the post-round re-check)
    # already returns True -- round 2 must never start.
    breaker = FakeCostCircuitBreaker(abort_after=0)
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()}, breaker=breaker)

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "cost_capped"
    assert breaker.should_abort_calls == 1, "should_abort must be called at the round boundary"
    assert len(provider.stream_calls) == 1, "round 2 must never start once the round-boundary breaker trips"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert assistant_messages[-1].status == "cost_capped"


# ---------------------------------------------------------------------------
# COST-05: DISTINCT per-round cost ceiling
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_round_scoped_cap_distinct_from_per_turn_cap_aborts_at_round_boundary() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # No TextDelta/UsageDelta in round 1 -- should_abort is NEVER
            # called mid-stream, isolating the round-BOUNDARY re-check.
            [ToolCallDelta(tool_name="echo", id="tool-1", partial_json="{}"), StreamEnd(stop_reason="tool_use")],
            [TextDelta(text="never reached"), StreamEnd(stop_reason="end_turn")],
        ]
    )
    # round_abort_after=0: the FIRST should_abort_round() call (the
    # post-round re-check) already returns True -- round 2 must never
    # start. abort_after stays at its default None, so the per-turn
    # should_abort() NEVER trips on its own -- proves the round-boundary
    # check is a SEPARATE gate from the per-turn one.
    breaker = FakeCostCircuitBreaker(round_abort_after=0)
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()}, breaker=breaker)

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "cost_capped"
    assert breaker.should_abort_round_calls == 1, "should_abort_round must be called at the round boundary"
    assert len(provider.stream_calls) == 1, "round 2 must never start once the round-boundary breaker trips"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert assistant_messages[-1].status == "cost_capped"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mid_round_text_cost_cap_aborts_with_visible_partial_text() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # Round 1: a tool call, no TextDelta/UsageDelta -- isolates the
            # round-1 boundary call (should_abort_round call #1).
            [ToolCallDelta(tool_name="echo", id="tool-1", partial_json="{}"), StreamEnd(stop_reason="tool_use")],
            # Round 2: two TextDeltas -- the FIRST one trips mid-round
            # (should_abort_round call #2); the second must never be seen.
            [
                TextDelta(text="partial round 2 text"),
                TextDelta(text="never reached"),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    # round_abort_after=1: round 1's single boundary call is call #1,
    # allowed (1 > 1 is False); round 2's FIRST TextDelta is call #2, trips
    # (2 > 1 is True).
    breaker = FakeCostCircuitBreaker(round_abort_after=1)
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()}, breaker=breaker)

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "cost_capped"

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    text_parts = [p for p in assistant_messages[-1].parts if p["type"] == "text"]
    assert text_parts[-1]["text"] == "partial round 2 text"
    assert all("never reached" not in p.get("text", "") for p in assistant_messages[-1].parts)

    assert breaker.should_abort_round_calls == 2
    assert len(provider.stream_calls) == 2, "round 2's OWN stream DID start (distinguishes this from the round-boundary test)"


# ---------------------------------------------------------------------------
# T-34-05: the round-loop capability gate — OpenRouter never enters a round
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_openrouter_model_never_offered_server_tool() -> None:
    provider = _MultiRoundFakeChatProvider(rounds=[[StreamEnd(stop_reason="end_turn")]])
    use_case, _fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_OPENROUTER_MODEL.id):
        pass

    call_kwargs = provider.stream_calls[0]
    tool_names = [t.get("name") for t in call_kwargs["tools"]]
    assert "echo" not in tool_names, "max_tool_rounds==0 must never offer a server tool"
    assert "emit_ui_spec" in tool_names, "genui-gated tools are UNAFFECTED by the max_tool_rounds gate"


# ---------------------------------------------------------------------------
# LOOP-03: round-cap exhaustion -> visible text, never a bare stopped state
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_round_cap_exhaustion_appends_visible_text_and_completes() -> None:
    # The model ALWAYS calls the echo tool, every single stream call, and
    # NEVER produces a terminal text turn -- drives the loop to exhaustion.
    always_tool_round = [
        ToolCallDelta(tool_name="echo", id="tool-x", partial_json="{}"),
        StreamEnd(stop_reason="tool_use"),
    ]
    provider = _MultiRoundFakeChatProvider(rounds=[always_tool_round])
    counting_executor = _CountingEchoToolExecutor()
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": counting_executor})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "completed", "exhaustion must finish 'completed', never a bare 'stopped'"
    assert "stopped" not in [e.type for e in events]

    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].status == "completed"
    last_part = assistant_messages[0].parts[-1]
    assert last_part == {"type": "text", "text": ROUND_CAP_EXHAUSTED_TEXT}, "exhaustion text must be the LAST part"

    assert counting_executor.call_count == 4, "at most _MAX_TOOL_ROUNDS (4) executor.execute() calls, never a 5th"

    runs: FakeChatRunRepository = fakes["runs"]
    assert len(runs.create_run_calls) == 1, "exhaustion still happens inside exactly ONE ChatRun"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_round_cap_exhaustion_bounded_even_with_asyncio_timeout_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sanity: the exhaustion bound holds even when the per-tool timeout is tiny (no interaction bug)."""
    monkeypatch.setattr("app.application.use_cases.run_chat_turn._TOOL_EXECUTION_TIMEOUT_SECONDS", 5.0)
    always_tool_round = [
        ToolCallDelta(tool_name="echo", id="tool-x", partial_json="{}"),
        StreamEnd(stop_reason="tool_use"),
    ]
    provider = _MultiRoundFakeChatProvider(rounds=[always_tool_round])
    counting_executor = _CountingEchoToolExecutor()
    use_case, _fakes = _make_use_case(provider=provider, tool_executors={"echo": counting_executor})

    async for _ in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id):
        pass

    assert counting_executor.call_count == 4
    assert len(provider.stream_calls) == 5, "4 executed rounds + 1 final check-only stream call that exhausts"


# ---------------------------------------------------------------------------
# Phase 39 (TUI-01): non-persisted server_tool_call/server_tool_result SSE
# mirror frames -- emitted at the SAME 2 dispatch points as the existing
# persisted tool_call/tool_result run events, never routed through
# append_event.
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_round_emits_non_persisted_sse_mirror_events() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            # Round 1: the model calls the echo tool.
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"q": "hi"}'),
                UsageDelta(input_tokens=10, output_tokens=20),
                StreamEnd(stop_reason="tool_use"),
            ],
            # Round 2: the model continues with plain text (SAME run).
            [
                TextDelta(text="Done!"),
                UsageDelta(input_tokens=5, output_tokens=3),
                StreamEnd(stop_reason="end_turn"),
            ],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event
        async for event in use_case.run(
            conversation_id=_CONVERSATION_ID, user_text="look something up", model_id=_TOOL_ROUND_MODEL.id
        )
    ]

    event_types = [e.type for e in events]

    # Behavior 1: "tool_call" (persisted) is followed later by "server_tool_call"
    # (mirror), whose data is exactly {"tool_name", "id"} -- arguments absent.
    tool_call_index = event_types.index("tool_call")
    server_tool_call_index = event_types.index("server_tool_call")
    assert server_tool_call_index > tool_call_index
    server_tool_call_event = events[server_tool_call_index]
    assert server_tool_call_event.data == {"tool_name": "echo", "id": "tool-1"}
    assert set(server_tool_call_event.data.keys()) == {"tool_name", "id"}

    # Behavior 2: "tool_result" (persisted) is followed later by
    # "server_tool_result" (mirror), whose data is a byte-identical mirror
    # of the persisted tool_result event's own data.
    tool_result_index = event_types.index("tool_result")
    server_tool_result_index = event_types.index("server_tool_result")
    assert server_tool_result_index > tool_result_index
    tool_result_event = events[tool_result_index]
    server_tool_result_event = events[server_tool_result_index]
    assert set(server_tool_result_event.data.keys()) == {"tool_name", "id", "content", "isError"}
    assert server_tool_result_event.data["content"] == tool_result_event.data["content"]
    assert server_tool_result_event.data["isError"] == tool_result_event.data["isError"]

    # Behavior 3: both new events are never persisted -- id/run_id/seq all None.
    for mirror_event in (server_tool_call_event, server_tool_result_event):
        assert mirror_event.id is None
        assert mirror_event.run_id is None
        assert mirror_event.seq is None

    # Behavior 4: the persisted-event log (populated only via append_event)
    # NEVER contains the 2 new mirror types -- the actual non-persistence
    # proof, stronger than Behavior 3 alone.
    runs: FakeChatRunRepository = fakes["runs"]
    persisted_event_types = {e.type for e in runs.events}
    assert "server_tool_call" not in persisted_event_types
    assert "server_tool_result" not in persisted_event_types
    assert "tool_call" in persisted_event_types
    assert "tool_result" in persisted_event_types


@pytest.mark.unit
@pytest.mark.asyncio
async def test_server_tool_error_round_mirror_event_matches_persisted_error_result() -> None:
    """The server_tool_result mirror also holds for an is_error result (T-34-01 error path)."""
    provider = _MultiRoundFakeChatProvider(
        rounds=[
            [
                ToolCallDelta(tool_name="echo", id="tool-1", partial_json='{"__force_error__": true}'),
                StreamEnd(stop_reason="tool_use"),
            ],
            [TextDelta(text="Sorry, that failed."), StreamEnd(stop_reason="end_turn")],
        ]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    server_tool_result_event = next(e for e in events if e.type == "server_tool_result")
    assert server_tool_result_event.data["isError"] is True
    assert server_tool_result_event.id is None
    assert server_tool_result_event.run_id is None
    assert server_tool_result_event.seq is None

    runs: FakeChatRunRepository = fakes["runs"]
    assert "server_tool_result" not in {e.type for e in runs.events}


# ---------------------------------------------------------------------------
# Regression guard: single-round text-only turns stay unaffected (LOOP-01)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_single_round_text_only_turn_unregressed_by_round_loop() -> None:
    provider = _MultiRoundFakeChatProvider(
        rounds=[[TextDelta(text="Hello!"), UsageDelta(input_tokens=4, output_tokens=2), StreamEnd(stop_reason="end_turn")]]
    )
    use_case, fakes = _make_use_case(provider=provider, tool_executors={"echo": EchoToolExecutor()})

    events = [
        event async for event in use_case.run(conversation_id=_CONVERSATION_ID, user_text="hi", model_id=_TOOL_ROUND_MODEL.id)
    ]

    assert events[-1].type == "completed"
    assert len(provider.stream_calls) == 1, "a plain text turn must never enter a second round"
    runs: FakeChatRunRepository = fakes["runs"]
    assert len(runs.create_run_calls) == 1
    messages: FakeChatMessageRepository = fakes["messages"]
    assistant_messages = [m for m in messages.messages if m.role == "assistant"]
    assert assistant_messages[0].parts == ({"type": "text", "text": "Hello!"},)
