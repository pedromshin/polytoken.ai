"""Tests for POST /v1/genui/code-island/generate endpoint (PARALLEL code-island path).

Verifies:
- 200 with ApiResponse envelope on valid request
- X-API-Key auth required (dependency wired via require_api_key)
- body validation: 422 on missing required fields
- DI wiring: use case injected via FromDishka
- fallback code surfaced in data.code
- typed-inputs manifest (76-02b): optional `inputs` accepted + forwarded to the
  use case as plain dicts; omitted/null forwards None (back-compat BTAP-05);
  bounded like the web zod (<=32 keys, key<=120, strict entries, pollution keys
  rejected) — the emit-tool's {kind, columns, sample} shape is NOT accepted
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.generate_code_island import (
    GenerateCodeIslandResult,
    GenerateCodeIslandUseCase,
)
from app.infrastructure.llm.genui_code_generator_adapter import SAFE_FALLBACK_CODE

_VALID_CODE = "const r = document.getElementById('island-root'); r.textContent = 'hi';"


# ---------------------------------------------------------------------------
# App factory for tests
# ---------------------------------------------------------------------------


def _make_app_with_mock_use_case(use_case: GenerateCodeIslandUseCase) -> FastAPI:
    """Create a minimal FastAPI app with the genui_code router and mocked DI."""
    from dishka import Provider, Scope, make_async_container
    from dishka.integrations.fastapi import setup_dishka

    from app.presentation.api.v1.genui_code import router

    app = FastAPI()
    app.include_router(router)

    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: use_case, provides=GenerateCodeIslandUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return app


@pytest.fixture
def mock_use_case() -> MagicMock:
    uc = MagicMock(spec=GenerateCodeIslandUseCase)
    uc.execute = AsyncMock(
        return_value=GenerateCodeIslandResult(code=_VALID_CODE, language="javascript", outcome="ok", attempts=1)
    )
    return uc


@pytest.fixture
def client(mock_use_case: MagicMock) -> TestClient:
    app = _make_app_with_mock_use_case(mock_use_case)
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_generate_returns_200_with_code(client: TestClient) -> None:
    """POST returns 200 with ApiResponse wrapping the emitted code + language + outcome."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build an invoice widget", "raw_content": "Invoice #123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"] is not None
    assert body["data"]["code"] == _VALID_CODE
    assert body["data"]["language"] == "javascript"
    assert body["data"]["outcome"] == "ok"
    assert body["data"]["attempts"] == 1


@pytest.mark.unit
def test_generate_surfaces_candidate_count(client: TestClient, mock_use_case: MagicMock) -> None:
    """candidate_count from the result is surfaced in the response view (parallel fan-out)."""
    mock_use_case.execute = AsyncMock(
        return_value=GenerateCodeIslandResult(
            code=_VALID_CODE, language="javascript", outcome="ok", attempts=1, candidate_count=3, judged=True
        )
    )
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a Twitter clone"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["candidate_count"] == 3


@pytest.mark.unit
def test_generate_missing_intent_returns_422(client: TestClient) -> None:
    """422 when 'intent' field is missing from the request body."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"raw_content": "Some content"},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_empty_intent_returns_422(client: TestClient) -> None:
    """422 when 'intent' is empty (min_length=1)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": ""},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_missing_raw_content_is_accepted_intent_only(client: TestClient, mock_use_case: MagicMock) -> None:
    """raw_content is optional (default=""); omitting it is accepted (intent-only)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a card"},
    )
    assert resp.status_code == 200
    call_kwargs = mock_use_case.execute.call_args.kwargs
    assert call_kwargs["intent"] == "Build a card"
    assert call_kwargs["raw_content"] == ""
    assert call_kwargs["importer_id"] is None


@pytest.mark.unit
def test_generate_surfaces_fallback_code(client: TestClient, mock_use_case: MagicMock) -> None:
    """When the use case returns SAFE_FALLBACK_CODE, the endpoint returns it in data.code."""
    mock_use_case.execute = AsyncMock(
        return_value=GenerateCodeIslandResult(
            code=SAFE_FALLBACK_CODE, language="javascript", outcome="fallback", attempts=3
        )
    )
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "garbage"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["outcome"] == "fallback"
    assert "island-root" in body["data"]["code"]


# ---------------------------------------------------------------------------
# Typed-inputs manifest (76-02b) — the WEB shape, mirrored from
# packages/api-client/src/router/genui/code-island.ts
# ---------------------------------------------------------------------------

_MANIFEST = {
    "emails": {
        "label": "Inbox emails",
        "nodeType": "email-table",
        "fields": [{"name": "subject", "type": "string"}, {"name": "count"}],
        "rowCount": 12,
    },
    "usage": {"nodeType": "usage"},
}


@pytest.mark.unit
def test_generate_accepts_and_forwards_inputs_manifest(client: TestClient, mock_use_case: MagicMock) -> None:
    """A valid typed-inputs manifest is accepted and forwarded to execute() as plain dicts."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a tool from these", "inputs": _MANIFEST},
    )
    assert resp.status_code == 200
    call_kwargs = mock_use_case.execute.call_args.kwargs
    assert call_kwargs["inputs"] == _MANIFEST


@pytest.mark.unit
def test_generate_omitted_inputs_forwards_none(client: TestClient, mock_use_case: MagicMock) -> None:
    """Omitting `inputs` preserves today's behavior: execute() receives inputs=None (BTAP-05)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a card"},
    )
    assert resp.status_code == 200
    assert mock_use_case.execute.call_args.kwargs["inputs"] is None


@pytest.mark.unit
def test_generate_null_inputs_forwards_none(client: TestClient, mock_use_case: MagicMock) -> None:
    """The web sends inputs:null when unwired — accepted, forwarded as None."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a card", "inputs": None},
    )
    assert resp.status_code == 200
    assert mock_use_case.execute.call_args.kwargs["inputs"] is None


@pytest.mark.unit
def test_generate_rejects_boolean_row_count(client: TestClient) -> None:
    """A bool never poses as a count (mirror of _clean_manifest_entry + the web zod)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a card", "inputs": {"k": {"rowCount": True}}},
    )
    assert resp.status_code == 422


@pytest.mark.unit
@pytest.mark.parametrize("bad_key", ["__proto__", "constructor", "prototype"])
def test_generate_rejects_pollution_input_keys(client: TestClient, bad_key: str) -> None:
    """Prototype-pollution manifest keys are rejected (mirror of the web zod guard)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a tool", "inputs": {bad_key: {"nodeType": "email-table"}}},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_rejects_more_than_32_input_keys(client: TestClient) -> None:
    """At most 32 typed inputs (mirror of the web zod cap)."""
    manifest = {f"k{i}": {"nodeType": "t"} for i in range(33)}
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a tool", "inputs": manifest},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_rejects_overlong_input_key(client: TestClient) -> None:
    """A targetKey longer than 120 chars is rejected (mirror of the web zod key cap)."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a tool", "inputs": {"k" * 121: {"nodeType": "t"}}},
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_rejects_emit_tool_manifest_shape(client: TestClient) -> None:
    """Entries are strict: the emit-tool's {kind, columns, sample} shape is NOT accepted."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={
            "intent": "Build a tool",
            "inputs": {"emails": {"kind": "table", "columns": ["a"], "sample": [["x"]]}},
        },
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_generate_rejects_overlong_label_and_too_many_fields(client: TestClient) -> None:
    """Entry bounds mirror the web zod: label<=200, fields<=50."""
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={"intent": "Build a tool", "inputs": {"emails": {"label": "x" * 201}}},
    )
    assert resp.status_code == 422
    resp = client.post(
        "/v1/genui/code-island/generate",
        json={
            "intent": "Build a tool",
            "inputs": {"emails": {"fields": [{"name": f"f{i}"} for i in range(51)]}},
        },
    )
    assert resp.status_code == 422


@pytest.mark.unit
def test_auth_required_rejects_without_key(monkeypatch: pytest.MonkeyPatch, mock_use_case: MagicMock) -> None:
    """With an API key configured (staging), a request without X-API-Key is rejected (auth wired)."""
    from app.settings import Environment, get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("API_KEY", "secret-key")
    try:
        app = _make_app_with_mock_use_case(mock_use_case)
        auth_client = TestClient(app, raise_server_exceptions=True)
        resp = auth_client.post(
            "/v1/genui/code-island/generate",
            json={"intent": "Build a card"},
        )
        assert resp.status_code == 401
        assert get_settings().ENVIRONMENT is Environment.STAGING
    finally:
        get_settings.cache_clear()
