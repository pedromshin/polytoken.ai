"""Tests for ProposeRegionsUseCase — page Components -> proposed child region Components.

04-14: the segmenter receives coordinate-bearing tokens (from 04-13 content_raw) and
returns token_indices per region; the use case grounds each region polygon in the union
of the selected tokens' real bboxes.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.domain.entities.component import Component
from app.domain.ports.segmenter_protocol import PageToken, ProposedRegion


def _flat(polygon: Any) -> list[float]:
    """Flatten a [[x,y],...] polygon to [x,y,x,y,...] for approx comparison."""
    return [float(v) for pair in polygon for v in pair]


# ---------------------------------------------------------------------------
# Test helpers / fakes
# ---------------------------------------------------------------------------

# Three tokens with known bboxes [left, top, width, height] (normalized 0-1).
_DEFAULT_TOKENS: list[dict[str, object]] = [
    {"text": "Invoice", "bbox": [0.10, 0.10, 0.20, 0.05]},
    {"text": "No.", "bbox": [0.35, 0.10, 0.10, 0.05]},
    {"text": "12345", "bbox": [0.50, 0.10, 0.15, 0.05]},
]


def _make_page_component(
    *,
    page_index: int = 0,
    content_text: str = "Invoice No. 12345",
    tokens: list[dict[str, object]] | None = None,
    attachment_id: str = "att-001",
    email_id: str = "email-001",
    importer_id: str = "imp-001",
) -> Component:
    raw_tokens = _DEFAULT_TOKENS if tokens is None else tokens
    return Component(
        id=str(uuid.uuid4()),
        email_id=email_id,
        importer_id=importer_id,
        attachment_id=attachment_id,
        parent_component_id=None,
        source_type="attachment_page",
        location={"page_index": page_index, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]},
        content_text=content_text,
        content_markdown=None,
        content_raw={"source": "text_layer", "tokens": raw_tokens},
        embedding=None,
        sequence_index=page_index,
        extraction_status="pending",
    )


def _make_fake_segmenter(
    proposals_per_call: list[list[ProposedRegion]] | None = None,
    raises_on_call: int | None = None,
) -> MagicMock:
    """Return a fake SegmenterProtocol.

    proposals_per_call: list of return values per successive call.
    raises_on_call: if set, the call at that 0-based index raises RuntimeError.
    """
    segmenter = MagicMock()
    call_results: list[Any] = list(proposals_per_call or [[]])
    call_count = {"n": 0}

    async def _segment(*, tokens: tuple[PageToken, ...], page_index: int) -> list[ProposedRegion]:
        idx = call_count["n"]
        call_count["n"] += 1
        if raises_on_call is not None and idx == raises_on_call:
            raise RuntimeError("segmenter boom")
        return call_results[idx] if idx < len(call_results) else []

    segmenter.segment = _segment
    return segmenter


class FakeComponentRepository:
    """In-memory fake ComponentRepository."""

    def __init__(self, page_components: list[Component]) -> None:
        self._pages = page_components
        self.saved: list[Component] = []

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        return [c for c in self._pages if c.email_id == email_id]

    async def save_many(self, components: list[Component]) -> list[Component]:
        self.saved.extend(components)
        return components

    async def find_by_id(self, component_id: str) -> Component | None:
        return None

    async def update_embedding(self, component_id: str, embedding: tuple[float, ...]) -> None:
        pass


def _import_use_case() -> type:
    from app.application.use_cases.propose_regions import ProposeRegionsUseCase

    return ProposeRegionsUseCase


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestProposeRegionsUseCase:
    EMAIL_ID = "email-001"
    IMPORTER_ID = "imp-001"

    def _make_use_case(
        self,
        page_components: list[Component],
        segmenter: Any,
    ) -> Any:
        use_case_cls = _import_use_case()
        repo = FakeComponentRepository(page_components)
        return use_case_cls(components=repo, segmenter=segmenter), repo

    # ------------------------------------------------------------------
    # Grounded geometry (04-14)
    # ------------------------------------------------------------------

    def test_region_polygon_is_union_of_selected_token_bboxes(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [
            ProposedRegion(
                content_text="Invoice No.",
                token_indices=(0, 1),  # union of tokens 0 and 1
                entity_type_hint="invoice_number",
                parent_index=None,
                page_index=0,
            )
        ]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert len(result) == 1
        child = result[0]
        assert child.source_type == "region"
        assert child.email_id == self.EMAIL_ID
        assert child.parent_component_id == page.id
        assert child.content_text == "Invoice No."
        # Union of token 0 [0.10,0.10,0.20,0.05] and token 1 [0.35,0.10,0.10,0.05]:
        # left=0.10, top=0.10, right=max(0.30,0.45)=0.45, bottom=0.15
        assert _flat(child.location["polygon"]) == pytest.approx([0.10, 0.10, 0.45, 0.10, 0.45, 0.15, 0.10, 0.15])

    def test_single_token_region_polygon_equals_that_token_box(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [ProposedRegion("12345", (2,), "invoice_number", None, 0)]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        # token 2 = [0.50, 0.10, 0.15, 0.05] → corners
        assert _flat(result[0].location["polygon"]) == pytest.approx([0.50, 0.10, 0.65, 0.10, 0.65, 0.15, 0.50, 0.15])

    def test_empty_token_selection_falls_back_to_page_polygon(self) -> None:
        page = _make_page_component(page_index=0)
        # token_indices empty AND out-of-range both resolve to no valid tokens
        proposals = [
            ProposedRegion("No tokens", (), None, None, 0),
            ProposedRegion("Bad index", (99,), None, None, 0),
        ]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert result[0].location["polygon"] == page.location["polygon"]
        assert result[1].location["polygon"] == page.location["polygon"]

    def test_page_without_tokens_grounds_to_page_polygon(self) -> None:
        page = _make_page_component(page_index=0, tokens=[])  # content_raw has no tokens
        proposals = [ProposedRegion("Region", (0, 1), None, None, 0)]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        # No tokens to select → page polygon fallback (never an invented box)
        assert result[0].location["polygon"] == page.location["polygon"]

    def test_save_many_called_with_all_children(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [
            ProposedRegion("A", (0,), None, None, 0),
            ProposedRegion("B", (1, 2), None, None, 0),
        ]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, repo = self._make_use_case([page], segmenter)

        asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert len(repo.saved) == 2

    # ------------------------------------------------------------------
    # Nested proposals (parent_index resolution)
    # ------------------------------------------------------------------

    def test_nested_proposal_sets_parent_to_resolved_sibling_id(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [
            ProposedRegion("Parent region", (0, 1, 2), None, None, 0),
            ProposedRegion("Child region", (1,), None, 0, 0),  # parent_index=0
        ]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        parent_child = result[0]
        nested_child = result[1]
        assert parent_child.parent_component_id == page.id
        assert nested_child.parent_component_id == parent_child.id

    def test_out_of_range_parent_index_falls_back_to_page_id(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [ProposedRegion("Only region", (0,), None, 99, 0)]  # out-of-range parent_index
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert result[0].parent_component_id == page.id

    # ------------------------------------------------------------------
    # Junk / empty pages
    # ------------------------------------------------------------------

    def test_junk_page_empty_proposals_yields_no_children(self) -> None:
        page = _make_page_component(page_index=0, content_text="Garbage#@!~~")
        segmenter = _make_fake_segmenter(proposals_per_call=[[]])  # empty list = junk
        use_case, repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert result == []
        assert repo.saved == []

    def test_empty_content_text_page_is_skipped_without_calling_segmenter(self) -> None:
        page = _make_page_component(page_index=0, content_text="   ")  # whitespace-only
        call_count = {"n": 0}

        class TrackingSegmenter:
            async def segment(self, *, tokens: tuple[PageToken, ...], page_index: int) -> list[ProposedRegion]:
                call_count["n"] += 1
                return []

        use_case, _repo = self._make_use_case([page], TrackingSegmenter())

        asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert call_count["n"] == 0

    # ------------------------------------------------------------------
    # Per-page failure isolation
    # ------------------------------------------------------------------

    def test_page_segmenter_exception_is_isolated_and_others_process(self) -> None:
        page0 = _make_page_component(page_index=0, content_text="Page 0 text")
        page1 = _make_page_component(page_index=1, content_text="Page 1 text")

        proposals_page1 = [ProposedRegion("Found it", (0,), None, None, 1)]
        # page0 call (idx=0) raises; page1 call (idx=1) returns proposals
        segmenter = _make_fake_segmenter(
            proposals_per_call=[[], proposals_page1],
            raises_on_call=0,
        )
        use_case, _repo = self._make_use_case([page0, page1], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert len(result) == 1
        assert result[0].content_text == "Found it"

    def test_page_failure_does_not_propagate_to_caller(self) -> None:
        page = _make_page_component(page_index=0, content_text="Some text")
        segmenter = _make_fake_segmenter(raises_on_call=0)
        use_case, _repo = self._make_use_case([page], segmenter)

        # Must not raise
        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))
        assert result == []

    # ------------------------------------------------------------------
    # Only page components are used (non-page components ignored)
    # ------------------------------------------------------------------

    def test_only_attachment_page_components_are_segmented(self) -> None:
        page = _make_page_component(page_index=0)
        non_page = Component(
            id=str(uuid.uuid4()),
            email_id=self.EMAIL_ID,
            importer_id=self.IMPORTER_ID,
            attachment_id=None,
            parent_component_id=None,
            source_type="region",  # not attachment_page
            location={},
            content_text="Some region",
            content_markdown=None,
            content_raw=None,
            embedding=None,
            sequence_index=0,
            extraction_status="pending",
        )
        proposals = [ProposedRegion("Invoice No.", (0,), None, None, 0)]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page, non_page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        assert len(result) == 1

    # ------------------------------------------------------------------
    # sequence_index
    # ------------------------------------------------------------------

    def test_child_components_have_sequential_sequence_index(self) -> None:
        page = _make_page_component(page_index=0)
        proposals = [
            ProposedRegion("A", (0,), None, None, 0),
            ProposedRegion("B", (1,), None, None, 0),
        ]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals])
        use_case, _repo = self._make_use_case([page], segmenter)

        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))

        indices = [c.sequence_index for c in result]
        assert indices == list(range(len(result)))


# ---------------------------------------------------------------------------
# REG-1 defensive dedup — historical duplicate page rows segment only once
# ---------------------------------------------------------------------------


class TestProposeRegionsDedup:
    """Emails ingested before deterministic page ids can carry several
    attachment_page rows for the same physical page. The use case must
    segment each (attachment_id, page_index) exactly once, or every
    reprocess multiplies the pending regions."""

    EMAIL_ID = "email-001"
    IMPORTER_ID = "imp-001"

    def _run(self, pages: list[Component], segmenter: Any) -> tuple[list[Component], Any, Any]:
        use_case_cls = _import_use_case()
        repo = FakeComponentRepository(pages)
        use_case = use_case_cls(components=repo, segmenter=segmenter)
        result = asyncio.run(use_case.execute(email_id=self.EMAIL_ID, importer_id=self.IMPORTER_ID))
        return result, repo, use_case

    def test_duplicate_page_rows_are_segmented_once(self) -> None:
        # Three historical uuid4 duplicates of the SAME page (att-001, page 0).
        duplicates = [_make_page_component(page_index=0) for _ in range(3)]
        proposals = [
            ProposedRegion("Invoice No.", (0, 1), None, None, 0),
            ProposedRegion("12345", (2,), None, None, 0),
        ]
        # Give the segmenter enough return values for every call: were dedup
        # broken, all three calls would succeed and children would triple.
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals, proposals, proposals])

        result, _repo, _uc = self._run(duplicates, segmenter)

        # One page's worth of children, not three.
        assert len(result) == 2

    def test_dedup_prefers_the_canonical_deterministic_page_row(self) -> None:
        from app.domain.services.attachment_page_identity import attachment_page_component_id

        canonical_id = attachment_page_component_id("att-001", 0)
        stale = _make_page_component(page_index=0, content_text="stale copy")
        fresh = _make_page_component(page_index=0, content_text="fresh copy")
        fresh = Component(
            id=canonical_id,
            email_id=fresh.email_id,
            importer_id=fresh.importer_id,
            attachment_id=fresh.attachment_id,
            parent_component_id=None,
            source_type="attachment_page",
            location=fresh.location,
            content_text=fresh.content_text,
            content_markdown=None,
            content_raw=fresh.content_raw,
            embedding=None,
            sequence_index=0,
            extraction_status="pending",
        )
        proposals = [ProposedRegion("Invoice No.", (0,), None, None, 0)]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals, proposals])

        # Stale row listed FIRST — selection must still land on the canonical id.
        result, _repo, _uc = self._run([stale, fresh], segmenter)

        assert len(result) == 1
        assert result[0].parent_component_id == canonical_id

    def test_distinct_pages_are_all_segmented(self) -> None:
        page0 = _make_page_component(page_index=0)
        page1 = _make_page_component(page_index=1)
        other_att = _make_page_component(page_index=0, attachment_id="att-002")
        proposals = [ProposedRegion("X", (0,), None, None, 0)]
        segmenter = _make_fake_segmenter(proposals_per_call=[proposals, proposals, proposals])

        result, _repo, _uc = self._run([page0, page1, other_att], segmenter)

        # No false dedup across pages or attachments.
        assert len(result) == 3
