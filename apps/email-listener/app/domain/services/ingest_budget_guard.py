"""IngestBudgetGuard — per-importer daily ingest volume cap (A1, blast-radius limiter).

WHY THIS EXISTS. The cost circuit breaker (app/domain/services/cost_circuit_breaker.py)
gates the CHAT path only. The email-ingest pipeline (segmentation, entity-type
suggestion, entity resolution, embeddings) is unmetered and uncapped — a party
that blasts mail at a forwarding address is unbounded LLM spend. For a solo
operator that is a company-ending risk. This guard bounds the blast radius: it
caps how many emails per importer per UTC day get the expensive enrichment. The
raw email is ALWAYS persisted (see IngestInboundEmailUseCase); only the costly
downstream enrichment is skipped once the cap is crossed, so nothing is silently
lost — a capped email is finalized 'degraded' with an ``ingest_cost_capped``
reason and can be reprocessed later.

FAIL-OPEN, deliberately the OPPOSITE of the chat breaker's fail-closed contract.
The chat breaker blocks on any ledger error because letting an un-metered paid
turn through is the harm it guards. Here the harm is inverted: fail-closed would
silently strip enrichment from *legitimate* mail on a transient count error —
exactly the silent-degradation failure mode the pipeline works to eliminate.
This cap is a volume backstop against a sustained flood, not a precise per-email
dollar gate (the AWS account budget is the hard belt), so a single count error
must NOT cap. On any error, and for a non-positive cap, the guard reports
"not over cap".

The cap is read ONLY from settings at construction — no method accepts a per-call
cap, mirroring the circuit breaker's D-21 discipline.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from typing import TYPE_CHECKING

import structlog

from app.domain.services.tier_entitlements import daily_ingest_cap_for_tier

if TYPE_CHECKING:
    from app.domain.ports.daily_ingest_counter import DailyIngestCounter
    from app.domain.ports.tier_resolver import TierResolver

logger = structlog.get_logger(__name__)


class IngestBudgetGuard:
    """Reports whether an importer has crossed its per-UTC-day ingest cap."""

    def __init__(
        self,
        *,
        counter: DailyIngestCounter,
        daily_email_cap: int,
        tier_resolver: TierResolver | None = None,
    ) -> None:
        self._counter = counter
        self._daily_email_cap = daily_email_cap
        # OPTIONAL (default None) — tier-awareness is additive. When None the cap
        # is the constructed ``daily_email_cap`` EXACTLY as before (byte-identical);
        # when present the cap is derived from the importer's self-resolved tier,
        # falling back to ``daily_email_cap`` on any resolver error (fail-open).
        self._tier_resolver = tier_resolver

    async def is_over_daily_cap(self, importer_id: str) -> bool:
        """True once the importer's emails created today (UTC) reach the cap.

        Counts on the server-stamped ``created_at`` (never the sender-controlled
        ``received_at``). Fail-open (see module docstring): a non-positive cap or
        any counter error reports False rather than capping legitimate mail.
        """
        cap = await self._effective_cap(importer_id)
        if cap <= 0:
            return False
        since = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)
        try:
            count = await self._counter.count_received_since(importer_id, since)
        except Exception:
            logger.warning("ingest_budget_count_failed", importer_id=importer_id, exc_info=True)
            return False
        return count >= cap

    async def _effective_cap(self, importer_id: str) -> int:
        """The cap to enforce: the constructed default, or the importer's tier cap.

        No resolver (the default) returns the constructed ``daily_email_cap``
        unchanged. With a resolver, the tier is self-derived from the importer id
        (never trusted from a caller) and mapped to a cap; ANY resolver error
        falls back to the constructed default — fail-open, so a lookup failure
        never caps legitimate mail.
        """
        if self._tier_resolver is None:
            return self._daily_email_cap
        try:
            tier = await self._tier_resolver.tier_for_importer(importer_id)
        except Exception:
            logger.warning("ingest_budget_tier_resolve_failed", importer_id=importer_id, exc_info=True)
            return self._daily_email_cap
        return daily_ingest_cap_for_tier(tier)
