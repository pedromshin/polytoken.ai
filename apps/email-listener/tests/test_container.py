"""Container resolution tests — verify DI wiring without a live Supabase connection."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.research.deep_research import DeepResearchToolExecutor
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.container import create_container
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.raw_email_store import RawEmailStore
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.infrastructure.llm.segmentation_adapter import AnthropicSegmenter
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository
from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
from app.infrastructure.tools.search_knowledge_executor import SearchKnowledgeExecutor
from app.infrastructure.tools.web_search_executor import WebSearchExecutor
from app.settings import get_settings

_PATCH_TARGET = "app.container.get_supabase_client"
_PATCH_ANTHROPIC = "app.container.get_anthropic_client"


def _patched_container() -> asyncio.coroutines:
    """Context manager that patches external clients for container tests."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        with (
            patch(_PATCH_TARGET, return_value=MagicMock()),
            patch(_PATCH_ANTHROPIC, return_value=MagicMock()),
            patch("app.container.boto3") as boto3_mock,
        ):
            boto3_mock.client.return_value = MagicMock()
            yield

    return _ctx()


class TestContainerResolution:
    """Verify that each port resolves to the correct concrete adapter."""

    def test_email_repository_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            repo = asyncio.run(container.get(EmailRepository))
            assert isinstance(repo, SupabaseEmailRepository)

    def test_attachment_repository_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            repo = asyncio.run(container.get(AttachmentRepository))
            assert isinstance(repo, SupabaseAttachmentRepository)

    def test_component_repository_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            repo = asyncio.run(container.get(ComponentRepository))
            assert isinstance(repo, SupabaseComponentRepository)

    def test_entity_type_repository_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            repo = asyncio.run(container.get(EntityTypeRepository))
            assert isinstance(repo, SupabaseEntityTypeRepository)

    def test_extraction_repository_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            repo = asyncio.run(container.get(ExtractionRepository))
            assert isinstance(repo, SupabaseExtractionRepository)

    def test_raw_email_store_resolves_to_s3_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()), patch("app.container.boto3") as boto3_mock:
            container = create_container()
            store = asyncio.run(container.get(RawEmailStore))
            assert isinstance(store, S3RawEmailStore)
            boto3_mock.client.assert_called()

    def test_attachment_storage_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            storage = asyncio.run(container.get(AttachmentStorage))
            assert isinstance(storage, SupabaseAttachmentStorage)

    def test_ingest_use_case_resolves(self) -> None:
        with _patched_container():
            container = create_container()
            use_case = asyncio.run(container.get(IngestInboundEmailUseCase))
            assert isinstance(use_case, IngestInboundEmailUseCase)

    def test_segmenter_resolves_to_anthropic_impl(self) -> None:
        with _patched_container():
            container = create_container()
            segmenter = asyncio.run(container.get(SegmenterProtocol))
            assert isinstance(segmenter, AnthropicSegmenter)

    def test_propose_regions_use_case_resolves(self) -> None:
        with _patched_container():
            container = create_container()
            use_case = asyncio.run(container.get(ProposeRegionsUseCase))
            assert isinstance(use_case, ProposeRegionsUseCase)

    def test_suggest_entity_types_use_case_resolves(self) -> None:
        """SuggestEntityTypesUseCase (Phase 57-02, LEARN-02) resolves via its factory —
        proves the optional EntityTypeCorrectionRepository collaborator wires cleanly.
        """
        with _patched_container():
            container = create_container()
            use_case = asyncio.run(container.get(SuggestEntityTypesUseCase))
            assert isinstance(use_case, SuggestEntityTypesUseCase)
            assert use_case._corrections is not None

    def test_parser_registry_returns_pdf_parser_for_pdf_ext(self) -> None:
        """The registry callable must return a PdfParser for 'pdf' extension."""
        from app.domain.ports.parser_registry_port import ParserRegistryPort

        with _patched_container():
            container = create_container()
            registry = asyncio.run(container.get(ParserRegistryPort))
            parser = registry("pdf")
            assert isinstance(parser, PdfParser)

    def test_parser_registry_returns_none_for_unknown_ext(self) -> None:
        from app.domain.ports.parser_registry_port import ParserRegistryPort

        with _patched_container():
            container = create_container()
            registry = asyncio.run(container.get(ParserRegistryPort))
            result = registry("docx")
            assert result is None


class TestSearchKnowledgeExposureGate:
    """T-37-09 permanent CI guard: search_knowledge's exposure is settings-driven, never dead code.

    Synthesis P6 rule (37-CONTEXT.md "Exposure gating"): the executor + its
    full test suite exist regardless of the flag; only container.py's
    production tool_executors/server_tool_defs wiring reads it. Phase 38
    (Plan 38-02, QUAR-02) flipped the default to True after the full
    deterministic adversarial-fixture suite passed in the same execution run
    (SC5) -- the flag stays a REAL, working kill-switch/rollback lever
    post-flip (see test_container_search_knowledge_can_still_be_disabled_via_flag).
    """

    def test_container_search_knowledge_enabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", raising=False)
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "search_knowledge" in executors
            assert isinstance(executors["search_knowledge"], SearchKnowledgeExecutor)
            tool_def = run_chat_turn._server_tool_defs["search_knowledge"]
            assert "mode" in tool_def["input_schema"]["properties"]
            # Additive, not a regression: Phase 36's wiring must stay intact.
            assert "lookup_entity" in executors
            assert "search_emails" in executors
            assert "lookup_entity" in run_chat_turn._server_tool_defs
            assert "search_emails" in run_chat_turn._server_tool_defs
        finally:
            get_settings.cache_clear()

    def test_container_search_knowledge_can_still_be_disabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Post-flip regression: SEARCH_KNOWLEDGE_TOOL_ENABLED=false still structurally OMITS the
        key -- the flag remains a real rollback lever, not dead code, after Phase 38's default flip.
        """
        monkeypatch.setenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert "search_knowledge" not in run_chat_turn._tool_executors
            assert "search_knowledge" not in run_chat_turn._server_tool_defs
            # Additive, not a regression: Phase 36's wiring must stay intact.
            assert "lookup_entity" in run_chat_turn._tool_executors
            assert "search_emails" in run_chat_turn._tool_executors
        finally:
            get_settings.cache_clear()

    def test_container_search_knowledge_enabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SEARCH_KNOWLEDGE_TOOL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "search_knowledge" in executors
            assert isinstance(executors["search_knowledge"], SearchKnowledgeExecutor)
            tool_def = run_chat_turn._server_tool_defs["search_knowledge"]
            assert "mode" in tool_def["input_schema"]["properties"]
            # Phase 36's wiring stays intact with the flag on, too.
            assert "lookup_entity" in executors
            assert "search_emails" in executors
        finally:
            # Mirror conftest.py's before/after cache_clear pattern so later
            # tests are never polluted by the cached flag override.
            get_settings.cache_clear()


class TestWebSearchExposureGate:
    """T-54-02-04 permanent CI guard: web_search's exposure is settings-driven, never dead code.

    Mirrors `TestSearchKnowledgeExposureGate` exactly (37-CONTEXT.md's
    "Exposure gating" P6 rule, applied here per 54-02-PLAN.md's
    threat_model T-54-02-04): the executor + its full test suite (including
    the adversarial fixture suite) exist regardless of the flag; only
    container.py's production tool_executors/server_tool_defs wiring reads
    it. This plan flips the default to True in the SAME run only after
    `tests/evals/test_web_search_injection_suite.py` passes -- the flag
    stays a REAL, working kill-switch either way.
    """

    def test_container_web_search_enabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("WEB_SEARCH_TOOL_ENABLED", raising=False)
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "web_search" in executors
            assert isinstance(executors["web_search"], WebSearchExecutor)
            tool_def = run_chat_turn._server_tool_defs["web_search"]
            assert "query" in tool_def["input_schema"]["properties"]
            # Additive, not a regression: Phase 36/37's wiring must stay intact.
            assert "lookup_entity" in executors
            assert "search_emails" in executors
            assert "search_knowledge" in executors
        finally:
            get_settings.cache_clear()

    def test_container_web_search_can_be_disabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_TOOL_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert "web_search" not in run_chat_turn._tool_executors
            assert "web_search" not in run_chat_turn._server_tool_defs
            # Additive, not a regression: Phase 36/37's wiring must stay intact.
            assert "lookup_entity" in run_chat_turn._tool_executors
            assert "search_emails" in run_chat_turn._tool_executors
        finally:
            get_settings.cache_clear()

    def test_container_web_search_enabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WEB_SEARCH_TOOL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "web_search" in executors
            assert isinstance(executors["web_search"], WebSearchExecutor)
            tool_def = run_chat_turn._server_tool_defs["web_search"]
            assert "query" in tool_def["input_schema"]["properties"]
            assert "lookup_entity" in executors
            assert "search_emails" in executors
        finally:
            get_settings.cache_clear()


class TestDeepResearchExposureGate:
    """Phase 69 (RSRCH-01) CI guard: deep_research's exposure is settings-driven, never dead code.

    Mirrors `TestWebSearchExposureGate` exactly (37-CONTEXT.md's "Exposure
    gating" P6 rule): the DeepResearch loop + DeepResearchToolExecutor and
    their test suite (app/application/use_cases/research/) exist regardless
    of the flag; only container.py's production capability-registry wiring
    reads it. RESEARCH_TOOL_ENABLED defaults True (the loop is fail-closed
    by construction — ResearchBudget hard-caps tokens AND rounds), and the
    flag stays a REAL, working kill-switch either way.
    """

    def test_container_deep_research_enabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RESEARCH_TOOL_ENABLED", raising=False)
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "deep_research" in executors
            assert isinstance(executors["deep_research"], DeepResearchToolExecutor)
            tool_def = run_chat_turn._server_tool_defs["deep_research"]
            assert "question" in tool_def["input_schema"]["properties"]
            # Additive, not a regression: the earlier phases' wiring stays intact.
            assert "lookup_entity" in executors
            assert "search_emails" in executors
            assert "web_search" in executors
        finally:
            get_settings.cache_clear()

    def test_container_deep_research_can_be_disabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RESEARCH_TOOL_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert "deep_research" not in run_chat_turn._tool_executors
            assert "deep_research" not in run_chat_turn._server_tool_defs
            # Additive, not a regression: the earlier phases' wiring stays intact.
            assert "lookup_entity" in run_chat_turn._tool_executors
            assert "search_emails" in run_chat_turn._tool_executors
        finally:
            get_settings.cache_clear()

    def test_container_deep_research_enabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RESEARCH_TOOL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            executors = run_chat_turn._tool_executors
            assert "deep_research" in executors
            assert isinstance(executors["deep_research"], DeepResearchToolExecutor)
            tool_def = run_chat_turn._server_tool_defs["deep_research"]
            assert "question" in tool_def["input_schema"]["properties"]
            assert "lookup_entity" in executors
            assert "search_emails" in executors
        finally:
            get_settings.cache_clear()


class TestSourceCaptureDispatchWiring:
    """T-54-03 container guard: source_capture is a REAL, wired dispatch target (CLUS-04/CLUS-05).

    Mirrors the exposure-gate classes' resolve-and-inspect pattern, but
    SourceCaptureHandler has no code-gated flag (Phase 24-style widget
    dispatch is always registered, exactly like knowledge_edge_tier_
    promotion/entity_merge_confirm) -- this class just proves the dispatch
    table entry exists and resolves to the real handler type.
    """

    def test_source_capture_handler_registered_in_confirm_action_dispatch_table(self) -> None:
        with _patched_container():
            container = create_container()
            submit_widget_interaction = asyncio.run(container.get(SubmitWidgetInteraction))

        dispatch = submit_widget_interaction._confirm_action_dispatch
        assert "source_capture" in dispatch
        assert isinstance(dispatch["source_capture"], SourceCaptureHandler)
        # Additive, not a regression: Phase 40's wiring must stay intact.
        assert "knowledge_edge_tier_promotion" in dispatch
        assert "entity_merge_confirm" in dispatch


class TestClusterContextWiring:
    """T-54-05 container guard: RunChatTurn's thread+cluster context collaborators are REAL (CLUS-02/CLUS-06).

    Mirrors the exposure-gate classes' resolve-and-inspect pattern —
    email_repository/knowledge_graph have no code-gated flag (the feature is
    entirely opt-in on a per-conversation thread_id, not a settings toggle);
    this class just proves both read collaborators the gathering pipeline
    needs are actually wired, not left at their additive None default.
    """

    def test_run_chat_turn_resolves_with_email_repository_and_knowledge_graph_wired(self) -> None:
        with _patched_container():
            container = create_container()
            run_chat_turn = asyncio.run(container.get(RunChatTurn))

        assert run_chat_turn._email_repository is not None
        assert isinstance(run_chat_turn._email_repository, SupabaseEmailRepository)
        # knowledge_graph is REUSED from Phase 40-01's confirm-action wiring
        # (same instance, no new provider) — still assert it is not None,
        # since a regression there would silently drop captured-source reads.
        assert run_chat_turn._knowledge_graph is not None
