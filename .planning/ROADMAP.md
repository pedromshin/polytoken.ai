# Roadmap: nauta.services.email-listener

## Milestones

- ✅ **v1.0 — MVP** (Phases 1–11) — inbound email → parse → extract → entities/knowledge (shipped; phase dirs retained under `.planning/phases/`, lifecycle not formally run).
- ✅ **v1.1 — Generative UI Engine** (Phases 12–15) — spec-first Catalog→Spec→Registry→Renderer→Generation→Cache→Studio. Archived: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
- ✅ **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) — SHIPPED 2026-07-03. Eval harness + style packs + catalog expansion + declarative form engine + jailed-eval code-island (multi-candidate + judge). Archived: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Audit: [milestones/v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md).
- ✅ **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25) — SHIPPED 2026-07-06. Persistent streamed `/chat` on a 2D infinite canvas of genui panels with bidirectional (agent↔user) interactive widgets, plus an anticipatory-prompting spike. Local/sandbox only. Archived: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) · Audit: [milestones/v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md).
- ✅ **v1.4 — Chat & Studio Design Uplift** (Phases 26–28) — SHIPPED 2026-07-07. A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome — zero new npm dependencies — executing the locked 3-phase punch list (zero-dep contract fixes → adopted external picks → design-system token upgrades). Archived: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) · Audit: [milestones/v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md).
- ✅ **v1.5 — Knowledge-Graph Uplift** (Phases 29–32) — SHIPPED 2026-07-08. Activated the dormant knowledge-graph substrate: confirms materialize confidence-tiered edges (OCR token provenance) through a suggest-only promotion gate; cheap alias/identifier recall + a measurable retrieval-miss-rate gate for stage 3; `/knowledge` tiered exploration canvas (encoding, bounded expand, filter, promote). Archived: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md) · Audit: [milestones/v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md).
- ✅ **v1.6 — Chat × Knowledge Convergence** (Phases 33–41) — SHIPPED 2026-07-09. The chat agent reads its own extracted data: bounded mid-turn tool loop + 3 tiered knowledge tools with structural injection quarantine, per-round cost ceilings, visible tool rounds with citation chips, live data-bound panels, chat-confirmable promotions, and a knowledge-preview canvas node. Archived: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md) · Audit: [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md).
- ✅ **v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy** (Phases 42–46) — SHIPPED 2026-07-10. Atomic internal rename nauta → polytoken, Google OAuth + sessions (Supabase Auth), enforced per-user tenancy (app-boundary primary + RLS defense-in-depth, adversarially gated), email threads at ingest + personal-forwarding seam, hygiene folds + decision-ready v1.8 dossier. Archived: [milestones/v1.7-ROADMAP.md](milestones/v1.7-ROADMAP.md) · Audit: [milestones/v1.7-MILESTONE-AUDIT.md](milestones/v1.7-MILESTONE-AUDIT.md).
- ✅ **v1.8 — Polytoken Re-skin — Brand & Design-System Foundation** (Phases 47–48; scope cut) — SHIPPED 2026-07-10. Polytoken brand identity (voice, logo, guide; naming USER-LOCKED to polytoken/polytoken.ai) + Playwright/screenshot verification toolchain, and token-system extensions on the EXTENDED v1.4 token system (pill radius, success color, code typography, tier-ladder + graph node/edge-type tokens, hover/active convention, breakpoint decision). Opened as Phases 47–51; user-directed scope cut ended it at Phase 48 with 12/12 in-scope requirements — RSKN/MOBL/PANL (11 requirements) moved to v1.9 per [research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md). Archived: [milestones/v1.8-ROADMAP.md](milestones/v1.8-ROADMAP.md) · Audit: [milestones/v1.8-MILESTONE-AUDIT.md](milestones/v1.8-MILESTONE-AUDIT.md).
- ◆ **v1.9 — Cloud Workspace** (Phases 49–54) — OPENED 2026-07-10. Band 1 Live-Loop Gate (local stack green end-to-end, staging/prod migrations 0026–0035, OAuth + SES forwarding runbooks → the user's real email flowing, deferred-UAT burn-down) gates Band 2 (total UI re-skin + backlog 999.16, editable genui panels, mobile-responsive answer) and Band 3 (E3 email-cluster workflow, depth-first, proven live on the user's real inbox). Plan of record: [research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md) §2 (Epoch A).

## Phases

**Phase Numbering:**

- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. v1.4 ran Phases 26–28. v1.5 ran Phases 29–32.
  v1.6 ran Phases 33–41. v1.7 ran Phases 42–46. v1.8 ran Phases 47–48 (scope cut; opened as
  47–51). **v1.9 runs Phases 49–54** — the ex-49/50/51 seed specs (goal/success-criteria text)
  carried forward onto the new Phases 51–53; the actual numbers were reassigned so the Band 1
  Live-Loop Gate could take 49–50 (ENDGAME-PLAN.md §2's hard ordering constraint: Band 1 gates
  every Band 2/3 phase).

- Decimal phases (e.g. 49.1): urgent insertions via `/gsd:phase insert`, executed between the
  surrounding integers.

<details>
<summary>✅ v1.2 — Generative UI: Realism & Interactivity (Phases 16–20) — SHIPPED 2026-07-03</summary>

- [x] Phase 16 — Studio Foundation: Eval Harness + History/Page-Ideas Tabs
- [x] Phase 17 — Tier A: Design-Token/Theme Layer + Style Packs + Assembly RAG
- [x] Phase 18 — Tier A: Catalog Expansion
- [x] Phase 19 — Tier B-1: Declarative (zero-eval) Form Engine
- [x] Phase 20 — Tier B-2: Sandboxed Code-Island (jailed-eval; SPIKE→phase; +Phase-21 multi-candidate/judge, cost guard)

Full detail: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Audit `tech_debt`, 0 gaps;
15 connected-env/browser verifications deferred (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.1 — Generative UI Engine (Phases 12–15) — SHIPPED 2026-06-27</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

</details>

<details>
<summary>✅ v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel (Phases 22–25) — SHIPPED 2026-07-06</summary>

- [x] Phase 22 — Chat Spine + Persistence + Streaming (11/11 plans) — completed 2026-07-04
- [x] Phase 23 — 2D Canvas + Panels-as-Nodes + Shared State (6/6 plans) — completed 2026-07-05
- [x] Phase 24 — Dual-Channel GenUI (4/4 plans) — completed 2026-07-06
- [x] Phase 25 — Anticipatory Prompting (SPIKE) (3/3 plans) — completed 2026-07-06

Full detail: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md). Audit `tech_debt`, 0 gaps,
24/24 requirements satisfied + cross-phase integration verified; 6 connected-env/browser
verifications deferred (STATE.md → Deferred Items). SPIKE verdict: ship-with-conditions
(25-SPIKE-FINDINGS.md).

</details>

<details>
<summary>✅ v1.4 — Chat & Studio Design Uplift (Phases 26–28) — SHIPPED 2026-07-07</summary>

- [x] Phase 26 — Zero-Dependency Contract Fixes + Backlog Polish (7/7 plans) — completed 2026-07-06
- [x] Phase 27 — Adopted External Design Picks (5/5 plans) — completed 2026-07-07
- [x] Phase 28 — Design-System Token Upgrades (3/3 plans) — completed 2026-07-07

Full detail: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md). Audit `tech_debt`, 0 gaps:
23/23 requirements + 18/18 integration seams (one FIX-02 primitive leak closed at audit e9faa55);
deferred: browser/OS visual checks + 1 pending todo (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.5 — Knowledge-Graph Uplift (Phases 29–32) — SHIPPED 2026-07-08</summary>

- [x] Phase 29 — Tier Ladder + Edge Materialization (4/4 plans) — completed 2026-07-07
- [x] Phase 30 — Suggest-Only Promotion Gate (2/2 plans) — completed 2026-07-07
- [x] Phase 31 — Recall & Measurement (2/2 plans) — completed 2026-07-07
- [x] Phase 32 — Knowledge Canvas: Tiered Graph Exploration (3/3 plans) — completed 2026-07-08

Full detail: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md). Audit `tech_debt`, 0 gaps:
11/11 requirements + 6/6 integration seams WIRED. Deferred: 2 human_needed live-env verification
gaps (Phases 29/32) + 2 pending todos (STATE.md → Deferred Items). Stage-3 graph work (KGX-01..03)
stays gated behind the retrieval-miss-rate artifact (`packages/db/scripts/retrieval-miss-rate.ts`).

</details>

<details>
<summary>✅ v1.6 — Chat × Knowledge Convergence (Phases 33–41) — SHIPPED 2026-07-09</summary>

- [x] **Phase 33: Live Bindings Plumbing** - Genui canvas panels render live product data via `spec.bindings`, resolved through a compile-time allowlist switch, staying fresh via staleTime tiers + event-driven invalidation — zero renderer edits (completed 2026-07-08)
- [x] **Phase 34: Tool-Loop Mechanics (stub/echo executor)** - Chat agent runs a bounded (≤4-round) mid-turn tool loop against a stub/echo `ToolExecutor`, proving the round mechanics and fixing 2 latent bugs, before any real tool exists (completed 2026-07-08)
- [x] **Phase 35: Cost + Eval Scaffolding** - A per-round cost ceiling with fail-closed abort semantics is enforced on the FOUND-3 ledger, and retrieval-quality/citation-faithfulness/injection-resistance become measurable Phase-16 harness dimensions — both built against Phase 34's stub (completed 2026-07-08)
- [x] **Phase 36: Thin-Wrapper Tools** - User can ask about a known entity or find related emails from chat via `lookup_entity`/`search_emails`, thin wrappers over existing repos with zero new backend (completed 2026-07-08)
- [x] **Phase 37: Knowledge Search + Python Read-Side** - User can search or expand the knowledge graph from chat via `search_knowledge`, backed by a NEW Python `KnowledgeGraphRepository` + a DB-level `extracted_only` view — built but not yet exposed to users (completed 2026-07-09)
- [x] **Phase 38: Quarantine + Adversarial Eval** - Every wired `ToolExecutor` structurally enforces tier-filtered envelopes, proven against an adversarial fixture suite + live-model harness; `search_knowledge` becomes safely user-facing (completed 2026-07-09)
- [x] **Phase 39: Tool-Round UI + Citation Chips** - `/chat` visibly surfaces in-progress tool rounds and renders citation chips through one shared `<ProvenanceLink>` primitive (completed 2026-07-09)
- [x] **Phase 40: Confirm-Action Widgets** - Agent can end a turn with a confirm-action widget letting a human promote/reject a knowledge suggestion, over the existing Phase-24 CAS spine, with an edge-tier staleness re-check (completed 2026-07-09)
- [x] **Phase 41: Knowledge-Preview Canvas Node** - User can place a bounded, non-interactive knowledge-graph preview on the `/chat` canvas that deep-links out to `/knowledge` (completed 2026-07-09)

Full phase details: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md) · 20 plans, 45 tasks · 19/19 requirements · audit tech_debt (0 blockers).

</details>

<details>
<summary>✅ v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy (Phases 42–46) — SHIPPED 2026-07-10</summary>

- [x] Phase 42: Atomic Rename nauta → polytoken (2/2 plans) — completed 2026-07-09
- [x] Phase 43: Auth — Google OAuth + Sessions (Supabase Auth) (5/5 plans) — completed 2026-07-10
- [x] Phase 44: Tenancy — user_id Scoping + Enforced Isolation (9/9 plans incl. gap-closure 44-09) — completed 2026-07-10
- [x] Phase 45: Email Threads + Forwarding Seam (6/6 plans) — completed 2026-07-10
- [x] Phase 46: Kickoff Hygiene + v1.8 Brand & Design Dossier (3/3 plans) — completed 2026-07-10

Full detail: [milestones/v1.7-ROADMAP.md](milestones/v1.7-ROADMAP.md). Audit `tech_debt`, 0 blockers:
19/19 requirements, 9/9 integration seams WIRED, 3/3 E2E flows. Deferred: 3 todos + 2 UAT files
(11 scenarios, mostly OAuth/SES-gated) + user runbooks (external rename, Google OAuth, forwarding)

+ staging/prod migrations 0031–0035 (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.8 — Polytoken Re-skin — Brand & Design-System Foundation (Phases 47–48) — SHIPPED 2026-07-10 (scope cut)</summary>

- [x] Phase 47: Brand Foundation + Verification Tooling (5/5 plans) — completed 2026-07-10
- [x] Phase 48: Token-System Extensions (5/5 plans) — completed 2026-07-10

Scope cut 2026-07-10 (user-directed): originally Phases 47–51 / 23 requirements; ended at Phase 48
with 12/12 in-scope requirements complete. RSKN/MOBL/PANL (11 requirements) moved to v1.9 — their
ex-Phase-49/50/51 seed specs are preserved verbatim in [milestones/v1.8-ROADMAP.md](milestones/v1.8-ROADMAP.md)
and mapped forward by [research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md).
Audit `tech_debt`, 0 blockers: 12/12 requirements, 8/8 integration seams WIRED, 127/127 regression
tests re-run live at audit. Deferred: 3 HUMAN-UAT items + 2 carried todos + W-1 harness-surface
warning — every one with a designated v1.9 Band-1/re-skin-band landing spot (STATE.md → Deferred Items).

Full detail: [milestones/v1.8-ROADMAP.md](milestones/v1.8-ROADMAP.md) · Audit: [milestones/v1.8-MILESTONE-AUDIT.md](milestones/v1.8-MILESTONE-AUDIT.md).

</details>

## v1.9 — Cloud Workspace (Phases 49–54) — CURRENT

**Goal:** polytoken becomes a *used* product — the live loop closes on the user's real email FIRST,
then the total re-skin/mobile/editable-panels land, then the E3 email-cluster workflow ships
depth-first as ONE fully-working scenario on the user's real inbox. Plan of record:
[research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md) §2 (Epoch A).

**Ordering (hard constraint, ENDGAME-PLAN.md §2):** Band 1 (Phases 49–50) gates everything — no
Band 2/3 phase starts before it is green. Within Band 2, RSKN (Phase 51) precedes MOBL (Phase 53);
PANL (Phase 52) depends only on Phase 48's token/pack machinery and is parallelizable with RSKN;
mobile runs last. Band 3 (CLUS, Phase 54) needs only Band 1 complete and its backend work may
interleave in execution with Band 2, but is sequenced as the final phase — CLUS-07's live
end-to-end scenario on the user's real inbox is the milestone's acceptance bar. Ex-Phase-49/50/51
seed specs (goal/success-criteria text) reused from
[milestones/v1.8-ROADMAP.md](milestones/v1.8-ROADMAP.md) §49–51; ex-49 discuss context:
[phases/51-total-ui-re-skin/51-CONTEXT.md](phases/51-total-ui-re-skin/51-CONTEXT.md).

- [ ] Phase 49: Live-Loop Gate — Deploy, OAuth & Real Email
- [x] Phase 50: Live-Loop Gate — UAT Burn-down & Screenshot Coverage (completed 2026-07-11)
- [x] Phase 51: Total UI Re-skin (completed 2026-07-11 — BLOCKER: 51-07 Tasks 2/3 not yet verified, see below)
- [x] Phase 52: Editable Genui Panels / Studio-on-Canvas
 (completed 2026-07-12)
- [x] Phase 53: Mobile-Responsive Answer (completed 2026-07-12)
- [x] Phase 54: Email-Cluster Workflow (E3) (completed 2026-07-12)

### Phase 49: Live-Loop Gate — Deploy, OAuth & Real Email

**Goal:** The live loop is technically operational — the app runs green locally, is deployed on
migrated infrastructure, the user can sign in with their real Google account, and their real email
flows into polytoken.
**Depends on:** Nothing (first phase of v1.9; picks up where v1.8 Phase 48 left off)
**Requirements:** LIVE-01, LIVE-02, LIVE-03, LIVE-04, LIVE-07
**Success criteria:**

1. The local stack runs green end-to-end (login → inbox → thread → email detail → chat with tool rounds → genui panel → /knowledge) via a documented, reproducible start procedure — no zombie-process ambiguity, verified against the DB not the terminal
2. Migrations 0026–0035 are applied to staging AND production and live-verified; ECS + Vercel deploys are green on the renamed codebase
3. GOOGLE-OAUTH-RUNBOOK.md is executed (user console steps as in-phase checkpoint tasks); the user signs in to the deployed app with their real Google account, the session persists across reload, and sign-out works
4. FORWARDING-RUNBOOK.md + the SES rule are wired; a real forwarded message lands in polytoken, threads group correctly, and attachments are stored
5. External-identity leftovers are decided, not parked: EXTERNAL-RENAME-RUNBOOK.md items are executed or explicitly re-parked by the user, and the local Supabase nauta→polytoken project-id decision is recorded

**Plans:** 5/6 plans executed

Plans:
**Wave 1**

- [x] 49-01-PLAN.md — Local stack green: RUN-LOCAL.md + preflight script + fresh-DB actualization (LIVE-01, LIVE-07)
- [x] 49-02-PLAN.md — SES forwarding catch-all terraform rule + read-only plan proof (LIVE-04 prep)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 49-03-PLAN.md — DB-verified local end-to-end green-path (seeded-session Playwright) (LIVE-01)
- [x] 49-04-PLAN.md — Staging+prod migrations 0026–0035 + ECS/Vercel deploys green (LIVE-02)
- [x] 49-05-PLAN.md — External-identity decisions recorded + Vercel rename + JWT audit fold-in (LIVE-07)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 49-06-PLAN.md — CHECKPOINT: morning checklist + OAuth + forwarding round-trip + GitHub rename (LIVE-03, LIVE-04, LIVE-07)

### Phase 50: Live-Loop Gate — UAT Burn-down & Screenshot Coverage

**Goal:** Every capability shipped since v1.2 is confirmed working live, not just code-verified, and
the screenshot-verification harness covers the surface it was missing.
**Depends on:** Phase 49 (auth-gated UAT scenarios need a live OAuth session to execute)
**Requirements:** LIVE-05, LIVE-06
**Success criteria:**

1. Every open scenario in 39/41/43/45/47/48-HUMAN-UAT.md is executed via `/gsd:verify-work` and closed or converted to a tracked fix — none remain silently parked
2. Auth-gated scenarios among them execute for real now that Phase 49 produced a live OAuth session
3. The screenshot-review harness (47-05) covers `/emails/[id]` (closing todo W-1) and captures authenticated surfaces using a seeded session instead of falling back to textual before/after artifacts

**Plans:** 5/5 plans complete
- [x] 50-01-PLAN.md — LIVE-06: extend the screenshot harness with /emails/[id] + seeded-session capture (real authenticated pixels)
- [x] 50-02-PLAN.md — LIVE-05: chat-surface burn-down (39 tool-round/chips + 41 knowledge-preview node)
- [x] 50-03-PLAN.md — LIVE-05: auth + inbox/threads burn-down (43 session/sign-out + 45 thread grouping)
- [x] 50-04-PLAN.md — LIVE-05: visual/token-surface burn-down (48 chip/success/graph-tier + 47 brand mark)
- [x] 50-05-PLAN.md — LIVE-05: 50-UAT-BURNDOWN.md roll-up + morning-checklist appends (zero silently parked)

### Phase 51: Total UI Re-skin

**Goal:** Every major product surface — chat, inbox, knowledge canvas, studio, settings, login —
speaks the polytoken register on the extended token system, with token discipline holding
throughout, including the off-token stragglers the Phase-48 audit found.
**Depends on:** Phase 48 (v1.8 — consumes tier-ladder + graph-palette + pill/success/code tokens);
Phase 50 (Band 1 gate — nothing in Band 2/3 starts before the live loop is green)
**Requirements:** RSKN-01, RSKN-02, RSKN-03, RSKN-04, RSKN-05, RSKN-06, RSKN-07
**Success criteria:**

1. `/chat` (composer, message stream, tool-round activity rows, citation chips) is re-skinned in the polytoken register on extended tokens
2. The thread inbox (three-pane, thread groups) and email detail view are re-skinned on extended tokens
3. `/knowledge` canvas is re-skinned — tier badges on TOKN-04 tokens, node types on the TOKN-05 palette — and the pre-existing UI debt (glassmorphism-ban violations, raw ⊞ glyph) is cleared
4. `/studio`, `/settings/*`, and `/login` are re-skinned in the polytoken register
5. Zero raw hex outside token sources holds across the re-skin; the WCAG-AA contrast + token-family registration regression gates stay green and extend to the new aliases
6. The inbox entity chips consume `color.graph.entity` + `radius.pill`, and `/entities/[id]`'s StatusBadge consumes the `color.tier.*` ladder — closing backlog 999.16
7. Knowledge-canvas cache invalidation extends to chat-driven promotions and expandNode results, not just staleTime self-healing

**Plans:** 7/7 plans have a SUMMARY.md — **BLOCKER:** 51-07's Task 1 (committed palette-ban gate)
is done+green, but Task 2 (E2E regression suite) and Task 3 (16-surface screenshot re-capture)
could NOT execute — Docker Desktop's backend never reached a ready state in that session (~25min
across 3 wait cycles + 1 clean restart; see `51-07-SUMMARY.md` for the full diagnostic trail).
Re-run 51-07 Tasks 2/3 in a session where `docker info` succeeds before treating Phase 51 as fully
verified.
**UI hint**: yes

Plans:
**Wave 1** *(6 parallel plans — disjoint files_modified)*

- [x] 51-01-PLAN.md — /chat interactive surfaces + global chrome (sidebar de-glass + hover/active) (RSKN-01)
- [x] 51-02-PLAN.md — Email-detail D-49-03 palette→graph.* conversion + confirm/deny filled-semantic recipe (RSKN-02, RSKN-05)
- [x] 51-03-PLAN.md — Inbox entity chips→graph-entity+pill, /entities palette + StatusBadge→tier ladder (backlog 999.16) (RSKN-02, RSKN-06, RSKN-05)
- [x] 51-04-PLAN.md — /knowledge re-skin: glassmorphism burn-down (4 files) + ⊞→LayoutGrid + tier/graph confirm (RSKN-03)
- [x] 51-05-PLAN.md — /studio + /settings/forwarding + /login register/hover pass + brand-copy confirm (RSKN-04)
- [x] 51-06-PLAN.md — RSKN-07 FUNCTIONAL: cache invalidation for chat-driven promotions + expandNode (+ tests) (RSKN-07)

**Wave 2** *(blocked on Wave 1 — the enforceable gate + phase-wide regression)*

- [x] 51-07-PLAN.md — D-49-05 committed palette-ban gate (DONE, green) + E2E regression (live-loop/uat-39/41/43/45/48) + full 16-surface screenshot re-capture vs baseline (RSKN-05) — **E2E + screenshot tasks BLOCKED, not executed (Docker Desktop unavailable this session); re-run before treating this plan as fully verified**

### Phase 52: Editable Genui Panels / Studio-on-Canvas

**Goal:** Canvas genui panels become live editing surfaces instead of read-only renders — a user can
re-theme, tweak, and regenerate a panel in place.
**Depends on:** Phase 48 (v1.8 — style-pack/token machinery); Phase 50 (Band 1 gate); functionally
independent of Phase 51 — parallelizable
**Requirements:** PANL-01, PANL-02, PANL-03, PANL-04
**Success criteria:**

1. User can switch a genui panel's `style_pack_id` in place from per-panel controls; the choice persists across reloads
2. User can tweak a panel's spec parameters in place through a bounded editing surface, schema-validated via the same untrusted-input gate as FOUND-6
3. User can regenerate a panel variant in place, with provenance retained and the prior version reachable
4. User can issue a natural-language re-theme instruction on a panel that resolves to pack/token choices (DSGN-03's cheap generation-side slice; no visual-compare repair loop)

**Plans:** 6/6 plans complete

Plans:
- [x] 52-01-PLAN.md — Foundation: per-panel overlay model (versions/pack override) + PanelThemeScope + persistence hook (no migration)
- [x] 52-02-PLAN.md — Panel toolbar chrome + PANL-01 pack switch end-to-end (optimistic/persist/rehydrate) + control skeletons
- [x] 52-03-PLAN.md — PANL-02 bounded parameter editor + server-side FOUND-6 gate (applyPanelEdit)
- [x] 52-04-PLAN.md — PANL-03 regenerate-in-place + version history/restore (supersede-never-mutate)
- [x] 52-05-PLAN.md — PANL-04 server: Bedrock retheme resolution (Python) + resolveRetheme tRPC boundary
- [x] 52-06-PLAN.md — PANL-04 client: NL re-theme popover + apply as retheme version

**UI hint**: yes

### Phase 53: Mobile-Responsive Answer

**Goal:** The product is usable on a mobile viewport — canvas surfaces gracefully degrade to an
inline-first list/feed rather than an unusable shrunk canvas, per the market-validated pattern
(ChatGPT removed Canvas 2026-05-28 over cross-surface inconsistency; Claude Artifacts render inline
on mobile).
**Depends on:** Phase 51 (re-skinned surfaces to make responsive); Phase 48 (v1.8 — TOKN-07
breakpoint decision); Phase 50 (Band 1 gate, inherited via Phase 51)
**Requirements:** MOBL-01, MOBL-02
**Success criteria:**

1. On small screens, canvas surfaces (chat canvas, `/knowledge`) collapse to a list/feed presentation; desktop keeps the 2D canvas
2. Core flows (login → inbox → thread → email detail → chat) show no horizontal overflow on a mobile viewport
3. Touch targets stay ≥44px on a mobile viewport even under denser style packs

**Plans:** 6/6 plans complete

Plans:
- [x] 53-01-PLAN.md — Foundation: useIsMobileViewport() hook + global mobile nav trigger (wave 1)
- [x] 53-02-PLAN.md — Touch-target sweep: Phase-52 toolbar + KnowledgePreviewNode pointer-coarse: (wave 1)
- [x] 53-03-PLAN.md — Inbox single-pane master→detail stack below md (wave 1)
- [x] 53-04-PLAN.md — Email-detail CanvasShell Sheet-collapse below md (wave 1)
- [x] 53-05-PLAN.md — /chat inline feed: canvas never mounts + rail overlay Sheet (wave 2)
- [x] 53-06-PLAN.md — /knowledge mobile list + full-width detail sheet (wave 2)

**UI hint**: yes

### Phase 54: Email-Cluster Workflow (E3)

**Goal:** The killer feature — email-thread clusters with attached chats, mid-turn web research, and
promotable knowledge — works end-to-end, proven live by the user on their real inbox.
**Depends on:** Phase 50 (Band 1 complete — real email flowing is the substrate); backend work
(CLUS-01..06) may interleave in execution with Phases 51–53, but this phase is sequenced last as
the milestone's final acceptance gate
**Requirements:** CLUS-01, CLUS-02, CLUS-03, CLUS-04, CLUS-05, CLUS-06, CLUS-07
**Success criteria:**

1. User can place an email-thread card on the `/chat` canvas as a first-class node type (versioned registry entry), showing the thread's real subject/participants/summary
2. User can attach a chat to an email thread — the conversation is linked to the thread and the agent's answers draw on that thread's content
3. The agent can search the web mid-turn via a `web_search` ToolExecutor behind the same port, allowlist, envelope-quarantine, and adversarial-fixture discipline as the v1.6 tools
4. Tool results (URLs/pages) can be captured as INFERRED knowledge nodes attached to the thread/chat cluster — suggest-only, provenance retained
5. Cluster knowledge is promotable to the global graph through the existing suggest-only promotion gate
6. Cluster context accumulates — artifacts from earlier chats in the cluster (genui panels, captured sources) are available as context to subsequent chats attached to the same thread
7. The end-to-end scenario is proven live by the user on their real inbox: real thread → attached chat → web research with thread in context → sources captured → promotion confirmed → a follow-up chat sees the cluster context — the milestone's acceptance bar

**Plans:** 7/7 plans complete

Plans:
- [x] 54-01-PLAN.md — Migration 0036 + thread<->conversation linkage tRPC seam (attach + threadId reads + emails.threadCard) (wave 1)
- [x] 54-02-PLAN.md — web_search ToolExecutor: SearchProvider port + SSRF-guarded fetch + adversarial fixtures + dark exposure gate (wave 1)
- [x] 54-03-PLAN.md — Source capture as INFERRED nodes + promotion reuse (wave 2)
- [x] 54-04-PLAN.md — EmailThreadNode + Add-thread popover + versioned node registry (wave 2)
- [x] 54-05-PLAN.md — Thread + cluster context assembly injection (bounded, quarantined) (wave 3)
- [x] 54-06-PLAN.md — ThreadClusterIndicator + clusterSummary + web_search tool-round copy (wave 3)
- [x] 54-07-PLAN.md — CLUS-07 live-acceptance §H runsheet in MORNING-CHECKLIST.md (wave 4)

## Next Two Epochs — the endgame map (LOCKED 2026-07-10)

Everything remaining in the product vision compresses into TWO epochs (full plan, rationale,
thinning decisions, and command map: [research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md)).
Standing rule locked with it: **deploy/OAuth/live-UAT gates are first-class phase work, never
deferrable-by-default** — a milestone isn't done until the user has touched the capability live.

- **v1.9 — Cloud Workspace** (Epoch A): Band 1 Live-Loop Gate FIRST (local stack green, staging/prod
  migrations 0026–0035, OAuth + SES forwarding runbooks → user's real email flowing, deferred-UAT
  burn-down); Band 2 folded v1.8 remainder (re-skin + 999.16, mobile, editable panels — seed specs
  preserved in [milestones/v1.8-ROADMAP.md](milestones/v1.8-ROADMAP.md)); Band 3 E3 Email-Cluster Workflow depth-first (thread cards
  on canvas, thread-bound chats, `web_search` executor, source-capture → INFERRED nodes,
  promote-to-global, cluster context) scoped around ONE fully-working scenario on the user's real
  inbox.

- **v2.0 — Local Agent Platform** (Epoch B = VISION E4+E5+E6 merged): daemon + ONE permission
  model + generalized ToolExecutor as the shared foundation; watched folders → directory panels
  with Claude-Code-class attached chats (fs/terminal/git); browser panel CDP-first (perception
  research deferred); tool registry as per-user allowlist panel; embedded editor + agent
  self-repository as stretch. `/gsd:secure-phase` on every daemon phase. Split v2.0/v2.1 at the
  daemon-core/executors seam only if the roadmap exceeds ~15 phases.

- **E7 (compute pooling): NOT an epoch** — parked at its gate as a venture decision; sole carried
  obligation is keeping the v2.0 daemon protocol job-shaped.

## Backlog

- ~~**999.1 — GenUI history per-importer authorization**~~ **RESOLVED by Phase 44 (Plan 44-07, 2026-07-10):** genui `historyList`/`historyById` now owned-importer-scoped from the session (tRPC `protectedProcedure` + ownership helper). Original issue: `GET /v1/genui/history` returned all importers' rows when `importer_id` omitted (Phase 16 CR-01).
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — Design Engine (deferred):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). See REQUIREMENTS.md → Future Requirements.
- **999.5 — Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
- **999.6 — Chat & Studio Design Uplift — PROMOTED to v1.4 (2026-07-06), SHIPPED 2026-07-07.** UPLIFT-01..03 — see milestones/v1.4-ROADMAP.md for full detail (finer FIX/ADOPT/TOKEN requirement IDs superseded the coarse UPLIFT-01..03 IDs).
- **999.7 — Editable genui panels / studio-on-canvas (raised 2026-07-06, user):** each canvas genui-panel becomes a live editing surface — per-panel controls to change UI tokens / `style_pack_id`, tweak spec parameters, and run studio-related tools (re-theme, regenerate variant, inspect) in place, instead of the current read-only render. Foundations already deliberately open: the versioned node-type registry (CANVAS-03) admits a richer "editable/studio panel" node type; `style_pack_id` is already threaded through chat + canvas (v1.3 locked decision); the Phase-17 DTCG style-pack engine + `/studio` token machinery already exist; the per-chat shared-state store can hold live params. Overlaps **999.4 Design Engine** — a promptable design system is the generation-side of the same tokens. **ABSORBED into v1.9 Phase 52 (Editable Genui Panels / Studio-on-Canvas), opened 2026-07-10.**
- **999.8 — Declarative display-binding gap (found live 2026-07-06):** the declarative renderer binds values via a `dataRef` dotted-path field (`resolveDataRef`, SPEC-05) — it does NOT interpolate `{{mustache}}` inside a text node's `content`. Two candidate fixes: (a) generator-prompt fix (cheap, high-value), and/or (b) a small renderer affordance to resolve declared-state into text (bigger, touches the locked renderer). **Option (a) shipped as v1.4 POLISH-01 (Phase 26), 2026-07-06. Option (b) remains backlogged** — it touches the locked `SpecRenderer`.
- **999.9 — Canvas auto-layout stacking (cosmetic) — folded into v1.4 as POLISH-02 (Phase 26), SHIPPED 2026-07-06.**
- **999.10 — Knowledge-graph uplift — PROMOTED to v1.5 (2026-07-07), SHIPPED 2026-07-08.** Adopt graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live Postgres store, per its own staged cost/benefit ordering — see full analysis in `.planning/phases/999.10-knowledge-graph-uplift-graphify-adoption/NOTE.md`. Executed as Phases 29–32 (see milestones/v1.5-ROADMAP.md). Stage-3 BFS-into-prompts, budget-aware tier-pruning, and snapshot/diff remain explicitly deferred (tracked as KGX-01..03 in REQUIREMENTS.md → Future Requirements) until RECALL-02 measures a real retrieval-miss rate.
- **999.11 — polytoken.ai product vision (raised 2026-07-07, user):** total rebrand (nauta → polytoken.ai) + UI refactor + branding/design/marketing research + auth/gauth/tenancy/RLS; email-thread cards on canvas with attached chats + web-research → knowledge nodes → promote-to-global (the "AI-powered ontology driven by user chats"); desktop app + daemon (remote filesystem, watched folders, directory panels with Claude-Code-class attached chats, embedded editor panels); browser-control canvas panel; user-controlled tool/skill registry + agent self-repository of reusable functions; distributed inference/compute-credit pooling (explicitly last/gated). Full dependency-ordered epoch ladder (E0–E7), backlog absorption map, and irreversibility guardrails: `.planning/research/polytoken-vision/VISION.md`. Draws from after v1.6; does NOT alter v1.6 sequencing. **Superseded 2026-07-10 by the two-epoch endgame restructure (ENDGAME-PLAN.md) — E3 now v1.9 Band 3, E4+E5+E6 merged into v2.0, E7 stays parked.**
- **999.12 — Tailwind v4 + React 19 migration (raised 2026-07-07, UI-ecosystem research):** migrate `apps/web` + `packages/ui` off Tailwind 3.4/React 18 to unlock direct shadcn registry installs (`shadcn add @kibo-ui/…`) in place of the vendor+adapt workflow documented in `.claude/skills/nauta-design-system/SKILL.md`. Ecosystem registries (`@magicui`, `@kibo-ui`, `@coss` ex-Origin UI) all emit Tailwind v4/oklch payloads now. Scope: port the HSL tokens in `apps/web/src/app/globals.css` to `@theme`/oklch, revalidate every vendored `packages/ui` component, and decide the Radix-vs-Base UI stance (upstream shadcn switched default primitives to Base UI, 2026-07). Registry wiring already in place: `packages/ui/components.json` (2026-07-07). **Stays parked — orthogonal platform risk, both v1.9 and v2.0 stay on the stable stack (ENDGAME-PLAN.md §6).**
- **999.13 — genui catalog expansion: register vendored components as spec types (raised 2026-07-08, user):** the declarative genui catalog (`packages/genui/src/catalog/manifest.ts`, 17 frozen `SpecNodeType`s, `RegisteredTypeSchema` allowlist) cannot emit the 20 vendored Magic UI/Kibo UI components shipped in `59dbf3b` — they render `UnknownComponentPlaceholder`. Register the high-payoff simple-prop ones first (`number-ticker`, `spinner`, `avatar-stack`, `animated-list`, `marquee`): per component = SpecNodeType literal + ManifestEntry (LLM description, CI-gated example, `.strict()` Zod propsSchema, component ref) + catalog tests (CTLG-04). Touches the locked generation surface (Bedrock structured-output grammar D-22/COST-02, catalog prompts D-23) — run as a small phase, not a drive-by. Code-island channel is out of scope by design (AST allowlist blocks imports). Components already browser-verified via `/dev/components` showcase. Candidate for a small v1.9 phase per ENDGAME-PLAN.md §6 — not scoped into a v1.9 phase at this roadmap's creation; re-evaluate at a future milestone if not picked up.
- **999.14 — untracked dev/design scratch pages break `@polytoken/web` typecheck (found by Phase 42 verification, 2026-07-09):** the untracked `apps/web/src/app/dev/design/` showcase still imports `@nauta/ui/*` (20 specifiers in `previews-vendored.tsx`); after the Phase-42 rename removed `node_modules/@nauta`, Next's regenerated `.next/types/validator.ts` transitively imports the page and `npm run typecheck -w @polytoken/web` fails with 22 `TS2307` errors — the Task-3 tsconfig `exclude` cannot stop transitive imports reached via `.next/types`, so local `next build` (`ignoreBuildErrors: false`) would fail identically. Git-based CI/Vercel builds are unaffected (the dir is untracked). Fix options: find/replace `@nauta/ui` → `@polytoken/ui` inside the user-owned scratch dir (hard-excluded from Phase 42 by decision), or commit/delete the scratch content. Evidence: `.planning/phases/42-atomic-rename-nauta-polytoken/42-VERIFICATION.md` (status gaps_found, 7/8; gap parked here — ship not blocked). Opportunistic fix candidate during v1.9 Phase 51 (re-skin band) per ENDGAME-PLAN.md §6.
- **999.15 — Chat-path Bedrock prompt caching (raised 2026-07-09, cost hygiene):** the chat/tool-loop path re-sends its static prefix — the chat system prompt + the `emit_ui_spec` SpecRoot JSON schema injected as `input_schema` (`apps/email-listener/app/.../chat_tools.py:74-84`, the largest single block) — at full input rate on **every turn AND every tool round** (loop runs ≤4 rounds/turn, `run_chat_turn_tool_loop.py`). No `cache_control` anywhere on this path (`bedrock_chat_adapter.py:70-82` passes `system` through unchanged). The genui path already proves the fix: `cache_control:{type:ephemeral}` / `cachePoint` on the static block (COST-01, D-21, `genui_generator_adapter.py:171-188`). Scope: add cache points on the chat system block + the tools schema (Bedrock `cachePoint` may be set in `system`/`tools`; 5-min or 1-hr TTL — `research/CURRENCY-2026.md:58-66`); fully lossless (cache-read ≈ 0.1× input), self-contained, no schema/renderer changes. **Context:** app Bedrock spend is ~$10/mo behind ~$30/mo fixed infra — this is hygiene, not a headline cut; sequence behind higher-value product work. Two sibling cost items surfaced the same day but NOT filed: Batches API for the eval judge (`scripts/genui_eval/judge_adapter.py`, −50%, non-latency-sensitive), and the dormant `halfvec(1536)` vs Titan-Embeddings-V2-max-1024 dim mismatch (`research/CURRENCY-2026.md:272`, only bites on a V1→V2 move). Not scoped into a v1.9 phase at this roadmap's creation (hygiene, sequenced behind value work per ENDGAME-PLAN.md §6) — candidate for in-phase opportunistic pickup if cheap.
- **999.16 — Remaining raw-palette chip/badge surfaces off-token (found by Phase 48 adversarial audit, 2026-07-10):** two surfaces implement the exact semantics Phase 48's purpose-built tokens exist for, but with raw Tailwind palette hardcodes: (a) `apps/web/src/app/_components/entity-chips.tsx` — the inbox's entity chips (rendered by `inbox-row.tsx`, `inbox-thread-group.tsx`, `inbox-three-pane.tsx`) use raw `violet-100/200/500/800/950` classes + shared `Badge` (`rounded-md`, not pill) for the entity-type semantic that `color.graph.entity` was built for; missed because 48-03's chip search was grep-scoped to `/chat` only. (b) `apps/web/src/app/entities/[id]/_components/entity-detail.tsx` `StatusBadge` (lines ~66-85) — confirmed-vs-provisional confidence-tier concept via `bg-primary/10` + raw `amber-*` classes instead of the `color.tier.*` ladder. **RESOLVED-SCOPE 2026-07-10: absorbed as RSKN-06 into v1.9 Phase 51 (Total UI Re-skin), which explicitly extends scope to `/entities/[id]`.** Evidence: 48-VERIFICATION.md resolution note.
- **v1.6 deferred items (from this milestone's own research, tracked for a future pass):** entity-merge confirm-action's surrogate-key decision (Fork 2 allowlist #2 — `component_entity_candidate_links` is keyed by pair, not an addressable id); region-confirm confirm-action (Fork 2 allowlist #3 — has its own dedicated non-chat UI already); cheap-model sanitize pass for read-then-write tool chains (Fork 3 — staged until a write-capable tool exists); inline-interactive knowledge preview (Fork 1 — hand-rolled mini pan/zoom, gated on Phase 41's non-interactive preview proving insufficient); demote/undo path for promoted edges (Fork 2 — plain REST, supersede-never-mutate, lower urgency); `web_search` ToolExecutor + source-capture as INFERRED nodes (VISION.md E1 addition — absorbed into v1.9 Phase 54, CLUS-03/04).
- **999.17 — Editable-panel chrome unreachable on mobile + docked view ignores overlays (found by v1.9 milestone audit, 2026-07-12):** Phase 52 wired PanelThemeScope/overlays/toolbar ONLY into the canvas node (genui-panel-node.tsx); Phase 53 never mounts the canvas below md and the docked/mobile transcript path (message-turn.tsx → genui-part-boundary.tsx → SpecRenderer) reads raw chat.getHistory parts — never shared.panelOverlays, never resolveActivePanel, no toolbar. Net: PANL-01..04 editing is desktop-canvas-only, and canvas-side edits/rethemes don't surface in the docked/mobile view of the same conversation. Graceful degradation (panels render fine), but an undocumented cross-phase trade-off. Fix direction: overlay-resolve specs in the docked renderer + a slim mobile editing affordance. Evidence: v1.9-MILESTONE-AUDIT.md Finding 1.
- **999.18 — FULL production UI/UX rebuild (raised 2026-07-12, user — HIGH PRIORITY, top candidate for v2.0 or a dedicated v1.10):** the user's verdict on the live app after v1.9: "the whole UI is still ugly/experimental, not a production UI — not just tokens and colors." Root cause: v1.9 Phase 51 "Total UI Re-skin" was scoped (and executed) as token-hygiene only — class→token conversion, hover/focus convention, glassmorphism removal; its own UI-SPEC said "refinement, not redesign." No phase has EVER done actual visual/UX design: base palette is still stock-shadcn (white + teal `hsl(164 39% 22%)` + 0%-saturation grays — globals.css untouched since Phase 48), layouts/components/density/hierarchy/empty-loading-error states are all first-draft. The brand guide's "warm polytoken register" is defined ONLY as voice/tone — no visual identity was ever specified. Scope for the rebuild: (a) real visual identity (palette/type/spacing/signature, designed not defaulted), (b) per-surface UX redesign (inbox, chat+canvas, knowledge, email detail, studio, settings, login) — layout, hierarchy, information density, interactions, (c) production-grade states everywhere, (d) design-review loop with the user on real screens BEFORE cascading (v1.9's autonomous-overnight approach cannot make taste decisions). Run as its own milestone with /gsd:ui-phase per surface + screenshot-driven iteration; the 16-surface screenshot harness + committed token gates from v1.9 are the regression rails. Evidence: user feedback 2026-07-12; .planning/v1.9-MILESTONE-AUDIT.md.
