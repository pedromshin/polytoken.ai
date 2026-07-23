"""Enforced-contract regression suite: the FastAPI chat SSE surface (stream /
regenerate / widget submit) requires per-user conversation ownership (Phase
44 Plan 09, TENA-03 gap closure).

Renamed from test_chat_widget_submit_known_gap.py — that file locked in the
CURRENT (insecure) behavior as `xfail(strict=True)`; Plan 44-09 closes the
gap discovered at Plan 44-08's sweep. All four regressions below now assert
the DESIRED secure contract directly and pass unconditionally — zero
`xfail` markers remain in this module.

The Next.js BFF forwards a server-verified `X-User-Id` on every one of these
three routes (apps/web/src/app/api/chat/{stream,regenerate}/route.ts +
chat/widget/submit/route.ts, all via `supabase.auth.getUser()`). All three
FastAPI endpoints now read that header (`Depends(require_user_id)`) and
verify the caller owns `conversation_id` (`assert_conversation_owned`,
chat_stream.py) BEFORE any StreamingResponse is constructed:

  - POST /v1/chat/stream / POST /v1/chat/regenerate: gated directly in
    chat_stream.py.
  - POST /v1/chat/widget/submit: gated in chat_widget.py, PLUS the
    `confirm_action` dispatch path now threads the caller's `user_id` all
    the way into `PromoteEdgeUseCase.execute(user_id=...)` so a promotion
    under an edge the caller does not own is rejected by the 44-03
    `tenant_mismatch` guard (proven directly by
    `test_confirm_action_promotion_forwards_caller_user_id` below).

Every enforced test below proves either: (a) no X-User-Id -> 401 before the
use case is ever reached, (b) X-User-Id for a non-owning caller -> 404
(fail-closed, no existence oracle, mirrors emails.py's
`_assert_importer_owned`), or (c) X-User-Id for the actual owner -> the
request proceeds (200/streams) as a positive control proving the gate
doesn't false-positive-reject legitimate callers.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any
from unittest.mock import AsyncMock

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.confirm_action_dispatch import KnowledgeEdgeTierPromotionHandler
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.domain.ports.chat_repositories import ChatConversationRepository, ChatRunEvent
from app.domain.ports.importer_resolver import ImporterResolver
from app.presentation.api.v1.chat_stream import router as chat_stream_router
from app.presentation.api.v1.chat_widget import router as chat_widget_router
from app.presentation.middleware.user_context import USER_ID_HEADER

_CONVERSATION_ID = "11111111-1111-1111-1111-111111111111"
_INTERACTION_ID = "22222222-2222-2222-2222-222222222222"
_ASSISTANT_MESSAGE_ID = "33333333-3333-3333-3333-333333333333"
_OWNER_USER_ID = "user-owner"
_ATTACKER_USER_ID = "user-attacker"


class _FakeChatConversationRepository:
    """A ChatConversationRepository test double with a fixed, configurable owner."""

    def __init__(self, owner_user_id: str | None = _OWNER_USER_ID) -> None:
        self._owner_user_id = owner_user_id

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        return None

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner_user_id


class _FakeSubmitWidgetInteraction:
    """Always succeeds -- proves the endpoint reaches prepare() for the owner."""

    def __init__(self) -> None:
        self.prepare_calls: list[dict[str, Any]] = []

    async def prepare(
        self,
        *,
        conversation_id: str,
        interaction_id: str,
        result: dict[str, Any],
        model_id: str,
        user_id: str | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        self.prepare_calls.append(
            {
                "conversation_id": conversation_id,
                "interaction_id": interaction_id,
                "model_id": model_id,
                "user_id": user_id,
            }
        )
        return self._stream()

    async def _stream(self) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


def _make_widget_submit_client(
    use_case: _FakeSubmitWidgetInteraction | None = None,
    conversations: _FakeChatConversationRepository | None = None,
) -> TestClient:
    resolved_use_case = use_case if use_case is not None else _FakeSubmitWidgetInteraction()
    resolved_conversations = conversations if conversations is not None else _FakeChatConversationRepository()
    app = FastAPI()
    app.include_router(chat_widget_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: resolved_use_case, provides=SubmitWidgetInteraction, scope=Scope.APP)
    provider.provide(lambda: resolved_conversations, provides=ChatConversationRepository, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture
def client() -> TestClient:
    return _make_widget_submit_client()


def _body() -> dict[str, Any]:
    return {
        "conversation_id": _CONVERSATION_ID,
        "interaction_id": _INTERACTION_ID,
        "model_id": "m1",
        "result": {"optionId": "opt-0"},
    }


@pytest.mark.unit
def test_submit_widget_requires_x_user_id_like_every_other_user_scoped_endpoint(client: TestClient) -> None:
    """ENFORCED: a request with no X-User-Id 401s before touching prepare()."""
    resp = client.post("/v1/chat/widget/submit", json=_body())

    assert resp.status_code == 401


@pytest.mark.unit
def test_submit_widget_rejects_a_conversation_the_caller_does_not_own(client: TestClient) -> None:
    """ENFORCED: a non-owning caller is rejected 404 pre-stream, fail-closed."""
    resp = client.post(
        "/v1/chat/widget/submit",
        headers={USER_ID_HEADER: _ATTACKER_USER_ID},
        json=_body(),
    )

    assert resp.status_code == 404


@pytest.mark.unit
def test_submit_widget_reaches_prepare_for_the_owner() -> None:
    """Positive control: the actual owner reaches prepare() and streams
    successfully; user_id is threaded through to prepare()."""
    use_case = _FakeSubmitWidgetInteraction()
    client = _make_widget_submit_client(use_case=use_case)

    resp = client.post(
        "/v1/chat/widget/submit",
        headers={USER_ID_HEADER: _OWNER_USER_ID},
        json=_body(),
    )

    assert resp.status_code == 200
    assert use_case.prepare_calls == [
        {
            "conversation_id": _CONVERSATION_ID,
            "interaction_id": _INTERACTION_ID,
            "model_id": "m1",
            "user_id": _OWNER_USER_ID,
        }
    ]


# ---------------------------------------------------------------------------
# confirm_action dispatch -- proves user_id reaches PromoteEdgeUseCase.execute
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_confirm_action_promotion_forwards_caller_user_id() -> None:
    """KnowledgeEdgeTierPromotionHandler.execute forwards user_id into
    PromoteEdgeUseCase.execute -- this is the exact call site the 44-08 sweep
    flagged as a permanent no-op; Plan 44-09 activates it end-to-end."""
    promote_edge = AsyncMock()
    promote_edge.execute.return_value = {"edge_id": "edge-1", "tier": "EXTRACTED"}
    handler = KnowledgeEdgeTierPromotionHandler(promote_edge=promote_edge)

    await handler.execute(
        action="confirm",
        suggestion_id="edge-1",
        importer_id="importer-1",
        widget_interaction_id="interaction-1",
        user_id=_OWNER_USER_ID,
    )

    promote_edge.execute.assert_awaited_once_with(
        edge_id="edge-1",
        importer_id="importer-1",
        user_id=_OWNER_USER_ID,
        mechanism="chat_confirm_action",
        extra={"widget_interaction_id": "interaction-1"},
    )


# ---------------------------------------------------------------------------
# POST /v1/chat/stream + POST /v1/chat/regenerate -- ENFORCED.
# ---------------------------------------------------------------------------


class _FakeRunChatTurn:
    """Always succeeds -- proves both endpoints reach the use case for the owner.

    Records `importer_ids` on both entrypoints (chat-context fix): the
    endpoints must resolve the caller's OWNED importer set from the verified
    user_id and pass it through -- otherwise RunChatTurn falls back to the
    default importer and the context email reads silently return [].
    """

    def __init__(self) -> None:
        self.run_calls: list[dict[str, Any]] = []
        self.regenerate_calls: list[dict[str, Any]] = []

    async def run(
        self,
        *,
        conversation_id: str,
        user_text: str,
        model_id: str,
        importer_ids: Sequence[str] | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        self.run_calls.append({"conversation_id": conversation_id, "importer_ids": importer_ids})
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)

    async def regenerate(
        self,
        *,
        conversation_id: str,
        assistant_message_id: str,
        model_id: str,
        importer_ids: Sequence[str] | None = None,
    ) -> AsyncIterator[ChatRunEvent]:
        self.regenerate_calls.append({"conversation_id": conversation_id, "importer_ids": importer_ids})
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


_OWNED_IMPORTER_IDS = ["importer-owned-1", "importer-owned-2"]


class _FakeImporterResolver:
    """Owned-importer-set resolver double (chat-context fix)."""

    def __init__(self, importer_ids: list[str] | None = None) -> None:
        self._importer_ids = _OWNED_IMPORTER_IDS if importer_ids is None else importer_ids
        self.list_calls: list[str] = []

    async def resolve(self, sender_address: str, *, user_id: str | None = None) -> str:
        raise AssertionError("resolve() must never be called by the chat SSE endpoints")

    async def list_importer_ids_for_user(self, user_id: str) -> list[str]:
        self.list_calls.append(user_id)
        return list(self._importer_ids)


def _make_chat_stream_client(
    conversations: _FakeChatConversationRepository | None = None,
    use_case: _FakeRunChatTurn | None = None,
) -> TestClient:
    resolved_use_case = use_case if use_case is not None else _FakeRunChatTurn()
    resolved_conversations = conversations if conversations is not None else _FakeChatConversationRepository()
    importer_resolver = _FakeImporterResolver()
    app = FastAPI()
    app.include_router(chat_stream_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: resolved_use_case, provides=RunChatTurn, scope=Scope.APP)
    provider.provide(lambda: resolved_conversations, provides=ChatConversationRepository, scope=Scope.APP)
    provider.provide(lambda: importer_resolver, provides=ImporterResolver, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture
def stream_client() -> TestClient:
    return _make_chat_stream_client()


@pytest.mark.unit
def test_chat_stream_requires_x_user_id_like_every_other_user_scoped_endpoint(stream_client: TestClient) -> None:
    """ENFORCED: a request with no X-User-Id 401s before touching RunChatTurn.run()."""
    resp = stream_client.post(
        "/v1/chat/stream",
        json={"conversation_id": _CONVERSATION_ID, "user_text": "hi", "model_id": "m1"},
    )

    assert resp.status_code == 401


@pytest.mark.unit
def test_chat_stream_rejects_a_conversation_the_caller_does_not_own(stream_client: TestClient) -> None:
    """ENFORCED: cross-tenant probe (attacker != owner) is rejected 404, pre-stream."""
    resp = stream_client.post(
        "/v1/chat/stream",
        headers={USER_ID_HEADER: _ATTACKER_USER_ID},
        json={"conversation_id": _CONVERSATION_ID, "user_text": "hi", "model_id": "m1"},
    )

    assert resp.status_code == 404
    assert not resp.headers.get("content-type", "").startswith("text/event-stream")


@pytest.mark.unit
def test_chat_stream_reaches_run_for_the_owner() -> None:
    """Positive control: the actual owner streams successfully."""
    client = _make_chat_stream_client()

    resp = client.post(
        "/v1/chat/stream",
        headers={USER_ID_HEADER: _OWNER_USER_ID},
        json={"conversation_id": _CONVERSATION_ID, "user_text": "hi", "model_id": "m1"},
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")


@pytest.mark.unit
def test_chat_regenerate_requires_x_user_id_like_every_other_user_scoped_endpoint(stream_client: TestClient) -> None:
    """ENFORCED: same as /v1/chat/stream -- see module docstring."""
    resp = stream_client.post(
        "/v1/chat/regenerate",
        json={
            "conversation_id": _CONVERSATION_ID,
            "assistant_message_id": _ASSISTANT_MESSAGE_ID,
            "model_id": "m1",
        },
    )

    assert resp.status_code == 401


@pytest.mark.unit
def test_chat_regenerate_rejects_a_conversation_the_caller_does_not_own(stream_client: TestClient) -> None:
    """ENFORCED: cross-tenant probe is rejected 404, pre-stream."""
    resp = stream_client.post(
        "/v1/chat/regenerate",
        headers={USER_ID_HEADER: _ATTACKER_USER_ID},
        json={
            "conversation_id": _CONVERSATION_ID,
            "assistant_message_id": _ASSISTANT_MESSAGE_ID,
            "model_id": "m1",
        },
    )

    assert resp.status_code == 404


@pytest.mark.unit
def test_chat_regenerate_reaches_regenerate_for_the_owner() -> None:
    """Positive control: the actual owner regenerates successfully."""
    client = _make_chat_stream_client()

    resp = client.post(
        "/v1/chat/regenerate",
        headers={USER_ID_HEADER: _OWNER_USER_ID},
        json={
            "conversation_id": _CONVERSATION_ID,
            "assistant_message_id": _ASSISTANT_MESSAGE_ID,
            "model_id": "m1",
        },
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
