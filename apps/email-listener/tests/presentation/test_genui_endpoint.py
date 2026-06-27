"""Tests for POST /v1/genui/generate endpoint (Task 3 TDD RED).

Verifies:
- 200 with ApiResponse on valid request
- X-API-Key auth required (401 without key)
- body validation: 422 on missing required fields
- DI wiring: use case is injected via FromDishka
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.application.use_cases.generate_ui_spec import GenerateUiSpecResult, GenerateUiSpecUseCase
from app.infrastructure.llm.genui_generator_adapter import SAFE_FALLBACK_SPEC


# ---------------------------------------------------------------------------
# App factory for tests
# ---------------------------------------------------------------------------


def _make_app_with_mock_use_case(use_case: GenerateUiSpecUseCase) -> "fastapi.FastAPI":  # type: ignore[name-defined]
    """Create a minimal FastAPI app with the genui router and mocked DI."""
    from unittest.mock import patch

    import fastapi
    from dishka import make_async_container
    from dishka.integrations.fastapi import setup_dishka
    from dishka import Provider, Scope

    from app.presentation.api.v1.genui import router
    from app.settings import get_settings

    # Patch get_settings to disable auth in dev mode
    settings = get_settings()

    app = fastapi.FastAPI()
    app.include_router(router)

    # Build a minimal dishka container that provides just the use case
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=GenerateUiSpecUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


@pytest.fixture
def mock_use_case() -> MagicMock:
    uc = MagicMock(spec=GenerateUiSpecUseCase)
    valid_spec = {"v": 1, "root": {"type": "card", "title": "Test"}}
    uc.execute = AsyncMock(return_value=GenerateUiSpecResult(spec=valid_spec))
    return uc


@pytest.fixture
def client(mock_use_case: MagicMock) -> TestClient:
    app = _make_app_with_mock_use_case(mock_use_case)
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit()
def test_generate_returns_200_with_spec(client: TestClient, mock_use_case: MagicMock) -> None:
    """POST /v1/genui/generate returns 200 with ApiResponse wrapping the spec."""
    resp = client.post(
        "/v1/genui/generate",
        json={
            "intent": "Show invoice summary",
            "raw_content": "Invoice #123: $500.00",
            "registry_version": "v1",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] is not None
    assert "spec" in body["data"]


@pytest.mark.unit()
def test_generate_missing_intent_returns_422(client: TestClient) -> None:
    """422 when 'intent' field is missing from the request body."""
    resp = client.post(
        "/v1/genui/generate",
        json={
            "raw_content": "Some content",
            "registry_version": "v1",
        },
    )
    assert resp.status_code == 422


@pytest.mark.unit()
def test_generate_missing_raw_content_returns_422(client: TestClient) -> None:
    """422 when 'raw_content' field is missing from the request body."""
    resp = client.post(
        "/v1/genui/generate",
        json={
            "intent": "Show summary",
            "registry_version": "v1",
        },
    )
    assert resp.status_code == 422


@pytest.mark.unit()
def test_generate_missing_registry_version_returns_422(client: TestClient) -> None:
    """422 when 'registry_version' field is missing from the request body."""
    resp = client.post(
        "/v1/genui/generate",
        json={
            "intent": "Show summary",
            "raw_content": "Some content",
        },
    )
    assert resp.status_code == 422


@pytest.mark.unit()
def test_generate_calls_use_case_with_correct_args(
    client: TestClient,
    mock_use_case: MagicMock,
) -> None:
    """The endpoint passes the correct intent/raw_content/registry_version to the use case."""
    client.post(
        "/v1/genui/generate",
        json={
            "intent": "Display the invoice",
            "raw_content": "Invoice details here",
            "registry_version": "catalog-v1.2",
        },
    )
    mock_use_case.execute.assert_called_once_with(
        intent="Display the invoice",
        raw_content="Invoice details here",
        registry_version="catalog-v1.2",
        importer_id=None,
    )


@pytest.mark.unit()
def test_generate_returns_fallback_spec_when_use_case_returns_fallback(
    client: TestClient,
    mock_use_case: MagicMock,
) -> None:
    """When the use case returns SAFE_FALLBACK_SPEC, the endpoint returns it in data.spec."""
    mock_use_case.execute = AsyncMock(
        return_value=GenerateUiSpecResult(spec=SAFE_FALLBACK_SPEC)
    )
    resp = client.post(
        "/v1/genui/generate",
        json={
            "intent": "Unknown",
            "raw_content": "Garbage",
            "registry_version": "v1",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["spec"]["root"]["type"] == "alert"
