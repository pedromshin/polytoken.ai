"""Research-quality eval runner (Phase 72 / RSRCH-05).

Given a set of *research-run outputs* (sources + claims + report body), scores
each against the fixed golden question set with the deterministic rubric and
prints a per-dimension + total breakdown. Re-runnable on demand so a
research-quality regression is *detectable*.

Usage:
    uv run python -m scripts.research_eval.run_eval --runs RUNS.json [OPTIONS]

Options:
    --runs PATH        JSON of research-run outputs to score (list, or a
                       {question_id: run} map). REQUIRED — the harness scores a
                       GIVEN output; see the design note below on live runs.
    --questions PATH   Golden question set (default: bundled questions.json).
    --out PATH         Directory to write a JSON report (default: none, print only).
    --label TEXT       Human-readable label for the report (default: 'research-eval').

Design contract (mirrors scripts.genui_eval, D-11):
    - PURE + OFFLINE: scores a given run output. No Bedrock, no Supabase, no boto3.
    - Executing a live research run against Bedrock is DELIBERATELY out of scope
      for this slice. A live executor would produce the ResearchRunOutput shape
      this harness consumes; wiring it lives with the research loop + the
      registry capability (Phase 72 item 4), not here.
    - No eval/exec/compile (D-24). Not imported by any app code — standalone.

This module is the deterministic scorer the eval-harness registry capability's
``execute`` would call — the self-building product measuring itself with its own
substrate. That TS binding is a pointer, not built in this Python slice.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scripts.research_eval.rubric import WEIGHTS, RubricScore, score_research_run

# The bundled golden question set lives next to this file.
_HERE = Path(__file__).parent
_DEFAULT_QUESTIONS_PATH = _HERE / "questions.json"


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_questions(path: Path | None = None) -> list[dict[str, Any]]:
    """Load the golden question set (default: bundled questions.json)."""
    p = path if path is not None else _DEFAULT_QUESTIONS_PATH
    raw = json.loads(Path(p).read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else []


def load_runs(path: Path) -> dict[str, dict[str, Any]]:
    """Load research-run outputs, keyed by question_id.

    Accepts either a list of run dicts (each carrying ``question_id``) or a
    ``{question_id: run}`` mapping.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    runs: dict[str, dict[str, Any]] = {}
    if isinstance(raw, dict):
        for qid, run in raw.items():
            normalised = dict(run)
            normalised.setdefault("question_id", qid)
            runs[str(qid)] = normalised
    elif isinstance(raw, list):
        for run in raw:
            qid = str(run.get("question_id", ""))
            if qid:
                runs[qid] = run
    return runs


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def score_runs(
    questions: list[dict[str, Any]],
    runs: dict[str, dict[str, Any]],
) -> list[RubricScore]:
    """Score every question for which a run output is present.

    A question with no run output is scored against an empty run (total 0.0) —
    a missing answer is a research-quality failure, not a skipped test.
    """
    scores: list[RubricScore] = []
    for question in questions:
        qid = str(question.get("id", ""))
        run = runs.get(qid, {"question_id": qid, "sources": [], "claims": []})
        scores.append(score_research_run(question, run))
    return scores


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def build_report(*, label: str, scores: list[RubricScore]) -> dict[str, Any]:
    """Build a machine-readable report dict from per-question scores."""
    dim_names = list(WEIGHTS.keys())
    means = {
        name: _mean([s.by_name(name).score for s in scores if any(d.name == name for d in s.dimensions)])
        for name in dim_names
    }
    return {
        "label": label,
        "run_at": datetime.now(tz=UTC).isoformat(),
        "weights": WEIGHTS,
        "total_questions": len(scores),
        "mean_total": _mean([s.total for s in scores]),
        "mean_by_dimension": means,
        "per_question": [
            {
                "question_id": s.question_id,
                "total": s.total,
                "dimensions": [asdict(d) for d in s.dimensions],
            }
            for s in scores
        ],
    }


def render_table(scores: list[RubricScore]) -> str:
    """Render a per-question + per-dimension text table with column means."""
    dim_names = list(WEIGHTS.keys())
    header = ["question_id", *dim_names, "TOTAL"]
    rows: list[list[str]] = [header]
    for s in scores:
        cells = [s.question_id]
        for name in dim_names:
            cells.append(f"{s.by_name(name).score:.2f}")
        cells.append(f"{s.total:.2f}")
        rows.append(cells)
    # Column means
    mean_cells = ["MEAN"]
    for name in dim_names:
        mean_cells.append(f"{_mean([s.by_name(name).score for s in scores]):.2f}")
    mean_cells.append(f"{_mean([s.total for s in scores]):.2f}")
    rows.append(mean_cells)

    widths = [max(len(row[i]) for row in rows) for i in range(len(header))]
    lines: list[str] = []
    for idx, row in enumerate(rows):
        line = "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row))
        lines.append(line)
        if idx == 0 or idx == len(rows) - 2:  # underline header and pre-MEAN
            lines.append("  ".join("-" * widths[i] for i in range(len(header))))
    return "\n".join(lines)


def write_report(report: dict[str, Any], out_dir: Path, label: str) -> Path:
    """Write the JSON report to ``out_dir`` and return the path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
    safe_label = label.replace(" ", "-").replace("/", "-")
    path = out_dir / f"{slug}-{safe_label}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Research-quality eval runner (RSRCH-05)")
    parser.add_argument(
        "--runs",
        type=Path,
        required=True,
        help="JSON of research-run outputs to score (list or {question_id: run} map)",
    )
    parser.add_argument("--questions", type=Path, default=None, help="Golden question set JSON")
    parser.add_argument("--out", type=Path, default=None, help="Directory to write a JSON report")
    parser.add_argument("--label", type=str, default="research-eval", help="Label for the report")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """CLI entry point. Loads runs + questions, scores, prints the table."""
    args = _parse_args(argv)
    questions = load_questions(args.questions)
    runs = load_runs(args.runs)
    scores = score_runs(questions, runs)

    print(render_table(scores))
    print()
    print(f"mean total: {_mean([s.total for s in scores]):.3f}  over {len(scores)} question(s)")

    if args.out is not None:
        report = build_report(label=args.label, scores=scores)
        path = write_report(report, args.out, args.label)
        print(f"report written: {path}")


if __name__ == "__main__":
    main()
