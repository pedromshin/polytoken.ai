"""Tests for PdfParser — adaptive per-page text/OCR producing geometry Components.

Uses _HAS_PDF dep-gating so the test suite degrades gracefully when optional
PDF dependencies are absent from the environment.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Dep-gating: skip heavy PDF tests if pypdf/pdfminer are absent
try:
    import pypdf  # noqa: F401

    _HAS_PDF = True
except ImportError:
    _HAS_PDF = False

from app.infrastructure.pdf.pdf_parser import _PageExtract

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "pdf"

skip_no_pdf = pytest.mark.skipif(not _HAS_PDF, reason="pypdf not installed")


# ---------------------------------------------------------------------------
# Contract tests (no heavy deps)
# ---------------------------------------------------------------------------


class TestPdfParserContract:
    """Contract tests that run without heavy PDF dependencies."""

    def test_unsupported_content_type_raises(self) -> None:
        """parse() must raise UnsupportedFileTypeError for non-PDF content types."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.parser_registry import UnsupportedFileTypeError
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr: OCRProtocol = MagicMock()
        parser = PdfParser.__new__(PdfParser)
        parser._ocr = mock_ocr  # type: ignore[attr-defined]
        parser._executor = None  # type: ignore[attr-defined]

        with pytest.raises(UnsupportedFileTypeError):
            asyncio.run(
                parser.parse(
                    file_bytes=b"whatever",
                    content_type="application/zip",
                    attachment_id="att-001",
                )
            )

    def test_class_has_parse_method(self) -> None:
        import inspect

        from app.infrastructure.pdf.pdf_parser import PdfParser

        assert inspect.iscoroutinefunction(PdfParser.parse)

    def test_pdf_parser_implements_parser_protocol(self) -> None:
        """PdfParser must structurally satisfy ParserProtocol."""
        import inspect

        from app.infrastructure.pdf.pdf_parser import PdfParser

        assert hasattr(PdfParser, "parse")
        # Structural check: parse is async
        assert inspect.iscoroutinefunction(PdfParser.parse)


# ---------------------------------------------------------------------------
# Clean text-layer PDF tests
# ---------------------------------------------------------------------------


@skip_no_pdf
class TestPdfParserClean:
    def test_clean_pdf_yields_components(self) -> None:
        """A born-digital PDF should yield one Component per page without calling OCR."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        pdf_bytes = (FIXTURES_DIR / "clean.pdf").read_bytes()
        parser = PdfParser(ocr=mock_ocr)
        components = asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-clean",
            )
        )

        assert len(components) >= 1
        first = components[0]
        assert first.source_type == "attachment_page"
        assert "page_index" in first.location
        assert "polygon" in first.location
        assert first.sequence_index == 0
        assert first.attachment_id == "att-clean"

    def test_clean_pdf_has_polygon_in_location(self) -> None:
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        pdf_bytes = (FIXTURES_DIR / "clean.pdf").read_bytes()
        parser = PdfParser(ocr=mock_ocr)
        components = asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-clean",
            )
        )

        polygon = components[0].location.get("polygon")
        assert polygon is not None
        # Polygon should be a list of [x, y] vertices spanning roughly [0,0] to [1,1]
        assert isinstance(polygon, list)
        assert len(polygon) >= 4  # at least 4 corners

    def test_clean_pdf_ocr_not_called_for_text_layer(self) -> None:
        """When text layer is usable, OCR adapter must NOT be called."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        # Build a clean PDF with embedded text
        pdf_bytes = _build_text_pdf("Hello world " * 5)
        parser = PdfParser(ocr=mock_ocr)
        asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-text",
            )
        )

        # OCR should NOT have been called since text layer is present and usable
        mock_ocr.ocr_page.assert_not_called()


# ---------------------------------------------------------------------------
# Scanned / OCR PDF tests
# ---------------------------------------------------------------------------


@skip_no_pdf
class TestPdfParserScanned:
    """Tests for scanned/image-only PDF pages.

    pdf2image requires poppler which may not be present on the CI host.
    We mock _rasterize_page so these tests validate the OCR dispatch logic
    without requiring a system-level poppler install.
    """

    def test_scanned_pdf_calls_ocr(self) -> None:
        """A page with no text layer should invoke the OCR adapter."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol, OcrWord
        from app.infrastructure.pdf.pdf_parser import PdfParser

        ocr_words = [
            OcrWord(text="Invoice", bbox=(0.1, 0.1, 0.2, 0.05)),
            OcrWord(text="Total", bbox=(0.1, 0.2, 0.15, 0.05)),
        ]
        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=ocr_words)

        # Simulate a page with no usable text by patching extract layers to
        # return empty strings and _rasterize_page to return dummy bytes.
        parser = PdfParser(ocr=mock_ocr)
        with (
            patch.object(parser, "_extract_text_layers", return_value=[_PageExtract(text="", tokens=())]),
            patch.object(parser, "_rasterize_page", return_value=b"fake-png"),
        ):
            components = asyncio.run(
                parser.parse(
                    file_bytes=b"%PDF-1.4 fake",
                    content_type="application/pdf",
                    attachment_id="att-scan",
                )
            )

        assert len(components) >= 1
        # OCR must have been called at least once
        mock_ocr.ocr_page.assert_called()

    def test_scanned_pdf_content_text_from_ocr(self) -> None:
        """Components from a scanned page should carry text from OcrWord tokens."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol, OcrWord
        from app.infrastructure.pdf.pdf_parser import PdfParser

        ocr_words = [
            OcrWord(text="Hello", bbox=(0.1, 0.1, 0.1, 0.05)),
            OcrWord(text="World", bbox=(0.2, 0.1, 0.1, 0.05)),
        ]
        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=ocr_words)

        parser = PdfParser(ocr=mock_ocr)
        with (
            patch.object(parser, "_extract_text_layers", return_value=[_PageExtract(text="", tokens=())]),
            patch.object(parser, "_rasterize_page", return_value=b"fake-png"),
        ):
            components = asyncio.run(
                parser.parse(
                    file_bytes=b"%PDF-1.4 fake",
                    content_type="application/pdf",
                    attachment_id="att-scan",
                )
            )

        ocr_texts = [c.content_text for c in components if c.content_text]
        assert any("Hello" in t or "World" in t for t in ocr_texts)


# ---------------------------------------------------------------------------
# Corrupt / encrypted PDF tests
# ---------------------------------------------------------------------------


@skip_no_pdf
class TestPdfParserCorrupt:
    def test_corrupt_pdf_returns_parse_error_component(self) -> None:
        """parse() on corrupt bytes must NOT raise — returns a parse-error Component."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        pdf_bytes = (FIXTURES_DIR / "corrupt.pdf").read_bytes()
        parser = PdfParser(ocr=mock_ocr)
        # Must not raise
        components = asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-corrupt",
            )
        )

        assert len(components) >= 1
        assert any("parse_error" in c.location for c in components)

    def test_corrupt_pdf_components_have_empty_content(self) -> None:
        """Parse-error Components must carry empty content_text."""
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        pdf_bytes = (FIXTURES_DIR / "corrupt.pdf").read_bytes()
        parser = PdfParser(ocr=mock_ocr)
        components = asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-corrupt",
            )
        )

        error_components = [c for c in components if "parse_error" in c.location]
        for c in error_components:
            assert c.content_text == ""
            assert c.source_type == "attachment_page"


# ---------------------------------------------------------------------------
# Geometry retention tests (04-13) — content_raw token bboxes on both paths
# ---------------------------------------------------------------------------


class TestPdfParserGeometryUnit:
    """White-box tests for token geometry that need no heavy PDF deps."""

    def test_component_from_text_persists_token_geometry(self) -> None:
        from app.infrastructure.pdf.pdf_parser import PdfParser

        parser = PdfParser.__new__(PdfParser)
        tokens = (
            {"text": "Invoice", "bbox": [0.1, 0.1, 0.3, 0.05]},
            {"text": "Total", "bbox": [0.1, 0.2, 0.2, 0.05]},
        )
        comp = parser._component_from_text(
            page_index=0,
            page_text="Invoice Total",
            tokens=tokens,
            attachment_id="att",
        )
        assert comp.content_raw == {"source": "text_layer", "tokens": list(tokens)}
        # Polygon is the union of the two token bboxes, not the full page.
        polygon = comp.location["polygon"]
        assert polygon == [[0.1, 0.1], [0.4, 0.1], [0.4, 0.25], [0.1, 0.25]]

    def test_component_from_text_empty_tokens_falls_back_to_full_page(self) -> None:
        from app.infrastructure.pdf.pdf_parser import _FULL_PAGE_POLYGON, PdfParser

        parser = PdfParser.__new__(PdfParser)
        comp = parser._component_from_text(
            page_index=0,
            page_text="hello world",
            tokens=(),
            attachment_id="att",
        )
        assert comp.content_raw == {"source": "text_layer", "tokens": []}
        assert comp.location["polygon"] == _FULL_PAGE_POLYGON

    def test_component_from_ocr_persists_per_word_geometry(self) -> None:
        from app.infrastructure.ocr.ocr_protocol import OcrWord
        from app.infrastructure.pdf.pdf_parser import PdfParser

        parser = PdfParser.__new__(PdfParser)
        words = [
            OcrWord(text="Inv", bbox=(0.1, 0.1, 0.2, 0.05)),
            OcrWord(text="Tot", bbox=(0.1, 0.2, 0.15, 0.05)),
        ]
        comp = parser._component_from_ocr(page_index=0, ocr_words=words, attachment_id="att")
        raw = comp.content_raw
        assert raw is not None
        assert raw["source"] == "ocr"
        tokens = raw["tokens"]
        assert isinstance(tokens, list)
        assert [t["text"] for t in tokens] == ["Inv", "Tot"]
        assert tokens[0]["bbox"] == [0.1, 0.1, 0.2, 0.05]

    def test_component_from_ocr_empty_words_degrades(self) -> None:
        from app.infrastructure.pdf.pdf_parser import _FULL_PAGE_POLYGON, PdfParser

        parser = PdfParser.__new__(PdfParser)
        comp = parser._component_from_ocr(page_index=0, ocr_words=[], attachment_id="att")
        assert comp.content_raw == {"source": "ocr", "tokens": []}
        assert comp.location["polygon"] == _FULL_PAGE_POLYGON


@skip_no_pdf
class TestPdfParserGeometryIntegration:
    """End-to-end: a real born-digital PDF persists normalized token geometry."""

    def test_text_layer_page_has_normalized_token_bboxes(self) -> None:
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import _FULL_PAGE_POLYGON, PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])

        pdf_bytes = _build_text_pdf("Hello world invoice total " * 3)
        parser = PdfParser(ocr=mock_ocr)
        components = asyncio.run(
            parser.parse(
                file_bytes=pdf_bytes,
                content_type="application/pdf",
                attachment_id="att-geo",
            )
        )

        raw = components[0].content_raw
        assert raw is not None
        assert raw["source"] == "text_layer"
        tokens = raw["tokens"]
        assert isinstance(tokens, list)
        assert len(tokens) >= 1
        for token in tokens:
            bbox = token["bbox"]
            assert len(bbox) == 4
            assert all(0.0 <= float(v) <= 1.0 for v in bbox)
        # Real text occupies part of the page → union polygon is not full-page.
        assert components[0].location["polygon"] != _FULL_PAGE_POLYGON


# ---------------------------------------------------------------------------
# Deterministic page identity (REG-1) — re-parsing must yield the SAME ids
# ---------------------------------------------------------------------------


class TestPdfParserDeterministicIds:
    """REG-1 root cause: uuid4-per-parse page ids made every re-ingest INSERT
    fresh duplicate attachment_page rows through the id-upsert. Page ids must
    be a pure function of (attachment_id, page_index)."""

    @skip_no_pdf
    def test_reparse_same_pdf_yields_identical_component_ids(self) -> None:
        from app.infrastructure.ocr.ocr_protocol import OCRProtocol
        from app.infrastructure.pdf.pdf_parser import PdfParser

        mock_ocr = AsyncMock(spec=OCRProtocol)
        mock_ocr.ocr_page = AsyncMock(return_value=[])
        pdf_bytes = _build_text_pdf("Hello world invoice total " * 3)

        first = asyncio.run(
            PdfParser(ocr=mock_ocr).parse(file_bytes=pdf_bytes, content_type="application/pdf", attachment_id="att-det")
        )
        second = asyncio.run(
            PdfParser(ocr=mock_ocr).parse(file_bytes=pdf_bytes, content_type="application/pdf", attachment_id="att-det")
        )

        assert [c.id for c in first] == [c.id for c in second]
        assert len({c.id for c in first}) == len(first)  # still unique per page

    def test_text_ocr_and_error_paths_share_the_page_identity(self) -> None:
        """All three Component factories mint the same id for the same
        (attachment_id, page_index) — an error row upserts over a prior good
        row and vice versa, never a duplicate."""
        from app.domain.services.attachment_page_identity import attachment_page_component_id
        from app.infrastructure.pdf.pdf_parser import PdfParser, _make_parse_error_component

        parser = PdfParser.__new__(PdfParser)
        expected = attachment_page_component_id("att-x", 3)

        text_comp = parser._component_from_text(page_index=3, page_text="hi", tokens=(), attachment_id="att-x")
        ocr_comp = parser._component_from_ocr(page_index=3, ocr_words=[], attachment_id="att-x")
        err_comp = _make_parse_error_component("att-x", 3, "boom", 3)

        assert text_comp.id == expected
        assert ocr_comp.id == expected
        assert err_comp.id == expected

    def test_different_attachments_and_pages_get_distinct_ids(self) -> None:
        from app.domain.services.attachment_page_identity import attachment_page_component_id

        ids = {
            attachment_page_component_id("att-a", 0),
            attachment_page_component_id("att-a", 1),
            attachment_page_component_id("att-b", 0),
            attachment_page_component_id("att-b", 1),
        }
        assert len(ids) == 4


# ---------------------------------------------------------------------------
# Helper — build a minimal valid text PDF in memory
# ---------------------------------------------------------------------------


def _build_text_pdf(text: str) -> bytes:
    """Return bytes for a minimal PDF with *text* embedded as a text stream."""
    # Build using raw PDF structure so no extra deps needed
    content_stream = (f"BT\n/F1 12 Tf\n50 700 Td\n({text}) Tj\nET\n").encode()
    content_len = len(content_stream)

    body = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n"
        b"   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Length "
        + str(content_len).encode()
        + b" >>\nstream\n"
        + content_stream
        + b"\nendstream\nendobj\n"
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
        b"xref\n0 6\n0000000000 65535 f \n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\n"
        b"startxref\n9\n%%EOF\n"
    )
    return body
