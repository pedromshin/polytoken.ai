"""Tests for SupabaseChatWidgetInteractionRepository (Phase 24-01, D-11/D-12).

Covers: create_pending inserts state='pending'; get returns None when missing
(and faithfully returns a row from any conversation — ownership is enforced by
the caller, not the repo); try_submit's CAS UPDATE carries BOTH eq("id", ...)
and eq("state", "pending") (the double-submit lock predicate) and returns
False on a second call; is_stale is True when the emitting message is inactive
and when a strictly-newer turn exists, False otherwise.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.ports.chat_widget_interaction_repository import WidgetInteraction
from app.infrastructure.supabase.supabase_chat_widget_interaction_repository import (
    SupabaseChatWidgetInteractionRepository,
)

_DECLARATION: dict[str, Any] = {
    "prompt": "Pick one",
    "options": [{"id": "a", "title": "A", "value": {"choice": "a"}}],
}
_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"choice": {"type": "string"}},
    "required": ["choice"],
    "additionalProperties": False,
}


def _make_table(*, execute_data: Any = None, execute_sequence: list[Any] | None = None) -> MagicMock:
    """Chainable fluent-builder mock — every filter/select method returns itself.

    Pass either a single `execute_data` (repeated on every .execute() call) or
    an `execute_sequence` of return values consumed in order across multiple
    .execute() calls (needed for is_stale's two sequential queries).
    """
    table = MagicMock()
    table.insert.return_value = table
    table.select.return_value = table
    table.update.return_value = table
    table.eq.return_value = table
    table.gt.return_value = table
    table.order.return_value = table
    table.desc.return_value = table
    table.limit.return_value = table
    if execute_sequence is not None:
        table.execute.side_effect = [MagicMock(data=d) for d in execute_sequence]
    else:
        table.execute.return_value = MagicMock(data=execute_data)
    return table


def _make_client(tables: dict[str, MagicMock]) -> MagicMock:
    client = MagicMock()
    client.table.side_effect = lambda name: tables[name]
    return client


def _interaction_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": "int-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "part_index": 0,
        "turn_index": 2,
        "sibling_group_id": None,
        "widget_kind": "proposal_cards",
        "declaration": _DECLARATION,
        "declared_response_schema": _SCHEMA,
        "state": "pending",
        "submitted_value": None,
    }
    row.update(overrides)
    return row


def _interaction() -> WidgetInteraction:
    return WidgetInteraction(
        id="int-1",
        conversation_id="conv-1",
        message_id="msg-1",
        part_index=0,
        turn_index=2,
        widget_kind="proposal_cards",
        declaration=_DECLARATION,
        declared_response_schema=_SCHEMA,
        state="pending",
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_create_pending_inserts_row_with_pending_state() -> None:
    widget_table = _make_table(execute_data=[_interaction_row()])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    interaction = await repo.create_pending(
        conversation_id="conv-1",
        message_id="msg-1",
        part_index=0,
        turn_index=2,
        widget_kind="proposal_cards",
        declaration=_DECLARATION,
        declared_response_schema=_SCHEMA,
    )

    client.table.assert_any_call("chat_widget_interactions")
    inserted_row: dict[str, Any] = widget_table.insert.call_args.args[0]
    assert inserted_row["state"] == "pending"
    assert interaction.id == "int-1"
    assert interaction.state == "pending"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_returns_none_when_missing() -> None:
    widget_table = _make_table(execute_data=[])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.get("missing-id")

    assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_returns_row_from_any_conversation() -> None:
    widget_table = _make_table(execute_data=[_interaction_row(conversation_id="other-conv")])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.get("int-1")

    assert result is not None
    assert result.conversation_id == "other-conv"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_try_submit_cas_update_carries_id_and_pending_predicate() -> None:
    widget_table = _make_table(execute_data=[_interaction_row(state="submitted", submitted_value={"choice": "a"})])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.try_submit("int-1", {"choice": "a"})

    assert result is True
    update_payload: dict[str, Any] = widget_table.update.call_args.args[0]
    assert update_payload["state"] == "submitted"
    assert update_payload["submitted_value"] == {"choice": "a"}
    eq_calls = [call.args for call in widget_table.eq.call_args_list]
    assert ("id", "int-1") in eq_calls
    assert ("state", "pending") in eq_calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_try_submit_returns_false_on_zero_rows_matched() -> None:
    """Second submit of an already-submitted row: the eq("state","pending") predicate
    matches zero rows — the DB-level double-submit lock (D-11)."""
    widget_table = _make_table(execute_data=[])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.try_submit("int-1", {"choice": "a"})

    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_stale_true_when_emitting_message_inactive() -> None:
    messages_table = _make_table(execute_sequence=[[{"is_active": False}]])
    client = _make_client({"chat_messages": messages_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.is_stale(_interaction())

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_stale_true_when_newer_turn_exists() -> None:
    messages_table = _make_table(
        execute_sequence=[
            [{"is_active": True}],
            [{"id": "msg-2"}],
        ]
    )
    client = _make_client({"chat_messages": messages_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.is_stale(_interaction())

    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_is_stale_false_when_active_and_no_newer_turn() -> None:
    messages_table = _make_table(
        execute_sequence=[
            [{"is_active": True}],
            [],
        ]
    )
    client = _make_client({"chat_messages": messages_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    result = await repo.is_stale(_interaction())

    assert result is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_supersede_pending_updates_every_pending_row_in_conversation() -> None:
    """Phase 24-04 (D-02): the conditional UPDATE carries BOTH eq("conversation_id", ...) AND
    eq("state", "pending") — mirrors try_submit's own CAS idiom."""
    widget_table = _make_table(
        execute_data=[_interaction_row(state="superseded"), _interaction_row(id="int-2", state="superseded")]
    )
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    count = await repo.supersede_pending("conv-1")

    assert count == 2
    update_payload: dict[str, Any] = widget_table.update.call_args.args[0]
    assert update_payload["state"] == "superseded"
    eq_calls = [call.args for call in widget_table.eq.call_args_list]
    assert ("conversation_id", "conv-1") in eq_calls
    assert ("state", "pending") in eq_calls


@pytest.mark.unit
@pytest.mark.asyncio
async def test_supersede_pending_returns_zero_when_no_pending_rows() -> None:
    widget_table = _make_table(execute_data=[])
    client = _make_client({"chat_widget_interactions": widget_table})
    repo = SupabaseChatWidgetInteractionRepository(client=client)

    count = await repo.supersede_pending("conv-1")

    assert count == 0
