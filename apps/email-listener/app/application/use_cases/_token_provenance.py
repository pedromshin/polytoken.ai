"""Shared page-token <-> polygon provenance helper.

Extracted from edit_region.py's original `_capture_text` so both region-edit
operations and the knowledge-graph synthesizer (SYNTH-02) can derive the same
OCR token-polygon provenance from a page's content_raw.tokens without
duplicating the intersection logic.

Architecture contract: imports ONLY domain ports/entities and sibling
application-layer modules. No infrastructure imports permitted (verified by
lint-imports rule).
"""

from __future__ import annotations

from app.application.use_cases.propose_regions import _page_tokens
from app.domain.entities.component import Component


def capture_provenance(page: Component, polygon: list[list[float]]) -> dict[str, object]:
    """Return {tokens, text} for tokens on `page` whose bboxes intersect `polygon`.

    The polygon is treated as its axis-aligned bounding box (min/max x,y).
    Token bboxes are (left, top, width, height) in [0,1] normalized coords.

    `tokens` is a list of {"text": str, "bbox": [left, top, width, height]} for
    every overlapping token (grounding data for provenance jsonb payloads).
    `text` is the space-joined token text (identical to the pre-extraction
    `_capture_text` behavior). Returns {"tokens": [], "text": ""} when no
    tokens overlap or the page has no token data.
    """
    if not polygon:
        return {"tokens": [], "text": ""}

    xs = [pt[0] for pt in polygon]
    ys = [pt[1] for pt in polygon]
    p_left = min(xs)
    p_right = max(xs)
    p_top = min(ys)
    p_bottom = max(ys)

    tokens = _page_tokens(page)
    matched: list[dict[str, object]] = []
    texts: list[str] = []
    for token in tokens:
        t_left, t_top, t_width, t_height = token.bbox
        t_right = t_left + t_width
        t_bottom = t_top + t_height
        # Check bounding box overlap
        if t_right > p_left and t_left < p_right and t_bottom > p_top and t_top < p_bottom:
            matched.append({"text": token.text, "bbox": list(token.bbox)})
            texts.append(token.text)

    return {"tokens": matched, "text": " ".join(texts)}


def capture_text(page: Component, polygon: list[list[float]]) -> str:
    """Return just the space-joined token text (thin wrapper for existing callers)."""
    result = capture_provenance(page, polygon)
    return str(result["text"])
