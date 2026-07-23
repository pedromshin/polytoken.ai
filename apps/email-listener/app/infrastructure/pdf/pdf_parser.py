"""PdfParser — adaptive per-page text/OCR extraction implementing ParserProtocol.

Strategy per page (D-07):
1. Extract text via pdfminer.six (high-fidelity layout extraction).
2. If detect_text_layer() returns True → build Component from text.
3. If False (scanned / image-only page) → rasterize with pdf2image, call OCR adapter.

Components carry normalized 0-1 polygon geometry (D-12) and source_type="attachment_page".

Security / robustness (T-04-11, T-04-13):
- MAX_PAGES and MAX_FILE_MB caps reject oversized inputs early.
- Per-page exceptions degrade to a parse-error Component; the whole parse() never raises.
- Whole-document open failures also produce a single parse-error Component.

Note on importer_id / email_id:
  Parser receives only attachment_id.  email_id and importer_id are stitched by the
  DecomposeEmailUseCase (04-06) after all attachments are parsed.  They are stored
  as "" placeholders here, clearly documented, so the domain entity constraint is
  satisfied without requiring parse() to know about the parent email.
"""

from __future__ import annotations

import asyncio
import io
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import structlog

from app.domain.services.attachment_page_identity import attachment_page_component_id
from app.infrastructure.ocr.ocr_protocol import OcrWord
from app.infrastructure.pdf.parser_registry import UnsupportedFileTypeError
from app.infrastructure.pdf.text_layer import detect_text_layer

if TYPE_CHECKING:
    from app.domain.entities.component import Component
    from app.infrastructure.ocr.ocr_protocol import OCRProtocol

logger = structlog.get_logger(__name__)

# Safety caps (T-04-11)
MAX_PAGES: int = 200
MAX_FILE_MB: float = 50.0
MAX_FILE_BYTES: int = int(MAX_FILE_MB * 1024 * 1024)

# PDF rasterisation DPI (balances OCR accuracy vs memory)
RASTER_DPI: int = 150

# Full-page normalized polygon (corners clockwise from top-left)
_FULL_PAGE_POLYGON: list[list[float]] = [
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
    [0.0, 1.0],
]

_PDF_CONTENT_TYPES: frozenset[str] = frozenset({"application/pdf", "application/x-pdf"})


@dataclass(frozen=True)
class _PageExtract:
    """Per-page text-layer extraction result: joined text + token geometry.

    tokens is a tuple of {"text": str, "bbox": [left, top, width, height]} dicts,
    each bbox normalized to 0-1 with a top-left origin (matching OcrWord layout).
    Empty when pdfminer found no usable text elements (e.g. image-only pages).
    """

    text: str
    tokens: tuple[dict[str, object], ...]


def _clamp01(value: float) -> float:
    """Clamp a coordinate to the [0, 1] range."""
    return max(0.0, min(1.0, float(value)))


def _token_boxes(tokens: tuple[dict[str, object], ...]) -> list[tuple[float, float, float, float]]:
    """Extract (left, top, width, height) tuples from token dicts, skipping malformed ones."""
    boxes: list[tuple[float, float, float, float]] = []
    for token in tokens:
        bbox = token.get("bbox")
        if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
            boxes.append((float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])))
    return boxes


def _union_polygon(boxes: list[tuple[float, float, float, float]]) -> list[list[float]]:
    """Return a 4-corner polygon bounding the union of (left, top, width, height) boxes.

    Falls back to the full-page polygon when the box list is empty.
    """
    if not boxes:
        return _FULL_PAGE_POLYGON
    lefts = [b[0] for b in boxes]
    tops = [b[1] for b in boxes]
    rights = [b[0] + b[2] for b in boxes]
    bottoms = [b[1] + b[3] for b in boxes]
    min_left = min(lefts)
    min_top = min(tops)
    max_right = max(rights)
    max_bottom = max(bottoms)
    return [
        [min_left, min_top],
        [max_right, min_top],
        [max_right, max_bottom],
        [min_left, max_bottom],
    ]


def _bbox_union(words: list[OcrWord]) -> list[list[float]]:
    """Return a 4-corner polygon bounding the union of OcrWord bboxes.

    Falls back to the full-page polygon when the word list is empty.
    """
    return _union_polygon([w.bbox for w in words])


def _normalize_text_element(element: Any, page_width: float, page_height: float) -> dict[str, object] | None:
    """Build a normalized token dict from a pdfminer LTTextContainer element.

    pdfminer bboxes are (x0, y0, x1, y1) in PDF points with a BOTTOM-LEFT origin;
    this normalizes to 0-1 and flips Y to a top-left origin so text tokens share
    the OcrWord layout: [left, top, width, height]. Returns None for empty-text or
    zero-area / malformed elements (degrade gracefully — never raise).
    """
    text = element.get_text().strip()
    if not text:
        return None
    try:
        x0, y0, x1, y1 = element.bbox
    except (AttributeError, ValueError, TypeError):
        return None
    if page_width <= 0 or page_height <= 0:
        return None
    width = (x1 - x0) / page_width
    height = (y1 - y0) / page_height
    if width <= 0 or height <= 0:
        return None
    left = x0 / page_width
    top = (page_height - y1) / page_height  # flip Y: PDF bottom-left -> top-left origin
    return {
        "text": text,
        "bbox": [_clamp01(left), _clamp01(top), _clamp01(width), _clamp01(height)],
    }


def _make_parse_error_component(
    attachment_id: str,
    page_index: int,
    error_repr: str,
    sequence_index: int,
) -> Component:
    from app.domain.entities.component import Component

    # Deterministic id (REG-1): a re-ingest of the same attachment upserts the
    # same row instead of stacking a fresh duplicate page per run.
    return Component(
        id=attachment_page_component_id(attachment_id, page_index),
        email_id="",
        importer_id="",
        attachment_id=attachment_id,
        parent_component_id=None,
        source_type="attachment_page",
        location={
            "page_index": page_index,
            "parse_error": error_repr,
            "polygon": _FULL_PAGE_POLYGON,
        },
        content_text="",
        content_markdown=None,
        content_raw=None,
        embedding=None,
        sequence_index=sequence_index,
        extraction_status="error",
    )


class PdfParser:
    """Implements ParserProtocol for PDF attachments.

    Constructor parameters:
        ocr: OCRProtocol implementation (e.g. TextractOcrAdapter).
        max_workers: Thread pool size for blocking PDF operations.
    """

    def __init__(
        self,
        *,
        ocr: OCRProtocol,
        max_workers: int = 1,
    ) -> None:
        self._ocr = ocr
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    # ------------------------------------------------------------------
    # Public async interface (ParserProtocol)
    # ------------------------------------------------------------------

    async def parse(
        self,
        *,
        file_bytes: bytes,
        content_type: str,
        attachment_id: str,
    ) -> list[Component]:
        """Parse *file_bytes* as a PDF and return one Component per page.

        Raises UnsupportedFileTypeError for non-PDF content_type.
        Never raises for content errors — degrades to parse-error Components.
        """
        if content_type not in _PDF_CONTENT_TYPES:
            raise UnsupportedFileTypeError(
                f"PdfParser does not handle content_type='{content_type}'. Only application/pdf is supported."
            )

        if len(file_bytes) > MAX_FILE_BYTES:
            logger.warning(
                "pdf_file_too_large",
                attachment_id=attachment_id,
                size_bytes=len(file_bytes),
                max_bytes=MAX_FILE_BYTES,
            )
            return [
                _make_parse_error_component(
                    attachment_id,
                    0,
                    f"file_too_large:{len(file_bytes)}",
                    0,
                )
            ]

        loop = asyncio.get_event_loop()
        # Extract text layers synchronously in a thread to avoid blocking.
        # Timeout guards against pdfminer hanging on pathological PDFs (e.g. Adobe-Identity-UCS).
        # On timeout we fall through to pypdf page count + OCR for every page.
        pdfminer_timeout_s = 60.0
        try:
            pages: list[_PageExtract] = await asyncio.wait_for(
                loop.run_in_executor(self._executor, self._extract_text_layers, file_bytes),
                timeout=pdfminer_timeout_s,
            )
        except TimeoutError:
            logger.warning(
                "pdf_text_extraction_timeout",
                attachment_id=attachment_id,
                timeout_s=pdfminer_timeout_s,
            )
            pages = self._count_pages_pypdf(file_bytes)
        except Exception as exc:
            logger.warning(
                "pdf_document_open_failed",
                attachment_id=attachment_id,
                error=repr(exc),
            )
            return [_make_parse_error_component(attachment_id, 0, repr(exc), 0)]

        components: list[Component] = []
        for page_index, page in enumerate(pages):
            component = await self._process_page(
                page_index=page_index,
                page_text=page.text,
                tokens=page.tokens,
                file_bytes=file_bytes,
                attachment_id=attachment_id,
                loop=loop,
            )
            components.append(component)

        return components

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _extract_text_layers(self, file_bytes: bytes) -> list[_PageExtract]:
        """Extract text + per-element geometry from each page using pdfminer.six.

        Returns one _PageExtract per page (joined text + normalized token bboxes).
        Raises on document-level failures (encrypted, truncated, not a PDF).
        """
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTTextContainer

        pages: list[_PageExtract] = []
        pdf_io = io.BytesIO(file_bytes)
        page_count = 0
        for page_layout in extract_pages(pdf_io):
            if page_count >= MAX_PAGES:
                logger.warning("pdf_max_pages_reached", max_pages=MAX_PAGES)
                break
            page_width = float(getattr(page_layout, "width", 0.0) or 0.0)
            page_height = float(getattr(page_layout, "height", 0.0) or 0.0)
            page_chars: list[str] = []
            tokens: list[dict[str, object]] = []
            for element in page_layout:
                if isinstance(element, LTTextContainer):
                    page_chars.append(element.get_text())
                    token = _normalize_text_element(element, page_width, page_height)
                    if token is not None:
                        tokens.append(token)
            pages.append(_PageExtract(text="".join(page_chars), tokens=tuple(tokens)))
            page_count += 1  # noqa: SIM113 — guards the MAX_PAGES break above; enumerate would not gate the break

        if not pages:
            # pdfminer yielded no pages — might be image-only or corrupt
            # Try counting pages with pypdf as a fallback
            pages = self._count_pages_pypdf(file_bytes)

        return pages

    def _count_pages_pypdf(self, file_bytes: bytes) -> list[_PageExtract]:
        """Use pypdf to determine page count when pdfminer finds no text.

        Returns one empty _PageExtract per page (no text, no token geometry) so
        per-page OCR fallback is triggered for every page.
        """
        import pypdf

        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        count = min(len(reader.pages), MAX_PAGES)
        return [_PageExtract(text="", tokens=()) for _ in range(count)]

    async def _process_page(
        self,
        *,
        page_index: int,
        page_text: str,
        tokens: tuple[dict[str, object], ...],
        file_bytes: bytes,
        attachment_id: str,
        loop: asyncio.AbstractEventLoop,
    ) -> Component:
        """Build a Component for a single page, using text layer or OCR."""
        try:
            if detect_text_layer(page_text):
                return self._component_from_text(
                    page_index=page_index,
                    page_text=page_text,
                    tokens=tokens,
                    attachment_id=attachment_id,
                )
            # Text layer absent/garbage → OCR path
            image_bytes = await loop.run_in_executor(
                self._executor,
                self._rasterize_page,
                file_bytes,
                page_index,
            )
            ocr_words = await self._ocr.ocr_page(image_bytes=image_bytes)
            return self._component_from_ocr(
                page_index=page_index,
                ocr_words=ocr_words,
                attachment_id=attachment_id,
            )
        except Exception as exc:
            logger.warning(
                "pdf_page_parse_failed",
                attachment_id=attachment_id,
                page_index=page_index,
                error=repr(exc),
            )
            return _make_parse_error_component(attachment_id, page_index, repr(exc), page_index)

    def _rasterize_page(self, file_bytes: bytes, page_index: int) -> bytes:
        """Rasterize a single PDF page to PNG bytes for OCR.

        Returns the PNG bytes.  Raises on failure (caller wraps in try/except).
        """
        import pdf2image

        images = pdf2image.convert_from_bytes(
            file_bytes,
            dpi=RASTER_DPI,
            first_page=page_index + 1,
            last_page=page_index + 1,
            fmt="png",
        )
        if not images:
            raise ValueError(f"pdf2image returned no images for page {page_index}")
        buf = io.BytesIO()
        images[0].save(buf, format="PNG")
        return buf.getvalue()

    def _component_from_text(
        self,
        *,
        page_index: int,
        page_text: str,
        tokens: tuple[dict[str, object], ...],
        attachment_id: str,
    ) -> Component:
        from app.domain.entities.component import Component

        char_count = len(page_text)
        text_anchor: dict[str, Any] = {"char_start": 0, "char_end": char_count}

        # Real geometry: page polygon is the union of element bboxes (full-page
        # fallback when no tokens). Per-token bboxes persisted in content_raw (D-12).
        polygon = _union_polygon(_token_boxes(tokens))

        # Deterministic id (REG-1): re-ingest upserts the same page row in place.
        return Component(
            id=attachment_page_component_id(attachment_id, page_index),
            email_id="",
            importer_id="",
            attachment_id=attachment_id,
            parent_component_id=None,
            source_type="attachment_page",
            location={
                "page_index": page_index,
                "polygon": polygon,
                "text_anchor": text_anchor,
            },
            content_text=page_text.strip(),
            content_markdown=None,
            content_raw={"source": "text_layer", "tokens": list(tokens)},
            embedding=None,
            sequence_index=page_index,
            extraction_status="pending",
        )

    def _component_from_ocr(
        self,
        *,
        page_index: int,
        ocr_words: list[OcrWord],
        attachment_id: str,
    ) -> Component:
        from app.domain.entities.component import Component

        content_text = " ".join(w.text for w in ocr_words)
        polygon = _bbox_union(ocr_words)
        tokens: list[dict[str, object]] = [{"text": w.text, "bbox": list(w.bbox)} for w in ocr_words]

        # Deterministic id (REG-1): re-ingest upserts the same page row in place.
        return Component(
            id=attachment_page_component_id(attachment_id, page_index),
            email_id="",
            importer_id="",
            attachment_id=attachment_id,
            parent_component_id=None,
            source_type="attachment_page",
            location={
                "page_index": page_index,
                "polygon": polygon,
                "source": "ocr",
            },
            content_text=content_text,
            content_markdown=None,
            content_raw={"source": "ocr", "tokens": tokens},
            embedding=None,
            sequence_index=page_index,
            extraction_status="pending",
        )
