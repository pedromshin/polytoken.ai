"""Pure deterministic rubric for the research-quality eval harness (RSRCH-05).

Scores a *research-run output* against a golden question. Four dimensions,
all deterministic — no Bedrock, no Supabase, no boto3, no network:

  - cited-sources    (weight 0.20): fraction of claims that cite >= 1 source
  - claims-resolve   (weight 0.25): fraction of claims whose every citation
                                     resolves to a source that actually exists
  - coverage         (weight 0.35): did the run hit the golden anchors —
                                     expected source substrings + expected
                                     claim keyword-sets (the regression signal)
  - no-fabrication   (weight 0.20): penalise dangling citations, empty-excerpt
                                     "sources", and uncited assertions

Rubric purity guarantee (mirrors genui_eval rubric.py, D-11):
  - No import from anthropic, supabase, boto3, or any network library
  - No eval/exec/compile (D-24)

## The research-run output shape this rubric scores

A plain dict (or the equivalent dataclass), so any executor — a live Bedrock
loop, a fixture, a replay — can be scored identically:

    {
      "question_id": "rsrch-eval-01",
      "sources": [
        {"id": "s1", "url": "...", "title": "...", "excerpt": "verbatim text"},
        ...
      ],
      "claims": [
        {"text": "the synthesised claim ...", "source_ids": ["s1", "s2"]},
        ...
      ],
      "report": "optional final synthesised body text"
    }

Only ``sources`` and ``claims`` drive scoring; ``report`` is carried through for
the report writer / human reader. A claim is "cited" when it has >= 1
``source_ids``; it "resolves" when every id in ``source_ids`` names a source
present in ``sources``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Weights — must sum to 1.0 across the four always-present dimensions.
# ---------------------------------------------------------------------------

WEIGHTS: dict[str, float] = {
    "cited-sources": 0.20,
    "claims-resolve": 0.25,
    "coverage": 0.35,
    "no-fabrication": 0.20,
}


# ---------------------------------------------------------------------------
# Typed research-run output shape (dataclasses mirror the dict contract).
# Scoring accepts either the dataclasses below or plain dicts.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Source:
    """One retrieved source a claim can cite. ``excerpt`` is the verbatim text."""

    id: str
    excerpt: str = ""
    url: str = ""
    title: str = ""


@dataclass(frozen=True)
class Claim:
    """One synthesised claim and the source ids it rests on."""

    text: str
    source_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResearchRunOutput:
    """The shape the rubric scores. Executor-agnostic (fixture or live loop)."""

    question_id: str
    sources: tuple[Source, ...] = ()
    claims: tuple[Claim, ...] = ()
    report: str = ""


# ---------------------------------------------------------------------------
# Rubric result dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DimensionResult:
    """Immutable result for one rubric dimension."""

    name: str
    score: float
    passed: bool
    detail: str = ""


@dataclass(frozen=True)
class RubricScore:
    """The full scored result for one research run against one question."""

    question_id: str
    total: float
    dimensions: tuple[DimensionResult, ...] = field(default_factory=tuple)

    def by_name(self, name: str) -> DimensionResult:
        for dim in self.dimensions:
            if dim.name == name:
                return dim
        raise KeyError(name)


# ---------------------------------------------------------------------------
# Normalisation — accept dicts or dataclasses, work on plain lists internally.
# ---------------------------------------------------------------------------


def _as_sources(run: Any) -> list[dict[str, str]]:
    raw = run.sources if isinstance(run, ResearchRunOutput) else (run or {}).get("sources", [])
    out: list[dict[str, str]] = []
    for s in raw or []:
        if isinstance(s, Source):
            out.append({"id": s.id, "excerpt": s.excerpt, "url": s.url, "title": s.title})
        elif isinstance(s, dict):
            out.append(
                {
                    "id": str(s.get("id", "")),
                    "excerpt": str(s.get("excerpt", "")),
                    "url": str(s.get("url", "")),
                    "title": str(s.get("title", "")),
                }
            )
    return out


def _as_claims(run: Any) -> list[dict[str, Any]]:
    raw = run.claims if isinstance(run, ResearchRunOutput) else (run or {}).get("claims", [])
    out: list[dict[str, Any]] = []
    for c in raw or []:
        if isinstance(c, Claim):
            out.append({"text": c.text, "source_ids": list(c.source_ids)})
        elif isinstance(c, dict):
            ids = c.get("source_ids", []) or []
            out.append({"text": str(c.get("text", "")), "source_ids": [str(i) for i in ids]})
    return out


# ---------------------------------------------------------------------------
# Individual dimension scorers (each returns a DimensionResult in [0.0, 1.0])
# ---------------------------------------------------------------------------


def score_cited_sources(run: Any) -> DimensionResult:
    """Fraction of claims that cite at least one source. No claims -> 0.0."""
    claims = _as_claims(run)
    if not claims:
        return DimensionResult("cited-sources", 0.0, False, "no claims to cite from")
    cited = sum(1 for c in claims if c["source_ids"])
    score = cited / len(claims)
    return DimensionResult(
        "cited-sources", score, score == 1.0, f"{cited}/{len(claims)} claims carry a citation"
    )


def score_claims_resolve(run: Any) -> DimensionResult:
    """Fraction of claims whose every citation resolves to an existing source.

    A claim with no citations does NOT resolve (it rests on nothing). No claims
    -> 0.0.
    """
    claims = _as_claims(run)
    if not claims:
        return DimensionResult("claims-resolve", 0.0, False, "no claims to resolve")
    source_ids = {s["id"] for s in _as_sources(run) if s["id"]}
    resolved = sum(
        1 for c in claims if c["source_ids"] and all(sid in source_ids for sid in c["source_ids"])
    )
    score = resolved / len(claims)
    return DimensionResult(
        "claims-resolve", score, score == 1.0, f"{resolved}/{len(claims)} claims resolve to real sources"
    )


def _source_blob(source: dict[str, str]) -> str:
    return " ".join((source.get("url", ""), source.get("title", ""), source.get("excerpt", ""))).lower()


def score_coverage(question: dict[str, Any], run: Any) -> DimensionResult:
    """Did the run hit the golden anchors? Mean of source-coverage and claim-coverage.

    - source coverage: fraction of ``expected_source_substrings`` that appear in
      some CITED source's url/title/excerpt.
    - claim coverage: fraction of ``expected_claims`` anchors satisfied — an
      anchor is satisfied when some CITED claim's text contains ALL its keywords.

    Coverage is deliberately tied to citation: an uncited assertion cannot earn
    coverage credit. When an anchor list is empty, that half scores 1.0 (nothing
    required).
    """
    sources = _as_sources(run)
    claims = _as_claims(run)
    cited_source_ids = {sid for c in claims for sid in c["source_ids"]}
    cited_blobs = [_source_blob(s) for s in sources if s["id"] in cited_source_ids]
    cited_claim_texts = [c["text"].lower() for c in claims if c["source_ids"]]

    expected_substrings = [str(x).lower() for x in question.get("expected_source_substrings", [])]
    if not expected_substrings:
        source_cov = 1.0
    else:
        hit = sum(1 for sub in expected_substrings if any(sub in blob for blob in cited_blobs))
        source_cov = hit / len(expected_substrings)

    expected_claims = question.get("expected_claims", []) or []
    if not expected_claims:
        claim_cov = 1.0
    else:
        satisfied = 0
        for anchor in expected_claims:
            keywords = [str(k).lower() for k in anchor.get("keywords", [])]
            if keywords and any(all(k in text for k in keywords) for text in cited_claim_texts):
                satisfied += 1
        claim_cov = satisfied / len(expected_claims)

    score = (source_cov + claim_cov) / 2.0
    return DimensionResult(
        "coverage",
        score,
        score == 1.0,
        f"source-cov={source_cov:.2f} claim-cov={claim_cov:.2f}",
    )


def score_no_fabrication(run: Any) -> DimensionResult:
    """Penalise fabrication signals: dangling citations, empty-excerpt sources,
    and uncited assertions.

    incidents = dangling citations (source_id naming a non-existent source)
              + sources whose excerpt is empty/whitespace (a "source" with
                nothing verbatim behind it)
              + claims with no citation at all (unsupported assertion)

    total = total citation refs + total sources + total claims
    score = max(0.0, 1 - incidents/total). Empty run (nothing to trust) -> 0.0.
    """
    sources = _as_sources(run)
    claims = _as_claims(run)
    source_ids = {s["id"] for s in sources if s["id"]}

    citation_refs = [sid for c in claims for sid in c["source_ids"]]
    dangling = sum(1 for sid in citation_refs if sid not in source_ids)
    empty_excerpt = sum(1 for s in sources if not s["excerpt"].strip())
    uncited_claims = sum(1 for c in claims if not c["source_ids"])

    total = len(citation_refs) + len(sources) + len(claims)
    if total == 0:
        return DimensionResult("no-fabrication", 0.0, False, "empty run — nothing to trust")

    incidents = dangling + empty_excerpt + uncited_claims
    score = max(0.0, 1.0 - incidents / total)
    return DimensionResult(
        "no-fabrication",
        score,
        incidents == 0,
        f"{incidents} fabrication signal(s): dangling={dangling} empty-excerpt={empty_excerpt} uncited={uncited_claims}",
    )


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def aggregate(dimensions: list[DimensionResult]) -> float:
    """Weighted mean over the four dimensions. Missing dimensions are excluded
    and the remaining weights renormalised (mirrors genui_eval.aggregate)."""
    present = {d.name for d in dimensions}
    active = {k: v for k, v in WEIGHTS.items() if k in present}
    weight_sum = sum(active.values())
    if weight_sum == 0.0:
        return 0.0
    score_map = {d.name: d.score for d in dimensions}
    return sum(score_map[k] * w for k, w in active.items()) / weight_sum


def score_research_run(question: dict[str, Any], run: Any) -> RubricScore:
    """Score one research-run output against one golden question.

    Args:
        question: a golden question entry (from questions.json).
        run: a research-run output — a ResearchRunOutput or the equivalent dict.

    Returns:
        RubricScore with per-dimension results and a weighted total in [0, 1].
    """
    dimensions = [
        score_cited_sources(run),
        score_claims_resolve(run),
        score_coverage(question, run),
        score_no_fabrication(run),
    ]
    total = aggregate(dimensions)
    qid = str(question.get("id", "")) or (
        run.question_id if isinstance(run, ResearchRunOutput) else str((run or {}).get("question_id", ""))
    )
    return RubricScore(question_id=qid, total=total, dimensions=tuple(dimensions))
