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

from app.application.use_cases.autofill import AutofillUseCase
from app.application.use_cases.autofill_fields import AutofillFieldsUseCase
from app.application.use_cases.backfill_entity_identities import BackfillEntityIdentitiesUseCase
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
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
from app.application.use_cases.manage_entity_types import (
    CreateEntityTypeUseCase,
    CreateFieldUseCase,
    DeleteFieldUseCase,
    ReorderFieldsUseCase,
    UpdateEntityTypeUseCase,
    UpdateFieldUseCase,
)
from app.application.use_cases.promote_entity_on_confirm import PromoteEntityOnConfirmUseCase
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.receive_inbound_email import ReceiveInboundEmailUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.application.use_cases.resolve_entity_candidates import ResolveEntityCandidatesUseCase
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.set_component_relationship import (
    SetComponentEntityTypeUseCase,
    SetComponentFieldRelationshipUseCase,
    SetComponentRoleUseCase,
)
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.domain.ports.anticipatory_ports import AnticipatoryCapStore, AppropriatenessJudge
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.autofill_protocol import AutofillProtocol
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
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.generation_audit_repository import GenerationAuditRepository
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import RawEmailStore
from app.domain.ports.retrieval_port import RetrievalPort
from app.domain.ports.retrieval_provider import RetrievalProvider
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.ports.ui_spec_template_repository import UiSpecTemplateRepository
from app.domain.services.chat_provider_router import ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker
from app.infrastructure.anticipatory.in_memory_cap_store import InMemoryAnticipatoryCapStore
from app.infrastructure.llm.anthropic_client import get_anthropic_client
from app.infrastructure.llm.anticipatory_judge_adapter import BedrockAppropriatenessJudgeAdapter
from app.infrastructure.llm.autofill_adapter import AnthropicAutofiller
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter
from app.infrastructure.llm.chat_tools import (
    build_emit_clarify_widget_tool,
    build_emit_proposal_cards_tool,
    build_emit_ui_spec_tool,
)
from app.infrastructure.llm.embedding_adapter import EmbeddingAdapter
from app.infrastructure.llm.entity_type_classifier_adapter import AnthropicEntityTypeClassifier
from app.infrastructure.llm.genui_code_generator_adapter import GenuiCodeGeneratorAdapter
from app.infrastructure.llm.genui_code_judge_adapter import GenuiCodeJudgeAdapter
from app.infrastructure.llm.genui_generator_adapter import GenuiGeneratorAdapter
from app.infrastructure.llm.genui_quarantine_adapter import GenuiQuarantineAdapter
from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider
from app.infrastructure.llm.openrouter_chat_adapter import OpenRouterChatAdapter
from app.infrastructure.llm.segmentation_adapter import AnthropicSegmenter
from app.infrastructure.ocr.textract_adapter import TextractOcrAdapter
from app.infrastructure.pdf.parser_registry import get_parser, register
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.client import get_supabase_client
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_instance_repository import SupabaseEntityInstanceRepository
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository
from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository
from app.infrastructure.supabase.retrieval_repository import SupabaseRetrievalRepository
from app.infrastructure.supabase.supabase_chat_conversation_repository import (
    SupabaseChatConversationRepository,
)
from app.infrastructure.supabase.supabase_chat_message_repository import SupabaseChatMessageRepository
from app.infrastructure.supabase.supabase_chat_run_repository import SupabaseChatRunRepository
from app.infrastructure.supabase.supabase_chat_widget_interaction_repository import (
    SupabaseChatWidgetInteractionRepository,
)
from app.infrastructure.supabase.supabase_cost_ledger_repository import SupabaseCostLedgerRepository
from app.infrastructure.supabase.supabase_generation_audit_repository import SupabaseGenerationAuditRepository
from app.infrastructure.supabase.supabase_ui_spec_template_repository import SupabaseUiSpecTemplateRepository
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


def _provide_raw_email_store() -> RawEmailStore:
    """SES inbound raw MIME store on S3 (default boto3 credential chain — IAM role)."""
    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.ses_s3_region)
    return S3RawEmailStore(bucket=settings.SES_S3_BUCKET, prefix=settings.ses_s3_prefix, client=s3_client)


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


def _provide_autofill_use_case(
    components: ComponentRepository,
    entity_types: EntityTypeRepository,
    extractions: ExtractionRepository,
    autofiller: AutofillProtocol,
    embedder: EmbeddingProtocol,
    retrieval: RetrievalPort,
) -> AutofillUseCase:
    """Factory for AutofillUseCase wired with the 04-08 few-shot retrieval ports.

    AutofillUseCase accepts ``embedder``/``retrieval`` as Optional with None
    defaults so unit tests can omit them; dishka does not auto-inject defaulted
    Optional params, so this factory passes them explicitly to enable the
    few-shot path (D-15) in the live container.  When retrieval returns [] the
    use case still preserves the cold-start path (D-13).
    """
    return AutofillUseCase(
        components=components,
        entity_types=entity_types,
        extractions=extractions,
        autofiller=autofiller,
        embedder=embedder,
        retrieval=retrieval,
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
    suggest_entity_types: SuggestEntityTypesUseCase,
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
    """
    raw_registry = _provide_parser_registry()
    # _provide_parser_registry returns ``object`` to satisfy dishka; cast back
    # to the correct callable type for IngestInboundEmailUseCase.
    parser_registry: ParserRegistryPort = raw_registry  # type: ignore[assignment]
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
        suggest_entity_types=suggest_entity_types,
    )


def _provide_genui_quarantine_adapter(client: AsyncAnthropicBedrock) -> GenuiQuarantineAdapter:
    """GenuiQuarantineAdapter — Call A of the dual-LLM generation pipeline (D-09, SAFE-01)."""
    settings = get_settings()
    return GenuiQuarantineAdapter(
        client=client,
        model_id=settings.genui_model_id,
        max_tokens=settings.GENUI_QUARANTINE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
    )


def _provide_genui_generator_adapter(client: AsyncAnthropicBedrock) -> GenuiGeneratorAdapter:
    """GenuiGeneratorAdapter — Call B of the dual-LLM generation pipeline (D-09, SAFE-02)."""
    settings = get_settings()
    return GenuiGeneratorAdapter(
        client=client,
        model_id=settings.genui_model_id,
        escalation_model_id=settings.genui_escalation_model_id,
        max_tokens=settings.GENUI_GENERATOR_MAX_TOKENS,
        timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
    )


def _provide_genui_code_generator_adapter(client: AsyncAnthropicBedrock) -> GenuiCodeGeneratorAdapter:
    """GenuiCodeGeneratorAdapter — Call B of the PARALLEL code-island path (D-09, SAFE-02).

    Emits arbitrary JS island code instead of a declarative SpecRoot. Uses a DEDICATED,
    larger tier (Sonnet + big token budget + longer timeout): arbitrary UI code is
    quality-/size-critical and non-cacheable, and the compact-spec budget (3000 tokens)
    truncates a full custom design → invalid tool call → fallback.
    """
    settings = get_settings()
    return GenuiCodeGeneratorAdapter(
        client=client,
        model_id=settings.genui_code_model_id,
        escalation_model_id=settings.genui_code_escalation_model_id,
        max_tokens=settings.GENUI_CODE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_CODE_TIMEOUT_SECONDS,
    )


def _provide_genui_code_judge_adapter(client: AsyncAnthropicBedrock) -> GenuiCodeJudgeAdapter:
    """GenuiCodeJudgeAdapter — ranks N code-island candidates and picks the best.

    Part of the PARALLEL multi-candidate code-island path: the generator fans out N
    candidates concurrently (varied temperature) and this judge ranks them. Uses the
    dedicated judge model (Sonnet by default); output is tiny (an index + reason) so it
    reuses the code-island timeout as an upper bound on the small, fast ranking call.
    """
    settings = get_settings()
    return GenuiCodeJudgeAdapter(
        client=client,
        model_id=settings.genui_code_judge_model_id,
        max_tokens=settings.GENUI_CODE_JUDGE_MAX_TOKENS,
        timeout_seconds=settings.GENUI_CODE_TIMEOUT_SECONDS,
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
    breaker: CostCircuitBreaker,
    ledger: CostLedgerRepository,
    widget_interactions: ChatWidgetInteractionRepository,
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
    """
    settings = get_settings()
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
        interactive_widget_tools=(build_emit_proposal_cards_tool(), build_emit_clarify_widget_tool()),
    )


def _provide_submit_widget_interaction(
    widget_interactions: ChatWidgetInteractionRepository,
    messages: ChatMessageRepository,
    continuation_runner: RunChatTurn,
) -> SubmitWidgetInteraction:
    """Factory for SubmitWidgetInteraction — the DCUI-03 submit use case (Phase 24-02).

    continuation_runner is typed as RunChatTurn here (dishka needs a concrete
    resolvable type) but SubmitWidgetInteraction itself only depends on the
    narrow local ContinuationRunner Protocol (continue_after_widget) — RunChatTurn
    satisfies it structurally, mirroring how BedrockChatAdapter/OpenRouterChatAdapter
    both satisfy ChatProvider without an explicit inheritance link.
    """
    return SubmitWidgetInteraction(
        widget_interactions=widget_interactions,
        messages=messages,
        continuation_runner=continuation_runner,
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


def _provide_generation_audit_repository(client: Client) -> GenerationAuditRepository:
    """SupabaseGenerationAuditRepository — best-effort audit for generation events (GEN-05, D-19)."""
    return SupabaseGenerationAuditRepository(client=client)


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
    )


def _provide_ui_spec_template_repository(client: Client) -> UiSpecTemplateRepository:
    """SupabaseUiSpecTemplateRepository — exact-match cache for validated UI specs (CACHE-01, D-17)."""
    return SupabaseUiSpecTemplateRepository(client=client)


def _provide_lexical_retrieval_provider() -> RetrievalProvider:
    """LexicalRetrievalProvider bound to RetrievalProvider port (17-04, RAG-01)."""
    return LexicalRetrievalProvider()


def _provide_generate_ui_spec_use_case(
    quarantine: GenuiQuarantineAdapter,
    generator: GenuiGeneratorAdapter,
    audit: GenerationAuditRepository,
    templates: UiSpecTemplateRepository,
    retrieval_provider: RetrievalProvider,
) -> GenerateUiSpecUseCase:
    """Factory for GenerateUiSpecUseCase — orchestrates the cache→quarantine→generate→audit pipeline."""
    return GenerateUiSpecUseCase(
        quarantine=quarantine,
        generator=generator,
        audit=audit,
        templates=templates,
        retrieval_provider=retrieval_provider,
    )


def _provide_generate_code_island_use_case(
    quarantine: GenuiQuarantineAdapter,
    code_generator: GenuiCodeGeneratorAdapter,
    judge: GenuiCodeJudgeAdapter,
    audit: GenerationAuditRepository,
) -> GenerateCodeIslandUseCase:
    """Factory for GenerateCodeIslandUseCase — orchestrates the PARALLEL quarantine→fan-out→judge→audit pipeline.

    Reuses the quarantine adapter (Call A) and the audit repository; no cache (code is
    non-deterministic). Fans out GENUI_CODE_CANDIDATES generations concurrently (varied
    temperature) and ranks them with the judge. Mirrors _provide_generate_ui_spec_use_case.
    """
    return GenerateCodeIslandUseCase(
        quarantine=quarantine,
        code_generator=code_generator,
        judge=judge,
        audit=audit,
        candidates=get_settings().GENUI_CODE_CANDIDATES,
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

    # ── Ingestion adapters ────────────────────────────────────────────────────
    provider.provide(_provide_raw_email_store, provides=RawEmailStore)
    provider.provide(_provide_attachment_storage, provides=AttachmentStorage)
    provider.provide(_provide_ingestion_config, provides=IngestionConfig)
    provider.provide(_provide_importer_resolver, provides=ImporterResolver)

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
    provider.provide(_provide_ingest_use_case, provides=IngestInboundEmailUseCase)
    provider.provide(ProposeRegionsUseCase)
    provider.provide(SuggestEntityTypesUseCase)
    provider.provide(ReprocessEmailUseCase)
    # AutofillUseCase has Optional embedder/retrieval params (None defaults) that
    # dishka won't auto-inject — use a factory to wire the 04-08 few-shot ports.
    provider.provide(_provide_autofill_use_case, provides=AutofillUseCase)
    # AutofillFieldsUseCase (09-02b) — same Optional embedder/retrieval shape +
    # segmenter for the entity-scoped auto-detect; factory passes them explicitly.
    provider.provide(_provide_autofill_fields_use_case, provides=AutofillFieldsUseCase)
    provider.provide(ConfirmRegionUseCase)
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
    provider.provide(SetComponentEntityTypeUseCase)
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
    provider.provide(_provide_resolve_candidates_use_case, provides=ResolveEntityCandidatesUseCase)
    provider.provide(_provide_backfill_use_case, provides=BackfillEntityIdentitiesUseCase)
    # Human curation loop (Phase 10-03, D-20): confirm/reject/unmerge.
    # All three auto-inject EntityInstanceRepository (already bound above).
    provider.provide(ConfirmMergeUseCase)
    provider.provide(RejectMergeUseCase)
    provider.provide(UnmergeEntityUseCase)

    # ── GenUI generation layer (Phase 13-03) ──────────────────────────────────
    # Dual-LLM quarantine pipeline (D-09, SAFE-01/SAFE-02, D-02, D-05/D-06/D-07).
    # GenuiQuarantineAdapter (Call A) + GenuiGeneratorAdapter (Call B) both use
    # the shared AsyncAnthropicBedrock client (already bound above as singleton).
    provider.provide(_provide_genui_quarantine_adapter, provides=GenuiQuarantineAdapter)
    provider.provide(_provide_genui_generator_adapter, provides=GenuiGeneratorAdapter)
    # GenerationAuditRepository: Protocol port → SupabaseGenerationAuditRepository adapter.
    provider.provide(_provide_generation_audit_repository, provides=GenerationAuditRepository)
    # CostLedgerRepository: Protocol port → SupabaseCostLedgerRepository adapter (FOUND-3, D-20).
    provider.provide(_provide_cost_ledger_repository, provides=CostLedgerRepository)
    # CostCircuitBreaker: fail-closed pre-turn gate + mid-stream abort (STREAM-03, D-20/D-21).
    provider.provide(_provide_cost_circuit_breaker, provides=CostCircuitBreaker)
    # UiSpecTemplateRepository: Protocol port → SupabaseUiSpecTemplateRepository adapter (CACHE-01).
    provider.provide(_provide_ui_spec_template_repository, provides=UiSpecTemplateRepository)
    # LexicalRetrievalProvider: deterministic/lexical RAG bound to RetrievalProvider port (17-04).
    provider.provide(_provide_lexical_retrieval_provider, provides=RetrievalProvider)
    # GenerateUiSpecUseCase factory: quarantine + generator + audit + templates + retrieval all resolved first.
    provider.provide(_provide_generate_ui_spec_use_case, provides=GenerateUiSpecUseCase)

    # ── GenUI code-island layer (PARALLEL path) ───────────────────────────────
    # Emits arbitrary JS island code via forced tool-use, alongside the declarative
    # spec path above (which is untouched). Reuses GenuiQuarantineAdapter (Call A) +
    # GenerationAuditRepository; no cache (code output is non-deterministic). The
    # generator fans out N candidates concurrently (varied temperature) and the judge
    # ranks them to return the best design.
    provider.provide(_provide_genui_code_generator_adapter, provides=GenuiCodeGeneratorAdapter)
    provider.provide(_provide_genui_code_judge_adapter, provides=GenuiCodeJudgeAdapter)
    provider.provide(_provide_generate_code_island_use_case, provides=GenerateCodeIslandUseCase)

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
