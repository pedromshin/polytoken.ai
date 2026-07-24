"""Entity providers — extracted from container.py (Track 2 decomposition).

Owns the entity-resolution + knowledge-promotion + entity-type/field management
surface: the six EntityType/Field CRUD use cases, SuggestEntityTypes, the five
promote/resolve factories (PromoteEntityOnConfirm, PromoteEdge,
PromoteSourceLedgerEntry, ResolveEntityCandidates, BackfillEntityIdentities), and
the three merge-curation use cases. 15 bindings; six are factories (the promote/
resolve ones that directly instantiate concrete Supabase adapters, plus the
correction-wired SuggestEntityTypes) and the rest auto-inject their
EntityTypeRepository / EntityInstanceRepository collaborators via provide(class).

Every factory that needs a concrete `SupabaseEntityResolutionRepository` /
`SupabaseKnowledgeGraphRepository` instantiates it directly over the injected
`Client` (these are infrastructure classes, not ports — dishka can't bind them via
provide(class)). None calls a patched global, so container.py's boot-test patch
targets (`get_supabase_client` / `boto3`) are untouched.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
from app.application.use_cases.curate_entity_merge import (
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)
from app.application.use_cases.manage_entity_types import (
    CreateEntityTypeUseCase,
    CreateFieldUseCase,
    DeleteFieldUseCase,
    ReorderFieldsUseCase,
    UpdateEntityTypeUseCase,
    UpdateFieldUseCase,
)
from app.application.use_cases.promote_edge import PromoteEdgeUseCase
from app.application.use_cases.promote_entity_on_confirm import PromoteEntityOnConfirmUseCase
from app.application.use_cases.promote_source_ledger_entry import PromoteSourceLedgerEntryUseCase
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_classifier_protocol import EntityTypeClassifierProtocol
from app.domain.ports.entity_type_correction_repository import EntityTypeCorrectionRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository


def _provide_promote_entity_use_case(
    components: ComponentRepository,
    entity_instances: EntityInstanceRepository,
    entity_types: EntityTypeRepository,
    extractions: ExtractionRepository,
    client: Client,
) -> PromoteEntityOnConfirmUseCase:
    """Factory for PromoteEntityOnConfirmUseCase.

    SupabaseEntityResolutionRepository is a concrete infrastructure class (not a
    port) — dishka cannot bind it via provide(class) because Protocol-typed
    params require explicit provides=. This factory instantiates it directly
    and passes it as the resolution_repo collaborator (D-07 BlendedRAG).
    entity_types + extractions added for field-child enrichment (identifiers,
    display_name, occurrence links).
    """
    resolution_repo = SupabaseEntityResolutionRepository(client=client)
    return PromoteEntityOnConfirmUseCase(
        components=components,
        entity_instances=entity_instances,
        entity_types=entity_types,
        extractions=extractions,
        resolution_repo=resolution_repo,
    )


def _provide_suggest_entity_types_use_case(
    components: ComponentRepository,
    entity_types: EntityTypeRepository,
    classifier: EntityTypeClassifierProtocol,
    corrections: EntityTypeCorrectionRepository,
) -> SuggestEntityTypesUseCase:
    """Factory for SuggestEntityTypesUseCase (Phase 57-02, LEARN-02).

    SuggestEntityTypesUseCase accepts ``corrections`` as Optional with a None
    default so existing unit tests/non-wired construction keep working;
    dishka does not auto-inject defaulted Optional params (mirrors
    _provide_autofill_use_case/_provide_set_component_entity_type_use_case),
    so this factory passes it explicitly to wire the best-effort correction
    few-shot retrieval into the live container.
    """
    return SuggestEntityTypesUseCase(
        components=components,
        entity_types=entity_types,
        classifier=classifier,
        corrections=corrections,
    )


def _provide_promote_edge_use_case(client: Client, importer_resolver: ImporterResolver) -> PromoteEdgeUseCase:
    """Factory for PromoteEdgeUseCase (Phase 30-02, TIER-03; extended Phase 44-03, TENA-03).

    SupabaseKnowledgeGraphRepository is a concrete infrastructure class (not a
    port) — dishka cannot bind it via provide(class) because Protocol-typed
    params require explicit provides=. Mirrors _provide_confirm_region_use_case:
    instantiates the adapter directly and injects it as a collaborator.
    importer_resolver is the already-bound ImporterResolver port (Phase 44-03's
    owned-importer resolver) — passed through so the use case can enforce the
    user-ownership guard whenever a caller supplies user_id.
    """
    knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)
    return PromoteEdgeUseCase(knowledge=knowledge_repo, importers=importer_resolver)


def _provide_promote_source_ledger_entry_use_case(
    client: Client,
    source_ledger: SourceLedgerRepository,
) -> PromoteSourceLedgerEntryUseCase:
    """Factory for PromoteSourceLedgerEntryUseCase (Phase 56-05 seam, wired Phase 63).

    56-05 built the promotion-gate reuse adapter but left it out of DI BY
    DESIGN — the canon-curation UX owns the wiring (its header's stated
    intent). This factory closes that seam: it builds a SourceCaptureHandler
    over a directly-instantiated SupabaseKnowledgeGraphRepository (concrete
    infrastructure class, not a port — same rationale as
    _provide_promote_edge_use_case/_provide_submit_widget_interaction) and
    threads in the already-bound SourceLedgerRepository. ZERO new promotion
    machinery — the handler and PromoteEdgeUseCase stay untouched (RCNV-01's
    zero-diff proof in test_promote_source_ledger_reuse.py).
    """
    knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)
    return PromoteSourceLedgerEntryUseCase(
        source_ledger=source_ledger,
        source_capture=SourceCaptureHandler(knowledge_graph=knowledge_repo),
    )


def _provide_resolve_candidates_use_case(
    entity_instances: EntityInstanceRepository,
    client: Client,
) -> ResolveEntityCandidatesUseCase:
    """Factory for ResolveEntityCandidatesUseCase.

    Mirrors _provide_promote_entity_use_case: instantiates
    SupabaseEntityResolutionRepository directly (not via port).
    """
    resolution_repo = SupabaseEntityResolutionRepository(client=client)
    return ResolveEntityCandidatesUseCase(
        entity_instances=entity_instances,
        resolution_repo=resolution_repo,
    )


def _provide_backfill_use_case(
    entity_instances: EntityInstanceRepository,
    promote: PromoteEntityOnConfirmUseCase,
) -> BackfillEntityIdentitiesUseCase:
    """Factory for BackfillEntityIdentitiesUseCase.

    Depends on PromoteEntityOnConfirmUseCase (registered via
    _provide_promote_entity_use_case above); dishka resolves it first
    because both are APP-scoped.
    """
    return BackfillEntityIdentitiesUseCase(
        entity_instances=entity_instances,
        promote=promote,
    )


def register(provider: Provider) -> None:
    """Register the entity group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    entity-type/field management + entity-resolution/promotion + merge-curation blocks
    they replaced.
    """
    # SuggestEntityTypesUseCase (Phase 57-02, LEARN-02): factory passes the optional
    # EntityTypeCorrectionRepository collaborator explicitly — dishka won't auto-inject a
    # defaulted Optional param (mirrors _provide_set_component_entity_type_use_case).
    provider.provide(_provide_suggest_entity_types_use_case, provides=SuggestEntityTypesUseCase)
    # Entity-type / field management (Phase 09-03, D-26/D-27) — all auto-inject
    # EntityTypeRepository (already bound to SupabaseEntityTypeRepository).
    provider.provide(CreateEntityTypeUseCase)
    provider.provide(UpdateEntityTypeUseCase)
    provider.provide(CreateFieldUseCase)
    provider.provide(UpdateFieldUseCase)
    provider.provide(DeleteFieldUseCase)
    provider.provide(ReorderFieldsUseCase)
    # Entity resolution + promotion (Phase 10-02, D-02/D-05/D-07/D-09/D-10/D-11).
    # SupabaseEntityResolutionRepository is concrete (no port Protocol) so each use
    # case that needs it gets a factory that instantiates it directly from Client.
    provider.provide(_provide_promote_entity_use_case, provides=PromoteEntityOnConfirmUseCase)
    # Human promotion mechanic (Phase 30-02, TIER-03) — suggest-only gate write.
    provider.provide(_provide_promote_edge_use_case, provides=PromoteEdgeUseCase)
    # chat_source_ledger canon promotion (Phase 56-05 seam, wired Phase 63) —
    # reshapes a ledger row onto the UNCHANGED SourceCaptureHandler.
    provider.provide(_provide_promote_source_ledger_entry_use_case, provides=PromoteSourceLedgerEntryUseCase)
    provider.provide(_provide_resolve_candidates_use_case, provides=ResolveEntityCandidatesUseCase)
    provider.provide(_provide_backfill_use_case, provides=BackfillEntityIdentitiesUseCase)
    # Human curation loop (Phase 10-03, D-20): confirm/reject/unmerge.
    # All three auto-inject EntityInstanceRepository (already bound).
    provider.provide(ConfirmMergeUseCase)
    provider.provide(RejectMergeUseCase)
    provider.provide(UnmergeEntityUseCase)
