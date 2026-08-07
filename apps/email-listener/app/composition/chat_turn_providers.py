"""Chat-turn providers — extracted from container.py (Track 2 decomposition).

Owns the two dual-channel genui use-case factories: `RunChatTurn` (the chat turn
agent, SEAM-04) and `SubmitWidgetInteraction` (the DCUI-03 widget-submit use case).
Both bodies are moved VERBATIM from container.py (behavior byte-identical); `register`
performs the group's two bindings.

Every collaborator these factories build is either an injected already-bound port/adapter
(the chat-spine repos, the cost breaker/ledger, the router, the BedrockChatAdapter, the
shared httpx.AsyncClient, the embedder, the entity/component/email repos) or a directly-
instantiated concrete Supabase adapter over the injected `Client`. None calls a patched
global — container.py's boot-test patch targets (`get_supabase_client` /
`get_anthropic_client` / `boto3`) are untouched by this move.
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from types import MappingProxyType

import httpx
from dishka import Provider
from supabase import Client

from app.application.capabilities.registry import (
    CapabilityRegistry,
    Risk,
    assert_declared_model_callable_read_only,
    assert_model_callable_read_only,
    define_capability,
)
from app.application.use_cases.confirm_action_dispatch import (
    ConfirmActionHandler,
    KnowledgeEdgeTierPromotionHandler,
    SourceCaptureHandler,
    UnsupportedConfirmActionHandler,
)
from app.application.use_cases.promote_edge import PromoteEdgeUseCase
from app.application.use_cases.research.deep_research import (
    DEEP_RESEARCH_TOOL_NAME,
    define_research_capability,
)
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.run_chat_turn_confirm_action import (
    SUGGESTION_KIND_EDGE_TIER_PROMOTION,
    SUGGESTION_KIND_ENTITY_MERGE_CONFIRM,
    SUGGESTION_KIND_SOURCE_CAPTURE,
)
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.domain.ports.chat_context_edge_repository import ChatContextEdgeRepository
from app.domain.ports.chat_repositories import (
    ChatConversationRepository,
    ChatMessageRepository,
    ChatRunRepository,
)
from app.domain.ports.chat_turn_usage_repository import ChatTurnUsageRepository
from app.domain.ports.chat_widget_interaction_repository import ChatWidgetInteractionRepository
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.cost_ledger_repository import CostLedgerRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.embedding_protocol import EmbeddingProtocol
from app.domain.ports.entity_instance_repository import EntityInstanceRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.retrieval_port import RetrievalPort
from app.domain.ports.source_ledger_repository import SourceLedgerRepository
from app.domain.ports.tier_resolver import UserTierResolver
from app.domain.services.chat_provider_router import ChatProviderRouter
from app.domain.services.cost_circuit_breaker import CostCircuitBreaker
from app.infrastructure.llm.bedrock_chat_adapter import BedrockChatAdapter
from app.infrastructure.llm.chat_tools import (
    build_emit_canvas_connect_tool,
    build_emit_canvas_node_tool,
    build_emit_canvas_recipe_tool,
    build_emit_clarify_widget_tool,
    build_emit_code_island_tool,
    build_emit_confirm_action_tool,
    build_emit_proposal_cards_tool,
    build_emit_ui_spec_tool,
)
from app.infrastructure.supabase.entity_resolution_repository import SupabaseEntityResolutionRepository
from app.infrastructure.supabase.knowledge_graph_repository import SupabaseKnowledgeGraphRepository
from app.infrastructure.tools.duckduckgo_search_provider import DuckDuckGoSearchProvider
from app.infrastructure.tools.lookup_entity_executor import (
    LOOKUP_ENTITY_TOOL_NAME,
    LookupEntityExecutor,
    build_lookup_entity_tool,
)
from app.infrastructure.tools.search_emails_executor import (
    SEARCH_EMAILS_TOOL_NAME,
    SearchEmailsExecutor,
    build_search_emails_tool,
)
from app.infrastructure.tools.search_knowledge_executor import (
    SEARCH_KNOWLEDGE_TOOL_NAME,
    SearchKnowledgeExecutor,
    build_search_knowledge_tool,
)
from app.infrastructure.tools.web_search_executor import (
    WEB_SEARCH_TOOL_NAME,
    WebSearchExecutor,
    build_web_search_tool,
    fetch_page_via_httpx,
)
from app.settings import get_settings

# ---------------------------------------------------------------------------
# W9-1 read-tier gate, import-time half
# ---------------------------------------------------------------------------
# Every capability declared below is projected straight into the model's tool
# offer and awaited BY NAME in run_chat_turn_server_rounds.py with no risk check
# at the call site -- and the model's tool choice is influenced by content an
# attacker can author (inbound mail bodies, web_search / deep_research page
# text). "They are all read" used to be a comment in registry.py.
#
# This table is that claim as data, and the call below is what enforces it. It
# runs at MODULE IMPORT: app/main.py:97 builds the ASGI app at module scope,
# app/main.py:12 imports app.container, and app/container.py:19-21 imports this
# module -- so a declared write/exec tier raises while uvicorn is importing the
# app, before a port is bound and before /health can answer. (This is the shape
# apps/mcp-server/src/catalogue.ts already uses on the TS side: readManifestEntry
# throws at module load rather than at first call.)
#
# The BUILT registry is checked separately, against this table, inside
# _provide_run_chat_turn -- see the comment at that call site for what that half
# does and does not cover.
MODEL_CALLABLE_CAPABILITY_RISK: Mapping[str, Risk] = MappingProxyType(
    {
        LOOKUP_ENTITY_TOOL_NAME: "read",
        SEARCH_EMAILS_TOOL_NAME: "read",
        SEARCH_KNOWLEDGE_TOOL_NAME: "read",
        WEB_SEARCH_TOOL_NAME: "read",
        DEEP_RESEARCH_TOOL_NAME: "read",
    }
)

assert_declared_model_callable_read_only(MODEL_CALLABLE_CAPABILITY_RISK)


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
    user_tiers: UserTierResolver,
    chat_turn_usage: ChatTurnUsageRepository,
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
    # W9-1 read-tier gate, wiring-time half. This checks the REAL risk values on
    # the BUILT capabilities, and that they agree with the import-time table
    # above (an undeclared id, or one whose real risk differs from the declared
    # one, raises -- otherwise the table could drift and the import-time gate
    # would be checking a fiction).
    #
    # TIMING, precisely: this factory is bound at dishka Scope.APP
    # (register() below, container.py), and dishka instantiates lazily -- the
    # lifespan resolves nothing, so this first runs on container.get(RunChatTurn),
    # i.e. the first POST /v1/chat/stream. It is NOT a startup check; the startup
    # check is assert_declared_model_callable_read_only at module scope above.
    # What this half guarantees is that no non-read executor is ever reachable
    # from the loop: RunChatTurn is never constructed if one is present.
    #
    # A write/exec capability must arrive with a confirm gate instead (the
    # emit_confirm_action shape: model supplies a ref, server re-reads it, human
    # approves), registered somewhere these assertions do not cover.
    assert_model_callable_read_only(chat_capabilities, declared=MODEL_CALLABLE_CAPABILITY_RISK)
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
        # Phase 73 Wave A (canvas emit): the two emit-a-part canvas tools follow
        # the SAME exposure-gate discipline as web_search/search_knowledge, but
        # default OFF -- structural omission (the empty tuple, never mutation)
        # unless CANVAS_EMIT_TOOL_ENABLED is explicitly set. Merging this into
        # the LIVE mail receiver is therefore safe: the tools are absent from
        # the model's tool offer until the flag is flipped.
        emit_canvas_tools=(
            (
                build_emit_canvas_node_tool(),
                build_emit_canvas_connect_tool(),
                build_emit_code_island_tool(),
                build_emit_canvas_recipe_tool(),
            )
            if settings.CANVAS_EMIT_TOOL_ENABLED
            else ()
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
        # vLAUNCH W5-1 (ASSUMPTIONS A7): the monthlyChatTurns cap gate's two
        # reads (mirror of packages/api-client/src/router/chat/turn-cap.ts,
        # server-locus chat path only). Both wired UNCONDITIONALLY -- the gate
        # is unflagged; its additive-default None form exists only for
        # tests/callers outside this composition root.
        user_tiers=user_tiers,
        chat_turn_usage=chat_turn_usage,
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


def register(provider: Provider) -> None:
    """Register the chat-turn group's bindings on the shared APP-scoped provider.

    Called from container.py's `_build_provider()`. Bindings are identical to the inline
    "Dual-channel genui — chat turn + submit use case" block they replaced.
    """
    provider.provide(_provide_run_chat_turn, provides=RunChatTurn)
    provider.provide(_provide_submit_widget_interaction, provides=SubmitWidgetInteraction)
