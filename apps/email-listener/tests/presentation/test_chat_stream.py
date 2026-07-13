"""Tests for POST /v1/chat/stream + POST /v1/chat/regenerate (Task 2 TDD RED).

Verifies:
- text/event-stream frames, one JSON event per `data:` line, ending after a terminal event
- request body validation (conversation_id/assistant_message_id must be UUIDs, user_text required)
- X-API-Key auth required (401 without a valid key when one is configured, no stream body)
- a simulated client disconnect cancels the underlying agent task (D-15/D-25/T-22-27
  stopped-partial path — exercised directly against the stream_run_events helper,
  since simulating a real mid-stream TCP disconnect through TestClient is not practical)

Phase 44-09 (TENA-03 gap closure): the shared TestClient carries a default
X-User-Id header matching the fake ChatConversationRepository's configured
owner, so every pre-existing streaming/validation/disconnect test below stays
green under the new require_user_id + assert_conversation_owned contract.
Cross-tenant/ownership-denial coverage lives in
tests/adversarial/test_chat_sse_user_scoping.py, not here.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.run_chat_turn import RunChatTurn
from app.domain.ports.chat_repositories import ChatConversationRepository, ChatRunEvent
from app.presentation.api.v1.chat_stream import stream_run_events
from app.presentation.middleware.user_context import USER_ID_HEADER

_VALID_UUID_1 = "11111111-1111-1111-1111-111111111111"
_VALID_UUID_2 = "22222222-2222-2222-2222-222222222222"
_TEST_USER_ID = "user-owner"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeRunChatTurn:
    """A RunChatTurn test double streaming a pre-configured sequence of events."""

    def __init__(self, events: list[ChatRunEvent]) -> None:
        self._events = events
        self.run_calls: list[dict[str, Any]] = []
        self.regenerate_calls: list[dict[str, Any]] = []

    async def run(self, *, conversation_id: str, user_text: str, model_id: str) -> AsyncIterator[ChatRunEvent]:
        self.run_calls.append({"conversation_id": conversation_id, "user_text": user_text, "model_id": model_id})
        for event in self._events:
            yield event

    async def regenerate(
        self, *, conversation_id: str, assistant_message_id: str, model_id: str
    ) -> AsyncIterator[ChatRunEvent]:
        self.regenerate_calls.append(
            {"conversation_id": conversation_id, "assistant_message_id": assistant_message_id, "model_id": model_id}
        )
        for event in self._events:
            yield event


class _HangingAgent:
    """An agent whose run() yields once, then hangs until cancelled (disconnect simulation)."""

    def __init__(self) -> None:
        self.cancelled = False

    async def run(self) -> AsyncIterator[ChatRunEvent]:
        try:
            yield ChatRunEvent(type="started", data={}, id="evt-1", run_id="run-1", seq=0)
            await asyncio.Event().wait()
            yield ChatRunEvent(type="completed", data={}, id="evt-2", run_id="run-1", seq=1)  # pragma: no cover
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class _FakeRequest:
    """A Request test double whose is_disconnected() reports disconnected after N checks."""

    def __init__(self, disconnect_after: int = 0) -> None:
        self._calls = 0
        self._disconnect_after = disconnect_after

    async def is_disconnected(self) -> bool:
        self._calls += 1
        return self._calls > self._disconnect_after


class _FakeChatConversationRepository:
    """A ChatConversationRepository test double with a configurable owner (Phase 44-09).

    Defaults to owning every conversation_id as `_TEST_USER_ID` — matches the
    shared client's default X-User-Id header, so pre-existing tests exercise
    the positive-control (owner) path without needing to know about ownership.
    """

    def __init__(self, owner_user_id: str | None = _TEST_USER_ID) -> None:
        self._owner_user_id = owner_user_id

    async def touch(self, *, conversation_id: str, model_id: str, title: str | None = None) -> None:
        return None

    async def owner_user_id(self, conversation_id: str) -> str | None:
        return self._owner_user_id


def _sample_events() -> list[ChatRunEvent]:
    return [
        ChatRunEvent(type="started", data={"model_id": "m1"}, id="e1", run_id="r1", seq=0),
        ChatRunEvent(type="text_delta_checkpoint", data={"text": "Hi"}, id="e2", run_id="r1", seq=1),
        ChatRunEvent(type="usage", data={"input_tokens": 1, "output_tokens": 1}, id="e3", run_id="r1", seq=2),
        ChatRunEvent(type="completed", data={}, id="e4", run_id="r1", seq=3),
    ]


def _make_app_with_fake_agent(
    agent: _FakeRunChatTurn, conversations: ChatConversationRepository | None = None
) -> FastAPI:
    from dishka import Provider, Scope, make_async_container
    from dishka.integrations.fastapi import setup_dishka

    from app.presentation.api.v1.chat_stream import router

    app = FastAPI()
    app.include_router(router)

    conversations_repo = conversations if conversations is not None else _FakeChatConversationRepository()

    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: agent, provides=RunChatTurn, scope=Scope.APP)
    provider.provide(lambda: conversations_repo, provides=ChatConversationRepository, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


@pytest.fixture
def fake_agent() -> _FakeRunChatTurn:
    return _FakeRunChatTurn(_sample_events())


@pytest.fixture
def client(fake_agent: _FakeRunChatTurn) -> TestClient:
    app = _make_app_with_fake_agent(fake_agent)
    test_client = TestClient(app, raise_server_exceptions=True)
    test_client.headers[USER_ID_HEADER] = _TEST_USER_ID
    return test_client


# ---------------------------------------------------------------------------
# SSE framing
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stream_yields_one_sse_frame_per_event_ending_after_terminal(
    client: TestClient, fake_agent: _FakeRunChatTurn
) -> None:
    resp = client.post(
        "/v1/chat/stream",
        json={"conversation_id": _VALID_UUID_1, "user_text": "Hi there", "model_id": "m1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    frames = [line for line in resp.text.split("\n\n") if line.strip()]
    assert len(frames) == 4
    parsed = [json.loads(frame.removeprefix("data: ")) for frame in frames]
    assert [p["type"] for p in parsed] == ["started", "text_delta_checkpoint", "usage", "completed"]
    assert parsed[-1]["type"] == "completed"

    assert fake_agent.run_calls == [{"conversation_id": _VALID_UUID_1, "user_text": "Hi there", "model_id": "m1"}]


@pytest.mark.unit
def test_regenerate_streams_sibling_run(client: TestClient, fake_agent: _FakeRunChatTurn) -> None:
    resp = client.post(
        "/v1/chat/regenerate",
        json={"conversation_id": _VALID_UUID_1, "assistant_message_id": _VALID_UUID_2, "model_id": "m1"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert fake_agent.regenerate_calls == [
        {"conversation_id": _VALID_UUID_1, "assistant_message_id": _VALID_UUID_2, "model_id": "m1"}
    ]


@pytest.mark.unit
def test_stream_rejects_invalid_conversation_id(client: TestClient) -> None:
    resp = client.post(
        "/v1/chat/stream",
        json={"conversation_id": "not-a-uuid", "user_text": "Hi", "model_id": "m1"},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_stream_rejects_missing_user_text(client: TestClient) -> None:
    resp = client.post(
        "/v1/chat/stream",
        json={"conversation_id": _VALID_UUID_1, "model_id": "m1"},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_regenerate_rejects_invalid_assistant_message_id(client: TestClient) -> None:
    resp = client.post(
        "/v1/chat/regenerate",
        json={"conversation_id": _VALID_UUID_1, "assistant_message_id": "not-a-uuid", "model_id": "m1"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Auth (T-22-24)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_stream_requires_api_key_when_configured(monkeypatch: pytest.MonkeyPatch, fake_agent: _FakeRunChatTurn) -> None:
    """With an API key configured (staging), a request without X-API-Key is rejected --
    fail-closed, no stream body (dependencies run before the endpoint/StreamingResponse)."""
    from app.settings import Environment, get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        app = _make_app_with_fake_agent(fake_agent)
        auth_client = TestClient(app, raise_server_exceptions=True)
        resp = auth_client.post(
            "/v1/chat/stream",
            json={"conversation_id": _VALID_UUID_1, "user_text": "Hi", "model_id": "m1"},
        )
        assert resp.status_code == 401
        assert not resp.headers.get("content-type", "").startswith("text/event-stream")
        assert not fake_agent.run_calls
        assert get_settings().ENVIRONMENT is Environment.STAGING
    finally:
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Disconnect -> cancellation (T-22-27, D-15/D-25)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_disconnect_cancels_the_agent_task() -> None:
    agent = _HangingAgent()
    request = _FakeRequest(disconnect_after=0)

    frames = [frame async for frame in stream_run_events(request, agent.run())]

    assert agent.cancelled is True
    assert any("started" in frame for frame in frames)
    # The hang-then-cancel path never reaches the second (unreachable) event.
    assert not any("completed" in frame for frame in frames)
