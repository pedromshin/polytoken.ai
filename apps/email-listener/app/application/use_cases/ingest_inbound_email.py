"""Use case: ingest an inbound email — fetch raw MIME, parse, persist email + attachments.

Idempotent under SNS redelivery: the email row is keyed by (importer_id,
message_id) and re-uses the existing row id; attachment ids are deterministic
(uuid5 of email id + part index + filename) so re-ingestion upserts in place.

Post-persist dispatch (D-10):
- Each parseable attachment is dispatched through the injected ParserRegistryPort.
- Page Components returned by the parser have email_id/importer_id stitched and
  are persisted via ComponentRepository.save_many.
- ProposeRegionsUseCase is called once after all attachments are processed.
- SuggestEntityTypesUseCase is called after propose_regions to auto-classify
  candidate regions with entity-type suggestions (suggest-only, best-effort).
  All three post-persist steps are isolated: failures are logged but never
  propagate to the SNS-facing caller.

Parse-status lifecycle (ING-6):
- Post-persist failures are ISOLATED but never INVISIBLE. Every swallowed
  post-persist failure (attachment parse, propose_regions,
  suggest_entity_types) is collected into a failures list, and the email is
  finalized once at the end of execute():
    - failures  -> parse_status='failed', parse_error=joined failure summary
    - no failures -> parse_status='parsed', parsed_at=now
  A failed attachment also stamps its own row parse_status='failed'
  (successfully parsed ones read 'parsed'), so a corrupt attachment can never
  leave the email reading as cleanly parsed.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime

import structlog

from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.domain.entities.attachment import Attachment
from app.domain.entities.email import Email
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import RawEmailStore
from app.domain.ports.thread_resolver import ThreadResolver
from app.domain.services.mime_parser import ParsedAttachment, ParsedEmail, parse_mime

logger = structlog.get_logger(__name__)

# parse_error is a human-readable failure summary, not a stack-trace dump —
# cap it so a pathological attachment list cannot bloat the email row.
_PARSE_ERROR_MAX_LEN = 2000


@dataclass(frozen=True)
class IngestionConfig:
    """Static ingestion configuration resolved from settings at startup."""

    default_importer_id: str


def _file_ext(filename: str | None) -> str | None:
    if filename is None or "." not in filename:
        return None
    return filename.rsplit(".", 1)[1].lower() or None


def _attachment_id(email_id: str, index: int, filename: str | None) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nauta-attachment/{email_id}/{index}/{filename or ''}"))


_KEY_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_key_segment(name: str) -> str:
    """Sanitize a sender-supplied filename for use as a storage-key path segment.

    Supabase Storage rejects keys containing non-ASCII letters (é, ã, 中), ``#``,
    ``%``, ``[`` etc. with 400 "Invalid key" (ING-5). The attachment_id already
    guarantees key uniqueness, so this segment is display-only — collapse every
    unsafe run to ``_`` and never let it be empty.
    """
    cleaned = _KEY_SAFE_RE.sub("_", name).strip("._")
    return cleaned or "file"


class IngestInboundEmailUseCase:
    """Fetch raw MIME from the store, parse it, and persist email + attachments.

    After each attachment is stored, its bytes are dispatched through the
    parser_registry to produce page Components which are persisted via
    ComponentRepository.  ProposeRegionsUseCase is then invoked once to
    segment those page Components into proposed child region Components.
    """

    def __init__(
        self,
        raw_store: RawEmailStore,
        email_repo: EmailRepository,
        attachment_repo: AttachmentRepository,
        attachment_storage: AttachmentStorage,
        config: IngestionConfig,
        *,
        components: ComponentRepository,
        parser_registry: ParserRegistryPort,
        propose_regions: ProposeRegionsUseCase,
        importer_resolver: ImporterResolver,
        thread_resolver: ThreadResolver,
        forwarding_resolver: ForwardingAddressResolver,
        suggest_entity_types: SuggestEntityTypesUseCase | None = None,
    ) -> None:
        self._raw_store = raw_store
        self._email_repo = email_repo
        self._attachment_repo = attachment_repo
        self._attachment_storage = attachment_storage
        self._config = config
        self._components = components
        self._parser_registry = parser_registry
        self._propose_regions = propose_regions
        self._importer_resolver = importer_resolver
        self._thread_resolver = thread_resolver
        self._forwarding_resolver = forwarding_resolver
        self._suggest_entity_types = suggest_entity_types

    async def execute(self, ses_message_id: str, recipients: Sequence[str] = ()) -> Email:
        """Ingest the email identified by the SES message id; returns the persisted Email."""
        raw = await self._raw_store.fetch(ses_message_id)
        parsed = parse_mime(raw)

        # Resolve the forwarding-token owner BEFORE importer resolution (Phase 45,
        # THRD-04): best-effort/non-fatal (T-45-05-03) — a resolver exception
        # degrades to None, and the legacy no-token (agent@ catch-all) path is
        # entirely unaffected.
        forwarding_user_id = await self._resolve_forwarding_user(recipients)

        # Resolve the importer_id from the forwarding sender address (D-05).
        # IngestionConfig.default_importer_id is used only by the resolver as its
        # malformed-sender fallback — this use case no longer reads it directly.
        importer_id = await self._importer_resolver.resolve(parsed.sender_address, user_id=forwarding_user_id)
        message_id = parsed.message_id or ses_message_id
        existing = await self._email_repo.find_by_message_id(importer_id, message_id)
        now = datetime.now(UTC)
        received_at = parsed.received_at or now

        # Resolve thread_id behind the ThreadResolver port (THRD-01), after
        # importer_id is known and before the Email is constructed/saved.
        # Best-effort/non-fatal (T-45-03-02): a resolver failure degrades to
        # thread_id=None with a logged warning — ingestion must never hard-fail
        # on thread resolution, mirroring the propose_regions isolation below.
        thread_id = await self._resolve_thread(
            importer_id=importer_id,
            message_id=message_id,
            parsed=parsed,
            received_at=received_at,
        )

        email = Email(
            id=existing.id if existing else str(uuid.uuid4()),
            importer_id=importer_id,
            thread_id=thread_id,
            message_id=message_id,
            in_reply_to=parsed.in_reply_to,
            references_ids=parsed.references_ids,
            received_at=received_at,
            sender_address=parsed.sender_address,
            sender_name=parsed.sender_name,
            to_addresses=parsed.to_addresses,
            cc_addresses=parsed.cc_addresses,
            subject=parsed.subject,
            body_html=parsed.body_html,
            body_text=parsed.body_text,
            raw_storage_key=self._raw_store.key_for(ses_message_id),
            parse_status="received",
            parse_error=None,
            parsed_at=None,
            created_at=existing.created_at if existing else now,
        )
        saved = await self._email_repo.save(email)

        # Each post-persist stage is isolated so one failure can neither abort the
        # rest of the pipeline nor propagate to the SNS-facing caller (ING-5), and
        # every failure lands in `failures` so the parse_status lifecycle is
        # actually driven — an email whose attachment(s) failed must never read
        # as cleanly 'parsed' (ING-6). _ingest_attachment reports parse-stage
        # failures via its return value; the try/except additionally guards its
        # pre-parse stages (storage/save) so a raise there cannot skip siblings.
        failures: list[str] = []

        for index, parsed_attachment in enumerate(parsed.attachments):
            try:
                failure = await self._ingest_attachment(saved, index, parsed_attachment)
            except Exception as exc:
                logger.exception(
                    "attachment_ingest_failed",
                    email_id=saved.id,
                    attachment_index=index,
                )
                failures.append(f"attachment[{index}]: {exc!r}")
            else:
                if failure is not None:
                    failures.append(failure)

        # Propose region Components from all page Components persisted above.
        # Failure must not propagate to the SNS-facing caller.
        try:
            await self._propose_regions.execute(email_id=saved.id, importer_id=importer_id)
        except Exception as exc:
            logger.exception(
                "propose_regions_failed",
                email_id=saved.id,
            )
            failures.append(f"propose_regions: {exc!r}")

        # Suggest entity types for the newly proposed candidate regions (best-effort).
        # Never raises; a Bedrock failure leaves regions unclassified (graceful degradation).
        if self._suggest_entity_types is not None:
            try:
                await self._suggest_entity_types.execute(email_id=saved.id, importer_id=importer_id)
            except Exception as exc:
                logger.exception(
                    "suggest_entity_types_failed",
                    email_id=saved.id,
                )
                failures.append(f"suggest_entity_types: {exc!r}")

        # Drive the parse_status lifecycle so the UI's 'failed' tone + Reprocess
        # affordance can fire; a healthy run transitions 'received' -> 'parsed'.
        saved = await self._finalize_parse_status(saved, failures)

        logger.info(
            "email_ingested",
            email_id=saved.id,
            message_id=saved.message_id,
            sender=saved.sender_address,
            subject=saved.subject,
            attachment_count=len(parsed.attachments),
            parse_status=saved.parse_status,
            redelivery=existing is not None,
            parse_failures=len(failures),
        )
        return saved

    async def _finalize_parse_status(self, email: Email, failures: list[str]) -> Email:
        """Stamp the terminal parse_status for this ingestion run (ING-6).

        - Any collected post-persist failure -> 'failed' + parse_error summary.
        - Otherwise -> 'parsed' + parsed_at=now.

        The status write itself is best-effort: a repository failure here is
        logged and the email is returned with its previously persisted status
        (never claiming a transition that did not durably happen), so the
        SNS-facing caller stays isolated.
        """
        if failures:
            status = "failed"
            error: str | None = "; ".join(failures)[:_PARSE_ERROR_MAX_LEN]
            parsed_at: datetime | None = None
        else:
            status = "parsed"
            error = None
            parsed_at = datetime.now(UTC)
        try:
            await self._email_repo.update_parse_status(email.id, status, error, parsed_at=parsed_at)
        except Exception:
            logger.exception(
                "parse_status_finalize_failed",
                email_id=email.id,
                parse_status=status,
            )
            return email
        return replace(email, parse_status=status, parse_error=error, parsed_at=parsed_at)

    async def _resolve_forwarding_user(self, recipients: Sequence[str]) -> str | None:
        """Best-effort forwarding-token resolution (T-45-05-03): never fails ingestion.

        A ForwardingAddressResolver exception degrades to None with a logged
        warning — mirrors the _resolve_thread isolation below. The legacy
        no-token path (recipients with no "u-" prefix, or an empty/omitted
        recipients list) also degrades to None via the port's own fail-closed
        contract, without raising.
        """
        try:
            return await self._forwarding_resolver.resolve_recipients(recipients)
        except Exception:
            logger.warning(
                "forwarding_resolution_failed",
                exc_info=True,
            )
            return None

    async def _resolve_thread(
        self,
        *,
        importer_id: str,
        message_id: str,
        parsed: ParsedEmail,
        received_at: datetime,
    ) -> str | None:
        """Best-effort thread resolution (T-45-03-02): never fails ingestion.

        A ThreadResolver exception degrades to thread_id=None with a logged
        warning — mirrors the propose_regions/suggest_entity_types isolation
        already in execute().
        """
        try:
            return await self._thread_resolver.resolve(
                importer_id=importer_id,
                message_id=message_id,
                in_reply_to=parsed.in_reply_to,
                references_ids=parsed.references_ids,
                subject=parsed.subject,
                received_at=received_at,
                body_text=parsed.body_text,
                body_html=parsed.body_html,
            )
        except Exception:
            logger.warning(
                "thread_resolution_failed",
                importer_id=importer_id,
                message_id=message_id,
                exc_info=True,
            )
            return None

    async def _ingest_attachment(self, email: Email, index: int, parsed: ParsedAttachment) -> str | None:
        """Store + persist one attachment; returns a failure summary or None.

        A non-None return means the attachment's parse stage failed (ING-6):
        the attachment row is stamped parse_status='failed' and the summary is
        collected by execute() into the email-level failures list, so the
        email finalizes as 'failed' instead of silently reading 'parsed'.
        """
        attachment_id = _attachment_id(email.id, index, parsed.filename)
        # Filename-less MIME parts (inline CID logos/signatures, bare
        # octet-stream) have parsed.filename == None; email_attachments.filename
        # is NOT NULL, so persist the deterministic fallback rather than None
        # (ING-3). The storage-key segment is additionally sanitized (ING-5).
        filename = parsed.filename or f"attachment-{index}"
        storage_key = f"{email.importer_id}/{email.id}/{attachment_id}/{_safe_key_segment(filename)}"
        file_ext = _file_ext(parsed.filename)

        await self._attachment_storage.store(storage_key, parsed.data, parsed.content_type)
        saved_attachment = await self._attachment_repo.save(
            Attachment(
                id=attachment_id,
                email_id=email.id,
                importer_id=email.importer_id,
                filename=filename,
                content_type=parsed.content_type,
                file_ext=file_ext,
                size_bytes=len(parsed.data),
                storage_key=storage_key,
                parent_attachment_id=None,
                parse_status="pending",
            )
        )

        # Dispatch attachment bytes through the parser registry (D-10).
        # Failures are isolated: a per-attachment exception is logged and
        # other attachments + the email persist normally — but the failure is
        # RECORDED (returned to execute()) rather than swallowed (ING-6).
        outcome, error = await self._parse_and_persist_pages(
            email=email,
            attachment_id=attachment_id,
            parsed=parsed,
            file_ext=file_ext,
        )

        if outcome == "skipped":
            return None

        # Stamp the attachment row's own lifecycle ('parsed' | 'failed').
        # Best-effort: a status-write failure must not abort sibling
        # attachments, and the email-level failure is already captured below.
        try:
            await self._attachment_repo.save(replace(saved_attachment, parse_status=outcome))
        except Exception:
            logger.exception(
                "attachment_status_update_failed",
                attachment_id=attachment_id,
                email_id=email.id,
                parse_status=outcome,
            )

        if outcome == "failed":
            return f"attachment {filename}: {error}"
        return None

    async def _parse_and_persist_pages(
        self,
        *,
        email: Email,
        attachment_id: str,
        parsed: ParsedAttachment,
        file_ext: str | None,
    ) -> tuple[str, str | None]:
        """Dispatch attachment to a registered parser and persist the resulting page Components.

        Returns (outcome, error):
        - ("skipped", None) — no extension / no registered parser (not a failure);
        - ("parsed", None)  — parser ran and any pages were persisted;
        - ("failed", <summary>) — parser or page persistence raised (ING-6).
        """
        if file_ext is None:
            logger.debug(
                "attachment_no_extension",
                attachment_id=attachment_id,
                email_id=email.id,
            )
            return ("skipped", None)

        parser = self._parser_registry(file_ext)
        if parser is None:
            logger.debug(
                "attachment_unsupported_type",
                attachment_id=attachment_id,
                file_ext=file_ext,
                email_id=email.id,
            )
            return ("skipped", None)

        try:
            pages = await parser.parse(
                file_bytes=parsed.data,
                content_type=parsed.content_type,
                attachment_id=attachment_id,
            )

            if not pages:
                return ("parsed", None)

            # Stitch email_id and importer_id onto each page Component.
            # Component is frozen; use dataclasses.replace to build new instances.
            stitched = [replace(page, email_id=email.id, importer_id=email.importer_id) for page in pages]
            await self._components.save_many(stitched)
        except Exception as exc:
            logger.exception(
                "attachment_parse_failed",
                attachment_id=attachment_id,
                email_id=email.id,
            )
            return ("failed", repr(exc))

        logger.debug(
            "attachment_pages_persisted",
            attachment_id=attachment_id,
            email_id=email.id,
            page_count=len(stitched),
        )
        return ("parsed", None)
