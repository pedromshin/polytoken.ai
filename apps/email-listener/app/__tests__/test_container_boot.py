"""Container boot smoke test — the safety net for the container.py decomposition (Track 2).

`create_container()` wires 88 dishka bindings. This test resolves EVERY registered
top-level binding under mocked clients, so any binding lost or broken while moving providers
into grouped `app/composition/*.py` modules fails here loudly.

Coverage history: the first version resolved 19 major providers whose transitive closure
reached only 66/88 bindings — an adversarial audit (2026-07-24) found 22 registered bindings
with NO fan-in (the region-edit write-side, entity-type/field management, merge-curation use
cases, and the ParserRegistryPort key, which `_provide_ingest_use_case` calls directly rather
than injecting). Those are exactly the bindings the `document_region` and `entity` extraction
groups move, so they are now resolved EXPLICITLY here — the safety net covers the full graph
before those groups are split.

Clients are patched with mocks (no Supabase/AWS/network): the adapter constructors only store
their client, so a MagicMock resolves the whole graph.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.application.use_cases.assemble_morning_board import AssembleMorningBoardUseCase
from app.application.use_cases.autofill import AutofillUseCase
from app.application.use_cases.autofill_fields import AutofillFieldsUseCase
from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.backfill_inbound_email import BackfillInboundEmailUseCase
from app.application.use_cases.classify_document import ClassifyDocumentUseCase
from app.application.use_cases.confirm_region import ConfirmRegionUseCase
from app.application.use_cases.curate_entity_merge import (
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)
from app.application.use_cases.deny_field import DenyFieldUseCase
from app.application.use_cases.edit_region import (
    AcceptRegionUseCase,
    CreateRegionUseCase,
    MergeRegionsUseCase,
    NestRegionUseCase,
    RedrawRegionUseCase,
    RejectRegionUseCase,
    SplitRegionUseCase,
)
from app.application.use_cases.evaluate_anticipatory_candidates import EvaluateAnticipatoryCandidates
from app.application.use_cases.generate_code_island import GenerateCodeIslandUseCase
from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.application.use_cases.manage_entity_types import (
    CreateEntityTypeUseCase,
    CreateFieldUseCase,
    DeleteFieldUseCase,
    ReorderFieldsUseCase,
    UpdateEntityTypeUseCase,
    UpdateFieldUseCase,
)
from app.application.use_cases.pipeline_health import GetPipelineHealthUseCase
from app.application.use_cases.promote_edge import PromoteEdgeUseCase
from app.application.use_cases.promote_entity_on_confirm import PromoteEntityOnConfirmUseCase
from app.application.use_cases.promote_source_ledger_entry import PromoteSourceLedgerEntryUseCase
from app.application.use_cases.receive_inbound_email import ReceiveInboundEmailUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.application.use_cases.resolve_retheme import ResolveRethemeUseCase
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.set_component_relationship import (
    SetComponentEntityTypeUseCase,
    SetComponentFieldRelationshipUseCase,
    SetComponentRoleUseCase,
)
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.container import create_container
from app.domain.ports.home_canvas_writer import HomeCanvasWriter
from app.domain.ports.job_enqueuer import JobEnqueuer
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.services.ingest_budget_guard import IngestBudgetGuard

# Deep-fan-in top-level providers. Resolving each pulls in its transitive deps (66/88 of the
# graph between them).
_TOP_LEVEL_PROVIDERS = (
    ReceiveInboundEmailUseCase,
    IngestInboundEmailUseCase,
    # A1: the ingest cost-cap guard (a factory param of the ingest use case, so
    # dishka resolves it even when the flag is off) — pinned so the safety net
    # survives a future refactor that stops fanning into it.
    IngestBudgetGuard,
    ReprocessEmailUseCase,
    BackfillInboundEmailUseCase,
    GetPipelineHealthUseCase,
    AutofillUseCase,
    AutofillFieldsUseCase,
    ConfirmRegionUseCase,
    PromoteEntityOnConfirmUseCase,
    PromoteEdgeUseCase,
    PromoteSourceLedgerEntryUseCase,
    ResolveEntityCandidatesUseCase,
    BackfillEntityIdentitiesUseCase,
    SuggestEntityTypesUseCase,
    GenerateUiSpecUseCase,
    GenerateCodeIslandUseCase,
    ResolveRethemeUseCase,
    RunChatTurn,
    SubmitWidgetInteraction,
    EvaluateAnticipatoryCandidates,
    # Self-assembling morning board (Phase 74) — no fan-in from the roots (the
    # /v1/home/assemble-job route resolves it at call time), so it is guarded here.
    AssembleMorningBoardUseCase,
)

# The 21 no-fan-in bindings the transitive closure of the roots above never reaches (audit
# 2026-07-24). Resolved explicitly so the safety net covers the full graph — every one of
# these is moved by the document_region / entity extraction groups.
_STANDALONE_PROVIDERS = (
    # Region-edit write side + document classify (edit_region.py, classify_document.py).
    AcceptRegionUseCase,
    RejectRegionUseCase,
    RedrawRegionUseCase,
    SplitRegionUseCase,
    MergeRegionsUseCase,
    NestRegionUseCase,
    CreateRegionUseCase,
    ClassifyDocumentUseCase,
    # Component-relationship + deny + entity-type/field management.
    SetComponentRoleUseCase,
    SetComponentEntityTypeUseCase,
    SetComponentFieldRelationshipUseCase,
    DenyFieldUseCase,
    CreateEntityTypeUseCase,
    UpdateEntityTypeUseCase,
    CreateFieldUseCase,
    UpdateFieldUseCase,
    DeleteFieldUseCase,
    ReorderFieldsUseCase,
    # Merge-curation loop.
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)


@pytest.mark.unit
def test_container_resolves_every_binding() -> None:
    """create_container() boots and resolves every registered binding under mocked clients."""
    with (
        patch("app.container.get_supabase_client", return_value=MagicMock()),
        patch("app.container.get_anthropic_client", return_value=MagicMock()),
        patch("app.container.boto3") as boto3_mock,
    ):
        boto3_mock.client.return_value = MagicMock()
        container = create_container()

        async def _resolve_all() -> None:
            for provider_type in (*_TOP_LEVEL_PROVIDERS, *_STANDALONE_PROVIDERS):
                instance = await container.get(provider_type)
                assert instance is not None, f"{provider_type.__name__} resolved to None"
                assert isinstance(instance, provider_type), (
                    f"{provider_type.__name__} resolved to {type(instance).__name__}"
                )

            # ParserRegistryPort is a Callable type alias (not a class), registered but never
            # injected — _provide_ingest_use_case calls the factory directly. Resolve it via the
            # DI key explicitly so the registration itself is guarded (no isinstance — it's a fn).
            parser_registry = await container.get(ParserRegistryPort)
            assert callable(parser_registry), "ParserRegistryPort resolved to a non-callable"

            # JobEnqueuer (Track 3a) is a Protocol port with NO fan-in from the roots above (the
            # SNS receiver / backfill resolve it from request scope at call time, not via injection),
            # so guard its DI registration explicitly here — a break would otherwise only surface as
            # a prod mail-path 500 once INGEST_ENQUEUE_ENABLED is flipped on.
            enqueuer = await container.get(JobEnqueuer)
            assert hasattr(enqueuer, "enqueue"), "JobEnqueuer resolved without an enqueue method"

            # HomeCanvasWriter (Phase 74) is a Protocol port whose only fan-in is the
            # /v1/home/assemble-job route (resolved at call time via AssembleMorningBoardUseCase),
            # so guard its DI registration explicitly here too.
            home_writer = await container.get(HomeCanvasWriter)
            assert hasattr(home_writer, "write_home_snapshot"), (
                "HomeCanvasWriter resolved without a write_home_snapshot method"
            )

            await container.close()

        asyncio.run(_resolve_all())
