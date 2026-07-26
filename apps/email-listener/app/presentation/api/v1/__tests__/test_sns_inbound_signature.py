"""Tests for the SNS receiver's signature gate + unconditional SubscribeURL host-pin (Track 4 S1).

The signature verifier itself is unit-tested in
``app/infrastructure/sns/__tests__/test_verification.py``; here we test how the
handler ACTS on the verdict under the two flags:

- SNS_VERIFY_SIGNATURE off              → verifier never called, message processed.
- verify on, SNS_SIGNATURE_ENFORCED off → verify + log, message STILL processed (a
  verifier bug can't drop live mail).
- verify on, enforce on                 → invalid signature → 403, NOT processed;
                                          valid signature → processed.
- SubscribeURL host-pin is UNCONDITIONAL → a non-SNS URL is 403'd regardless of flags.

``verify_sns_signature`` / ``confirm_subscription`` / ``get_settings`` /
``parse_ses_notification`` are monkeypatched in the handler module, so no crypto,
network, or cached settings are needed; dishka binds a fake ingest use case.
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
from app.presentation.api.v1 import sns_inbound
from app.presentation.api.v1.sns_inbound import router

_META = {
    "message_id": "ses-msg-1",
    "sender": "alice@example.com",
    "recipients": ["u-tok@in.example.com"],
    "subject": "Hello",
}


class _FakeIngest:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def execute(self, message_id: str, recipients: Any = ()) -> Any:
        self.calls.append({"message_id": message_id, "recipients": recipients})
        return SimpleNamespace(id="e1", parse_status="parsed")


def _make_client(ingest: _FakeIngest) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    provider = Provider(scope=Scope.APP)
    provider.provide(lambda: ingest, provides=IngestInboundEmailUseCase, scope=Scope.APP)
    container = make_async_container(provider)
    setup_dishka(container=container, app=app)
    return TestClient(app, raise_server_exceptions=True)


def _set_settings(monkeypatch: pytest.MonkeyPatch, *, verify: bool = True, enforce: bool = False) -> None:
    monkeypatch.setattr(
        sns_inbound,
        "get_settings",
        lambda: SimpleNamespace(
            INGEST_ENQUEUE_ENABLED=False,
            INGEST_BACKGROUND_ENABLED=False,
            INGEST_INLINE_RETRY_ON_FAILURE=False,
            SNS_VERIFY_SIGNATURE=verify,
            SNS_SIGNATURE_ENFORCED=enforce,
        ),
    )


def _stub_parse_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sns_inbound, "parse_ses_notification", lambda _msg: dict(_META))


def _stub_verify(monkeypatch: pytest.MonkeyPatch, *, ok: bool) -> list[str]:
    """Replace verify_sns_signature; record calls. ok=False raises like a real failure."""
    calls: list[str] = []

    async def _fake(payload: Any) -> None:
        calls.append(str(payload.get("Type", "")))
        if not ok:
            raise RuntimeError("signature does not match")

    monkeypatch.setattr(sns_inbound, "verify_sns_signature", _fake)
    return calls


def _post_notification(client: TestClient) -> Any:
    body = json.dumps({"Type": "Notification", "Message": "{}", "Signature": "x", "SignatureVersion": "2"})
    return client.post("/v1/emails/inbound-sns", content=body)


# ── the signature gate ───────────────────────────────────────────────────────


def test_verify_off_skips_verification_and_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_settings(monkeypatch, verify=False)
    _stub_parse_ok(monkeypatch)
    verify_calls = _stub_verify(monkeypatch, ok=True)
    ingest = _FakeIngest()

    resp = _post_notification(_make_client(ingest))

    assert resp.status_code == 200
    assert verify_calls == []  # verifier never invoked when the flag is off
    assert len(ingest.calls) == 1


def test_verify_on_enforce_off_logs_but_still_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_settings(monkeypatch, verify=True, enforce=False)
    _stub_parse_ok(monkeypatch)
    verify_calls = _stub_verify(monkeypatch, ok=False)  # invalid signature
    ingest = _FakeIngest()

    resp = _post_notification(_make_client(ingest))

    assert resp.status_code == 200  # observe-only: a bad/absent sig can't drop mail
    assert verify_calls == ["Notification"]
    assert len(ingest.calls) == 1


def test_enforce_on_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_settings(monkeypatch, verify=True, enforce=True)
    _stub_parse_ok(monkeypatch)
    _stub_verify(monkeypatch, ok=False)
    ingest = _FakeIngest()

    resp = _post_notification(_make_client(ingest))

    assert resp.status_code == 403  # forged/invalid — rejected
    assert ingest.calls == []  # pipeline never runs


def test_enforce_on_accepts_valid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_settings(monkeypatch, verify=True, enforce=True)
    _stub_parse_ok(monkeypatch)
    _stub_verify(monkeypatch, ok=True)
    ingest = _FakeIngest()

    resp = _post_notification(_make_client(ingest))

    assert resp.status_code == 200
    assert len(ingest.calls) == 1
    assert ingest.calls[0]["message_id"] == "ses-msg-1"


# ── the unconditional SubscribeURL host-pin (SSRF) ───────────────────────────


def test_subscription_confirmation_rejects_non_sns_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # verify OFF isolates the host-pin: it must reject regardless of the sig flags.
    _set_settings(monkeypatch, verify=False)
    confirm_calls: list[str] = []

    async def _fake_confirm(url: str) -> None:
        confirm_calls.append(url)

    monkeypatch.setattr(sns_inbound, "confirm_subscription", _fake_confirm)

    body = json.dumps({"Type": "SubscriptionConfirmation", "SubscribeURL": "http://169.254.169.254/latest/meta-data/"})
    resp = _make_client(_FakeIngest()).post("/v1/emails/inbound-sns", content=body)

    assert resp.status_code == 403  # SSRF blocked
    assert confirm_calls == []  # never GETs the attacker URL


def test_subscription_confirmation_accepts_sns_url(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_settings(monkeypatch, verify=False)
    confirm_calls: list[str] = []

    async def _fake_confirm(url: str) -> None:
        confirm_calls.append(url)

    monkeypatch.setattr(sns_inbound, "confirm_subscription", _fake_confirm)

    url = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t"
    body = json.dumps({"Type": "SubscriptionConfirmation", "SubscribeURL": url})
    resp = _make_client(_FakeIngest()).post("/v1/emails/inbound-sns", content=body)

    assert resp.status_code == 200
    assert confirm_calls == [url]
