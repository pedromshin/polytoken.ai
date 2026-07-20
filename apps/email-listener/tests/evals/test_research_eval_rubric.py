"""Unit tests for the research-quality eval rubric (Phase 72 / RSRCH-05).

These tests regression-test the RUBRIC LOGIC ITSELF — offline, no LLM, no
Bedrock — on a synthetic GOOD and a synthetic BAD research-run output. The
whole point of RSRCH-05 is that a research-quality regression is *detectable*;
that guarantee is worthless if the scorer that detects it is itself untested.

Unlike the retrieval golden set (which scored an ``EchoToolExecutor`` identity
function and was therefore trivially perfect — see ai-architecture-audit.md),
these fixtures are constructed so that a GOOD run scores high on every dimension
and a BAD run scores low on every dimension. The scorer must SEPARATE them.

A RUN_RESEARCH_EVAL-gated smoke test exercises the full runner end-to-end
(offline) so the harness wiring is import-covered without live infrastructure —
mirroring the RUN_GENUI_EVAL gate in tests/test_genui_eval_rubric.py.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from scripts.research_eval.rubric import (
    Claim,
    ResearchRunOutput,
    Source,
    score_cited_sources,
    score_claims_resolve,
    score_coverage,
    score_no_fabrication,
    score_research_run,
)
from scripts.research_eval.run_eval import (
    build_report,
    load_questions,
    render_table,
    score_runs,
)

# Gate the harness end-to-end smoke test (offline) behind an env flag, exactly
# like RUN_GENUI_EVAL — keeps it out of the default unit sweep.
_RUN_EVAL = os.environ.get("RUN_RESEARCH_EVAL") == "1"


# ---------------------------------------------------------------------------
# Fixtures: one golden question + a GOOD and a BAD run against it.
# ---------------------------------------------------------------------------

_QUESTION = {
    "id": "q-test",
    "question": "How does grounding reduce hallucination?",
    "min_sources": 2,
    "expected_source_substrings": ["retrieval", "citation"],
    "expected_claims": [
        {"id": "c-ground", "keywords": ["retriev", "source"], "note": "grounded in sources"},
        {"id": "c-cite", "keywords": ["cite"], "note": "cites its source"},
    ],
    "notes": "synthetic",
}

_GOOD_RUN = {
    "question_id": "q-test",
    "sources": [
        {
            "id": "s1",
            "url": "https://example.dev/retrieval",
            "title": "Retrieval grounding",
            "excerpt": "Grounding an answer in retrieved source excerpts reduces hallucination.",
        },
        {
            "id": "s2",
            "url": "https://example.dev/citation",
            "title": "Cite the source",
            "excerpt": "Every claim should cite the source it rests on.",
        },
    ],
    "claims": [
        {"text": "Grounding in retrieved source excerpts reduces hallucination.", "source_ids": ["s1"]},
        {"text": "Every claim must cite the source that supports it.", "source_ids": ["s2"]},
    ],
    "report": "Grounding + citation reduce hallucination.",
}

# BAD run: one uncited assertion, one dangling citation (s99 does not exist),
# a source with an empty excerpt, and it misses the golden anchors.
_BAD_RUN = {
    "question_id": "q-test",
    "sources": [
        {"id": "s1", "url": "https://example.dev/unrelated", "title": "Unrelated", "excerpt": ""},
    ],
    "claims": [
        {"text": "Models are generally quite good these days.", "source_ids": []},
        {"text": "Something is definitely true.", "source_ids": ["s99"]},
    ],
    "report": "Vague and unsupported.",
}


# ---------------------------------------------------------------------------
# Per-dimension behaviour
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_cited_sources_full_on_good_partial_on_bad() -> None:
    assert score_cited_sources(_GOOD_RUN).score == 1.0
    # BAD: 1 of 2 claims carries a citation (the dangling one still "cites").
    assert score_cited_sources(_BAD_RUN).score == 0.5


@pytest.mark.unit
def test_claims_resolve_full_on_good_zero_on_bad() -> None:
    assert score_claims_resolve(_GOOD_RUN).score == 1.0
    # BAD: uncited claim does not resolve; dangling s99 does not resolve.
    assert score_claims_resolve(_BAD_RUN).score == 0.0


@pytest.mark.unit
def test_coverage_full_on_good_zero_on_bad() -> None:
    good = score_coverage(_QUESTION, _GOOD_RUN)
    assert good.score == 1.0, good.detail
    bad = score_coverage(_QUESTION, _BAD_RUN)
    assert bad.score == 0.0, bad.detail


@pytest.mark.unit
def test_coverage_requires_the_anchor_source_to_be_cited() -> None:
    """A source that carries the anchor substring but is NOT cited earns no
    source-coverage credit — coverage is tied to citation."""
    run = {
        "question_id": "q-test",
        "sources": [
            {"id": "s1", "url": "https://example.dev/retrieval", "excerpt": "retrieval source text"},
        ],
        "claims": [
            {"text": "an uncited claim about retrieval and source", "source_ids": []},
        ],
    }
    # No claim cites s1, so neither the source anchors nor the claim anchors count.
    assert score_coverage(_QUESTION, run).score == 0.0


@pytest.mark.unit
def test_no_fabrication_clean_on_good_penalised_on_bad() -> None:
    assert score_no_fabrication(_GOOD_RUN).passed is True
    assert score_no_fabrication(_GOOD_RUN).score == 1.0
    bad = score_no_fabrication(_BAD_RUN)
    assert bad.passed is False
    # 3 incidents (dangling + empty-excerpt + uncited) over total 4 checks.
    assert bad.score == pytest.approx(0.25)


@pytest.mark.unit
def test_empty_run_scores_zero_not_one() -> None:
    """A missing/empty answer must NOT be trivially perfect (the EchoToolExecutor
    trap). Every dimension floors at 0.0 for an empty run."""
    empty = {"question_id": "q-test", "sources": [], "claims": []}
    result = score_research_run(_QUESTION, empty)
    assert result.total == 0.0
    for dim in result.dimensions:
        assert dim.score == 0.0, dim.name


# ---------------------------------------------------------------------------
# Aggregate: the whole point — GOOD and BAD are SEPARATED.
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_good_run_scores_high_bad_run_scores_low() -> None:
    good = score_research_run(_QUESTION, _GOOD_RUN)
    bad = score_research_run(_QUESTION, _BAD_RUN)
    assert good.total == 1.0
    assert bad.total <= 0.2
    assert good.total > bad.total


@pytest.mark.unit
def test_scoring_accepts_dataclass_and_dict_identically() -> None:
    """The rubric scores the typed dataclass shape and the plain dict shape the
    same — any executor can produce either."""
    typed = ResearchRunOutput(
        question_id="q-test",
        sources=(
            Source(id="s1", url="https://example.dev/retrieval", excerpt="retrieved source excerpt reduces hallucination"),
            Source(id="s2", url="https://example.dev/citation", excerpt="cite the source"),
        ),
        claims=(
            Claim(text="grounding in retrieved source excerpts helps", source_ids=("s1",)),
            Claim(text="every claim must cite its source", source_ids=("s2",)),
        ),
    )
    dict_form = {
        "question_id": "q-test",
        "sources": [
            {"id": "s1", "url": "https://example.dev/retrieval", "excerpt": "retrieved source excerpt reduces hallucination"},
            {"id": "s2", "url": "https://example.dev/citation", "excerpt": "cite the source"},
        ],
        "claims": [
            {"text": "grounding in retrieved source excerpts helps", "source_ids": ["s1"]},
            {"text": "every claim must cite its source", "source_ids": ["s2"]},
        ],
    }
    assert score_research_run(_QUESTION, typed).total == score_research_run(_QUESTION, dict_form).total


# ---------------------------------------------------------------------------
# Golden question set fixture integrity
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_bundled_question_set_loads_between_five_and_eight_entries() -> None:
    questions = load_questions()
    assert 5 <= len(questions) <= 8


@pytest.mark.unit
def test_bundled_questions_have_required_rubric_anchor_fields() -> None:
    questions = load_questions()
    seen_ids: set[str] = set()
    for q in questions:
        assert q.get("id"), "question missing id"
        assert q["id"] not in seen_ids, f"duplicate id: {q['id']}"
        seen_ids.add(q["id"])
        assert q.get("question")
        assert q.get("expected_source_substrings"), q["id"]
        assert q.get("expected_claims"), q["id"]
        for anchor in q["expected_claims"]:
            assert anchor.get("keywords"), f"{q['id']} anchor missing keywords"


@pytest.mark.unit
def test_render_table_contains_all_questions_and_a_mean_row() -> None:
    questions = load_questions()
    # Empty runs -> every question present, all zeros, plus a MEAN row.
    scores = score_runs(questions, {})
    table = render_table(scores)
    for q in questions:
        assert q["id"] in table
    assert "MEAN" in table
    assert "TOTAL" in table


# ---------------------------------------------------------------------------
# End-to-end harness smoke (offline) — gated behind RUN_RESEARCH_EVAL=1
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.skipif(not _RUN_EVAL, reason="Set RUN_RESEARCH_EVAL=1 to run the harness smoke test")
def test_harness_scores_bundled_example_runs_and_writes_report(tmp_path: Path) -> None:
    """Smoke: the runner scores the bundled example_runs.json against the golden
    set and writes a JSON report. Fully offline — no Bedrock, no Supabase."""
    here = Path(__file__).resolve()
    # apps/email-listener/tests/evals/ -> apps/email-listener/scripts/research_eval/
    example_runs = here.parents[2] / "scripts" / "research_eval" / "example_runs.json"
    runs = {r["question_id"]: r for r in json.loads(example_runs.read_text(encoding="utf-8"))}

    questions = load_questions()
    scores = score_runs(questions, runs)

    # The curated example answers each golden question well.
    assert scores, "expected at least one scored question"
    assert all(s.total >= 0.8 for s in scores), [(s.question_id, s.total) for s in scores]

    report = build_report(label="smoke", scores=scores)
    out = tmp_path / "report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    loaded = json.loads(out.read_text(encoding="utf-8"))
    assert loaded["total_questions"] == len(questions)
    assert 0.0 <= loaded["mean_total"] <= 1.0
    assert set(loaded["mean_by_dimension"]) == {
        "cited-sources",
        "claims-resolve",
        "coverage",
        "no-fabrication",
    }
