"""Recompute and write the committed extraction-eval baseline (E3 gate input).

Run this ONLY when deliberately accepting a new baseline — after freezing a
new dataset version or after an intentional scoring-semantics change. The
default pytest run then holds every future run to it.

Usage:
    cd apps/email-listener
    uv run python -m scripts.extraction_eval.update_baseline \
        --dataset tests/evals/datasets/extraction-eval-v1.jsonl

Writes <dataset stem>.baseline.json next to the dataset unless --output is given.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scripts.extraction_eval.dataset import (
    aggregate_scores,
    dataset_sha256,
    format_report,
    load_dataset,
    report_to_dict,
)


def build_baseline(dataset_path: Path) -> dict[str, object]:
    meta, records = load_dataset(dataset_path)
    report = aggregate_scores(records)
    return report_to_dict(
        report,
        dataset_version=meta.dataset_version,
        dataset_file=dataset_path.name,
        dataset_sha256_hex=dataset_sha256(dataset_path),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recompute the committed extraction-eval baseline.")
    parser.add_argument("--dataset", required=True, type=Path, help="Frozen JSONL dataset to baseline.")
    parser.add_argument("--output", default=None, type=Path, help="Baseline JSON path (default: sibling).")
    args = parser.parse_args(argv)

    output = args.output or args.dataset.with_name(f"{args.dataset.stem}.baseline.json")
    baseline = build_baseline(args.dataset)
    output.write_text(json.dumps(baseline, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    meta, records = load_dataset(args.dataset)
    print(f"baseline written to {output} (dataset_version={meta.dataset_version})")
    print(format_report(aggregate_scores(records)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
