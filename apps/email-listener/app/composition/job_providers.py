"""Job-queue providers — the durable enqueue seam (Track 3a).

Binds the single `JobEnqueuer` port to its Supabase adapter. The adapter reuses the already-
bound `Client` singleton (service_role) — no patched global, so container.py's boot-test patch
targets are unaffected, exactly like the other extracted provider groups.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.domain.ports.job_enqueuer import JobEnqueuer
from app.infrastructure.jobs.supabase_job_enqueuer import SupabaseJobEnqueuer


def _provide_job_enqueuer(client: Client) -> JobEnqueuer:
    """SupabaseJobEnqueuer bound to the JobEnqueuer port — reuses the cached Client singleton."""
    return SupabaseJobEnqueuer(client=client)


def register(provider: Provider) -> None:
    """Register the job-queue group's binding on the shared APP-scoped provider."""
    provider.provide(_provide_job_enqueuer, provides=JobEnqueuer)
