# Build March — 2026-07-20 (user: "build the entire vision and roadmap, literally the entire thing")

**Authorization (user, verbatim intent):** *"we need to build the entire vision and roadmap,
literally the entire thing — all phases, all epochs, all milestones, all todos, all pending.
everything."* Verification is DEFERRED by explicit user instruction (*"well deal with bullshit to
make it test run and verify later"*). The user is on their phone and will NOT run localhost — no
dev server, no pixel review, no live OAuth/email from this session.

**Method:** sequenced WAVES of parallel builders (Workflow tool), scoped to DISJOINT file sets so
they never collide. Commit + push between waves. Each wave lands real code; verification is a later
pass. Honest accounting: "the entire thing" is a multi-session engineering effort — this march
sweeps every slice buildable WITHOUT pixels/localhost/live-services, and enumerates the rest.

**Plan of record:** `night-run/reports/negative-space.md` (v1.11), `research/polytoken-vision/
VISION.md` (E0–E7), `research/two-epoch-endgame/ENDGAME-PLAN.md` (v2.0), `night-run/ENDGAME-2-DRAFT.md`
(v1.12→v3.0 ladder), `DIRECTIVES-2026-07-17.md` (D1–D4). Registry spine (D2) committed: `bd514b3`.

---

## Wave status

- [x] **Wave 1 — Registry spine consumers + first features** (workflow `w7oduc239`, DONE 2026-07-20)
  - [x] `packages/capabilities` — the D2 spine (bd514b3, typecheck + 11 tests)
  - [x] daemon → `@polytoken/capabilities` reconcile (INV-2) (feb18bb, daemon tc green)
  - [x] Python chat capability registry (REG-02) — the two parallel dicts collapsed (f088904, 13 tests)
  - [x] Research evals harness (RSRCH-05 / Phase 72) (31220f5, 11 offline tests)
  - [x] PDF export floor (DOCS-01 / Phase 70) (d92f3b9)
- [x] **Wave 2 — v1.11 research + composition** (workflow `wdm3rmo9u`, DONE 2026-07-20)
  - [x] Phase 69 — deep-research loop backend (plan→search→adversarial-verify→synthesize), rubric-aligned (3601c5e, 10 tests)
  - [x] Phase 70 rest — documents as first-class objects: pages + canvas node + DB table 0040 + RLS (ffd2452, 346 canvas tests)
  - [x] Phase 71 — genui × registry BINDING, the D2 proof, fails closed (6c0f4fa, 21 tests)
  - [x] MAIL-01/02 — rules matcher + actions as registry capabilities, suggest-only (3601c5e, 14 tests)
  - [ ] **Deferred wiring** (Wave 3 owns it): deep_research needs a ChatProvider added to the chat factory DI; mail-rule actions wire into the email path, not the chat registry. Modules are committed + tested; the buttons that call them land in Wave 3.
- [ ] **Wave 3 — v1.10 carried visual (code-only, PIXEL-GATED on user)**
  - [ ] Phase 62 — `/knowledge`, `/studio`, `/settings/*`, `/login` redesign + production empty/loading/error states (SURF-03/05/06)
  - [ ] Phase 63 — research-canvas visual surfaces: source nodes, canon curation UX, source-grounded panels (RCNV-02/03/05)
- [ ] **Wave 4 — v2.0 Local Agent Platform** (daemon 65 + vault 66 already landed)
  - [ ] Watched folders → directory panels on canvas; directory-scoped attached chats (Claude-Code-class loop over the daemon executors)
  - [ ] Browser-control canvas panel, CDP-first (perception stack deferred by ENDGAME-PLAN)
  - [ ] Tool registry as per-user allowlist panel (over the capability registry `source`/`trust`)
  - [ ] Destructive-op confirm-action widgets keyed on `risk` (INV-4)
  - [ ] Embedded editor panel (Monaco/code-server, jailed-iframe discipline) — stretch
- [ ] **Wave 5 — v2.1 / v2.2 / v2.3 advances**
  - [ ] v2.1 — files vault hardening; files/recipes/sheets as knowledge/canvas nodes; watched-folder sync
  - [ ] v2.2 — session streaming hardening (Phase 67 slice landed); repo/GitHub surfaces
  - [ ] v2.3 — OSS/MCP ontology: POPULATE the registry with `source:"external"` + `trust` tiers (thin vetting gate only — INV-3)
- [ ] **Wave 6 — backlog sweep** (open 999.x that are code-only)
  - [ ] 999.2 grid colSpan · 999.8(b) renderer mustache · 999.13 genui catalog expansion (20 vendored components) · 999.15 Bedrock chat prompt caching · 999.25 suggestion-chip styling · 999.31 carve run_chat_turn.py · 999.32 root CLAUDE.md + micro-skills · 999.33 rule-based mail actions (fixture) · 999.35 save references inside polytoken
- [ ] **Wave 7 — todos** (`.planning/todos/pending/` currently EMPTY — nothing pending)

## Genuinely NOT buildable from this session (enumerated, not faked)

- **Pixel/taste gates** — Phases 62/63/69/70/71 surfaces need the user's on-screen review (D1 taste
  gate; the "green tests ≠ good UI" lesson). Code lands; "done" waits on the user.
- **Live legs** — LIVE-03 (OAuth), LIVE-04 (real inbound email), CLUS-07 (six-leg scenario), and
  MAIL's real-mail switch (v1.12) — user console actions, ~30 min, no dev work.
- **v3.0 launch hardening** — gated on a launch decision (orgs/RLS-primary/billing); tenancy stays
  ADR-only per `tenancy-arch.md` §3. Not built speculatively.
- **999.20 nauta purge in live state** — needs DB access + user-driven AWS/infra migration.
- **Remote desktop luxury tier (999.26)** — needs the user's Windows box + a UAC click.
- **D2 bless** — the registry is built at its cheapest scope; if the user rejects the framing,
  Phase 71 drops and Phase 68 stands alone.

---
*Updated as each wave lands. Commits reference the wave. Pushed to `claude/gsd-plugin-marketplace-s6us9d`.*

## 2026-07-20 ~21:50 UTC — session-limit checkpoint

- Wave 3: 2/4 landed GREEN and committed (research vertical efdaebb + envelope fix 4e91822; source canvas node 002b22d — 599/599 chat tests, tsc clean, backend suites green). mail-review-strip + phase-62 killed by the session limit (resets 12:20am UTC); partial files reverted.
- Mega-wave (Waves 4-6 merged, 9 slices): all agents killed by the limit before returning; partial daemon/protocol/mail files reverted — clean tree. Script preserved for fresh relaunch.
- Gap-wave (999.33/35/25 + Cloud Desktop RFC 999.39): launch blocked (classifier outage during the limit window); plan saved.
- Relaunch scheduled via send_later at 00:26 UTC (trigger trig_018ZiHbjYd4RtR3dKpYuyXfW) per scratchpad/RELAUNCH-PLAN.md.

## Work-loss insurance (added 2026-07-20 ~21:56 UTC, user mandate: "guarantee no work loss")

- **Snapshotter live:** a background loop captures the ENTIRE dirty tree (tracked + untracked) every 4 min into chained commits on `origin/claude/gsd-plugin-marketplace-s6us9d-wip-snapshots` — zero-touch (temp index; never disturbs running agents, HEAD, or the real index). Divergence between sessions auto-reconciles with both tips kept. Proven end-to-end incl. the reconcile path.
- **Iron rule:** snapshot BEFORE any revert/clean/reset of agent output. (Two earlier partial-file reverts were unrecoverable — that class of loss is now closed.)
- **Recovery:** `git fetch origin claude/gsd-plugin-marketplace-s6us9d-wip-snapshots && git log --first-parent FETCH_HEAD`, then `git checkout <snap> -- path` per file. Full recipes in scratchpad/snapshot.sh header.
- **Residual risk, stated honestly:** work created and lost BETWEEN two ticks (≤4 min window) if the container dies mid-tick; and the loop itself dies with the container (restart is RELAUNCH-PLAN Step 0 — the scheduled 00:26 UTC resume does this).

## 2026-07-20 ~23:xx UTC — ALL WAVES INTEGRATED (consolidated verification green)

Fable relaunch swept every wave to completion. Branch tip: c38bcfd + wiring/verify commits.
Cross-cutting sweep: 7/7 TS packages tsc clean; vitest capabilities 22, daemon-protocol 52,
genui 626, canvas 537, daemon browser 26 (12 daemon failures are PRE-EXISTING Windows-path
tests, zero regression); listener full suite 91.40% coverage (floor 80 held), import-linter 3/3,
ruff clean — only the 4 credential-gated live-OCR tests fail (session baseline).

DONE this session:
- v1.11 spine (capabilities registry) + all four consumers + genui×registry binding (D2 proof)
- Research: deep_research wired end-to-end + trace UI + pmark citations + envelope-shrink fix + evals
- Documents (pages+canvas node+DB+PDF), Source nodes, Canon curation + promote path end-to-end
- Mail: suggest-only review IN the inbox + blessed-action execution (bless gate, audit trail)
- Phase 62: /knowledge /studio /settings /login redesigned + production states (v1.10 code swept)
- v2.0: browser.* daemon capabilities, /capabilities allowlist panel, directory/browser/editor
  canvas panels (registered), daemon ?token= browser-WS gate, sidebar nav
- v2.2: /sessions terminal surface
- v2.1: files vault hardening
- Backlog: 999.31 carve, 999.15 caching, 999.13/8b/2 genui, 999.27 vetting seam, 999.32 CLAUDE.md,
  999.33 mail actions, 999.35 /references, 999.25 fixtures, 999.39 Cloud Desktop RFC, INV-4 confirm card

BLOCKED / PARKED (needs explicit user direction or a machine):
- Daemon PTY sessions + dir-watch (session.start/write/kill): BLOCKED by safety layer as an
  unnamed RCE surface. Not retried. Needs the user to specifically authorize persistent
  arbitrary-command daemon sessions before it can be built.
- Pixel review of every visual surface; v1.9 live legs; v1.12 real-mail switch; 999.20 infra purge;
  D2 bless; Cloud Desktop provisioning account.
- Open SEAMS (recorded in commit bodies): panel add-affordances + daemon intent bridge (browser
  screenshot stream / fs live tree into panels); directory attach-chat procedure; allowlist
  enforcement into broker+chat loop; live daemon manifest merge; server-persisted allowlist table.

## 2026-07-21 ~00:38 UTC — DAEMON PTY SESSIONS + DAEMON→PANEL BRIDGE LANDED (user: "build the daemon PTY sessions feature and everything else missing" + "Build all three")

The three items previously in BLOCKED/PARKED as "unnamed RCE surface / open seams" are now
BUILT, tested, committed, and pushed — after the user's explicit, specific authorization.

DONE this session (unblocked → shipped):
- **Daemon PTY sessions** (`apps/daemon/src/sessions/manager.ts` + `handlers.ts`, wired in
  `server/daemon.ts`): session.start/attach/input/resize/list. Deny-BEFORE-spawn via
  `broker.decide({capabilityId:"session.start", risk:"exec"})`; roots boundary; `scrubEnv` strips
  DAEMON_TOKEN from children; MAX_SESSIONS=8; 256KB scrollback. 10 tests, MOCKED child_process
  (deterministic, sandbox-independent) — deny-before-spawn proven (spawnCalls empty on deny).
  The `/sessions` UI (v2.2) already drives all five verbs → the terminal feature is END-TO-END.
- **Allowlist kill-switch enforcement** (broker STEP 2.5 + `permissions/store.ts`
  disabledCapabilities): a disabled capability id returns permission_denied BEFORE any prompt.
  The `/capabilities` panel toggle now has teeth in the broker.
- **dir.* capabilities** (`packages/daemon-protocol/src/dir.ts` + `apps/daemon/src/tools/dir.ts`):
  dir.list_tree (BFS, symlinks recorded never descended) + dir.sync_manifest (sha256). 7 tests.
- **daemon→panel bridge** (`apps/web/.../_canvas/_lib/use-daemon-tool.ts`): ONE module-singleton
  client WS (ws://127.0.0.1, ?token= gate), tool.request→tool.result by requestId, perm.request
  surfaced by envelope id (R-03), 30s timeout. 4 transport tests (fake WS drives the full loop).
  All THREE live panels now consume it:
    · browser-node → browser.navigate + browser.screenshot renders as a data: PNG (jail holds)
    · directory-node → dir.list_tree Refresh button maps the tree into bounded preview rows
    · editor-node → fs.write (Save, risk=write → prompt) + fs.read (Load), parks honestly offline

Verification (00:38 UTC): 7/7 TS packages tsc clean; web 541 canvas tests green; daemon 204 pass /
12 fail — the SAME 12 pre-existing environment tests (real spawn, real fs, real git, Windows
junction realpath), zero regression from sessions/allowlist/dir. Branch tip c96f4b8, pushed.

STILL genuinely pending (user gates or a machine — unchanged):
- Pixel/taste review of every visual surface (D1 gate).
- v1.9 live legs: OAuth, real inbound email, CLUS-07; v1.12 real-mail switch. User console, no code.
- 999.20 nauta infra purge (DB + AWS migration); D2 bless (framing decision).
- Cloud Desktop epoch (999.39 RFC written) — needs a cloud-provisioning account + provider/protocol
  decisions before build. This is VISION E5 (whole-machine remote desktop, not a browser panel).
- Small cleanup seam: reconcile the /capabilities panel's STATIC manifest to mirror the live
  registry (browser.* + dir.* + session.start) — a documented drift seam, not a bug.

## 2026-07-21 ~01:05 UTC — user unblocked A–F; E5 → AWS; deploy authorized

User answered the full gate inventory. Decisions locked:
- **A (UI plugged-in):** audit run — EVERY capability has a UI consumer in apps/web (fs→editor/dir
  panels, browser→browser-node, dir→directory-node, session→/sessions, desktop→desktop-node,
  web_search/deep_research/lookup/search_*→chat tool rows + research-trace). Only `terminal.exec`
  has no dedicated panel — covered anyway by the interactive `/sessions` PTY (superset) + chat tool
  rows. No "backend with no UI" gap. User: assume UI correct if surfaced, keep moving.
- **B (live legs):** user has prod+staging OAuth/email already configured — assume correct, document,
  proceed. No code gate.
- **C (Cloud Desktop provider):** AWS, NOT Hetzner. Constraints: AWS-native, no new subscriptions,
  LEAST latency, realtime Win/Ubuntu feel, least tooling, low-level control, IaC-scalable. AWS creds
  ARE in this env (AWS_ACCESS_KEY_ID/SECRET set). Recommendation to confirm: EC2 + NICE DCV (AWS's
  own remote-display protocol, free on EC2, HW-accel, browser-native, sub-frame latency) — collapses
  3 vendors to 1. gsd-project-researcher dispatched → .planning/research/cloud-desktop/AWS-ARCHITECTURE.md.
  ACTUAL EC2 spawn stays gated on an explicit user budget go-ahead (bills real money).
- **D (D2 bless):** user confused by the ask; it's their own directive — kept, no decision needed.
- **E (infra/launch):** (1) 999.20 infra purge — user does on local machine. (2) single-user NOW but
  build every multi-tenant seam so a public flip is config, not a rewrite. (3) E7 inference — build to
  a production-ready gate; RESEARCH the mid-2026 local-inference wave (deepseek/gemma/unsloth/nvidia/
  bonsai/chrome AI). gsd-project-researcher dispatched → .planning/research/e7-inference/ARCHITECTURE.md.
- **F (deploy):** push to staging `dev`, verify flows headless + screenshot, then `main` (prod).
  Topology: email-listener deploys via CI on push to dev/main (path apps/email-listener/**); web is
  Vercel git-integration (no Vercel token here → deploy = build must compile; Vercel builds on push).
  Plan: clean green feature branch → merge to dev → Vercel staging deploy → headless-screenshot the
  live staging URL → document → report → then prod. Deploy waits on a clean green tree.

In flight: desktop-node agent (task #8, canvas node), AWS-architecture research, E7 research.
