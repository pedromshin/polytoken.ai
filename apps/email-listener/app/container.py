"""Dishka dependency injection container.

Registers:
- Supabase client factory (singleton)
- Five repository adapters bound to their domain port interfaces
- LLM segmentation (AsyncAnthropicBedrock, AnthropicSegmenter)
- Parser registry (get_parser callable with PdfParser registered under "pdf")
- Application use cases
"""

from __future__ import annotations

import functools
from collections.abc import Mapping

import boto3
import httpx
from anthropic import AsyncAnthropicBedrock
from dishka import AsyncContainer, Provider, Scope, make_async_container
from supabase import Client

from app.application.capabilities.registry import CapabilityRegistry, define_capability
from app.application.use_cases.autofill import AutofillUseCase
from app.application.use_cases.autofill_fields import AutofillFieldsUseCase
from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.backfill_inbound_email import BackfillInboundEmailUseCase
from app.application.use_cases.classify_document import ClassifyDocumentUseCase
from app.application.use_cases.confirm_action_dispatch import (
    ConfirmActionHandler,
    KnowledgeEdgeTierPromotionHandler,
    SourceCaptureHandler,
    UnsupportedConfirmActionHandler,
)
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
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
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
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.receive_inbound_email import ReceiveInboundEmailUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.application.use_cases.research.deep_research import define_research_capability
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.application.use_cases.resolve_ingest_entities import ResolveIngestEntitiesUseCase
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_confirm_action import (
    SUGGESTION_KIND_EDGE_TIER_PROMOTION,
    SUGGESTION_KIND_ENTITY_MERGE_CONFIRM,
    SUGGESTION_KIND_SOURCE_CAPTURE,
)
from app.application.use_cases.set_component_relationship import (
    SetComponentEntityTypeUseCase,
    SetComponentFieldRelationshipUseCase,
    SetComponentRoleUseCase,
)
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.application.use_cases.synthesize_knowledge import KnowledgeSynthesizerService
from app.composition import genui_providers
from app.domain.ports.anticipatory_ports import AnticipatoryCapStore, AppropriatenessJudge
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.autofill_protocol import AutofillProtocol
from app.domain.ports.autofill_retrieval_event_repository import AutofillRetrievalEventRepository
from app.domain.ports.chat_context_edge_repository import ChatContextEdgeRepository
from app.domain.ports.chat_repositories import (
    ChatConversationRepository,
    ChatMessageRepository,
    ChatRunRepository,
)
from app.domain.ports.chat_widget_interaction_repository import ChatWidgetInteractionRepository
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.cost_ledger_repository import CostLedgerRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.embedding_protocol import EmbeddingProtocol
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_classifier_protocol import EntityTypeClassifierProtocol
from app.domain.ports.entity_type_correction_repository import EntityTypeCorrectionRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.knowledge_synthesizer import KnowledgeSynthesizer
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import BackfillRawEmailStore, RawEmailStore
from app.domain.ports.retrieval_port import RetrievalPort
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.domain.ports.thread_resolver import ThreadResolver
from app.domain.services.chat_provider_router import ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker
from app.infrastructure.anticipatory.in_memory_cap_store import InMemoryAnticipatoryCapStore
from app.infrastructure.llm.anthropic_client import get_anthropic_client
from app.infrastructure.llm.anticipatory_judge_adapter import BedrockAppropriatenessJudgeAdapter
from app.infrastructure.llm.autofill_adapter import AnthropicAutofiller
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter
from app.infrastructure.llm.chat_tools import (
    build_emit_clarify_widget_tool,
    build_emit_confirm_action_tool,
    build_emit_proposal_cards_tool,
    build_emit_ui_spec_tool,
)
from app.infrastructure.llm.embedding_adapter import EmbeddingAdapter
from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier
from app.infrastructure.llm.openrouter_chat_adapter import OpenRouterChatAdapter
from app.infrastructure.llm.segmentation_adapter import AnthropicSegmenter
from app.infrastructure.ocr.textract_adapter import TextractOcrAdapter
from app.infrastructure.pdf.parser_registry import get_parser, register
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.raw_email_store_routing import RoutingRawEmailStore
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.autofill_retrieval_event_repository import (
    SupabaseAutofillRetrievalEventRepository,
)
from app.infrastructure.supabase.chat_context_edge_repository import SupabaseChatContextEdgeRepository
from app.infrastructure.supabase.client import get_supabase_client
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.entity_type_correction_repository import (
    SupabaseEntityTypeCorrectionRepository,
)
from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository
from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
from app.infrastructure.supabase.forwarding_address_repository import SupabaseForwardingAddressRepository
from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository
from app.infrastructure.supabase.raw_email_backfill_store import SupabaseRawEmailBackfillStore
from app.infrastructure.supabase.retrieval_repository import SupabaseRetrievalRepository
from app.infrastructure.supabase.source_ledger_repository import SupabaseSourceLedgerRepository
from app.infrastructure.supabase.supabase_chat_conversation_repository import (
    SupabaseChatConversationRepository,
)
from app.infrastructure.supabase.supabase_chat_message_repository import SupabaseChatMessageRepository
from app.infrastructure.supabase.supabase_chat_run_repository import SupabaseChatRunRepository
from app.infrastructure.supabase.supabase_chat_widget_interaction_repository import (
    SupabaseChatWidgetInteractionRepository,
)
from app.infrastructure.supabase.supabase_cost_ledger_repository import SupabaseCostLedgerRepository
from app.infrastructure.supabase.thread_repository import SupabaseThreadRepository
from app.infrastructure.tools.duckduckgo_search_provider import DuckDuckGoSearchProvider
from app.infrastructure.tools.lookup_entity_executor import (
    LookupEntityExecutor,
    build_lookup_entity_tool,
)
from app.infrastructure.tools.search_emails_executor import (
    SearchEmailsExecutor,
    build_search_emails_tool,
)
from app.infrastructure.tools.search_knowledge_executor import (
    SearchKnowledgeExecutor,
    build_search_knowledge_tool,
)
from app.infrastructure.tools.web_search_executor import (
    WebSearchExecutor,
    build_web_search_tool,
    fetch_page_via_httpx,
)
from app.settings import get_settings


def _provide_supabase_client() -> Client:
    """Thin annotated wrapper delegating to the lru_cache-backed factory.

    dishka cannot introspect the ``_lru_cache_wrapper`` produced by
    ``@lru_cache`` (its ``*args, **kwargs`` signature has no type hints), so the
    raw factory cannot be passed to ``provider.provide``. This wrapper exposes a
    clean ``-> Client`` signature for dishka while the underlying cache still
    guarantees a single client instance.
    """
    return get_supabase_client()


def _provide_anthropic_client() -> AsyncAnthropicBedrock:
    """Thin annotated wrapper delegating to the lru_cache-backed Bedrock client factory.

    Mirrors _provide_supabase_client — wraps the @lru_cache get_anthropic_client
    so dishka can introspect the clean return-type signature.
    Authentication via ECS task IAM role (bedrock:InvokeModel) — no API key.
    """
    return get_anthropic_client()


def _provide_backfill_raw_email_store(client: Client) -> BackfillRawEmailStore:
    """Writable backfill raw MIME store on Supabase Storage (private bucket)."""
    return SupabaseRawEmailBackfillStore(client=client, bucket=get_settings().RAW_EMAILS_BUCKET)


def _provide_raw_email_store(backfill_store: BackfillRawEmailStore) -> RawEmailStore:
    """Raw MIME reads routed by id namespace: SES ids -> S3, bf- ids -> Supabase.

    The S3 half keeps the default boto3 credential chain (ECS task IAM role).
    """
    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.ses_s3_region)
    ses_store = S3RawEmailStore(bucket=settings.SES_S3_BUCKET, prefix=settings.ses_s3_prefix, client=s3_client)
    return RoutingRawEmailStore(ses_store=ses_store, backfill_store=backfill_store)


def _provide_attachment_storage(client: Client) -> AttachmentStorage:
    """Attachment blob storage on Supabase Storage (private bucket)."""
    return SupabaseAttachmentStorage(client=client, bucket=get_settings().ATTACHMENTS_BUCKET)


def _provide_ingestion_config() -> IngestionConfig:
    return IngestionConfig(default_importer_id=get_settings().DEFAULT_IMPORTER_ID)


def _provide_importer_resolver(client: Client) -> ImporterResolver:
    """SupabaseImporterRepository bound to the ImporterResolver port.

    Uses the DEFAULT_IMPORTER_ID setting as the malformed-sender fallback
    (T-04-34: malformed senders fall back rather than creating junk rows).
    """
    return SupabaseImporterRepository(
        client=client,
        default_importer_id=get_settings().DEFAULT_IMPORTER_ID,
    )


def _provide_thread_resolver(client: Client) -> ThreadResolver:
    """SupabaseThreadRepository bound to the ThreadResolver port (Phase 45, THRD-01).

    Resolved once per ingest, right after importer_id — mirrors
    _provide_importer_resolver's shape and the ImporterResolver DI pattern.
    """
    return SupabaseThreadRepository(client=client)


def _provide_forwarding_address_resolver(client: Client) -> ForwardingAddressResolver:
    """SupabaseForwardingAddressRepository bound to the ForwardingAddressResolver port.

    Phase 45, THRD-04. Resolved before importer_resolver inside execute() —
    its output anchors newly-created importers to the forwarding token's
    owning user_id. Mirrors _provide_importer_resolver/_provide_thread_resolver.
    """
    return SupabaseForwardingAddressRepository(client=client)


def _provide_autofiller(client: AsyncAnthropicBedrock) -> AutofillProtocol:
    """AnthropicAutofiller backed by AWS Bedrock — implements AutofillProtocol."""
    return AnthropicAutofiller(client=client, model_id=get_settings().bedrock_model_id)


def _provide_entity_type_classifier(client: AsyncAnthropicBedrock) -> EntityTypeClassifierProtocol:
    """AnthropicEntityTypeClassifier backed by AWS Bedrock — implements EntityTypeClassifierProtocol.

    Uses the SAME configured Bedrock model as autofill (settings.bedrock_model_id).
    The hardcoded legacy haiku model 404s ("marked by provider as Legacy … upgrade
    to an active model"); the configured model is the active, invokable one. This is
    one batched call per document, so the larger model's cost/latency is fine.
    """
    return AnthropicEntityTypeClassifier(client=client, model_id=get_settings().bedrock_model_id)


def _provide_embedder() -> EmbeddingProtocol:
    """EmbeddingAdapter backed by AWS Bedrock Amazon Titan Text Embeddings V2 (1536-dim).

    The bedrock-runtime boto3 client uses the ambient ECS task IAM role
    (bedrock:InvokeModel) — no API key.  Embeddings power the D-15 learning
    flywheel: confirmed regions are embedded and indexed for few-shot retrieval.
    """
    client = boto3.client("bedrock-runtime", region_name=get_settings().bedrock_region)
    return EmbeddingAdapter(client=client)


def _provide_retrieval(client: Client) -> RetrievalPort:
    """SupabaseRetrievalRepository — hybrid vector+trigram retrieval (RRF k=60, D-15).

    Both sub-queries filter by importer_id for cross-tenant isolation (T-04-28).
    """
    return SupabaseRetrievalRepository(client=client)


def _provide_entity_type_correction_repository(client: Client) -> EntityTypeCorrectionRepository:
    """SupabaseEntityTypeCorrectionRepository (Phase 57-01, LEARN-01).

    Mirrors _provide_retrieval: the constructor's ``client`` param is typed
    ``Any`` (matching retrieval_repository.py's exact style per the plan),
    which dishka cannot auto-inject directly — a factory typed against the
    concrete ``Client`` resolves it explicitly.
    """
    return SupabaseEntityTypeCorrectionRepository(client=client)


def _provide_autofill_retrieval_event_repository(client: Client) -> AutofillRetrievalEventRepository:
    """SupabaseAutofillRetrievalEventRepository — best-effort instrumentation writer (RECALL-02, 31-02)."""
    return SupabaseAutofillRetrievalEventRepository(client=client)


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


def _provide_segmenter(client: AsyncAnthropicBedrock) -> SegmenterProtocol:
    """AnthropicSegmenter backed by AWS Bedrock — implements SegmenterProtocol."""
    return AnthropicSegmenter(client=client, model_id=get_settings().bedrock_model_id)


def _provide_parser_registry() -> object:
    """Return the get_parser callable typed as object to avoid dishka forward-ref issues.

    ParserRegistryPort = Callable[["str"], "ParserProtocol | None"] uses string
    annotations that dishka cannot resolve at runtime.  Providing as ``object``
    bypasses the type-analysis; the container.get(ParserRegistryPort) call
    in tests uses the alias as a key which resolves to this factory.

    Registration is idempotent: the guard ``if get_parser("pdf") is None``
    prevents UnsupportedFileTypeError on duplicate registration (e.g. across
    multiple container rebuilds in tests).

    The PdfParser is backed by TextractOcrAdapter using the ambient IAM role.
    """
    if get_parser("pdf") is None:
        settings = get_settings()
        textract_client = boto3.client("textract", region_name=settings.AWS_TEXTRACT_REGION)
        ocr_adapter = TextractOcrAdapter(client=textract_client)
        register("pdf", PdfParser(ocr=ocr_adapter))
    return get_parser


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


def _provide_resolve_ingest_entities_use_case(
    components: ComponentRepository,
    entity_instances: EntityInstanceRepository,
    client: Client,
) -> ResolveIngestEntitiesUseCase:
    """Factory for ResolveIngestEntitiesUseCase (AI-03).

    SupabaseEntityResolutionRepository and SupabaseKnowledgeGraphRepository are
    concrete infrastructure classes (no port Protocol), so — mirroring
    _provide_promote_entity_use_case / _provide_confirm_region_use_case — this
    factory instantiates them directly from the Client rather than binding them
    as ports. The use case is ALWAYS constructible (its test suite exists
    regardless of the flag); whether the ingest pipeline actually runs it is
    gated by INGEST_ENTITY_RESOLUTION_ENABLED inside _provide_ingest_use_case.
    """
    return ResolveIngestEntitiesUseCase(
        components=components,
        entity_instances=entity_instances,
        resolution_repo=SupabaseEntityResolutionRepository(client=client),
        knowledge=SupabaseKnowledgeGraphRepository(client=client),
    )


def _provide_ingest_use_case(
    raw_store: RawEmailStore,
    email_repo: EmailRepository,
    attachment_repo: AttachmentRepository,
    attachment_storage: AttachmentStorage,
    config: IngestionConfig,
    components: ComponentRepository,
    segmenter: SegmenterProtocol,
    propose_regions: ProposeRegionsUseCase,
    importer_resolver: ImporterResolver,
    thread_resolver: ThreadResolver,
    forwarding_resolver: ForwardingAddressResolver,
    suggest_entity_types: SuggestEntityTypesUseCase,
    resolve_ingest_entities: ResolveIngestEntitiesUseCase,
) -> IngestInboundEmailUseCase:
    """Factory for IngestInboundEmailUseCase.

    ParserRegistryPort is a Callable type alias with forward-ref annotations
    that dishka cannot analyse at runtime.  We obtain the registry by calling
    _provide_parser_registry() directly inside this factory (idempotent guard
    ensures no double-registration).

    SegmenterProtocol is accepted as a parameter to force dishka to create the
    segmenter first; we don't need it here directly since ProposeRegionsUseCase
    already holds a reference to it, but the dependency ensures correct ordering.

    SuggestEntityTypesUseCase is injected and passed through so the ingest
    pipeline auto-classifies candidate regions after propose_regions (best-effort).

    thread_resolver (Phase 45, THRD-01) is resolved right after importer_id
    inside execute() and is best-effort (T-45-03-02): a resolution failure
    never fails ingestion.

    forwarding_resolver (Phase 45, THRD-04) is resolved BEFORE importer_id
    inside execute() and is also best-effort (T-45-05-03): its output anchors
    a newly-created importer to the forwarding token's owning user_id.

    resolve_ingest_entities (AI-03) is the ingest-time entity-resolution stage.
    It is injected ALWAYS but wired into the use case only when
    INGEST_ENTITY_RESOLUTION_ENABLED is set — a False flag passes None, so the
    pipeline STRUCTURALLY omits the stage (a real kill-switch, not a mutation),
    matching the SEARCH_KNOWLEDGE_TOOL_ENABLED exposure-gate convention.
    """
    raw_registry = _provide_parser_registry()
    # _provide_parser_registry returns ``object`` to satisfy dishka; cast back
    # to the correct callable type for IngestInboundEmailUseCase.
    parser_registry: ParserRegistryPort = raw_registry  # type: ignore[assignment]
    resolution_enabled = get_settings().INGEST_ENTITY_RESOLUTION_ENABLED
    return IngestInboundEmailUseCase(
        raw_store=raw_store,
        email_repo=email_repo,
        attachment_repo=attachment_repo,
        attachment_storage=attachment_storage,
        config=config,
        components=components,
        parser_registry=parser_registry,
        propose_regions=propose_regions,
        importer_resolver=importer_resolver,
        thread_resolver=thread_resolver,
        forwarding_resolver=forwarding_resolver,
        suggest_entity_types=suggest_entity_types,
        resolve_ingest_entities=resolve_ingest_entities if resolution_enabled else None,
    )


def _provide_anticipatory_judge(client: AsyncAnthropicBedrock) -> AppropriatenessJudge:
    """BedrockAppropriatenessJudgeAdapter — gate #1 of the ANTIC-02 dark pipeline (D-07/D-09).

    Registered so the pipeline is DI-constructible (D-01); the pipeline itself
    is not invoked anywhere in the live turn loop (D-12 — dark by default via
    ANTICIPATORY_PROMPTING_ENABLED=False, checked by the caller, not here).
    """
    settings = get_settings()
    return BedrockAppropriatenessJudgeAdapter(
        client=client,
        model_id=settings.anticipatory_judge_model_id,
        max_tokens=settings.ANTICIPATORY_JUDGE_MAX_TOKENS,
        timeout_seconds=settings.ANTICIPATORY_JUDGE_TIMEOUT_SECONDS,
        threshold=settings.ANTICIPATORY_APPROPRIATENESS_THRESHOLD,
    )


def _provide_evaluate_anticipatory_candidates(
    judge: AppropriatenessJudge,
    cap_store: AnticipatoryCapStore,
) -> EvaluateAnticipatoryCandidates:
    """Factory for EvaluateAnticipatoryCandidates — the ANTIC-02 gate-chain use case (D-01/D-08).

    Both collaborators are the domain PORTS (not concrete adapters) — mirrors
    every other Protocol-typed use case factory in this module.
    """
    return EvaluateAnticipatoryCandidates(judge=judge, cap_store=cap_store)


def _provide_httpx_client() -> httpx.AsyncClient:
    """Shared httpx AsyncClient singleton for outbound streaming HTTP calls (OpenRouter, D-07 seam).

    `read=None` disables httpx's own read timeout: OpenRouterChatAdapter wraps
    its SSE line iteration in its own asyncio.timeout inactivity guard
    (rescheduled per event, same idiom as the Bedrock adapter), so THAT is the
    real safety net for a long-lived stream — a fixed httpx read timeout would
    otherwise kill a healthy multi-minute stream.
    """
    return httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))


def _provide_bedrock_chat_adapter(client: AsyncAnthropicBedrock) -> BedrockChatAdapter:
    """BedrockChatAdapter — one ChatProvider implementation (Phase 22, D-22).

    Reuses the shared AsyncAnthropicBedrock client (already bound above as a
    singleton). Bound to its own concrete type (not the ChatProvider Protocol)
    because OpenRouterChatAdapter implements the SAME Protocol structurally —
    the chat orchestration layer (22-06) selects between them by the picked
    model's registry transport, not via a single Protocol-keyed binding.
    """
    settings = get_settings()
    return BedrockChatAdapter(
        client=client,
        inactivity_timeout_seconds=settings.CHAT_INACTIVITY_TIMEOUT_SECONDS,
    )


def _provide_chat_message_repository(client: Client) -> ChatMessageRepository:
    """SupabaseChatMessageRepository — chat_messages adapter (FOUND-1, D-16, D-18, Phase 22-06)."""
    return SupabaseChatMessageRepository(client=client)


def _provide_chat_run_repository(client: Client) -> ChatRunRepository:
    """SupabaseChatRunRepository — chat_runs/chat_run_events adapter (SEAM-03/04, D-27, Phase 22-06)."""
    return SupabaseChatRunRepository(client=client)


def _provide_chat_conversation_repository(client: Client) -> ChatConversationRepository:
    """SupabaseChatConversationRepository — the turn loop's chat_conversations write (D-10/D-12)."""
    return SupabaseChatConversationRepository(client=client)


def _provide_chat_widget_interaction_repository(client: Client) -> ChatWidgetInteractionRepository:
    """SupabaseChatWidgetInteractionRepository — chat_widget_interactions adapter (Phase 24-01/24-02)."""
    return SupabaseChatWidgetInteractionRepository(client=client)


def _provide_chat_provider_router(
    bedrock: BedrockChatAdapter,
    openrouter: OpenRouterChatAdapter,
) -> ChatProviderRouter:
    """ChatProviderRouter — routes a picked model_id to its registry transport (Phase 22-06)."""
    return ChatProviderRouter(bedrock=bedrock, openrouter=openrouter)


def _provide_run_chat_turn(
    messages: ChatMessageRepository,
    runs: ChatRunRepository,
    conversations: ChatConversationRepository,
    router: ChatProviderRouter,
    bedrock: BedrockChatAdapter,
    breaker: CostCircuitBreaker,
    ledger: CostLedgerRepository,
    widget_interactions: ChatWidgetInteractionRepository,
    client: Client,
    entity_instances: EntityInstanceRepository,
    entity_types: EntityTypeRepository,
    embedder: EmbeddingProtocol,
    retrieval: RetrievalPort,
    components: ComponentRepository,
    email_repo: EmailRepository,
    http_client: httpx.AsyncClient,
    source_ledger: SourceLedgerRepository,
    context_edges: ChatContextEdgeRepository,
) -> RunChatTurn:
    """Factory for RunChatTurn — the chat turn agent (SEAM-04, Phase 22-06/22-07/24-02).

    default_importer_id/max_output_tokens come from settings (single-tenant
    DEFAULT_IMPORTER_ID + CHAT_MAX_OUTPUT_TOKENS), not per-call parameters.
    emit_ui_spec_tool/interactive_widget_tools are wired here (not imported by
    run_chat_turn.py itself) — RunChatTurn takes them as plain dict/tuple
    constructor parameters specifically so the application layer never
    imports app.infrastructure (Phase 22-07, see chat_tools.py's layering
    note). Phase 24-02/24-04: emit_proposal_cards + emit_clarify_widget are
    threaded in as the interactive_widget_tools entries, alongside the
    widget-interaction repository RunChatTurn needs to create the one pending
    row per emitted widget (D-04) and to supersede pending widgets on typing
    (D-02).

    Phase 36-02: wires the first two real, production ToolExecutors —
    lookup_entity (TOOL-01, 36-01) and search_emails (TOOL-02, this plan) —
    both thin wrappers over EXISTING repository/port calls, zero new backend.
    SupabaseEntityResolutionRepository is a concrete infrastructure class (not
    a port), so it is instantiated directly here, mirroring
    _provide_resolve_candidates_use_case's identical existing pattern. Both
    tools are offered to every max_tool_rounds > 0 model (the 2 Bedrock
    Claude registry entries) — no further per-model capability gating is
    added by this plan (the existing max_tool_rounds gate already covers it).

    Phase 37-02: search_knowledge (TOOL-03/TOOL-04) is built and fully tested
    but ships DARK — the exposure gate (synthesis P6 rule, 37-CONTEXT.md's
    "Exposure gating" decision). SEARCH_KNOWLEDGE_TOOL_ENABLED defaults False;
    the tool_executors/server_tool_defs mappings below structurally OMIT the
    search_knowledge key unless the flag is explicitly set true (immutable
    dict-literal construction with conditional ** unpacking — never mutation).
    Phase 38 flips the default after the adversarial fixture suite passes.
    SupabaseKnowledgeGraphRepository is instantiated directly (concrete
    infrastructure class, mirrors _provide_promote_edge_use_case's pattern).

    Phase 40-01 (CONF-01): emit_confirm_action is threaded in as a fourth
    interactive_widget_tools entry, ALWAYS offered (unlike search_knowledge,
    it has no exposure flag — Phase 24-style widget tools are terminal/
    human-confirm by construction, not a mid-turn data-read risk). The SAME
    `knowledge_repo` instance built above for search_knowledge is reused as
    RunChatTurn's `knowledge_graph` collaborator — `_finalize_confirm_action`'s
    live edge re-read at emission time.

    Phase 54-02 (CLUS-03): web_search is built and fully tested (incl. its
    own 10-fixture adversarial injection suite) but follows the SAME
    exposure-gate discipline as search_knowledge — WEB_SEARCH_TOOL_ENABLED
    structurally omits the web_search key from both mappings below unless
    explicitly set true. Flipped to True in this same run because the
    adversarial suite passed against the real wired executor. Reuses the
    ALREADY-shared `http_client` singleton (D-07 seam, `_provide_httpx_client`)
    for BOTH the DuckDuckGoSearchProvider's search step and
    `fetch_page_via_httpx`'s page-fetch step — no second httpx client is
    created.

    Phase 54-05 (CLUS-02/CLUS-06): `email_repo` (already a factory parameter
    for `search_emails_executor` above) is ALSO threaded into RunChatTurn's
    additive `email_repository` collaborator — the bounded, quarantined
    thread+cluster context injection's one new read dependency. No new
    provider/instance is created; `knowledge_graph=knowledge_repo` (already
    wired for Phase 40-01's confirm-action re-read) doubles as the
    captured-source read collaborator too.

    Phase 56-02 (RCNV-01): `source_ledger` (SupabaseSourceLedgerRepository,
    bound above) is threaded into RunChatTurn's additive `source_ledger`
    collaborator — the fail-open `chat_source_ledger` auto-collect write
    hook fired from inside `_run_server_tool_round` for every gated
    `web_search` result. Zero knowledge-graph writes; no settings kill-switch
    (gating is inherited transitively from WEB_SEARCH_TOOL_ENABLED, A4).

    Phase 69 (RSRCH-01): `bedrock` (the BedrockChatAdapter singleton bound
    below, same instance the ChatProviderRouter routes to) is injected as the
    deep-research loop's internal ChatProvider — deep_research is the first
    capability that is ITSELF an LLM consumer, so the factory now takes the
    concrete adapter directly, exactly how _provide_chat_provider_router
    receives it. The capability is registered via its own module's
    define_research_capability (no container-core construction) behind the
    RESEARCH_TOOL_ENABLED exposure gate, mirroring web_search's structural
    omission pattern.

    Phase 56-04 (RCNV-04): `context_edges` (SupabaseChatContextEdgeRepository,
    bound above) is threaded into RunChatTurn's additive `context_edges`
    collaborator — the SECOND, INDEPENDENT fail-open linked-context injection
    pipeline fired from inside `_execute_turn` alongside (never nested inside)
    the existing thread/cluster injection. The SAME `knowledge_repo` instance
    built above doubles as the tier-agnostic `get_node_by_id` read collaborator
    (D-56-A); the SAME `email_repo`/`messages`/`source_ledger` collaborators
    already threaded above double as this pipeline's other three per-type
    resolver reads — no new provider/instance beyond `context_edges` itself.
    """
    settings = get_settings()
    resolution_repo = SupabaseEntityResolutionRepository(client=client)
    lookup_entity_executor = LookupEntityExecutor(
        entity_instances=entity_instances,
        resolution_repo=resolution_repo,
        entity_types=entity_types,
        embedder=embedder,
    )
    search_emails_executor = SearchEmailsExecutor(
        retrieval=retrieval,
        entity_types=entity_types,
        components=components,
        emails=email_repo,
        embedder=embedder,
    )
    knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)
    search_knowledge_executor = SearchKnowledgeExecutor(knowledge=knowledge_repo, embedder=embedder)
    web_search_executor = WebSearchExecutor(
        provider=DuckDuckGoSearchProvider(client=http_client),
        fetch_page=functools.partial(fetch_page_via_httpx, http_client),
    )
    # Phase 68 (REG-02): the chat tool loop's ONE source of truth. The old two
    # hand-maintained parallel dicts (tool_executors + server_tool_defs, whose
    # keys had to be kept identical by hand) are DELETED here -- each tool is now
    # declared exactly once as a Capability (its executor + its Bedrock tool_def +
    # its id/describe/risk/cost/source/trust metadata), and RunChatTurn's two
    # mappings are DERIVED from the registry (registry.executors()/.tool_defs()),
    # keyed identically by construction so they can no longer drift. The
    # exposure-gated tools (search_knowledge, web_search) are conditionally
    # included in the declaration list exactly as before -- structural omission
    # (never mutation) when their settings flag is off, so behavior is identical.
    chat_capabilities = CapabilityRegistry(
        [
            define_capability(
                executor=lookup_entity_executor,
                tool_def=build_lookup_entity_tool(),
                risk="read",
                cost="cheap",
            ),
            define_capability(
                executor=search_emails_executor,
                tool_def=build_search_emails_tool(),
                risk="read",
                cost="cheap",
            ),
            *(
                [
                    define_capability(
                        executor=search_knowledge_executor,
                        tool_def=build_search_knowledge_tool(),
                        risk="read",
                        cost="cheap",
                    )
                ]
                if settings.SEARCH_KNOWLEDGE_TOOL_ENABLED
                else []
            ),
            *(
                [
                    define_capability(
                        executor=web_search_executor,
                        tool_def=build_web_search_tool(),
                        risk="read",
                        cost="moderate",
                    )
                ]
                if settings.WEB_SEARCH_TOOL_ENABLED
                else []
            ),
            # Phase 69 (RSRCH-01): deep_research — the bounded multi-round
            # research loop, packaged as ONE Capability by its own module's
            # registration helper (define_research_capability declares
            # risk="read"/cost="expensive" itself). Mirrors the web_search
            # exposure-gate pattern above: structural omission (never
            # mutation) when RESEARCH_TOOL_ENABLED is off. Collaborators are
            # all ALREADY-built instances — the DI-provided BedrockChatAdapter
            # singleton (the curated chat models are Bedrock-transport; the
            # loop's internal plan/draft/verify/synthesize calls pin the
            # settings model id rather than the user's per-turn pick) and the
            # SAME web_search_executor wired above (the loop's search rounds
            # reach the open internet through the identical SSRF-checked
            # seam, whether or not web_search itself is exposed to the model).
            *(
                [
                    define_research_capability(
                        chat_provider=bedrock,
                        search_executor=web_search_executor,
                        model_id=settings.bedrock_model_id,
                    )
                ]
                if settings.RESEARCH_TOOL_ENABLED
                else []
            ),
        ]
    )
    return RunChatTurn(
        messages=messages,
        runs=runs,
        conversations=conversations,
        router=router,
        breaker=breaker,
        ledger=ledger,
        emit_ui_spec_tool=build_emit_ui_spec_tool(),
        default_importer_id=settings.DEFAULT_IMPORTER_ID,
        max_output_tokens=settings.CHAT_MAX_OUTPUT_TOKENS,
        widget_interactions=widget_interactions,
        interactive_widget_tools=(
            build_emit_proposal_cards_tool(),
            build_emit_clarify_widget_tool(),
            build_emit_confirm_action_tool(),
        ),
        knowledge_graph=knowledge_repo,
        # Phase 68 (REG-02): both mappings are DERIVED from the single registry
        # above -- one declaration per tool, no parallel key-duplication to
        # maintain by hand. Keyed identically by construction.
        tool_executors=chat_capabilities.executors(),
        server_tool_defs=chat_capabilities.tool_defs(),
        # Phase 54-05 (CLUS-02/CLUS-06): reuses the SAME `email_repo` instance
        # already built above for search_emails_executor -- the thread+cluster
        # context gathering step's one new read collaborator.
        email_repository=email_repo,
        # Phase 56-02 (RCNV-01): the fail-open auto-collect ledger write hook's
        # additive-default collaborator -- unwired in any caller/test that
        # doesn't pass it, structurally OFF (mirrors email_repository above).
        source_ledger=source_ledger,
        # Phase 56-04 (RCNV-04): the SECOND, INDEPENDENT linked-context
        # injection pipeline's additive-default collaborator -- unwired in
        # any caller/test that doesn't pass it, structurally OFF (mirrors
        # source_ledger above). Never gated on thread linkage.
        context_edges=context_edges,
    )


def _provide_submit_widget_interaction(
    widget_interactions: ChatWidgetInteractionRepository,
    messages: ChatMessageRepository,
    continuation_runner: RunChatTurn,
    client: Client,
    promote_edge_use_case: PromoteEdgeUseCase,
) -> SubmitWidgetInteraction:
    """Factory for SubmitWidgetInteraction — the DCUI-03 submit use case (Phase 24-02).

    continuation_runner is typed as RunChatTurn here (dishka needs a concrete
    resolvable type) but SubmitWidgetInteraction itself only depends on the
    narrow local ContinuationRunner Protocol (continue_after_widget) — RunChatTurn
    satisfies it structurally, mirroring how BedrockChatAdapter/OpenRouterChatAdapter
    both satisfy ChatProvider without an explicit inheritance link.

    Phase 40-02 (CONF-02): SupabaseKnowledgeGraphRepository is instantiated
    directly here (concrete infrastructure class, not a port — dishka cannot
    bind it via provide(class) for the same reason as
    _provide_promote_edge_use_case/_provide_run_chat_turn; no shared DI
    singleton exists for KnowledgeGraphRepository, every factory that needs
    one builds its own). promote_edge_use_case is already DI-registered
    (_provide_promote_edge_use_case) and reused here via injection, not
    rebuilt. The explicit finite dispatch table is built entirely
    server-side (T-40-06) — knowledge_edge_tier_promotion is real;
    entity_merge_confirm is the registered-but-unsupported stub
    (40-CONTEXT.md's pair-keyed blocker, see confirm_action_dispatch.py).

    Phase 54-03 (CLUS-04/CLUS-05): source_capture is a THIRD real dispatch
    target — SourceCaptureHandler reuses the SAME `knowledge_repo` instance
    built above (no second SupabaseKnowledgeGraphRepository instantiation in
    this factory), writing INFERRED knowledge_nodes/knowledge_node_edges
    rows on confirm. Its edges promote through the UNCHANGED
    PromoteEdgeUseCase (CLUS-05) — no new promotion machinery.
    """
    knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)
    confirm_action_dispatch: Mapping[str, ConfirmActionHandler] = {
        SUGGESTION_KIND_EDGE_TIER_PROMOTION: KnowledgeEdgeTierPromotionHandler(promote_edge=promote_edge_use_case),
        SUGGESTION_KIND_ENTITY_MERGE_CONFIRM: UnsupportedConfirmActionHandler(),
        SUGGESTION_KIND_SOURCE_CAPTURE: SourceCaptureHandler(knowledge_graph=knowledge_repo),
    }
    return SubmitWidgetInteraction(
        widget_interactions=widget_interactions,
        messages=messages,
        continuation_runner=continuation_runner,
        knowledge_graph=knowledge_repo,
        confirm_action_dispatch=confirm_action_dispatch,
    )


def _provide_openrouter_chat_adapter(http_client: httpx.AsyncClient) -> OpenRouterChatAdapter:
    """OpenRouterChatAdapter — the second ChatProvider implementation (Phase 22, D-07, D-22).

    Reuses the shared httpx.AsyncClient singleton. api_key is read once here via
    settings.openrouter_api_key (T-22-06, server-side only) — an empty key means
    every .stream() call raises fail-closed (D-07) until OPENROUTER_API_KEY is
    configured for this environment.
    """
    settings = get_settings()
    return OpenRouterChatAdapter(
        api_key=settings.openrouter_api_key,
        base_url=settings.OPENROUTER_BASE_URL,
        http_client=http_client,
        inactivity_timeout_seconds=settings.CHAT_INACTIVITY_TIMEOUT_SECONDS,
    )


def _provide_cost_ledger_repository(client: Client) -> CostLedgerRepository:
    """SupabaseCostLedgerRepository — chat_cost_ledger adapter (FOUND-3, D-20/D-22)."""
    return SupabaseCostLedgerRepository(client=client)


def _provide_cost_circuit_breaker(ledger: CostLedgerRepository) -> CostCircuitBreaker:
    """CostCircuitBreaker — fail-closed pre-turn gate + mid-stream abort (STREAM-03, D-20/D-21).

    Caps come ONLY from settings (D-21) — passed in here at construction time,
    never overridable per-call.
    """
    settings = get_settings()
    return CostCircuitBreaker(
        ledger=ledger,
        per_turn_cap_usd=settings.COST_CAP_PER_TURN_USD,
        per_session_cap_usd=settings.COST_CAP_PER_SESSION_USD,
        per_day_cap_usd=settings.COST_CAP_PER_DAY_USD,
        per_round_cap_usd=settings.COST_CAP_PER_ROUND_USD,
    )


def _build_provider() -> Provider:  # noqa: PLR0915
    """Return a configured dishka Provider with all app-scoped bindings."""
    provider = Provider(scope=Scope.APP)

    # ── Supabase client (singleton via lru_cache factory) ────────────────────
    provider.provide(_provide_supabase_client, provides=Client, scope=Scope.APP)

    # ── Anthropic / Bedrock client (singleton via lru_cache factory) ─────────
    provider.provide(_provide_anthropic_client, provides=AsyncAnthropicBedrock, scope=Scope.APP)

    # ── Shared httpx AsyncClient (singleton) — OpenRouter transport, D-07 seam ─
    provider.provide(_provide_httpx_client, provides=httpx.AsyncClient, scope=Scope.APP)

    # ── Repository adapters ───────────────────────────────────────────────────
    provider.provide(SupabaseEmailRepository, provides=EmailRepository)
    provider.provide(SupabaseAttachmentRepository, provides=AttachmentRepository)
    provider.provide(SupabaseComponentRepository, provides=ComponentRepository)
    provider.provide(SupabaseEntityTypeRepository, provides=EntityTypeRepository)
    provider.provide(SupabaseExtractionRepository, provides=ExtractionRepository)
    # Entity identity repository (D-02/D-09/D-10/D-11) — bound to port Protocol.
    provider.provide(SupabaseEntityInstanceRepository, provides=EntityInstanceRepository)
    # Retrieval-outcome instrumentation writer (RECALL-02, 31-02) — best-effort.
    provider.provide(_provide_autofill_retrieval_event_repository, provides=AutofillRetrievalEventRepository)
    # chat_source_ledger auto-collect write adapter (Phase 56-02, RCNV-01) —
    # additive-default RunChatTurn collaborator, threaded in below.
    provider.provide(SupabaseSourceLedgerRepository, provides=SourceLedgerRepository)
    # chat_context_edges read adapter (Phase 56-04, RCNV-04) — the
    # linked-context injection pipeline's ONE read collaborator, additive-
    # default RunChatTurn collaborator, threaded in below.
    provider.provide(SupabaseChatContextEdgeRepository, provides=ChatContextEdgeRepository)
    # entity_type_corrections capture + trgm retrieval (Phase 57-01, LEARN-01) —
    # best-effort collaborator threaded into SetComponentEntityTypeUseCase below.
    provider.provide(_provide_entity_type_correction_repository, provides=EntityTypeCorrectionRepository)

    # ── Ingestion adapters ────────────────────────────────────────────────────
    provider.provide(_provide_backfill_raw_email_store, provides=BackfillRawEmailStore)
    provider.provide(_provide_raw_email_store, provides=RawEmailStore)
    provider.provide(_provide_attachment_storage, provides=AttachmentStorage)
    provider.provide(_provide_ingestion_config, provides=IngestionConfig)
    provider.provide(_provide_importer_resolver, provides=ImporterResolver)
    # Thread resolution at ingest time (Phase 45, THRD-01) — mirrors the
    # importer resolver binding above.
    provider.provide(_provide_thread_resolver, provides=ThreadResolver)
    # Forwarding-token resolution at ingest time (Phase 45, THRD-04) — resolved
    # before importer_resolver inside execute() to anchor new importers.
    provider.provide(_provide_forwarding_address_resolver, provides=ForwardingAddressResolver)

    # ── LLM adapters (Bedrock) ────────────────────────────────────────────────
    provider.provide(_provide_segmenter, provides=SegmenterProtocol)
    provider.provide(_provide_autofiller, provides=AutofillProtocol)
    provider.provide(_provide_embedder, provides=EmbeddingProtocol)
    # Entity-type classifier: ONE call classifies all candidate regions of a document.
    provider.provide(_provide_entity_type_classifier, provides=EntityTypeClassifierProtocol)

    # ── Retrieval (hybrid vector+trgm, D-15 learning flywheel) ────────────────
    provider.provide(_provide_retrieval, provides=RetrievalPort)

    # ── Segmentation / parser registry ───────────────────────────────────────
    # ParserRegistryPort is a Callable type alias with forward-ref annotations;
    # dishka cannot analyse it at runtime.  We register the factory as
    # provides=ParserRegistryPort (the alias acts as a key) but annotate the
    # factory return as ``object`` to sidestep the UndefinedTypeAnalysisError.
    provider.provide(_provide_parser_registry, provides=ParserRegistryPort)

    # ── Use cases ─────────────────────────────────────────────────────────────
    provider.provide(ReceiveInboundEmailUseCase)
    # IngestInboundEmailUseCase takes parser_registry: ParserRegistryPort which
    # is a Callable type alias with forward-ref annotations that dishka cannot
    # analyse.  Use a factory function instead of provide(class) to sidestep the
    # UndefinedTypeAnalysisError.
    # ResolveIngestEntitiesUseCase (AI-03): concrete resolution + knowledge
    # repos are instantiated inside its factory; injected into the ingest
    # factory, which gates it on INGEST_ENTITY_RESOLUTION_ENABLED.
    provider.provide(_provide_resolve_ingest_entities_use_case, provides=ResolveIngestEntitiesUseCase)
    provider.provide(_provide_ingest_use_case, provides=IngestInboundEmailUseCase)
    provider.provide(ProposeRegionsUseCase)
    # SuggestEntityTypesUseCase (Phase 57-02, LEARN-02): factory passes the
    # optional EntityTypeCorrectionRepository collaborator explicitly — dishka
    # won't auto-inject a defaulted Optional param (mirrors
    # _provide_set_component_entity_type_use_case).
    provider.provide(_provide_suggest_entity_types_use_case, provides=SuggestEntityTypesUseCase)
    provider.provide(ReprocessEmailUseCase)
    provider.provide(BackfillInboundEmailUseCase)
    # ST-04: pipeline-health read model (GET /v1/pipeline/health).
    provider.provide(GetPipelineHealthUseCase)
    # AutofillUseCase has Optional embedder/retrieval params (None defaults) that
    # dishka won't auto-inject — use a factory to wire the 04-08 few-shot ports.
    provider.provide(_provide_autofill_use_case, provides=AutofillUseCase)
    # AutofillFieldsUseCase (09-02b) — same Optional embedder/retrieval shape +
    # segmenter for the entity-scoped auto-detect; factory passes them explicitly.
    provider.provide(_provide_autofill_fields_use_case, provides=AutofillFieldsUseCase)
    provider.provide(_provide_confirm_region_use_case, provides=ConfirmRegionUseCase)
    # Region-edit write side (Phase 06) — all auto-inject ComponentRepository.
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
    # SetComponentEntityTypeUseCase (Phase 57-01, LEARN-01): factory passes the
    # optional EntityTypeCorrectionRepository collaborator explicitly — dishka
    # won't auto-inject a defaulted Optional param (mirrors _provide_autofill_use_case).
    provider.provide(_provide_set_component_entity_type_use_case, provides=SetComponentEntityTypeUseCase)
    provider.provide(SetComponentFieldRelationshipUseCase)
    provider.provide(DenyFieldUseCase)
    # Entity-type / field management (Phase 09-03, D-26/D-27) — all auto-inject
    # EntityTypeRepository (already bound to SupabaseEntityTypeRepository above).
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
    # All three auto-inject EntityInstanceRepository (already bound above).
    provider.provide(ConfirmMergeUseCase)
    provider.provide(RejectMergeUseCase)
    provider.provide(UnmergeEntityUseCase)

    # ── Cost governance — ledger + fail-closed circuit breaker (FOUND-3, D-20/D-21) ──
    # CostLedgerRepository: Protocol port → SupabaseCostLedgerRepository adapter.
    provider.provide(_provide_cost_ledger_repository, provides=CostLedgerRepository)
    # CostCircuitBreaker: fail-closed pre-turn gate + mid-stream abort (STREAM-03, D-20/D-21).
    provider.provide(_provide_cost_circuit_breaker, provides=CostCircuitBreaker)

    # ── GenUI generation layer (Phase 13-03) — extracted group (Track 2 decomposition) ──
    # Dual-LLM declarative-spec pipeline + parallel code-island path + NL re-theme resolver.
    # All bindings live in app.composition.genui_providers.register (behavior unchanged).
    genui_providers.register(provider)

    # ── Chat spine — multi-provider ChatProvider implementations (Phase 22) ──
    # Both adapters structurally implement ChatProvider but are bound to their
    # own concrete types: the chat orchestration layer (22-06) will select
    # between them by the picked model's registry transport.
    provider.provide(_provide_bedrock_chat_adapter, provides=BedrockChatAdapter)
    provider.provide(_provide_openrouter_chat_adapter, provides=OpenRouterChatAdapter)

    # ── Chat spine — persistence repos + provider router (Phase 22-06) ───────
    provider.provide(_provide_chat_message_repository, provides=ChatMessageRepository)
    provider.provide(_provide_chat_run_repository, provides=ChatRunRepository)
    provider.provide(_provide_chat_conversation_repository, provides=ChatConversationRepository)
    provider.provide(_provide_chat_provider_router, provides=ChatProviderRouter)

    # ── Dual-channel genui — widget-interaction repo + submit use case (Phase 24-01/24-02) ──
    provider.provide(_provide_chat_widget_interaction_repository, provides=ChatWidgetInteractionRepository)
    provider.provide(_provide_run_chat_turn, provides=RunChatTurn)
    provider.provide(_provide_submit_widget_interaction, provides=SubmitWidgetInteraction)

    # ── Anticipatory-prompting SPIKE — dark gate-chain pipeline (Phase 25-02, D-01/D-12) ──
    # Registered so the whole pipeline is real, DI-constructible infrastructure — NOT invoked
    # anywhere in the live turn loop. ANTICIPATORY_PROMPTING_ENABLED defaults to False; live
    # observation wiring into the turn loop is a documented Plan 25-03 seam.
    provider.provide(_provide_anticipatory_judge, provides=AppropriatenessJudge)
    provider.provide(InMemoryAnticipatoryCapStore, provides=AnticipatoryCapStore)
    provider.provide(_provide_evaluate_anticipatory_candidates, provides=EvaluateAnticipatoryCandidates)

    return provider


def create_container() -> AsyncContainer:
    """Create and return the application DI container."""
    return make_async_container(_build_provider())
