"""Offline extraction eval harness (Stage-1 adopt-now item, data-eng-ds.md §2).

Snapshots confirmed ``extraction_records`` (extracted_fields vs the human
corrected_fields overlay) into a versioned JSONL eval set, scores per-field
accuracy deterministically, and gates regressions against a committed
baseline. See ``tests/evals/README.md`` for the E1-E6 gate ladder.

Standalone like scripts.research_eval / scripts.backfill_threads — never
imported by app code.
"""
