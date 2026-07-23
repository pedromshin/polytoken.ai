# Offline extraction eval harness

The Stage-1 "adopt now" DE/DS investment from
`.planning/research/2026-07-22-ecosystem/data-eng-ds.md` §2: polytoken already
persists the hard part (`extraction_records.extracted_fields` = model output,
`corrected_fields` = immutable human overlay). This harness turns that into a
repeatable offline eval:

- **Dataset builder** — `scripts/extraction_eval/build_dataset.py` snapshots
  confirmed `extraction_records` into a versioned JSONL set. The definition of
  a row is the canonical `SNAPSHOT_SQL` in `scripts/extraction_eval/dataset.py`
  (its sha256 is stamped into every dataset's meta line); the builder executes
  the PostgREST-equivalent chain against a **local** Supabase stack only
  (`INTEGRATION_SUPABASE_URL` / `INTEGRATION_SUPABASE_SERVICE_KEY`, same
  never-hits-prod convention as `tests/test_integration_real_postgres.py`).
  Non-local hosts are refused; absent creds print `not-run: no DB` and exit 0.
- **Replay harness** — `tests/evals/test_extraction_replay.py` scores per-field
  accuracy over the frozen set and gates regressions against the committed
  baseline. Live LLM replay is opt-in via `RUN_EXTRACTION_EVAL=1` (the
  `RUN_GENUI_EVAL` pattern).
- **Committed artifacts** — `datasets/extraction-eval-v1.jsonl` (frozen set)
  and `datasets/extraction-eval-v1.baseline.json` (accepted accuracy). Both
  are builder-generated; a test asserts the JSONL is byte-identical to a
  builder re-run, so hand-edits fail CI.

v1 is a **synthetic seed set** built from
`fixtures/extraction_seed_rows.json` through the exact same builder/serializer
path as a SQL snapshot (real email content is never committed — guardrail).
The first real dataset version (v2+) should be snapshotted from the local
seeded stack once confirmed-with-correction volume exists, reviewed for
content, and committed alongside a regenerated baseline.

## The E1-E6 gate ladder

| Gate | What it asserts | Status |
|------|-----------------|--------|
| **E1 — dataset freshness** | The frozen set is structurally valid, self-consistent (meta.record_count, unique ids), stamped with the current `SNAPSHOT_SQL` hash, and byte-reproducible from its source. | **Enforced now** (default pytest run). *Later:* max-age on `meta.generated_at` + minimum record count, once datasets come from real SQL snapshots on a cadence (needs correction volume + CI DB access). |
| **E2 — per-field accuracy** | Per-field accuracy of model output vs human-approved ground truth (`{**extracted, **corrected}`). | **Enforced now, offline**: scores the *frozen* extracted_fields captured at extraction time — no LLM creds needed. *Later:* live replay accuracy floor per field (needs `RUN_EXTRACTION_EVAL=1` + a real dataset version); penalty for hallucinated extra fields. |
| **E3 — regression vs baseline** | Recomputed accuracy must not regress vs `*.baseline.json`; dataset hash must match the baseline's pin; exact-equality sync gate forces intentional changes through `scripts/extraction_eval/update_baseline.py` in a reviewed diff. | **Enforced now** (default pytest run). |
| **E4 — swallow-site coverage** | Every extraction-pipeline failure/swallow site (parse failure, low-confidence drop, superseded chains, …) is represented by ≥1 eval record that exercises it. | **Later**: needs the swallow-site inventory instrumented so sites are enumerable; then the dataset builder tags records by site and this becomes a coverage assertion. |
| **E5 — cost budget** | Live replay cost per record (tokens × model price, via the cost-ledger idiom) stays under budget. | **Later**: needs live replay wired to the cost ledger; runs only under `RUN_EXTRACTION_EVAL=1`, never in the default sweep. |
| **E6 — latency budget** | Live replay p95 per-record extraction latency stays under budget. | **Later**: same harness run as E5. |

Enforced-now gates run in the **default pytest sweep with zero LLM or DB
credentials** — that is the point: the frozen dataset already contains the
model outputs, so accuracy and regression are pure arithmetic.

## Commands

```bash
cd apps/email-listener

# Default sweep (E1/E2/E3 gates included automatically):
uv run pytest tests/evals -q

# Snapshot a new dataset version from the LOCAL stack:
INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321 \
INTEGRATION_SUPABASE_SERVICE_KEY=<service_role key> \
uv run python -m scripts.extraction_eval.build_dataset \
    --dataset-version v2 --output tests/evals/datasets/extraction-eval-v2.jsonl

# Accept a new baseline (reviewed diff!):
uv run python -m scripts.extraction_eval.update_baseline \
    --dataset tests/evals/datasets/extraction-eval-v1.jsonl

# Regenerate the committed v1 seed set (must be byte-identical, tested):
uv run python -m scripts.extraction_eval.build_dataset \
    --from-fixture tests/evals/fixtures/extraction_seed_rows.json \
    --dataset-version v1 --generated-at 2026-07-23T00:00:00+00:00 \
    --output tests/evals/datasets/extraction-eval-v1.jsonl

# Live LLM replay (Bedrock creds required; excluded from default sweep):
RUN_EXTRACTION_EVAL=1 uv run pytest tests/evals/test_extraction_replay.py -m integration --no-cov -q
```

## Other eval suites in this directory

- `test_retrieval_golden_set.py` — EVAL-06 retrieval golden set (fixtures
  shared with `packages/genui/src/eval/` via `_paths.py`).
- `test_research_eval_rubric.py` — RSRCH-05 research-quality rubric
  (`RUN_RESEARCH_EVAL=1` smoke gate).
- `test_injection_*` / `test_web_search_injection_suite.py` — adversarial
  injection suites.
