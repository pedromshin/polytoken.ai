"""Container resolution tests — verify DI wiring without a live Supabase connection."""

from __future__ import annotations

import ast
import asyncio
import importlib
import inspect
from unittest.mock import MagicMock, patch

import pytest

from app.application.capabilities import registry as capability_registry
from app.application.capabilities.registry import (
    NonReadCapabilityError,
    UndeclaredCapabilityError,
    define_capability,
)
from app.application.use_cases.cascade_correction import CascadeCorrectionUseCase
from app.application.use_cases.confirm_action_dispatch import SourceCaptureHandler
from app.application.use_cases.curate_entity_merge import ConfirmMergeUseCase
from app.application.use_cases.ingest_inbound_email import IngestInboundEmailUseCase
from app.application.use_cases.propose_regions import ProposeRegionsUseCase
from app.application.use_cases.research.deep_research import (
    DEEP_RESEARCH_TOOL_NAME,
    DeepResearchToolExecutor,
)
from app.application.use_cases.run_chat_turn import RunChatTurn
from app.application.use_cases.submit_widget_interaction import SubmitWidgetInteraction
from app.application.use_cases.suggest_entity_types import SuggestEntityTypesUseCase
from app.composition import chat_turn_providers
from app.container import create_container
from app.domain.ports.attachment_repository import AttachmentRepository
from app.domain.ports.attachment_storage import AttachmentStorage
from app.domain.ports.component_repository import ComponentRepository
from app.domain.ports.email_repository import EmailRepository
from app.domain.ports.entity_type_repository import EntityTypeRepository
from app.domain.ports.extraction_repository import ExtractionRepository
from app.domain.ports.raw_email_store import BackfillRawEmailStore, RawEmailStore
from app.domain.ports.segmenter_protocol import SegmenterProtocol
from app.domain.services.chat_model_registry import get_model
from app.infrastructure.llm.chat_tools import (
    EMIT_CANVAS_CONNECT_TOOL_NAME,
    EMIT_CANVAS_NODE_TOOL_NAME,
    EMIT_CANVAS_RECIPE_TOOL_NAME,
    EMIT_CODE_ISLAND_TOOL_NAME,
)
from app.infrastructure.llm.segmentation_adapter import AnthropicSegmenter
from app.infrastructure.pdf.pdf_parser import PdfParser
from app.infrastructure.raw_email_store_routing import RoutingRawEmailStore
from app.infrastructure.s3.raw_email_store import S3RawEmailStore
from app.infrastructure.supabase.attachment_repository import SupabaseAttachmentRepository
from app.infrastructure.supabase.attachment_storage import SupabaseAttachmentStorage
from app.infrastructure.supabase.component_repository import SupabaseComponentRepository
from app.infrastructure.supabase.email_repository import SupabaseEmailRepository
from app.infrastructure.supabase.entity_type_repository import SupabaseEntityTypeRepository
from app.infrastructure.supabase.extraction_repository import SupabaseExtractionRepository
from app.infrastructure.supabase.raw_email_backfill_store import SupabaseRawEmailBackfillStore
from app.infrastructure.tools.search_knowledge_executor import SearchKnowledgeExecutor
from app.infrastructure.tools.web_search_executor import WebSearchExecutor
from app.settings import BaseAppSettings, get_settings

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

    def test_raw_email_store_resolves_to_routing_impl(self) -> None:
        """RawEmailStore is the prefix-routing composite: SES ids -> S3, bf- ids -> Supabase."""
        with patch(_PATCH_TARGET, return_value=MagicMock()), patch("app.container.boto3") as boto3_mock:
            container = create_container()
            store = asyncio.run(container.get(RawEmailStore))
            assert isinstance(store, RoutingRawEmailStore)
            assert isinstance(store._ses_store, S3RawEmailStore)
            boto3_mock.client.assert_called()

    def test_backfill_raw_email_store_resolves_to_supabase_impl(self) -> None:
        with patch(_PATCH_TARGET, return_value=MagicMock()):
            container = create_container()
            store = asyncio.run(container.get(BackfillRawEmailStore))
            assert isinstance(store, SupabaseRawEmailBackfillStore)

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


class TestCanvasEmitExposureGate:
    """Phase 73 Wave A CI guard: the canvas emit tools' exposure is settings-driven, default OFF.

    Unlike the server-executor exposure gates above, emit_canvas_node/
    emit_canvas_connect are emit-a-part tools (like emit_ui_spec) wired into
    RunChatTurn's `emit_canvas_tools` tuple, NOT `_tool_executors`. The
    builders + their test suite exist regardless of the flag; only
    chat_turn_providers.py's wiring reads CANVAS_EMIT_TOOL_ENABLED. It
    defaults OFF (fail-closed) — merging into the LIVE mail receiver must not
    expose the tools until the flag is explicitly set. A genui-capable model's
    tool offer is inspected to prove the tools are (or are not) actually
    reachable end-to-end.
    """

    # A real genui-capable Bedrock registry entry (genui=True) so _build_tool_offer
    # actually surfaces the emit-a-part tools.
    _GENUI_MODEL_ID = "us.anthropic.claude-sonnet-4-6"

    def _offered_canvas_names(self, run_chat_turn: RunChatTurn) -> set[str]:
        model = get_model(self._GENUI_MODEL_ID)
        assert model is not None
        assert model.capabilities.genui
        return {t["name"] for t in run_chat_turn._build_tool_offer(model)} & {
            EMIT_CANVAS_NODE_TOOL_NAME,
            EMIT_CANVAS_CONNECT_TOOL_NAME,
            EMIT_CODE_ISLAND_TOOL_NAME,
            EMIT_CANVAS_RECIPE_TOOL_NAME,
        }

    def test_container_canvas_emit_disabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("CANVAS_EMIT_TOOL_ENABLED", raising=False)
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert run_chat_turn._emit_canvas_tools == ()
            assert self._offered_canvas_names(run_chat_turn) == set()
        finally:
            get_settings.cache_clear()

    def test_container_canvas_emit_enabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CANVAS_EMIT_TOOL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            offered_names = {t["name"] for t in run_chat_turn._emit_canvas_tools}
            assert offered_names == {
                EMIT_CANVAS_NODE_TOOL_NAME,
                EMIT_CANVAS_CONNECT_TOOL_NAME,
                EMIT_CODE_ISLAND_TOOL_NAME,
                EMIT_CANVAS_RECIPE_TOOL_NAME,
            }
            assert self._offered_canvas_names(run_chat_turn) == {
                EMIT_CANVAS_NODE_TOOL_NAME,
                EMIT_CANVAS_CONNECT_TOOL_NAME,
                EMIT_CODE_ISLAND_TOOL_NAME,
                EMIT_CANVAS_RECIPE_TOOL_NAME,
            }
        finally:
            get_settings.cache_clear()

    def test_container_canvas_emit_disabled_via_flag(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CANVAS_EMIT_TOOL_ENABLED", "false")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert run_chat_turn._emit_canvas_tools == ()
            assert self._offered_canvas_names(run_chat_turn) == set()
        finally:
            get_settings.cache_clear()


def _model_callable_exposure_flags() -> set[str]:
    """Every `*_TOOL_ENABLED` boolean on the settings model (W12-3).

    Derived, not hand-listed: `_provide_run_chat_turn` gates each optional
    model-callable capability behind a settings flag following that naming
    convention, so reading them off `BaseAppSettings.model_fields` keeps the
    read-tier forcing function covering capabilities that do not exist yet.
    """
    return {
        name
        for name, field in BaseAppSettings.model_fields.items()
        if name.endswith("_TOOL_ENABLED") and field.annotation is bool
    }


def _module_scope_gate_precedes_every_definition(module) -> bool:
    """True when the import-time gate call runs before any def/class in `module` (W12-4).

    `test_module_import_runs_the_declared_tier_gate` reloads the live composition
    root through a raising spy. `importlib.reload` re-executes into the SAME
    module `__dict__` without clearing it, so a failed reload leaves the module
    half-re-executed — safe ONLY because the raise lands before every function
    definition, i.e. before anything a later test could observe in a torn state.
    That was an accident of line order; this makes it a checked property.
    """
    tree = ast.parse(inspect.getsource(module))
    gate_line = next(
        (
            node.lineno
            for node in tree.body
            if isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id == "assert_declared_model_callable_read_only"
        ),
        None,
    )
    if gate_line is None:
        return False
    definition_lines = [
        node.lineno
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    ]
    return all(gate_line < line for line in definition_lines)


class TestModelCallableReadTierGate:
    """W11-1: the W9-1 read-tier gate's CALL SITES, not just its functions.

    The W9-1 review deleted `assert_model_callable_read_only(...)` from
    `_provide_run_chat_turn` and every suite stayed green — the lane had
    reproduced its own diagnosed failure mode one level up (a guard held in
    place by nothing but a comment). These tests fail if either call site is
    removed:

      - `test_container_refuses_*` resolve `RunChatTurn` through the REAL
        dishka container with a stubbed capability injected, so they exercise
        the wiring-time call, not the helper in isolation.
      - `test_module_import_runs_the_declared_tier_gate` re-imports the
        composition module with the import-time helper spied, so it fails if
        the module-scope call disappears.

    Registry-level unit coverage lives in
    `app/application/capabilities/__tests__/test_registry.py`; this class only
    proves the production wiring actually invokes it.
    """

    @staticmethod
    def _stub_capability(*, capability_id: str, risk: str):
        """A capability standing in for `deep_research`, at an arbitrary risk tier."""
        return define_capability(
            executor=MagicMock(),
            tool_def={"name": capability_id, "description": "stub", "input_schema": {"type": "object"}},
            risk=risk,  # type: ignore[arg-type]
            cost="cheap",
        )

    def _resolve_with_stub_research_capability(self, monkeypatch: pytest.MonkeyPatch, capability) -> RunChatTurn:
        monkeypatch.setenv("RESEARCH_TOOL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            with (
                _patched_container(),
                patch.object(chat_turn_providers, "define_research_capability", return_value=capability),
            ):
                container = create_container()
                return asyncio.run(container.get(RunChatTurn))
        finally:
            get_settings.cache_clear()

    @pytest.mark.parametrize("risk", ["write", "exec"])
    def test_container_refuses_a_non_read_chat_capability(self, monkeypatch: pytest.MonkeyPatch, risk: str) -> None:
        """A write/exec capability in the model-callable set => RunChatTurn is never built."""
        capability = self._stub_capability(capability_id=DEEP_RESEARCH_TOOL_NAME, risk=risk)

        with pytest.raises(NonReadCapabilityError) as excinfo:
            self._resolve_with_stub_research_capability(monkeypatch, capability)

        assert excinfo.value.capability_id == DEEP_RESEARCH_TOOL_NAME
        assert excinfo.value.risk == risk

    def test_container_refuses_a_capability_missing_from_the_declared_table(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A read capability nobody declared still fails: the import-time table must stay accurate."""
        capability = self._stub_capability(capability_id="totally_new_tool", risk="read")

        with pytest.raises(UndeclaredCapabilityError) as excinfo:
            self._resolve_with_stub_research_capability(monkeypatch, capability)

        assert excinfo.value.capability_id == "totally_new_tool"

    def test_container_resolves_the_real_all_read_chat_registry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Behaviour-preserving: with every exposure flag ON the real set resolves unchanged.

        Also pins the declared table to reality — it must name EXACTLY the tools
        the container offers the model, so it can never quietly describe a
        smaller set than the one the loop can dispatch.

        W12-3: the flag list is DISCOVERED from `Settings`, not hand-written. The
        forcing function this test provides used to name three flags literally, so
        the realistic drift — add a capability behind a NEW default-off
        `*_TOOL_ENABLED` flag and forget the declared table — stayed green here and
        surfaced only as a runtime 500 on the first `POST /v1/chat/stream` after
        that flag was flipped in production. Discovering the flags means a new one
        is turned on by this test the day it is added, so an undeclared capability
        raises `UndeclaredCapabilityError` at commit time instead.
        """
        exposure_flags = _model_callable_exposure_flags()
        # If this ever empties, the loop below turns nothing on and the test
        # degrades to a tautology — fail loudly rather than pass vacuously.
        assert exposure_flags >= {
            "SEARCH_KNOWLEDGE_TOOL_ENABLED",
            "WEB_SEARCH_TOOL_ENABLED",
            "RESEARCH_TOOL_ENABLED",
        }
        for flag in exposure_flags:
            monkeypatch.setenv(flag, "true")
        get_settings.cache_clear()
        try:
            with _patched_container():
                container = create_container()
                run_chat_turn = asyncio.run(container.get(RunChatTurn))

            assert set(run_chat_turn._tool_executors) == set(chat_turn_providers.MODEL_CALLABLE_CAPABILITY_RISK)
            assert set(run_chat_turn._server_tool_defs) == set(chat_turn_providers.MODEL_CALLABLE_CAPABILITY_RISK)
        finally:
            get_settings.cache_clear()

    def test_exposure_flag_discovery_is_derived_not_hand_listed(self) -> None:
        """W12-3: the discovered set is strictly wider than the three flags it replaced.

        `CANVAS_EMIT_TOOL_ENABLED` is the proof — it exists, it follows the
        convention, and no hand-written list in this file ever named it. Re-hardcode
        `_model_callable_exposure_flags` back to a literal three-flag set and this
        goes RED.
        """
        flags = _model_callable_exposure_flags()
        hand_listed = {"SEARCH_KNOWLEDGE_TOOL_ENABLED", "WEB_SEARCH_TOOL_ENABLED", "RESEARCH_TOOL_ENABLED"}

        assert flags > hand_listed
        assert "CANVAS_EMIT_TOOL_ENABLED" in flags

    def test_declared_table_is_all_read(self) -> None:
        assert set(chat_turn_providers.MODEL_CALLABLE_CAPABILITY_RISK.values()) == {"read"}

    def test_module_import_runs_the_declared_tier_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The module-scope call site is load-bearing.

        Re-importing the composition module must re-run the import-time gate over
        the declared table. The spy raises, so the reload fails — exactly what a
        declared write/exec tier would do to `uvicorn app.main:app` at boot
        (app/main.py builds the ASGI app at module scope and imports
        app.container, which imports this module).
        """
        seen: list[dict[str, str]] = []
        names_before = set(vars(chat_turn_providers))

        def _spy(declared) -> None:
            seen.append(dict(declared))
            raise NonReadCapabilityError(capability_id="send_email", risk="write")

        try:
            monkeypatch.setattr(capability_registry, "assert_declared_model_callable_read_only", _spy)
            with pytest.raises(NonReadCapabilityError):
                importlib.reload(chat_turn_providers)
        finally:
            monkeypatch.undo()
            importlib.reload(chat_turn_providers)

        assert seen, "the composition module never called the import-time read-tier gate"
        assert set(seen[0]) == set(chat_turn_providers.MODEL_CALLABLE_CAPABILITY_RISK)
        # W12-4: the restore actually restored. `reload` re-executes into the SAME
        # module dict without clearing it, so a half-failed reload can leave this
        # module torn for every LATER test in the process — assert the whole
        # attribute set came back, not just one callable.
        assert set(vars(chat_turn_providers)) == names_before
        assert callable(chat_turn_providers.register)
        assert callable(chat_turn_providers._provide_run_chat_turn)

    def test_import_time_gate_runs_before_any_definition_in_the_composition_module(self) -> None:
        """W12-4: the property that makes the reload above safe is CHECKED, not assumed.

        Move the module-scope `assert_declared_model_callable_read_only(...)` call
        below any `def`/`class` in `chat_turn_providers` and this fails — because
        at that point a failed reload would leave the composition root
        half-re-executed for the rest of the pytest process.
        """
        assert _module_scope_gate_precedes_every_definition(chat_turn_providers)


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


class TestCascadeCorrectionGate:
    """CPF flag guard: CASCADE_CORRECTION_ENABLED drives structural omission, never dead code.

    Mirrors the repo's Test*ExposureGate convention (search_knowledge, canvas
    emit): flag off/unset => ConfirmMergeUseCase resolves with NO cascade
    collaborator (byte-dark on the live merge path); flag on => the container
    composes a real CascadeCorrectionUseCase into it.
    """

    def _resolve_confirm_merge(self) -> ConfirmMergeUseCase:
        with _patched_container():
            container = create_container()
            return asyncio.run(container.get(ConfirmMergeUseCase))

    def test_container_cascade_disabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("CASCADE_CORRECTION_ENABLED", raising=False)
        get_settings.cache_clear()
        try:
            confirm_merge = self._resolve_confirm_merge()
            assert confirm_merge._cascade is None
        finally:
            get_settings.cache_clear()

    def test_container_cascade_disabled_via_explicit_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CASCADE_CORRECTION_ENABLED", "false")
        get_settings.cache_clear()
        try:
            confirm_merge = self._resolve_confirm_merge()
            assert confirm_merge._cascade is None
        finally:
            get_settings.cache_clear()

    def test_container_cascade_composed_when_enabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CASCADE_CORRECTION_ENABLED", "true")
        get_settings.cache_clear()
        try:
            confirm_merge = self._resolve_confirm_merge()
            assert isinstance(confirm_merge._cascade, CascadeCorrectionUseCase)
        finally:
            get_settings.cache_clear()
