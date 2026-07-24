"""Document-region providers — extracted from container.py (Track 2 decomposition).

Owns the document-understanding write surface: region proposal + confirmation, the
seven region-edit write-side use cases, document classification, the component-
relationship setters + origin-aware field-deny, and the two autofill use cases. All
16 bindings live here; four are factories (the two autofill use cases, ConfirmRegion,
and the correction-wired SetComponentEntityType) and the rest auto-inject their
ComponentRepository / EntityTypeRepository collaborators via provide(class).

`EmbeddingProtocol` is consumed by the autofill + ConfirmRegion factories but is
PROVIDED by container.py's must-stay `_provide_embedder` (it calls `boto3.client`
directly — a boot-test patch target) — it is injected here, never re-provided.
ConfirmRegion instantiates a concrete `SupabaseKnowledgeGraphRepository` over the
injected `Client`; no factory here calls a patched global, so container.py's boot-
test patch targets are untouched.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.application.use_cases.autofill import AutofillUseCase
from app.application.use_cases.autofill_fields import AutofillFieldsUseCase
from app.application.use_cases.classify_document import ClassifyDocumentUseCase
from app.application.use_cases.confirm_region import ConfirmRegionUseCase
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
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.set_component_relationship import (
    SetComponentEntityTypeUseCase,
    SetComponentFieldRelationshipUseCase,
    SetComponentRoleUseCase,
)
from app.application.use_cases.synthesize_knowledge import KnowledgeSynthesizerService
from app.domain.ports.autofill_protocol import AutofillProtocol
from app.domain.ports.autofill_retrieval_event_repository import AutofillRetrievalEventRepository
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.embedding_protocol import EmbeddingProtocol
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_correction_repository import EntityTypeCorrectionRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.knowledge_synthesizer import KnowledgeSynthesizer
from app.domain.ports.retrieval_port import RetrievalPort
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository


def _provide_autofill_use_case(
    components: ComponentRepository,
    entity_types: EntityTypeRepository,
    extractions: ExtractionRepository,
    autofiller: AutofillProtocol,
    embedder: EmbeddingProtocol,
    retrieval: RetrievalPort,
    entity_instances: EntityInstanceRepository,
    retrieval_events: AutofillRetrievalEventRepository,
) -> AutofillUseCase:
    """Factory for AutofillUseCase wired with the 04-08 few-shot retrieval ports.

    AutofillUseCase accepts ``embedder``/``retrieval``/``entity_instances``/
    ``retrieval_events`` as Optional with None defaults so unit tests can omit
    them; dishka does not auto-inject defaulted Optional params, so this
    factory passes them explicitly to enable the few-shot path (D-15), the
    cheap recall win (RECALL-01, 31-01), and the retrieval-outcome
    instrumentation write (RECALL-02, 31-02) in the live container.  When
    retrieval returns [] the use case still preserves the cold-start path
    (D-13); a resolved-entity read failure or instrumentation write failure
    never breaks autofill (both best-effort).
    """
    return AutofillUseCase(
        components=components,
        entity_types=entity_types,
        extractions=extractions,
        autofiller=autofiller,
        embedder=embedder,
        retrieval=retrieval,
        entity_instances=entity_instances,
        retrieval_events=retrieval_events,
    )


def _provide_autofill_fields_use_case(
    components: ComponentRepository,
    entity_types: EntityTypeRepository,
    extractions: ExtractionRepository,
    autofiller: AutofillProtocol,
    segmenter: SegmenterProtocol,
    embedder: EmbeddingProtocol,
    retrieval: RetrievalPort,
) -> AutofillFieldsUseCase:
    """Factory for AutofillFieldsUseCase (09-02b) with the few-shot + segmenter ports.

    Mirrors _provide_autofill_use_case: AutofillFieldsUseCase accepts
    ``embedder``/``retrieval`` as Optional (None defaults) which dishka won't
    auto-inject, so they are passed explicitly to keep the D-15 few-shot path
    active.  ``segmenter`` drives the entity-scoped sub-field auto-detect (D-13);
    its constructor param is typed ``object`` in the use case to avoid a
    Protocol-introspection issue, so it is passed positionally here as the
    SegmenterProtocol-resolved instance.
    """
    return AutofillFieldsUseCase(
        components=components,
        entity_types=entity_types,
        extractions=extractions,
        autofiller=autofiller,
        segmenter=segmenter,
        embedder=embedder,
        retrieval=retrieval,
    )


def _provide_confirm_region_use_case(
    components: ComponentRepository,
    extractions: ExtractionRepository,
    embedder: EmbeddingProtocol,
    entity_instances: EntityInstanceRepository,
    client: Client,
) -> ConfirmRegionUseCase:
    """Factory for ConfirmRegionUseCase.

    SupabaseKnowledgeGraphRepository is a concrete infrastructure class (not a
    port) — dishka cannot bind it via provide(class) because Protocol-typed
    params require explicit provides=. Mirrors _provide_promote_entity_use_case:
    instantiates the adapter directly, builds KnowledgeSynthesizerService on top
    of it, and injects the service into ConfirmRegionUseCase so the D-13
    synthesis hook is live (SYNTH-01).
    """
    knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)
    knowledge_synthesizer: KnowledgeSynthesizer = KnowledgeSynthesizerService(
        components=components,
        knowledge=knowledge_repo,
        entity_instances=entity_instances,
    )
    return ConfirmRegionUseCase(
        components=components,
        extractions=extractions,
        embedder=embedder,
        knowledge_synthesizer=knowledge_synthesizer,
    )


def _provide_set_component_entity_type_use_case(
    components: ComponentRepository,
    corrections: EntityTypeCorrectionRepository,
) -> SetComponentEntityTypeUseCase:
    """Factory for SetComponentEntityTypeUseCase (Phase 57-01, LEARN-01).

    SetComponentEntityTypeUseCase accepts ``corrections`` as Optional with a
    None default so existing unit tests/non-wired construction keep working;
    dishka does not auto-inject defaulted Optional params (mirrors
    _provide_autofill_use_case), so this factory passes it explicitly to wire
    the best-effort correction-capture hook in the live container.
    """
    return SetComponentEntityTypeUseCase(components=components, corrections=corrections)


def register(provider: Provider) -> None:
    """Register the document-region group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    autofill / ConfirmRegion / region-edit write-side / relationship-setter / deny blocks
    they replaced.
    """
    # AutofillUseCase / AutofillFieldsUseCase have Optional embedder/retrieval params (None
    # defaults) that dishka won't auto-inject — factories pass the 04-08 few-shot ports
    # (+ segmenter for the 09-02b entity-scoped auto-detect) explicitly.
    provider.provide(_provide_autofill_use_case, provides=AutofillUseCase)
    provider.provide(_provide_autofill_fields_use_case, provides=AutofillFieldsUseCase)
    provider.provide(_provide_confirm_region_use_case, provides=ConfirmRegionUseCase)
    # Region proposal + the region-edit write side (Phase 06) — all auto-inject
    # ComponentRepository.
    provider.provide(ProposeRegionsUseCase)
    provider.provide(AcceptRegionUseCase)
    provider.provide(RejectRegionUseCase)
    provider.provide(RedrawRegionUseCase)
    provider.provide(SplitRegionUseCase)
    provider.provide(MergeRegionsUseCase)
    provider.provide(NestRegionUseCase)
    provider.provide(ClassifyDocumentUseCase)
    provider.provide(CreateRegionUseCase)
    # Relationship setters + origin-aware deny (Phase 09-02a) — all auto-inject
    # ComponentRepository (DenyFieldUseCase also auto-injects ExtractionRepository).
    provider.provide(SetComponentRoleUseCase)
    # SetComponentEntityTypeUseCase (Phase 57-01, LEARN-01): factory passes the optional
    # EntityTypeCorrectionRepository collaborator explicitly — dishka won't auto-inject a
    # defaulted Optional param (mirrors _provide_autofill_use_case).
    provider.provide(_provide_set_component_entity_type_use_case, provides=SetComponentEntityTypeUseCase)
    provider.provide(SetComponentFieldRelationshipUseCase)
    provider.provide(DenyFieldUseCase)
