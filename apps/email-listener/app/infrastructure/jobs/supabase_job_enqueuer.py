"""SupabaseJobEnqueuer — the JobEnqueuer adapter over the `public.enqueue_job` SQL wrapper.

Enqueues durable jobs by calling the SECURITY DEFINER `public.enqueue_job(...)` function via
PostgREST RPC on the already-cached Supabase service_role client — zero new connection, zero
new secret, zero new dependency. supabase-py is synchronous, so the blocking
`.rpc(...).execute()` is moved off the event loop with ``asyncio.to_thread`` (the same WR-06
discipline the ingest-path repositories use), keeping the shared uvicorn loop responsive.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping

from supabase import Client

_ENQUEUE_RPC = "enqueue_job"


class SupabaseJobEnqueuer:
    """JobEnqueuer implementation calling the `public.enqueue_job` wrapper (structural port impl)."""

    def __init__(self, client: Client) -> None:
        self._client = client

    async def enqueue(
        self,
        identifier: str,
        payload: Mapping[str, object],
        *,
        max_attempts: int = 8,
        job_key: str | None = None,
    ) -> int:
        """Call `public.enqueue_job(p_identifier, p_payload, p_max_attempts, p_job_key)`.

        The wrapper returns the queue's ``bigint`` job id as a PostgREST scalar; supabase-py
        surfaces it on ``result.data``. Returned defensively as ``int`` (PostgREST may hand
        back the scalar directly or wrapped in a single-element list depending on the
        function's return shape).
        """
        params: dict[str, object] = {
            "p_identifier": identifier,
            "p_payload": dict(payload),
            "p_max_attempts": max_attempts,
            "p_job_key": job_key,
        }
        result = await asyncio.to_thread(lambda: self._client.rpc(_ENQUEUE_RPC, params).execute())
        data = result.data
        if isinstance(data, list):
            data = data[0] if data else 0
        if not isinstance(data, (int, float, str)):
            raise RuntimeError(f"enqueue_job returned an unexpected payload type: {type(data).__name__}")
        return int(data)
