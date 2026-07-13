"""Compare two GenUI eval reports and summarize regressions / improvements.

Usage:
    uv run python -m scripts.genui_eval.compare_reports <baseline.json> <candidate.json>

Prints a Markdown diff table to stdout. No network calls. No eval/exec/compile (D-24).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _load_report(path: Path) -> dict[str, Any]:
    """Load and return a JSON report dict from disk."""
    text = path.read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(text)
    return data


def _delta_str(baseline: float | None, candidate: float | None) -> str:
    """Format the delta between two optional float scores."""
    if baseline is None or candidate is None:
        return "N/A"
    delta = candidate - baseline
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:.3f}"


def _format_score(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value:.3f}"


def compare(baseline: dict[str, Any], candidate: dict[str, Any]) -> str:
    """Return a Markdown comparison between baseline and candidate reports.

    Args:
        baseline: Parsed baseline JSON report dict.
        candidate: Parsed candidate JSON report dict.

    Returns:
        Markdown string with aggregate comparison and per-prompt regression table.
    """
    lines: list[str] = [
        "# GenUI Eval Comparison",
        "",
        f"**Baseline:** {baseline.get('label', '?')} ({baseline.get('run_at', '?')})",
        f"**Candidate:** {candidate.get('label', '?')} ({candidate.get('run_at', '?')})",
        "",
        "## Aggregate Score Comparison",
        "",
        "| Criterion | Baseline | Candidate | Delta |",
        "|-----------|----------|-----------|-------|",
    ]

    criteria = [
        ("overall", "mean_overall"),
        ("valid-spec", "mean_valid_spec"),
        ("composed", "mean_composed"),
        ("on-intent", "mean_on_intent"),
        ("a11y", "mean_a11y"),
    ]

    for label, key in criteria:
        b_val = baseline.get(key)
        c_val = candidate.get(key)
        lines.append(f"| {label} | {_format_score(b_val)} | {_format_score(c_val)} | {_delta_str(b_val, c_val)} |")

    # D-09 / D-18: a11y HARD-regression flag — any negative a11y delta is blocking
    b_a11y = baseline.get("mean_a11y")
    c_a11y = candidate.get("mean_a11y")
    a11y_hard_regression = b_a11y is not None and c_a11y is not None and (c_a11y - b_a11y) < 0.0

    if a11y_hard_regression and b_a11y is not None and c_a11y is not None:
        a11y_delta = c_a11y - b_a11y
        lines += [
            "",
            "## A11Y HARD REGRESSION DETECTED",
            "",
            f"> **HARD FAIL**: a11y regressed by {a11y_delta:+.3f} (baseline {b_a11y:.3f} -> candidate {c_a11y:.3f}).",
            "> Any negative a11y delta is a blocking failure (D-09).",
            "> Do NOT merge until a11y is restored to baseline level or above.",
            "",
        ]

    # Style signals section (D-18) — additive, shown when present in either report
    style_keys = [
        ("brand score", "mean_brand_score"),
        ("distinctiveness", "mean_distinctiveness"),
        ("retrieval overlap", "mean_retrieval_overlap"),
    ]
    has_style_data = any(baseline.get(key) is not None or candidate.get(key) is not None for _, key in style_keys)

    if has_style_data:
        lines += [
            "",
            "## Style Signals (additive, D-18)",
            "",
            "| Signal | Baseline | Candidate | Delta |",
            "|--------|----------|-----------|-------|",
        ]
        for label_str, key in style_keys:
            b_val = baseline.get(key)
            c_val = candidate.get(key)
            lines.append(
                f"| {label_str} | {_format_score(b_val)} | {_format_score(c_val)} | {_delta_str(b_val, c_val)} |"
            )
        lines.append("")

    # Per-prompt regression table
    baseline_by_id: dict[str, dict[str, Any]] = {pr["prompt_id"]: pr for pr in baseline.get("prompt_reports", [])}
    candidate_by_id: dict[str, dict[str, Any]] = {pr["prompt_id"]: pr for pr in candidate.get("prompt_reports", [])}

    all_ids = sorted(set(baseline_by_id) | set(candidate_by_id))
    regressions: list[tuple[str, float, float, float]] = []

    for pid in all_ids:
        b_pr = baseline_by_id.get(pid)
        c_pr = candidate_by_id.get(pid)
        if b_pr is not None and c_pr is not None:
            b_score = float(b_pr.get("overall_score", 0.0))
            c_score = float(c_pr.get("overall_score", 0.0))
            delta = c_score - b_score
            if delta < -0.05:  # >5% regression threshold
                regressions.append((pid, b_score, c_score, delta))

    lines += [
        "",
        "## Regressions (delta < -0.05)",
        "",
    ]

    if regressions:
        lines += [
            "| Prompt ID | Baseline | Candidate | Delta |",
            "|-----------|----------|-----------|-------|",
        ]
        for pid, b_score, c_score, delta in sorted(regressions, key=lambda x: x[3]):
            lines.append(f"| {pid} | {b_score:.3f} | {c_score:.3f} | {delta:+.3f} |")
    else:
        lines.append("No regressions detected (all deltas >= -0.05).")

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    """CLI entry point: compare two report JSON files and print Markdown to stdout."""
    if len(sys.argv) != 3:
        print(
            "Usage: uv run python -m scripts.genui_eval.compare_reports <baseline.json> <candidate.json>",
            file=sys.stderr,
        )
        sys.exit(1)

    baseline_path = Path(sys.argv[1])
    candidate_path = Path(sys.argv[2])

    if not baseline_path.exists():
        print(f"Error: baseline file not found: {baseline_path}", file=sys.stderr)
        sys.exit(1)

    if not candidate_path.exists():
        print(f"Error: candidate file not found: {candidate_path}", file=sys.stderr)
        sys.exit(1)

    baseline = _load_report(baseline_path)
    candidate = _load_report(candidate_path)
    print(compare(baseline, candidate))


if __name__ == "__main__":
    main()
