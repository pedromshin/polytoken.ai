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
- ✅ **v1.9 — Cloud Workspace** (Phases 49–54) — SHIPPED 2026-07-14. The E3 email-cluster workflow (thread cards on the chat canvas, thread-bound chats, a real `web_search` executor, captured sources → INFERRED nodes → promote-to-global, accumulating cluster context) on a fully re-skinned, mobile-responsive, live-deployed product with editable genui panels. 24/27 requirements. **Caveat:** shipped with its three live-acceptance legs unexecuted — LIVE-03 (OAuth live), LIVE-04 (real email flowing), CLUS-07 (the six-leg scenario on the real inbox, *the declared acceptance bar*) — accepted as tech debt by explicit user decision at the gate, overriding the milestone's own standing rule. All three are user-only actions with code/infra/runsheets complete; see [phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md](phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md) §A → §B.3–6 → §H. Archived: [milestones/v1.9-ROADMAP.md](milestones/v1.9-ROADMAP.md) · Requirements: [milestones/v1.9-REQUIREMENTS.md](milestones/v1.9-REQUIREMENTS.md) · Audit: [milestones/v1.9-MILESTONE-AUDIT.md](milestones/v1.9-MILESTONE-AUDIT.md).
- 🚧 **v1.10 — Product Design & Research Canvas** (Phases 55–63) — IN PROGRESS (roadmap opened 2026-07-15). A user-picked visual identity (not autonomous), per-surface UX redesign on that identity, a frictionless research canvas (auto-collected sources, user canon, edges-as-context), and an email learning loop — sequenced around a BLOCKING HUMAN GATE at the visual-identity pick (Phase 58) so nothing visual cascades before the user has chosen. See detail below. Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).
- 📋 **Next epoch** — **v2.0 Local Agent Platform** (E4+E5+E6 merged) follows v1.10. ENDGAME-PLAN.md §5 originally sequenced it right after v1.9, but two post-lock findings (999.18, 999.19) inserted v1.10 first — see PROJECT.md → Current Milestone "Why now (and why not v2.0)".

## Phases

**Phase Numbering:**

- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. v1.4 ran Phases 26–28. v1.5 ran Phases 29–32.
  v1.6 ran Phases 33–41. v1.7 ran Phases 42–46. v1.8 ran Phases 47–48 (scope cut; opened as
  47–51). v1.9 ran Phases 49–54 — the ex-49/50/51 seed specs (goal/success-criteria text)
  carried forward onto the new Phases 51–53; the actual numbers were reassigned so the Band 1
  Live-Loop Gate could take 49–50 (ENDGAME-PLAN.md §2's hard ordering constraint: Band 1 gates
  every Band 2/3 phase). **v1.10 runs Phases 55–63** — Phase 55 is the platform migration; Phases
  56–57 are the two palette-independent backend tracks (research-canvas backend, email learning
  loop), both parallel-safe with Phase 55 and with each other; Phase 58 is the BLOCKING HUMAN GATE
  (visual-identity pick); Phase 59 realizes the locked identity as a designed token set; Phases
  60–62 redesign every surface on it; Phase 63 lands the research canvas's visual layer last
  (it needs both the locked identity and the Phase-56 backend).

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
- [x] **Phase 37: Knowledge Search + Python Read-Side** - User can search or expand the knowledge graph from chat via `search_knowledge`, backed by a NEW Python `KnowledgeGraphRepository` + a DB-level `extracted_only` view (completed 2026-07-09)
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

<details>
<summary>✅ v1.9 — Cloud Workspace (Phases 49–54) — SHIPPED 2026-07-14</summary>

- [x] Phase 49: Live-Loop Gate — Deploy, OAuth & Real Email (6 plans; 5 executed + 49-06 held at its designed human gate) — LIVE-01/02/07 closed; **LIVE-03/LIVE-04 deferred (user-only)**
- [x] Phase 50: Live-Loop Gate — UAT Burn-down & Screenshot Coverage (5/5 plans) — completed 2026-07-11
- [x] Phase 51: Total UI Re-skin (7/7 plans + 2 UI-review fix rounds) — completed 2026-07-11; 51-07's Docker-blocked E2E + screenshot tasks closed 2026-07-12 (32/32 green twice)
- [x] Phase 52: Editable Genui Panels / Studio-on-Canvas (6/6 plans + 1 UI-review fix round) — completed 2026-07-12
- [x] Phase 53: Mobile-Responsive Answer (6/6 plans) — completed 2026-07-12
- [x] Phase 54: Email-Cluster Workflow (E3) (7/7 plans + 1 UI-review fix round) — completed 2026-07-12; **CLUS-07 deferred (user-only)**

24/27 requirements · 205 commits · 260 code files, +33,485/−8,171 · 2026-07-10 → 2026-07-13.

**Shipped with a caveat worth remembering:** the audit verdict was `gaps_found` and said
complete-milestone must not run until §A (OAuth), §B.3–6 (real email), and §H (the CLUS-07
six-leg scenario) were executed live. The user chose to proceed and accept them as tech debt on
2026-07-14, overriding v1.9's own STANDING RULE. Every capability is code-complete and
independently verified at code level; **none of the three live legs has been exercised by a
human.** CLUS-07 was this milestone's declared acceptance bar. No development work remains —
see [phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md](phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md),
run §A → §B.3–6 → §H in that order.

Full detail: [milestones/v1.9-ROADMAP.md](milestones/v1.9-ROADMAP.md) · Requirements:
[milestones/v1.9-REQUIREMENTS.md](milestones/v1.9-REQUIREMENTS.md) · Audit:
[milestones/v1.9-MILESTONE-AUDIT.md](milestones/v1.9-MILESTONE-AUDIT.md) · Deferred items:
STATE.md → Deferred Items → v1.9.

</details>

## v1.10 — Product Design & Research Canvas (Phases 55–63) — CURRENT

**Goal:** polytoken stops looking experimental and starts working the way the user described it —
a *designed* product whose research canvas collects sources without ceremony, lets the user select
a personal canon, and treats canvas edges as context. Plan of record: PROJECT.md → Current
Milestone.

**Why now (and why not v2.0 next):** two findings postdate ENDGAME-PLAN.md's 2026-07-10 lock —
backlog 999.18 (*"the whole UI is still ugly/experimental, not a production UI — not just tokens
and colors"*) and 999.19 (the user's own words for the target research-canvas workflow) — and both
argue design-before-more-surfaces. v1.10 inserts ahead of the originally-next v2.0 Local Agent
Platform, which keeps its number and follows this milestone.

**Ordering (hard constraint — this milestone's defining rule):** Phase 58 is a BLOCKING HUMAN GATE.
No SURF-* phase (60–62) and no visual research-canvas work (Phase 63) is planned or executed before
the user has picked a visual direction in Phase 58 — per 999.18(d), autonomous-overnight runs
cannot make taste decisions, and that is exactly what produced "the whole UI is still ugly" after
v1.9. Everything palette-independent runs BEFORE the gate so an overnight run can do maximum work
first: Phase 55 (platform migration, its own risky breaking-change phase) and Phases 56–57 (the
research-canvas backend/context-model seam and the email-learning-loop backend), both parallel-safe
with Phase 55 and with each other. Every phase from 59 onward depends, directly or transitively, on
Phase 58's recorded pick. Regression rails carried from v1.9 that every phase below must keep
green: the 16-surface screenshot harness (`npm run screenshot:review`), `palette-ban.test.ts`, the
WCAG-AA contrast + token-registration gates, and the 32/32 E2E suite.

- [ ] Phase 55: Platform Migration — Tailwind v4 + React 19
- [ ] Phase 56: Research Canvas — Backend & Semantic Context Model
- [ ] Phase 57: Email Learning Loop
- [ ] Phase 58: Visual Identity — Sketch & Pick (HUMAN GATE)
- [ ] Phase 59: Visual Identity — Designed Token Set & Brand Guide
- [ ] Phase 60: Surface Redesign — Inbox & Email Detail
- [ ] Phase 61: Surface Redesign — Chat, Canvas & Mobile Panel Chrome
- [ ] Phase 62: Surface Redesign — Knowledge, Studio & Production States
- [ ] Phase 63: Research Canvas — Visual Surfaces

### Phase 55: Platform Migration — Tailwind v4 + React 19

**Goal**: `apps/web` + `packages/ui` run on Tailwind v4 (oklch tokens) and React 19, every vendored
component is revalidated, the Radix-vs-Base-UI stance is settled and documented, and a direct
shadcn registry install works in place of the vendor-and-adapt workflow — all with zero regression
against the existing gates. This is deliberately unparked now: redoing the palette rebuild (Phase
59) on the old HSL/v3 stack would mean redoing it again at a later v4 migration.
**Depends on**: Nothing (first phase of v1.10)
**Requirements**: STCK-01, STCK-02, STCK-03, STCK-04
**Success Criteria** (what must be TRUE):
  1. `apps/web` + `packages/ui` build and run on Tailwind v4: `globals.css` tokens are expressed as
     `@theme`/oklch (not HSL), and the WCAG-AA contrast + token-registration regression gates stay
     green on the new engine.
  2. `apps/web` + `packages/ui` build and run on React 19: the 16-surface screenshot harness
     (`npm run screenshot:review`) and the 32/32 E2E suite show zero runtime regressions.
  3. The Radix-vs-Base-UI primitive stance is decided, documented in the design-system skill /
     `docs/design/`, and every vendored `packages/ui` component still matches its documented
     behavior post-upgrade.
  4. A direct `shadcn add @kibo-ui/<component>` (or equivalent registry) install succeeds against
     the new stack for at least one real component — the vendor-and-adapt workflow is no longer
     required for that component.
**Plans**: 6 plans (6 waves, sequential — correctness-first for an unattended overnight run)
Plans:
- [x] 55-01-PLAN.md — Stage 1: swap to the Tailwind v4 engine (@import + @config bridge, PostCSS plugin) + an executable token-render regression guard [STCK-01]
- [ ] 55-02-PLAN.md — Stage 2 (crux): port globals.css to oklch + @theme inline + @source, fix every hsl(var(--x)) call site, adapt the genui re-theme surface [STCK-01]
- [ ] 55-03-PLAN.md — Stage 3: rewrite the two broken gates (token-contrast -> oklch parser, token-registration -> off resolveConfig) [STCK-01]
- [ ] 55-04-PLAN.md — Stage 4a: React 18->19 + the six low-risk dep bumps + revalidation [STCK-02]
- [ ] 55-05-PLAN.md — Stage 4b: react-day-picker v9 (calendar.tsx rewrite) + react-resizable-panels v3, each isolated [STCK-02]
- [ ] 55-06-PLAN.md — Stage 5: Radix-stays decision doc + SKILL.md + a direct @kibo-ui registry install proof + /dev/design oklch cleanup [STCK-03, STCK-04]
**UI hint**: yes

### Phase 56: Research Canvas — Backend & Semantic Context Model

**Goal**: The palette-independent data model and server seams for the research canvas exist: every
source the agent uses in a conversation auto-collects into a per-conversation ledger with no
capture-confirm ceremony, and connecting a source/table/panel node to a chat node on the canvas
injects that node's content as real context for that chat through a semantic linkage store — never
canvas `sharedState`, which was explicitly ruled out as the linkage store per D-54. This phase also
lands the promotion-gate reuse seam that Phase 63's canon-curation UX sits on top of. No new visual
canvas chrome ships in this phase.
**Depends on**: Nothing (parallel-safe with Phase 55)
**Requirements**: RCNV-01, RCNV-04
**Success Criteria** (what must be TRUE):
  1. Every tool result (starting with `web_search`) used during a conversation is recorded in a
     per-conversation source ledger automatically — verifiable via the database/API — with no
     manual per-turn confirmation step anywhere in the flow.
  2. Drawing a canvas edge from a source/table/panel node to a chat node causes that node's content
     to be injected into the chat's context on the next turn — verifiable by the chat's response
     referencing the injected content — backed by a semantic linkage store that is NOT canvas
     `sharedState`.
  3. The existing suggest-only promotion gate (INFERRED → EXTRACTED) is reachable from the source
     ledger's records with zero new promotion code, so Phase 63's canon-curation UX has a real seam
     to build on.
**Plans**: 5 plans (3 waves)
- [ ] 56-01-PLAN.md — Data model: chat_source_ledger + chat_context_edges Drizzle schema + migration (wave 1)
- [ ] 56-02-PLAN.md — RCNV-01 auto-collect: fail-open source-ledger write hook in the tool-round loop (wave 2)
- [ ] 56-03-PLAN.md — RCNV-04 seam: context-edges tRPC router + write-time cross-tenant ownership check (wave 2)
- [ ] 56-04-PLAN.md — RCNV-04 read: independent fail-open linked-context injection pipeline at turn time (wave 3)
- [ ] 56-05-PLAN.md — Promotion-gate reuse seam: ledger to SourceCaptureHandler, zero new promotion code (wave 3)

### Phase 57: Email Learning Loop

**Goal**: The user can correct what an email or extracted entity *is*, and the system captures and
reuses that correction to improve future classification/extraction — extending the existing
suggest-only entity-resolution stance and never auto-deciding.
**Depends on**: Nothing (parallel-safe with Phase 55 and Phase 56)
**Requirements**: LEARN-01, LEARN-02
**Success Criteria** (what must be TRUE):
  1. The user can correct the classification/extraction of an email or entity, and that correction
     is stored as a structured, addressable record — not a one-off correction that leaves no trace.
  2. A later email or entity that resembles a previously corrected one is classified/extracted using
     the accumulated correction signal, measurably differing from the pre-correction behavior.
  3. Accumulated correction signal is never auto-applied as a silent decision — every consumer of it
     stays suggest-only, consistent with the existing entity-resolution stance.
**Plans**: 3 plans (2 waves — capture foundation, then parallel few-shot + dismissal consumption)
Plans:
- [ ] 57-01-PLAN.md — Capture: entity_type_corrections table + trgm RPC + load-before-mutate capture hook [LEARN-01]
- [ ] 57-02-PLAN.md — Consume (classification): few-shot examples param + <entity_type_examples> render + importer-scoped retrieval into SuggestEntityTypes [LEARN-02]
- [ ] 57-03-PLAN.md — Consume (resolution): wire dead was_dismissed into the BlendedRAG RPCs as a symmetric exclusion filter [LEARN-02]

### Phase 58: Visual Identity — Sketch & Pick (HUMAN GATE)

**Goal**: **THIS PHASE IS A BLOCKING HUMAN CHECKPOINT.** 2–3 visually distinct directions are
sketched on real polytoken screens (throwaway HTML/CSS, real content — not mood boards or swatches)
so the user can compare actual looks, and the user picks exactly one. This phase's own completion
IS the gate: no SURF-* phase and no visual research-canvas work is planned or executed until the
pick is recorded. This directly answers 999.18(d) — the design-review loop with the user on real
screens that v1.9's autonomous-overnight approach skipped, which is what produced "the whole UI is
still ugly."
**Depends on**: Phase 55 (Platform Migration — sketches are built on the stable, migrated stack)
**Requirements**: IDNT-01, IDNT-02
**Success Criteria** (what must be TRUE):
  1. 2–3 distinct visual directions exist as throwaway HTML/CSS renders of real polytoken screens
     (inbox, chat, at least one canvas surface) — each internally consistent (its own palette/type/
     spacing) and visibly different from the others on real content, not swatches.
  2. The user has looked at all directions on real screens and explicitly selected exactly one.
  3. The selected direction is recorded in a durable, machine-readable location (PROJECT.md Key
     Decisions or equivalent) that Phase 59 onward reads as its locked input.
  4. No phase after this one has begun planning or execution before the selection is recorded.
**Plans**: TBD
**UI hint**: yes

### Phase 59: Visual Identity — Designed Token Set & Brand Guide

**Goal**: The direction locked in Phase 58 is realized as a real designed token set — oklch
palette, type scale, spacing/density system, and a signature element that *replaces* the
stock-shadcn defaults rather than recoloring them — and the brand guide gains the visual-identity
section it has never had (today it defines only voice/tone).
**Depends on**: Phase 58 (the pick)
**Requirements**: IDNT-03, IDNT-04
**Success Criteria** (what must be TRUE):
  1. `globals.css`'s oklch token values are the designed palette from the locked direction, not a
     recolor of the stock-shadcn defaults (verifiable by diffing against the pre-Phase-59 palette).
  2. A defined type scale, spacing/density system, and at least one signature element (none present
     before this phase) exist as reusable tokens/utilities — the app's actual design system, ready
     for every Band-3 surface to consume.
  3. `docs/design/brand-guide.md` has a visual-identity section (palette/type/spacing/signature +
     usage rules) alongside its existing voice/tone section.
  4. The WCAG-AA contrast + token-registration regression gates stay green against the new designed
     values.
**Plans**: TBD
**UI hint**: yes

### Phase 60: Surface Redesign — Inbox & Email Detail

**Goal**: The inbox (three-pane, thread groups, mobile feed) and the email-detail view
(`/emails/[id]`, region overlays) are redesigned on the locked visual identity — layout, hierarchy,
information density, interactions — not merely re-tokened.
**Depends on**: Phase 59
**Requirements**: SURF-01, SURF-04
**Success Criteria** (what must be TRUE):
  1. The inbox's three-pane desktop layout and mobile feed view visibly differ in layout, hierarchy,
     and density from the pre-Phase-59 version, not just in color.
  2. Thread grouping and entity chips read clearly at a glance against the new identity — contrast,
     spacing, and information density are deliberate choices, not inherited defaults.
  3. `/emails/[id]` and its region overlays are redesigned on the same identity, with the
     document-preview + entity-region interaction visibly improved in hierarchy and density.
  4. The 16-surface screenshot harness captures both surfaces under the new design with zero
     unintended regressions elsewhere.
**Plans**: TBD
**UI hint**: yes

### Phase 61: Surface Redesign — Chat, Canvas & Mobile Panel Chrome

**Goal**: `/chat` and its canvas (composer, message stream, tool-round rows, panels, canvas chrome)
are redesigned on the locked identity, and editable-panel chrome becomes reachable on mobile with
the docked/mobile transcript honoring panel overlays — closing backlog 999.17.
**Depends on**: Phase 59
**Requirements**: SURF-02, SURF-07
**Success Criteria** (what must be TRUE):
  1. The composer, message stream, tool-round activity rows, and genui panel chrome are redesigned
     on the new identity — layout and hierarchy visibly distinct from the pre-Phase-59 version.
  2. The canvas chrome (controls, minimap, background, node shells) matches the new identity
     end-to-end, with zero stock React Flow default styling remaining.
  3. On a mobile viewport, the user can reach the editable-panel toolbar/controls (pack switch,
     param edit, regenerate, re-theme) that were previously canvas-desktop-only.
  4. The docked/mobile transcript view of a conversation reflects panel overlays/rethemes made on
     the canvas side of the same conversation, closing the 999.17 gap.
**Plans**: TBD
**UI hint**: yes

### Phase 62: Surface Redesign — Knowledge, Studio & Production States

**Goal**: The `/knowledge` canvas, `/studio`, `/settings/*`, and `/login` are redesigned on the
locked identity, and every Band-3-redesigned surface (inbox, email-detail, chat+canvas, knowledge,
studio, settings, login) gains production-grade empty/loading/error states in place of first-draft
placeholders — the wrap-up pass that closes out the surface-redesign band.
**Depends on**: Phase 59, Phase 60, Phase 61 (the production-states pass needs the other surfaces
already redesigned)
**Requirements**: SURF-03, SURF-05, SURF-06
**Success Criteria** (what must be TRUE):
  1. `/knowledge`'s canvas (node chrome, filter rail, legend, detail pane) is redesigned on the new
     identity.
  2. `/studio`, `/settings/*`, and `/login` are redesigned on the new identity — layout, hierarchy,
     and density all deliberately redesigned, not inherited defaults.
  3. Every surface touched in Phases 60–62 has a designed (not first-draft) empty state, loading
     state, and error state — verifiable by triggering each condition on each surface.
  4. The full 16-surface screenshot harness + 32/32 E2E suite + palette-ban/WCAG gates stay green
     across the whole redesigned surface set.
**Plans**: TBD
**UI hint**: yes

### Phase 63: Research Canvas — Visual Surfaces

**Goal**: The visual layer of the research canvas lands on the locked identity: auto-collected
sources appear as nodes on the canvas without the user asking, the user can curate them into a
personal canon through canvas-level UX (never chat widgets), and the user can generate
presentation-grade panels grounded in the selected canon/sources.
**Depends on**: Phase 59 (locked identity), Phase 56 (backend ledger/edges), Phase 61 (redesigned
canvas chrome to land the new node types on)
**Requirements**: RCNV-02, RCNV-03, RCNV-05
**Success Criteria** (what must be TRUE):
  1. During a research conversation, sources the agent used appear as nodes on the canvas
     automatically — visibly related to the conversation — without any per-turn confirm action.
  2. The user can select auto-collected source nodes into a personal canon via a canvas-level
     curation UX (e.g., multi-select + an explicit "add to canon" action on the canvas), which
     promotes them through the existing suggest-only gate — zero per-turn chat widgets involved.
  3. The user can generate a presentation-grade genui panel whose content is grounded in the
     selected canon/sources.
  4. The new source nodes and curation styling match the Phase 59 designed identity, not stock
     canvas node styling.
**Plans**: TBD
**UI hint**: yes

## Next Two Epochs — the endgame map (LOCKED 2026-07-10)

Everything remaining in the product vision compresses into TWO epochs (full plan, rationale,
thinning decisions, and command map: [research/two-epoch-endgame/ENDGAME-PLAN.md](research/two-epoch-endgame/ENDGAME-PLAN.md)).
Standing rule locked with it: **deploy/OAuth/live-UAT gates are first-class phase work, never
deferrable-by-default** — a milestone isn't done until the user has touched the capability live.

**Note (2026-07-15):** this map originally sequenced v2.0 directly after v1.9. Two post-lock
findings (999.18, 999.19) inserted v1.10 "Product Design & Research Canvas" ahead of v2.0 instead
— see PROJECT.md → Current Milestone and the v1.10 section above. v2.0 keeps its number and content
below unchanged; it now follows v1.10 rather than v1.9.

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
- **999.12 — Tailwind v4 + React 19 migration (raised 2026-07-07, UI-ecosystem research):** migrate `apps/web` + `packages/ui` off Tailwind 3.4/React 18 to unlock direct shadcn registry installs (`shadcn add @kibo-ui/…`) in place of the vendor+adapt workflow documented in `.claude/skills/nauta-design-system/SKILL.md`. Ecosystem registries (`@magicui`, `@kibo-ui`, `@coss` ex-Origin UI) all emit Tailwind v4/oklch payloads now. Scope: port the HSL tokens in `apps/web/src/app/globals.css` to `@theme`/oklch, revalidate every vendored `packages/ui` component, and decide the Radix-vs-Base UI stance (upstream shadcn switched default primitives to Base UI, 2026-07). Registry wiring already in place: `packages/ui/components.json` (2026-07-07). **UNPARKED 2026-07-14, promoted to v1.10 Phase 55 (Platform Migration).**
- **999.13 — genui catalog expansion: register vendored components as spec types (raised 2026-07-08, user):** the declarative genui catalog (`packages/genui/src/catalog/manifest.ts`, 17 frozen `SpecNodeType`s, `RegisteredTypeSchema` allowlist) cannot emit the 20 vendored Magic UI/Kibo UI components shipped in `59dbf3b` — they render `UnknownComponentPlaceholder`. Register the high-payoff simple-prop ones first (`number-ticker`, `spinner`, `avatar-stack`, `animated-list`, `marquee`): per component = SpecNodeType literal + ManifestEntry (LLM description, CI-gated example, `.strict()` Zod propsSchema, component ref) + catalog tests (CTLG-04). Touches the locked generation surface (Bedrock structured-output grammar D-22/COST-02, catalog prompts D-23) — run as a small phase, not a drive-by. Code-island channel is out of scope by design (AST allowlist blocks imports). Components already browser-verified via `/dev/components` showcase. Not scoped into a v1.10 phase at this roadmap's creation; re-evaluate at a future milestone if not picked up.
- **999.14 — untracked dev/design scratch pages break `@polytoken/web` typecheck (found by Phase 42 verification, 2026-07-09):** the untracked `apps/web/src/app/dev/design/` showcase still imports `@nauta/ui/*` (20 specifiers in `previews-vendored.tsx`); after the Phase-42 rename removed `node_modules/@nauta`, Next's regenerated `.next/types/validator.ts` transitively imports the page and `npm run typecheck -w @polytoken/web` fails with 22 `TS2307` errors — the Task-3 tsconfig `exclude` cannot stop transitive imports reached via `.next/types`, so local `next build` (`ignoreBuildErrors: false`) would fail identically. Git-based CI/Vercel builds are unaffected (the dir is untracked). Fix options: find/replace `@nauta/ui` → `@polytoken/ui` inside the user-owned scratch dir (hard-excluded from Phase 42 by decision), or commit/delete the scratch content. Evidence: `.planning/phases/42-atomic-rename-nauta-polytoken/42-VERIFICATION.md` (status gaps_found, 7/8; gap parked here — ship not blocked). Opportunistic fix candidate during any v1.10 surface-redesign phase that touches `/dev/design`.
- **999.15 — Chat-path Bedrock prompt caching (raised 2026-07-09, cost hygiene):** the chat/tool-loop path re-sends its static prefix — the chat system prompt + the `emit_ui_spec` SpecRoot JSON schema injected as `input_schema` (`apps/email-listener/app/.../chat_tools.py:74-84`, the largest single block) — at full input rate on **every turn AND every tool round** (loop runs ≤4 rounds/turn, `run_chat_turn_tool_loop.py`). No `cache_control` anywhere on this path (`bedrock_chat_adapter.py:70-82` passes `system` through unchanged). The genui path already proves the fix: `cache_control:{type:ephemeral}` / `cachePoint` on the static block (COST-01, D-21, `genui_generator_adapter.py:171-188`). Scope: add cache points on the chat system block + the tools schema (Bedrock `cachePoint` may be set in `system`/`tools`; 5-min or 1-hr TTL — `research/CURRENCY-2026.md:58-66`); fully lossless (cache-read ≈ 0.1× input), self-contained, no schema/renderer changes. **Context:** app Bedrock spend is ~$10/mo behind ~$30/mo fixed infra — this is hygiene, not a headline cut; sequence behind higher-value product work. Two sibling cost items surfaced the same day but NOT filed: Batches API for the eval judge (`scripts/genui_eval/judge_adapter.py`, −50%, non-latency-sensitive), and the dormant `halfvec(1536)` vs Titan-Embeddings-V2-max-1024 dim mismatch (`research/CURRENCY-2026.md:272`, only bites on a V1→V2 move). Not scoped into a v1.10 phase at this roadmap's creation (hygiene, sequenced behind value work) — candidate for in-phase opportunistic pickup if cheap.
- **999.16 — Remaining raw-palette chip/badge surfaces off-token (found by Phase 48 adversarial audit, 2026-07-10):** two surfaces implement the exact semantics Phase 48's purpose-built tokens exist for, but with raw Tailwind palette hardcodes: (a) `apps/web/src/app/_components/entity-chips.tsx` — the inbox's entity chips (rendered by `inbox-row.tsx`, `inbox-thread-group.tsx`, `inbox-three-pane.tsx`) use raw `violet-100/200/500/800/950` classes + shared `Badge` (`rounded-md`, not pill) for the entity-type semantic that `color.graph.entity` was built for; missed because 48-03's chip search was grep-scoped to `/chat` only. (b) `apps/web/src/app/entities/[id]/_components/entity-detail.tsx` `StatusBadge` (lines ~66-85) — confirmed-vs-provisional confidence-tier concept via `bg-primary/10` + raw `amber-*` classes instead of the `color.tier.*` ladder. **RESOLVED-SCOPE 2026-07-10: absorbed as RSKN-06 into v1.9 Phase 51 (Total UI Re-skin), which explicitly extends scope to `/entities/[id]`.** Evidence: 48-VERIFICATION.md resolution note.
- **v1.6 deferred items (from this milestone's own research, tracked for a future pass):** entity-merge confirm-action's surrogate-key decision (Fork 2 allowlist #2 — `component_entity_candidate_links` is keyed by pair, not an addressable id); region-confirm confirm-action (Fork 2 allowlist #3 — has its own dedicated non-chat UI already); cheap-model sanitize pass for read-then-write tool chains (Fork 3 — staged until a write-capable tool exists); inline-interactive knowledge preview (Fork 1 — hand-rolled mini pan/zoom, gated on Phase 41's non-interactive preview proving insufficient); demote/undo path for promoted edges (Fork 2 — plain REST, supersede-never-mutate, lower urgency); `web_search` ToolExecutor + source-capture as INFERRED nodes (VISION.md E1 addition — absorbed into v1.9 Phase 54, CLUS-03/04).
- **999.17 — Editable-panel chrome unreachable on mobile + docked view ignores overlays (found by v1.9 milestone audit, 2026-07-12):** Phase 52 wired PanelThemeScope/overlays/toolbar ONLY into the canvas node (genui-panel-node.tsx); Phase 53 never mounts the canvas below md and the docked/mobile transcript path (message-turn.tsx → genui-part-boundary.tsx → SpecRenderer) reads raw chat.getHistory parts — never shared.panelOverlays, never resolveActivePanel, no toolbar. Net: PANL-01..04 editing is desktop-canvas-only, and canvas-side edits/rethemes don't surface in the docked/mobile view of the same conversation. Graceful degradation (panels render fine), but an undocumented cross-phase trade-off. Fix direction: overlay-resolve specs in the docked renderer + a slim mobile editing affordance. Evidence: v1.9-MILESTONE-AUDIT.md Finding 1. **PROMOTED 2026-07-15 to v1.10 Phase 61 (Surface Redesign — Chat, Canvas & Mobile Panel Chrome), SURF-07.**
- **999.18 — FULL production UI/UX rebuild (raised 2026-07-12, user — HIGH PRIORITY):** the user's verdict on the live app after v1.9: "the whole UI is still ugly/experimental, not a production UI — not just tokens and colors." Root cause: v1.9 Phase 51 "Total UI Re-skin" was scoped (and executed) as token-hygiene only — class→token conversion, hover/focus convention, glassmorphism removal; its own UI-SPEC said "refinement, not redesign." No phase has EVER done actual visual/UX design: base palette is still stock-shadcn (white + teal `hsl(164 39% 22%)` + 0%-saturation grays — globals.css untouched since Phase 48), layouts/components/density/hierarchy/empty-loading-error states are all first-draft. The brand guide's "warm polytoken register" is defined ONLY as voice/tone — no visual identity was ever specified. Scope for the rebuild: (a) real visual identity (palette/type/spacing/signature, designed not defaulted), (b) per-surface UX redesign (inbox, chat+canvas, knowledge, email detail, studio, settings, login) — layout, hierarchy, information density, interactions, (c) production-grade states everywhere, (d) design-review loop with the user on real screens BEFORE cascading (v1.9's autonomous-overnight approach cannot make taste decisions). Evidence: user feedback 2026-07-12; .planning/v1.9-MILESTONE-AUDIT.md. **PROMOTED 2026-07-15 to v1.10 in full: (a)→IDNT-01..04 (Phases 58–59), (b)→SURF-01..05 (Phases 60–62), (c)→SURF-06 (Phase 62), (d)→Phase 58's human gate.**

- **999.19 — Frictionless research canvas: auto-collected sources, user canon, nodes-as-context (raised 2026-07-12, user — the production vision in the user's own words):** the user's target workflow, verbatim-distilled: (1) EMAIL LOOP — emails arrive (one-offs + recurring/same-entity); early on the user manually tells the system what each is, and over time it "gets it right all the time" from that feedback (continuous entity/classification improvement — extends the existing suggest-only entity-resolution stance with a learn-from-corrections loop, never auto-decide). (2) RESEARCH LOOP, all on ONE canvas page — broad chaotic research first: many chats, many sources, many angles on an idea; then refinement. (3) SOURCES WITHOUT CEREMONY — every source the agent uses in research should ALREADY be related to that research and visible on the canvas in some way, WITHOUT the user having to say "capture this as a knowledge source for this cluster" each time (today's CLUS-04 per-turn confirm-widget ceremony is the explicit anti-goal); from that auto-collected pool the user then SELECTS some into their own CANON (user-curated knowledge — maps to the existing INFERRED→promotion gate, but as a canvas-level curation UX over auto-collected candidates, not per-turn chat widgets). (4) COMPOSITION — relate saved sources on the canvas to a NEW chat panel (canvas edges become SEMANTIC: connecting source nodes / generated tables / panels to a chat node injects them as that chat's context — today edges are visual-only and context comes solely from thread_id cluster assembly). (5) PRESENTATION — from selected sources + generated tables, produce polished presentation-grade UI panels (genui grounded in the selected context). User's caveat: "this is not limited to this, but is a narrow version of what this product can do — but it's more or less this way, with this in specific also implemented." Gap analysis vs today: auto-collection of web_search sources per conversation = NEW (design decision needed: auto-collect as zero-write ephemeral records vs auto-INFERRED rows; suggest-only stance says nothing enters the KNOWLEDGE graph without user selection — but a per-conversation source LEDGER visible on canvas is not the knowledge graph); canvas source tray/auto-nodes = NEW; canon-selection UX = NEW (promotion gate reusable); edges-as-context = NEW + architecturally significant (canvas sharedState was explicitly NOT the linkage store per D-54; this needs its own design); source-grounded panel generation = partially exists (cluster context + genui). Relates to: 999.18 (the UI rebuild should design these surfaces, not retrofit them), VISION.md E4/E5. Evidence: user message 2026-07-12 (v1.9 closeout session). **PROMOTED 2026-07-15 to v1.10 in full: step 1→LEARN-01/02 (Phase 57), steps 3–5→RCNV-01..05 (Phases 56, 63).**

- **999.20 — Deep nauta→polytoken purge in LIVE STATE (raised 2026-07-13, user "purge everything"):** the 2026-07-13 brand purge renamed every SAFE surface (code symbols incl. `NAUTA_CATALOG`→`POLYTOKEN_CATALOG`, UI strings, localStorage keys, CSS classes, sample/fixture data, comments, docs). Three "nauta" leaks remain BECAUSE they are coupled to live state and cannot be find-replaced without breakage — each needs a deliberate migration:
  1. **`entity_instances.nauta_id` DB column** — a live Postgres column (the master/canonical-entity FK set on human confirmation), referenced by the Python domain dataclass field, the Supabase repo row-map, promote_entity_on_confirm, and many tests. Rename requires: migration 0037 `ALTER TABLE entity_instances RENAME COLUMN nauta_id TO <new>` (candidate: `canonical_entity_id` — semantically clearer than a brand token; or `polytoken_id` for pure brand parity), applied local→staging→prod (Management API path proven), in LOCKSTEP with the drizzle schema + Python domain/repo + TS + test updates. A half-migration (code renamed, column not) breaks every entity read/write — same failure class as the jsonschema/scope_ref_id bugs. Blocked today only by needing DB access (fresh Supabase token) + Docker for local.
  2. **AWS resource names `nauta-services-*`** — ECR repo, ECS cluster/service, ALB, S3 bucket `nauta-services-ses-inbound-emails` (HOLDS REAL INBOUND EMAILS), Secrets Manager ARN paths, the `project = "nauta-services"` terraform var, and the `.github/workflows` deploy env vars that reference them. This is the re-parked Hazard A/B/C (EXTERNAL-IDENTITY-DECISIONS.md): ECR `force_delete=false` destroy+recreate, immutable ECS/ALB names, S3 buckets can't be renamed (must create-new + migrate objects + re-point SES receipt rules), local-only tfstate. Needs a planned infra migration with the user driving it, not a rename.
  3. **Local project directory `nauta.services.email-listener`** — the working-dir/repo folder name. Can't be changed from inside a session (it's the CWD every path resolves against). User action: rename the folder + re-open; git/remote already point at `pedromshin/polytoken.ai`.
  Also intentionally left as historical record (NOT bugs): `.planning/**` milestone archives (incl. v1.7 phase 42 "atomic-rename-nauta-polytoken" which documents the original rename) and `packages/db/migrations/**` snapshots (immutable journal — editing breaks the hash chain). Evidence: user "purge everything, project name is fucking polytoken.ai" 2026-07-13. Stays parked — needs DB access + user-driven infra, next after v1.10 per REQUIREMENTS.md.
