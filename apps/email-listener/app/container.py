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

from app.composition import (
    anticipatory_providers,
    chat_turn_providers,
    cost_providers,
    document_region_providers,
    entity_providers,
    genui_providers,
    ingestion_providers,
    llm_adapter_providers,
    repository_providers,
)
from app.domain.ports.embedding_protocol import EmbeddingProtocol
from app.domain.ports.parser_registry_port import ParserRegistryPort
from app.domain.ports.raw_email_store import BackfillRawEmailStore, RawEmailStore
from app.infrastructure.llm.anthropic_client import get_anthropic_client
from app.infrastructure.llm.embedding_adapter import EmbeddingAdapter
from app.infrastructure.ocr.textract_adapter import TextractOcrAdapter
from app.infrastructure.pdf.parser_registry import get_parser, register
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.raw_email_store_routing import RoutingRawEmailStore
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.client import get_supabase_client
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


def _provide_raw_email_store(backfill_store: BackfillRawEmailStore) -> RawEmailStore:
    """Raw MIME reads routed by id namespace: SES ids -> S3, bf- ids -> Supabase.

    The S3 half keeps the default boto3 credential chain (ECS task IAM role).
    """
    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.ses_s3_region)
    ses_store = S3RawEmailStore(bucket=settings.SES_S3_BUCKET, prefix=settings.ses_s3_prefix, client=s3_client)
    return RoutingRawEmailStore(ses_store=ses_store, backfill_store=backfill_store)


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

    # ── boto3-anchor ingestion factories — MUST STAY (boot-test patch targets) ──
    # These two build a boto3 client directly, so the boot test's `app.container.boto3`
    # patch resolves them here; moving them would break that safety net. The rest of the
    # ingestion surface is the extracted group below.
    provider.provide(_provide_raw_email_store, provides=RawEmailStore)  # S3 (boto3)
    # ParserRegistryPort is a Callable type alias with forward-ref annotations dishka can't
    # analyse; the factory is annotated `-> object` and registered under the alias key. It
    # builds a Textract boto3 client (patch target) and is also called DIRECTLY by the moved
    # _provide_ingest_use_case (via a deferred import) — both reasons keep it here.
    provider.provide(_provide_parser_registry, provides=ParserRegistryPort)  # Textract (boto3)

    # ── Embedder (Bedrock Titan; boto3 client built directly, so stays here) ──
    provider.provide(_provide_embedder, provides=EmbeddingProtocol)

    # ── LLM adapters + chat transport — extracted group (Track 2 decomposition) ──
    # Autofiller / entity-type classifier / segmenter + both ChatProvider adapters +
    # the transport router live in app.composition.llm_adapter_providers.register.
    llm_adapter_providers.register(provider)

    # ── Ingestion surface — extracted group (Track 2 decomposition) ────────────
    # The 12 movable ingestion bindings — backfill raw-MIME store, attachment storage,
    # ingestion config, the importer/thread/forwarding resolvers, the ingest-time
    # entity-resolution stage, the ingest use case, and the four top-level pipeline use
    # cases (Receive/Reprocess/Backfill/PipelineHealth) — live in
    # app.composition.ingestion_providers.register. The two boto3-anchor factories above
    # (_provide_raw_email_store, _provide_parser_registry) STAY here; the moved ingest
    # factory calls _provide_parser_registry via a deferred import (its docstring explains
    # the circular-import avoidance), so the boot patch stays effective.
    ingestion_providers.register(provider)

    # ── Document-region write surface — extracted group (Track 2 decomposition) ──
    # Region proposal + confirmation, the seven region-edit write-side use cases, document
    # classification, the component-relationship setters + origin-aware field-deny, and the
    # two autofill use cases — 16 bindings in app.composition.document_region_providers.register.
    # EmbeddingProtocol is consumed by the autofill/ConfirmRegion factories but PROVIDED by
    # the must-stay _provide_embedder above (boto3 patch target) — injected, never re-provided.
    document_region_providers.register(provider)

    # ── Entity resolution / promotion / type management — extracted group (Track 2) ──
    # SuggestEntityTypes + the six EntityType/Field CRUD use cases + the five promote/resolve
    # factories (PromoteEntityOnConfirm, PromoteEdge, PromoteSourceLedgerEntry,
    # ResolveEntityCandidates, BackfillEntityIdentities) + the three merge-curation use cases —
    # 15 bindings in app.composition.entity_providers.register. Each promote/resolve factory
    # directly instantiates the concrete SupabaseEntityResolution/KnowledgeGraph adapters over
    # the injected Client (infrastructure classes, not ports) — no patched global is touched.
    entity_providers.register(provider)

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
