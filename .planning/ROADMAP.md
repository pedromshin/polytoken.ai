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
- 📋 **Next milestone** — not yet opened. Two live candidates: **backlog 999.18** (full production UI/UX rebuild — the user's post-v1.9 verdict, HIGH PRIORITY) and **v2.0 Local Agent Platform** (E4+E5+E6 merged, the mapped next epoch). Run `/gsd:new-milestone` to open one.

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

- **999.19 — Frictionless research canvas: auto-collected sources, user canon, nodes-as-context (raised 2026-07-12, user — the production vision in the user's own words, prime E4/E5 shaping input for v2.0):** the user's target workflow, verbatim-distilled: (1) EMAIL LOOP — emails arrive (one-offs + recurring/same-entity); early on the user manually tells the system what each is, and over time it "gets it right all the time" from that feedback (continuous entity/classification improvement — extends the existing suggest-only entity-resolution stance with a learn-from-corrections loop, never auto-decide). (2) RESEARCH LOOP, all on ONE canvas page — broad chaotic research first: many chats, many sources, many angles on an idea; then refinement. (3) SOURCES WITHOUT CEREMONY — every source the agent uses in research should ALREADY be related to that research and visible on the canvas in some way, WITHOUT the user having to say "capture this as a knowledge source for this cluster" each time (today's CLUS-04 per-turn confirm-widget ceremony is the explicit anti-goal); from that auto-collected pool the user then SELECTS some into their own CANON (user-curated knowledge — maps to the existing INFERRED→promotion gate, but as a canvas-level curation UX over auto-collected candidates, not per-turn chat widgets). (4) COMPOSITION — relate saved sources on the canvas to a NEW chat panel (canvas edges become SEMANTIC: connecting source nodes / generated tables / panels to a chat node injects them as that chat's context — today edges are visual-only and context comes solely from thread_id cluster assembly). (5) PRESENTATION — from selected sources + generated tables, produce polished presentation-grade UI panels (genui grounded in the selected context). User's caveat: "this is not limited to this, but is a narrow version of what this product can do — but it's more or less this way, with this in specific also implemented." Gap analysis vs today: auto-collection of web_search sources per conversation = NEW (design decision needed: auto-collect as zero-write ephemeral records vs auto-INFERRED rows; suggest-only stance says nothing enters the KNOWLEDGE graph without user selection — but a per-conversation source LEDGER visible on canvas is not the knowledge graph); canvas source tray/auto-nodes = NEW; canon-selection UX = NEW (promotion gate reusable); edges-as-context = NEW + architecturally significant (canvas sharedState was explicitly NOT the linkage store per D-54; this needs its own design); source-grounded panel generation = partially exists (cluster context + genui). Relates to: 999.18 (the UI rebuild should design these surfaces, not retrofit them), VISION.md E4/E5. Evidence: user message 2026-07-12 (v1.9 closeout session).

- **999.20 — Deep nauta→polytoken purge in LIVE STATE (raised 2026-07-13, user "purge everything"):** the 2026-07-13 brand purge renamed every SAFE surface (code symbols incl. `NAUTA_CATALOG`→`POLYTOKEN_CATALOG`, UI strings, localStorage keys, CSS classes, sample/fixture data, comments, docs). Three "nauta" leaks remain BECAUSE they are coupled to live state and cannot be find-replaced without breakage — each needs a deliberate migration:
  1. **`entity_instances.nauta_id` DB column** — a live Postgres column (the master/canonical-entity FK set on human confirmation), referenced by the Python domain dataclass field, the Supabase repo row-map, promote_entity_on_confirm, and many tests. Rename requires: migration 0037 `ALTER TABLE entity_instances RENAME COLUMN nauta_id TO <new>` (candidate: `canonical_entity_id` — semantically clearer than a brand token; or `polytoken_id` for pure brand parity), applied local→staging→prod (Management API path proven), in LOCKSTEP with the drizzle schema + Python domain/repo + TS + test updates. A half-migration (code renamed, column not) breaks every entity read/write — same failure class as the jsonschema/scope_ref_id bugs. Blocked today only by needing DB access (fresh Supabase token) + Docker for local.
  2. **AWS resource names `nauta-services-*`** — ECR repo, ECS cluster/service, ALB, S3 bucket `nauta-services-ses-inbound-emails` (HOLDS REAL INBOUND EMAILS), Secrets Manager ARN paths, the `project = "nauta-services"` terraform var, and the `.github/workflows` deploy env vars that reference them. This is the re-parked Hazard A/B/C (EXTERNAL-IDENTITY-DECISIONS.md): ECR `force_delete=false` destroy+recreate, immutable ECS/ALB names, S3 buckets can't be renamed (must create-new + migrate objects + re-point SES receipt rules), local-only tfstate. Needs a planned infra migration with the user driving it, not a rename.
  3. **Local project directory `nauta.services.email-listener`** — the working-dir/repo folder name. Can't be changed from inside a session (it's the CWD every path resolves against). User action: rename the folder + re-open; git/remote already point at `pedromshin/polytoken.ai`.
  Also intentionally left as historical record (NOT bugs): `.planning/**` milestone archives (incl. v1.7 phase 42 "atomic-rename-nauta-polytoken" which documents the original rename) and `packages/db/migrations/**` snapshots (immutable journal — editing breaks the hash chain). Evidence: user "purge everything, project name is fucking polytoken.ai" 2026-07-13.
