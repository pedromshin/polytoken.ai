---
gsd_state_version: 1.0
milestone: vNEXT-living-canvas
milestone_name: The Living Canvas
status: complete
last_updated: "2026-08-08T01:00:00.000Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 0
  completed_plans: 0
  percent: 100
---

# State

> **⚠️ Not the live "where are we."** This file tracks GSD milestone/phase state and is
> older than the active work. For current status use **`.planning/ORCHESTRATOR-STATE.md`**
> (the single live run ledger); for the forward build sequence use
> **`.planning/assessment/2026-07-24/00-MASTER-PLAN.md`**. The 07-22 META-AUDIT referenced
> below is superseded — do not orient a fresh session on it.
>
> **Reconciled 2026-07-24:** GSD Core v1.8.0 was vendored into the repo (`.planning/GSD-INSTALL.md`) —
> `/gsd:*` commands, agents and skills now live under `.claude/`. This `STATE.md` remains the
> structural milestone tracker; the ⭐ CURRENT block at the top of `ORCHESTRATOR-STATE.md` is the
> live status and lists what shipped since (visible batch, Track 2 split, the Treemap landscape).

## Project Reference

See: `.planning/PROJECT.md` · Roadmap: `.planning/ROADMAP.md` · Ground truth for this
reconciliation: `.planning/research/2026-07-22-META-AUDIT.md` §1–2.

**History archive:** every per-plan History entry, Deferred Items, Accumulated Context, Decisions
Log, and Performance Metrics through Phase 61 / early v1.11 was rotated VERBATIM (2026-07-22) into
[`milestones/STATE-HISTORY-through-v1.11-2026-07-22.md`](milestones/STATE-HISTORY-through-v1.11-2026-07-22.md).
Read it before re-deriving anything historical.

## Current Position

**Milestone: vNEXT — The Living Canvas (Phases 73–77). CODE-COMPLETE 2026-08-06 — open only on
human-gated LIVE seams** (opened as an orchestrator run 2026-07-25; roadmap
`milestones/vNEXT-living-canvas-ROADMAP.md` ✅ SHIPPED-STATUS block). Reconciled 2026-08-06 (all
commits local on `main`, about to push; feature branch merged via `985e2071`):

- **Phase 73 (living-canvas agent dataflow) — Waves A + B + C SHIPPED.** Wave C landed 2026-08-06:
  recipe creation seam `emit_canvas_recipe` + web reconcile (`f0510ee5`, fixes `a19aba67`) + worker
  `recompute_canvas_recipe` / `dispatch_recipe_recomputes` (`1d1391a2`, dark behind
  `RECIPE_RECOMPUTE_ENABLED`; migration **0061** widens the task allowlist — NOT yet on prod).
  Remaining: LCAN-05 / LCAN-09 **live** (HUMAN-GATED: worker provisioned + 0061 + flag).
- **Phase 74 (self-assembling morning board) — SHIPPED (dark)** (`/chat` Assemble-board + `/home`
  HomeCanvas paint; overnight composer + worker cron DARK behind `MORNING_BOARD_ENABLED`).
  Remaining: MORN-07, the live overnight-run screenshot gate (HUMAN-GATED: flag + worker).
- **Phase 75 (correction-propagation flywheel) — BOTH halves SHIPPED.** Visible half (repaint +
  cascade ring) 2026-07-26; SERVER cascade 2026-08-06: wired into ConfirmMerge behind
  `CASCADE_CORRECTION_ENABLED` (byte-dark OFF) + `POST /v1/emails/relabel-job` (`d5c5b1d2`) +
  worker `cascade_relabel` (`1d1391a2`). Remaining: the CPF live re-label leg (HUMAN-GATED:
  flag flip + live loop).
- **Phase 76 (bespoke code-islands) — CODE-COMPLETE + LIVE IN PROD (data path).** Summon loop +
  `0055 code_islands` on prod (2026-07-26); 76-05 `emit_code_island` (2026-07-27); 76-02b listener
  consumes the typed-inputs manifest (`87f4daf5`, hardening `08c336a7`, 2026-08-06). Remaining:
  BTAP-07 end-to-end **live** (HUMAN-GATED).
- **Phase 77 (life-as-MCP-tool-surface) — CODE-COMPLETE.** Waves A+B 2026-07-27
  (`apps/mcp-server`, expose-only stdio, 3 owner-scoped read tools) + the esbuild runtime bundle
  2026-08-06 (`58213cfc` — `dist` boots, stdio `tools/list` smoke green, Windows expose-only fix
  32/32, daemon-protocol suite in CI). Remaining: MCPX-09 — Pedro's real Claude Code connecting
  (HUMAN-GATED).

> These shipped as an orchestrator run, gates green, but WITHOUT per-plan PLAN.md/VERIFICATION.md
> GSD trails. The honest record is the `ORCHESTRATOR-STATE.md` ledger + git history. GSD phase
> verification (formal VERIFICATION.md per phase) is owed if the milestone is closed through GSD.

### Carried debt from v1.11 (Research Core & the Capability Spine — Phases 64, 68–72)

- **Phase 64** (Research, Documents & Mail Rules vertical slice) — built 2026-07-17 as night-run
  Lane B; ABSORBED as v1.11's first phase, not re-planned. Complete.
- **Phases 68–72** — BUILT-BUT-UNVERIFIED. All five were built + tested during the 2026-07-20
  night-run build march (`night-run/BUILD-MARCH-2026-07-20.md`; wave commits `bd514b3`, `3601c5e`,
  `d92f3b9`+`ffd2452`, `6c0f4fa`, `31220f5`, landed on main via squash-merge `0851cf9` / PR #1).
  They have NO phase dirs, PLAN, or VERIFICATION trail — the march built code without planning
  artifacts. Wiring + GSD verification is v1.11's remaining work; checkboxes stay unticked in
  ROADMAP.md until then.
- **Phase 58's human gate is RESOLVED** — D-58-01 locked 2026-07-15 ("Provenance × Meaningful
  Colour", `phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md`); its ROADMAP checkbox
  was reconciled 2026-07-22.

**v1.10 status: SHIPPED except carried Phases 62/63** — both are pixel-gated on Pedro (code swept
during the night-run; the D1 taste gate — a human looking at the pixels — is what is owed).

**Carried debt (unchanged, still owed):** the v1.9 live-acceptance legs — LIVE-03 (§A OAuth live),
LIVE-04 (§B.3–6 real inbound email), CLUS-07 (§H six-leg scenario, v1.9's declared acceptance
bar). User-only console actions, no code. Runsheet:
`phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md`, run §A → §B.3–6 → §H.

**Infra, in flight elsewhere:** SES production access still pending AWS approval (sandbox until
then). Terraform codification of the live `polytoken-ses-forwarder` Lambda + `personal-forward`
SES receipt rule drift is in flight on a sibling branch
(`claude/polytoken-email-infra-cont-jzz1pg`). `nauta-services-*` naming drift stays parked
(999.20 — a real migration, not a find-replace).

## Next Actions

**Reconciled 2026-08-06 tonight part 2 (see the ⭐ block in `ORCHESTRATOR-STATE.md`): prod DB is
RESTORED (dbcheck green, diagnostic route deleted `af6c8810`), Track 1 remote state is LIVE
(`13edbea6`), Track 3a is PROVISIONED DARK (`6c4e7cc9`+`b797ffa6`, image pipeline green), and the
milestone listener code is DEPLOYED to prod (×2 green). Everything remaining is a Pedro-gated
enable/live seam (no missing software):**
1. **Worker ENABLE sequence** (`docs/DURABLE-WORKER-RUNBOOK.md` §3/§5 — infra is applied
   ship-dark, ECR repo + gated container on `main`): create the session-mode
   `GRAPHILE_WORKER_CONNECTION_STRING` secret → push the worker image (pipeline validated green,
   incl. Trivy) → set `worker_db_url_secret_arn_*` in tfvars → plan/apply (expect only task-def
   revision + service update + read-secrets policy) → confirm boot/polling → ensure the
   graphile_worker schema + migration **0061** (and verify 0058–0060) are on prod via
   `deploy-migrate-prod.yml` → flip `INGEST_ENQUEUE_ENABLED` LAST.
2. **Staging drift repair (OPEN, classifier-gated):** staging still shows Terraform drift;
   classify each diff safe-in-place vs live-churn before any apply (standing live-infra guard).
3. **Billing key:** mint a durable restricted `STRIPE_SECRET_KEY` (CLI keys expire ~90 days) and
   set it + `BILLING_ENABLED=true` in Vercel — Stripe objects and the other 4 env vars
   (`STRIPE_PRICE_PRO` / `STRIPE_PRICE_POWER` / `STRIPE_WEBHOOK_SECRET` / `BILLING_APP_URL`) are
   already live; billing stays inert until these two land.
4. **SES:** reply to production-access case `178464704400134` (Support Center — AWS is waiting
   on Pedro's reply; sandbox until then).
5. **Live seams:** flip the flags after a live smoke loop (`CANVAS_EMIT_TOOL_ENABLED` ·
   `MORNING_BOARD_ENABLED` · `CASCADE_CORRECTION_ENABLED` · `RECIPE_RECOMPUTE_ENABLED`) → run
   the live UAT seams LCAN-05 / LCAN-09-live · MORN-07 · BTAP-07 · MCPX-09 · CPF-live; plus the
   real-browser screenshot pass over all shipped UI.

**Infra / carried (unchanged):**
6. Wire + verify Phases 68–72 (v1.11 closeout); pixel gates on 62/63; the owed v1.9 live legs
   (LIVE-03 / LIVE-04 / CLUS-07) per the MORNING-CHECKLIST runsheet.
7. Deferred reorgs (recorded, not started): split `night-run/` docs from runtime scripts; fold
   version-scoped `research/` dirs into milestone archives.

## Open Debug

- None at top level. `debug/chat-blank-pane.md` moved to `debug/resolved/` 2026-07-22 (root cause
  was the 999.22 `.next` dev/build collision, closed by construction in 61-01 + `NEXT_DIST_DIR`).
