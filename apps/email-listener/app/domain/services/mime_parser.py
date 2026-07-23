"""Pure stdlib MIME parser — raw RFC 5322 bytes to a ParsedEmail value object.

No external dependencies (domain layer). Uses the modern ``email`` policy API
so bodies and attachments are decoded transparently.

Hardening notes:
- Real-world MIME (odd charsets, nested multiparts, message/rfc822 forwards)
  must never raise out of ``parse_mime`` — a raise upstream silently drops the
  email with no DB trace (ING-1/ING-4). Body/attachment decoding is guarded and
  degrades to raw bytes / replacement decoding instead.
- Address headers are parsed with ``strict=True`` where the interpreter supports
  it (CVE-2023-27043 fix) and every extracted address is re-validated against a
  conservative addr-spec check, so a hostile/malformed ``From`` cannot smuggle a
  spoofed address into tenant routing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from email import message_from_bytes, policy
from email.message import EmailMessage, Message
from email.utils import getaddresses, parseaddr, parsedate_to_datetime

# Characters whose presence in an extracted address indicates a parse failure
# or an attempt to smuggle a second address / structural token past parseaddr
# (CVE-2023-27043). A legitimate addr-spec contains none of them.
_FORBIDDEN_ADDR_CHARS = frozenset(' \t\r\n,<>()[]:;\\"')


def _is_valid_addr_spec(addr: str) -> bool:
    """Conservative addr-spec validation, independent of the interpreter's parseaddr.

    Requires exactly one ``@`` with non-empty local and domain parts and no
    structural/whitespace characters — rejecting the ``a@b.com@evil.com`` and
    ``<addr> extra@evil.com`` shapes that unpatched ``parseaddr`` mis-parses
    (CVE-2023-27043).
    """
    if not addr or addr.count("@") != 1:
        return False
    local, _, domain = addr.partition("@")
    if not local or not domain:
        return False
    return not (_FORBIDDEN_ADDR_CHARS & set(addr))


def _safe_parseaddr(raw_value: str) -> tuple[str, str]:
    """CVE-2023-27043-hardened single-address parse.

    Prefers the stdlib strict parser (Python security backport / 3.13+); falls
    back to the legacy signature on older interpreters, then validates the
    result. An address that fails validation is discarded (empty string) so it
    can never key tenant routing.
    """
    try:
        name, addr = parseaddr(raw_value, strict=True)  # type: ignore[call-arg]
    except TypeError:
        name, addr = parseaddr(raw_value)
    if not _is_valid_addr_spec(addr):
        return name, ""
    return name, addr


@dataclass(frozen=True)
class ParsedAttachment:
    """A single decoded attachment extracted from a MIME message."""

    filename: str | None
    content_type: str
    data: bytes


@dataclass(frozen=True)
class ParsedEmail:
    """Decoded email fields ready to map onto the Email entity."""

    message_id: str | None
    in_reply_to: str | None
    references_ids: tuple[str, ...]
    sender_address: str
    sender_name: str | None
    to_addresses: tuple[str, ...]
    cc_addresses: tuple[str, ...]
    subject: str | None
    body_text: str | None
    body_html: str | None
    received_at: datetime | None
    attachments: tuple[ParsedAttachment, ...]


def _header(msg: EmailMessage, name: str) -> str | None:
    value = msg.get(name)
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _addresses(msg: EmailMessage, name: str) -> tuple[str, ...]:
    raw = msg.get_all(name, [])
    values = [str(v) for v in raw]
    try:
        pairs = getaddresses(values, strict=True)  # type: ignore[call-arg]
    except TypeError:
        pairs = getaddresses(values)
    return tuple(addr for _name, addr in pairs if _is_valid_addr_spec(addr))


def _parse_date(msg: EmailMessage) -> datetime | None:
    raw = _header(msg, "Date")
    if raw is None:
        return None
    try:
        return parsedate_to_datetime(raw)
    except (ValueError, TypeError):
        return None


def _decode_text_fallback(part: Message) -> str | None:
    """Decode a text part's raw payload when get_content() cannot (unknown charset).

    Falls back to the declared charset with ``errors='replace'``, then utf-8,
    then latin-1 (which never raises) — never propagates a LookupError.
    """
    payload = part.get_payload(decode=True)
    if not isinstance(payload, (bytes, bytearray)):
        return None
    raw = bytes(payload)
    charset = part.get_content_charset() or "utf-8"
    for candidate in (charset, "utf-8"):
        try:
            return raw.decode(candidate, errors="replace")
        except (LookupError, ValueError):
            continue
    return raw.decode("latin-1", errors="replace")


def _body(msg: EmailMessage, subtype: str) -> str | None:
    part = msg.get_body(preferencelist=(subtype,))
    if part is None:
        return None
    try:
        content = part.get_content()
    except (LookupError, KeyError, ValueError):
        # Unknown/unsupported charset (binary, x-user-defined, …) or a
        # container part with no content manager — decode defensively instead
        # of letting the whole email be dropped (ING-1).
        return _decode_text_fallback(part)
    return content if isinstance(content, str) else None


def _attachment_bytes(part: EmailMessage) -> bytes:
    try:
        content = part.get_content()
    except (LookupError, KeyError, ValueError):
        content = None
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)
    if isinstance(content, str):
        return content.encode("utf-8")
    # message/rfc822 forward-as-attachment: get_content() returns the inner
    # EmailMessage and get_payload(decode=True) is None, which previously
    # persisted a ZERO-byte attachment (ING-4). Re-serialize the inner message
    # so the forwarded .eml survives.
    if isinstance(content, Message):
        try:
            return content.as_bytes()
        except (KeyError, ValueError, LookupError):
            pass
    decoded = part.get_payload(decode=True)
    return bytes(decoded) if isinstance(decoded, (bytes, bytearray)) else b""


def _attachments(msg: EmailMessage) -> tuple[ParsedAttachment, ...]:
    return tuple(
        ParsedAttachment(
            filename=part.get_filename(),
            content_type=part.get_content_type(),
            data=_attachment_bytes(part),
        )
        for part in msg.iter_attachments()
    )


def parse_mime(raw: bytes) -> ParsedEmail:
    """Parse raw MIME bytes into a ParsedEmail with decoded bodies and attachments."""
    msg = message_from_bytes(raw, policy=policy.default)
    # Typing narrow only: message_from_bytes with policy.default always returns
    # an EmailMessage (policy.default.message_factory) — never fails at runtime.
    assert isinstance(msg, EmailMessage)  # nosec B101 — mypy narrowing, not a runtime guard

    sender_name, sender_address = _safe_parseaddr(str(msg.get("From", "")))
    references = _header(msg, "References")

    return ParsedEmail(
        message_id=_header(msg, "Message-ID"),
        in_reply_to=_header(msg, "In-Reply-To"),
        references_ids=tuple(references.split()) if references else (),
        sender_address=sender_address,
        sender_name=sender_name or None,
        to_addresses=_addresses(msg, "To"),
        cc_addresses=_addresses(msg, "Cc"),
        subject=_header(msg, "Subject"),
        body_text=_body(msg, "plain"),
        body_html=_body(msg, "html"),
        received_at=_parse_date(msg),
        attachments=_attachments(msg),
    )
