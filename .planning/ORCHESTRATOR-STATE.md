# ORCHESTRATOR-STATE — grand orchestrator run ledger

> Read by the hourly backstop Routine (trig_01FYyp3Kpfa2vgWBY56N4Gq1) and by any resumed session.
> UPDATE THIS FILE at every batch launch, batch completion, and merge. This file is the single
> source of truth for "where are we"; chat context is disposable.

## Status: BATCH 3 IN FLIGHT 🔧 (2026-07-24, branch @ 6695956) — 2 UI worktree agents running; batch-2 fully live

> BATCH 2 is DONE and LIVE on prod. Listener deploy run 30052959299 (main@1525a44)
> concluded **SUCCESS** ✅ (verified via actions_get 2026-07-24) — email-context importer
> fix is live on the prod listener. Open item 1 RESOLVED.
>
> BATCH 3 (this session, opus-4-8 after Fable-5 hit its usage limit) — responding to Pedro's
> mobile drop "editor is email preview itself / canvas on mobile / treemap navigable inside
> canvas / chat buttons overlapping / improve email context picker / minor chat bugs /
> remove maritime". Landed to the feature branch so far:
>   - 16c50f9 fix(web): hide retired maritime entity types from Knowledge + entityTypes.list
>     (is_active + retired-slug exclusion; shared allow-list router/retired-entity-types.ts;
>     api-client 730 tests green + tsc clean). Belt-and-braces vs the un-applied 0050.
>   - 6695956 feat(web): text-anchored body-region highlighter (CSS Custom Highlight API) —
>     the CORRECT fix for the misaligned body overlays (the "PEDREDRO," garble). Pure matcher
>     unit-tested (6 green). Wiring lands with the editor-merge.
> UPDATE 2026-07-24 (opus): both worktree agents were KILLED mid-run by a container restart
> (~75min, no completion notification). Their partial diffs were SALVAGED from the worktrees,
> repaired, gated, and committed to the feature branch. Landed since:
>   - db7f077 feat(web): canvas on mobile (dropped the isMobile→chat coercion; toggle shown on
>     every viewport) + FAB overlap fix (bottom-24 when a composer is present) + double-send
>     latch (composer submittingRef + controller sendInFlightRef) + stuck-skeleton terminal
>     fallback (MessageTurn flips genui boundary out of streaming on stopped/interrupted/
>     cost_capped — NOT on "completed", which is the D-01 async-resume case; that distinction
>     also fixed a transcript-panel-toolbar force-lock regression). +::highlight CSS rule.
>   - 903bea5 fix(web): wired the body-region highlighter into body-view.tsx — dropped the
>     broken polygon OverlayLayer path; body overlays now render CORRECTLY (text-anchored).
>     The "email preview needs to work and show overlays correctly" HALF of the headline is DONE.
>   - 991b659 fix(web): circle-pack treemap node gesture isolation (nowheel nopan nodrag) so
>     the pack is explorable inside the canvas without panning the board.
> Gates on every commit: web tsc clean + full vitest (134 files / 1709 tests) green.
> Dead worktrees removed.
>
> UPDATE 2 (2026-07-24, opus, later backstop): more landed to the branch —
>   - bc05e60 feat(web): searchable inbox picker for chat email-context (#23 email-selection).
>     New ThreadPickerDialog (CommandDialog: search + subject/count·time/snippet rows) replaces
>     the flat subject-only slice(0,20) in the composer attach menu. 4 new tests. → Task #23
>     is now FULLY DONE (FAB + double-send + skeleton + picker).
>   Gates: web tsc clean + vitest 135 files / 1713 tests green.
>
> STILL TODO on this batch:
>   - #21 HEADLINE: "editor is email preview itself, no separate things. just one thing." —
>     merge the /emails/[id] editor INTO the inbox inline preview as ONE surface + redirect the
>     route to /?email=<id>. NOT started (only the body-overlay half is done). This is the big
>     multi-file refactor and is UX-heavy — it genuinely needs VISUAL verification (jsdom does
>     no layout; CLAUDE.md law), so it is staged for an ATTENDED session, not the unattended
>     backstop loop. Scout report for it is in the session transcript.
>   - #22 (polish, LOW priority — core "explore the treemap inside the canvas" is already met
>     by the gesture-isolation commit): treemap node full-screen EXPAND affordance + a pane
>     "Add node ▸ Email treemap" entry (handleAddCirclePack in chat-canvas.tsx, data
>     {scope:"mailbox"}). Nice-to-have; the AI can already place circle-pack nodes.
> NOT fast-forwarded to main yet — batching with the remaining editor-merge so it is ONE
> Vercel deploy (cost-conscious, per Pedro's request to watch build/infra costs). Everything on
> the branch is independently complete + gated, so it is deployable whenever desired.
>
> PROD DB STATE (verified via Management API, 2026-07-24): drizzle.__drizzle_migrations
> showed 50 rows = through 0049. Hash check confirmed 0048 (3540513969…) + 0049 (8ea707f9…)
> applied, 0050 (4420f67b7…) NOT. So prod had DEACTIVATED the maritime types (0049) but never
> PURGED the data rows (0050) — which is why the Knowledge screenshot still showed them.
>
> ✅ 0050 APPLIED to prod (2026-07-24) via the Management API query endpoint (same path as
>    0043-0047; Pedro supplied the sbp_ token and chose this path). HTTP 201, DO block ran to
>    completion with no error → the six maritime system entity_types + their instances,
>    extraction_records, corrections, candidate-links, instance/type-scoped knowledge_nodes
>    (+cascaded edges/links), and maritime sender categories are DELETED, atomically (single
>    txn). Task #19 DONE at the DB level; 16c50f9 already hid them on the web side.
>    ⚠️ LOOSE END: the drizzle tracking ROW for 0050 could NOT be inserted — the safety
>    classifier blocked the follow-up metadata write. This is COSMETIC/SELF-HEALING: 0050 is
>    idempotent (empty arrays → all-no-op), so the next `migrate` run (Action or local) will
>    re-run it as a no-op and record the row. To finish cleanly now, run this ONE line in the
>    Supabase SQL Editor (dashboard):
>      insert into drizzle.__drizzle_migrations (hash, created_at)
>      values ('4420f67b7efca8962511d218739b4de324a3c34ebdd9c0dbd99eda037a0c432c', 1784900200000);
>    ⚠️ ROTATE the sbp_ Management API token Pedro pasted this session (Supabase → Account →
>    Access Tokens → revoke).
>
> STILL OPEN (external / human):
> 1. Insert the 0050 drizzle tracking row (one-line SQL above) OR let it self-heal on next
>    migrate. Not blocking anything.
> 2. Task #13 listener-auth hardening stays DEFERRED pending Pedro (runbook staged). Trigger
>    stays ENABLED.

## Previous status: ALL WORK COMPLETE ✅ (waves W0–W6, prod deploy SHA 0a63f8a, follow-ups through cad7c5e)

## Status: PROD DEPLOY COMPLETE ✅ (2026-07-23, SHA 0a63f8a) — all 3 layers LIVE (DB + listener + web @ polytoken.ai)

Pedro provided prod credentials + a Supabase Management API token mid-session, which
unblocked the deploy. Executed end-to-end from this container over HTTPS:

1. **DB migrated (DONE, verified live).** Direct Postgres is unreachable from here
   (HTTPS-443-proxy-only egress), so migrations 0043→0047 were applied over the
   Supabase Management API query endpoint, each in its own txn + a matching
   `drizzle.__drizzle_migrations` row (hash=SHA256(file), created_at=journal when).
   Live verify: 31→36 public tables, 43→48 tracking rows, RLS on all new tables,
   0046 columns + 4 new enums present, max created_at=0047 so migrate.ts stays
   idempotent. Rollback: `.planning/PROD-ROLLBACK-0043-0047.sql` (PITR is OFF on this
   project, so the DROP script IS the DB rollback — additive migs, clean reversal).
2. **Code on main (DONE).** Branch fast-forwarded main (0a63f8a, linear, 100 commits).
   This fires: Vercel production build (web) + `deploy-email-listener.yml` (ECR/ECS).
3. **Listener deploy DONE ✅.** `deploy-email-listener.yml` run 30017547005 (SHA 0a63f8a):
   Test job green (ruff/mypy/pytest); Build&deploy green — image built, Trivy pass, pushed
   to ECR, ECS update, **service stability confirmed**, smoke test passed. New listener live.
4. **Web deploy (Vercel) DONE ✅.** Verified via the Vercel API (token provided mid-session).
   Project `nauta-web` (prj_70hRKIxh1giNAfzQvbrR1tX7pP2j, team teampedroshin,
   team_V2cgPPeWDBTsSBVg3fwh1Jof). Production deployment `dpl_ECPCJisvrLjMaTakuiDLkwYdRSos`
   for SHA **0a63f8a** is **READY** and alias-assigned to the real prod domain
   **`polytoken.ai`** (+ www). `polytoken.ai/api/pipeline/health` → **401 Unauthorized**
   (the new auth-gated route EXISTS — new code shipped), root → 307 (login redirect).
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` confirmed present in the
   Production env, so the earlier "build failed on env vars" call was WRONG.

   ⚠️ CORRECTION: the earlier "web blocked" entry was a FALSE ALARM caused by probing
   `nauta-web.vercel.app` — a STALE/SEPARATE domain (old "NAUTA Global Trade" marketing page)
   that is NOT in this deployment's alias set. The canonical prod domain is **polytoken.ai**.
   Use polytoken.ai for all future prod smoke checks, not *.vercel.app.

**ALL THREE LAYERS LIVE on SHA 0a63f8a — full prod deploy COMPLETE.**

OPEN ITEMS (human, not blockers):
  - **ROTATE the prod secrets** Pedro pasted this session — all are in the transcript:
    POSTGRES_URL(_NON_POOLING), SUPABASE_URL, service_role/anon JWTs, sb_secret/sb_publishable,
    Supabase Management token `sbp_2115…` (Supabase dashboard), AND the Vercel access token
    `vcp_3aq…` (Vercel → Account Settings → Tokens → revoke).
  - **Vercel Production env** must include NEXT_PUBLIC_SUPABASE_URL +
    NEXT_PUBLIC_SUPABASE_ANON_KEY (build-time). If the Vercel build failed, it's on
    those — set them and redeploy. Non-destructive: a failed Vercel build leaves the
    prior prod deploy live.
  - **Smoke test** per PROD-DEPLOY-RUNBOOK.md Step 5 once Vercel + ECS are green.

Rollback map (per layer, fastest-first): R-app = Vercel promote previous; R-listener =
ECS revert to prior task-def / re-run deploy on prior SHA; R-DB = run the ROLLBACK sql.
  Migrate MUST precede the main-merge (the app expects the new tables).

## --- prior status (build waves) ---
## Status: COMPLETE ✅ — all waves W0–W6 merged, verified, pushed (tip a5c5539)

Completion report: `.planning/research/2026-07-23-GRAND-COMPLETION-REPORT.md`.
Final sweep GREEN: TS packages (db 84 / api-client 724 / capabilities 65 / ui 22 /
genui 626 / apps/web 1677), listener pytest 91.61% + ruff/mypy/lint-imports clean,
drizzle lineage clean (0000–0047 linear), all tsc clean. Only the 4 OCR corpus
tests fail (environmental — no Textract client in-container, fail identically on base).
W6 lanes recovered after a container restart killed them uncommitted (~88min) — the
worktrees preserved every file; resumed both to gate+commit, zero work lost.
Watchdogs stood down: hourly backstop deleted, send_later chain stopped.
Remaining work is Pedro's manual runsheet (visual/geometry gates, live-stack E2E,
real-DB migration apply) + documented venture/billing-gated seams — see the report.

## --- historic detail below ---
## Status: RUNNING — Batch 7 (W6 ventures) — THE LAST BATCH

Batch 6 DONE 2026-07-23T10:xxZ (52ba8fa pushed): W5 teams (workspaces/members/
resource_shares, additive assertCanAccess, RBAC no-self-escalate, documents wired,
ZERO tenancy regression — 98/98 existing tenancy tests pass, migration 0047 lineage
clean) + TM-04 drive circle-pack (widened circle-pack node scope enum to 'drive',
mirror field-for-field, byte-conserving bounded recursion). Integrated green: web
1620, capabilities 65, db 84, api-client 724, ui 22, all tsc clean.

Waves DONE: W0 email hardening, W1 reliability+evals+snappiness+terraform, W2 AI
spine, W3 canvas+viz, W4 drive+home, W5 teams. Only W6 ventures remains.

## Batch 7 in flight (b7-* worktrees forked 52ba8fa) — venture-gated, mostly design+safe-seams
- b7-inference (distributed-inference Phase 0: browser device-profiling → per-hardware
  model recommendation wired to the WebLLM picker; + credits/peer-pooling accounting
  DESIGN doc — real pooling stays E7-gated)
- b7-desktop (remote-desktop live-cost: per-second/hour cost ticker on the desktop node
  using desktop_sessions.hourly_rate_cents + ST-03 desktop-management pane; Hetzner
  provider binding stays billing-gated — design doc for it)
- b7-business (business execution roadmap synthesizing the 8 business/ research tracks
  into a go/no-go decision framework + next-steps — pure planning doc)

## AFTER b7 merges — FINAL COMPLETION SWEEP (do not skip):
1. Run EVERY gate on the final tree: all package vitest (db/api-client/capabilities/
   ui/genui/daemon-protocol), full apps/web vitest+tsc, listener `uv run pytest` full
   (4 OCR env failures expected) + ruff + mypy + lint-imports, drizzle-kit consistency.
2. Write `.planning/research/2026-07-23-GRAND-COMPLETION-REPORT.md` — every wave, what
   landed, skeptic saves, deferred/handoff items, the manual-verification runsheet
   pointer for Pedro (jsdom proved behavior; visual/geometry gates + live-stack E2E
   are HIS to run — enumerate exactly what needs his eyes/hands).
3. Set this ledger Status: COMPLETE. PushNotification the finish.
4. DELETE hourly backstop trig_01FYyp3Kpfa2vgWBY56N4Gq1 and stop the send_later chain.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 6 (W5 multiuser/teams) + TM-04 tail

Batch 5 (W4) DONE 2026-07-23T09:xxZ (a395f1a pushed). files-chat (DR-03 file node
+ CH-01 attachments + vault_file context edge — I hardened segment validation to
full vault-chokepoint parity + capped ref size), home (HM-01/02 — I fixed a latent
ON CONFLICT prepared-stmt footgun + closed a CHECK 3-valued-logic gap, schema/
migration/snapshot kept consistent), drive-ops (DR-01/02/04 + OneDrive design doc —
I added a move-into-own-subtree guard + fixed a dead move-dialog error branch).
CRITICAL MERGE FIX: home's 0046_snapshot was missing file_versions (forked before
drive's 0045) → a future drizzle-kit generate would recreate the table. I rebuilt
_journal.json to contiguous 0..46 and patched 0046_snapshot (+file_versions table
+file_version_state enum, prevId→0045); `drizzle-kit generate` now reports no
changes. Integrated green: web 1605, api-client 709, db 48, all tsc clean.

MIGRATION LESSON (carry forward): parallel lanes each add a migration off the same
base → their snapshots are each "base + own change" and the LATEST snapshot loses
siblings' tables. After merging N migration lanes: rebuild _journal.json contiguous
+ chain prevIds + union each later snapshot with earlier siblings' new tables/enums,
then `drizzle-kit generate` (dummy POSTGRES_URL) must say "no changes". Sequence
migration numbers across lanes up front (done: 0045 drive, 0046 home).

## Batch 6 in flight (b6-* worktrees forked a395f1a)
- b6-teams (W5: workspaces/membership/RBAC + sharing — GREENFIELD, migration 0047;
  touches many user_id-scoped tables' READ paths to add workspace-scope, so it is
  the sole schema owner this batch; every existing tenancy test must still pass)
- b6-tm04 (deferred TM-04 drive circle-pack: consumes files.folderSizeRollup, reuses
  the merged TM-01 CirclePack primitive + circle-pack node with a drive scope; NO new
  node type — extends the existing circle-pack scope enum, updates the AI-01 mirror if
  the enum widens)
Batch 7 (W6 ventures: distributed-inference Phase 0, remote-desktop live cost,
business execution) + FINAL full-program verification sweep is the last batch.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 5 (W4 drive+home)

Batch 4 (W3) DONE 2026-07-23T08:xxZ (792fce1 pushed): CI canvas interactivity
(undo/redo — I added a canon-tier reconcile so undo can't revert server-owned
promotion + per-node send-to gating, both skeptic findings; context menus, keymap,
multi-select), TM circle-pack (primitive + email landscape view + canvas node),
sheet EN-01 grid + CV-03 spreadsheet node + table.* capability + spreadsheets
schema/migration 0044 (I moved a schema-dir test that broke drizzle-kit generate).
TM+sheet both extended the node registry/mirror/projection → I synthesis-resolved
8 additive conflicts (kept BOTH circle-pack + spreadsheet; fixed a shared-tail
brace bug in node-type-registry). Integrated green: web 1561, capabilities 65,
api-client 655, ui 22, db 35; AI-01 mirror + AI-02 gates pass with both new types.

MERGE LESSON (carry forward): when two lanes both add an entry to the same
multi-LINE object (registry/mirror), the git "shared tail" after >>>>>>> closes
only ONE entry — reconstruct BOTH entries' closings by hand, then tsc BEFORE
trusting vitest (a syntax error shows as many-suites-failed, not a clear error).

## Batch 5 in flight (b5-* worktrees forked 792fce1)
- b5-drive-ops (DR-01 rename/move/bulk, DR-02 versioning+trash, DR-04 quotas +
  drive size-rollup aggregate; sole owner of files router + vault UI + a new
  file_versions schema/migration; also writes the OneDrive 500GB migration design doc)
- b5-files-chat (CH-01 composer attachments, DR-03 `file` canvas node [the ONE new
  node type this batch → must update AI-01 mirror + AI-02 projection], DR-05 vault
  content extraction/embedding in the listener)
- b5-home (HM-01 agentic genui home at / via a home-scoped chat_canvas_layouts
  discriminator, HM-02 morning-brief panel; reuses existing canvas — no new node type)
Deferred to post-merge: TM-04 drive circle-pack (consumes drive-ops' size aggregate).
Batch 6 (W5 multiuser/teams) next; then Batch 7 (W6 ventures) + final sweep.

## --- historic detail below (superseded) ---
## Status: RUNNING — Batch 4 (W3 canvas+viz)

Batch 3a DONE (5c72a60). Batch 3b DONE 2026-07-23T07:xxZ (4d2b760 pushed):
AI-04 send-to-chat/canvas (verified), AI-06 graph memory (refuted on 8 mypy errors
→ fixed test-double protocol stubs + object-cast, re-verified, merged), AI-03
ingest-time resolution (REFUTED on a REAL defect — sender-global tier-blind edge
deactivation demoted human-promoted canon + wiped other emails' pending; I replaced
deactivate-then-insert with insert-if-absent pre-seeded from active edges [never
touches canon], added rejected/superseded component filter + a canon-survival
regression test; re-verified, merged). Integrated listener green 91.61%, mypy 254
clean, lint-imports 3/3. W2 spine COMPLETE.

Carry-forward: (1) amend every agent commit to noreply@anthropic.com before merge;
(2) skeptics refuted 3 of last 6 lanes on real defects — NEVER merge a refuted lane
unfixed; (3) W3 lanes add canvas node types + capabilities → they MUST update the
AI-01 mirror (packages/capabilities/src/canvas.ts CANVAS_NODE_DATA_SCHEMAS) + AI-02
projection-map + pinned id sets or the enforcement suites go red (by design).

## Batch 4 in flight (b4-* worktrees forked 4d2b760)
- (b4 lanes merged, see above)
- b4-tm-treemap (TM-01 CirclePack primitive, TM-02 email view, TM-03 canvas node) — aa5d72eddca37a8cf
- b4-sheet-grid (EN-01 grid shakedown, CV-03 spreadsheet node + table.* capability) — aafb480b69c9bc0c5
Batch 5 (W4 drive+home) next: DR-01..05, CH-01, HM-01/02, TM-04, OneDrive design.

## --- historic detail below (superseded) ---
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

## Batch 3a DONE 2026-07-23T06:5xZ (5c72a60 pushed)
All 5 merged after fable-5 skeptic verification + main-loop fixes:
- ST-04 pipeline health (degraded/skipped lifecycle, exact-count endpoint) +
  forgery guard (closed KNOWN_STAGES vocab — skeptic proved filename injection)
- AI-01 canvas triple + .finite()/self-loop hardening; AI-02 projection gate
  (fired on AI-01's 3 new caps at merge exactly as designed → entries added)
- AI-05 omnibox (5 tenancy-scoped arms); EN-02 review queue + deterministic ORDER BY
Suites: listener full green 91.51%, capabilities 47, api-client 639, web 1440.
Committer identity: had to amend agent commits to noreply@anthropic.com (git config
in worktrees didn't inherit) — DO THIS for every future agent commit before merge.

## Batch 3b in flight (agents on b3b-* worktrees, forked 5c72a60)
- b3b-ai03 (ingest-time entity resolution + edge proposal, as ST-04 post-persist stage)
- b3b-ai06 (graph-backed chat memory, canon-tier read + suggest-only writeback)
- b3b-ai04 (universal send-to-chat/canvas affordance, calls AI-01 procedures)
Batch 4 (W3 canvas+viz) queues next: CI-01..07, TM-01..03, EN-01→CV-03 spreadsheet.

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

## Active work — Batch 3b (3 Agent-tool agents on manual worktrees b3b-ai03/ai06/ai04, forked 5c72a60)
Not a Workflow — plain background Agents. If container dies: the worktrees +
their committed branches survive on disk; check `git -C .claude/worktrees/b3b-<n>
log` and `git branch --list 'b3b-*'`. Uncommitted agent work is lost on death →
relaunch that lane's Agent (worktree keeps partial files). As each returns:
fable-5 skeptic verify → amend committer to noreply@anthropic.com → merge → verify → push.
- Prior workflows (cached): wf_acbedf4e-6ec (B1), wf_b93b55e9-cca (B1R), wf_05119d6c-159 (B2)

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
