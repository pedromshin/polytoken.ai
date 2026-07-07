# Requirements: nauta.services.email-listener — Milestone v1.4 Chat & Studio Design Uplift

**Defined:** 2026-07-06
**Core Value:** Reliably receive every inbound email destined for agent@magnitudetech.com.br and make it observable.
**Milestone goal:** A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome — zero new npm dependencies — executing the pre-baked 3-phase punch list in `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` (the locked source of truth for every item below; do not re-derive).

**Provenance:** Backlog 999.6 (UPLIFT-01..03, queued after v1.3 by user directive), promoted at milestone open. Backlog 999.8(a) and 999.9 folded in per their own backlog notes. The coarse archived IDs UPLIFT-01..03 (milestones/v1.3-REQUIREMENTS.md) are superseded by the finer FIX/ADOPT/TOKEN categories below.

**Hard constraints (locked, from research doc):** teal `primary` (`hsl(164 39% 22%)`) only — never a second brand hue; 2-weight typography (`font-normal`/`font-semibold`); 4-role type scale; 8-point spacing; 60/30/10 color discipline with the accent allowlist; **zero new npm dependencies**.

## v1 Requirements

### Zero-Dependency Contract Fixes (research doc Phase A — do first; pure token/class-level changes)

- [x] **FIX-01**: React Flow's stock chrome (`.react-flow__controls`, `__minimap`, `__background`, `__attribution`) is styled with the app's existing token vars — no more off-the-shelf light-gray boxes on the canvas, correct in dark mode
- [x] **FIX-02**: No `font-medium` anywhere on `/chat` or `/studio` — fixed at the source (`packages/ui/src/button.tsx` `buttonVariants` base class) and across the 11 Studio call-sites, restoring the locked 2-weight typography contract
- [x] **FIX-03**: Studio's three hardcoded color systems (`code-island-frame.tsx` PHASE_TONE + ViolationList + `bg-white` iframe wrapper, `page-ideas-island.tsx` curveball badge, `history-island.tsx` FallbackNotice, `code-sandbox-island.tsx` `text-red-600`) use semantic tokens (`destructive`/`primary`/`muted`) and render correctly in dark mode
- [x] **FIX-04**: `ChatNode` and `GenuiPanelNode` have visually differentiated header chrome (per-kind accent or icon) — the canvas no longer reads as identical gray boxes
- [x] **FIX-05**: The 3 duplicated raw-`JSON.stringify` panes (generation-sandbox, history, preview) are one shared component with consistent indentation and a copy button
- [x] **FIX-06**: The catalog prop table is styled to match its surrounding card chrome (zebra rows, muted header fill) instead of a bare HTML `<table>`
- [x] **FIX-07**: Conversation rows and turn-action icon buttons have `transition-colors` and real hover affordances (background/border at rest and hover)
- [x] **FIX-08**: Assistant messages carry minimal role chrome (a thin left rail) so role is distinguishable beyond alignment alone
- [x] **FIX-09**: The composer reads as a visual "dock" (`border-t` + subtle token-safe top shadow)
- [x] **FIX-10**: Scrollbar treatment is uniform — composer textarea and markdown code/table wrappers match the Radix-styled `ScrollArea` aesthetic used by MessageList/ConversationRail
- [x] **FIX-11**: The 3–4 near-duplicate empty-state components are differentiated instead of repeating one identical icon+heading+paragraph recipe

### Adopted External Picks (research doc Phase B — near-zero footprint; verdicts locked)

- [x] **ADOPT-01**: impeccable.style's product-register rules + 13-item absolute-bans checklist are folded into `UI-SPEC.md`/6-pillar review as a prose appendix (no install)
- [x] **ADOPT-02**: Magic UI's `file-tree` is ported into the code-island file browser (zero new deps — only already-installed `@radix-ui/react-accordion` + `lucide-react`)
- [x] **ADOPT-03**: A `<GeneratingRing>` primitive hand-ported from Magic UI's shine-border/animated-shiny-text CSS techniques (teal-only, `motion-safe:`-gated, zero JS) marks "generating" state on genui cards in Chat and the sandbox/history tabs in Studio
- [x] **ADOPT-04**: The 3 `ux-designer-skill` reference files (canvas-navigation, canvas-objects-performance, ai-ux-patterns) are copied into a slim project reference doc
- [ ] **ADOPT-05**: 3–4 `transitions.dev` CSS snippets (modal, panel-reveal, dropdown) are hand-copied and retokenized to the app's custom properties

### Design-System Token Upgrades (research doc Phase C — sequenced last, after A surfaces papered-over gaps)

- [ ] **TOKEN-01**: `secondary`, `muted`, and `accent` are tonally differentiated (still neutral, still 60/30/10-compliant) instead of three names for one stock shadcn gray
- [ ] **TOKEN-02**: `chart-1..5` and `sidebar-*` tokens are rebased off the teal `primary` instead of stock shadcn demo colors
- [ ] **TOKEN-03**: A real shadow scale (e.g. `elevation-1/2/3`, teal-tinted ambient) exists in `packages/tailwind-config/base.ts` (cite styles.refero.design's numeric backing per research doc)
- [ ] **TOKEN-04**: `xl`/`2xl` radius steps exist and `packages/ui/src/card.tsx`'s hardcoded `rounded-xl` consumes the token
- [ ] **TOKEN-05**: The already-installed `tailwindcss-animate` powers entrance/stagger beyond Radix defaults — genui panel mount and Studio's history/page-ideas list items

### Folded Backlog Polish (999.8a + 999.9, per their own backlog notes)

- [x] **POLISH-01**: The declarative generator is prompt-taught to express declared-state display via `dataRef`-bound nodes (never `{{mustache}}` text content), with `setState` increment-vs-absolute guidance — a "counter bound to state" prompt produces a live-updating render (999.8 option (a) only)
- [x] **POLISH-02**: New canvas panels auto-lay out without cramped vertical stacking (horizontal/grid default direction or smarter initial placement) (999.9)

## Future Requirements

Deferred, tracked in ROADMAP.md backlog — not in this roadmap.

### Design Engine (backlog 999.4 → likely v1.5)

- **DSGN-01..04**: unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction (see milestones/v1.3-REQUIREMENTS.md → Future Requirements)

### Orchestration Visualizer (backlog 999.5)

- **ORCH-01**: live orchestration run-tree visualization on the canvas (seams SEAM-03/04 + CANVAS-03 left open by v1.3)

### Other carried backlog

- **999.3**: v1.3/v1.2 connected-env verification + measurement (needs live Bedrock + browser)
- **999.7**: editable genui panels / studio-on-canvas (overlaps 999.4)
- **999.8(b)**: renderer affordance resolving declared-state into text — touches the locked `SpecRenderer`; explicitly out of scope for v1.4 (option (a) is POLISH-01 above)
- Anticipatory-prompting go/no-go follow-through (7 seams, 25-SPIKE-FINDINGS.md)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| 999.8 option (b) — renderer affordance resolving declared-state into text | Touches the locked `SpecRenderer`; generator-prompt fix (a) is the cheap high-value path |
| Any new npm dependency (incl. `motion` package) | Hard user constraint — "zero new deps"; rejects Magic UI `border-beam`/`animated-list`/`terminal`/`dock`/`highlighter` |
| Tailark blocks | Verdict: skip — marketing/auth blocks only, Tailwind v4 syntax vs this repo's v3.4.4 |
| frontend-design / taste-skill / hallmark / canvas-design agent skills | Verdict: reject as a group — duplicate the repo's own UI-SPEC + 6-pillar review |
| Custom typeface | Not in the locked plan; system-ui stack stays |
| `GenuiPartBoundary` / `InteractiveWidgetBoundary` chrome | Already owned + fixed by Phase 24 (`variant="bare"`); explicit non-interference in the research doc |
| impeccable `checks.mjs` vendoring into the genui repair loop | Research doc: "deferred, not forgotten" — do when that loop is touched for other reasons |
| Generative-engine output quality (DSGN-01..04) | Distinct milestone (999.4); this milestone is the app's own hand-built chrome |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 26 | Complete |
| FIX-02 | Phase 26 | Complete |
| FIX-03 | Phase 26 | Complete |
| FIX-04 | Phase 26 | Complete |
| FIX-05 | Phase 26 | Complete |
| FIX-06 | Phase 26 | Complete |
| FIX-07 | Phase 26 | Complete |
| FIX-08 | Phase 26 | Complete |
| FIX-09 | Phase 26 | Complete |
| FIX-10 | Phase 26 | Complete |
| FIX-11 | Phase 26 | Complete |
| POLISH-01 | Phase 26 | Complete |
| POLISH-02 | Phase 26 | Complete |
| ADOPT-01 | Phase 27 | Complete |
| ADOPT-02 | Phase 27 | Complete |
| ADOPT-03 | Phase 27 | Complete |
| ADOPT-04 | Phase 27 | Complete |
| ADOPT-05 | Phase 27 | Pending |
| TOKEN-01 | Phase 28 | Pending |
| TOKEN-02 | Phase 28 | Pending |
| TOKEN-03 | Phase 28 | Pending |
| TOKEN-04 | Phase 28 | Pending |
| TOKEN-05 | Phase 28 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-06*
*Last updated: 2026-07-06 at v1.4 roadmap creation — 23/23 requirements mapped to Phases 26 (FIX-01..11, POLISH-01..02), 27 (ADOPT-01..05), 28 (TOKEN-01..05); no orphans*
