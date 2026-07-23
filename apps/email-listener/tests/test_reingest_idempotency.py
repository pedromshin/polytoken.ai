"""REG-1 behavioral regression: re-ingesting the same email must not grow rows.

Before the fix, PdfParser minted uuid4 page ids on every parse, so each
reprocess INSERTED fresh duplicate attachment_page rows through the id-upsert,
and ProposeRegionsUseCase then segmented every duplicate — pending regions
multiplied on every run (the "thousands of duplicate boxes" bug).

This test drives the REAL use-case stack — IngestInboundEmailUseCase with the
real PdfParser (OCR + rasterization stubbed), the real ProposeRegionsUseCase,
and the real ReprocessEmailUseCase — over an in-memory component repository
with true upsert-on-id semantics and simulated DB row timestamps. It asserts
the USER-VISIBLE invariant: two consecutive reprocesses of the same email with
a multi-page PDF attachment leave the attachment_page row count and the
pending-region count exactly where they were.
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import replace
from email.message import EmailMessage
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

try:
    import pypdf

    _HAS_PDF = True
except ImportError:  # pragma: no cover - dep-gated environment
    _HAS_PDF = False

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.domain.entities.component import Component
from app.domain.entities.email import Email
from app.domain.ports.segmenter_protocol import PageToken, ProposedRegion

skip_no_pdf = pytest.mark.skipif(not _HAS_PDF, reason="pypdf not installed")

IMPORTER_ID = "imp-reg1"
SES_MESSAGE_ID = "ses-reg1-001"


# ---------------------------------------------------------------------------
# In-memory collaborators with production-shaped semantics
# ---------------------------------------------------------------------------


class InMemoryComponentRepository:
    """Upsert-on-id component store with simulated DB row timestamps.

    Mirrors the two behaviors REG-1 hinges on:
    - save_many upserts on id (same id -> overwrite in place, new id -> insert),
      exactly like the Supabase repo's upsert(on_conflict="id");
    - created_at is assigned by the STORE on first insert (the "DB clock"),
      preserved on upsert, and supersede honors the inclusive created_before
      bound the same way the SQL `created_at <= cutoff` filter does.
    """

    def __init__(self) -> None:
        self.rows: dict[str, Component] = {}
        self.created_at: dict[str, str] = {}
        self._tick = 0

    def _next_ts(self) -> str:
        self._tick += 1
        return f"2026-07-23T00:00:00.{self._tick:06d}+00:00"

    async def save_many(self, components: list[Component]) -> list[Component]:
        for c in components:
            if c.id not in self.rows:
                self.created_at[c.id] = self._next_ts()
            self.rows[c.id] = c
        return list(components)

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        return [c for c in self.rows.values() if c.email_id == email_id]

    async def latest_component_created_at(self, email_id: str) -> str | None:
        stamps = [self.created_at[c.id] for c in self.rows.values() if c.email_id == email_id]
        return max(stamps) if stamps else None

    async def supersede_pending_regions(self, email_id: str, *, created_before: str | None = None) -> int:
        count = 0
        for component_id, component in list(self.rows.items()):
            if component.email_id != email_id:
                continue
            if component.source_type != "region" or component.extraction_status != "pending":
                continue
            if created_before is not None and self.created_at[component_id] > created_before:
                continue
            self.rows[component_id] = replace(component, extraction_status="superseded")
            count += 1
        return count

    async def find_unclassified_candidate_regions(self, email_id: str) -> list[Component]:
        return []

    # Convenience for assertions ------------------------------------------------

    def pages(self) -> list[Component]:
        return [c for c in self.rows.values() if c.source_type == "attachment_page"]

    def pending_regions(self) -> list[Component]:
        return [c for c in self.rows.values() if c.source_type == "region" and c.extraction_status == "pending"]

    def superseded_regions(self) -> list[Component]:
        return [c for c in self.rows.values() if c.source_type == "region" and c.extraction_status == "superseded"]


class InMemoryEmailRepository:
    """Stores emails by (importer_id, message_id) and id — redelivery reuses the row."""

    def __init__(self) -> None:
        self._by_key: dict[tuple[str, str], Email] = {}
        self._by_id: dict[str, Email] = {}

    async def find_by_message_id(self, importer_id: str, message_id: str) -> Email | None:
        return self._by_key.get((importer_id, message_id))

    async def save(self, email: Email) -> Email:
        self._by_key[(email.importer_id, email.message_id)] = email
        self._by_id[email.id] = email
        return email

    async def find_by_id(self, email_id: str) -> Email | None:
        return self._by_id.get(email_id)


class RepeatingSegmenter:
    """Deterministic segmenter: always proposes TWO regions per non-empty page."""

    async def segment(self, *, tokens: tuple[PageToken, ...], page_index: int) -> list[ProposedRegion]:
        text = " ".join(t.text for t in tokens) or "region"
        return [
            ProposedRegion(text, tuple(t.index for t in tokens), None, None, page_index),
            ProposedRegion("total", (), None, None, page_index),
        ]


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _two_page_pdf() -> bytes:
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _raw_email(pdf_bytes: bytes) -> bytes:
    msg = EmailMessage()
    msg["From"] = "Maria <maria@exporter.com>"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "Shipping docs"
    msg["Message-ID"] = "<reg1-001@exporter.com>"
    msg.set_content("see attached")
    msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf", filename="bl.pdf")
    return bytes(msg)


def _build_stack() -> tuple[IngestInboundEmailUseCase, ReprocessEmailUseCase, InMemoryComponentRepository, Any]:
    from app.infrastructure.ocr.ocr_protocol import OcrWord
    from app.infrastructure.pdf.pdf_parser import PdfParser

    repo = InMemoryComponentRepository()
    email_repo = InMemoryEmailRepository()

    raw = _raw_email(_two_page_pdf())
    raw_store = MagicMock()
    raw_store.fetch = AsyncMock(return_value=raw)
    raw_store.key_for = MagicMock(side_effect=lambda ses_id: f"inbound/local/{ses_id}")

    attachment_repo = MagicMock()
    attachment_repo.save = AsyncMock(side_effect=lambda att: att)
    attachment_storage = MagicMock()
    attachment_storage.store = AsyncMock()

    # Real PdfParser; both blank pages take the OCR path. OCR words give the
    # pages non-empty content_text so propose_regions actually segments them.
    ocr = MagicMock()
    ocr.ocr_page = AsyncMock(
        return_value=[
            OcrWord(text="Invoice", bbox=(0.1, 0.1, 0.2, 0.05)),
            OcrWord(text="12345", bbox=(0.35, 0.1, 0.15, 0.05)),
        ]
    )
    parser = PdfParser(ocr=ocr)

    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=IMPORTER_ID)
    thread_resolver = MagicMock()
    thread_resolver.resolve = AsyncMock(return_value=None)
    forwarding_resolver = MagicMock()
    forwarding_resolver.resolve_recipients = AsyncMock(return_value=None)

    propose_regions = ProposeRegionsUseCase(components=repo, segmenter=RepeatingSegmenter())

    ingest = IngestInboundEmailUseCase(
        raw_store=raw_store,
        email_repo=email_repo,
        attachment_repo=attachment_repo,
        attachment_storage=attachment_storage,
        config=IngestionConfig(default_importer_id=IMPORTER_ID),
        components=repo,
        parser_registry=lambda ext: parser if ext == "pdf" else None,
        propose_regions=propose_regions,
        importer_resolver=importer_resolver,
        thread_resolver=thread_resolver,
        forwarding_resolver=forwarding_resolver,
    )

    reprocess = ReprocessEmailUseCase(
        emails=email_repo,
        components=repo,
        extractions=AsyncMock(),
        ingest=ingest,
    )
    return ingest, reprocess, repo, parser


# ---------------------------------------------------------------------------
# The regression
# ---------------------------------------------------------------------------


@skip_no_pdf
def test_two_consecutive_reprocesses_do_not_grow_pages_or_pending_regions() -> None:
    ingest, reprocess, repo, parser = _build_stack()

    with patch.object(parser, "_rasterize_page", return_value=b"fake-png"):
        email = asyncio.run(ingest.execute(SES_MESSAGE_ID))

        # Initial ingest: 2 pages, 2 proposals per page.
        assert len(repo.pages()) == 2
        initial_page_ids = {c.id for c in repo.pages()}
        assert len(repo.pending_regions()) == 4

        first = asyncio.run(reprocess.execute(email_id=email.id))
        pages_after_first = repo.pages()
        assert len(pages_after_first) == 2, "reprocess duplicated attachment_page rows"
        assert {c.id for c in pages_after_first} == initial_page_ids, "page ids drifted across re-ingest"
        assert len(repo.pending_regions()) == 4, "reprocess accumulated pending regions"
        assert first["superseded_components"] == 4
        assert len(repo.superseded_regions()) == 4

        second = asyncio.run(reprocess.execute(email_id=email.id))
        pages_after_second = repo.pages()
        assert len(pages_after_second) == 2, "second reprocess duplicated attachment_page rows"
        assert {c.id for c in pages_after_second} == initial_page_ids
        assert len(repo.pending_regions()) == 4, "second reprocess accumulated pending regions"
        assert second["superseded_components"] == 4
        assert len(repo.superseded_regions()) == 8  # audit trail grows; live rows do not


@skip_no_pdf
def test_reprocess_replaces_pending_regions_with_fresh_rows() -> None:
    """The pending regions after a reprocess are NEW proposals (fresh ids);
    the old ones are retired to superseded, never deleted or duplicated."""
    ingest, reprocess, repo, parser = _build_stack()

    with patch.object(parser, "_rasterize_page", return_value=b"fake-png"):
        email = asyncio.run(ingest.execute(SES_MESSAGE_ID))
        before_ids = {c.id for c in repo.pending_regions()}

        asyncio.run(reprocess.execute(email_id=email.id))
        after_ids = {c.id for c in repo.pending_regions()}

        assert before_ids.isdisjoint(after_ids)
        assert {c.id for c in repo.superseded_regions()} == before_ids


@skip_no_pdf
def test_historical_uuid4_page_duplicates_do_not_multiply_regions_on_reprocess() -> None:
    """Emails ingested BEFORE deterministic page ids may already hold duplicate
    page rows. A reprocess over that legacy state must not multiply regions:
    the propose pass dedups to one row per (attachment_id, page_index)."""
    ingest, reprocess, repo, parser = _build_stack()

    with patch.object(parser, "_rasterize_page", return_value=b"fake-png"):
        email = asyncio.run(ingest.execute(SES_MESSAGE_ID))

        # Simulate the legacy corruption: clone each page under a random id,
        # as the old uuid4-per-parse behavior would have left behind.
        import uuid as _uuid

        legacy_clones = [replace(page, id=str(_uuid.uuid4())) for page in repo.pages()]
        asyncio.run(repo.save_many(legacy_clones))
        assert len(repo.pages()) == 4  # 2 real + 2 legacy duplicates

        result = asyncio.run(reprocess.execute(email_id=email.id))

        # Still 2 physical pages' worth of proposals: 2 regions x 2 pages.
        assert len(repo.pending_regions()) == 4, "duplicate page rows multiplied the proposed regions"
        assert result["superseded_components"] == 4
