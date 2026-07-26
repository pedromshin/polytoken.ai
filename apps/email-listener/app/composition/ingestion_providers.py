"""Ingestion providers — extracted from container.py (Track 2 decomposition).

Owns the inbound-email ingestion surface: the backfill raw-MIME store, attachment
storage, the ingestion config, the importer / thread / forwarding-address resolvers,
the ingest-time entity-resolution stage, the ingest use case itself, and the four
top-level pipeline use cases (Receive / Reprocess / Backfill / PipelineHealth).

This is the audit's `all_movable=false` group. TWO factories are DELIBERATELY LEFT
in container.py because they build a boto3 client directly (the boot test's
`app.container.boto3` patch target): `_provide_raw_email_store` (S3) and
`_provide_parser_registry` (Textract). The 12 movable bindings live here.

CIRCULAR-IMPORT NOTE: `_provide_ingest_use_case` calls the STAYING
`_provide_parser_registry` directly (the ParserRegistryPort Callable alias can't be
injected — dishka can't analyse its forward-ref annotations). Because container.py
imports THIS module at load time, a top-level `from app.container import ...` here
would be circular — so that import is DEFERRED into the function body. The deferred
call still resolves `app.container.boto3`, so the boot test's patch stays effective.
"""

from __future__ import annotations

from dishka import Provider
from supabase import Client

from app.application.use_cases.backfill_inbound_email import BackfillInboundEmailUseCase
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase, IngestionConfig
from app.application.use_cases.pipeline_health import GetPipelineHealthUseCase
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.receive_inbound_email import ReceiveInboundEmailUseCase
from app.application.use_cases.reprocess_email import ReprocessEmailUseCase
from app.application.use_cases.resolve_ingest_entities import ResolveIngestEntitiesUseCase
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.forwarding_address_resolver import ForwardingAddressResolver
from app.domain.ports.importer_resolver import ImporterResolver
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import BackfillRawEmailStore, RawEmailStore
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.ports.thread_resolver import ThreadResolver
from app.domain.services.ingest_budget_guard import IngestBudgetGuard
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.forwarding_address_repository import SupabaseForwardingAddressRepository
from app.infrastructure.supabase.importer_repository import SupabaseImporterRepository
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository
from app.infrastructure.supabase.raw_email_backfill_store import SupabaseRawEmailBackfillStore
from app.infrastructure.supabase.thread_repository import SupabaseThreadRepository
from app.settings import get_settings


def _provide_backfill_raw_email_store(client: Client) -> BackfillRawEmailStore:
    """Writable backfill raw MIME store on Supabase Storage (private bucket)."""
    return SupabaseRawEmailBackfillStore(client=client, bucket=get_settings().RAW_EMAILS_BUCKET)


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


def _provide_ingest_budget_guard(client: Client) -> IngestBudgetGuard:
    """Factory for IngestBudgetGuard (A1) — the per-importer daily ingest cost cap.

    Instantiates its OWN SupabaseEmailRepository as the DailyIngestCounter (a
    narrow port satisfied structurally by the concrete repo's count_received_since
    method), mirroring _provide_resolve_ingest_entities_use_case's direct-from-Client
    instantiation of concrete repos. ALWAYS constructible (its tests exist
    regardless of the flag); _provide_ingest_use_case decides whether to wire it in
    based on INGEST_DAILY_COST_CAP_ENABLED.
    """
    return IngestBudgetGuard(
        counter=SupabaseEmailRepository(client=client),
        daily_email_cap=get_settings().INGEST_DAILY_EMAIL_CAP,
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
    budget_guard: IngestBudgetGuard,
) -> IngestInboundEmailUseCase:
    """Factory for IngestInboundEmailUseCase.

    ParserRegistryPort is a Callable type alias with forward-ref annotations
    that dishka cannot analyse at runtime.  We obtain the registry by calling
    _provide_parser_registry() directly inside this factory (idempotent guard
    ensures no double-registration).

    _provide_parser_registry STAYS in container.py (it builds a Textract boto3
    client directly — a boot-test patch target), so it is imported here via a
    DEFERRED (function-body) import: container.py imports this module at load
    time, so a top-level `from app.container import ...` would be circular. The
    deferred call still resolves `app.container.boto3`, so the boot patch holds.

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
    # Deferred (function-body) import by design — see the docstring: container.py imports
    # this module at load time, so a top-level import of app.container would be circular.
    from app.container import _provide_parser_registry  # noqa: PLC0415

    raw_registry = _provide_parser_registry()
    # _provide_parser_registry returns ``object`` to satisfy dishka; cast back
    # to the correct callable type for IngestInboundEmailUseCase.
    parser_registry: ParserRegistryPort = raw_registry  # type: ignore[assignment]
    settings = get_settings()
    resolution_enabled = settings.INGEST_ENTITY_RESOLUTION_ENABLED
    # A1: inject the guard only when the cap is enabled — a False flag passes None
    # so the pipeline STRUCTURALLY omits the cap (a real kill-switch, byte-for-byte
    # no-op when off), matching the resolve_ingest_entities gating just above.
    cost_cap_enabled = settings.INGEST_DAILY_COST_CAP_ENABLED
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
        budget_guard=budget_guard if cost_cap_enabled else None,
    )


def register(provider: Provider) -> None:
    """Register the ingestion group's movable bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    "Ingestion adapters" + "Use cases" blocks they replaced. The two boto3-anchor factories
    (_provide_raw_email_store, _provide_parser_registry) STAY in container.py and are NOT
    registered here.
    """
    # ── Ingestion adapters ────────────────────────────────────────────────────
    provider.provide(_provide_backfill_raw_email_store, provides=BackfillRawEmailStore)
    provider.provide(_provide_attachment_storage, provides=AttachmentStorage)
    provider.provide(_provide_ingestion_config, provides=IngestionConfig)
    provider.provide(_provide_importer_resolver, provides=ImporterResolver)
    # Thread resolution at ingest time (Phase 45, THRD-01) — mirrors the importer resolver.
    provider.provide(_provide_thread_resolver, provides=ThreadResolver)
    # Forwarding-token resolution at ingest time (Phase 45, THRD-04) — resolved before
    # importer_resolver inside execute() to anchor new importers.
    provider.provide(_provide_forwarding_address_resolver, provides=ForwardingAddressResolver)

    # ── Use cases ─────────────────────────────────────────────────────────────
    provider.provide(ReceiveInboundEmailUseCase)
    # ResolveIngestEntitiesUseCase (AI-03): concrete resolution + knowledge repos are
    # instantiated inside its factory; injected into the ingest factory, which gates it on
    # INGEST_ENTITY_RESOLUTION_ENABLED.
    provider.provide(_provide_resolve_ingest_entities_use_case, provides=ResolveIngestEntitiesUseCase)
    # A1: the per-importer daily ingest cost cap guard. Always constructible;
    # _provide_ingest_use_case wires it in only when INGEST_DAILY_COST_CAP_ENABLED.
    provider.provide(_provide_ingest_budget_guard, provides=IngestBudgetGuard)
    # IngestInboundEmailUseCase takes parser_registry: ParserRegistryPort (a Callable alias
    # with forward-ref annotations dishka cannot analyse) — a factory sidesteps that, calling
    # the staying _provide_parser_registry via a deferred import (see the factory docstring).
    provider.provide(_provide_ingest_use_case, provides=IngestInboundEmailUseCase)
    provider.provide(ReprocessEmailUseCase)
    provider.provide(BackfillInboundEmailUseCase)
    # ST-04: pipeline-health read model (GET /v1/pipeline/health).
    provider.provide(GetPipelineHealthUseCase)
