"""Tests for POST /v1/emails/inbound-sns SNS notification handler."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from dishka import Provider, Scope, make_async_container
from fastapi.testclient import TestClient

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


SNS_SUBSCRIPTION_CONFIRMATION = {
    "Type": "SubscriptionConfirmation",
    "Token": "token123",
    # Must be a real regional SNS host — the handler now host-pins the SubscribeURL
    # (sns.<region>.amazonaws.com) before GETting it, closing the SSRF vector.
    "SubscribeURL": "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=token123",
    "TopicArn": "arn:aws:sns:us-east-1:123456789:nauta-services-ses-inbound",
}

SNS_NOTIFICATION = {
    "Type": "Notification",
    "MessageId": "sns-msg-001",
    "TopicArn": "arn:aws:sns:us-east-1:123456789:nauta-services-ses-inbound",
    "Timestamp": "2026-06-11T10:00:00.000Z",
    "Message": json.dumps(
        {
            "mail": {
                "messageId": "msg-001",
                "source": "sender@example.com",
                "destination": ["agent@magnitudetech.com.br"],
                "commonHeaders": {"subject": "Hello from test"},
            }
        }
    ),
}


def test_subscription_confirmation_calls_subscribe_url(client: TestClient) -> None:
    """SubscriptionConfirmation type must call confirm_subscription with the SubscribeURL."""
    with patch(
        "app.presentation.api.v1.sns_inbound.confirm_subscription",
        new_callable=AsyncMock,
    ) as mock_confirm:
        resp = client.post(
            "/v1/emails/inbound-sns",
            content=json.dumps(SNS_SUBSCRIPTION_CONFIRMATION),
            headers={"Content-Type": "text/plain"},
        )
    assert resp.status_code == 200
    mock_confirm.assert_awaited_once_with(SNS_SUBSCRIPTION_CONFIRMATION["SubscribeURL"])


def test_notification_returns_200_and_parses_email(client: TestClient) -> None:
    """Notification type must return 200 and parse email metadata without error."""
    resp = client.post(
        "/v1/emails/inbound-sns",
        content=json.dumps(SNS_NOTIFICATION),
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 200


def test_bad_json_returns_200(client: TestClient) -> None:
    """Malformed JSON body must return 200 (prevent SNS retry storm)."""
    resp = client.post(
        "/v1/emails/inbound-sns",
        content=b"not json at all",
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 200


def test_unknown_type_returns_200(client: TestClient) -> None:
    """Unknown SNS message type must return 200 without raising."""
    payload = {
        "Type": "UnknownType",
        "TopicArn": "arn:aws:sns:us-east-1:123456789:nauta-services-ses-inbound",
    }
    resp = client.post(
        "/v1/emails/inbound-sns",
        content=json.dumps(payload),
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 200


def _container_with_use_case(use_case: MagicMock) -> object:
    provider = Provider(scope=Scope.APP)

    def provide_use_case() -> IngestInboundEmailUseCase:
        return use_case

    provider.provide(provide_use_case, provides=IngestInboundEmailUseCase)
    return make_async_container(provider)


def test_notification_triggers_ingestion(client: TestClient) -> None:
    """Notification must resolve IngestInboundEmailUseCase and execute it with the SES message id."""
    use_case = MagicMock(spec=IngestInboundEmailUseCase)
    use_case.execute = AsyncMock()
    client.app.state.dishka_container = _container_with_use_case(use_case)  # type: ignore[union-attr]

    resp = client.post(
        "/v1/emails/inbound-sns",
        content=json.dumps(SNS_NOTIFICATION),
        headers={"Content-Type": "text/plain"},
    )

    assert resp.status_code == 200
    use_case.execute.assert_awaited_once_with("msg-001", recipients=["agent@magnitudetech.com.br"])


def test_notification_ingest_failure_still_returns_200(client: TestClient) -> None:
    """Ingestion errors (S3/DB down) must be swallowed — 200 stops SNS retry storms."""
    use_case = MagicMock(spec=IngestInboundEmailUseCase)
    use_case.execute = AsyncMock(side_effect=RuntimeError("S3 down"))
    client.app.state.dishka_container = _container_with_use_case(use_case)  # type: ignore[union-attr]

    resp = client.post(
        "/v1/emails/inbound-sns",
        content=json.dumps(SNS_NOTIFICATION),
        headers={"Content-Type": "text/plain"},
    )

    assert resp.status_code == 200
    use_case.execute.assert_awaited_once()


def test_notification_with_missing_mail_key_returns_200(client: TestClient) -> None:
    """Notification with malformed Message content must return 200 (not 500)."""
    payload = {
        "Type": "Notification",
        "MessageId": "sns-msg-002",
        "Message": json.dumps({"unexpected": "structure"}),
    }
    resp = client.post(
        "/v1/emails/inbound-sns",
        content=json.dumps(payload),
        headers={"Content-Type": "text/plain"},
    )
    assert resp.status_code == 200
