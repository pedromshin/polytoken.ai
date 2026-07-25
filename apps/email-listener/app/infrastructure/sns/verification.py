"""AWS SNS message authenticity — host-pinning + signature verification.

The ``/v1/emails/inbound-sns`` endpoint is unauthenticated (SNS cannot send an
``X-API-Key`` header), so without these checks anyone who can reach it could:

  * forge a ``SubscriptionConfirmation`` whose ``SubscribeURL`` points at an
    internal address and make the server GET it (SSRF), or
  * forge a ``Notification`` to inject arbitrary email metadata into ingestion.

Two independent controls close that:

1. :func:`is_sns_host` — host-pin the ``SubscribeURL`` / ``SigningCertURL`` to
   ``sns.<region>.amazonaws.com`` (or ``.amazonaws.com.cn``). A genuine AWS URL
   always matches, so this rejects only forgeries — zero risk to real mail. The
   caller applies it UNCONDITIONALLY.
2. :func:`verify_sns_signature` — verify the message's RSA signature against the
   AWS signing certificate (fetched only from a host-pinned URL, then cached).
   Supports ``SignatureVersion`` 1 (SHA1, legacy) and 2 (SHA256, current).

The signing string is built per the AWS SNS spec: the signable fields in a fixed
order, each emitted as ``"<key>\\n<value>\\n"``. ``Subject`` is signed only when
present. Getting this exactly right matters — a wrong canonical string would
reject *valid* AWS messages, so it is covered by a real-key round-trip test.
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from urllib.parse import urlsplit

import httpx
import structlog
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

logger = structlog.get_logger(__name__)

# The SNS message types that carry a signature and that we verify.
SIGNED_SNS_TYPES = frozenset({"Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"})

# Signable fields, in AWS's exact canonical order, per message type. ``Subject``
# (Notification only) is signed only when present in the payload.
_SIGNABLE_FIELDS: dict[str, tuple[str, ...]] = {
    "Notification": ("Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"),
    "SubscriptionConfirmation": ("Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"),
    "UnsubscribeConfirmation": ("Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"),
}

# HashAlgorithm per SignatureVersion. AWS now sends "2" (SHA256) by default; "1"
# (SHA1) remains valid for legacy topics, so both are accepted.
_HASH_BY_SIG_VERSION: dict[str, hashes.HashAlgorithm] = {
    # AWS SNS SignatureVersion 1 is RSA-SHA1. We only VERIFY AWS-produced signatures
    # here — the hash choice is AWS's, not ours — so the SHA1 warning does not apply.
    "1": hashes.SHA1(),  # noqa: S303  # nosec B303
    "2": hashes.SHA256(),
}

# Small cache of fetched signing keys, keyed by (host-pinned) SigningCertURL. AWS
# rotates these periodically; a fresh URL simply repopulates the cache.
_CERT_CACHE: dict[str, RSAPublicKey] = {}
_CERT_CACHE_MAX = 8


class SnsSignatureError(Exception):
    """Raised when an SNS message is not a verifiable, authentic AWS message."""


def is_sns_host(url: str) -> bool:
    """True only for an ``https://sns.<region>.amazonaws.com[.cn]/...`` URL.

    Used to host-pin both the ``SubscribeURL`` (before any GET — the SSRF gate)
    and the ``SigningCertURL`` (before fetching the signing cert). Anything else
    — an internal address, a look-alike host, a non-HTTPS scheme, or the
    region-less ``sns.amazonaws.com`` — is rejected. Matches the well-known AWS
    validator regex, requiring a region label between ``sns.`` and ``.amazonaws``.
    """
    parts = urlsplit(url)
    if parts.scheme != "https":
        return False
    host = parts.hostname or ""
    if host.endswith(".amazonaws.com.cn"):
        base = host[: -len(".amazonaws.com.cn")]
    elif host.endswith(".amazonaws.com"):
        base = host[: -len(".amazonaws.com")]
    else:
        return False
    # base must be "sns.<region>" with a non-empty region of the allowed charset.
    if not base.startswith("sns."):
        return False
    region = base[len("sns.") :]
    return len(region) >= 3 and all(c.isalnum() or c == "-" for c in region)


def _canonical_string(payload: Mapping[str, object]) -> bytes:
    """Build the byte string AWS signed: ``"<key>\\n<value>\\n"`` per signable field."""
    msg_type = str(payload.get("Type", ""))
    fields = _SIGNABLE_FIELDS.get(msg_type)
    if fields is None:
        raise SnsSignatureError(f"unsupported message type: {msg_type!r}")
    parts: list[str] = []
    for field in fields:
        if field not in payload:
            if field == "Subject":
                continue  # signed only when present
            raise SnsSignatureError(f"missing signable field: {field}")
        parts.append(field)
        parts.append(str(payload[field]))
    return ("\n".join(parts) + "\n").encode("utf-8")


async def _load_public_key(cert_url: str) -> RSAPublicKey:
    """Fetch (host-pinned) and cache the RSA public key from the SNS signing cert."""
    cached = _CERT_CACHE.get(cert_url)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(cert_url)
        response.raise_for_status()
    certificate = x509.load_pem_x509_certificate(response.content)
    key = certificate.public_key()
    if not isinstance(key, RSAPublicKey):
        raise SnsSignatureError("signing certificate is not RSA")
    if len(_CERT_CACHE) >= _CERT_CACHE_MAX:
        _CERT_CACHE.clear()
    _CERT_CACHE[cert_url] = key
    return key


async def verify_sns_signature(payload: Mapping[str, object]) -> None:
    """Verify an SNS message is authentic; raise :class:`SnsSignatureError` if not.

    All cheap, offline checks (SignatureVersion, cert-URL host-pin, field
    presence) run BEFORE the network fetch, so a forged or malformed payload is
    rejected without ever touching the wire.
    """
    sig_version = str(payload.get("SignatureVersion", ""))
    algorithm = _HASH_BY_SIG_VERSION.get(sig_version)
    if algorithm is None:
        raise SnsSignatureError(f"unsupported SignatureVersion: {sig_version!r}")

    cert_url = str(payload.get("SigningCertURL", ""))
    if not is_sns_host(cert_url):
        raise SnsSignatureError(f"SigningCertURL host not allowed: {cert_url!r}")

    signature_field = payload.get("Signature")
    if not isinstance(signature_field, str) or not signature_field:
        raise SnsSignatureError("missing Signature")
    try:
        # binascii.Error (raised on malformed base64) is a ValueError subclass.
        signature = base64.b64decode(signature_field, validate=True)
    except ValueError as exc:
        raise SnsSignatureError("Signature is not valid base64") from exc

    message = _canonical_string(payload)
    public_key = await _load_public_key(cert_url)
    try:
        public_key.verify(signature, message, padding.PKCS1v15(), algorithm)
    except InvalidSignature as exc:
        raise SnsSignatureError("signature does not match") from exc
