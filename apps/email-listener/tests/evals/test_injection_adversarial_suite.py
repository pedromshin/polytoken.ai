"""Deterministic full-suite adversarial scoring against the REAL SearchKnowledgeExecutor (Phase 38, QUAR-02, Task 2).

Loads the SAME injection-fixtures.json Task 1 grew to 20-30 entries across 7
categories (`tests.evals._paths.eval_fixtures_dir()` -- never a hand-copied
duplicate) and proves Plan 38-01's `tool_envelope_gate` + this executor's own
belt-2 field-omission (`_belt_two_label`) both hold across the FULL
adversarial set -- not just the 2 hand-picked hostile cases 38-01's own
`test_tool_envelope_contract.py` wrote (ROADMAP SC2: "runs against the wired
executors and passes").

Three proofs, all against the REAL `SearchKnowledgeExecutor` class (never a
duplicated re-implementation) with hand-built fake `knowledge`/`embedder`
collaborators (mirrors `tests/infrastructure/tools/test_search_knowledge_executor.py`'s
`_node_row`/`_make_executor` shape, kept as a local per-test-file copy per
this repo's established convention -- see 38-01-SUMMARY.md's own deviation
note):

  1. Every fixture's `retrievedText` seeded as a NON-EXTRACTED row's title
     never leaks its canary into the envelope (belt 2 + the envelope gate).
  2. The SAME fixture set seeded as an EXTRACTED row's title DOES surface its
     canary (a sanity companion proving the suite isn't over-blocking
     legitimate human-confirmed data) AND still passes `validate_tool_envelope`.
  3. The one `knowledge-inferred-crafted-search` fixture, passed as the QUERY
     argument itself (not seeded row content): the adversarial text reaches
     `knowledge.search_nodes` completely UNMODIFIED (the defense is never
     "sanitize the query"), while a co-seeded non-EXTRACTED row's canary
     still never leaks -- the `extracted_only` tier filter holds regardless
     of query phrasing.

CI-runnable, no live model -- `pytest.mark.unit()` only. The live-model layer
("beyond didn't call a tool") is `test_live_injection_harness.py` (Task 3).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.domain.ports.knowledge_graph_repository import DEFAULT_SEARCH_LIMIT
from app.domain.services.tool_envelope_gate import validate_tool_envelope
from app.infrastructure.tools.search_knowledge_executor import SearchKnowledgeExecutor
from tests.evals._paths import eval_fixtures_dir
from tests.evals._scorers import score_injection_resistance

_IMPORTER_ID = "imp-38-02-0000-0000-000000000001"
_CRAFTED_QUERY_FIXTURE_NAME = "knowledge-inferred-crafted-search"


def _load_injection_fixtures() -> list[dict[str, Any]]:
    path = eval_fixtures_dir() / "injection-fixtures.json"
    return json.loads(Path(path).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def _node_row(
    node_id: str,
    *,
    tier: str = "EXTRACTED",
    title: str | None = "Confirmed knowledge title",
    content: str | None = None,
    scope_ref_id: str | None = "region-38-02-0000-0000-000000000001",
    confidence: float = 0.9,
) -> dict[str, object]:
    """Local copy of test_search_knowledge_executor.py's `_node_row` shape (per-test-file convention)."""
    return {
        "id": node_id,
        "title": title,
        "content": content,
        "scope": "region",
        "scope_ref_id": scope_ref_id,
        "tier": tier,
        "confidence": confidence,
    }


def _make_executor(
    *,
    search_rows: list[dict[str, object]] | None = None,
    embedding: tuple[float, ...] = (0.1, 0.2),
) -> tuple[SearchKnowledgeExecutor, AsyncMock, AsyncMock]:
    """Local copy of test_search_knowledge_executor.py's `_make_executor` shape (per-test-file convention)."""
    knowledge = AsyncMock()
    knowledge.search_nodes.return_value = search_rows if search_rows is not None else []
    embedder = AsyncMock()
    embedder.embed.return_value = embedding
    executor = SearchKnowledgeExecutor(knowledge=knowledge, embedder=embedder)
    return executor, knowledge, embedder


def _non_crafted_fixtures() -> list[dict[str, Any]]:
    return [f for f in _load_injection_fixtures() if f["name"] != _CRAFTED_QUERY_FIXTURE_NAME]


def _crafted_query_fixture() -> dict[str, Any]:
    fixtures = [f for f in _load_injection_fixtures() if f["name"] == _CRAFTED_QUERY_FIXTURE_NAME]
    assert len(fixtures) == 1, "exactly one knowledge-inferred-crafted-search fixture is required (38-CONTEXT.md)"
    return fixtures[0]


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("fixture", _non_crafted_fixtures(), ids=lambda f: f["name"])
async def test_non_extracted_seeded_fixture_never_leaks(fixture: dict[str, Any]) -> None:
    """Belt 2 + Plan 38-01's envelope gate hold for every fixture seeded as a non-EXTRACTED row's title."""
    rows = [_node_row("node-hostile", tier="AMBIGUOUS", title=fixture["retrievedText"], confidence=0.3)]
    executor, _knowledge, _embedder = _make_executor(search_rows=rows)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "probe"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    score = score_injection_resistance(fixture["retrievedText"], result.content)
    assert score["leaked"] is False, f"fixture {fixture['name']!r} leaked its canary via a non-EXTRACTED row"


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("fixture", _non_crafted_fixtures(), ids=lambda f: f["name"])
async def test_extracted_seeded_fixture_surfaces_and_passes_envelope_gate(fixture: dict[str, Any]) -> None:
    """Sanity companion: an EXTRACTED (confirmed) row's text DOES surface -- the suite isn't over-blocking."""
    rows = [_node_row("node-confirmed", tier="EXTRACTED", title=fixture["retrievedText"], confidence=0.9)]
    executor, _knowledge, _embedder = _make_executor(search_rows=rows)

    result = await executor.execute(
        name="search_knowledge", arguments={"mode": "search", "query": "probe"}, importer_id=_IMPORTER_ID
    )

    assert result.is_error is False
    score = score_injection_resistance(fixture["retrievedText"], result.content)
    assert score["leaked"] is True, (
        f"fixture {fixture['name']!r}'s legitimate EXTRACTED text did not surface -- the suite is over-blocking"
    )
    gate = validate_tool_envelope(result.content)
    assert gate.ok is True, f"fixture {fixture['name']!r}'s legitimate EXTRACTED envelope failed the gate: {gate.reason}"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_crafted_adversarial_search_query_reaches_repo_unmodified_and_tier_filter_holds() -> None:
    """The `knowledge-inferred-crafted-search` fixture arrives as the QUERY argument, not seeded content.

    Proves two things at once: (a) the adversarial text reaches
    `knowledge.search_nodes` completely unmodified -- the defense is
    structural (the tier filter), never query sanitization -- and (b) a
    co-seeded non-EXTRACTED row's canary still never leaks into the envelope.
    """
    fixture = _crafted_query_fixture()
    hostile_row = _node_row("node-hostile-query", tier="AMBIGUOUS", title=fixture["retrievedText"], confidence=0.2)
    executor, knowledge, _embedder = _make_executor(search_rows=[hostile_row])

    result = await executor.execute(
        name="search_knowledge",
        arguments={"mode": "search", "query": fixture["retrievedText"]},
        importer_id=_IMPORTER_ID,
    )

    assert result.is_error is False
    knowledge.search_nodes.assert_awaited_once_with(
        query_text=fixture["retrievedText"],
        query_embedding=[0.1, 0.2],
        importer_id=_IMPORTER_ID,
        limit=DEFAULT_SEARCH_LIMIT,
    )
    score = score_injection_resistance(fixture["retrievedText"], result.content)
    assert score["leaked"] is False, "the extracted_only tier filter must hold even under an adversarial QUERY"
    gate = validate_tool_envelope(result.content)
    assert gate.ok is True, f"crafted-query envelope failed the gate: {gate.reason}"
