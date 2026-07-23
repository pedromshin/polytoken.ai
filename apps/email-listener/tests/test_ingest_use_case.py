"""Tests for IngestInboundEmailUseCase — fetch raw → parse → persist email + attachments."""

from __future__ import annotations

import asyncio
import uuid
from email.message import EmailMessage
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
from app.domain.entities.component import Component
from app.domain.entities.email import Email

IMPORTER_ID = "imp-default"
SES_MESSAGE_ID = "ses-abc-123"
PDF_BYTES = b"%PDF-1.4 fake"


def _raw_email(with_attachment: bool = True) -> bytes:
    msg = EmailMessage()
    msg["From"] = "Maria <maria@exporter.com>"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "Docs"
    msg["Date"] = "Wed, 10 Jun 2026 14:30:00 +0000"
    msg["Message-ID"] = "<mime-001@exporter.com>"
    msg.set_content("see attached")
    if with_attachment:
        msg.add_attachment(PDF_BYTES, maintype="application", subtype="pdf", filename="bl.pdf")
    return bytes(msg)


def _make_page_component(attachment_id: str, email_id: str = "", importer_id: str = "") -> Component:
    """Build a fake page Component as a parser would return (empty email_id/importer_id placeholders)."""
    return Component(
        id=str(uuid.uuid4()),
        email_id=email_id,
        importer_id=importer_id,
        attachment_id=attachment_id,
        parent_component_id=None,
        source_type="attachment_page",
        location={"page_index": 0, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]},
        content_text="Page text",
        content_markdown=None,
        content_raw=None,
        embedding=None,
        sequence_index=0,
        extraction_status="pending",
    )


def _make_use_case(
    raw: bytes,
    existing_email: Email | None = None,
    *,
    parser_registry: MagicMock | None = None,
    components: MagicMock | None = None,
    propose_regions: MagicMock | None = None,
    importer_resolver: MagicMock | None = None,
    thread_resolver: MagicMock | None = None,
    forwarding_resolver: MagicMock | None = None,
) -> tuple[IngestInboundEmailUseCase, dict[str, MagicMock]]:
    """Factory that constructs IngestInboundEmailUseCase with all collaborators.

    Defaults (safe for pre-existing tests):
    - parser_registry returns None (no parser registered) → skip path
    - components.save_many is a no-op
    - propose_regions.execute is a no-op
    """
    raw_store = MagicMock()
    raw_store.fetch = AsyncMock(return_value=raw)
    raw_store.key_for.return_value = f"inbound/local/{SES_MESSAGE_ID}"

    email_repo = MagicMock()
    email_repo.find_by_message_id = AsyncMock(return_value=existing_email)
    email_repo.save = AsyncMock(side_effect=lambda email: email)
    email_repo.update_parse_status = AsyncMock(return_value=None)

    attachment_repo = MagicMock()
    attachment_repo.save = AsyncMock(side_effect=lambda att: att)

    attachment_storage = MagicMock()
    attachment_storage.store = AsyncMock()

    if components is None:
        components = MagicMock()
        components.save_many = AsyncMock(side_effect=lambda cs: cs)
        components.find_by_email_id = AsyncMock(return_value=[])

    if parser_registry is None:
        parser_registry = MagicMock(return_value=None)

    if propose_regions is None:
        propose_regions = MagicMock()
        propose_regions.execute = AsyncMock(return_value=[])

    if importer_resolver is None:
        importer_resolver = MagicMock()
        importer_resolver.resolve = AsyncMock(return_value=IMPORTER_ID)

    if thread_resolver is None:
        thread_resolver = MagicMock()
        thread_resolver.resolve = AsyncMock(return_value=None)

    if forwarding_resolver is None:
        forwarding_resolver = MagicMock()
        forwarding_resolver.resolve_recipients = AsyncMock(return_value=None)

    use_case = IngestInboundEmailUseCase(
        raw_store=raw_store,
        email_repo=email_repo,
        attachment_repo=attachment_repo,
        attachment_storage=attachment_storage,
        config=IngestionConfig(default_importer_id=IMPORTER_ID),
        components=components,
        parser_registry=parser_registry,
        propose_regions=propose_regions,
        importer_resolver=importer_resolver,
        thread_resolver=thread_resolver,
        forwarding_resolver=forwarding_resolver,
    )
    mocks: dict[str, MagicMock] = {
        "raw_store": raw_store,
        "email_repo": email_repo,
        "attachment_repo": attachment_repo,
        "attachment_storage": attachment_storage,
        "components": components,
        "parser_registry": parser_registry,
        "propose_regions": propose_regions,
        "importer_resolver": importer_resolver,
        "thread_resolver": thread_resolver,
        "forwarding_resolver": forwarding_resolver,
    }
    return use_case, mocks


# ---------------------------------------------------------------------------
# Pre-existing tests — must remain green unchanged
# ---------------------------------------------------------------------------


def test_persists_email_with_parsed_fields() -> None:
    use_case, mocks = _make_use_case(_raw_email())

    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["raw_store"].fetch.assert_awaited_once_with(SES_MESSAGE_ID)
    mocks["email_repo"].save.assert_awaited_once()
    assert email.importer_id == IMPORTER_ID
    assert email.message_id == "<mime-001@exporter.com>"
    assert email.sender_address == "maria@exporter.com"
    assert email.sender_name == "Maria"
    assert email.subject == "Docs"
    assert email.raw_storage_key == f"inbound/local/{SES_MESSAGE_ID}"
    # ING-6: a clean ingest finalizes as 'parsed' (the lifecycle is driven,
    # no longer frozen at 'received').
    assert email.parse_status == "parsed"
    assert email.parsed_at is not None
    assert email.body_text is not None


def test_stores_attachment_bytes_and_row() -> None:
    use_case, mocks = _make_use_case(_raw_email())

    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["attachment_storage"].store.assert_awaited_once()
    storage_key, data, content_type = mocks["attachment_storage"].store.await_args.args
    assert data == PDF_BYTES
    assert content_type == "application/pdf"
    assert storage_key.startswith(f"{IMPORTER_ID}/{email.id}/")
    assert storage_key.endswith("/bl.pdf")

    mocks["attachment_repo"].save.assert_awaited_once()
    attachment = mocks["attachment_repo"].save.await_args.args[0]
    assert attachment.email_id == email.id
    assert attachment.importer_id == IMPORTER_ID
    assert attachment.filename == "bl.pdf"
    assert attachment.content_type == "application/pdf"
    assert attachment.file_ext == "pdf"
    assert attachment.size_bytes == len(PDF_BYTES)
    assert attachment.storage_key == storage_key
    assert attachment.parse_status == "pending"


def test_no_attachments_skips_storage() -> None:
    use_case, mocks = _make_use_case(_raw_email(with_attachment=False))

    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["attachment_storage"].store.assert_not_awaited()
    mocks["attachment_repo"].save.assert_not_awaited()


def test_redelivery_reuses_existing_email_id() -> None:
    """SNS redelivery must not change the email id (attachments stay linked)."""
    use_case_first, _ = _make_use_case(_raw_email())
    first = asyncio.run(use_case_first.execute(SES_MESSAGE_ID))

    use_case_again, mocks = _make_use_case(_raw_email(), existing_email=first)
    second = asyncio.run(use_case_again.execute(SES_MESSAGE_ID))

    mocks["email_repo"].find_by_message_id.assert_awaited_once_with(IMPORTER_ID, "<mime-001@exporter.com>")
    assert second.id == first.id
    assert second.created_at == first.created_at


def test_redelivery_keeps_attachment_ids_deterministic() -> None:
    use_case_first, mocks_first = _make_use_case(_raw_email())
    first = asyncio.run(use_case_first.execute(SES_MESSAGE_ID))
    first_att = mocks_first["attachment_repo"].save.await_args.args[0]

    use_case_again, mocks_again = _make_use_case(_raw_email(), existing_email=first)
    asyncio.run(use_case_again.execute(SES_MESSAGE_ID))
    second_att = mocks_again["attachment_repo"].save.await_args.args[0]

    assert second_att.id == first_att.id
    assert second_att.storage_key == first_att.storage_key


def test_falls_back_to_ses_message_id_when_no_mime_message_id() -> None:
    msg = EmailMessage()
    msg["From"] = "a@b.com"
    msg["To"] = "agent@magnitudetech.com.br"
    msg.set_content("x")
    use_case, _ = _make_use_case(bytes(msg))

    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email.message_id == SES_MESSAGE_ID
    assert email.received_at is not None  # falls back to now()


def test_raw_store_failure_propagates() -> None:
    use_case, mocks = _make_use_case(_raw_email())
    mocks["raw_store"].fetch = AsyncMock(side_effect=RuntimeError("S3 down"))

    with pytest.raises(RuntimeError, match="S3 down"):
        asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["email_repo"].save.assert_not_awaited()


# ---------------------------------------------------------------------------
# New Task 2 tests — parser dispatch + propose-regions hook
# ---------------------------------------------------------------------------


def _fake_parser_returning(page_component: Component) -> MagicMock:
    """Return a fake ParserProtocol that yields [page_component] on parse()."""
    parser = MagicMock()
    parser.parse = AsyncMock(return_value=[page_component])
    return parser


def test_parseable_attachment_dispatches_parser_and_persists_pages() -> None:
    """For a PDF attachment, parser.parse is called and page Components are persisted."""
    raw = _raw_email(with_attachment=True)

    components = MagicMock()
    saved_components: list[list[Component]] = []

    async def save_many(cs: list[Component]) -> list[Component]:
        saved_components.append(list(cs))
        return cs

    components.save_many = save_many
    components.find_by_email_id = AsyncMock(return_value=[])

    # Fake registry: returns a parser for "pdf"
    fake_page = _make_page_component(attachment_id="WILL_BE_STITCHED")
    fake_parser = _fake_parser_returning(fake_page)
    registry = MagicMock(side_effect=lambda ext: fake_parser if ext == "pdf" else None)

    use_case, _mocks = _make_use_case(raw, components=components, parser_registry=registry)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    fake_parser.parse.assert_awaited_once()
    # save_many should have been called with at least one batch of page Components
    assert len(saved_components) >= 1
    # Verify stitched email_id and importer_id (no "" placeholders)
    persisted_pages = [c for batch in saved_components for c in batch]
    assert all(c.email_id == email.id for c in persisted_pages)
    assert all(c.importer_id == IMPORTER_ID for c in persisted_pages)


def test_unsupported_attachment_is_skipped_ingestion_still_completes() -> None:
    """An attachment with no registered parser is skipped; ingestion returns the Email."""
    raw = _raw_email(with_attachment=True)

    # Registry returns None for all extensions
    registry = MagicMock(return_value=None)
    components = MagicMock()
    components.save_many = AsyncMock(side_effect=lambda cs: cs)
    components.find_by_email_id = AsyncMock(return_value=[])

    use_case, _mocks = _make_use_case(raw, components=components, parser_registry=registry)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email is not None
    assert email.importer_id == IMPORTER_ID
    # save_many not called (no page Components produced)
    components.save_many.assert_not_awaited()


def test_propose_regions_called_once_after_all_attachments() -> None:
    """propose_regions.execute is called exactly once after per-attachment processing."""
    raw = _raw_email(with_attachment=True)

    fake_page = _make_page_component(attachment_id="att-x")
    fake_parser = _fake_parser_returning(fake_page)
    registry = MagicMock(side_effect=lambda ext: fake_parser if ext == "pdf" else None)

    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(return_value=[])

    components = MagicMock()
    components.save_many = AsyncMock(side_effect=lambda cs: cs)
    components.find_by_email_id = AsyncMock(return_value=[])

    use_case, _mocks = _make_use_case(
        raw,
        components=components,
        parser_registry=registry,
        propose_regions=propose_regions,
    )
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    propose_regions.execute.assert_awaited_once_with(email_id=email.id, importer_id=IMPORTER_ID)


def test_propose_regions_called_even_when_no_parseable_attachment() -> None:
    """propose_regions.execute runs even if no attachment has a registered parser."""
    raw = _raw_email(with_attachment=True)

    registry = MagicMock(return_value=None)
    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(return_value=[])

    use_case, _mocks = _make_use_case(raw, parser_registry=registry, propose_regions=propose_regions)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    propose_regions.execute.assert_awaited_once_with(email_id=email.id, importer_id=IMPORTER_ID)


def test_parser_failure_is_isolated_ingestion_still_completes() -> None:
    """A parser.parse exception for one attachment does not abort ingestion."""
    raw = _raw_email(with_attachment=True)

    failing_parser = MagicMock()
    failing_parser.parse = AsyncMock(side_effect=RuntimeError("parse boom"))
    registry = MagicMock(return_value=failing_parser)

    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(return_value=[])

    use_case, _mocks = _make_use_case(raw, parser_registry=registry, propose_regions=propose_regions)
    # Must not raise
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email is not None
    # propose_regions still runs after attachment failure
    propose_regions.execute.assert_awaited_once()


def test_propose_regions_failure_does_not_fail_ingestion() -> None:
    """propose_regions.execute raising must not propagate to the SNS-facing caller."""
    raw = _raw_email(with_attachment=True)

    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(side_effect=RuntimeError("propose boom"))

    use_case, _mocks = _make_use_case(raw, propose_regions=propose_regions)
    # Must not raise
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email is not None
    assert email.importer_id == IMPORTER_ID


# ---------------------------------------------------------------------------
# New Task 2 (04-12) tests — importer resolver wiring
# ---------------------------------------------------------------------------


def test_ingest_resolves_importer_id_from_sender() -> None:
    """IngestInboundEmailUseCase must call importer_resolver.resolve with the sender address."""
    raw = _raw_email()
    resolved_id = "aaaaaaaa-0000-0000-0000-000000000002"
    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=resolved_id)

    use_case, _mocks = _make_use_case(raw, importer_resolver=importer_resolver)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    importer_resolver.resolve.assert_awaited_once_with("maria@exporter.com", user_id=None)
    assert email.importer_id == resolved_id


def test_ingest_keys_email_and_attachment_by_resolved_importer_id() -> None:
    """Email row and attachment row are keyed by the resolver's returned importer_id."""
    raw = _raw_email(with_attachment=True)
    resolved_id = "bbbbbbbb-0000-0000-0000-000000000003"
    importer_resolver = MagicMock()
    importer_resolver.resolve = AsyncMock(return_value=resolved_id)

    use_case, mocks = _make_use_case(raw, importer_resolver=importer_resolver)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    # Email row keyed by resolved id
    assert email.importer_id == resolved_id
    # Attachment row also keyed by resolved id
    attachment = mocks["attachment_repo"].save.await_args.args[0]
    assert attachment.importer_id == resolved_id


# ---------------------------------------------------------------------------
# ING-3 — filename-less attachment must persist a non-null filename
# ---------------------------------------------------------------------------


def _raw_email_with_filenameless_attachment() -> bytes:
    msg = EmailMessage()
    msg["From"] = "Maria <maria@exporter.com>"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "inline logo"
    msg["Message-ID"] = "<mime-002@exporter.com>"
    msg.set_content("body")
    # No filename — mirrors an inline CID logo / bare octet-stream part
    msg.add_attachment(b"\x89PNG\r\nlogo", maintype="image", subtype="png")
    return bytes(msg)


def test_filenameless_attachment_persists_fallback_filename() -> None:
    """email_attachments.filename is NOT NULL — a filename-less part must persist
    the deterministic fallback, never None (ING-3)."""
    use_case, mocks = _make_use_case(_raw_email_with_filenameless_attachment())

    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["attachment_repo"].save.assert_awaited_once()
    attachment = mocks["attachment_repo"].save.await_args.args[0]
    assert attachment.filename is not None
    assert attachment.filename == "attachment-0"


# ---------------------------------------------------------------------------
# ING-5 — one failing attachment must not abort the rest / storage-key sanitize
# ---------------------------------------------------------------------------


def _raw_email_two_attachments(first_filename: str) -> bytes:
    msg = EmailMessage()
    msg["From"] = "Maria <maria@exporter.com>"
    msg["To"] = "agent@magnitudetech.com.br"
    msg["Subject"] = "two docs"
    msg["Message-ID"] = "<mime-003@exporter.com>"
    msg.set_content("body")
    msg.add_attachment(b"%PDF-1.4 first", maintype="application", subtype="pdf", filename=first_filename)
    msg.add_attachment(b"%PDF-1.4 second", maintype="application", subtype="pdf", filename="contract.pdf")
    return bytes(msg)


def test_one_failing_attachment_does_not_abort_others_or_regions() -> None:
    """A storage failure on the first attachment must not prevent the second
    attachment from persisting nor stop propose_regions (ING-5)."""
    use_case, mocks = _make_use_case(_raw_email_two_attachments("relatorio.pdf"))

    # First store() raises, second succeeds
    mocks["attachment_storage"].store = AsyncMock(side_effect=[RuntimeError("Invalid key"), None])

    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))  # must not raise

    # Second attachment still persisted despite the first failing
    saved_filenames = [c.args[0].filename for c in mocks["attachment_repo"].save.await_args_list]
    assert "contract.pdf" in saved_filenames
    # propose_regions still ran
    mocks["propose_regions"].execute.assert_awaited_once()
    # Failure recorded on the email's parse_status (ING-6)
    status_calls = [c.args for c in mocks["email_repo"].update_parse_status.await_args_list]
    assert any(args[1] == "failed" for args in status_calls)
    assert email is not None


def test_storage_key_segment_is_sanitized_for_hostile_filename() -> None:
    """Sender-controlled filenames with non-ASCII / unsafe chars must not reach
    the storage key verbatim (Supabase rejects them) — the segment is sanitized
    while the DB row keeps the display filename (ING-5)."""
    use_case, mocks = _make_use_case(_raw_email_two_attachments("relatório #1.pdf"))

    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    first_store_key = mocks["attachment_storage"].store.await_args_list[0].args[0]
    # The trailing segment must contain no forbidden characters
    trailing = first_store_key.rsplit("/", 1)[-1]
    assert all(ch.isalnum() or ch in "._-" for ch in trailing), f"unsafe key segment: {trailing!r}"
    # The DB row still carries the original display filename
    first_att = mocks["attachment_repo"].save.await_args_list[0].args[0]
    assert first_att.filename == "relatório #1.pdf"


# ---------------------------------------------------------------------------
# ING-6 — parse_status lifecycle is driven to a terminal value
# ---------------------------------------------------------------------------


def test_healthy_ingest_marks_parse_status_parsed() -> None:
    use_case, mocks = _make_use_case(_raw_email())

    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    mocks["email_repo"].update_parse_status.assert_awaited_once()
    _email_id, status, error = mocks["email_repo"].update_parse_status.await_args.args
    assert status == "parsed"
    assert error is None


def test_post_persist_failure_marks_parse_status_failed() -> None:
    """A propose_regions crash must transition parse_status to 'failed' with the
    error recorded, so the UI's 'failed' tone + Reprocess affordance can fire."""
    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(side_effect=RuntimeError("bedrock down"))

    use_case, mocks = _make_use_case(_raw_email(), propose_regions=propose_regions)

    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    _email_id, status, error = mocks["email_repo"].update_parse_status.await_args.args
    assert status == "failed"
    assert error is not None
    assert "propose_regions" in error
# ING-6 tests — the parse_status lifecycle is driven, failures are visible
# ---------------------------------------------------------------------------


def test_corrupt_attachment_marks_email_failed_not_parsed() -> None:
    """A corrupt attachment must NOT leave the email reading as cleanly 'parsed' (ING-6).

    The parser raising on the attachment routes into the failures lifecycle:
    parse_status='failed', parse_error records the attachment + cause, and the
    durable status write goes through update_parse_status.
    """
    raw = _raw_email(with_attachment=True)

    corrupt_parser = MagicMock()
    corrupt_parser.parse = AsyncMock(side_effect=RuntimeError("corrupt PDF stream"))
    registry = MagicMock(side_effect=lambda ext: corrupt_parser if ext == "pdf" else None)

    use_case, mocks = _make_use_case(raw, parser_registry=registry)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email.parse_status == "failed"
    assert email.parse_status != "parsed"
    assert email.parsed_at is None
    assert email.parse_error is not None
    assert "bl.pdf" in email.parse_error
    assert "corrupt PDF stream" in email.parse_error

    # The failure was durably recorded, not just reflected on the return value.
    mocks["email_repo"].update_parse_status.assert_awaited_once()
    args, kwargs = mocks["email_repo"].update_parse_status.await_args
    assert args[0] == email.id
    assert args[1] == "failed"
    assert "corrupt PDF stream" in args[2]
    assert kwargs["parsed_at"] is None


def test_corrupt_attachment_stamps_attachment_row_failed() -> None:
    """The failing attachment's own row transitions pending -> failed (ING-6)."""
    raw = _raw_email(with_attachment=True)

    corrupt_parser = MagicMock()
    corrupt_parser.parse = AsyncMock(side_effect=RuntimeError("corrupt PDF stream"))
    registry = MagicMock(return_value=corrupt_parser)

    use_case, mocks = _make_use_case(raw, parser_registry=registry)
    asyncio.run(use_case.execute(SES_MESSAGE_ID))

    saves = [call.args[0] for call in mocks["attachment_repo"].save.await_args_list]
    assert [a.parse_status for a in saves] == ["pending", "failed"]
    assert saves[0].id == saves[1].id  # same row upserted, not a duplicate


def test_clean_ingest_finalizes_parsed_with_parsed_at() -> None:
    """No failures -> parse_status='parsed', parse_error cleared, parsed_at stamped."""
    raw = _raw_email(with_attachment=True)

    fake_page = _make_page_component(attachment_id="att-x")
    fake_parser = _fake_parser_returning(fake_page)
    registry = MagicMock(side_effect=lambda ext: fake_parser if ext == "pdf" else None)

    use_case, mocks = _make_use_case(raw, parser_registry=registry)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email.parse_status == "parsed"
    assert email.parse_error is None
    assert email.parsed_at is not None

    args, kwargs = mocks["email_repo"].update_parse_status.await_args
    assert args[1] == "parsed"
    assert args[2] is None
    assert kwargs["parsed_at"] is not None

    # The successfully parsed attachment's row reads 'parsed', not stuck 'pending'.
    saves = [call.args[0] for call in mocks["attachment_repo"].save.await_args_list]
    assert [a.parse_status for a in saves] == ["pending", "parsed"]


def test_unsupported_attachment_is_not_a_failure() -> None:
    """No registered parser is a SKIP (inline logos etc.), never a 'failed' email."""
    raw = _raw_email(with_attachment=True)
    registry = MagicMock(return_value=None)

    use_case, mocks = _make_use_case(raw, parser_registry=registry)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email.parse_status == "parsed"
    assert email.parse_error is None
    # Skipped attachment keeps its single 'pending' save — no failed stamp.
    mocks["attachment_repo"].save.assert_awaited_once()
    assert mocks["attachment_repo"].save.await_args.args[0].parse_status == "pending"


def test_propose_regions_failure_routes_into_failed_status() -> None:
    """propose_regions crashing is recorded in the same lifecycle (ING-6)."""
    raw = _raw_email(with_attachment=False)

    propose_regions = MagicMock()
    propose_regions.execute = AsyncMock(side_effect=RuntimeError("propose boom"))

    use_case, _mocks = _make_use_case(raw, propose_regions=propose_regions)
    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    assert email.parse_status == "failed"
    assert email.parse_error is not None
    assert "propose_regions" in email.parse_error


def test_parse_status_write_failure_is_isolated() -> None:
    """A repository failure while finalizing status never reaches the SNS caller."""
    raw = _raw_email(with_attachment=False)

    use_case, mocks = _make_use_case(raw)
    mocks["email_repo"].update_parse_status = AsyncMock(side_effect=RuntimeError("db down"))

    email = asyncio.run(use_case.execute(SES_MESSAGE_ID))

    # Returned entity honestly keeps the last durably persisted status.
    assert email.parse_status == "received"


def test_ingest_redelivery_still_stable_with_resolver() -> None:
    """SNS redelivery must not change the email id even with resolver in place."""
    resolved_id = "cccccccc-0000-0000-0000-000000000004"
    importer_resolver_first = MagicMock()
    importer_resolver_first.resolve = AsyncMock(return_value=resolved_id)

    use_case_first, _ = _make_use_case(_raw_email(), importer_resolver=importer_resolver_first)
    first = asyncio.run(use_case_first.execute(SES_MESSAGE_ID))

    importer_resolver_second = MagicMock()
    importer_resolver_second.resolve = AsyncMock(return_value=resolved_id)
    use_case_again, mocks = _make_use_case(
        _raw_email(), existing_email=first, importer_resolver=importer_resolver_second
    )
    second = asyncio.run(use_case_again.execute(SES_MESSAGE_ID))

    mocks["email_repo"].find_by_message_id.assert_awaited_once_with(resolved_id, "<mime-001@exporter.com>")
    assert second.id == first.id
