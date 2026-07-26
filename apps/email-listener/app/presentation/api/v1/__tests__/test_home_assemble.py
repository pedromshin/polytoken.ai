"""Tests for POST /v1/home/assemble-job — the worker's morning-board re-entry route (Phase 74).

MORN-03: the route runs the assembly use case and, on failure, returns 5xx (NOT
the SNS receiver's swallow-to-200) so the worker throws and graphile retries. It
is also api-key-guarded (require_api_key on the router). MORN-06 at the route
layer: a dark use case yields a 200 no-op (``assembled: false``, nothing written).

require_api_key is overridden in the behavioral tests (auth is covered by its own
suite and by a dedicated guard test here); the use case is a dishka-bound fake,
so there is no live composer / Supabase.
"""

from __future__ import annotations

from typing import Any

from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.presentation.middleware.auth as auth_mod
from app.application.use_cases.assemble_morning_board import (
    AssembleMorningBoardOutcome,
    AssembleMorningBoardUseCase,
)
from app.presentation.api.v1.home_assemble import router
from app.presentation.middleware.auth import require_api_key


class _FakeAssemble:
    def __init__(self, *, raises: bool = False, assembled: bool = True, node_count: int = 3) -> None:
        self.calls: list[str] = []
        self._raises = raises
        self._assembled = assembled
        self._node_count = node_count

    async def execute(self, user_id: str) -> AssembleMorningBoardOutcome:
        self.calls.append(user_id)
        if self._raises:
            raise RuntimeError("assembly boom")
        return AssembleMorningBoardOutcome(assembled=self._assembled, node_count=self._node_count)


def _make_client(
    assemble: _FakeAssemble,
    *,
    raise_server_exceptions: bool,
    override_auth: bool = True,
) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: assemble, provides=AssembleMorningBoardUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    if override_auth:
        app.dependency_overrides[require_api_key] = lambda: None
    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


def _post(client: TestClient) -> Any:
    return client.post("/v1/home/assemble-job", json={"user_id": "user-a"})


def test_success_returns_200_and_runs_assembly() -> None:
    assemble = _FakeAssemble()
    resp = _post(_make_client(assemble, raise_server_exceptions=True))

    assert resp.status_code == 200
    assert resp.json()["data"] == {"assembled": True, "node_count": 3}
    assert assemble.calls == ["user-a"]  # keyed on the payload user_id


def test_dark_use_case_returns_200_noop() -> None:
    assemble = _FakeAssemble(assembled=False, node_count=0)
    resp = _post(_make_client(assemble, raise_server_exceptions=True))

    assert resp.status_code == 200
    assert resp.json()["data"] == {"assembled": False, "node_count": 0}


def test_assembly_failure_returns_500_so_graphile_retries() -> None:
    assemble = _FakeAssemble(raises=True)
    # raise_server_exceptions=False so the unhandled error becomes the 500 the worker sees.
    resp = _post(_make_client(assemble, raise_server_exceptions=False))

    assert resp.status_code == 500
    assert assemble.calls  # the assembly was invoked; the failure is NOT swallowed to 200


class _AuthSettings:
    """Minimal settings stub for the auth guard: a configured key + header name.

    ``api_key`` is truthy, so require_api_key skips its empty-key/environment
    branch entirely and goes straight to the constant-time header comparison.
    """

    api_key = "secret"
    API_KEY_HEADER = "X-API-Key"


def test_route_is_api_key_guarded() -> None:
    """Do NOT override the guard — a request with a wrong key against a configured
    key must be rejected (401) before the use case runs, proving the router's
    require_api_key dependency is wired."""
    def _fake_settings() -> _AuthSettings:
        return _AuthSettings()

    assemble = _FakeAssemble()
    original = auth_mod.get_settings
    auth_mod.get_settings = _fake_settings  # type: ignore[assignment]
    try:
        client = _make_client(assemble, raise_server_exceptions=True, override_auth=False)
        resp = client.post(
            "/v1/home/assemble-job",
            json={"user_id": "user-a"},
            headers={"X-API-Key": "wrong"},
        )
        assert resp.status_code == 401
        assert assemble.calls == []  # guard rejected before the use case ran
    finally:
        auth_mod.get_settings = original  # type: ignore[assignment]
