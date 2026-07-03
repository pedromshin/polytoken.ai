---
status: partial
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
source: [16-VERIFICATION.md]
started: 2026-06-27T22:00:00.000Z
updated: 2026-06-27T22:00:00.000Z
---

## Current Test

[awaiting human testing — requires a connected environment the autonomous run intentionally excludes]

## Tests

### 1. Record the eval baseline against live Bedrock (16-02, Task 4)
expected: `cd apps/email-listener && uv run python -m scripts.genui_eval.run_eval --label baseline` (with live AWS IAM + Supabase) drives the real generate pipeline over the golden-set, scores via the LLM judge, and writes + commits a baseline report under `scripts/genui_eval/reports/`. The deterministic offline harness is already proven (rubric/report/compare/runner unit-tested); only the live-credential run is outstanding.
result: [pending]

### 2. Browser-verify the Page-Ideas tab (16-04, Task 4)
expected: `cd apps/web && npm run dev` → http://localhost:3000/studio → Page Ideas tab. Confirm: filters over the 76-entry corpus, weighted "Surprise me" (curveball 3× / Tier-B 2× / Tier-A 1×), and fill-and-switch into the Sandbox seeds the intent textarea WITHOUT auto-generating (D-06 manual-only constraint).
result: [pending]

### 3. Browser-verify the History tab (16-05, Task 3)
expected: with seeded `ui_spec_templates` rows + the FastAPI backend running → /studio → History tab. Confirm: newest-first paginated list, pager, row-click opens the read-only 55/45 shared-renderer detail (no Generate button), and the safe-fallback degrade renders for an unparseable stored spec instead of throwing.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
