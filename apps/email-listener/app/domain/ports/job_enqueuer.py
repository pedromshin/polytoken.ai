"""JobEnqueuer port — domain abstraction over the durable job-queue enqueue seam (Track 3a).

One clean-arch seam so every caller (the SNS receiver, the backfill reprocessor, and later
the chat turn's deep-research sub-loop) enqueues durable work through the SAME place rather
than a raw `.rpc()` — mirroring how every other infrastructure boundary is a domain port.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol


class JobEnqueuer(Protocol):
    """Enqueue a durable background job through the queue's public enqueue wrapper.

    The concrete adapter calls the `public.enqueue_job(...)` SQL wrapper (a
    SECURITY DEFINER function over graphile-worker's `add_job`) so the
    application layer never touches the queue internals. Callers authorize the
    work BEFORE enqueuing; the queue owns retries + permanent dead-letter.
    """

    async def enqueue(
        self,
        identifier: str,
        payload: Mapping[str, object],
        *,
        max_attempts: int = 8,
        job_key: str | None = None,
    ) -> int:
        """Enqueue one job; return the queue's job id.

        Args:
            identifier: the task identifier, allowlisted inside the SQL wrapper
                (e.g. ``"ingest_inbound_email"`` or ``"deep_research"``). An
                unknown identifier is rejected by the wrapper, not here.
            payload: a JSON-serializable mapping — a POINTER (ids/keys), never
                the raw bytes (the durable source of truth already lives in S3
                / the DB; the job only needs to re-derive from it).
            max_attempts: the retry ceiling before the job becomes a permanent
                dead-letter row.
            job_key: optional idempotency key. Re-enqueuing with the same key
                REPLACES the still-pending job instead of enqueuing a duplicate
                — so an at-least-once redelivery (e.g. an SNS retry) is safe.

        Returns:
            The enqueued job's id.
        """
        ...
