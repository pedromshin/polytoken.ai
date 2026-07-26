"""Tests for POST /v1/importers/delete-data — account-deletion blob erasure.

Mirrors test_ingest_job.py's dishka-fake pattern. Covers: the require_api_key
gate; the happy path passes the X-User-Id (the endpoint self-derives scope, so it
sends NO ids/keys to trust) and returns counts + `complete`; and a missing
X-User-Id is rejected.
"""

from __future__ import annotations

from typing import Any

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.delete_importer_data import (
    DeleteImporterDataResult,
    DeleteImporterDataUseCase,
)
from app.presentation.api.v1.importers_delete import router
from app.presentation.middleware.auth import require_api_key
from app.settings import Environment, get_settings


class _FakeDelete:
    def __init__(self, *, raw: int = 0, prefixes: int = 0, req_raw: int = 0, req_pref: int = 0) -> None:
        self.calls: list[str] = []
        self._result = DeleteImporterDataResult(
            deleted_raw=raw,
            deleted_attachment_prefixes=prefixes,
            requested_raw=req_raw,
            requested_attachment_prefixes=req_pref,
        )

    async def execute(self, user_id: str) -> DeleteImporterDataResult:
        self.calls.append(user_id)
        return self._result


def _make_client(delete_uc: _FakeDelete, *, override_auth: bool) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: delete_uc, provides=DeleteImporterDataUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    if override_auth:
        app.dependency_overrides[require_api_key] = lambda: None
    return TestClient(app, raise_server_exceptions=True)


def _post(client: TestClient) -> Any:
    return client.post("/v1/importers/delete-data", headers={"X-User-Id": "user-1"}, json={})


def test_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        delete_uc = _FakeDelete()
        resp = _post(_make_client(delete_uc, override_auth=False))

        assert resp.status_code == 401
        assert get_settings().ENVIRONMENT is Environment.STAGING
        assert delete_uc.calls == []
    finally:
        get_settings.cache_clear()


def test_happy_path_passes_user_id_and_returns_counts_plus_complete() -> None:
    delete_uc = _FakeDelete(raw=2, prefixes=2, req_raw=2, req_pref=2)
    resp = _post(_make_client(delete_uc, override_auth=True))

    assert resp.status_code == 200
    assert resp.json() == {
        "deleted_raw": 2,
        "deleted_attachment_prefixes": 2,
        "requested_raw": 2,
        "requested_attachment_prefixes": 2,
        "complete": True,
    }
    # Scope is self-derived from the header — the endpoint passes only the user id.
    assert delete_uc.calls == ["user-1"]


def test_incomplete_erasure_reports_complete_false() -> None:
    # 1 of 2 raw keys deleted → complete False → the web caller aborts the cascade.
    delete_uc = _FakeDelete(raw=1, prefixes=2, req_raw=2, req_pref=2)
    resp = _post(_make_client(delete_uc, override_auth=True))

    assert resp.status_code == 200
    assert resp.json()["complete"] is False


def test_missing_user_id_header_is_rejected() -> None:
    delete_uc = _FakeDelete()
    client = _make_client(delete_uc, override_auth=True)

    resp = client.post("/v1/importers/delete-data", json={})

    assert resp.status_code == 422  # FastAPI: required X-User-Id header absent
    assert delete_uc.calls == []
