# ORCHESTRATOR-STATE — grand orchestrator run ledger

> Read by the hourly backstop Routine (trig_01FYyp3Kpfa2vgWBY56N4Gq1) and by any resumed session.
> UPDATE THIS FILE at every batch launch, batch completion, and merge. This file is the single
> source of truth for "where are we"; chat context is disposable.

## Status: RUNNING — Batch 3a (W2 spine, manual-worktree agents) + ST-04 rebuild

Batch 2 DONE 2026-07-23T05:5xZ (9e93f6d pushed): 5/6 lanes merged — evals harness
(E1–E3 enforced), KG-2/3/8 + pipeline-health panel (web), snappiness §1–4 (+
main-loop fixes: 8 neutral loading.tsx, prefetch TTL dedupe), hygiene P0 (stubs
deleted, knip baseline, .gitignore env fix), terraform 5 imports DONE against
live AWS (MAIL_FROM drift found+codified: live=forward@, plan clean after).
ST-04 lane REJECTED by skeptic (stale-base redo of 1R) → rebuilding via agent in
manually-created worktree st04-resynth (fork-from-HEAD, skeptic findings A–H as
hard requirements). Terraform local tfstate could NOT be copied from the lane
worktree (classifier); re-run the 5 idempotent runbook imports in the main tree
before any plan/apply (config now merged).

## Orchestration mode NOTE (learned B1R/B2)
Workflow-tool worktrees fork from dde04bb (repo base), NOT branch HEAD → any
lane touching session-modified files rebuilds stale and conflicts. From Batch 3
on: `git worktree add -b <branch> .claude/worktrees/<name> HEAD` MYSELF, then
parallel Agent-tool agents pointed at those dirs. Verify with skeptic Agent
runs, merge in main loop.

## Batch 3a in flight (agents on manual worktrees, all forked 9e93f6d)
- st04-resynth (ST-04 rebuild, reqs A–H)
- b3-ai01 (canvas.addNode/connect/removeNode capability triple)
- b3-ai02 (capability 4-way projection matrix + enforcement gate)
- b3-ai05 (cross-surface omnibox, search mode)
- b3-en02 (merge-review queue /entities/review)
Batch 3b AFTER st04 merges (listener files free): AI-03 ingest-time resolution,
AI-06 graph-memory chat retrieval, AI-04 send-to-chat/canvas affordances.

Batch 1 DONE: 3 gap docs (c1bf55c) + 4 W0 fixes merged (92c9098), all suites green.
Batch 1R DONE 2026-07-23T04:4xZ (e158449 pushed): ING-6/RES-1/REG-1 repairs merged.
NOTE: worktree agents fork from dde04bb (repo base), NOT branch HEAD — expect
conflicts when agents touch W0/1R files; resolve as SYNTHESIS in main loop (see
e158449 message for the REG-1 pattern: keep re-ingest-first + count-gate, adopt
DB-clock cutoff; supersede lte / count gt; cutoff None ⇒ skip supersede).
Verified on merged tree: listener full suite exit 0 + mypy/ruff/lint-imports
clean; api-client 568/568; db (PGlite) 27/27; web tsc clean; emails/[id] 79/80.
4 OCR corpus failures are pre-existing environmental (Textract deps absent).

- Branch: `claude/polytoken-email-infra-cont-jzz1pg` (all merges land here; NO PR)
- Model policy: fable-5 (verify panels/synthesis) · opus-4.8 (mutations/security, session default) · sonnet-5 (mechanical). Never haiku.
- Trailer for every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01RZuPfFSoRaTp59yqF91AZs`

## Active workflow
- Run ID: `wf_05119d6c-159` (Batch 2 / W1: evals, st04, kg-ui, snappy, hygiene, infra)
- Script: `/tmp/claude-0/-home-user-polytoken-ai/a7169b4b-2d04-50fc-9192-30f267d087bc/scratchpad/batch-2-w1.js`
- Resume (after container death): `Workflow({scriptPath: <above>, resumeFromRunId: "wf_05119d6c-159"})` — NO args, ever.
- Journal: `/root/.claude/projects/-home-user-polytoken-ai/a7169b4b-2d04-50fc-9192-30f267d087bc/subagents/workflows/wf_05119d6c-159/journal.jsonl`
- Prior batches (all cached): `wf_acbedf4e-6ec` (B1), `wf_b93b55e9-cca` (B1R)

## Batch plan (whole program)
| Batch | Contents | Status |
|---|---|---|
| 1 | Gap docs + W0 fixes + 2-skeptic verify | **DONE** (92c9098) |
| 1R | ING-6/RES-1/REG-1 repairs, fable-5 skeptics | **DONE** (e158449) |
| 2 | W1 6 lanes: eval harness, ST-04 health, KG-2/3/8+panel, snappiness exec, hygiene P0, terraform imports+drift. Deferred to 2R/3: cost-opt deliverable, .mcp.json, settings.json handoff | **RUNNING** |
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
