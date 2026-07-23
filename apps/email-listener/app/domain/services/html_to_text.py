"""Minimal, dependency-free HTML -> plain-text extraction (domain layer).

Used when an inbound email carries only an HTML body (no text/plain part):
the body component's content_text must be clean prose, not tag soup, so the
segmenter and entity classifier see readable content. Stdlib-only
(html.parser) to keep the domain layer free of external deps (import-linter).

This is deliberately simple — it drops <script>/<style> content, turns block
elements and <br> into line breaks, decodes entities, and collapses runs of
whitespace. It is NOT a full HTML renderer; it is a good-enough text
extractor for entity extraction over marketing/transactional emails.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

_DROP_CONTENT_TAGS = {"script", "style", "head", "title", "noscript"}
_BLOCK_TAGS = {
    "p", "div", "br", "li", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "section", "article", "header", "footer", "blockquote", "pre",
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._suppress_depth = 0

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in _DROP_CONTENT_TAGS:
            self._suppress_depth += 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_CONTENT_TAGS and self._suppress_depth > 0:
            self._suppress_depth -= 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._suppress_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def html_to_text(html: str) -> str:
    """Extract readable plain text from an HTML string.

    Collapses intra-line whitespace, preserves paragraph/line breaks, and
    trims each line. Returns "" for empty/None-ish input.
    """
    if not html or not html.strip():
        return ""
    extractor = _TextExtractor()
    try:
        extractor.feed(html)
        extractor.close()
    except Exception:
        # A malformed document must never crash ingestion — fall back to a
        # crude tag strip so we still get *some* text.
        return _collapse(re.sub(r"<[^>]+>", " ", html))
    return _collapse(extractor.text())


def _collapse(text: str) -> str:
    # Decoded &nbsp; is U+00A0 — treat it as a normal space for splitting/collapsing.
    text = text.replace("\u00a0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    # Drop blank lines but keep single blank separators between paragraphs.
    out: list[str] = []
    for line in lines:
        if line:
            out.append(line)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()
