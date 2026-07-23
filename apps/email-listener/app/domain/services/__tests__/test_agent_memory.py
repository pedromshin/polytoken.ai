"""Tests for agent_memory — pure canon knowledge-graph memory assembly (AI-06).

Behaviors:
  build_agent_memory_block:
    1.  labeled/delimited output; canon facts + entity profiles rendered
    2.  each fact/profile carries a [knowledge:<id>] citation marker
    3.  a non-EXTRACTED (suggested/ambiguous) fact/profile is NEVER rendered
        (defensive belt _is_canon) even if handed in
    4.  bounded by the row-count caps (MAX_CANON_FACTS / MAX_ENTITY_PROFILES)
    5.  bounded by the char budget under oversized input
    6.  None when every input is empty or non-canon
    7.  suggest-only instruction present in the header (never assert canon)
    8.  deterministic (same input -> same output twice)
  build_memory_citation_envelope:
    9.  research-trace ResearchRun shape (mode/report/aborted/sources/claims)
    10. every source url is a /knowledge?node=<id> deep-link with the REAL id
    11. claims cite the real source node ids
    12. non-canon rows excluded; sources deduped by node id
"""

from __future__ import annotations

from typing import cast

import pytest

from app.domain.services.agent_memory import (
    DEFAULT_MEMORY_BUDGET_CHARS,
    MAX_CANON_FACTS,
    MAX_ENTITY_PROFILES,
    MEMORY_ENVELOPE_MODE,
    CanonFact,
    EntityProfile,
    build_agent_memory_block,
    build_memory_citation_envelope,
)


def _fact(node_id: str, tier: str = "EXTRACTED") -> CanonFact:
    return CanonFact(
        node_id=node_id,
        node_title=f"Node {node_id}",
        relation="ships_via",
        target_label="entity_instance:abc123",
        excerpt=f"content of {node_id}",
        tier=tier,
    )


def _profile(node_id: str, tier: str = "EXTRACTED") -> EntityProfile:
    return EntityProfile(node_id=node_id, title=f"Profile {node_id}", excerpt=f"about {node_id}", tier=tier)


# ---------------------------------------------------------------------------
# build_agent_memory_block
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_block_is_labeled_with_facts_and_profiles() -> None:
    block = build_agent_memory_block([_fact("n1")], [_profile("p1")])
    assert block is not None
    assert "BEGIN AGENT MEMORY" in block
    assert "END AGENT MEMORY" in block
    assert "Canon facts:" in block
    assert "Entity profiles:" in block
    assert "Node n1" in block
    assert "Profile p1" in block


@pytest.mark.unit
def test_every_line_carries_a_knowledge_citation_marker() -> None:
    block = build_agent_memory_block([_fact("n1")], [_profile("p1")])
    assert block is not None
    assert "[knowledge:n1]" in block
    assert "[knowledge:p1]" in block


@pytest.mark.unit
def test_non_canon_fact_and_profile_are_never_rendered() -> None:
    # A suggested (INFERRED) and an ambiguous row handed in alongside a canon
    # one -> only the canon row survives the defensive _is_canon belt.
    block = build_agent_memory_block(
        [_fact("canon"), _fact("suggested", tier="INFERRED")],
        [_profile("canonp"), _profile("ambiguous", tier="AMBIGUOUS")],
    )
    assert block is not None
    assert "[knowledge:canon]" in block
    assert "[knowledge:canonp]" in block
    assert "suggested" not in block
    assert "[knowledge:suggested]" not in block
    assert "[knowledge:ambiguous]" not in block


@pytest.mark.unit
def test_block_respects_row_count_caps() -> None:
    facts = [_fact(f"f{i}") for i in range(MAX_CANON_FACTS + 5)]
    profiles = [_profile(f"p{i}") for i in range(MAX_ENTITY_PROFILES + 5)]
    block = build_agent_memory_block(facts, profiles)
    assert block is not None
    assert block.count("[knowledge:f") <= MAX_CANON_FACTS
    assert block.count("[knowledge:p") <= MAX_ENTITY_PROFILES
    # The capped-out rows never appear.
    assert f"[knowledge:f{MAX_CANON_FACTS + 4}]" not in block
    assert f"[knowledge:p{MAX_ENTITY_PROFILES + 4}]" not in block


@pytest.mark.unit
def test_block_bounded_by_char_budget() -> None:
    huge = CanonFact(
        node_id="big",
        node_title="T" * 5000,
        relation="R" * 5000,
        target_label="X" * 5000,
        excerpt="E" * 5000,
        tier="EXTRACTED",
    )
    block = build_agent_memory_block([huge], [])
    assert block is not None
    assert len(block) <= DEFAULT_MEMORY_BUDGET_CHARS


@pytest.mark.unit
def test_none_when_empty_or_all_non_canon() -> None:
    assert build_agent_memory_block([], []) is None
    assert build_agent_memory_block([_fact("x", tier="INFERRED")], [_profile("y", tier="INFERRED")]) is None


@pytest.mark.unit
def test_header_carries_suggest_only_instruction() -> None:
    block = build_agent_memory_block([_fact("n1")], [])
    assert block is not None
    lowered = block.lower()
    assert "suggest" in lowered
    assert "never" in lowered  # "never assert ... as canon"


@pytest.mark.unit
def test_block_is_deterministic() -> None:
    args = ([_fact("n1"), _fact("n2")], [_profile("p1")])
    assert build_agent_memory_block(*args) == build_agent_memory_block(*args)


# ---------------------------------------------------------------------------
# build_memory_citation_envelope
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_envelope_is_research_run_shaped() -> None:
    env = build_memory_citation_envelope([_fact("n1")], [_profile("p1")])
    assert env["mode"] == MEMORY_ENVELOPE_MODE
    assert env["report"] == ""
    assert env["aborted"] is False
    assert isinstance(env["sources"], list)
    assert isinstance(env["claims"], list)


@pytest.mark.unit
def test_every_source_url_is_a_real_knowledge_node_deeplink() -> None:
    env = build_memory_citation_envelope([_fact("node-aaa")], [_profile("node-bbb")])
    sources = {s["id"]: s for s in cast("list[dict[str, object]]", env["sources"])}
    assert "node-aaa" in sources
    assert "node-bbb" in sources
    assert sources["node-aaa"]["url"] == "/knowledge?node=node-aaa"
    assert sources["node-bbb"]["url"] == "/knowledge?node=node-bbb"


@pytest.mark.unit
def test_claims_cite_real_source_node_ids() -> None:
    env = build_memory_citation_envelope([_fact("node-aaa")], [])
    claims = env["claims"]
    assert isinstance(claims, list)
    assert claims[0]["source_ids"] == ["node-aaa"]  # type: ignore[index]


@pytest.mark.unit
def test_envelope_excludes_non_canon_and_dedupes_sources() -> None:
    # A fact and a profile citing the SAME node id -> one source, not two.
    env = build_memory_citation_envelope(
        [_fact("shared"), _fact("suggested", tier="INFERRED")],
        [_profile("shared"), _profile("amb", tier="AMBIGUOUS")],
    )
    ids = [s["id"] for s in cast("list[dict[str, object]]", env["sources"])]
    assert ids.count("shared") == 1
    assert "suggested" not in ids
    assert "amb" not in ids
