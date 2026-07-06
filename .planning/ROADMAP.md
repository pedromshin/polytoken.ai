# Roadmap: nauta.services.email-listener

## Milestones

- ✅ **v1.0 — MVP** (Phases 1–11) — inbound email → parse → extract → entities/knowledge (shipped; phase dirs retained under `.planning/phases/`, lifecycle not formally run).
- ✅ **v1.1 — Generative UI Engine** (Phases 12–15) — spec-first Catalog→Spec→Registry→Renderer→Generation→Cache→Studio. Archived: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
- ✅ **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) — SHIPPED 2026-07-03. Eval harness + style packs + catalog expansion + declarative form engine + jailed-eval code-island (multi-candidate + judge). Archived: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Audit: [milestones/v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md).
- ✅ **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25) — SHIPPED 2026-07-06. Persistent streamed `/chat` on a 2D infinite canvas of genui panels with bidirectional (agent↔user) interactive widgets, plus an anticipatory-prompting spike. Local/sandbox only. Archived: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) · Audit: [milestones/v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md).
- 🚧 **v1.4 — Chat & Studio Design Uplift** (Phases 26–28) — IN PROGRESS. A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome — zero new npm dependencies — executing the locked 3-phase punch list (zero-dep contract fixes → adopted external picks → design-system token upgrades) from `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md`.

## Phases

**Phase Numbering:**
- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. **v1.4 starts at Phase 26.**
- Integer phases (26, 27, 28): planned v1.4 milestone work.
- Decimal phases (e.g. 26.1): urgent insertions via `/gsd:phase insert`, executed between the
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

### 🚧 v1.4 — Chat & Studio Design Uplift (In Progress)

**Milestone Goal:** A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built
chrome — zero new npm dependencies — executing the locked 3-phase punch list in
`.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` (the source of truth for phase ordering and every
item below: zero-dep contract fixes → adopted external picks → design-system token upgrades). Local/
sandbox only — no deploy criteria.

**Hard constraints (apply to every phase below, locked from the research doc):** teal `primary`
(`hsl(164 39% 22%)`) only — never a second brand hue; 2-weight typography (`font-normal`/
`font-semibold` only, no `font-medium`); 4-role type scale; 8-point spacing; 60/30/10 color
discipline with an explicit accent allowlist; **zero new npm dependencies**. Nothing in this
milestone touches `packages/genui/src/renderer/spec-renderer.tsx` or `GenuiPartBoundary`/
`InteractiveWidgetBoundary` chrome (already owned/fixed by Phase 24).

- [ ] **Phase 26: Zero-Dependency Contract Fixes + Backlog Polish** - `/chat` and `/studio`'s own chrome (React Flow, node differentiation, hardcoded colors, JSON panes, prop table, hover states, role chrome, composer dock, scrollbars, empty states) matches the app's existing token system instead of stock/hardcoded values, plus two small independent backlog fixes (declared-state binding, canvas auto-layout)
- [ ] **Phase 27: Adopted External Design Picks** - Impeccable's product-register rules, Magic UI's file-tree + generating-ring CSS technique, ux-designer-skill references, and transitions.dev snippets are folded into the app and its docs at near-zero footprint
- [ ] **Phase 28: Design-System Token Upgrades** - The foundational token set (secondary/muted/accent, chart/sidebar hues, shadow scale, radius steps, entrance animation) is upgraded so every consuming surface benefits at once

## Phase Details

### Phase 26: Zero-Dependency Contract Fixes + Backlog Polish
**Goal**: `/chat` and `/studio`'s hand-built chrome stops reading as an unstyled library drop-in or a
set of undifferentiated boxes — every surface correctly uses the app's existing token system, in both
light and dark mode — and two small, independent backlog defects (declared-state text binding,
cramped canvas auto-layout) are fixed.
**Depends on**: Nothing (first v1.4 phase; builds on the existing v1.1–v1.3 chat/canvas/studio
surfaces). Research doc: do this phase first so Phases 27–28 build on a clean base.
**Requirements**: FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06, FIX-07, FIX-08, FIX-09, FIX-10, FIX-11, POLISH-01, POLISH-02
**Success Criteria** (what must be TRUE):
  1. React Flow's own chrome (`Controls`/`MiniMap`/`Background`/`Attribution`) renders with the app's token vars in both light and dark mode instead of the library's stock light-gray boxes, and `ChatNode` vs `GenuiPanelNode` are visually distinguishable at a glance via per-kind header accent/icon
  2. No rendered text in `/chat` or `/studio` uses `font-medium` — fixed at the source (`buttonVariants` base class) and across all 11 Studio call-sites — restoring the locked 2-weight typography contract app-wide
  3. Studio's three hardcoded amber/red color systems and the 3 duplicated raw-JSON debug panes are replaced by shared, token-based treatments (`destructive`/`primary`/`muted`) that render correctly in dark mode, the JSON panes share one component with a copy button, and the catalog prop table has zebra rows + a muted header matching its surrounding card chrome
  4. Conversation rows, turn-action icon buttons, the composer, and scrollbars all present consistent eased hover/transition affordances and a visual "dock" treatment, and assistant messages carry a thin role-chrome rail distinguishing them from user messages beyond alignment alone
  5. The 3-4 empty-state components are visually differentiated from one another, new canvas panels no longer stack in a cramped vertical column by default, and a "counter bound to state" chat prompt produces a live-updating `dataRef`-bound render instead of a static `{{count}}` literal
**Plans**: 7 plans (all wave 1 — disjoint file sets, fully parallel)
Plans:
- [x] 26-01-PLAN.md — Shared JSON pane component + history-island token cleanup (FIX-05, FIX-02, FIX-03)
- [x] 26-02-PLAN.md — Studio token discipline: PHASE_TONE/ViolationList/iframe, catalog prop table, remaining font-medium (FIX-02, FIX-03, FIX-06)
- [x] 26-03-PLAN.md — Button-source font-medium + chat hover affordances + assistant left rail (FIX-02, FIX-07, FIX-08)
- [ ] 26-04-PLAN.md — Canvas node differentiation + auto-layout tuning (FIX-04, POLISH-02)
- [ ] 26-05-PLAN.md — React Flow chrome CSS + composer dock + uniform scrollbars (FIX-01, FIX-09, FIX-10)
- [ ] 26-06-PLAN.md — Shared EmptyState primitive + 3 call sites (FIX-11)
- [ ] 26-07-PLAN.md — Generator prompt: declared-state dataRef binding (POLISH-01)
**UI hint**: yes

### Phase 27: Adopted External Design Picks
**Goal**: The five researched external resources' narrowly-scoped, zero/near-zero-footprint
takeaways are actually present in the app and its documentation — not just decided in research.
**Depends on**: Phase 26 (research doc's dependency order: fixes first, so external picks land on a
token-correct base)
**Requirements**: ADOPT-01, ADOPT-02, ADOPT-03, ADOPT-04, ADOPT-05
**Success Criteria** (what must be TRUE):
  1. `UI-SPEC.md` (or the 6-pillar review doc) contains a new appendix with impeccable.style's product-register rules and its 13-item absolute-bans checklist
  2. The code-island file browser renders a ported Magic UI `file-tree` component built only from already-installed `@radix-ui/react-accordion` + `lucide-react` (zero new deps)
  3. A teal-only, `motion-safe:`-gated `<GeneratingRing>` primitive visibly marks "generating" state on genui cards in Chat and on the sandbox/history tabs in Studio
  4. A slim project reference doc contains the 3 copied `ux-designer-skill` files (canvas-navigation, canvas-objects-performance, ai-ux-patterns)
  5. 3-4 retokenized `transitions.dev` CSS snippets (modal, panel-reveal, dropdown) are visibly used at their corresponding UI moments, using the app's own custom properties
**Plans**: TBD
**UI hint**: yes

### Phase 28: Design-System Token Upgrades
**Goal**: The foundational token layer (`globals.css` + Tailwind preset) stops papering over gaps
with hardcoded values — every surface that consumes `secondary`/`muted`/`accent`, `chart-*`/
`sidebar-*`, shadow, radius, or entrance-animation tokens benefits at once.
**Depends on**: Phase 26 (research doc's rationale: sequence token upgrades last so Phase 26 has
already surfaced every place a token gap was papered over with a hardcoded value)
**Requirements**: TOKEN-01, TOKEN-02, TOKEN-03, TOKEN-04, TOKEN-05
**Success Criteria** (what must be TRUE):
  1. `secondary`, `muted`, and `accent` render as tonally distinct neutral tones (no longer one shared stock-shadcn gray) in both light and dark mode, still 60/30/10-compliant
  2. Chart series colors and the sidebar visibly use teal-derived hues instead of stock shadcn demo colors
  3. A real elevation/shadow scale (`elevation-1/2/3`, teal-tinted) exists in `packages/tailwind-config/base.ts` and is visibly applied; `xl`/`2xl` radius steps exist and `packages/ui/src/card.tsx` consumes the radius token instead of a hardcoded `rounded-xl`
  4. Genui panel mount and Studio's history/page-ideas list items visibly animate in (entrance/stagger) via the already-installed `tailwindcss-animate`, going beyond bare Radix open/close transitions
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 26 → 27 → 28 (locked by the research doc: Phase A surfaces every
papered-over token gap before Phase C touches the token layer)

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 26. Zero-Dependency Contract Fixes + Backlog Polish | 3/7 | In Progress|  |
| 27. Adopted External Design Picks | 0/? | Not started | - |
| 28. Design-System Token Upgrades | 0/? | Not started | - |

## Next

Roadmap created. Run `/gsd:plan-phase 26` to break Phase 26 into executable plans.

## Backlog

- **999.1 — GenUI history per-importer authorization** (from Phase 16 code review, CR-01): `GET /v1/genui/history` returns all importers' rows when `importer_id` is omitted. Accepted for the current single-shared-key local/sandbox posture (auth enforced via `X-API-Key`; mirrors `/v1/genui/generate`). Enforce per-importer scoping (require `importer_id` or derive from auth context) if real multi-tenancy is introduced. Source: `.planning/phases/16-.../16-REVIEW.md`.
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — Design Engine (deferred, likely v1.5):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). Renamed from "v1.4" (2026-07-06) since v1.4 is now Chat & Studio Design Uplift, below. See REQUIREMENTS.md → Future Requirements.
- **999.5 — v1.5 Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
- **999.6 — Chat & Studio Design Uplift — PROMOTED to v1.4 (2026-07-06).** UPLIFT-01..03 — a no-bloat visual/token-discipline polish pass on `/chat` + `/studio`'s own hand-built chrome (distinct from DSGN-01..04, which is about the *generative* engine's output quality). Full code-level audit + 5 external-resource verdicts (impeccable.style adopt-now, Magic UI adopt-now-narrow, agent design skills adopt-now-narrow, styles.refero.design adopt-later-reference-only, Tailark skip) + the 3-phase punch list (zero-dep fixes → adopted external picks → design-token upgrades) is now executing as **Phases 26–28** above (finer FIX/ADOPT/TOKEN requirement IDs supersede the coarse UPLIFT-01..03 IDs). Non-interference note: does not touch `GenuiPartBoundary`/`InteractiveWidgetBoundary`, already owned by Phase 24 (`24-03-PLAN.md`). Source: `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md`.
- **999.7 — Editable genui panels / studio-on-canvas (raised 2026-07-06, user):** each canvas genui-panel becomes a live editing surface — per-panel controls to change UI tokens / `style_pack_id`, tweak spec parameters, and run studio-related tools (re-theme, regenerate variant, inspect) in place, instead of the current read-only render. Foundations already deliberately open: the versioned node-type registry (CANVAS-03) admits a richer "editable/studio panel" node type; `style_pack_id` is already threaded through chat + canvas (v1.3 locked decision); the Phase-17 DTCG style-pack engine + `/studio` token machinery already exist; the per-chat shared-state store can hold live params. Overlaps **999.4 Design Engine** — a promptable design system is the generation-side of the same tokens. NOT yet a requirement/phase; candidate for a milestone after v1.4 ("canvas as a live editing surface for genui artifacts").
- **999.8 — Declarative display-binding gap (found live 2026-07-06):** the declarative renderer binds values via a `dataRef` dotted-path field (`resolveDataRef`, SPEC-05) — it does NOT interpolate `{{mustache}}` inside a text node's `content`. The generator, prompted for a "counter bound to state", emitted `{"type":"text","content":"{{count}}"}`, which renders the literal string `{{count}}` and never updates, even though the button `onClick:{type:"setState",key:"count"}` DOES write to the (canvas) store. Two candidate fixes: (a) generator-prompt fix — teach it to emit a bound value node / `dataRef` for declared-state display (cheap, high-value), and/or (b) a small renderer affordance to resolve declared-state into text (bigger, touches the locked renderer — weigh carefully). Also note the model conflated `setState value:1` (absolute) with true increment semantics — a related generator-guidance nit. **Option (a) folded into v1.4 as POLISH-01 (Phase 26), 2026-07-06. Option (b) remains backlogged** — it touches the locked `SpecRenderer`, explicitly out of scope for v1.4.
- **999.9 — Canvas auto-layout stacking (cosmetic, 2026-07-06):** dagre lays new panels in a tall narrow vertical column; on a fresh canvas with several panels they stack cramped until fit-view + manual drag. Consider a horizontal/grid default direction or a smarter initial placement. Low priority. **Folded into v1.4 as POLISH-02 (Phase 26), 2026-07-06.**
