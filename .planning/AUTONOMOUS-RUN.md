# AUTONOMOUS OVERNIGHT RUN — 2026-07-27 · session_01NhVUcfpAuwy4YBkvme7dUp

> Pedro: "continue autonomously for the next 6 hours … don't prompt me, I'll be sleeping …
> go as far as you can with everything ahead and in GSD … keep yourself alive every 5 min."
> Started **07:58 UTC**, target end **~14:00 UTC**. THIS FILE + `ORCHESTRATOR-STATE.md` are the
> durable memory — a fresh wakeup/compaction reads them and continues. Branch:
> `claude/phase-76-summon-loop-al5emg` (PR #10 already MERGED to main; treat new work as fresh
> commits on this main-based branch).

## HARD SAFETY LINES (never cross, even under "full permissions")
- NO `terraform apply` (no remote state → recreates/drops live SES rules = mail outage).
- NO prod DB migrations (MIGRATE-PROD needs the 3 absent PROD_* secrets; can't run).
- NO AWS/cloud provisioning (cost + touches the live account + security).
- NO routing around the auto-mode classifier; NO live keys; NO SES/nauta/magnitude edits.
- Do NOT prompt Pedro (asleep). No AskUserQuestion. Decide and proceed.

## DEPLOY POLICY (overnight)
- Build ONLY additive / flag-gated changes (byte-identical when the flag is OFF / path unused).
- Every CI-gateable gate GREEN before commit (web/api-client/db/mcp-server vitest+tsc+design-law;
  listener ruff/format/lint-imports/mypy/pytest). No red commits.
- Push to the branch continuously. Keep ONE PR open + green.
- Merge→deploy is allowed for CI-green ADDITIVE work; listener changes only if flag-gated DEFAULT-OFF
  (behavioral no-op in prod). When in doubt, leave it PR-only for Pedro and note it.
- Browser/visual verification is NOT achievable here (no Supabase/auth, no .env.local) — every visible
  surface still owes Pedro's real-browser pass; never claim visual-done.

## KEEPALIVE
- Hourly self-bind Routine (created via create_trigger) = crash/phone-death backstop.
- During active work, background tasks (Workflows/gates/waits) keep re-invoking me; when genuinely idle
  with queue remaining, arm a send_later ~5 min out. Always leave something pending. Delete the backstop
  Routine + stop at ~14:00 UTC (or when the queue is exhausted).

## WORK QUEUE (prioritized; all safe/additive/CI-gateable)
Legend: [ ] todo · [~] in progress · [x] done+pushed · [M] merged to main

- [x] **W1. ci-web-and-packages.yml** — DONE. TS CI gate: tsc + vitest for all 9 TS workspaces
      (db/api-client/billing/capabilities/genui/ui/web/worker/mcp-server) + drizzle-kit check,
      path-filtered, SKIP_ENV_VALIDATION=1. daemon excluded (known-red suite, Track 2). Validated all
      9 green locally first (genui 645, web+design-law, api-client 33, mcp-server 32, billing 30,
      capabilities 65, ui 49, worker 7, db). Pushed.
- [x] **W2. Discoverability wiring** — DONE (tables panel). Home-board 'Recent tables' BoardPanel →
      /spreadsheets. Workspaces entry link still small-pending. — home-board "Recent tables" BoardPanel → /spreadsheets, and a
      /workspaces entry point (mount the built WorkspaceSwitcher / a link). Completes round-3 visibility.
- [ ] **W3. code_islands provenance upsert** (round-3 G-LOW) — codeIslands.create upsert keyed on
      (conversationId, messageId, partIndex) so the agent path can't re-mint a row on remount/reload.
      Small migration + router change + test.
- [ ] **W4. Workspace member user-search** — a protected search endpoint so members are added by
      name/email instead of a raw UUID; wire into the members panel.
- [x] **W5. Canvas sources mid-session invalidation** — DONE. ChatCanvasIsland invalidates
      chat.listSources whenever historyRows grows (turn boundary), so auto-collected sources land on
      the canvas as a turn ends, not only on remount. tsc + 1369 canvas/design-law tests green. (earlier dark seam) — invalidate chat.listSources
      on new-source events so sources land instantly, not only on remount.
- [ ] **W6. Real-Postgres tenant-isolation CI job** (master-plan Track 2) — ephemeral-Postgres job that
      applies all migrations from scratch + runs the isolation suite. THIS is the prerequisite that
      unblocks the deferred workspace-sharing hazard. Higher effort.
- [ ] **W7. Phase 75 SERVER cascade** — correction_propagations ledger migration → CascadeCorrectionUseCase
      → wire into ConfirmMergeUseCase (best-effort) → worker re-label. Flag-gated; touches listener merge
      path (default-OFF → PR-only unless clearly no-op). FULL pytest.
- [ ] **W8. Phase 77 Wave C** — expose polytoken.addCanvasNode as a WRITE tool behind a SEPARATE
      default-OFF POLYTOKEN_MCP_WRITE_ENABLED flag (73 connect/recipes substrate now exists).
- [ ] **W9. container.py split** (master-plan Track 2) — split the 1433-line DI god-file into
      container/providers/{ingest,chat,entities,genui,infra}.py. Declarative DI, behavior-risk ~0. Big.

## PROGRESS LOG (newest first)
- ~10:27 UTC — W1 (TS CI), W2 (tables panel), W5 (source invalidation) shipped+pushed. Daemon suite
  greening assessed = rabbit hole (non-hermetic realpath/junction, 12 fails) — left excluded from CI.
- 07:58 UTC — run started; env assessed (Docker yes; Supabase/auth NO → browser sim infeasible);
  plan + keepalive being set up.
