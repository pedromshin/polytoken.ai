---
phase: 46-kickoff-hygiene-v1-8-brand-design-dossier
plan: 01
subsystem: genui-eval-harness, code-island-sandbox
tags: [evidence, connected-env, bedrock, playwright, vitest, eval-harness, honesty]

# Dependency graph
requires: []
provides:
  - "46-EVIDENCE.md — honest connected-env verification evidence for backlog 999.3 (HYGN-01)"
  - "Live-Bedrock proof the genui eval harness runs end-to-end via existing IAM transport"
  - "Discovered defect: run_eval.py per-prompt error path crashes on Windows (cp1252) instead of degrading gracefully on RateLimitError"
  - "DEF-17-05-01/18-03-01/19-01/20-01 each carry an explicit, evidence-backed disposition"
affects: [v1.8 kickoff readiness (dossier consumes this as a validated-substrate signal), any future connected-env eval-harness run on Windows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PYTHONIOENCODING=utf-8 workaround for structlog exc_info logging under Windows cp1252 console"
    - "Bounded --limit N fallback + paired --no-judge/--judge compare_reports delta as the honest-evidence pattern when a full corpus run is rate-limited"

key-files:
  created:
    - .planning/phases/46-kickoff-hygiene-v1-8-brand-design-dossier/46-EVIDENCE.md
    - apps/email-listener/scripts/genui_eval/reports/20260709T231511Z-smoke.json
    - apps/email-listener/scripts/genui_eval/reports/20260709T231511Z-smoke.md
    - apps/email-listener/scripts/genui_eval/reports/20260709T231753Z-baseline.json
    - apps/email-listener/scripts/genui_eval/reports/20260709T231753Z-baseline.md
    - apps/email-listener/scripts/genui_eval/reports/20260709T231930Z-baseline-nojudge.json
    - apps/email-listener/scripts/genui_eval/reports/20260709T231930Z-baseline-nojudge.md
  modified: []

key-decisions:
  - "Full 34-prompt baseline run genuinely 429'd under the harness's hardcoded Semaphore(3) concurrency cap, then crashed entirely (not per-prompt) because run_eval.py's own exception-logging call throws UnicodeEncodeError on the Windows cp1252 console — recorded as a discovered defect in 46-EVIDENCE.md rather than silently patched (run_eval.py is outside this plan's files_modified and this is an evidence-only plan)"
  - "Used the plan's own prescribed fallback (--limit 5 bounded run) with PYTHONIOENCODING=utf-8 to get past the encoding crash and record real numbers, rather than declaring the whole strand blocked"
  - "DEF-18-03-01 and DEF-19-01 marked 'blocked (partial)' rather than 'pass' — the bounded 5-prompt sample proved the harness mechanism works but did not specifically cover the Phase-18 catalog-expansion component types or the sole Form/Multi-step golden-set prompt (id 25) those items originally called for; recorded the golden-set category breakdown to make the coverage gap explicit and auditable"
  - "DEF-17-05-01 (--all-packs / brand-judge run) marked 'blocked' without attempting it — 6x the load of a run that already hit Bedrock 429s at 1x, judged not worth risking a repeat of the encoding-crash failure mode for marginal evidence value"
  - "Did not kill the pre-existing stale uvicorn dev-server processes (PIDs 46592/56172/57824) before running the harness — run_eval.py drives GenerateUiSpecUseCase directly via create_container(), never over HTTP, so those processes are not on this strand's call path; verified via the generated report files, not terminal output"
  - "Removed a stray apps/email-listener/nul file created by an incompatible `chcp >nul` redirect attempt (bash on this host has no chcp) before staging — not committed"

patterns-established: []

requirements-completed: [HYGN-01]

# Metrics
duration: ~25min
completed: 2026-07-09
---

# Phase 46 Plan 01: Kickoff Hygiene — Connected-Env Verification Evidence Summary

**Live-Bedrock proof the genui eval harness works end-to-end (real IAM transport, real judge scoring), captured honestly around a genuine Bedrock rate-limit + a newly-discovered Windows encoding crash in the harness's own error path; code-island isolation recorded as blocked-by-concurrency-lock with the deterministic 39/39 AST-allowlist vitest suite run as the locally-feasible substitute.**

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Eval harness live-Bedrock evidence (HYGN-01) | f5efc31 | 46-EVIDENCE.md, 6 report files |
| 2 | Code-island isolation disposition (DEF-20-01) | 5966bd6 | 46-EVIDENCE.md |

## What Was Built

**Task 1 — Eval harness evidence:**

- Smoke test (`--limit 1 --no-judge`): 1/1 passed, confirmed live Bedrock reachability via the
  existing ECS-role-equivalent IAM transport (`botocore` resolved shared credentials, real
  `bedrock-runtime` `InvokeModel` 200s).
- Full 34-prompt baseline (`--label baseline`): **blocked**. Hit real `429 Too Many Requests` under
  the harness's hardcoded `Semaphore(3)`, then the per-prompt exception handler itself crashed with
  `UnicodeEncodeError` trying to log the traceback on the Windows `cp1252` console — a genuine,
  previously-undiscovered defect that defeats the harness's documented "one prompt failure does not
  abort the run" contract. Logged as a discovered defect in 46-EVIDENCE.md; not fixed (out of scope
  for an evidence-only plan touching only `46-EVIDENCE.md` + report artifacts).
- Bounded fallback (`--limit 5`, `PYTHONIOENCODING=utf-8`): **passed**, 5/5 completed with live
  judge scoring — `mean_overall=0.9495`, `mean_valid_spec=1.0`, `mean_composed=1.0`,
  `mean_on_intent=0.798`, `mean_a11y=1.0`; registry_version and both model ids recorded verbatim.
- Paired `--no-judge` pass over the identical 5 prompts + `compare_reports` delta table, giving a
  same-corpus baseline/candidate comparison (on-intent judge contribution isolated: -0.05 overall
  delta driven entirely by the judge term, not a real regression).
- Golden-set category breakdown computed (11 categories, 34 prompts) to make explicit which DEF
  items the 5-prompt sample does and does not cover.
- Per-DEF dispositions: DEF-17-05-01 `blocked` (--all-packs not attempted — 6x load risk after
  observed 429s), DEF-18-03-01 `blocked (partial)`, DEF-19-01 `blocked (partial)` (golden set's
  sole Form/Multi-step prompt not in-sample).

**Task 2 — Code-island isolation disposition:**

- Confirmed `@playwright/test` genuinely absent from both `node_modules/@playwright` and
  `apps/web/node_modules/@playwright`, and absent from both `package.json` files.
- Recorded both configured engines (chromium, firefox from `apps/web/playwright.config.ts`) and the
  exact concurrency-lock reason: installing Playwright mutates root `package.json`/
  `package-lock.json`, forbidden while the Phase 43 track owns that surface in this same checkout.
- DEF-20-01 recorded `blocked (browser toolchain uninstallable under the Phase-46 concurrency
  constraint)` — not `pass`, not silently skipped.
- Ran the deterministic substitute the spec's own header names as primary: `npx vitest run
  src/sandbox/validate-island-code.test.ts` from `packages/genui` → **39/39 passed** (verbatim;
  noted the spec header's stale "24 vitest cases" comment no longer matches the actual file).
- Verified `git status --porcelain package.json package-lock.json` empty both before and after —
  zero dependency installs performed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Eval harness live-Bedrock evidence** — `f5efc31` (docs)
2. **Task 2: Code-island isolation disposition** — `5966bd6` (docs)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `.planning/phases/46-kickoff-hygiene-v1-8-brand-design-dossier/46-EVIDENCE.md` — both HYGN-01
  sections (eval harness + code-island isolation), 249 lines, all 4 DEF items dispositioned
- `apps/email-listener/scripts/genui_eval/reports/20260709T231511Z-smoke.{json,md}` — connectivity
  smoke test
- `apps/email-listener/scripts/genui_eval/reports/20260709T231753Z-baseline.{json,md}` — the
  recorded bounded baseline (live judge, 5 prompts)
- `apps/email-listener/scripts/genui_eval/reports/20260709T231930Z-baseline-nojudge.{json,md}` —
  deterministic pass over the same 5 prompts, for the compare_reports delta

## Decisions Made

See `key-decisions` in frontmatter — summarized: honest bounded-run fallback per the plan's own
prescribed pattern rather than declaring the whole strand blocked; discovered defect logged, not
silently patched (out of scope); `--all-packs` explicitly not attempted given observed rate-limit
risk; partial-coverage DEF items marked `blocked (partial)` rather than inflated to `pass`.

## Deviations from Plan

### Auto-fixed Issues

None requiring code changes — this is an evidence-only plan and no source files were modified.

### Notable non-fixes (documented, not auto-fixed per scope boundary)

**1. [Discovered, not fixed] `run_eval.py` per-prompt exception logging crashes on Windows console encoding**
- **Found during:** Task 1, full 34-prompt baseline attempt
- **Issue:** After a Bedrock `RateLimitError`, the per-prompt `except` block's own
  `logger.error(..., exc_info=True)` call raises `UnicodeEncodeError` on Windows `cp1252`,
  escaping the per-prompt guard and aborting the entire `asyncio.gather` — defeating the
  documented "one prompt failure does not abort the run" design contract.
- **Why not fixed:** `run_eval.py` is not in this plan's `files_modified` (`46-EVIDENCE.md` +
  `scripts/genui_eval/reports/` only); this is an evidence-recording plan, not a bug-fix plan.
  Fixing it would be legitimate future work (candidate: set `PYTHONIOENCODING=utf-8` at harness
  entry, or pass `ensure_ascii`-safe formatting into the structlog call).
- **Files that would need modification (not touched):** `apps/email-listener/scripts/genui_eval/run_eval.py`
- **Workaround used:** `PYTHONIOENCODING=utf-8` env var on the bounded fallback run, which
  succeeded cleanly (5/5, zero errors) without exercising the crash path at all.

## Known Stubs

None — this plan produces an evidence document and eval-harness report artifacts, no application
code or UI.

## Threat Flags

None — no new network endpoints, auth paths, file-access patterns, or schema changes. The eval
harness itself makes no writes to production; report files are generated artifacts under a
`.gitkeep`'d directory (per the plan's own threat register, T-46-01-02 `accept`). Redaction
verified: `grep -nE "AWS_|SECRET|KEY=" 46-EVIDENCE.md` returns no matches.

## Self-Check: PASSED

- [x] `.planning/phases/46-kickoff-hygiene-v1-8-brand-design-dossier/46-EVIDENCE.md` exists (249 lines)
- [x] Contains `## HYGN-01 — Eval harness (999.3)` and `## HYGN-01 — Code-island isolation (999.3, DEF-20-01)`
- [x] `DEF-17-05-01`, `DEF-18-03-01`, `DEF-19-01`, `DEF-20-01` each have an explicit disposition line
- [x] `apps/email-listener/scripts/genui_eval/reports/20260709T231753Z-baseline.json` exists (5/5 completed, real judge scores)
- [x] Commit f5efc31 exists in git log
- [x] Commit 5966bd6 exists in git log
- [x] `git status --porcelain package.json package-lock.json` empty (zero dependency installs)
- [x] `grep -nE "AWS_|SECRET|KEY=" 46-EVIDENCE.md` returns no matches
- [x] `npx vitest run src/sandbox/validate-island-code.test.ts` — 39/39 passed (verified during execution)

## Next Phase Readiness

- HYGN-01 satisfied: the locally-feasible 999.3 evidence exists with honest per-DEF dispositions —
  none inflated to `pass` where the underlying command wasn't actually run against the specific
  scope each DEF originally called for.
- The concurrent Phase 43 track's in-flight changes (`.planning/HANDOFF.json`, `.planning/STATE.md`,
  `infrastructure/aws/ecs.tf`, root PDFs, `apps/web/src/app/dev/design/`, `graphify-out/`,
  `links.md`, `COWORK-BRIEFING.md`, the `nauta-design-system` → `polytoken-design-system` skill
  rename) were left untouched throughout, per this plan's concurrency constraints.
- Remaining honest gaps for a future connected-env pass (not blockers for v1.8 dossier kickoff):
  the `run_eval.py` Windows-encoding defect, DEF-17-05-01's `--all-packs` run, DEF-18-03-01/19-01's
  specific corpus-subset coverage, and DEF-20-01's actual cross-browser Playwright execution once
  the Phase 43 concurrency lock on root `package.json` clears.

---
*Phase: 46-kickoff-hygiene-v1-8-brand-design-dossier*
*Completed: 2026-07-09*
