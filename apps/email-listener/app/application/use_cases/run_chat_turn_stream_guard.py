"""Mid-stream terminal/cost guard + the one-round delta pump (carved from run_chat_turn.py, W7-1).

Owns the per-delta terminal decision (D-19 failed / D-21 mid-stream
cost_capped + the COST-05 round-scoped ceiling), the two running-cost
ESTIMATE heuristics those checks share, the `_MidStreamTerminalError`
control-flow signal, and `_stream_round_deltas` — the async generator that
pumps ONE round's provider deltas into `_apply_delta` and raises the signal
the instant a terminal status is flagged. Moved VERBATIM out of RunChatTurn —
the instance collaborators (`self._breaker`, `self._runs` via `self._emit`,
`self._server_tool_names`, `self._max_output_tokens`) became explicit
keyword parameters, nothing else changed.

Architecture contract (lint-imports): imports only domain ports/services and
standard library — same as the facade.
"""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Any, cast

from app.application.use_cases.chat.turn_state import (
    _accumulated_text_for_estimate,
    _apply_delta,
    _TurnState,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
from app.domain.services.cost_circuit_breaker import estimate_prompt_tokens

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator
    from decimal import Decimal

    from app.domain.ports.chat_provider import ChatDelta, ChatProvider
    from app.domain.ports.chat_repositories import (
        ChatMessageStatus,
        ChatRun,
        ChatRunEvent,
        ChatRunRepository,
    )
    from app.domain.services.chat_model_registry import ChatModel
    from app.domain.services.cost_circuit_breaker import CostCircuitBreaker


class _MidStreamTerminalError(Exception):
    """Internal control-flow signal (Phase 34-03) — never escapes `_execute_turn`.

    Raised by `_stream_round_deltas` the instant `_terminal_status_for` flags
    a status (StreamEnd error / mid-stream cost_capped) — the caller catches
    it to persist the partial + terminate via `_terminate` (D-15/D-19/D-21:
    the accumulated state at the moment of the terminal is never dropped).
    """

    def __init__(self, status: ChatMessageStatus, state: _TurnState) -> None:
        super().__init__(status)
        self.status = status
        self.state = state


def _estimated_cost_so_far(*, breaker: CostCircuitBreaker, model: ChatModel, state: _TurnState) -> Decimal:
    """Cheap running-cost ESTIMATE from accumulated output length (mid-stream abort signal).

    Real cost is always recorded post-turn from actual captured usage
    (D-22); this heuristic exists solely to decide whether to keep
    streaming, mirroring the pre-turn estimate's own heuristic contract.
    """
    tokens_so_far = estimate_prompt_tokens(len(_accumulated_text_for_estimate(state)))
    return breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)


def _estimated_round_cost_so_far(
    *,
    breaker: CostCircuitBreaker,
    model: ChatModel,
    state: _TurnState,
    round_start_output_tokens: int,
    round_start_text_len: int,
) -> Decimal:
    """COST-05 round-scoped cost ESTIMATE, scoped to output produced SINCE the round began.

    Mirrors `_estimated_cost_so_far`'s heuristic exactly, but diffs
    against the round's own baseline instead of the whole turn — takes
    the LARGER of the mid-stream text-length estimate and the real
    per-round token delta, whichever is available at the call site.
    """
    text_len_delta = max(0, len(_accumulated_text_for_estimate(state)) - round_start_text_len)
    token_delta = max(0, state.output_tokens - round_start_output_tokens)
    tokens_so_far = max(estimate_prompt_tokens(text_len_delta), token_delta)
    return breaker.estimate_turn_cost(model=model, prompt_tokens_est=0, max_output_tokens=tokens_so_far)


def _terminal_status_for(
    delta: ChatDelta,
    *,
    breaker: CostCircuitBreaker,
    model: ChatModel,
    state: _TurnState,
    round_start_output_tokens: int,
    round_start_text_len: int,
) -> ChatMessageStatus | None:
    """Return the terminal status this delta forces, or None to keep streaming.

    A StreamEnd(error) always fails the turn (D-19). A TextDelta/UsageDelta
    that pushes the (estimated, then real) running cost past should_abort's
    threshold cost-caps the turn mid-stream (D-21). Once the per-turn
    check clears, the SAME delta is also checked against the COST-05
    round-scoped cap (`should_abort_round`) — either trip cost-caps the
    turn, mid-round, before the round's own streaming even finishes.
    """
    if isinstance(delta, StreamEnd) and delta.stop_reason == "error":
        return "failed"
    if isinstance(delta, TextDelta):
        estimated_cost = _estimated_cost_so_far(breaker=breaker, model=model, state=state)
        if breaker.should_abort(estimated_cost):
            return "cost_capped"
        round_cost = _estimated_round_cost_so_far(
            breaker=breaker,
            model=model,
            state=state,
            round_start_output_tokens=round_start_output_tokens,
            round_start_text_len=round_start_text_len,
        )
        if breaker.should_abort_round(round_cost):
            return "cost_capped"
    elif isinstance(delta, UsageDelta):
        real_cost = breaker.estimate_turn_cost(
            model=model, prompt_tokens_est=state.input_tokens, max_output_tokens=state.output_tokens
        )
        if breaker.should_abort(real_cost):
            return "cost_capped"
        round_cost = _estimated_round_cost_so_far(
            breaker=breaker,
            model=model,
            state=state,
            round_start_output_tokens=round_start_output_tokens,
            round_start_text_len=round_start_text_len,
        )
        if breaker.should_abort_round(round_cost):
            return "cost_capped"
    return None


async def _stream_round_deltas(
    *,
    run: ChatRun,
    runs: ChatRunRepository,
    breaker: CostCircuitBreaker,
    provider: ChatProvider,
    model: ChatModel,
    model_id: str,
    provider_messages: list[dict[str, Any]],
    tools: tuple[dict[str, Any], ...],
    system_prompt: str,
    state: _TurnState,
    round_start_output_tokens: int,
    round_start_text_len: int,
    server_tool_names: tuple[str, ...],
    max_output_tokens: int,
) -> AsyncIterator[tuple[_TurnState, ChatRunEvent | None]]:
    """Stream ONE round's deltas, yielding (updated_state, event_or_none) pairs.

    Always yields at least once per delta processed — even when
    `_apply_delta` produces no run event (e.g. UsageDelta) — so the
    caller's `state` is never stale between yields. Raises
    `_MidStreamTerminalError` (never escapes `_execute_turn`) the instant
    `_terminal_status_for` flags a status; the caller persists + terminates.

    Phase 38 (QUAR-01, T-38-04): `system_prompt` is computed ONCE per turn
    by `_execute_turn` (`_system_prompt_for`) and passed down here instead
    of referencing the module constant `_SYSTEM_PROMPT` directly — it
    carries the tool-result hardening line only on a tool-round-eligible
    turn.
    """
    # Cast: ChatProvider.stream() is typed AsyncIterator[ChatDelta] on the Protocol
    # (deliberately loose so a future non-generator implementation stays valid),
    # but every real adapter (BedrockChatAdapter/OpenRouterChatAdapter) IS an
    # `async def ...: yield ...` generator — aclosing() needs the narrower
    # AsyncGenerator type to guarantee .aclose().
    raw_stream = cast(
        "AsyncGenerator[ChatDelta, None]",
        provider.stream(
            model_id=model_id,
            system=system_prompt,
            messages=provider_messages,
            tools=tools,
            max_tokens=max_output_tokens,
        ),
    )
    async with contextlib.aclosing(raw_stream) as delta_stream:
        async for delta in delta_stream:
            state, events = _apply_delta(delta, state, server_tool_names=server_tool_names)
            if events:
                for event_type, event_data in events:
                    yield state, await runs.append_event(run_id=run.id, event_type=event_type, data=event_data)
            else:
                yield state, None

            terminal_status = _terminal_status_for(
                delta,
                breaker=breaker,
                model=model,
                state=state,
                round_start_output_tokens=round_start_output_tokens,
                round_start_text_len=round_start_text_len,
            )
            if terminal_status is not None:
                raise _MidStreamTerminalError(terminal_status, state)
