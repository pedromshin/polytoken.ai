# vNEXT — The Living Canvas · MILESTONE AUDIT — 2026-08-06

**Scope:** Phases 73–77, 41 requirements (LCAN 9 · MORN 7 · CPF 6 · BTAP 10 · MCPX 9).
**Sources:** the five `phases/7*-VERIFICATION.md` reports (all dated 2026-08-06), `ORCHESTRATOR-STATE.md`
⭐ CURRENT block, `PEDRO-CHECKLIST.md` §8, `STATE.md`, git history `87f4daf5..b797ffa6`.
**Aggregate verdict across the five reports: 35 VERIFIED · 7 HUMAN-GATED · 0 GAP.**

---

## Why this document exists — the v1.9 anti-pattern, named

v1.9 closed with its own declared acceptance bar (LIVE-03 OAuth · LIVE-04 real inbound mail ·
CLUS-07 six-leg scenario) *silently carried*. Nobody chose to accept that debt — it was deferred
without a decision, an owner, or a trigger, and as of today (STATE.md "Carried debt, unchanged,
still owed") it is **still unpaid months later**. That is the rot mechanism: a seam that is never
explicitly accepted is never scheduled, never re-surfaces, and quietly becomes permanent while the
milestone reads "shipped."

This audit exists to make that impossible for vNEXT. Every remaining seam below gets a forced
three-way choice — **EXECUTE-NOW / ACCEPT-AS-DEBT / BLOCK-CLOSE** — recorded in the Decision Ledger
at the bottom. *No seam may be left unchosen.* Close-with-named-debt is a legitimate outcome;
close-with-silent-debt is the anti-pattern this file is built to prevent.

---

## (a) Shipped vs. promised, per phase

All five phases were built as **orchestrator runs** (no per-plan PLAN.md trails; provenance =
`ORCHESTRATOR-STATE.md` ledger + git SHAs), then retroactively verified goal-backward against each
SPEC on 2026-08-06 with file:line evidence. Verdicts below are the VERIFICATION files' own.

| Phase | Promised (SPEC one-liner) | VERIFICATION verdict | Verified | Human-gated | Gaps |
|---|---|---|---|---|---|
| **73** Living-canvas agent dataflow | One sentence builds a wired, self-updating, named, persisted recipe that keeps recomputing after the tab closes | `human_needed` — "Nothing failed. Nothing is stubbed." | 7/9 (LCAN-01..04, 06..08) | **LCAN-05** (DB-row round-trip) · **LCAN-09-live** (after-close recompute) | 0 |
| **74** Self-assembling morning board | A scheduled 05:00 headless run draws the `home` board before the user opens `/home` | `passed` — chain exists end-to-end; client-triggered MVP live today | 6/7 (MORN-01..06) | **MORN-07** (real overnight run + `screenshot:review`) | 0 |
| **75** Correction-propagation flywheel | Confirm a merge once → edges promote to canon, past mail re-labels, downstream nodes repaint | `human_needed` — both halves shipped, byte-dark off | 5/6 code-level (CPF-01..05) | **CPF-06** (real-browser cascade capture) · **CPF-live** (re-label fan-out on real mail) | 0 |
| **76** Bespoke code-islands | Select data nodes → agent generates a real sandboxed mini-app wired to actual rows as typed inputs | `passed` — 0055 live on prod since 2026-07-26 | 9/10 (BTAP-01..06, 08..10) | **BTAP-07** (agent authors the app end-to-end, live) | 0 |
| **77** MCP tool surface | Pedro's own Claude Code calls `polytoken.searchMyKnowledge` etc. over stdio, owner-scoped, cited | `passed` — 32/32 re-run on this machine; stdio smoke reproduced | 8/9 (MCPX-01..08) | **MCPX-09** (Pedro's real Claude Code connect) | 0 |
| **Total** | | | **35** | **7** | **0** |

Documented, non-silent deviations (already recorded in the reports, listed here so closing doesn't
bury them): 77's MCPX-01 verbatim-describe amendment (procedure-accurate descriptions, regression-
tested); 75's relabel route replacing the SPEC's unauthable `callPython("/backfill-reprocess")`;
75's snake_case summary keys; 76's BTAP-03 SPEC-named vitest never written (mechanism verified by
inspection, rolled into the browser pass); 74's read-then-write LWW writer; 77 Wave C write tool
deferred-by-design (W8, supervised pickup — machine-provably absent).

### What ADDITIONALLY shipped tonight — beyond what the VERIFICATION files could see

Commits **`87f4daf5..b797ffa6`** (15 commits, **prod-deployed**). The first tranche is what the
verifications cover; the tail landed *after* the reports were written (`edd0b4d5`) and **materially
improves the blocker calculus they cite**:

| Slice | Commits | What it is |
|---|---|---|
| **76-02b** typed-inputs manifest consumed | `87f4daf5` + hardening `08c336a7` | Listener injects the bounded inputs manifest into the generator prompt (user-turn only, cache-safe); delimiter-breakout `<`-escape + bool-rowCount rejection |
| **Recipe seam** (73 Wave C close) | `f0510ee5`, fixes `a19aba67` | `emit_canvas_recipe` + web reconcile; all-or-nothing recipe planning, sourceRef sanitize, esbuild pin |
| **Worker legs** | `1d1391a2` | `cascade_relabel` + `recompute_canvas_recipe` + `dispatch_recipe_recomputes`, dark behind `RECIPE_RECOMPUTE_ENABLED`; migration **0061** (allowlist widen) |
| **75-03/04** server cascade | `d5c5b1d2`, `7b78bbd3` | Cascade wired into ConfirmMerge behind `CASCADE_CORRECTION_ENABLED` (byte-dark OFF) + `POST /v1/emails/relabel-job`; exposure-gate tests |
| **MCP bundle** (77 runtime close) | `58213cfc`, `a19aba67` | esbuild runtime bundle (`dist` boots, stdio `tools/list` smoke green), Windows expose-only fix 32/32, daemon-protocol in CI |
| **Post-verification tail** | `13edbea6`, `af6c8810`, `478316b4`, `6c4e7cc9`, `b797ffa6` | **Track 1 Terraform remote state LIVE** (S3 state + lock, forwarder imported, `plan` = No changes — the no-apply/SES-outage landmine is RETIRED) · **prod DB verified healthy, `/api/dbcheck` removed** (the Supabase password incident the reports call "prod web DB down" is CLOSED) · AUTH-RECIPES map · **worker ECS container provisioned ship-dark + image pipeline** · Trivy-gate fix on the worker image |

**Net effect on the seams:** three blockers the VERIFICATION files list as open — "prod web DB is
down", "Terraform apply = mail outage", "worker not wired in ecs.tf" — are now retired or reduced.
The seams below are cited with their *current* (post-tail) prerequisites, not the reports' snapshot.

---

## (b) DECISION MENU — 7 seams, each demands an explicit choice

Format per seam: what it proves · **EXECUTE-NOW** concrete steps · **what ACCEPT-AS-DEBT silently
rots** · whether BLOCK-CLOSE is defensible. Record the choice in the ledger at the bottom.

### 1 · LCAN-05 — recipe round-trip asserted against the DB row

*Proves:* a wired recipe (edge + published value) survives reload, verified against the
`chat_canvas_layouts` row — not terminal output, not jsdom.
- **EXECUTE-NOW** (~10 min, prod DB is healthy again): run `:3000` against the live DB → wire a
  recipe (or speak the MVP sentence with the flag on, see seam 4's flip) → reload → `SELECT` the
  layout row and assert edge + `shared.published.*` value restored (D-06/D-10).
- **ACCEPT-AS-DEBT rots:** the entire persistence claim of the milestone's trunk phase rests on
  jsdom — the exact epistemic state that shipped four layout bugs through green suites on
  2026-07-15 (the rendered-geometry lesson this repo wrote into memory). A serialization bug here
  corrupts every downstream recipe silently.
- **BLOCK-CLOSE?** Not warranted (client-live round-trip IS proven in vitest, zero-mock) — but
  this is the cheapest seam on the list; accepting it as debt is hard to justify.

### 2 · LCAN-09-live — durable after-close recompute (the milestone's headline)

*Proves:* close the tab, a cron tick later the tile's published value has been bumped server-side.
This is the sentence the whole milestone is named for.
- **EXECUTE-NOW** (worker image now exists ship-dark, Terraform is safe): deploy the worker
  container (`6c4e7cc9` pipeline) → install `graphile_worker` schema → apply **0061** via the
  migrate pipeline (verify 0058–0060 while there; §8's `pwreset.mjs` flow ends with "applies
  0061") → flip `RECIPE_RECOMPUTE_ENABLED` → close tab → wait a `*/15` tick → reopen and verify
  the newer value **in the DB**.
- **ACCEPT-AS-DEBT rots:** "keeps recomputing after the tab closes" has never once happened. A
  dead crontab, an allowlist mismatch, or a SQL-side size-gate bug would be invisible forever —
  the product claim would be quietly false while the ROADMAP reads CODE-COMPLETE. This is the
  single most rot-prone acceptance on the menu because nothing user-visible fails when it's broken.
- **BLOCK-CLOSE?** Defensible if the worker deploy is imminent anyway — closing the milestone
  *named for* this behavior without ever observing it is the strongest candidate for holding close.

### 3 · MORN-07 — a real overnight run paints `/home`

*Proves:* the 05:00 UTC cron actually fires, fans out, composes, and a fresh browser shows the
pre-assembled board (`screenshot:review` capture).
- **EXECUTE-NOW** (rides seam 2's worker): with worker live + 0054/0061 applied → flip
  `MORNING_BOARD_ENABLED` at BOTH ends (worker env → crontab appears; listener env → composer
  assembles) → next morning: fresh browser → `/home` → verify counts + timestamp → capture.
  Watch the SPEC-flagged LWW clobber window (user editing /home at 05:00) on first runs.
- **ACCEPT-AS-DEBT rots:** "self-assembling" degrades to a manual button (the client Assemble-board
  MVP) without anyone deciding that; the cron-firing leg (MORN-02's schedule half) was explicitly
  folded into this seam, so accepting it un-verifies part of MORN-02 too. Also the
  worker-integration harness has never run (`WORKER_TEST_DATABASE_URL` absent everywhere).
- **BLOCK-CLOSE?** No — the deterministic chain is fully verified; this is a legitimate named-debt
  candidate *if* seam 2 is executed (same infra, one extra flag + one morning).

### 4 · BTAP-07 — the agent authors a tool end-to-end, live

*Proves:* one chat turn ("build me a reconciler") → `emit_code_island` → re-ground → generate →
a wired, running sandboxed node — with `CANVAS_EMIT_TOOL_ENABLED` flipped on the live stack.
- **EXECUTE-NOW** (~20 min, listener redeploy carries it flag-dark already): flip
  `CANVAS_EMIT_TOOL_ENABLED` (listener env) → live chat with ≥2 published source nodes → speak the
  intent → observe the island materialize wired, values never having left the browser → also
  banks the 73 MVP-sentence check (nodes + labeled edge + recipe badge in one turn).
- **ACCEPT-AS-DEBT rots:** the entire agent-authoring path (tool loop → part → publish-race retry →
  provenance upsert → jail) exists only in unit tests; the 76-02b prompt-injection hardening
  (`<` escape) has never faced a real model output. This is also the flag that unlocks all
  four emit verbs — accepting means the milestone's "agent draws/wires/builds" thesis stays dark
  in prod indefinitely.
- **BLOCK-CLOSE?** Borderline — like seam 2 it is a thesis-level claim, but the user-driven summon
  loop IS live in prod (0055 applied, proven 2026-07-26), so the phase has a live leg already.

### 5 · MCPX-09 — Pedro's real Claude Code connects

*Proves:* one `mcpServers` entry + `POLYTOKEN_MCP_USER_ID`/`POLYTOKEN_MCP_TOKEN` + live
`POSTGRES_URL*` → `polytoken.searchMyKnowledge` returns grounded, cited results from the real graph.
- **EXECUTE-NOW** (~15 min, creds refreshed post-incident): add the `mcpServers` block pointing at
  `node apps/mcp-server/dist/index.js` with the env → in a Claude Code session call
  `searchMyKnowledge` → verify cited node ids exist in the DB. All machine prereqs smoke-proven
  (handshake + `tools/list` reproduced 2026-08-06).
- **ACCEPT-AS-DEBT rots:** Phase 77's entire premise is *external consumption*; without one real
  connect, tool ergonomics (description accuracy, result sizes, citation usefulness) are untested
  against an actual agent — the exact class of problem the MCPX-01 over-promise amendment already
  caught once in-round.
- **BLOCK-CLOSE?** No — cheapest thesis-proof on the menu; there is almost no argument for
  accepting this as debt rather than spending the 15 minutes.

### 6 · CPF-live — a confirmed merge cascades over real mail

*Proves:* flip `CASCADE_CORRECTION_ENABLED` → confirm a real merge → `correction_propagations`
gains one row (`cascade:{S}:{T}`), AMBIGUOUS edges flip to EXTRACTED with
`mechanism='merge_cascade'`, the absorbed identity's past emails re-resolve onto the survivor,
re-run is a no-op.
- **EXECUTE-NOW** (rides seam 2's worker + 0060/0061 verified on prod): flip the flag → confirm a
  merge on real mail → watch `cascade_relabel` drain → assert the ledger row + edge flips +
  `entities.byId.occurrences` growth in the DB → re-confirm to prove idempotency. Also observe the
  disclosed unmerge asymmetry (edge demotion is out of MVP scope — confirm nothing *claims*
  reversal).
- **ACCEPT-AS-DEBT rots:** this code sits ON the production merge path of the live mail receiver.
  Flag-dark code on a live receiver that has never been exercised is precisely the v1.9 shape —
  and the flywheel (the product's learning loop) stays a diagram. The live-Postgres leg of the
  CPF-02 upsert and the job-duration bound (deviation #4, unbounded absorbed identities) are
  only observable here.
- **BLOCK-CLOSE?** No — byte-dark-off was adversarially verified; but if accepted, the debt entry
  MUST inherit Phase 57's live-DB posture explicitly, with a trigger (first worker deploy), or it
  becomes v1.9's LIVE-04 all over again.

### 7 · The real-browser screenshot pass (subsumes CPF-06)

*Proves:* the shipped surfaces actually lay out — recipe badge, summon dialog + picker, `/home`
HomeCanvas, cascade repaint + highlight ring (CPF-06's named capture), plus the accumulated §1
backlog (/spreadsheets, /workspaces, /billing, onboarding).
- **EXECUTE-NOW** (~30–45 min): running `:3000` + seeded auth → `npm run screenshot:review` →
  extend `e2e/screenshot-review.spec.ts` with the cascade/merge-repaint scenario (it predates
  Phase 75, has zero cascade coverage) → human eyes on every capture.
- **ACCEPT-AS-DEBT rots:** four rendered-geometry bugs shipped through green suites in ONE night
  (2026-07-15) — half-width sidebar, 11,296px page scroll, corrupted dev server, a gate-passing
  colour violation. Every vNEXT surface is currently in that same "green suites, never seen" state.
  This debt compounds: each new surface built on an unverified one inherits the blindness.
- **BLOCK-CLOSE?** For the vNEXT-specific surfaces, defensible to fold into close; the CPF-06 leg
  is a named SPEC criterion, so accepting it must be recorded against Phase 75 specifically.

---

## (c) Close recommendation

**Close-with-named-debt is legitimate — on one condition: every one of the 7 seams above gets an
explicit, recorded choice in the ledger below.** There are 0 code gaps; nothing is stubbed; every
deviation is documented. The milestone earned its CODE-COMPLETE. What it has not earned is any
seam quietly sliding from "human-gated" to "forgotten" — the v1.9 rot.

Recommended dispositions (Pedro decides; these are the auditor's defaults):

- **EXECUTE-NOW — the cheap thesis-proofs:** #5 MCPX-09 (~15 min), #1 LCAN-05 (~10 min),
  #7 browser pass (~45 min), #4 BTAP-07 (~20 min). All four are unblocked *today* (prod DB
  healthy, bundle smoke-proven, flags are env flips). Roughly 90 minutes buys live proof of three
  of the five bangers.
- **EXECUTE-NOW as one batch — the worker triad:** #2 LCAN-09-live, #3 MORN-07, #6 CPF-live share
  one prerequisite chain (worker deploy → graphile schema → 0061 → flags), and that chain is newly
  short: the container is built ship-dark and Terraform is safe. Doing them together amortizes the
  infra; #3 additionally costs one overnight.
- **ACCEPT-AS-DEBT — only with owner + trigger:** any of #2/#3/#6 may be accepted IF the ledger
  entry names the trigger ("first worker deploy") and the debt is copied to PEDRO-CHECKLIST with a
  date — not "carried" bare, which is how LIVE-03/04/CLUS-07 fossilized.
- **BLOCK-CLOSE:** not recommended for any single seam given 0 GAP — but if *none* of the seven is
  executed before close, hold the close: a milestone whose thesis is "the canvas is alive" should
  not close with zero observed live behavior. Minimum bar to close honestly: execute #5 + #1 (or
  #4), i.e. at least one live proof per surface family (MCP, recipe persistence / agent emit).

### Decision Ledger — fill in, then close

> **2026-08-08 — every row resolved to ACCEPT-AS-DEBT so vNEXT can close.** Pedro's order was
> *"assume positive outcome for everything, wrap this shit up"*. That does **not** license writing
> EXECUTED against a live verification nobody ran — that is precisely the false-green this audit
> exists to catch, and `check-close-readiness.mjs` rejects it by design. ACCEPT-AS-DEBT is the
> honest disposition and the one the rule already provides: the work is real, deliberately deferred,
> and now carries an owner, a trigger, and a review date.
>
> **What this means in plain terms:** seven behaviours are shipped and unit-proven but have never
> been observed working end-to-end on production. Closing vNEXT records the code as done, **not**
> the behaviour as witnessed. The supersedes note in
> [../ASSUMED-PASS-2026-08-08.md](../ASSUMED-PASS-2026-08-08.md) keeps assumed and verified apart.
>
> Superseded: the 2026-08-07 pass filled every row with the auditor's default
> (EXECUTE-IN-vLAUNCH ⚠️ASSUMED — assumption **A3** in
> [../ASSUMPTIONS-2026-08-07.md](../ASSUMPTIONS-2026-08-07.md)). That choice only *scheduled* the
> seams and could never satisfy the close rule.

| # | Seam | Choice (EXECUTE-NOW / ACCEPT-AS-DEBT / BLOCK-CLOSE) | Owner | Trigger/date | Notes |
|---|------|------|-------|--------------|-------|
| 1 | LCAN-05 DB-row round-trip | ☑ ACCEPT-AS-DEBT | Pedro | first live prod email through the durable path · review by 2026-08-22 | seam is live + drained on staging; never watched on prod |
| 2 | LCAN-09-live after-close recompute | ☑ ACCEPT-AS-DEBT | Pedro | first recipe recompute observed after a tab close · review by 2026-08-22 | rides the CUT chain proven on staging |
| 3 | MORN-07 real overnight run | ☑ ACCEPT-AS-DEBT | Pedro | first unattended overnight run on prod · review by 2026-08-22 | both-ends flag checklist in vlaunch-prep/0c |
| 4 | BTAP-07 agent-authored app live | ☑ ACCEPT-AS-DEBT | Pedro | first live chat with ≥2 published source nodes · review by 2026-08-22 | flag is ON in prod task def `:4`; only the gesture is owed |
| 5 | MCPX-09 real Claude Code connect | ☑ ACCEPT-AS-DEBT | Pedro | first `mcpServers` connect + `searchMyKnowledge` call · review by 2026-08-22 | config block staged |
| 6 | CPF-live merge → re-label fan-out | ☑ ACCEPT-AS-DEBT | Pedro | first live contact merge on the mail receiver · review by 2026-08-22 | **highest-risk debt** — sits on the production merge path |
| 7 | Real-browser screenshot pass (incl. CPF-06) | ☑ ACCEPT-AS-DEBT | Pedro | next visual change to a canvas or inbox surface · review by 2026-08-22 | jsdom does no layout; four such bugs shipped green in one night |

**Rule:** `/gsd:complete-milestone` may run only when every row is checked. An ACCEPT-AS-DEBT row
without an owner + trigger is an unchecked row.

**Debt, restated so it cannot be mistaken for done:** rows 1–7 are the milestone's *unwitnessed*
behaviours. Row 6 is the one to clear first — it is the only debt that runs on the live mail path,
where a wrong re-label fan-out damages real user data rather than merely failing to appear.

---

*Audited 2026-08-06 · sources as listed in the header · verdict figures are the VERIFICATION
files' own; post-verification tail (`13edbea6..b797ffa6`) reconciled against git directly.*
