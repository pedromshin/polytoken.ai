"""ProposeRegionsUseCase — page Components -> proposed child region Components.

Runs the SegmenterProtocol over each persisted attachment_page Component and
persists the resulting child region Components via ComponentRepository.save_many.

Architecture contract: this module imports ONLY domain ports and entities.
No infrastructure imports are permitted (verified by lint-imports rule).
"""

from __future__ import annotations

import uuid

import structlog

from app.domain.entities.component import Component
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.segmenter_protocol import PageToken, ProposedRegion, SegmenterProtocol
from app.domain.services.attachment_page_identity import attachment_page_component_id

logger = structlog.get_logger(__name__)

# Full-page polygon fallback (4-corner [x,y] pairs, clockwise from top-left).
_FULL_PAGE_POLYGON: list[list[float]] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]


def _page_tokens(page: Component) -> list[PageToken]:
    """Read 04-13 token geometry from page.content_raw into PageToken objects.

    Returns [] when content_raw carries no usable tokens (older data / image-only
    pages). Malformed token entries are skipped.
    """
    raw = page.content_raw
    if not isinstance(raw, dict):
        return []
    raw_tokens = raw.get("tokens")
    if not isinstance(raw_tokens, list):
        return []

    tokens: list[PageToken] = []
    for index, entry in enumerate(raw_tokens):
        if not isinstance(entry, dict):
            continue
        bbox = entry.get("bbox")
        if not (isinstance(bbox, (list, tuple)) and len(bbox) == 4):
            continue
        tokens.append(
            PageToken(
                index=index,
                text=str(entry.get("text", "")),
                bbox=(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
            )
        )
    return tokens


def _dedup_pages(pages: list[Component]) -> list[Component]:
    """Keep exactly one page Component per (attachment_id, page_index) — REG-1 defense.

    Page ids are deterministic since REG-1 (uuid5 over attachment_id +
    page_index), so re-ingest upserts pages in place and duplicates no longer
    accrue. Emails ingested BEFORE that fix may still carry several rows for
    the same physical page; segmenting each copy would multiply the proposed
    regions on every reprocess. Selection among duplicates:

    1. Prefer the row whose id equals the canonical deterministic id — that is
       the row current re-ingests upsert, i.e. the freshest content.
    2. Otherwise fall back to the lexicographically smallest id, so the choice
       is stable across runs (historical duplicates are byte-identical copies).

    Input order is preserved for the surviving rows.
    """
    chosen: dict[tuple[str | None, object], Component] = {}
    order: list[tuple[str | None, object]] = []
    duplicate_count = 0

    for page in pages:
        raw_index = page.location.get("page_index", 0)
        key = (page.attachment_id, raw_index)

        existing = chosen.get(key)
        if existing is None:
            chosen[key] = page
            order.append(key)
            continue

        duplicate_count += 1
        canonical: str | None = None
        if page.attachment_id is not None and isinstance(raw_index, (int, float, str)):
            try:
                canonical = attachment_page_component_id(page.attachment_id, int(raw_index))
            except (TypeError, ValueError):
                canonical = None

        if existing.id == canonical:
            continue  # already holding the canonical (freshest) row
        if page.id == canonical or page.id < existing.id:
            chosen[key] = page

    if duplicate_count:
        logger.warning(
            "propose_regions_duplicate_pages_skipped",
            duplicate_page_rows=duplicate_count,
            surviving_pages=len(chosen),
        )

    return [chosen[key] for key in order]


def _page_polygon(page: Component) -> list[list[float]]:
    """Return the page Component's own polygon, or the full-page fallback."""
    polygon = page.location.get("polygon")
    if isinstance(polygon, list) and polygon:
        return polygon
    return _FULL_PAGE_POLYGON


def _union_polygon(boxes: list[tuple[float, float, float, float]]) -> list[list[float]]:
    """Return a 4-corner [x,y] polygon bounding the union of (left,top,width,height) boxes.

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


class ProposeRegionsUseCase:
    """Segment each persisted page Component and persist proposed child regions.

    Collaborators injected at construction:
        components: ComponentRepository — find pages, persist children.
        segmenter: SegmenterProtocol — LLM-backed region proposal (never raises).

    Per-page failures are isolated: a segment() exception is logged and the
    page is skipped, but other pages still produce children.  Empty-text pages
    are skipped without calling the model.  save_many is called once with all
    children accumulated across pages.
    """

    def __init__(
        self,
        *,
        components: ComponentRepository,
        segmenter: SegmenterProtocol,
    ) -> None:
        self._components = components
        self._segmenter = segmenter

    async def execute(self, *, email_id: str, importer_id: str) -> list[Component]:
        """Propose region Components for all pages belonging to *email_id*.

        Returns the list of persisted child Components (may be empty).
        """
        all_components = await self._components.find_by_email_id(email_id)
        pages = _dedup_pages([c for c in all_components if c.source_type == "attachment_page"])

        logger.info(
            "propose_regions_start",
            email_id=email_id,
            page_count=len(pages),
        )

        children: list[Component] = []

        for page in pages:
            if not page.content_text.strip():
                logger.debug(
                    "propose_regions_skip_empty_page",
                    email_id=email_id,
                    page_component_id=page.id,
                )
                continue

            raw_page_index = page.location.get("page_index", 0)
            page_index = int(raw_page_index) if isinstance(raw_page_index, (int, float, str)) else 0

            page_tokens = _page_tokens(page)

            try:
                proposals = await self._segmenter.segment(
                    tokens=tuple(page_tokens),
                    page_index=page_index,
                )
            except Exception:
                logger.exception(
                    "propose_regions_page_failed",
                    email_id=email_id,
                    page_component_id=page.id,
                )
                continue

            page_children = self._build_children(
                proposals=proposals,
                page=page,
                page_tokens=page_tokens,
                email_id=email_id,
                importer_id=importer_id,
                sequence_offset=len(children),
            )
            children.extend(page_children)

        if children:
            persisted = await self._components.save_many(children)
            logger.info(
                "propose_regions_done",
                email_id=email_id,
                child_count=len(persisted),
            )
            return persisted

        logger.info(
            "propose_regions_done",
            email_id=email_id,
            child_count=0,
        )
        return []

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_children(
        *,
        proposals: list[ProposedRegion],
        page: Component,
        page_tokens: list[PageToken],
        email_id: str,
        importer_id: str,
        sequence_offset: int,
    ) -> list[Component]:
        """Map ProposedRegion list to child Component objects.

        Region polygon (04-14): the union of the bboxes of the tokens the model
        selected (proposal.token_indices). When the selection resolves to no
        valid tokens, falls back to the page's own polygon (never an invented box).

        parent_index resolution:
          - None  → parent_component_id = page.id (top-level region)
          - valid index into already-mapped siblings → that sibling's id
          - out-of-range / negative → falls back to page.id
        """
        token_by_index = {token.index: token for token in page_tokens}
        page_polygon = _page_polygon(page)

        mapped: list[Component] = []

        for seq_idx, proposal in enumerate(proposals):
            parent_id = _resolve_parent(
                parent_index=proposal.parent_index,
                mapped=mapped,
                page_id=page.id,
            )

            selected_boxes = [token_by_index[i].bbox for i in proposal.token_indices if i in token_by_index]
            polygon = _union_polygon(selected_boxes) if selected_boxes else page_polygon

            child = Component(
                id=str(uuid.uuid4()),
                email_id=email_id,
                importer_id=importer_id,
                attachment_id=page.attachment_id,
                parent_component_id=parent_id,
                source_type="region",
                location={
                    "page_index": proposal.page_index,
                    "polygon": polygon,
                },
                content_text=proposal.content_text,
                content_markdown=None,
                content_raw=None,
                embedding=None,
                sequence_index=sequence_offset + seq_idx,
                extraction_status="pending",
            )
            mapped.append(child)

        return mapped


def _resolve_parent(
    *,
    parent_index: int | None,
    mapped: list[Component],
    page_id: str,
) -> str:
    """Return the parent_component_id for a proposal.

    Falls back to *page_id* when parent_index is None or out-of-range.
    """
    if parent_index is None:
        return page_id
    if 0 <= parent_index < len(mapped):
        return mapped[parent_index].id
    return page_id
