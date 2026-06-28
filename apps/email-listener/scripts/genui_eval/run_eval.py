"""GenUI eval runner — executes the golden-set against the production pipeline.

Usage:
    uv run python -m scripts.genui_eval.run_eval [OPTIONS]

Options:
    --out PATH          Directory to write JSON + MD reports (default: scripts/genui_eval/reports/)
    --limit N           Run only the first N prompts (default: all)
    --no-judge          Skip the LLM-as-judge step (on-intent score will be None)
    --label TEXT        Human-readable label for the report (default: 'eval')

Design contracts (D-05, D-11, D-12, D-13):
    - Drives the REAL GenerateUiSpecUseCase (same production pipeline)
    - Intent-only mode: raw_content="" (isolates intent->UI quality)
    - Concurrency cap: asyncio.Semaphore(3) (avoid hammering Bedrock quota)
    - Per-prompt try/except: one prompt failure does not abort the run
    - Coverage scope fence: scripts/ is outside --cov=app; no 80% gate impact
    - No eval/exec/compile (D-24)

This module is NOT imported by any app code. It is a standalone script.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Golden-set path resolution
# ---------------------------------------------------------------------------

# The golden-set lives in packages/genui/src/eval/golden-set.json, relative
# to the repo root.  We resolve from this file's location.
_REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent  # apps/email-listener/scripts/genui_eval -> repo root
_GOLDEN_SET_PATH = _REPO_ROOT / "packages" / "genui" / "src" / "eval" / "golden-set.json"

# Concurrency cap: avoid hammering Bedrock quota
_CONCURRENCY = 3


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_golden_set(limit: int | None = None) -> list[dict[str, Any]]:
    """Load and return golden-set prompts, optionally limited to first N."""
    raw = json.loads(_GOLDEN_SET_PATH.read_text(encoding="utf-8"))
    items: list[dict[str, Any]] = raw if isinstance(raw, list) else []
    if limit is not None and limit > 0:
        items = items[:limit]
    return items


def _get_registry_version() -> str:
    """Read the registry version from genui-prompt.json (used for audit)."""
    from app.infrastructure.llm.genui_artifacts import load_prompt_payload  # noqa: PLC0415

    payload = load_prompt_payload()
    rv = payload.get("registryVersion", {})
    return str(rv.get("version", "unknown"))


# ---------------------------------------------------------------------------
# Per-prompt evaluation
# ---------------------------------------------------------------------------


def aggregate_all_packs(
    prompt_reports: list[Any],
) -> dict[str, Any]:
    """Aggregate per-pack scores and cross-pack distinctiveness from a flat list of PromptReports.

    Groups PromptReports by style_pack_id and computes per-pack mean_overall.
    Also computes cross_pack_mean_distinctiveness from all reports that carry
    a distinctiveness value.

    Args:
        prompt_reports: Flat list of PromptReport instances (with style_pack_id set).

    Returns:
        Dict with per-pack aggregates and a 'cross_pack_mean_distinctiveness' key.
    """
    pack_buckets: dict[str, list[Any]] = {}
    for pr in prompt_reports:
        pack_id = getattr(pr, "style_pack_id", None) or "unknown"
        if pack_id not in pack_buckets:
            pack_buckets[pack_id] = []
        pack_buckets[pack_id].append(pr)

    result: dict[str, Any] = {}
    for pack_id, reports in pack_buckets.items():
        completed = [r for r in reports if getattr(r, "error", None) is None]
        mean_overall = sum(r.overall_score for r in completed) / len(completed) if completed else 0.0
        result[pack_id] = {"mean_overall": mean_overall, "count": len(completed)}

    # Cross-pack mean distinctiveness (from all reports with a distinctiveness value)
    distinctiveness_values = [
        r.distinctiveness
        for r in prompt_reports
        if getattr(r, "distinctiveness", None) is not None
    ]
    if distinctiveness_values:
        result["cross_pack_mean_distinctiveness"] = sum(distinctiveness_values) / len(distinctiveness_values)
    else:
        result["cross_pack_mean_distinctiveness"] = 0.0

    return result


async def _eval_prompt(
    *,
    entry: dict[str, Any],
    use_case: Any,
    judge: Any | None,
    semaphore: asyncio.Semaphore,
    registry_version: str,
    style_pack_id: str | None = None,
) -> Any:
    """Evaluate a single golden-set prompt. Returns a PromptReport."""
    from scripts.genui_eval.report import PromptReport  # noqa: PLC0415
    from scripts.genui_eval.rubric import (  # noqa: PLC0415
        CriterionResult,
        a11y,
        aggregate,
        composed_not_placeholder,
        valid_spec,
    )
    from scripts.genui_eval.style_metrics import retrieval_overlap_ratio  # noqa: PLC0415

    prompt_id = str(entry.get("id", "?"))
    prompt = str(entry.get("prompt", ""))
    category = str(entry.get("category", ""))
    complexity = str(entry.get("complexity", ""))
    tier = str(entry.get("tier", ""))

    async with semaphore:
        try:
            result = await use_case.execute(
                intent=prompt,
                raw_content="",  # intent-only mode (D-05)
                registry_version=registry_version,
                style_pack_id=style_pack_id,
            )
            spec: dict[str, Any] = result.spec
            outcome = result.outcome
            result_pack_id: str | None = getattr(result, "style_pack_id", style_pack_id)
            retrieved_ids: tuple[str, ...] = getattr(result, "retrieved_ids", ())

            # Deterministic criteria
            vs = valid_spec(spec, outcome=outcome)
            cp = composed_not_placeholder(spec)
            # D-09: pass pack_token_values when available (style-pack run only)
            # For now, skip token-driven contrast check in the runner (no token
            # values available without the pack registry) — contrast check is
            # exercised by tests with explicit token dicts.
            ay = a11y(spec)

            # Retrieval overlap (RAG-02)
            overlap = retrieval_overlap_ratio(spec, retrieved_ids)

            # Optional LLM-as-judge
            on_intent_score: float | None = None
            judge_rationale = ""
            brand_score: float | None = None
            if judge is not None:
                judge_result = await judge.score(intent=prompt, spec=spec)
                on_intent_score = judge_result.score
                judge_rationale = judge_result.rationale
                # Brand judge (D-17) — only when style_pack_id is known
                if result_pack_id is not None:
                    brand_result = await judge.score_brand(
                        intent=prompt,
                        spec=spec,
                        style_pack_id=result_pack_id,
                    )
                    brand_score = brand_result.score

            # Build sub_scores for aggregate
            sub_scores: list[CriterionResult] = [vs, cp, ay]
            if on_intent_score is not None:
                sub_scores.append(CriterionResult(name="on-intent", score=on_intent_score, passed=on_intent_score >= 0.5))

            overall = aggregate(sub_scores)

            return PromptReport(
                prompt_id=prompt_id,
                prompt=prompt,
                category=category,
                complexity=complexity,
                tier=tier,
                outcome=outcome,
                overall_score=overall,
                valid_spec_score=vs.score,
                composed_score=cp.score,
                on_intent_score=on_intent_score,
                a11y_score=ay.score,
                judge_rationale=judge_rationale,
                error=None,
                style_pack_id=result_pack_id,
                a11y_contrast_passed=ay.passed,
                brand_score=brand_score,
                retrieval_overlap=overlap if retrieved_ids else None,
            )

        except Exception as exc:
            logger.error("eval_prompt_failed", prompt_id=prompt_id, exc_info=True)
            return PromptReport(
                prompt_id=prompt_id,
                prompt=prompt,
                category=category,
                complexity=complexity,
                tier=tier,
                outcome="escalated",
                overall_score=0.0,
                valid_spec_score=0.0,
                composed_score=0.0,
                on_intent_score=None,
                a11y_score=0.0,
                judge_rationale="",
                error=str(exc),
            )


# ---------------------------------------------------------------------------
# Main async runner
# ---------------------------------------------------------------------------


async def run(
    *,
    limit: int | None = None,
    no_judge: bool = False,
    label: str = "eval",
    out_dir: Path | None = None,
    style_pack_id: str | None = None,
    all_packs: bool = False,
) -> tuple[Path, Path]:
    """Execute the eval run and write reports.

    Args:
        limit: Max number of prompts to evaluate (None = all).
        no_judge: If True, skip the LLM-as-judge step.
        label: Human label for this report.
        out_dir: Output directory for reports (default: scripts/genui_eval/reports/).
        style_pack_id: Run with a specific style pack (e.g. 'nauta-teal').
        all_packs: If True, loop over all 6 STYLE_PACK_IDS and aggregate. D-19.

    Returns:
        Tuple of (json_path, md_path) for the written report files.
    """
    from app.container import create_container  # noqa: PLC0415
    from app.infrastructure.llm.genui_style_packs import STYLE_PACK_IDS  # noqa: PLC0415
    from app.settings import get_settings  # noqa: PLC0415
    from scripts.genui_eval.judge_adapter import JudgeAdapter  # noqa: PLC0415
    from scripts.genui_eval.report import build_report, write_report  # noqa: PLC0415

    settings = get_settings()
    golden_set = _load_golden_set(limit=limit)
    registry_version = _get_registry_version()

    container = create_container()
    try:
        from app.application.use_cases.generate_ui_spec import GenerateUiSpecUseCase  # noqa: PLC0415

        use_case = await container.get(GenerateUiSpecUseCase)

        # Judge: only create if not skipped
        judge: JudgeAdapter | None = None
        if not no_judge:
            from anthropic import AsyncAnthropicBedrock  # noqa: PLC0415, I001
            from app.infrastructure.llm.anthropic_client import get_anthropic_client  # noqa: PLC0415

            client: AsyncAnthropicBedrock = get_anthropic_client()
            judge = JudgeAdapter(
                client=client,
                model_id=settings.genui_escalation_model_id,
                timeout_seconds=settings.GENUI_TIMEOUT_SECONDS,
            )

        semaphore = asyncio.Semaphore(_CONCURRENCY)

        # Determine the pack IDs to evaluate
        packs_to_run: list[str | None]
        if all_packs:
            packs_to_run = list(STYLE_PACK_IDS)
            logger.info("genui_eval_all_packs", pack_count=len(packs_to_run))
        elif style_pack_id is not None:
            packs_to_run = [style_pack_id]
        else:
            packs_to_run = [None]  # baseline run (no style pack)

        all_prompt_reports: list[Any] = []
        for pack_id in packs_to_run:
            pack_tasks = [
                _eval_prompt(
                    entry=entry,
                    use_case=use_case,
                    judge=judge,
                    semaphore=semaphore,
                    registry_version=registry_version,
                    style_pack_id=pack_id,
                )
                for entry in golden_set
            ]
            pack_results = await asyncio.gather(*pack_tasks)
            all_prompt_reports.extend(pack_results)

    finally:
        await container.close()

    report = build_report(
        label=label,
        model_id=settings.genui_model_id,
        prompt_reports=all_prompt_reports,
    )
    return write_report(report, out_dir=out_dir)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GenUI eval runner")
    parser.add_argument("--out", type=Path, default=None, help="Output directory for reports")
    parser.add_argument("--limit", type=int, default=None, help="Max prompts to evaluate")
    parser.add_argument("--no-judge", action="store_true", help="Skip LLM-as-judge scoring")
    parser.add_argument("--label", type=str, default="eval", help="Label for this report")
    pack_group = parser.add_mutually_exclusive_group()
    pack_group.add_argument(
        "--style-pack",
        type=str,
        default=None,
        metavar="PACK_ID",
        help="Run eval with a specific style pack (e.g. nauta-teal). "
        "Mutually exclusive with --all-packs.",
    )
    pack_group.add_argument(
        "--all-packs",
        action="store_true",
        help="Run eval over all 6 style packs and aggregate (D-19). "
        "Mutually exclusive with --style-pack.",
    )
    return parser.parse_args()


def main() -> None:
    """CLI entry point for the eval runner."""
    logging.basicConfig(level=logging.INFO)
    args = _parse_args()
    json_path, md_path = asyncio.run(
        run(
            limit=args.limit,
            no_judge=args.no_judge,
            label=args.label,
            out_dir=args.out,
            style_pack_id=args.style_pack,
            all_packs=args.all_packs,
        )
    )
    print(f"Report written:\n  JSON: {json_path}\n  MD:   {md_path}")


if __name__ == "__main__":
    main()
