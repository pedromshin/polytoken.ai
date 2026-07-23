"""Tests for the stdlib MIME parser domain service (raw bytes -> ParsedEmail)."""

from __future__ import annotations

from datetime import UTC, datetime
from email.message import EmailMessage

from app.domain.services.mime_parser import ParsedEmail, parse_mime

PDF_BYTES = b"%PDF-1.4 fake pdf content"


def _build_full_message() -> bytes:
    msg = EmailMessage()
    msg["From"] = "Maria Souza <maria@exporter.com>"
    msg["To"] = "agent@magnitudetech.com.br, ops@magnitudetech.com.br"
    msg["Cc"] = "Carlos <carlos@exporter.com>"
    msg["Subject"] = "Shipment docs BL-12345"
    msg["Date"] = "Wed, 10 Jun 2026 14:30:00 +0000"
    msg["Message-ID"] = "<original-123@exporter.com>"
    msg["In-Reply-To"] = "<previous-456@magnitudetech.com.br>"
    msg["References"] = "<root-001@exporter.com> <previous-456@magnitudetech.com.br>"
    msg.set_content("Please find the BL attached.")
    msg.add_alternative("<p>Please find the BL attached.</p>", subtype="html")
    msg.add_attachment(
        PDF_BYTES,
        maintype="application",
        subtype="pdf",
        filename="bill-of-lading.pdf",
    )
    return bytes(msg)


def test_parses_addresses_and_subject() -> None:
    parsed = parse_mime(_build_full_message())
    assert isinstance(parsed, ParsedEmail)
    assert parsed.sender_address == "maria@exporter.com"
    assert parsed.sender_name == "Maria Souza"
    assert parsed.to_addresses == ("agent@magnitudetech.com.br", "ops@magnitudetech.com.br")
    assert parsed.cc_addresses == ("carlos@exporter.com",)
    assert parsed.subject == "Shipment docs BL-12345"


def test_parses_threading_headers() -> None:
    parsed = parse_mime(_build_full_message())
    assert parsed.message_id == "<original-123@exporter.com>"
    assert parsed.in_reply_to == "<previous-456@magnitudetech.com.br>"
    assert parsed.references_ids == (
        "<root-001@exporter.com>",
        "<previous-456@magnitudetech.com.br>",
    )


def test_parses_date_to_aware_datetime() -> None:
    parsed = parse_mime(_build_full_message())
    assert parsed.received_at == datetime(2026, 6, 10, 14, 30, 0, tzinfo=UTC)


def test_parses_both_bodies() -> None:
    parsed = parse_mime(_build_full_message())
    assert parsed.body_text is not None
    assert "Please find the BL attached." in parsed.body_text
    assert parsed.body_html is not None
    assert "<p>Please find the BL attached.</p>" in parsed.body_html


def test_parses_pdf_attachment_bytes() -> None:
    parsed = parse_mime(_build_full_message())
    assert len(parsed.attachments) == 1
    att = parsed.attachments[0]
    assert att.filename == "bill-of-lading.pdf"
    assert att.content_type == "application/pdf"
    assert att.data == PDF_BYTES


def test_plain_only_email_has_no_html_and_no_attachments() -> None:
    msg = EmailMessage()
    msg["From"] = "noreply@example.com"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "plain"
    msg.set_content("just text")
    parsed = parse_mime(bytes(msg))
    assert parsed.body_html is None
    assert "just text" in (parsed.body_text or "")
    assert parsed.attachments == ()
    assert parsed.sender_name is None


def test_missing_optional_headers_are_none() -> None:
    msg = EmailMessage()
    msg["From"] = "a@b.com"
    msg["To"] = "agent@magnitudetech.com.br"
    msg.set_content("x")
    parsed = parse_mime(bytes(msg))
    assert parsed.message_id is None
    assert parsed.in_reply_to is None
    assert parsed.references_ids == ()
    assert parsed.received_at is None
    assert parsed.subject is None or parsed.subject == ""


# ---------------------------------------------------------------------------
# ING-1 — real-world MIME must never raise out of parse_mime (silent email loss)
# ---------------------------------------------------------------------------


def test_unknown_charset_body_decodes_instead_of_raising() -> None:
    """A text part with an unregistered charset (e.g. 'binary') must decode via
    the fallback path, not raise LookupError and drop the whole email (ING-1)."""
    raw = (
        b"From: Bad <bad@example.com>\r\n"
        b"To: agent@x.com\r\n"
        b"Subject: weird charset\r\n"
        b'Content-Type: text/plain; charset="binary"\r\n'
        b"Content-Transfer-Encoding: 7bit\r\n"
        b"\r\n"
        b"hello binary body\r\n"
    )
    parsed = parse_mime(raw)  # must not raise
    assert parsed.sender_address == "bad@example.com"
    assert parsed.body_text is not None
    assert "hello binary body" in parsed.body_text


def test_nested_multipart_attachment_iteration_does_not_raise() -> None:
    """A nested multipart container yielded by iter_attachments must not raise a
    KeyError when its bytes are read (ING-1)."""
    inner = EmailMessage()
    inner["From"] = "a@b.com"
    inner.set_content("nested plain")
    inner.add_alternative("<p>nested</p>", subtype="html")

    outer = EmailMessage()
    outer["From"] = "sender@x.com"
    outer["To"] = "agent@x.com"
    outer["Subject"] = "nested"
    outer.set_content("outer body")
    outer.add_attachment(inner, filename="inner.eml")

    parsed = parse_mime(bytes(outer))  # must not raise
    assert parsed.sender_address == "sender@x.com"


# ---------------------------------------------------------------------------
# ING-4 — message/rfc822 forward-as-attachment must not become 0 bytes
# ---------------------------------------------------------------------------


def test_rfc822_forward_attachment_has_nonzero_bytes() -> None:
    inner = EmailMessage()
    inner["From"] = "orig@sender.com"
    inner["Subject"] = "Invoice"
    inner.set_content("the invoice text")

    outer = EmailMessage()
    outer["From"] = "fwd@user.com"
    outer["To"] = "agent@x.com"
    outer["Subject"] = "Fwd: Invoice"
    outer.set_content("see attached")
    outer.add_attachment(inner, filename="original.eml")

    parsed = parse_mime(bytes(outer))
    assert len(parsed.attachments) == 1
    att = parsed.attachments[0]
    assert att.content_type == "message/rfc822"
    assert att.data, "message/rfc822 attachment must not be zero bytes (ING-4)"
    assert b"the invoice text" in att.data


# ---------------------------------------------------------------------------
# CVE-2023-27043 — hostile/malformed From must not smuggle a spoofed address
# ---------------------------------------------------------------------------


def test_double_at_from_header_is_rejected() -> None:
    """A From with two '@' (a@b.com@evil.com) must not resolve to any address —
    it would otherwise key tenant routing on a spoofed domain (CVE-2023-27043)."""
    raw = b"From: a@b.com@evil.com\r\nTo: x@y.com\r\nSubject: s\r\n\r\nbody\r\n"
    parsed = parse_mime(raw)
    assert parsed.sender_address == ""


def test_addr_spec_validation_rejects_structural_and_multi_at() -> None:
    from app.domain.services.mime_parser import _is_valid_addr_spec, _safe_parseaddr

    assert _is_valid_addr_spec("maria@exporter.com") is True
    assert _is_valid_addr_spec("a@b.com@evil.com") is False
    assert _is_valid_addr_spec("plainaddr") is False
    assert _is_valid_addr_spec("has space@x.com") is False
    assert _is_valid_addr_spec("") is False
    # A malformed value yields an empty address (discarded), preserving name
    assert _safe_parseaddr("a@b.com@evil.com") == ("", "")
    assert _safe_parseaddr("Maria <maria@exporter.com>") == ("Maria", "maria@exporter.com")


def test_valid_from_still_parses() -> None:
    raw = b"From: Maria Souza <maria@exporter.com>\r\nTo: x@y.com\r\nSubject: s\r\n\r\nbody\r\n"
    parsed = parse_mime(raw)
    assert parsed.sender_address == "maria@exporter.com"
    assert parsed.sender_name == "Maria Souza"


def test_text_attachment_is_encoded_to_bytes() -> None:
    msg = EmailMessage()
    msg["From"] = "a@b.com"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "csv"
    msg.set_content("body")
    msg.add_attachment("col1,col2\n1,2\n", filename="data.csv", subtype="csv")
    parsed = parse_mime(bytes(msg))
    assert len(parsed.attachments) == 1
    att = parsed.attachments[0]
    assert att.filename == "data.csv"
    assert isinstance(att.data, bytes)
    assert b"col1,col2" in att.data
