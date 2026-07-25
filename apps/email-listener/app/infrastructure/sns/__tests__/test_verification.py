"""Unit tests for AWS SNS message authenticity (host-pinning + signature verify).

The round-trip tests are the important ones: they sign a message with a locally
generated key and confirm :func:`verify_sns_signature` ACCEPTS it. That guards the
canonical-string builder against a subtle bug that would reject *valid* AWS mail
(a mail outage) once SNS_SIGNATURE_ENFORCED is flipped on.
"""

from __future__ import annotations

import base64
from typing import Any

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.infrastructure.sns import verification
from app.infrastructure.sns.verification import (
    SnsSignatureError,
    _canonical_string,
    is_sns_host,
    verify_sns_signature,
)

# ── is_sns_host ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t",
        "https://sns.eu-west-2.amazonaws.com/SimpleNotificationService-abc.pem",
        "https://sns.cn-north-1.amazonaws.com.cn/cert.pem",
    ],
)
def test_is_sns_host_accepts_real_regional_hosts(url: str) -> None:
    assert is_sns_host(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "http://sns.us-east-1.amazonaws.com/cert.pem",  # not https
        "http://169.254.169.254/latest/meta-data/",  # SSRF: instance metadata
        "https://sns.amazonaws.com/cert.pem",  # region-less — rejected
        "https://sns.x.amazonaws.com/cert.pem",  # region too short (<3)
        "https://evil.com/cert.pem",  # not amazonaws
        "https://sns.us-east-1.amazonaws.com.evil.com/cert.pem",  # suffix look-alike
        "https://sns-us-east-1.amazonaws.com/cert.pem",  # no dot after sns
        "",  # empty
        "not-a-url",
    ],
)
def test_is_sns_host_rejects_forgeries_and_ssrf(url: str) -> None:
    assert is_sns_host(url) is False


# ── canonical string ─────────────────────────────────────────────────────────


def test_canonical_notification_includes_subject_in_order() -> None:
    payload = {
        "Type": "Notification",
        "MessageId": "m1",
        "Message": "hello",
        "Subject": "hi",
        "Timestamp": "2026-07-25T00:00:00.000Z",
        "TopicArn": "arn:aws:sns:us-east-1:1:t",
    }
    assert _canonical_string(payload) == (
        b"Message\nhello\n"
        b"MessageId\nm1\n"
        b"Subject\nhi\n"
        b"Timestamp\n2026-07-25T00:00:00.000Z\n"
        b"TopicArn\narn:aws:sns:us-east-1:1:t\n"
        b"Type\nNotification\n"
    )


def test_canonical_notification_omits_absent_subject() -> None:
    payload = {
        "Type": "Notification",
        "MessageId": "m1",
        "Message": "hello",
        "Timestamp": "2026-07-25T00:00:00.000Z",
        "TopicArn": "arn:aws:sns:us-east-1:1:t",
    }
    assert b"Subject" not in _canonical_string(payload)


def test_canonical_subscription_confirmation_uses_subscribe_url_and_token() -> None:
    payload = {
        "Type": "SubscriptionConfirmation",
        "MessageId": "m1",
        "Message": "confirm me",
        "SubscribeURL": "https://sns.us-east-1.amazonaws.com/?x=1",
        "Timestamp": "2026-07-25T00:00:00.000Z",
        "Token": "tok",
        "TopicArn": "arn:aws:sns:us-east-1:1:t",
    }
    canonical = _canonical_string(payload).decode()
    assert "SubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?x=1\n" in canonical
    assert "Token\ntok\n" in canonical


def test_canonical_rejects_unknown_type() -> None:
    with pytest.raises(SnsSignatureError, match="unsupported message type"):
        _canonical_string({"Type": "Nope"})


def test_canonical_rejects_missing_required_field() -> None:
    with pytest.raises(SnsSignatureError, match="missing signable field: MessageId"):
        _canonical_string({"Type": "Notification", "Message": "x", "Timestamp": "t", "TopicArn": "a"})


# ── verify_sns_signature (real-key round-trip) ───────────────────────────────


def _sign(payload: dict[str, Any], private_key: rsa.RSAPrivateKey, algo: hashes.HashAlgorithm) -> str:
    signature = private_key.sign(_canonical_string(payload), padding.PKCS1v15(), algo)
    return base64.b64encode(signature).decode()


@pytest.fixture
def keypair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sig_version", "algo"),
    [("2", hashes.SHA256()), ("1", hashes.SHA1())],  # noqa: S303 — verify legacy AWS SignatureVersion 1 (RSA-SHA1)
)
async def test_verify_accepts_a_genuinely_signed_message(
    monkeypatch: pytest.MonkeyPatch,
    keypair: tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey],
    sig_version: str,
    algo: hashes.HashAlgorithm,
) -> None:
    private_key, public_key = keypair
    payload: dict[str, Any] = {
        "Type": "Notification",
        "MessageId": "m1",
        "Message": "real message",
        "Subject": "s",
        "Timestamp": "2026-07-25T00:00:00.000Z",
        "TopicArn": "arn:aws:sns:us-east-1:1:t",
        "SignatureVersion": sig_version,
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
    }
    payload["Signature"] = _sign(payload, private_key, algo)

    async def _fake_load(_url: str) -> rsa.RSAPublicKey:
        return public_key

    monkeypatch.setattr(verification, "_load_public_key", _fake_load)

    # Must NOT raise.
    await verify_sns_signature(payload)


@pytest.mark.asyncio
async def test_verify_rejects_a_tampered_message(
    monkeypatch: pytest.MonkeyPatch,
    keypair: tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey],
) -> None:
    private_key, public_key = keypair
    payload: dict[str, Any] = {
        "Type": "Notification",
        "MessageId": "m1",
        "Message": "original",
        "Timestamp": "2026-07-25T00:00:00.000Z",
        "TopicArn": "arn:aws:sns:us-east-1:1:t",
        "SignatureVersion": "2",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
    }
    payload["Signature"] = _sign(payload, private_key, hashes.SHA256())
    payload["Message"] = "attacker-swapped body"  # tamper AFTER signing

    async def _fake_load(_url: str) -> rsa.RSAPublicKey:
        return public_key

    monkeypatch.setattr(verification, "_load_public_key", _fake_load)

    with pytest.raises(SnsSignatureError, match="signature does not match"):
        await verify_sns_signature(payload)


@pytest.mark.asyncio
async def test_verify_rejects_unknown_signature_version_without_network() -> None:
    # No SigningCertURL fetch should be attempted — the version check fails first.
    with pytest.raises(SnsSignatureError, match="unsupported SignatureVersion"):
        await verify_sns_signature({"Type": "Notification", "SignatureVersion": "9"})


@pytest.mark.asyncio
async def test_verify_rejects_non_sns_signing_cert_url_without_network() -> None:
    payload = {
        "Type": "Notification",
        "SignatureVersion": "2",
        "SigningCertURL": "https://evil.example.com/cert.pem",
        "Signature": base64.b64encode(b"x").decode(),
    }
    with pytest.raises(SnsSignatureError, match="SigningCertURL host not allowed"):
        await verify_sns_signature(payload)


@pytest.mark.asyncio
async def test_verify_rejects_malformed_base64_signature_without_network() -> None:
    payload = {
        "Type": "Notification",
        "SignatureVersion": "2",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "Signature": "!!! not base64 !!!",
    }
    with pytest.raises(SnsSignatureError, match="not valid base64"):
        await verify_sns_signature(payload)
