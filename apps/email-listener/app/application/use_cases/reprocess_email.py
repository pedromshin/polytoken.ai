"""Use case: reprocess an already-ingested email.

Supersedes all active extraction records for the email's components (D-16)
then re-triggers ingestion with the BARE SES message id derived from the
stored raw_storage_key.

Key derivation rationale (resolved decision — do not deviate):
  Email.raw_storage_key stores the FULL S3 key including the env prefix
  (e.g. "inbound/prod/<ses-id>"). IngestInboundEmailUseCase.execute() takes
  the BARE ses_message_id; internally raw_store.fetch() calls key_for() which
  PREPENDS the env prefix again.  Passing raw_storage_key directly would
  double-prefix and 404 on S3.
  Email.message_id is unreliable because ingest sets it to the RFC 5322
  Message-ID header when present, not the SES id.
  Safe derivation: ses_id = email.raw_storage_key.rsplit("/", 1)[-1]
  The configured ses_s3_prefix always ends with "/" (e.g. "inbound/prod/"),
  so the last segment is always the bare SES message id.
"""

from __future__ import annotations

import structlog

from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.extraction_repository import ExtractionRepository

logger = structlog.get_logger(__name__)


class ReprocessEmailUseCase:
    """Re-run ingestion for an already-stored email, replacing prior detection.

    Steps:
    1. Load the email; raise ValueError if not found (caller maps to 404).
    2. Bulk-supersede the email's pending (auto-proposed) region components in a
       single query so the re-ingest REPLACES them instead of piling fresh
       pending boxes on top of old ones (repeated reprocessing otherwise
       accumulates thousands of duplicate regions). Human-touched regions —
       accepted (candidate), confirmed, or rejected — are preserved, as are page
       components (which never render as overlay boxes and are recreated below).
    3. Re-trigger ingestion with the BARE SES id derived from raw_storage_key.
    4. Return a summary ack with the count of superseded regions.
    """

    def __init__(
        self,
        *,
        emails: EmailRepository,
        components: ComponentRepository,
        extractions: ExtractionRepository,
        ingest: IngestInboundEmailUseCase,
    ) -> None:
        self._emails = emails
        self._components = components
        self._extractions = extractions
        self._ingest = ingest

    async def execute(self, *, email_id: str) -> dict[str, object]:
        """Reprocess the email identified by email_id.

        Returns {"email_id": email_id, "superseded_components": N}.
        Raises ValueError if the email does not exist (maps to 404 at the API layer).
        """
        email = await self._emails.find_by_id(email_id)
        if email is None:
            raise ValueError(f"Email not found: {email_id}")

        logger.info("reprocess_started", email_id=email_id)

        # Replace prior detection: bulk-supersede the email's pending (auto-proposed)
        # region components in a single query so the re-ingest does not stack
        # duplicate pending regions. Accepted/confirmed/rejected regions are
        # preserved — only untouched auto-proposals are replaced.
        #
        # Cutoff derivation (clock-skew mitigation): the supersede is bounded by
        # the newest created_at ALREADY IN THE DB for this email — a DB-clock
        # row timestamp — never by datetime.now(UTC) on the app server. An
        # app-server clock skewed against Postgres could otherwise either miss
        # stale regions (clock behind) or eat rows a concurrent re-ingest is
        # inserting right now (clock ahead). Rows created after this snapshot
        # get a strictly later DB timestamp and are left alone; the bound is
        # inclusive because a save_many batch shares one statement timestamp.
        cutoff = await self._components.latest_component_created_at(email_id)
        superseded_count = await self._components.supersede_pending_regions(
            email_id,
            created_before=cutoff,
        )

        logger.info(
            "reprocess_superseded",
            email_id=email_id,
            superseded_regions=superseded_count,
        )

        # Derive the BARE SES message id from the stored full S3 key.
        # raw_storage_key = "<prefix>/<ses-id>" where prefix ends with "/".
        # rsplit("/", 1)[-1] reliably extracts the ses-id regardless of depth.
        ses_id = email.raw_storage_key.rsplit("/", 1)[-1]  # type: ignore[union-attr]
        logger.info("reprocess_reingest", email_id=email_id, ses_id=ses_id)

        await self._ingest.execute(ses_id)

        logger.info("reprocess_complete", email_id=email_id)
        return {"email_id": email_id, "superseded_components": superseded_count}
