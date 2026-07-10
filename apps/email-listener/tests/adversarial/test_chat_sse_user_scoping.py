"""Enforced-contract regression suite: the FastAPI chat SSE surface (stream /
regenerate / widget submit) requires per-user conversation ownership (Phase
44 Plan 09, TENA-03 gap closure).

Renamed from test_chat_widget_submit_known_gap.py — that file locked in the
CURRENT (insecure) behavior as `xfail(strict=True)`; Plan 44-09 closes the
gap discovered at Plan 44-08's sweep. The stream/regenerate half below now
asserts the DESIRED secure contract directly and passes unconditionally
(Task 1). The widget-submit half still carries `xfail(strict=True)` pending
Task 2, which threads `require_user_id` + `assert_conversation_owned` into
`chat_widget.py` and the caller's `user_id` through the confirm_action
dispatch chain into `PromoteEdgeUseCase.execute`.

The Next.js BFF forwards a server-verified `X-User-Id` on every one of these
three routes (apps/web/src/app/api/chat/{stream,regenerate}/route.ts +
chat/widget/submit/route.ts, all via `supabase.auth.getUser()`). The two
stream endpoints now read that header (`Depends(require_user_id)`) and
verify the caller owns `conversation_id` (`assert_conversation_owned`,
chat_stream.py) BEFORE any StreamingResponse is constructed.

Every enforced test below proves either: (a) no X-User-Id -> 401 before the
use case is ever reached, (b) X-User-Id for a non-owning caller -> 404
(fail-closed, no existence oracle, mirrors emails.py's
`_assert_importer_owned`), or (c) X-User-Id for the actual owner -> the
request proceeds (200/streams) as a positive control proving the gate
doesn't false-positive-reject legitimate callers.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.domain.ports.chat_repositories import ChatConversationRepository, ChatRunEvent
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
    """Always succeeds -- proves the endpoint reaches prepare() regardless of caller identity."""

    def __init__(self) -> None:
        self.prepare_calls: list[dict[str, Any]] = []

    async def prepare(
        self, *, conversation_id: str, interaction_id: str, result: dict[str, Any], model_id: str
    ) -> AsyncIterator[ChatRunEvent]:
        self.prepare_calls.append(
            {"conversation_id": conversation_id, "interaction_id": interaction_id, "model_id": model_id}
        )
        return self._stream()

    async def _stream(self) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


def _make_widget_submit_client() -> TestClient:
    use_case = _FakeSubmitWidgetInteraction()
    app = FastAPI()
    app.include_router(chat_widget_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=SubmitWidgetInteraction, scope=Scope.APP)
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
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 gap (44-SWEEP-INVENTORY.md): POST /v1/chat/widget/submit has no require_user_id gate (Task 2)",
)
def test_submit_widget_requires_x_user_id_like_every_other_user_scoped_endpoint(client: TestClient) -> None:
    """DESIRED contract (matches emails.py / knowledge_edges.py promote / the
    attachments route): a request with no X-User-Id must 401 before touching
    SubmitWidgetInteraction.prepare(). Not yet closed -- see module docstring."""
    resp = client.post("/v1/chat/widget/submit", json=_body())

    assert resp.status_code == 401


@pytest.mark.unit
@pytest.mark.xfail(
    strict=True,
    reason="TENA-03 gap (44-SWEEP-INVENTORY.md): submit_widget never verifies the caller owns conversation_id (Task 2)",
)
def test_submit_widget_rejects_a_conversation_the_caller_does_not_own(client: TestClient) -> None:
    """DESIRED contract: an authenticated caller supplying X-User-Id for a
    conversation they do not own must be rejected before dispatch. Not yet
    closed -- see module docstring for the full exploit path."""
    resp = client.post(
        "/v1/chat/widget/submit",
        headers={USER_ID_HEADER: _ATTACKER_USER_ID},
        json=_body(),
    )

    assert resp.status_code in (401, 403, 404)


# ---------------------------------------------------------------------------
# POST /v1/chat/stream + POST /v1/chat/regenerate -- ENFORCED (Task 1).
# ---------------------------------------------------------------------------


class _FakeRunChatTurn:
    """Always succeeds -- proves both endpoints reach the use case for the owner."""

    async def run(self, *, conversation_id: str, user_text: str, model_id: str) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)

    async def regenerate(
        self, *, conversation_id: str, assistant_message_id: str, model_id: str
    ) -> AsyncIterator[ChatRunEvent]:
        yield ChatRunEvent(type="completed", data={}, id="e1", run_id="r1", seq=0)


def _make_chat_stream_client(conversations: _FakeChatConversationRepository | None = None) -> TestClient:
    use_case = _FakeRunChatTurn()
    resolved_conversations = conversations if conversations is not None else _FakeChatConversationRepository()
    app = FastAPI()
    app.include_router(chat_stream_router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=RunChatTurn, scope=Scope.APP)
    provider.provide(lambda: resolved_conversations, provides=ChatConversationRepository, scope=Scope.APP)
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
