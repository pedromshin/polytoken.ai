"""Tests for POST /v1/emails/ingest-job — the worker's durable re-entry route (Track 3a, A5).

The property graphile depends on: this route runs the ingest pipeline and, on failure,
returns 5xx (NOT the SNS receiver's swallow-to-200) so the worker throws and the job retries.
- success → 200 with {email_id, parse_status};
- the use case raising → 500 (so the job is retried, never silently lost).

require_api_key is overridden here (auth is covered by its own tests); the use case is a
dishka-bound fake, so there's no live pipeline / Supabase / S3.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.presentation.api.v1.ingest_job import router
from app.presentation.middleware.auth import require_api_key


class _FakeIngest:
    def __init__(self, *, raises: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self._raises = raises

    async def execute(self, ses_message_id: str, recipients: Any = ()) -> Any:
        self.calls.append({"ses_message_id": ses_message_id, "recipients": recipients})
        if self._raises:
            raise RuntimeError("pipeline boom")
        return SimpleNamespace(id="email-1", parse_status="parsed")


def _make_client(ingest: _FakeIngest, *, raise_server_exceptions: bool) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: ingest, provides=IngestInboundEmailUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    # Auth is covered by its own suite; override so these tests exercise the 200/5xx contract.
    app.dependency_overrides[require_api_key] = lambda: None
    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


def _post(client: TestClient) -> Any:
    return client.post(
        "/v1/emails/ingest-job",
        json={"ses_message_id": "ses-msg-1", "recipients": ["u-tok@in.example.com"]},
    )


def test_success_returns_200_and_runs_pipeline() -> None:
    ingest = _FakeIngest()
    resp = _post(_make_client(ingest, raise_server_exceptions=True))

    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body == {"email_id": "email-1", "parse_status": "parsed"}
    assert ingest.calls == [{"ses_message_id": "ses-msg-1", "recipients": ("u-tok@in.example.com",)}]


def test_pipeline_failure_returns_500_so_graphile_retries() -> None:
    ingest = _FakeIngest(raises=True)
    # raise_server_exceptions=False so the unhandled error becomes the 500 the worker sees.
    resp = _post(_make_client(ingest, raise_server_exceptions=False))

    assert resp.status_code == 500
    assert ingest.calls  # the pipeline was invoked; the failure is not swallowed to 200
