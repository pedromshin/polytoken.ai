"""Tests for GET /v1/genui/history and GET /v1/genui/history/{id} endpoints (Task 2 TDD RED).

TDD (Phase 16-03, STDO-05/STDO-06):
  1. GET /v1/genui/history returns 200 with ApiResponse wrapping a list of HistoryRowView.
  2. GET /v1/genui/history supports limit/offset/importer_id query params.
  3. GET /v1/genui/history returns empty list when repo returns [].
  4. GET /v1/genui/history/{id} returns 200 with ApiResponse wrapping HistoryDetailView.
  5. GET /v1/genui/history/{id} returns 404 when repo returns None.
  6. Both endpoints inject UiSpecTemplateRepository via FromDishka.
  7. HistoryRowView must NOT expose spec_json (D-14 — list is lightweight).
  8. HistoryDetailView must expose spec_json (D-14 — detail includes full payload).

D-16: these endpoints surface ONLY ui_spec_templates (via the repository port);
      they never touch genui_generation_events.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.domain.ports.ui_spec_template_repository import (
    TemplateDetail,
    TemplateSummary,
    UiSpecTemplateRepository,
)

# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

_SAMPLE_ID = "22222222-2222-2222-2222-222222222222"
_SAMPLE_SPEC_JSON: dict[str, Any] = {"v": 1, "root": {"type": "card", "title": "Invoice"}}

_SAMPLE_SUMMARY = TemplateSummary(
    id=_SAMPLE_ID,
    intent_text="show invoice details",
    created_at="2026-06-01T12:00:00+00:00",
    registry_version="abc123",
    use_count=3,
    validation_status="validated",
)

_SAMPLE_DETAIL = TemplateDetail(
    id=_SAMPLE_ID,
    intent_text="show invoice details",
    created_at="2026-06-01T12:00:00+00:00",
    registry_version="abc123",
    use_count=3,
    validation_status="validated",
    spec_json=_SAMPLE_SPEC_JSON,
)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def _make_app_with_mock_repo(repo: UiSpecTemplateRepository) -> Any:
    """Create a minimal FastAPI app with the genui router and mocked DI."""
    import fastapi
    from dishka import Provider, Scope, make_async_container
    from dishka.integrations.fastapi import setup_dishka

    from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase
    from app.presentation.api.v1.genui import router

    app = fastapi.FastAPI()
    app.include_router(router)

    provider = Provider(scope=Scope.APP)
    # Provide a stub use case so the existing /generate route doesn't break
    stub_uc = MagicMock(spec=GenerateUiSpecUseCase)
    provider.provide(lambda: stub_uc, provides=GenerateUiSpecUseCase, scope=Scope.APP)
    # Provide the repository mock
    provider.provide(lambda: repo, provides=UiSpecTemplateRepository, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


@pytest.fixture
def mock_repo() -> MagicMock:
    repo = MagicMock(spec=UiSpecTemplateRepository)
    repo.list_recent = AsyncMock(return_value=[_SAMPLE_SUMMARY])
    repo.find_by_id = AsyncMock(return_value=_SAMPLE_DETAIL)
    return repo


@pytest.fixture
def client(mock_repo: MagicMock) -> TestClient:
    app = _make_app_with_mock_repo(mock_repo)
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Test 1: GET /v1/genui/history returns 200 with ApiResponse list
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_list_returns_200_with_summaries(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history returns 200 with ApiResponse wrapping HistoryRowView list."""
    resp = client.get("/v1/genui/history")

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)
    assert len(body["data"]) == 1
    row = body["data"][0]
    assert row["id"] == _SAMPLE_ID
    assert row["intent_text"] == "show invoice details"
    assert row["use_count"] == 3
    assert row["validation_status"] == "validated"


# ---------------------------------------------------------------------------
# Test 2: GET /v1/genui/history supports query params
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_list_passes_limit_offset_to_repo(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history passes limit/offset query params to the repo."""
    client.get("/v1/genui/history?limit=5&offset=10")

    mock_repo.list_recent.assert_called_once()
    call_kwargs = mock_repo.list_recent.call_args.kwargs
    assert call_kwargs.get("limit") == 5
    assert call_kwargs.get("offset") == 10


@pytest.mark.unit
def test_history_list_passes_importer_id_to_repo(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history passes importer_id query param to the repo."""
    importer_id = "00000000-0000-0000-0003-000000000001"
    client.get(f"/v1/genui/history?importer_id={importer_id}")

    mock_repo.list_recent.assert_called_once()
    call_kwargs = mock_repo.list_recent.call_args.kwargs
    assert call_kwargs.get("importer_id") == importer_id


@pytest.mark.unit
def test_history_list_omits_importer_id_when_not_provided(
    client: TestClient, mock_repo: MagicMock
) -> None:
    """GET /v1/genui/history passes importer_id=None when query param is absent."""
    client.get("/v1/genui/history")

    mock_repo.list_recent.assert_called_once()
    call_kwargs = mock_repo.list_recent.call_args.kwargs
    assert call_kwargs.get("importer_id") is None


# ---------------------------------------------------------------------------
# Test 3: GET /v1/genui/history returns empty list when repo returns []
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_list_returns_empty_list_when_no_rows(
    client: TestClient, mock_repo: MagicMock
) -> None:
    """GET /v1/genui/history returns empty list data when repo returns []."""
    mock_repo.list_recent = AsyncMock(return_value=[])

    resp = client.get("/v1/genui/history")

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] == []


# ---------------------------------------------------------------------------
# Test 4: GET /v1/genui/history/{id} returns 200 with HistoryDetailView
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_detail_returns_200_with_spec_json(
    client: TestClient, mock_repo: MagicMock
) -> None:
    """GET /v1/genui/history/{id} returns 200 with ApiResponse wrapping HistoryDetailView."""
    resp = client.get(f"/v1/genui/history/{_SAMPLE_ID}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    detail = body["data"]
    assert detail["id"] == _SAMPLE_ID
    assert detail["intent_text"] == "show invoice details"
    assert detail["spec_json"] == _SAMPLE_SPEC_JSON
    assert detail["use_count"] == 3


# ---------------------------------------------------------------------------
# Test 5: GET /v1/genui/history/{id} returns 404 when repo returns None
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_detail_returns_404_when_not_found(
    client: TestClient, mock_repo: MagicMock
) -> None:
    """GET /v1/genui/history/{id} returns 404 when the repo returns None (D-15)."""
    mock_repo.find_by_id = AsyncMock(return_value=None)

    resp = client.get(f"/v1/genui/history/{_SAMPLE_ID}")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 6: Repo injection works (DI wiring)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_list_calls_repo_list_recent(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history must inject the repo and call list_recent."""
    client.get("/v1/genui/history")

    mock_repo.list_recent.assert_called_once()


@pytest.mark.unit
def test_history_detail_calls_repo_find_by_id(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history/{id} must inject the repo and call find_by_id with the path param."""
    client.get(f"/v1/genui/history/{_SAMPLE_ID}")

    mock_repo.find_by_id.assert_called_once_with(_SAMPLE_ID)


# ---------------------------------------------------------------------------
# Test 7: HistoryRowView must NOT expose spec_json (D-14)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_list_row_does_not_expose_spec_json(
    client: TestClient, mock_repo: MagicMock
) -> None:
    """GET /v1/genui/history response rows must NOT include spec_json (D-14 lightweight list)."""
    resp = client.get("/v1/genui/history")

    assert resp.status_code == 200
    row = resp.json()["data"][0]
    assert "spec_json" not in row, (
        "History list rows must not expose spec_json — use detail endpoint instead (D-14)"
    )


# ---------------------------------------------------------------------------
# Test 8: HistoryDetailView must expose spec_json (D-14)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_history_detail_exposes_spec_json(client: TestClient, mock_repo: MagicMock) -> None:
    """GET /v1/genui/history/{id} response must include spec_json (D-14 full detail)."""
    resp = client.get(f"/v1/genui/history/{_SAMPLE_ID}")

    assert resp.status_code == 200
    detail = resp.json()["data"]
    assert "spec_json" in detail, "History detail must expose spec_json (D-14)"
    assert isinstance(detail["spec_json"], dict)
