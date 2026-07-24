"""Dishka dependency injection container.

Registers:
- Supabase client factory (singleton)
- Five repository adapters bound to their domain port interfaces
- LLM segmentation (AsyncAnthropicBedrock, AnthropicSegmenter)
- Parser registry (get_parser callable with PdfParser registered under "pdf")
- Application use cases
"""

from __future__ import annotations

import boto3
import httpx
from anthropic import AsyncAnthropicBedrock
from dishka import AsyncContainer, Provider, Scope, make_async_container
from supabase import Client

from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
from app.application.use_cases.backfill_inbound_email import BackfillInboundEmailUseCase
from app.application.use_cases.confirm_action_dispatch import (
    SourceCaptureHandler,
)
from app.application.use_cases.curate_entity_merge import (
    ConfirmMergeUseCase,
    RejectMergeUseCase,
    UnmergeEntityUseCase,
)
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
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.application.use_cases.resolve_ingest_entities import ResolveIngestEntitiesUseCase
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.composition import (
    anticipatory_providers,
    chat_turn_providers,
    cost_providers,
    document_region_providers,
    genui_providers,
    llm_adapter_providers,
    repository_providers,
)
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.embedding_protocol import EmbeddingProtocol
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_classifier_protocol import EntityTypeClassifierProtocol
from app.domain.ports.entity_type_correction_repository import EntityTypeCorrectionRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import BackfillRawEmailStore, RawEmailStore
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.domain.ports.thread_resolver import ThreadResolver
from app.infrastructure.llm.anthropic_client import get_anthropic_client
from app.infrastructure.llm.embedding_adapter import EmbeddingAdapter
from app.infrastructure.ocr.textract_adapter import TextractOcrAdapter
from app.infrastructure.pdf.parser_registry import get_parser, register
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.raw_email_store_routing import RoutingRawEmailStore
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.client import get_supabase_client
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.forwarding_address_repository import SupabaseForwardingAddressRepository
from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository
from app.infrastructure.supabase.raw_email_backfill_store import SupabaseRawEmailBackfillStore
from app.infrastructure.supabase.thread_repository import SupabaseThreadRepository
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


def _provide_embedder() -> EmbeddingProtocol:
    """EmbeddingAdapter backed by AWS Bedrock Amazon Titan Text Embeddings V2 (1536-dim).

    The bedrock-runtime boto3 client uses the ambient ECS task IAM role
    (bedrock:InvokeModel) — no API key.  Embeddings power the D-15 learning
    flywheel: confirmed regions are embedded and indexed for few-shot retrieval.
    """
    client = boto3.client("bedrock-runtime", region_name=get_settings().bedrock_region)
    return EmbeddingAdapter(client=client)




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


def _provide_httpx_client() -> httpx.AsyncClient:
    """Shared httpx AsyncClient singleton for outbound streaming HTTP calls (OpenRouter, D-07 seam).

    `read=None` disables httpx's own read timeout: OpenRouterChatAdapter wraps
    its SSE line iteration in its own asyncio.timeout inactivity guard
    (rescheduled per event, same idiom as the Bedrock adapter), so THAT is the
    real safety net for a long-lived stream — a fixed httpx read timeout would
    otherwise kill a healthy multi-minute stream.
    """
    return httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))


def _build_provider() -> Provider:
    """Return a configured dishka Provider with all app-scoped bindings."""
    provider = Provider(scope=Scope.APP)

    # ── Supabase client (singleton via lru_cache factory) ────────────────────
    provider.provide(_provide_supabase_client, provides=Client, scope=Scope.APP)

    # ── Anthropic / Bedrock client (singleton via lru_cache factory) ─────────
    provider.provide(_provide_anthropic_client, provides=AsyncAnthropicBedrock, scope=Scope.APP)

    # ── Shared httpx AsyncClient (singleton) — OpenRouter transport, D-07 seam ─
    provider.provide(_provide_httpx_client, provides=httpx.AsyncClient, scope=Scope.APP)

    # ── Supabase repository adapters + retrieval + chat-spine persistence ─────
    # Extracted group (Track 2 decomposition) — every repository binding (email/
    # attachment/component/entity/extraction/source-ledger/context-edge/retrieval +
    # the four chat-spine repos) lives in app.composition.repository_providers.register.
    repository_providers.register(provider)

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

    # ── Embedder (Bedrock Titan; boto3 client built directly, so stays here) ──
    provider.provide(_provide_embedder, provides=EmbeddingProtocol)

    # ── LLM adapters + chat transport — extracted group (Track 2 decomposition) ──
    # Autofiller / entity-type classifier / segmenter + both ChatProvider adapters +
    # the transport router live in app.composition.llm_adapter_providers.register.
    llm_adapter_providers.register(provider)

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
    # SuggestEntityTypesUseCase (Phase 57-02, LEARN-02): factory passes the
    # optional EntityTypeCorrectionRepository collaborator explicitly — dishka
    # won't auto-inject a defaulted Optional param (mirrors
    # _provide_set_component_entity_type_use_case).
    provider.provide(_provide_suggest_entity_types_use_case, provides=SuggestEntityTypesUseCase)
    provider.provide(ReprocessEmailUseCase)
    provider.provide(BackfillInboundEmailUseCase)
    # ST-04: pipeline-health read model (GET /v1/pipeline/health).
    provider.provide(GetPipelineHealthUseCase)
    # ── Document-region write surface — extracted group (Track 2 decomposition) ──
    # Region proposal + confirmation, the seven region-edit write-side use cases, document
    # classification, the component-relationship setters + origin-aware field-deny, and the
    # two autofill use cases — 16 bindings in app.composition.document_region_providers.register.
    # EmbeddingProtocol is consumed by the autofill/ConfirmRegion factories but PROVIDED by
    # the must-stay _provide_embedder above (boto3 patch target) — injected, never re-provided.
    document_region_providers.register(provider)

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

    # ── Cost governance — extracted group (Track 2 decomposition) ─────────────
    # Cost ledger + fail-closed circuit breaker → app.composition.cost_providers.register.
    cost_providers.register(provider)

    # ── GenUI generation layer (Phase 13-03) — extracted group (Track 2 decomposition) ──
    # Dual-LLM declarative-spec pipeline + parallel code-island path + NL re-theme resolver.
    # All bindings live in app.composition.genui_providers.register (behavior unchanged).
    genui_providers.register(provider)

    # Chat transport (both ChatProvider adapters + the router) is bound in
    # llm_adapter_providers.register above; the chat-spine persistence repos in
    # repository_providers.register. What remains here is the turn use case itself.

    # ── Dual-channel genui — chat turn + submit use case (Phase 24-01/24-02) ──
    # Extracted group (Track 2 decomposition): RunChatTurn (the SEAM-04 turn agent) +
    # SubmitWidgetInteraction (the DCUI-03 widget-submit use case) live in
    # app.composition.chat_turn_providers.register (behavior unchanged).
    chat_turn_providers.register(provider)

    # ── Anticipatory-prompting SPIKE — extracted group (Track 2 decomposition) ─
    # Dark gate-chain pipeline (Phase 25-02): DI-constructible but NOT invoked in the live
    # turn loop (ANTICIPATORY_PROMPTING_ENABLED defaults False). Bindings in
    # app.composition.anticipatory_providers.register.
    anticipatory_providers.register(provider)

    return provider


def create_container() -> AsyncContainer:
    """Create and return the application DI container."""
    return make_async_container(_build_provider())
