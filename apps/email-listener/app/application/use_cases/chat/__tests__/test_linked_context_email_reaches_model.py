"""Regression guard: email context reaches the model in chat (Task 6, chat-context fix).

This pins the exact contract the production "chat-context fix" depends on and that had
NO test before: real emails live under per-(user, sender-domain) importers, so a linked
`email_thread` context edge must be resolved via the caller's OWNED importer set
(`list_by_thread_id_for_importers`). Without that scoping the read falls back to the
DEFAULT importer, silently returns [], and the LINKED CONTEXT block is dropped — i.e.
the email context never reaches the model. These tests fail if that wiring regresses.

Seam under test: `system_prompt_with_linked_context` (application pipeline) →
`_resolve_email_thread_ref` → `EmailRepository.list_by_thread_id_for_importers`.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

import pytest

from app.application.use_cases.chat.linked_context import system_prompt_with_linked_context
from app.domain.entities.email import Email
from app.domain.ports.chat_context_edge_repository import ContextEdge
from app.domain.ports.chat_repositories import ChatMessageRepository
from app.domain.ports.email_repository import EmailRepository

_BASE_PROMPT = "You are a helpful assistant."
_THREAD_ID = "11111111-1111-1111-1111-111111111111"
_CONVERSATION_ID = "22222222-2222-2222-2222-222222222222"
_OWNED_IMPORTERS = ("imp-user-gmail", "imp-user-work")


def _email(subject: str, body: str) -> Email:
    return Email(
        id="e1",
        importer_id="imp-user-gmail",
        message_id="<m1@example.com>",
        in_reply_to=None,
        references_ids=(),
        received_at=datetime(2026, 7, 24, 12, 0, 0, tzinfo=UTC),
        sender_address="alice@example.com",
        sender_name="Alice",
        to_addresses=("me@example.com",),
        cc_addresses=(),
        subject=subject,
        body_html=None,
        body_text=body,
        raw_storage_key=None,
        parse_status="parsed",
        parse_error=None,
        parsed_at=None,
        created_at=datetime(2026, 7, 24, 12, 0, 0, tzinfo=UTC),
        thread_id=_THREAD_ID,
    )


class _EdgeRepo:
    """Returns one active email_thread edge targeting the conversation."""

    def __init__(self, edges: Sequence[ContextEdge]) -> None:
        self._edges = edges

    async def list_active_context_edges(self, conversation_id: str) -> Sequence[ContextEdge]:
        assert conversation_id == _CONVERSATION_ID
        return self._edges


class _MessagesStub:
    """Never exercised on the email_thread path — present only to satisfy the signature."""

    async def get_by_id(self, message_id: str):  # pragma: no cover - defensive
        return None


class _EmailRepo:
    """Records which read path was taken.

    Models the real world: emails live under the OWNED importers, so the
    default-importer read returns [] while the owned-importers read finds them.
    """

    def __init__(self, emails: list[Email]) -> None:
        self._emails = emails
        self.for_importers_calls: list[dict[str, object]] = []
        self.single_importer_calls: list[dict[str, object]] = []

    async def list_by_thread_id_for_importers(
        self, *, importer_ids: Sequence[str], thread_id: str, limit: int, offset: int = 0
    ) -> list[Email]:
        self.for_importers_calls.append({"importer_ids": list(importer_ids), "thread_id": thread_id, "limit": limit})
        return list(self._emails)

    async def list_by_thread_id(self, *, importer_id: str, thread_id: str, limit: int, offset: int = 0) -> list[Email]:
        # Default-importer read: real emails are NOT under this importer -> [].
        self.single_importer_calls.append({"importer_id": importer_id, "thread_id": thread_id, "limit": limit})
        return []


def _email_thread_edge() -> ContextEdge:
    return ContextEdge(
        id="edge-1",
        target_conversation_id=_CONVERSATION_ID,
        source_ref={"type": "email_thread", "threadId": _THREAD_ID},
        source_ref_key=f"email_thread:{_THREAD_ID}",
        is_active=True,
    )


async def _run(email_repo: _EmailRepo, *, importer_ids: Sequence[str] | None) -> str:
    return await system_prompt_with_linked_context(
        base_system_prompt=_BASE_PROMPT,
        conversation_id=_CONVERSATION_ID,
        importer_id="imp-default",
        importer_ids=importer_ids,
        context_edges=_EdgeRepo([_email_thread_edge()]),
        source_ledger=None,
        knowledge_graph=None,
        # Deliberately partial test doubles — cast to the ports they stand in for
        # (only the email_thread read path is exercised, see the stub docstrings).
        messages=cast("ChatMessageRepository", _MessagesStub()),
        email_repository=cast("EmailRepository", email_repo),
    )


@pytest.mark.asyncio
async def test_owned_importers_deliver_email_context_to_the_model() -> None:
    """WITH the owned importer_ids, the linked email context is appended to the prompt."""
    repo = _EmailRepo([_email("Q3 planning", "Let us finalize the roadmap.")])

    prompt = await _run(repo, importer_ids=_OWNED_IMPORTERS)

    # The owned-importers read is the one taken; the default-importer read is not.
    assert len(repo.for_importers_calls) == 1
    assert repo.for_importers_calls[0]["importer_ids"] == list(_OWNED_IMPORTERS)
    assert repo.for_importers_calls[0]["thread_id"] == _THREAD_ID
    assert repo.single_importer_calls == []

    # Email context actually reaches the model: the prompt grew and carries the content.
    assert prompt != _BASE_PROMPT
    assert prompt.startswith(_BASE_PROMPT)
    assert "LINKED CONTEXT" in prompt
    assert "Q3 planning" in prompt
    assert "Let us finalize the roadmap." in prompt


@pytest.mark.asyncio
async def test_without_owned_importers_default_read_drops_context_the_bug() -> None:
    """Documents the original bug: no importer_ids -> default read -> [] -> context dropped.

    This is exactly why chat_stream.py resolves and forwards owned importer_ids. If a
    future change stops threading them, the prompt silently loses email context — this
    test makes that regression visible.
    """
    repo = _EmailRepo([_email("Q3 planning", "Let us finalize the roadmap.")])

    prompt = await _run(repo, importer_ids=None)

    assert len(repo.single_importer_calls) == 1
    assert repo.single_importer_calls[0]["importer_id"] == "imp-default"
    assert repo.for_importers_calls == []
    # Real emails are not under the default importer -> block dropped, prompt unchanged.
    assert prompt == _BASE_PROMPT


@pytest.mark.asyncio
async def test_no_edges_leaves_base_prompt_byte_identical() -> None:
    """Fail-open sanity: a conversation with no active edges never touches email reads."""
    repo = _EmailRepo([_email("unused", "unused")])

    prompt = await system_prompt_with_linked_context(
        base_system_prompt=_BASE_PROMPT,
        conversation_id=_CONVERSATION_ID,
        importer_id="imp-default",
        importer_ids=_OWNED_IMPORTERS,
        context_edges=_EdgeRepo([]),
        source_ledger=None,
        knowledge_graph=None,
        messages=cast("ChatMessageRepository", _MessagesStub()),
        email_repository=cast("EmailRepository", repo),
    )

    assert prompt == _BASE_PROMPT
    assert repo.for_importers_calls == []
    assert repo.single_importer_calls == []
