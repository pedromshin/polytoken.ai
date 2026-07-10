# Two-Epoch Endgame Plan — everything remaining in v1.9 + v2.0

**Locked:** 2026-07-10 (user directive: "lets make the changes necessary so that we do everything
in the next two epochs as discussed")
**Supersedes:** the E3→E7 five-epoch sequencing in `research/polytoken-vision/VISION.md` §1
(the epoch CONTENT is unchanged; only the grouping/sequencing is compressed). E7 is not part of
either epoch — see §4.

## 0. Why this restructure exists (the honest diagnosis)

User verdict after v1.5–v1.8: *"we've done so much in the last 3 or 4 milestones but the project
is still literally what it was before — dumb generated UIs that don't do anything and can drag
stuff on canvas but nothing more."* The record supports it:

1. **Nothing ever shipped where the user feels it.** Migrations 0026–0035 are local-only; the
   OAuth runbook was never run; SES forwarding was never wired. The user's real email has never
   entered the system. Six consecutive milestone closes autonomously deferred every gate that
   required the live loop (deploy, OAuth, real email, live UAT).
2. **Capability exists but was never experienced.** v1.6's chat×knowledge convergence is the most
   substantive work in the repo and is exactly the part gated behind the never-run runbooks and a
   repeatedly-broken local stack.
3. **Panels are render-only by design.** The only actuated path is the confirm-action widget; the
   interactive direction (999.7/PANL) kept being deferred.
4. **Foundation kept out-sequencing value.** v1.7 = invisible plumbing, v1.8 = paint, while E3
   (the killer feature) stayed "one epoch away" for three milestones.

**Standing rule from this decision forward: deploy/OAuth/live-UAT gates are FIRST-CLASS PHASE
WORK, never deferrable-by-default.** A milestone that closes without the user having touched the
new capability live is a failed sequencing, whatever the audit says.

## 1. What happened to v1.8

v1.8 **closed early at Phase 48** (scope cut 2026-07-10, user-directed). Shipped: brand
foundation + Playwright/screenshot verification tooling (Phase 47), token-system extensions
(Phase 48) — 12/12 remaining v1 requirements complete. The other 11 requirements (RSKN-01..05,
MOBL-01..02, PANL-01..04) move to v1.9 with their phase specs intact (the full Phase 49/50/51
goal/criteria text is preserved in `milestones/v1.8-ROADMAP.md` for reuse at v1.9 planning;
the ex-Phase-49 discuss context also survives at `.planning/phases/49-total-ui-re-skin/49-CONTEXT.md`).

## 2. Epoch A — v1.9 "Cloud Workspace" (live loop + re-skin + email-cluster workflow)

One milestone. Everything the product needs to be a *used product* in the browser, on the user's
real email. Three bands, dependency-ordered:

### Band 1 — Live-Loop Gate (FIRST; nothing else starts until this is green)
- Local stack runs clean end-to-end (auth + chat + fetch + genui) — no zombie-process ambiguity.
- Migrations 0026–0035 applied to staging AND prod (deploy playbook: migrations-first).
- GOOGLE-OAUTH-RUNBOOK.md executed (user does console steps; agent preps/validates everything else).
- FORWARDING-RUNBOOK.md + SES rule wired → the user's real email flows into polytoken.
- EXTERNAL-RENAME-RUNBOOK.md executed; local Supabase project-id decision made.
- Deferred UAT burn-down: the ~20 parked scenarios across 39/41/43/45-HUMAN-UAT.md via
  /gsd:verify-work.
- User-executed items are IN the phase as checkpoint tasks, not parked as "user-gated" deferrals.

### Band 2 — Folded v1.8 remainder (specs already written — see milestones/v1.8-ROADMAP.md §49–51)
- **Re-skin** (ex-Phase 49, RSKN-01..05) + backlog 999.16 (entity-chips + StatusBadge off-token
  surfaces — extend RSKN scope to /entities/[id] deliberately).
- **Mobile answer** (ex-Phase 50, MOBL-01..02) — depends on re-skin.
- **Editable panels** (ex-Phase 51, PANL-01..04) — parallelizable; the first time panels stop
  being read-only.

### Band 3 — E3 Email-Cluster Workflow (the killer feature), DEPTH-FIRST
Scoped around ONE end-to-end scenario on the user's real inbox (VISION's salary-negotiation
scenario or equivalent), fully working, before any breadth:
- Email/thread cards as canvas node types (registry is versioned/extensible — CANVAS-03).
- Chat panels bound to an email thread's context (thread → conversation linkage).
- `web_search` ToolExecutor (same port as v1.6 tools; executor seam already proven).
- Source-capture: tool results (URLs/PDFs) persist as INFERRED knowledge nodes attached to the
  cluster; promote-to-global via the v1.5 promotion gate. Suggest-only, as always.
- Cluster context: artifacts (genui panels, captured sources) enter the context of subsequent
  chats in the same cluster.

Ordering inside v1.9: Band 1 strictly first. Band 2 and Band 3 interleave (editable-panels ∥
re-skin per the dossier's own dependency analysis; E3 backend work ∥ re-skin). Mobile last.

## 3. Epoch B — v2.0 "Local Agent Platform" (E4+E5+E6 merged)

One epoch, one requirements umbrella; expect the biggest roadmap yet. The merge is legitimate
because all three ex-epochs share one foundation: **the daemon + ONE permission model + the
generalized ToolExecutor**. Browser control and registry tools are just more executors behind the
same gate — designing one permission model instead of three staged ones is better security
posture, not a shortcut.

### First-class (core loop)
- Desktop app hosting a daemon: outbound persistent connection to polytoken cloud; per-command
  permissioning, audit log, daemon auth. Run /gsd:secure-phase on every daemon phase — security
  is the whole game (VISION E4 note).
- Watched folders → directory panels on canvas.
- Directory panels + attached chats = Claude-Code-class agent loop scoped to a folder
  (fs/terminal/git executors via the ToolExecutor port).
- Destructive fs ops require confirm-action widgets (v1.6 Fork-2 machinery extends).

### Thinned (deliberate scope cuts to make one epoch real, not relabeling)
- **Browser-control panel ships CDP-first**; the screenshot/vision perception research fork
  (pixelrag/ui-tars/etc.) is deferred — do NOT lock a perception stack now (VISION E5 guardrail).
- **Tool/skill registry ships as a per-user allowlist control panel** over the daemon's executor
  set — "which tools may my agent use" — deferring the hundreds-of-OSS-tools registry.

### Stretch / trailing (in-epoch if cheap, else parked at close)
- Embedded editor panels (code-server/Monaco in the jailed-iframe discipline from Phase 20).
- Agent self-repository of reusable functions (template flywheel generalized; generated=INFERRED,
  human-blessed=EXTRACTED).

### Split rule
If the v2.0 roadmap exceeds ~15 phases, split v2.0/v2.1 at the natural seam (daemon core first,
executors-on-top second). Still one epoch, one requirements umbrella, two execution passes.

## 4. E7 — Distributed inference/compute pooling: NOT an epoch

Explicitly parked at its gate (VISION E7): needs E4 shipped + real multi-user tenancy +
demonstrated demand; it is a venture decision, not a milestone. The ONLY present-day obligation
(carried into v2.0's daemon design): **keep the daemon protocol job-shaped** — a "run inference
task" must be expressible as just another daemon job.

## 5. Command map (the GSD bureaucracy, in order)

1. `/gsd:audit-milestone` → `/gsd:complete-milestone` → `/gsd:cleanup` — close v1.8 at its cut
   scope (REQUIREMENTS.md already re-scoped; audit against the 12 remaining v1 requirements).
2. `/gsd:new-milestone` — v1.9 Cloud Workspace, seeded by THIS document (§2). Fold in
   `/gsd:review-backlog` + `/gsd:check-todos`: 999.16 → re-skin band; todos
   2026-07-07-knowledge-preexisting-ui-debt + 2026-07-09-knowledge-cache-invalidation-gap →
   re-skin/knowledge band; 999.15 (prompt caching) absorb-or-re-defer consciously.
3. `/gsd:autonomous` — with the Band-1 exception: Live-Loop Gate checkpoints that need user
   hands (Google console, DNS/SES, domain) surface as explicit checkpoint tasks, NOT autonomous
   deferrals.
4. Close v1.9 (audit → complete → cleanup). The audit bar includes: user has used the E3 scenario
   live on their real email.
5. `/gsd:new-milestone` — v2.0 Local Agent Platform, seeded by §3 (state the merge + thinning
   decisions up front so requirements lock them). `/gsd:secure-phase` on daemon phases.
6. `/gsd:autonomous` → close. E7 remains parked at its gate.

## 6. Backlog disposition under this plan

| Item | Disposition |
|---|---|
| 999.2 (grid colSpan + pytest cleanup) | fold into v1.9 re-skin band or re-defer at v1.9 planning |
| 999.3 (connected-env verifications) | absorbed by v1.9 Band 1 (live-loop gate) |
| 999.4 DSGN-02/04 (visual-compare repair, token extraction) | stays v2+/parked (not cheap) |
| 999.5 (orchestration visualizer) | v2.0 stretch (run-tree next to directory/browser panels) |
| 999.12 (Tailwind v4 / React 19) | stays parked — orthogonal platform risk, both epochs stay on stable stack |
| 999.13 (genui catalog expansion) | candidate small phase inside v1.9; decide at planning |
| 999.14 (dev/design scratch typecheck) | fix opportunistically in v1.9 re-skin band |
| 999.15 (Bedrock prompt caching) | hygiene; sequence behind v1.9 value work, in-epoch if cheap |
| 999.16 (off-token chip/badge surfaces) | folded into v1.9 re-skin band (explicit RSKN scope extension) |
