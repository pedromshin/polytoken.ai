"""Tests for the email-body domain helpers (identity + HTML->text)."""

from __future__ import annotations

from app.domain.services.email_body_identity import email_body_component_id
from app.domain.services.html_to_text import html_to_text


class TestEmailBodyComponentId:
    def test_deterministic_for_same_email(self) -> None:
        assert email_body_component_id("email-1") == email_body_component_id("email-1")

    def test_distinct_per_email(self) -> None:
        assert email_body_component_id("email-1") != email_body_component_id("email-2")

    def test_is_uuid_string(self) -> None:
        import uuid

        uuid.UUID(email_body_component_id("email-1"))  # raises if not a valid uuid


class TestHtmlToText:
    def test_strips_tags_and_keeps_text(self) -> None:
        out = html_to_text("<p>Hello <b>world</b></p>")
        assert "Hello" in out
        assert "world" in out
        assert "<" not in out
        assert ">" not in out

    def test_drops_script_and_style_content(self) -> None:
        html = "<style>.x{color:red}</style><script>alert(1)</script><p>Real text</p>"
        out = html_to_text(html)
        assert "Real text" in out
        assert "alert" not in out
        assert "color:red" not in out

    def test_decodes_entities(self) -> None:
        assert "R$ 100 & up" in html_to_text("<p>R$&nbsp;100 &amp; up</p>")

    def test_block_elements_become_line_breaks(self) -> None:
        out = html_to_text("<div>Line one</div><div>Line two</div>")
        assert "Line one" in out
        assert "Line two" in out
        assert out.index("Line one") < out.index("Line two")

    def test_empty_and_whitespace_return_empty(self) -> None:
        assert html_to_text("") == ""
        assert html_to_text("   ") == ""

    def test_malformed_html_does_not_raise(self) -> None:
        # Unclosed tags / stray brackets must never crash ingestion.
        assert "keep" in html_to_text("<div><span>keep<<< </div")
