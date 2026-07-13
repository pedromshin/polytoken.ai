"""Tests for the RetrievalProvider port + DTOs (Task 1) and LexicalRetrievalProvider (Task 3).

Task 1: DTO contract — frozen dataclasses, tuple items sorted by score, Protocol shape.
Task 3: Provider behavior — deterministic ranking, top-k, no network calls.
"""

from __future__ import annotations

import asyncio
from dataclasses import FrozenInstanceError

import pytest

# ---------------------------------------------------------------------------
# Task 1: DTO / Protocol contract tests (run in TDD RED before implementation)
# ---------------------------------------------------------------------------


class TestRetrievedItemDTO:
    """RetrievedItem is a frozen dataclass carrying id, kind, score, payload."""

    def test_retrieved_item_can_be_created(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievedItem

        item = RetrievedItem(
            id="comp-grid",
            kind="component",
            score=0.85,
            payload={"type": "grid", "description": "CSS grid layout"},
        )
        assert item.id == "comp-grid"
        assert item.kind == "component"
        assert item.score == 0.85
        assert item.payload["type"] == "grid"

    def test_retrieved_item_is_frozen(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievedItem

        item = RetrievedItem(id="x", kind="exemplar", score=0.5, payload={})
        with pytest.raises(FrozenInstanceError):
            item.id = "mutated"  # type: ignore[misc]

    def test_retrieved_item_score_frozen(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievedItem

        item = RetrievedItem(id="x", kind="template", score=0.3, payload={"a": 1})
        with pytest.raises(FrozenInstanceError):
            item.score = 0.99  # type: ignore[misc]

    def test_retrieved_item_kind_literals(self) -> None:
        """All three kind literals are valid values."""
        from app.domain.ports.retrieval_provider import RetrievedItem

        component = RetrievedItem(id="c1", kind="component", score=1.0, payload={})
        exemplar = RetrievedItem(id="e1", kind="exemplar", score=0.9, payload={})
        template = RetrievedItem(id="t1", kind="template", score=0.8, payload={})

        assert component.kind == "component"
        assert exemplar.kind == "exemplar"
        assert template.kind == "template"


class TestRetrievalResultDTO:
    """RetrievalResult is a frozen dataclass with items tuple + retrieved_ids property."""

    def test_retrieval_result_items_is_tuple(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievalResult, RetrievedItem

        item_a = RetrievedItem(id="a", kind="component", score=0.9, payload={})
        item_b = RetrievedItem(id="b", kind="exemplar", score=0.7, payload={})
        result = RetrievalResult(items=(item_a, item_b))

        assert isinstance(result.items, tuple)
        assert len(result.items) == 2

    def test_retrieval_result_retrieved_ids_convenience(self) -> None:
        """retrieved_ids returns tuple of ids in the same order as items."""
        from app.domain.ports.retrieval_provider import RetrievalResult, RetrievedItem

        item_a = RetrievedItem(id="dashboard-exemplar", kind="exemplar", score=0.9, payload={})
        item_b = RetrievedItem(id="comp-grid", kind="component", score=0.7, payload={})
        result = RetrievalResult(items=(item_a, item_b))

        assert result.retrieved_ids == ("dashboard-exemplar", "comp-grid")

    def test_retrieval_result_is_frozen(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievalResult

        result = RetrievalResult(items=())
        with pytest.raises(FrozenInstanceError):
            result.items = ()  # type: ignore[misc]

    def test_retrieval_result_empty_items(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievalResult

        result = RetrievalResult(items=())
        assert result.items == ()
        assert result.retrieved_ids == ()

    def test_retrieval_result_items_sorted_descending_score(self) -> None:
        """Items in a RetrievalResult should be sorted by descending score (caller convention)."""
        from app.domain.ports.retrieval_provider import RetrievalResult, RetrievedItem

        # The DTO itself does NOT enforce ordering — that is the provider's responsibility.
        # Here we test the convention: when provider returns items, they are sorted.
        item_high = RetrievedItem(id="h", kind="component", score=0.95, payload={})
        item_mid = RetrievedItem(id="m", kind="exemplar", score=0.70, payload={})
        item_low = RetrievedItem(id="l", kind="template", score=0.30, payload={})

        result = RetrievalResult(items=(item_high, item_mid, item_low))
        scores = [item.score for item in result.items]
        assert scores == sorted(scores, reverse=True)


class TestRetrievalProviderProtocol:
    """RetrievalProvider is a runtime-checkable Protocol."""

    def test_retrieval_provider_is_protocol(self) -> None:

        from app.domain.ports.retrieval_provider import RetrievalProvider

        # Just verify the class can be imported and has retrieve
        assert hasattr(RetrievalProvider, "retrieve")

    def test_retrieval_provider_runtime_checkable(self) -> None:
        """A class implementing retrieve() passes isinstance check."""
        from app.domain.ports.retrieval_provider import RetrievalProvider, RetrievalResult

        class ConcreteProvider:
            async def retrieve(
                self,
                *,
                intent: str,
                top_k: int,
                style_pack_id: str | None = None,
            ) -> RetrievalResult:
                return RetrievalResult(items=())

        provider = ConcreteProvider()
        # runtime_checkable protocol check (structural)
        assert isinstance(provider, RetrievalProvider)

    def test_retrieval_provider_signature_accepts_style_pack_id(self) -> None:
        """The Protocol signature must carry style_pack_id for FLY-readiness (D-10)."""
        import inspect

        from app.domain.ports.retrieval_provider import RetrievalProvider

        sig = inspect.signature(RetrievalProvider.retrieve)
        params = sig.parameters
        assert "intent" in params
        assert "top_k" in params
        assert "style_pack_id" in params
        # style_pack_id must have a default of None
        assert params["style_pack_id"].default is None

    def test_port_module_no_infra_imports(self) -> None:
        """The port module must import only stdlib/typing — lint-imports clean."""
        from pathlib import Path

        port_path = Path(__file__).parent.parent / "app" / "domain" / "ports" / "retrieval_provider.py"
        source = port_path.read_text(encoding="utf-8")
        # Should not import from app.infrastructure or anything non-stdlib
        assert "from app.infrastructure" not in source
        assert "import structlog" not in source
        assert "import sqlalchemy" not in source
        assert "import supabase" not in source


# ---------------------------------------------------------------------------
# Task 3: LexicalRetrievalProvider behavioral tests
# (These will also be RED initially until Task 3 implementation)
# ---------------------------------------------------------------------------


class TestLexicalRetrievalProviderBehavior:
    """LexicalRetrievalProvider: deterministic top-k over catalog + exemplars."""

    def test_retrieve_returns_retrieval_result(self) -> None:
        from app.domain.ports.retrieval_provider import RetrievalResult
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="a sales dashboard with KPIs", top_k=5))
        assert isinstance(result, RetrievalResult)

    def test_retrieve_items_sorted_descending_score(self) -> None:
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="a sales dashboard with KPIs", top_k=5))
        scores = [item.score for item in result.items]
        assert scores == sorted(scores, reverse=True)

    def test_retrieve_top_k_cap(self) -> None:
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="anything", top_k=3))
        assert len(result.items) <= 3

    def test_dashboard_intent_ranks_dashboard_exemplar_high(self) -> None:
        """A dashboard intent should rank dashboard-related items higher than unrelated."""
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="a sales dashboard with KPIs and metrics", top_k=10))
        assert len(result.items) > 0

        # Check that a dashboard exemplar or dashboard-related item appears in results
        ids = [item.id for item in result.items]

        # The top items should include something dashboard-related (exemplar or grid/card/table component)
        top_ids_lower = [i.lower() for i in ids[:5]]
        has_dashboard_related = any(
            "dashboard" in i or "grid" in i or "table" in i or "card" in i for i in top_ids_lower
        )
        assert has_dashboard_related, f"Expected dashboard-related items in top 5, got: {ids[:5]}"

    def test_retrieve_is_deterministic(self) -> None:
        """Same intent called twice returns identical ordered ids."""
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result_a = asyncio.run(provider.retrieve(intent="a sales dashboard with KPIs", top_k=5))
        result_b = asyncio.run(provider.retrieve(intent="a sales dashboard with KPIs", top_k=5))
        assert result_a.retrieved_ids == result_b.retrieved_ids
        assert [i.score for i in result_a.items] == [i.score for i in result_b.items]

    def test_empty_intent_does_not_crash(self) -> None:
        """Empty/garbage intent returns non-crashing RetrievalResult, never raises."""
        from app.domain.ports.retrieval_provider import RetrievalResult
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="", top_k=5))
        assert isinstance(result, RetrievalResult)

    def test_garbage_intent_does_not_crash(self) -> None:
        """Random garbage intent returns a valid result without raising."""
        from app.domain.ports.retrieval_provider import RetrievalResult
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="xyzzy-1234-!@#$", top_k=5))
        assert isinstance(result, RetrievalResult)

    def test_provider_no_network_call_catalog_exemplar_arm(self) -> None:
        """LexicalRetrievalProvider requires no network client to construct or call for catalog+exemplar arms."""
        from app.domain.ports.retrieval_provider import RetrievalResult
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        # Can be constructed with zero arguments — no client dependency required
        provider = LexicalRetrievalProvider()

        # Can retrieve without any DB/Bedrock injection
        result = asyncio.run(provider.retrieve(intent="a profile page", top_k=5))
        assert isinstance(result, RetrievalResult)

    def test_retrieved_ids_non_empty_for_valid_intent(self) -> None:
        """A real intent should yield at least one item in the result."""
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(provider.retrieve(intent="pricing page with tiers and a CTA button", top_k=5))
        assert len(result.items) > 0
        assert len(result.retrieved_ids) == len(result.items)

    def test_style_pack_id_accepted_does_not_crash(self) -> None:
        """style_pack_id parameter is accepted and does not break retrieval."""
        from app.domain.ports.retrieval_provider import RetrievalResult
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        result = asyncio.run(
            provider.retrieve(
                intent="a landing page",
                top_k=5,
                style_pack_id="linear-clean",
            )
        )
        assert isinstance(result, RetrievalResult)

    def test_provider_implements_retrieval_provider_protocol(self) -> None:
        """LexicalRetrievalProvider passes isinstance check against RetrievalProvider."""
        from app.domain.ports.retrieval_provider import RetrievalProvider
        from app.infrastructure.llm.genui_retrieval_provider import LexicalRetrievalProvider

        provider = LexicalRetrievalProvider()
        assert isinstance(provider, RetrievalProvider)
