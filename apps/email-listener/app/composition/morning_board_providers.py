"""Morning-board providers — the self-assembling home-board seam (Phase 74).

Binds the ``HomeCanvasWriter`` port to its Supabase adapter and the
``AssembleMorningBoardUseCase`` (the composer + writer orchestrator the internal
``/v1/home/assemble-job`` route drives). The use-case factory reads the
``MORNING_BOARD_ENABLED`` flag and passes it as the use case's ``enabled`` param,
so the feature ships DARK (MORN-06) until the flag is flipped — the same
flag-gate discipline the ingest/anticipatory groups use, applied here in the
composition root rather than inside the use case.

The writer adapter reuses the already-bound ``Client`` singleton (service_role) —
no patched global, so container.py's boot-test patch targets are unaffected,
exactly like the other extracted provider groups.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.application.use_cases.assemble_morning_board import AssembleMorningBoardUseCase
from app.domain.ports.home_canvas_writer import HomeCanvasWriter
from app.infrastructure.supabase.home_canvas_layout_writer import SupabaseHomeCanvasLayoutWriter
from app.settings import get_settings


def _provide_home_canvas_writer(client: Client) -> HomeCanvasWriter:
    """SupabaseHomeCanvasLayoutWriter bound to the HomeCanvasWriter port — reuses the Client."""
    return SupabaseHomeCanvasLayoutWriter(client=client)


def _provide_assemble_morning_board_use_case(writer: HomeCanvasWriter) -> AssembleMorningBoardUseCase:
    """AssembleMorningBoardUseCase — gated on MORNING_BOARD_ENABLED (default OFF, MORN-06).

    The flag is read here (composition root) and passed as ``enabled``: when False
    the use case composes/writes nothing, so the feature is fully dark without a
    code change.
    """
    return AssembleMorningBoardUseCase(writer=writer, enabled=get_settings().MORNING_BOARD_ENABLED)


def register(provider: Provider) -> None:
    """Register the morning-board group's bindings on the shared APP-scoped provider."""
    provider.provide(_provide_home_canvas_writer, provides=HomeCanvasWriter)
    provider.provide(_provide_assemble_morning_board_use_case, provides=AssembleMorningBoardUseCase)
