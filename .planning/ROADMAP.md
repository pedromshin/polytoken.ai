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
- ◆ **v1.8 — Polytoken Re-skin — Brand, Design System & Responsive Canvas** (Phases 47–51) — IN PROGRESS (opened 2026-07-10). Total UI re-skin on an EXTENDED (never discarded) v1.4 token system in the polytoken voice (warm second-brain companion; naming USER-LOCKED to polytoken/polytoken.ai 2026-07-10): brand identity application, token-system extensions (pill radius, success color, code typography, tier-ladder + graph node/edge-type tokens, hover/active convention, breakpoint decision), a market-validated mobile-responsive canvas answer, and genui panels upgraded from read-only renders to live editing surfaces (absorbs backlog 999.7 + the cheap slice of 999.4 Design Engine). Research: [research/v1.8-design/BRAND-IDENTITY-OPTIONS.md](research/v1.8-design/BRAND-IDENTITY-OPTIONS.md), [research/v1.8-design/DESIGN-PATTERN-DOSSIER.md](research/v1.8-design/DESIGN-PATTERN-DOSSIER.md).

## Phases

**Phase Numbering:**

- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. v1.4 ran Phases 26–28. v1.5 ran Phases 29–32.
  v1.6 ran Phases 33–41. v1.7 ran Phases 42–46. **v1.8 starts at Phase 47 (Phases 47–51).**

- Integer phases (47–51): planned v1.8 milestone work.
- Decimal phases (e.g. 47.1): urgent insertions via `/gsd:phase insert`, executed between the
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

## v1.8 — Polytoken Re-skin — Brand, Design System & Responsive Canvas (Phases 47–51) — CURRENT

23 requirements mapped (see REQUIREMENTS.md traceability). Dependency chain: 47 → 48 → 49 → 50;
Phase 51 depends only on Phase 48 and is independent/parallelizable with 49/50 (per the dossier's
own analysis: panel editing needs the token/pack machinery but not the surface re-skins). VRFY
(Phase 47) lands first so every later phase can use screenshot-driven review; TOKN (Phase 48)
lands before the phases that consume its tokens (RSKN-03's tier badges, RSKN's `radius.pill`
chips, MOBL's breakpoint decision). Research base:
[research/v1.8-design/BRAND-IDENTITY-OPTIONS.md](research/v1.8-design/BRAND-IDENTITY-OPTIONS.md),
[research/v1.8-design/DESIGN-PATTERN-DOSSIER.md](research/v1.8-design/DESIGN-PATTERN-DOSSIER.md).

- [ ] **Phase 47: Brand Foundation + Verification Tooling** — polytoken brand identity (voice, logo, guide) documented and applied to login/chrome; Playwright + screenshot harness installed and working
- [ ] **Phase 48: Token-System Extensions** — v1.4 DTCG token system extended with pill radius, success color, code typography, tier-ladder tokens, graph node/edge palette, hover/active convention, breakpoint decision
- [ ] **Phase 49: Total UI Re-skin** — chat, inbox, knowledge canvas, studio, settings, login re-skinned in the polytoken register on extended tokens, zero raw hex
- [ ] **Phase 50: Mobile-Responsive Answer** — canvas surfaces collapse to list/feed on small screens; core flows usable on a mobile viewport
- [ ] **Phase 51: Editable Genui Panels / Studio-on-Canvas** — canvas genui panels become live editing surfaces (style-pack switch, spec tweak, regenerate, promptable re-theme)

### Phase 47: Brand Foundation + Verification Tooling

**Goal:** The product has a documented polytoken brand identity ready to apply — voice, logo mark, brand guide — and a working visual-verification toolchain (Playwright + screenshot harness) exists for every subsequent re-skin phase to use.
**Depends on:** Nothing (first phase)
**Requirements:** BRND-01, BRND-02, BRND-03, VRFY-01, VRFY-02
**Success criteria:**

1. Login page, empty states, sidebar chrome, page titles, and toasts speak the polytoken register (warm, first-person copy — "Your workspace", not systems vocabulary)
2. A committed logo mark (rounded node/brain hybrid SVG, anchored on the existing teal `color.primary`) renders in the sidebar brand slot, login card, and favicon
3. PROJECT.md records the brand decision + USER-LOCKED naming (polytoken/polytoken.ai, collision explicitly accepted) plus what stays user-gated (domain purchase, trademark filing); an in-repo brand guide documents voice, do/don't, and mark usage
4. `@playwright/test` (+ firefox) is installed; the parked code-island isolation spec runs green on chromium AND firefox, and the auth-redirect spec runs green (closes todo 2026-07-10-playwright-code-island-isolation-run)
5. A screenshot-driven visual review harness exists (Playwright screenshots of surfaces across packs/viewports) and produces a reviewable artifact

**Plans:** 5 plans (2 waves)

Plans:
- [ ] 47-01-PLAN.md — polytoken brand mark + login/sidebar chrome (BRND-02 + BRND-01 slice)
- [ ] 47-02-PLAN.md — polytoken copy sweep: titles, empty states, toasts (BRND-01)
- [ ] 47-03-PLAN.md — Brand guide + PROJECT.md Key Decisions entry (BRND-03)
- [ ] 47-04-PLAN.md — Playwright toolchain + parked specs green on chromium+firefox (VRFY-01)
- [ ] 47-05-PLAN.md — Screenshot review harness across surfaces/viewports (VRFY-02)
**UI hint**: yes

### Phase 48: Token-System Extensions

**Goal:** The v1.4 DTCG token system is extended (never discarded) with the primitives every re-skin, mobile, and panel-editing phase needs — pill radius, success color, code typography, tier-ladder tokens, a graph node/edge-type palette, a hover/active convention, and a breakpoint-awareness decision.
**Depends on:** Phase 47 (uses the screenshot harness to verify pack-wide token rendering)
**Requirements:** TOKN-01, TOKN-02, TOKN-03, TOKN-04, TOKN-05, TOKN-06, TOKN-07
**Success criteria:**

1. New utility token aliases exist and are consumed at their designated call sites in all 6 style packs: `radius.pill` (citation chips, follow-up chips, and tab pills render true pill shapes), `color.success`/`color.successForeground` (WCAG-AA verified, pairing the existing destructive side), and `typography.code.family` (`brutalist`'s JetBrains Mono display-family workaround migrated onto it)
2. Two novel, purpose-built token systems exist with no competitor precedent to borrow: tier-ladder tokens consumed by the knowledge tier badges (never overloading `color.accent`/`color.muted`), and a closed graph node/edge-type palette consumed by the xyflow canvas for node differentiation (email/chat/knowledge/artifact) — zero raw hex (D-03/STYLE-03 holds)
3. Two design conventions are recorded and applied: a documented hover/active-state derivation rule used consistently, and a breakpoint-awareness decision with a minimal working mechanism that the mobile phase builds on

**Plans:** TBD

### Phase 49: Total UI Re-skin

**Goal:** Every major product surface — chat, inbox, knowledge canvas, studio, settings, login — speaks the polytoken register on the extended token system, with token discipline holding throughout.
**Depends on:** Phase 48 (consumes tier-ladder + graph-palette tokens on the knowledge canvas, pill/success/code tokens elsewhere)
**Requirements:** RSKN-01, RSKN-02, RSKN-03, RSKN-04, RSKN-05
**Success criteria:**

1. `/chat` (composer, message stream, tool-round activity rows, citation chips) is re-skinned in the polytoken register on extended tokens
2. The thread inbox (three-pane, thread groups) and email detail view are re-skinned on extended tokens
3. `/knowledge` canvas is re-skinned — tier badges on TOKN-04 tokens, node types on the TOKN-05 palette
4. `/studio`, `/settings/*`, and `/login` are re-skinned in the polytoken register
5. Zero raw hex outside token sources holds across the re-skin; the existing WCAG-AA contrast + token-family registration regression gates stay green and extend to the new TOKN-* aliases

**Plans:** TBD
**UI hint**: yes

### Phase 50: Mobile-Responsive Answer

**Goal:** The product is usable on a mobile viewport — canvas surfaces gracefully degrade to an inline-first list/feed rather than an unusable shrunk canvas, per the market-validated pattern (ChatGPT removed Canvas 2026-05-28 over cross-surface inconsistency; Claude Artifacts render inline on mobile).
**Depends on:** Phase 48 (TOKN-07 breakpoint decision) and Phase 49 (re-skinned surfaces to make responsive)
**Requirements:** MOBL-01, MOBL-02
**Success criteria:**

1. On small screens, canvas surfaces (chat canvas, `/knowledge`) collapse to a list/feed presentation; desktop keeps the 2D canvas
2. Core flows (login → inbox → thread → email detail → chat) show no horizontal overflow on a mobile viewport
3. Touch targets stay ≥44px on a mobile viewport even under denser style packs

**Plans:** TBD
**UI hint**: yes

### Phase 51: Editable Genui Panels / Studio-on-Canvas

**Goal:** Canvas genui panels become live editing surfaces instead of read-only renders — a user can re-theme, tweak, and regenerate a panel in place, absorbing backlog 999.7 and the cheap generation-side slice of 999.4 Design Engine (DSGN-03).
**Depends on:** Phase 48 (style-pack/token machinery); functionally independent of Phases 49/50 — parallelizable
**Requirements:** PANL-01, PANL-02, PANL-03, PANL-04
**Success criteria:**

1. User can switch a genui panel's `style_pack_id` in place from per-panel controls; the choice persists across reloads
2. User can tweak a panel's spec parameters in place through a bounded editing surface, schema-validated via the same untrusted-input gate as FOUND-6
3. User can regenerate a panel variant in place, with provenance retained and the prior version reachable
4. User can issue a natural-language re-theme instruction on a panel that resolves to pack/token choices (DSGN-03's cheap generation-side slice; no visual-compare repair loop)

**Plans:** TBD
**UI hint**: yes

## Backlog

- ~~**999.1 — GenUI history per-importer authorization**~~ **RESOLVED by Phase 44 (Plan 44-07, 2026-07-10):** genui `historyList`/`historyById` now owned-importer-scoped from the session (tRPC `protectedProcedure` + ownership helper). Original issue: `GET /v1/genui/history` returned all importers' rows when `importer_id` omitted (Phase 16 CR-01).
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — Design Engine (deferred):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). See REQUIREMENTS.md → Future Requirements.
- **999.5 — Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
- **999.6 — Chat & Studio Design Uplift — PROMOTED to v1.4 (2026-07-06), SHIPPED 2026-07-07.** UPLIFT-01..03 — see milestones/v1.4-ROADMAP.md for full detail (finer FIX/ADOPT/TOKEN requirement IDs superseded the coarse UPLIFT-01..03 IDs).
- **999.7 — Editable genui panels / studio-on-canvas (raised 2026-07-06, user):** each canvas genui-panel becomes a live editing surface — per-panel controls to change UI tokens / `style_pack_id`, tweak spec parameters, and run studio-related tools (re-theme, regenerate variant, inspect) in place, instead of the current read-only render. Foundations already deliberately open: the versioned node-type registry (CANVAS-03) admits a richer "editable/studio panel" node type; `style_pack_id` is already threaded through chat + canvas (v1.3 locked decision); the Phase-17 DTCG style-pack engine + `/studio` token machinery already exist; the per-chat shared-state store can hold live params. Overlaps **999.4 Design Engine** — a promptable design system is the generation-side of the same tokens. NOT yet a requirement/phase.
- **999.8 — Declarative display-binding gap (found live 2026-07-06):** the declarative renderer binds values via a `dataRef` dotted-path field (`resolveDataRef`, SPEC-05) — it does NOT interpolate `{{mustache}}` inside a text node's `content`. Two candidate fixes: (a) generator-prompt fix (cheap, high-value), and/or (b) a small renderer affordance to resolve declared-state into text (bigger, touches the locked renderer). **Option (a) shipped as v1.4 POLISH-01 (Phase 26), 2026-07-06. Option (b) remains backlogged** — it touches the locked `SpecRenderer`.
- **999.9 — Canvas auto-layout stacking (cosmetic) — folded into v1.4 as POLISH-02 (Phase 26), SHIPPED 2026-07-06.**
- **999.10 — Knowledge-graph uplift — PROMOTED to v1.5 (2026-07-07), SHIPPED 2026-07-08.** Adopt graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live Postgres store, per its own staged cost/benefit ordering — see full analysis in `.planning/phases/999.10-knowledge-graph-uplift-graphify-adoption/NOTE.md`. Executed as Phases 29–32 (see milestones/v1.5-ROADMAP.md). Stage-3 BFS-into-prompts, budget-aware tier-pruning, and snapshot/diff remain explicitly deferred (tracked as KGX-01..03 in REQUIREMENTS.md → Future Requirements) until RECALL-02 measures a real retrieval-miss rate.
- **999.11 — polytoken.ai product vision (raised 2026-07-07, user):** total rebrand (nauta → polytoken.ai) + UI refactor + branding/design/marketing research + auth/gauth/tenancy/RLS; email-thread cards on canvas with attached chats + web-research → knowledge nodes → promote-to-global (the "AI-powered ontology driven by user chats"); desktop app + daemon (remote filesystem, watched folders, directory panels with Claude-Code-class attached chats, embedded editor panels); browser-control canvas panel; user-controlled tool/skill registry + agent self-repository of reusable functions; distributed inference/compute-credit pooling (explicitly last/gated). Full dependency-ordered epoch ladder (E0–E7), backlog absorption map, and irreversibility guardrails: `.planning/research/polytoken-vision/VISION.md`. Draws from after v1.6; does NOT alter v1.6 sequencing.
- **999.12 — Tailwind v4 + React 19 migration (raised 2026-07-07, UI-ecosystem research):** migrate `apps/web` + `packages/ui` off Tailwind 3.4/React 18 to unlock direct shadcn registry installs (`shadcn add @kibo-ui/…`) in place of the vendor+adapt workflow documented in `.claude/skills/nauta-design-system/SKILL.md`. Ecosystem registries (`@magicui`, `@kibo-ui`, `@coss` ex-Origin UI) all emit Tailwind v4/oklch payloads now. Scope: port the HSL tokens in `apps/web/src/app/globals.css` to `@theme`/oklch, revalidate every vendored `packages/ui` component, and decide the Radix-vs-Base UI stance (upstream shadcn switched default primitives to Base UI, 2026-07). Registry wiring already in place: `packages/ui/components.json` (2026-07-07).
- **999.13 — genui catalog expansion: register vendored components as spec types (raised 2026-07-08, user):** the declarative genui catalog (`packages/genui/src/catalog/manifest.ts`, 17 frozen `SpecNodeType`s, `RegisteredTypeSchema` allowlist) cannot emit the 20 vendored Magic UI/Kibo UI components shipped in `59dbf3b` — they render `UnknownComponentPlaceholder`. Register the high-payoff simple-prop ones first (`number-ticker`, `spinner`, `avatar-stack`, `animated-list`, `marquee`): per component = SpecNodeType literal + ManifestEntry (LLM description, CI-gated example, `.strict()` Zod propsSchema, component ref) + catalog tests (CTLG-04). Touches the locked generation surface (Bedrock structured-output grammar D-22/COST-02, catalog prompts D-23) — run as a small phase, not a drive-by. Code-island channel is out of scope by design (AST allowlist blocks imports). Components already browser-verified via `/dev/components` showcase.
- **999.14 — untracked dev/design scratch pages break `@polytoken/web` typecheck (found by Phase 42 verification, 2026-07-09):** the untracked `apps/web/src/app/dev/design/` showcase still imports `@nauta/ui/*` (20 specifiers in `previews-vendored.tsx`); after the Phase-42 rename removed `node_modules/@nauta`, Next's regenerated `.next/types/validator.ts` transitively imports the page and `npm run typecheck -w @polytoken/web` fails with 22 `TS2307` errors — the Task-3 tsconfig `exclude` cannot stop transitive imports reached via `.next/types`, so local `next build` (`ignoreBuildErrors: false`) would fail identically. Git-based CI/Vercel builds are unaffected (the dir is untracked). Fix options: find/replace `@nauta/ui` → `@polytoken/ui` inside the user-owned scratch dir (hard-excluded from Phase 42 by decision), or commit/delete the scratch content. Evidence: `.planning/phases/42-atomic-rename-nauta-polytoken/42-VERIFICATION.md` (status gaps_found, 7/8; gap parked here — ship not blocked).
- **999.15 — Chat-path Bedrock prompt caching (raised 2026-07-09, cost hygiene):** the chat/tool-loop path re-sends its static prefix — the chat system prompt + the `emit_ui_spec` SpecRoot JSON schema injected as `input_schema` (`apps/email-listener/app/.../chat_tools.py:74-84`, the largest single block) — at full input rate on **every turn AND every tool round** (loop runs ≤4 rounds/turn, `run_chat_turn_tool_loop.py`). No `cache_control` anywhere on this path (`bedrock_chat_adapter.py:70-82` passes `system` through unchanged). The genui path already proves the fix: `cache_control:{type:ephemeral}` / `cachePoint` on the static block (COST-01, D-21, `genui_generator_adapter.py:171-188`). Scope: add cache points on the chat system block + the tools schema (Bedrock `cachePoint` may be set in `system`/`tools`; 5-min or 1-hr TTL — `research/CURRENCY-2026.md:58-66`); fully lossless (cache-read ≈ 0.1× input), self-contained, no schema/renderer changes. **Context:** app Bedrock spend is ~$10/mo behind ~$30/mo fixed infra — this is hygiene, not a headline cut; sequence behind higher-value product work. Two sibling cost items surfaced the same day but NOT filed: Batches API for the eval judge (`scripts/genui_eval/judge_adapter.py`, −50%, non-latency-sensitive), and the dormant `halfvec(1536)` vs Titan-Embeddings-V2-max-1024 dim mismatch (`research/CURRENCY-2026.md:272`, only bites on a V1→V2 move).
- **v1.6 deferred items (from this milestone's own research, tracked for a future pass):** entity-merge confirm-action's surrogate-key decision (Fork 2 allowlist #2 — `component_entity_candidate_links` is keyed by pair, not an addressable id); region-confirm confirm-action (Fork 2 allowlist #3 — has its own dedicated non-chat UI already); cheap-model sanitize pass for read-then-write tool chains (Fork 3 — staged until a write-capable tool exists); inline-interactive knowledge preview (Fork 1 — hand-rolled mini pan/zoom, gated on Phase 41's non-interactive preview proving insufficient); demote/undo path for promoted edges (Fork 2 — plain REST, supersede-never-mutate, lower urgency); `web_search` ToolExecutor + source-capture as INFERRED nodes (VISION.md E1 addition — not load-bearing for v1.6).
