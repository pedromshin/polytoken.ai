"""Tests for the SNS receiver's durable-ingestion cutover (Track 3a, A4).

The handler at POST /v1/emails/inbound-sns gains a flag-gated enqueue path:
- ``INGEST_ENQUEUE_ENABLED`` ON  → enqueue a pointer job (200), a FAILED enqueue → 500
  (SNS retries — no silent loss), and the inline pipeline is NOT run.
- ``INGEST_ENQUEUE_ENABLED`` OFF → the exact pre-3a inline path (use_case.execute, 200
  even on failure); enqueue is NOT called.
- A parse failure still returns 200 (unprocessable envelope; avoids retry storm).

`parse_ses_notification` and `get_settings` are monkeypatched in the handler module,
so no real SES payload / cached settings is needed; dishka binds fakes for the port +
use case, so there is no live Supabase.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from dishka import Provider, Scope, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.domain.ports.job_enqueuer import JobEnqueuer
from app.presentation.api.v1 import sns_inbound
from app.presentation.api.v1.sns_inbound import router

_META = {
    "message_id": "ses-msg-1",
    "sender": "alice@example.com",
    "recipients": ["u-tok@in.example.com"],
    "subject": "Hello",
}


class _FakeEnqueuer:
    def __init__(self, *, raises: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self._raises = raises

    async def enqueue(
        self,
        identifier: str,
        payload: Any,
        *,
        max_attempts: int = 8,
        job_key: str | None = None,
    ) -> int:
        self.calls.append(
            {"identifier": identifier, "payload": dict(payload), "max_attempts": max_attempts, "job_key": job_key}
        )
        if self._raises:
            raise RuntimeError("enqueue boom")
        return 1


class _FakeIngest:
    def __init__(self, *, raises: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self._raises = raises

    async def execute(self, message_id: str, recipients: Any = ()) -> Any:
        self.calls.append({"message_id": message_id, "recipients": recipients})
        if self._raises:
            raise RuntimeError("s3 fetch boom")  # a pre-persist critical-path failure
        return SimpleNamespace(id="e1", parse_status="parsed")


def _make_client(enqueuer: _FakeEnqueuer, ingest: _FakeIngest) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: enqueuer, provides=JobEnqueuer, scope=Scope.APP)
    provider.provide(lambda: ingest, provides=IngestInboundEmailUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


def _post_notification(client: TestClient) -> Any:
    body = json.dumps({"Type": "Notification", "Message": "{}"})
    return client.post("/v1/emails/inbound-sns", content=body)


def _set_flag(monkeypatch: pytest.MonkeyPatch, *, enabled: bool, inline_retry: bool = False) -> None:
    # Signature verification is orthogonal to the enqueue cutover under test, so it
    # is disabled here; test_sns_inbound_signature.py covers the verification gate.
    monkeypatch.setattr(
        sns_inbound,
        "get_settings",
        lambda: SimpleNamespace(
            INGEST_ENQUEUE_ENABLED=enabled,
            INGEST_INLINE_RETRY_ON_FAILURE=inline_retry,
            SNS_VERIFY_SIGNATURE=False,
            SNS_SIGNATURE_ENFORCED=False,
        ),
    )


def _stub_parse_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sns_inbound, "parse_ses_notification", lambda _msg: dict(_META))


def test_flag_on_enqueues_pointer_job_and_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_flag(monkeypatch, enabled=True)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest()

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 200
    assert len(enqueuer.calls) == 1
    call = enqueuer.calls[0]
    assert call["identifier"] == "ingest_inbound_email"
    assert call["payload"] == {"ses_message_id": "ses-msg-1", "recipients": ["u-tok@in.example.com"]}
    assert call["job_key"] == "ingest:ses-msg-1"
    # The heavy inline pipeline must NOT run on the enqueue path.
    assert ingest.calls == []


def test_flag_on_enqueue_failure_returns_500_not_silent_loss(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_flag(monkeypatch, enabled=True)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(raises=True), _FakeIngest()

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 500  # SNS will retry — the whole point of 3a
    assert ingest.calls == []


def test_parse_failure_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_flag(monkeypatch, enabled=True)

    def _boom(_msg: str) -> Any:
        raise ValueError("unparseable SES envelope")

    monkeypatch.setattr(sns_inbound, "parse_ses_notification", _boom)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest()

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 200  # unprocessable envelope: no retry storm
    assert enqueuer.calls == []
    assert ingest.calls == []


def test_flag_off_preserves_inline_path(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_flag(monkeypatch, enabled=False)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest()

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 200
    # Flag OFF == today's behavior: inline execute runs, enqueue is never touched.
    assert enqueuer.calls == []
    assert len(ingest.calls) == 1
    assert ingest.calls[0]["message_id"] == "ses-msg-1"
    assert ingest.calls[0]["recipients"] == ["u-tok@in.example.com"]


# --- A2: inline fail-loud stopgap (no-worker silent-loss fix) ----------------


def test_inline_failure_default_still_returns_200_silent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both flags OFF (default): an inline ingest failure STILL returns 200 —
    the exact pre-existing silent-loss behavior, preserved byte-for-byte."""
    _set_flag(monkeypatch, enabled=False, inline_retry=False)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest(raises=True)

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 200  # unchanged default: SNS won't retry (silent loss)
    assert len(ingest.calls) == 1  # it DID attempt (and raised)


def test_inline_retry_flag_returns_500_on_failure_so_sns_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """INGEST_INLINE_RETRY_ON_FAILURE ON: an inline critical-path failure returns
    500 so SNS retries instead of silently losing the mail (the A2 fix)."""
    _set_flag(monkeypatch, enabled=False, inline_retry=True)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest(raises=True)

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 500  # SNS will retry — no silent loss
    assert enqueuer.calls == []  # enqueue path not involved
    assert len(ingest.calls) == 1


def test_inline_retry_flag_success_still_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """INGEST_INLINE_RETRY_ON_FAILURE ON but ingest SUCCEEDS → 200 (no spurious retry)."""
    _set_flag(monkeypatch, enabled=False, inline_retry=True)
    _stub_parse_ok(monkeypatch)
    enqueuer, ingest = _FakeEnqueuer(), _FakeIngest()

    resp = _post_notification(_make_client(enqueuer, ingest))

    assert resp.status_code == 200
    assert len(ingest.calls) == 1
