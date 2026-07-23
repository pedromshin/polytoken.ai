# ORCHESTRATOR-STATE — grand orchestrator run ledger

> Read by the hourly backstop Routine (trig_01FYyp3Kpfa2vgWBY56N4Gq1) and by any resumed session.
> UPDATE THIS FILE at every batch launch, batch completion, and merge. This file is the single
> source of truth for "where are we"; chat context is disposable.

## Status: RUNNING — Batch 1R (W0 repairs)

Batch 1 DONE 2026-07-23T03:0xZ: 3 gap docs committed (c1bf55c); 4 W0 fix branches
merged (92c9098) after skeptic review; full listener suite green (91.36% cov),
api-client 22/22, web 5/5; pushed. Skeptics confirmed 3 residual gaps → Batch 1R:
ING-6 attachment surfacing, RES-1 read path (+migration for 0039 RPCs), REG-1
deterministic page ids. The 4 pre-existing OCR corpus failures are environmental
(fail identically on baseline c1bf55c; live-OCR deps absent in container) — not ours.

- Branch: `claude/polytoken-email-infra-cont-jzz1pg` (all merges land here; NO PR)
- Model policy: fable-5 (verify panels/synthesis) · opus-4.8 (mutations/security, session default) · sonnet-5 (mechanical). Never haiku.
- Trailer for every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01RZuPfFSoRaTp59yqF91AZs`

## Active workflow
- Run ID: `wf_b93b55e9-cca` (Batch 1R repairs)
- Script: `/root/.claude/projects/-home-user-polytoken-ai/a7169b4b-2d04-50fc-9192-30f267d087bc/workflows/scripts/batch-1r-repairs-wf_b93b55e9-cca.js`
- Resume (after container death): `Workflow({scriptPath: <above>, resumeFromRunId: "wf_b93b55e9-cca"})` — NO args, ever.
- Journal: `/root/.claude/projects/-home-user-polytoken-ai/a7169b4b-2d04-50fc-9192-30f267d087bc/subagents/workflows/wf_b93b55e9-cca/journal.jsonl`
- Prior batch (all cached): `wf_acbedf4e-6ec`
- Batch 2 script PRE-AUTHORED, launch after 1R merges:
  `Workflow({scriptPath: "/tmp/claude-0/-home-user-polytoken-ai/a7169b4b-2d04-50fc-9192-30f267d087bc/scratchpad/batch-2-w1.js"})`
  (6 lanes: evals, st04, kg-ui, snappy, hygiene, infra — worktree-isolated, fable-5 skeptics)

## Batch plan (whole program)
| Batch | Contents | Status |
|---|---|---|
| 1 | Gap docs (hygiene audit, USER-STORIES, snappiness plan) + W0 fixes (ING-1..6+CVE, RES-1..4, RPR-1/REG-1/3, UI-1..3) + 2-skeptic verify | **RUNNING** |
| 2 | Merge B1 → W1: eval harness E1–E6, ST-04 error surfacing, KG-2/3/8, cost-opt deliverable, snappiness execution, codebase-hygiene mechanical splits, Supabase drift check doc, terraform IMPORT-RUNBOOK (imports only, never apply first), dev tooling (.mcp.json; settings.json handed to Pedro) | pending |
| 3 | W2 AI spine: AI-01..06 (ingest-time resolution, capability 4-way projection, agent canvas mutation, send-to-chat/canvas, omnibox, graph memory) | pending |
| 4 | W3 canvas+viz: CI-01..07, TM-01..03, EN-01→CV-03 spreadsheet wiring, UX-pattern catalog, **+ phase 62 redesign surfaces (gate waived)** | pending |
| 5 | W4 drive+home: DR-01..05, CH-01, TM-04, HM-01/02, OneDrive migration design doc + import tooling, **+ phase 63 research-canvas visuals (gate waived)** | pending |
| 6 | W5 multiuser/teams: workspace/membership/RBAC + sharing | pending |
| 7 | W6 ventures: DX-01 + distributed-inference Phase 0, DX-03 desktop live-cost plan, business execution docs; final sweep + full-program verification + COMPLETE | pending |

## Merge protocol (only the main session does this)
1. Workflow returns `merge_ready` (fix committed in worktree branch + 2/2 skeptics un-refuted).
2. `git merge --no-ff <worktree-branch>` into the feature branch, resolve nothing silently.
3. Run targeted tests again on the merged tree. Commit with trailer. Push with retries.
4. `needs_review` items: main loop inspects diff + verdicts, fixes forward or re-dispatches one repair agent.
5. Update this file; PushNotification at each batch boundary.

## Permissions grant (Pedro, 2026-07-23, this session)
- FULL permission to manage prod/staging/local systems (AWS, Supabase, Vercel, etc.).
- May wipe/reseed prod/staging/local DBs — system is fully under development.
- **Pixel gates 62–63 WAIVED**: build all visual/redesign surfaces at full speed; Pedro verifies manually later. Fold 62–63 work into Batches 4–5.
- Safety envelope (self-imposed, always): backup before anything irreversible; nothing cost-compounding (no fleet spin-ups, no bulk storage migrations, no deleting sole copies); account-level settings (billing, domains, auth providers) untouched.

## Hard gates (still parked — classifier sits above user grants)
- Classifier blocks regardless of permission: prod-DB psql connections, email CONTENT / S3 email objects, Lambda env vars, self-authored settings.json permissions → hand to Pedro.
- External: AWS SES prod-access approval; kaszek-os-dev repo (needs add_repo).

## Completion criterion
All 7 batches merged+pushed, per-wave manual runsheets written, final COMPLETE notification sent,
THEN delete trig_01FYyp3Kpfa2vgWBY56N4Gq1 and write `## Status: COMPLETE` here.
