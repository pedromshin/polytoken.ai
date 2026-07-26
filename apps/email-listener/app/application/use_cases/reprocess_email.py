"""Use case: reprocess an already-ingested email.

Re-triggers ingestion with the BARE SES message id derived from the stored
raw_storage_key, THEN supersedes the prior auto-proposed regions — in that
order, so a failed or degraded re-ingest never destroys the existing
proposals (REG-1 / REG-3).

Ordering rationale (do not revert to supersede-first):
  The old flow superseded the pending regions BEFORE the fallible re-ingest.
  If re-ingest raised (raw S3 object lifecycle-deleted, NULL raw_storage_key)
  or the segmenter degraded to zero regions on a Bedrock outage (it returns []
  without raising), the user was left with an empty overlay and a 200 ack —
  every un-reviewed detection box silently gone with no way back except another
  reprocess that failed identically. Re-ingesting first, then superseding ONLY
  the pre-existing pending pile (created before the reprocess started) and ONLY
  when fresh proposals actually materialized, makes reprocess:
    * non-destructive — a raising ingest never reaches the supersede;
    * outage-safe — zero new regions ⇒ skip supersede, keep the old proposals;
    * idempotent — each run supersedes exactly the previous run's pending set,
      so pending regions never accumulate across repeated reprocessing.

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
    2. Capture a cutoff timestamp BEFORE anything is re-created — every row that
       already exists for the email predates it.
    3. Re-trigger ingestion with the BARE SES id derived from raw_storage_key.
       This creates the fresh page + pending-region proposals (created after the
       cutoff). If it raises, execution stops here and nothing is superseded.
    4. Only if re-ingest actually produced fresh pending regions, bulk-supersede
       the OLD pending pile (source_type=region, status=pending, created before
       the cutoff) in a single query. Human-touched regions (candidate/confirmed/
       rejected) and page components are never touched. When re-ingest produced
       zero regions (segmenter degraded to [] on an outage), the supersede is
       skipped so the prior proposals survive rather than vanishing behind a 200.
    5. Return a summary ack with the count of superseded and newly-proposed regions.
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

        Returns {"email_id": email_id, "superseded_components": N, "new_regions": M}.
        Raises ValueError if the email does not exist (maps to 404 at the API layer).
        """
        email = await self._emails.find_by_id(email_id)
        if email is None:
            raise ValueError(f"Email not found: {email_id}")

        logger.info("reprocess_started", email_id=email_id)

        # Boundary between the OLD auto-proposed regions and the fresh ones this
        # reprocess is about to create: the newest created_at ALREADY IN THE DB
        # for this email — a DB-clock row timestamp captured before re-ingest —
        # never datetime.now(UTC) on the app server. An app clock skewed against
        # Postgres could otherwise miss stale regions (clock behind) or eat rows
        # the re-ingest is inserting (clock ahead). Fresh rows get a strictly
        # later DB timestamp; the supersede bound is inclusive (<=) and the
        # freshness count strict (>), so the two predicates partition the
        # timeline exactly at the boundary row. None ⇒ no components existed
        # before this reprocess, so there is nothing to supersede.
        cutoff = await self._components.latest_component_created_at(email_id)

        # Re-ingest FIRST. If this raises (raw S3 object gone, NULL storage key),
        # execution stops before any supersede — the prior proposals are untouched.
        # Derive the BARE SES message id from the stored full S3 key:
        # raw_storage_key = "<prefix>/<ses-id>" where prefix ends with "/", so
        # rsplit("/", 1)[-1] reliably extracts the ses-id regardless of depth.
        ses_id = email.raw_storage_key.rsplit("/", 1)[-1]  # type: ignore[union-attr]
        logger.info("reprocess_reingest", email_id=email_id, ses_id=ses_id)
        # reprocess=True forces the full pipeline to re-run even though the email
        # is already 'parsed' — the redelivery short-circuit must NOT swallow a
        # deliberate reprocess (its whole purpose is to re-extract).
        await self._ingest.execute(ses_id, reprocess=True)

        # Did re-ingest actually produce fresh proposals? A Bedrock outage makes
        # the segmenter return [] WITHOUT raising, so a completed ingest is not
        # proof of new regions. Supersede the old pile only when there is a
        # replacement set to show; otherwise keep the prior proposals visible.
        new_regions = await self._components.count_pending_regions_created_since(email_id, cutoff)
        if new_regions > 0 and cutoff is not None:
            superseded_count = await self._components.supersede_pending_regions(email_id, created_before=cutoff)
            logger.info(
                "reprocess_superseded",
                email_id=email_id,
                superseded_regions=superseded_count,
                new_regions=new_regions,
            )
        elif new_regions > 0:
            # Fresh proposals exist but no components predated this reprocess
            # (cutoff is None) — nothing to supersede.
            superseded_count = 0
        else:
            superseded_count = 0
            logger.warning(
                "reprocess_no_new_regions",
                email_id=email_id,
                detail="re-ingest produced zero pending regions; preserved prior proposals",
            )

        logger.info("reprocess_complete", email_id=email_id)
        return {
            "email_id": email_id,
            "superseded_components": superseded_count,
            "new_regions": new_regions,
        }
