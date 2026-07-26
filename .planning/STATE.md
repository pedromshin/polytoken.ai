---
gsd_state_version: 1.0
milestone: vNEXT-living-canvas
milestone_name: The Living Canvas
status: in-progress
last_updated: "2026-07-26T16:00:00.000Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 0
  completed_plans: 0
  percent: 45
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

**Milestone: vNEXT — The Living Canvas (Phases 73–77). IN PROGRESS** (opened as an orchestrator run
2026-07-25; roadmap `milestones/vNEXT-living-canvas-ROADMAP.md` ✅ SHIPPED-STATUS block).
Reconciled 2026-07-26:

- **Phase 73 (living-canvas agent dataflow) — Waves A + B SHIPPED** (agent draws+wires nodes behind
  `CANVAS_EMIT_TOOL_ENABLED`; the `shared.published.{nodeId}` publish port in 12 source nodes). Wave C
  (named `canvas_recipes` + durable after-close recompute) remaining.
- **Phase 74 (self-assembling morning board) — SHIPPED** (`/chat` Assemble-board + `/home` HomeCanvas
  paint; overnight composer + worker cron ship DARK behind `MORNING_BOARD_ENABLED`). Live
  overnight-run screenshot gate remaining.
- **Phase 75 (correction-propagation flywheel) — VISIBLE half SHIPPED** (a merge repaints every placed
  entity card live + cascade ring). SERVER cascade (ledger migration → promote edges → wire into
  ConfirmMerge → worker re-label) remaining; it touches the LIVE listener merge path, LIVE-loop-gated.
- **Phase 76 (bespoke code-islands) — SUMMON LOOP SHIPPED + LIVE IN PROD.** The full data-channel →
  node → "Build a tool from these" flow; **`0055 code_islands` applied to prod 2026-07-26** (Supabase
  Management API, verified against the DB), so it works end-to-end. Remaining: 76-02b (listener
  consumes the typed-inputs manifest, ECS redeploy) + 76-05 (agent `emit_code_island`, flag-gated).
- **Phase 77 (life-as-MCP-tool-surface) — NOT STARTED** (specced only).

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

**vNEXT (active) — remaining legs of the shipped phases:**
1. **Phase 76 close:** 76-02b (listener consumes the `inputs` typed-shape manifest in the code-island
   generator prompt — additive, back-compat, FULL pytest + ECS redeploy of the live mail receiver) +
   76-05 (agent-authored `emit_code_island` behind `CANVAS_EMIT_TOOL_ENABLED`).
2. **Phase 75 SERVER cascade** (75-01 `correction_propagations` ledger migration → 75-02
   `CascadeCorrectionUseCase` → 75-03 wire into `ConfirmMergeUseCase` best-effort → 75-04 worker
   re-label). Touches the LIVE merge path; ship flag-gated, FULL pytest.
3. **Phase 73 Wave C** (named `canvas_recipes` migration + CRUD + badge, LCAN-07; durable recompute
   LCAN-09) and **Phase 77** (capability-registry MCP server, specced not started).
4. **Live gates to flip when ready:** `CANVAS_EMIT_TOOL_ENABLED` (agent draws nodes/edges),
   `MORNING_BOARD_ENABLED` (overnight board — needs the worker provisioned: install the
   `graphile_worker` schema + apply 0053/0054 via the Management API).

**Infra / carried (unchanged):**
5. **Create the 3 missing GitHub prod secrets** (`PROD_POSTGRES_URL_NON_POOLING` / `PROD_POSTGRES_URL`
   / `PROD_SUPABASE_URL`) so `deploy-migrate-prod.yml` works again (I added the `environment:
   production` binding; the secrets themselves are absent). Until then prod DB changes go via the
   Supabase Management API.
6. Wire + verify Phases 68–72 (v1.11 closeout); pixel gates on 62/63; the owed v1.9 live legs
   (LIVE-03 / LIVE-04 / CLUS-07) per the MORNING-CHECKLIST runsheet.
7. Deferred reorgs (recorded, not started): split `night-run/` docs from runtime scripts; fold
   version-scoped `research/` dirs into milestone archives.

## Open Debug

- None at top level. `debug/chat-blank-pane.md` moved to `debug/resolved/` 2026-07-22 (root cause
  was the 999.22 `.next` dev/build collision, closed by construction in 61-01 + `NEXT_DIST_DIR`).
