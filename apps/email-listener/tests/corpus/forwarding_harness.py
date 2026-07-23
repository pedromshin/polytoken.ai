"""Forwarding harness — feed a corpus PDF through IngestInboundEmailUseCase.

Provides:
    forward_corpus_file(path, *, importer_id, ingest_use_case, content_type)

The harness wraps a local corpus file as a minimal RFC 2822 MIME message with
one PDF attachment, builds in-memory fakes for all infrastructure ports, and
drives IngestInboundEmailUseCase.execute() without touching S3, Supabase, or
any real AWS service.

Fakes provided:
    LocalFileRawEmailStore   — reads file_bytes from an in-memory dict keyed by
                               synthetic SES message ids
    InMemoryAttachmentStorage — stores blobs in a dict (no Supabase)
    InMemoryEmailRepository   — dict-backed; satisfies EmailRepository protocol
    InMemoryAttachmentRepository — dict-backed; satisfies AttachmentRepository
    InMemoryComponentRepository  — dict-backed; satisfies ComponentRepository
    FixedImporterResolver     — always resolves to the supplied importer_id
    NullThreadResolver        — always resolves to no thread (Phase 45, THRD-01)
    NullForwardingAddressResolver — always resolves to no user (Phase 45, THRD-04)

Usage example::

    import asyncio
    from pathlib import Path
    from tests.corpus.forwarding_harness import forward_corpus_file
    from app.domain.ports.segmenter_protocol import ProposedRegion, SegmenterProtocol

    class FakeSegmenter:
        async def segment(self, *, page_text: str, page_index: int) -> list[ProposedRegion]:
            return []

    async def main() -> None:
        email, components = await forward_corpus_file(
            Path("tests/corpus/hard_cases/multi-invoice-in-one-pdf.pdf"),
            importer_id="test-importer-001",
            content_type="application/pdf",
            fake_segmenter=FakeSegmenter(),
        )
        print(f"Ingested {len(components)} components")

    asyncio.run(main())
"""

from __future__ import annotations

import email.mime.application
import email.mime.multipart
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domain.entities.attachment import Attachment
    from app.domain.entities.component import Component
    from app.domain.entities.email import Email
    from app.domain.ports.segmenter_protocol import SegmenterProtocol

# ---------------------------------------------------------------------------
# In-memory fakes for all infrastructure ports
# ---------------------------------------------------------------------------


class LocalFileRawEmailStore:
    """RawEmailStore fake backed by an in-memory MIME bytes dict."""

    def __init__(self, mime_bytes_by_id: dict[str, bytes]) -> None:
        self._store: dict[str, bytes] = dict(mime_bytes_by_id)

    def key_for(self, message_id: str) -> str:
        return f"fake/raw/{message_id}"

    async def fetch(self, message_id: str) -> bytes:
        if message_id not in self._store:
            raise KeyError(f"No raw MIME stored for message_id={message_id!r}")
        return self._store[message_id]


class InMemoryAttachmentStorage:
    """AttachmentStorage fake — stores bytes in a dict."""

    def __init__(self) -> None:
        self._blobs: dict[str, bytes] = {}

    async def store(self, storage_key: str, data: bytes, content_type: str) -> None:
        _ = content_type
        self._blobs = {**self._blobs, storage_key: data}

    async def fetch(self, storage_key: str) -> bytes:
        return self._blobs[storage_key]


@dataclass
class InMemoryEmailRepository:
    """EmailRepository fake — dict-backed, satisfies EmailRepository protocol."""

    _rows: dict[str, Email] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rows = {}

    async def find_by_message_id(self, importer_id: str, message_id: str) -> Email | None:
        for row in self._rows.values():
            if row.importer_id == importer_id and row.message_id == message_id:
                return row
        return None

    async def save(self, entity: Email) -> Email:
        self._rows = {**self._rows, entity.id: entity}
        return entity

    async def find_all(self, importer_id: str, *, limit: int = 50, offset: int = 0) -> list[Email]:
        rows = [r for r in self._rows.values() if r.importer_id == importer_id]
        return rows[offset : offset + limit]

    async def find_by_id(self, email_id: str) -> Email | None:
        return self._rows.get(email_id)

    async def count_all(self, importer_id: str) -> int:
        return sum(1 for r in self._rows.values() if r.importer_id == importer_id)

    async def update_parse_status(
        self, email_id: str, status: str, error: str | None, *, parsed_at: object | None = None
    ) -> None:
        from dataclasses import replace

        row = self._rows.get(email_id)
        if row is not None:
            self._rows = {**self._rows, email_id: replace(row, parse_status=status, parse_error=error)}


@dataclass
class InMemoryAttachmentRepository:
    """AttachmentRepository fake — dict-backed."""

    _rows: dict[str, Attachment] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rows = {}

    async def save(self, entity: Attachment) -> Attachment:
        self._rows = {**self._rows, entity.id: entity}
        return entity

    async def find_by_email_id(self, email_id: str) -> list[Attachment]:
        return [r for r in self._rows.values() if r.email_id == email_id]

    async def find_by_id(self, attachment_id: str) -> Attachment | None:
        return self._rows.get(attachment_id)


@dataclass
class InMemoryComponentRepository:
    """ComponentRepository fake — dict-backed."""

    _rows: dict[str, Component] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rows = {}

    async def save_many(self, components: list[Component]) -> list[Component]:
        new_rows = {**self._rows, **{c.id: c for c in components}}
        self._rows = new_rows
        return components

    async def find_by_email_id(self, email_id: str) -> list[Component]:
        return [c for c in self._rows.values() if c.email_id == email_id]

    async def find_by_id(self, component_id: str) -> Component | None:
        return self._rows.get(component_id)

    async def find_by_attachment_id(self, attachment_id: str) -> list[Component]:
        return [c for c in self._rows.values() if c.attachment_id == attachment_id]


class FixedImporterResolver:
    """ImporterResolver fake that always returns a fixed importer_id."""

    def __init__(self, importer_id: str) -> None:
        self._importer_id = importer_id

    async def resolve(self, sender_address: str, *, user_id: str | None = None) -> str:
        _ = (sender_address, user_id)
        return self._importer_id


class NullThreadResolver:
    """ThreadResolver fake (Phase 45, THRD-01) — always resolves to no thread.

    Keeps the harness deterministic and DB-free: corpus runs care about
    parsing/segmentation output, not thread grouping.
    """

    async def resolve(self, **kwargs: object) -> None:  # type: ignore[override]
        _ = kwargs


class NullForwardingAddressResolver:
    """ForwardingAddressResolver fake (Phase 45, THRD-04) — always resolves to no user.

    Keeps the harness deterministic and DB-free: corpus runs use a fixed
    importer directly and never exercise the forwarding-token seam.
    """

    async def resolve_recipients(self, recipients: object) -> None:  # type: ignore[override]
        _ = recipients


# ---------------------------------------------------------------------------
# MIME construction helper
# ---------------------------------------------------------------------------


def _build_mime_message(
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    sender: str = "test@example.com",
    recipient: str = "agent@magnitudetech.com.br",
    subject: str = "Corpus test attachment",
    message_id: str | None = None,
) -> bytes:
    """Wrap file_bytes as an RFC 2822 MIME message with one attachment."""
    msg = email.mime.multipart.MIMEMultipart()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg["Message-ID"] = message_id or f"<corpus-{uuid.uuid4()}@harness.test>"

    part = email.mime.application.MIMEApplication(file_bytes, _subtype="pdf")
    part.add_header("Content-Disposition", "attachment", filename=filename)
    part.add_header("Content-Type", content_type)
    msg.attach(part)

    return msg.as_bytes()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def forward_corpus_file(
    path: Path,
    *,
    importer_id: str,
    content_type: str = "application/pdf",
    fake_segmenter: SegmenterProtocol,
) -> tuple[Email, list[Component]]:
    """Read *path*, wrap as a forwarded email, and drive IngestInboundEmailUseCase.

    Returns (persisted_email, all_components) where components includes both
    attachment_page Components (from PdfParser) and region Components (from
    ProposeRegionsUseCase).

    All infrastructure ports are satisfied by in-memory fakes — no S3, no
    Supabase, no AWS credentials required.

    Parameters
    ----------
    path:
        Path to the corpus PDF file (relative to CWD or absolute).
    importer_id:
        The importer_id to assign to the ingested email.
    content_type:
        MIME content type of the attachment (default: application/pdf).
    fake_segmenter:
        A SegmenterProtocol implementation used by ProposeRegionsUseCase.
        Pass a fake/mock that returns [] to keep the run deterministic.
    """
    import asyncio

    from app.application.use_cases.ingest_inbound_email import (
        IngestInboundEmailUseCase,
        IngestionConfig,
    )
    from app.application.use_cases.propose_regions import ProposeRegionsUseCase
    from app.infrastructure.ocr.ocr_protocol import OCRProtocol
    from app.infrastructure.pdf.pdf_parser import PdfParser

    file_bytes = await asyncio.to_thread(Path(path).read_bytes)
    filename = Path(path).name
    ses_message_id = f"corpus-{uuid.uuid4()}"

    mime_bytes = _build_mime_message(
        file_bytes=file_bytes,
        filename=filename,
        content_type=content_type,
        message_id=f"<{ses_message_id}@harness.test>",
    )

    # In-memory fakes
    raw_store = LocalFileRawEmailStore({ses_message_id: mime_bytes})
    attachment_storage = InMemoryAttachmentStorage()
    email_repo: InMemoryEmailRepository = InMemoryEmailRepository()
    attachment_repo = InMemoryAttachmentRepository()
    component_repo = InMemoryComponentRepository()
    importer_resolver = FixedImporterResolver(importer_id)
    thread_resolver = NullThreadResolver()
    forwarding_resolver = NullForwardingAddressResolver()

    # Null OCR adapter (no Textract calls in unit harness)
    class _NullOcr:
        async def ocr_page(self, *, image_bytes: bytes) -> list:  # type: ignore[override]
            _ = image_bytes
            return []

    null_ocr: OCRProtocol = _NullOcr()  # type: ignore[assignment]
    pdf_parser = PdfParser(ocr=null_ocr)

    def _parser_registry(ext: str) -> PdfParser | None:
        return pdf_parser if ext in ("pdf",) else None

    propose_regions_uc = ProposeRegionsUseCase(
        components=component_repo,  # type: ignore[arg-type]
        segmenter=fake_segmenter,
    )

    config = IngestionConfig(default_importer_id=importer_id)

    use_case = IngestInboundEmailUseCase(
        raw_store=raw_store,  # type: ignore[arg-type]
        email_repo=email_repo,  # type: ignore[arg-type]
        attachment_repo=attachment_repo,  # type: ignore[arg-type]
        attachment_storage=attachment_storage,  # type: ignore[arg-type]
        config=config,
        components=component_repo,  # type: ignore[arg-type]
        parser_registry=_parser_registry,  # type: ignore[arg-type]
        propose_regions=propose_regions_uc,
        importer_resolver=importer_resolver,  # type: ignore[arg-type]
        thread_resolver=thread_resolver,  # type: ignore[arg-type]
        forwarding_resolver=forwarding_resolver,  # type: ignore[arg-type]
    )

    persisted_email = await use_case.execute(ses_message_id)
    all_components = await component_repo.find_by_email_id(persisted_email.id)

    return persisted_email, all_components
