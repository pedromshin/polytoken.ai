"""Tests for X-User-Id extraction: non-enforcing (Phase 43-04) + enforcing (Phase 44-03, T-43-P4).

Verifies:
- extract_user_id returns the id when X-User-Id is present
- extract_user_id returns None (never raises) when the header is absent
- require_user_id returns the id when X-User-Id is present
- require_user_id raises HTTPException(401) when the header is absent/empty
- require_api_key's behavior is unchanged: a valid X-API-Key request still
  passes, and a missing/invalid key still 401s, exactly as before
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.presentation.middleware.auth import require_api_key
from app.presentation.middleware.user_context import USER_ID_HEADER, extract_user_id, require_user_id


def _make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/user-context-probe")
    async def user_context_probe(user_id: str | None = Depends(extract_user_id)) -> dict[str, str | None]:
        return {"user_id": user_id}

    @app.get("/user-context-required-probe")
    async def user_context_required_probe(user_id: str = Depends(require_user_id)) -> dict[str, str]:
        return {"user_id": user_id}

    @app.get("/api-key-probe", dependencies=[Depends(require_api_key)])
    async def api_key_probe() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_make_app(), raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# extract_user_id — additive, non-enforcing (Task 2 acceptance criteria a/b)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_extract_user_id_returns_id_when_header_present(client: TestClient) -> None:
    resp = client.get("/user-context-probe", headers={USER_ID_HEADER: "user-123"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "user-123"}


@pytest.mark.unit
def test_extract_user_id_returns_none_when_header_absent(client: TestClient) -> None:
    """Non-enforcing: a missing header never raises or rejects the request."""
    resp = client.get("/user-context-probe")
    assert resp.status_code == 200
    assert resp.json() == {"user_id": None}


# ---------------------------------------------------------------------------
# require_user_id — enforcing (Phase 44-03, Task 1 acceptance criteria)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_require_user_id_returns_id_when_header_present(client: TestClient) -> None:
    resp = client.get("/user-context-required-probe", headers={USER_ID_HEADER: "user-123"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "user-123"}


@pytest.mark.unit
def test_require_user_id_raises_401_when_header_absent(client: TestClient) -> None:
    resp = client.get("/user-context-required-probe")
    assert resp.status_code == 401


@pytest.mark.unit
def test_require_user_id_raises_401_when_header_empty(client: TestClient) -> None:
    resp = client.get("/user-context-required-probe", headers={USER_ID_HEADER: ""})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# require_api_key — regression: unchanged behavior (Task 2 acceptance criterion c)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_require_api_key_still_passes_with_valid_key(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    from app.settings import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        resp = client.get("/api-key-probe", headers={"X-API-Key": "secret-key"})
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
    finally:
        get_settings.cache_clear()


@pytest.mark.unit
def test_require_api_key_still_401s_with_missing_or_invalid_key(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    from app.settings import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        missing = client.get("/api-key-probe")
        assert missing.status_code == 401

        invalid = client.get("/api-key-probe", headers={"X-API-Key": "wrong-key"})
        assert invalid.status_code == 401
    finally:
        get_settings.cache_clear()
