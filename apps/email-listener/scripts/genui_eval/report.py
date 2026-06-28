"""Report writer for GenUI eval harness.

Writes timestamped JSON + Markdown reports to scripts/genui_eval/reports/.

Report format (D-12):
  - JSON: machine-readable; includes per-prompt scores, aggregates, metadata
  - Markdown: human-readable summary table + per-prompt breakdown

No network calls — pure filesystem writes.
No eval/exec/compile (D-24).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Report data structures
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PromptReport:
    """Scores and metadata for a single eval prompt."""

    prompt_id: str
    prompt: str
    category: str
    complexity: str
    tier: str
    outcome: str
    overall_score: float
    valid_spec_score: float
    composed_score: float
    on_intent_score: float | None
    a11y_score: float
    judge_rationale: str
    error: str | None = None
    # Additive style fields (D-15: must not alter the 4 core mean_* aggregates)
    style_pack_id: str | None = None
    a11y_contrast_passed: bool | None = None
    brand_score: float | None = None
    distinctiveness: float | None = None
    retrieval_overlap: float | None = None


@dataclass(frozen=True)
class EvalReport:
    """Aggregate eval report for a full run.

    WR-05: prompt_reports is a tuple, not a list, so that the frozen=True
    immutability contract is not violated at runtime. Python's frozen=True
    prevents field reassignment but cannot prevent mutation of a mutable
    container stored in a field — using tuple eliminates that loophole.
    Tuple is fully JSON-serialisable via asdict() (produces a list in JSON).

    D-15: The five core aggregate fields (mean_overall, mean_valid_spec,
    mean_composed, mean_on_intent, mean_a11y) MUST NOT change semantics.
    Additive style aggregate fields are appended after them.
    """

    label: str
    run_at: str
    model_id: str
    total_prompts: int
    completed_prompts: int
    failed_prompts: int
    mean_overall: float
    mean_valid_spec: float
    mean_composed: float
    mean_on_intent: float | None
    mean_a11y: float
    prompt_reports: tuple[PromptReport, ...]
    # Additive style aggregates (D-15: do not alter core 4 mean_* semantics)
    mean_brand_score: float | None = None
    mean_distinctiveness: float | None = None
    mean_retrieval_overlap: float | None = None


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------


def _reports_dir() -> Path:
    """Return the canonical reports directory (scripts/genui_eval/reports/).

    Creates the directory if it does not exist.
    """
    here = Path(__file__).parent
    reports = here / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    return reports


def _timestamp_slug() -> str:
    """Return a UTC timestamp string safe for use in file names."""
    now = datetime.now(tz=UTC)
    return now.strftime("%Y%m%dT%H%M%SZ")


def _mean(values: list[float]) -> float:
    """Return arithmetic mean of values, or 0.0 for empty lists."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _optional_mean(values: list[float | None]) -> float | None:
    """Return arithmetic mean of non-None values, or None if all are None."""
    present = [v for v in values if v is not None]
    if not present:
        return None
    return sum(present) / len(present)


def build_report(
    *,
    label: str,
    model_id: str,
    prompt_reports: list[PromptReport] | tuple[PromptReport, ...],
) -> EvalReport:
    """Build an EvalReport from per-prompt results.

    Args:
        label: Human-readable label for this run (e.g. 'baseline-16-02').
        model_id: The model ID used for generation.
        prompt_reports: Per-prompt results from the runner (list or tuple).

    Returns:
        EvalReport with aggregated metrics.
        prompt_reports is stored as a tuple to satisfy frozen=True immutability
        (WR-05: a list inside a frozen dataclass is still mutable at runtime).
    """
    # Materialise into a tuple for immutable storage inside the frozen dataclass.
    reports_tuple: tuple[PromptReport, ...] = tuple(prompt_reports)

    completed = [r for r in reports_tuple if r.error is None]
    failed = [r for r in reports_tuple if r.error is not None]

    return EvalReport(
        label=label,
        run_at=datetime.now(tz=UTC).isoformat(),
        model_id=model_id,
        total_prompts=len(reports_tuple),
        completed_prompts=len(completed),
        failed_prompts=len(failed),
        mean_overall=_mean([r.overall_score for r in completed]),
        mean_valid_spec=_mean([r.valid_spec_score for r in completed]),
        mean_composed=_mean([r.composed_score for r in completed]),
        mean_on_intent=_optional_mean([r.on_intent_score for r in completed]),
        mean_a11y=_mean([r.a11y_score for r in completed]),
        prompt_reports=reports_tuple,
        # Additive style aggregates (D-15: additive only, core fields unchanged)
        mean_brand_score=_optional_mean([r.brand_score for r in completed]),
        mean_distinctiveness=_optional_mean([r.distinctiveness for r in completed]),
        mean_retrieval_overlap=_optional_mean([r.retrieval_overlap for r in completed]),
    )


def write_report(report: EvalReport, *, out_dir: Path | None = None) -> tuple[Path, Path]:
    """Write JSON + Markdown reports to disk.

    Args:
        report: The EvalReport to serialize.
        out_dir: Override output directory (default: scripts/genui_eval/reports/).

    Returns:
        Tuple of (json_path, md_path).
    """
    target_dir = out_dir if out_dir is not None else _reports_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    slug = _timestamp_slug()
    safe_label = report.label.replace(" ", "-").replace("/", "-")
    base_name = f"{slug}-{safe_label}"

    json_path = target_dir / f"{base_name}.json"
    md_path = target_dir / f"{base_name}.md"

    # --- JSON ---
    report_dict: dict[str, Any] = {
        "label": report.label,
        "run_at": report.run_at,
        "model_id": report.model_id,
        "total_prompts": report.total_prompts,
        "completed_prompts": report.completed_prompts,
        "failed_prompts": report.failed_prompts,
        "mean_overall": round(report.mean_overall, 4),
        "mean_valid_spec": round(report.mean_valid_spec, 4),
        "mean_composed": round(report.mean_composed, 4),
        "mean_on_intent": round(report.mean_on_intent, 4) if report.mean_on_intent is not None else None,
        "mean_a11y": round(report.mean_a11y, 4),
        # Additive style aggregates (D-15, WR-01): required by compare_reports.py
        "mean_brand_score": round(report.mean_brand_score, 4) if report.mean_brand_score is not None else None,
        "mean_distinctiveness": round(report.mean_distinctiveness, 4) if report.mean_distinctiveness is not None else None,
        "mean_retrieval_overlap": round(report.mean_retrieval_overlap, 4) if report.mean_retrieval_overlap is not None else None,
        "prompt_reports": [asdict(pr) for pr in report.prompt_reports],
    }
    json_path.write_text(json.dumps(report_dict, indent=2), encoding="utf-8")

    # --- Markdown ---
    md_path.write_text(_render_markdown(report), encoding="utf-8")

    return json_path, md_path


def _render_markdown(report: EvalReport) -> str:
    """Render EvalReport as a Markdown document."""
    on_intent_str = f"{report.mean_on_intent:.3f}" if report.mean_on_intent is not None else "N/A (no judge)"

    lines: list[str] = [
        f"# GenUI Eval Report: {report.label}",
        "",
        f"**Run at:** {report.run_at}  ",
        f"**Model:** {report.model_id}  ",
        f"**Total prompts:** {report.total_prompts}  ",
        f"**Completed:** {report.completed_prompts}  ",
        f"**Failed:** {report.failed_prompts}  ",
        "",
        "## Aggregate Scores",
        "",
        "| Criterion | Score |",
        "|-----------|-------|",
        f"| Overall | {report.mean_overall:.3f} |",
        f"| valid-spec | {report.mean_valid_spec:.3f} |",
        f"| composed | {report.mean_composed:.3f} |",
        f"| on-intent | {on_intent_str} |",
        f"| a11y | {report.mean_a11y:.3f} |",
    ]
    # Additive style aggregate rows (IN-05: only append when values are present)
    if report.mean_brand_score is not None:
        lines.append(f"| brand score | {report.mean_brand_score:.3f} |")
    if report.mean_distinctiveness is not None:
        lines.append(f"| distinctiveness | {report.mean_distinctiveness:.3f} |")
    if report.mean_retrieval_overlap is not None:
        lines.append(f"| retrieval overlap | {report.mean_retrieval_overlap:.3f} |")
    lines += [
        "",
        "## Per-Prompt Results",
        "",
        "| ID | Category | Complexity | Tier | Overall | valid-spec | composed | on-intent | a11y | Outcome |",
        "|----|----------|------------|------|---------|------------|----------|-----------|------|---------|",
    ]

    for pr in report.prompt_reports:
        on_intent_cell = f"{pr.on_intent_score:.3f}" if pr.on_intent_score is not None else "N/A"
        error_marker = " (ERR)" if pr.error else ""
        lines.append(
            f"| {pr.prompt_id} | {pr.category} | {pr.complexity} | {pr.tier}"
            f" | {pr.overall_score:.3f}{error_marker}"
            f" | {pr.valid_spec_score:.3f}"
            f" | {pr.composed_score:.3f}"
            f" | {on_intent_cell}"
            f" | {pr.a11y_score:.3f}"
            f" | {pr.outcome} |"
        )

    lines.append("")
    return "\n".join(lines)
