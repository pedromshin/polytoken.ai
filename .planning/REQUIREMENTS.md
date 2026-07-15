# Requirements: polytoken — v1.10 Product Design & Research Canvas

**Defined:** 2026-07-14
**Core Value:** Reliably receive every inbound email and make it observable — now as a *designed*
product the user actually lives in: a research canvas that collects sources without ceremony, lets
the user select a personal canon, and treats canvas edges as context.

Sources: backlog 999.18 (production UI/UX rebuild — user verdict 2026-07-12), 999.19 (frictionless
research canvas — user's target workflow in their own words, 2026-07-12), 999.12 (Tailwind v4 /
React 19 migration, unparked 2026-07-14), 999.17 (editable-panel chrome on mobile). Sequenced ahead
of ENDGAME-PLAN.md's v2.0 by user decision 2026-07-14 (999.18/999.19 postdate the endgame lock and
argue design-before-more-surfaces).

**STANDING RULE (carried from v1.8, overridden once at v1.9 close — back in force):**
deploy/OAuth/live-UAT gates are first-class phase work, never deferrable-by-default; a milestone
isn't done until the user has touched the capability live.

**TASTE GATE (this milestone's defining constraint):** the visual identity is chosen by the USER
from sketched directions on real screens (IDNT-01/02), not derived autonomously. 999.18(d):
v1.9's autonomous-overnight approach cannot make taste decisions — that is what produced "the
whole UI is still ugly." No surface redesign (SURF-*) or canvas-visual work cascades before
IDNT-02 is locked.

## v1 Requirements

### Platform Migration (STCK — Band 1; palette-independent, runs first)

- [x] **STCK-01**: `apps/web` + `packages/ui` build and run on Tailwind v4 — the HSL tokens in `globals.css` are ported to `@theme`/oklch, and every existing WCAG-AA contrast + token-family-registration regression gate stays green on the new engine
- [x] **STCK-02**: `apps/web` + `packages/ui` build and run on React 19 — every vendored `packages/ui` component is revalidated and renders correctly (no runtime regressions in the 16-surface screenshot harness)
- [x] **STCK-03**: The Radix-vs-Base-UI primitive stance is decided and documented (upstream shadcn moved its default primitives to Base UI, 2026-07); the design-system skill is updated to match
- [x] **STCK-04**: A direct shadcn registry install (`shadcn add @kibo-ui/…`) works in place of the vendor-and-adapt workflow — verified on at least one real component (the payoff that justifies the migration)

### Visual Identity (IDNT — Band 2; BLOCKING HUMAN GATE)

- [ ] **IDNT-01**: 2–3 distinct visual directions are sketched on real polytoken screens (throwaway HTML, real content — inbox, chat, one canvas surface) so the user can compare actual looks, not swatches
- [ ] **IDNT-02**: The user selects one direction; the choice is recorded as the locked visual identity. **This is the gate — no SURF-* or canvas-visual work begins before it.**
- [ ] **IDNT-03**: The locked direction is realized as a designed token set — palette (oklch), type scale, spacing/density system, and a signature element — that *replaces* the stock-shadcn defaults rather than recoloring them
- [ ] **IDNT-04**: The brand guide gains a visual-identity section (today it defines only voice/tone) documenting the designed palette/type/spacing/signature with usage rules

### Surface Redesign (SURF — Band 3; depends on IDNT-02)

- [ ] **SURF-01**: The inbox (three-pane, thread groups, mobile feed) is redesigned on the new identity — layout, hierarchy, information density, interactions — not merely re-tokened
- [ ] **SURF-02**: `/chat` + its canvas is redesigned on the new identity (composer, message stream, tool-round rows, panels, canvas chrome)
- [ ] **SURF-03**: The `/knowledge` canvas is redesigned on the new identity
- [ ] **SURF-04**: The email-detail view (`/emails/[id]`, region overlays) is redesigned on the new identity
- [ ] **SURF-05**: `/studio`, `/settings/*`, and `/login` are redesigned on the new identity
- [ ] **SURF-06**: Every redesigned surface has production-grade empty, loading, and error states (not first-draft placeholders)
- [ ] **SURF-07**: Editable-panel chrome is reachable on mobile and the docked/mobile transcript honors panel overlays (closes 999.17)

### Research Canvas (RCNV — Band 4; backend palette-independent, visuals depend on IDNT-02)

- [x] **RCNV-01**: Sources the agent uses in a conversation (web_search results and other tool outputs) are auto-collected into a per-conversation source ledger — no per-turn capture-confirm ceremony (today's CLUS-04 widget is the explicit anti-goal)
- [ ] **RCNV-02**: Auto-collected sources appear as nodes on the canvas, visibly related to the research, without the user asking
- [ ] **RCNV-03**: The user can select auto-collected sources into a personal canon through a canvas-level curation UX built over the existing suggest-only promotion gate (INFERRED → EXTRACTED), never per-turn chat widgets
- [ ] **RCNV-04**: Connecting a source / generated-table / panel node to a chat node on the canvas injects that node's content as context for that chat — semantic edges, not visual-only (canvas sharedState was explicitly NOT the linkage store per D-54; this needs its own design)
- [ ] **RCNV-05**: The user can generate presentation-grade UI panels grounded in the selected canon/sources (source-grounded genui)

### Email Learning Loop (LEARN — Band 5; palette-independent, runs early)

- [x] **LEARN-01**: The user can correct what an email or extracted entity *is* (classification/extraction), and the correction is captured as structured, addressable signal
- [x] **LEARN-02**: Accumulated corrections improve subsequent classification/extraction for the same or similar entities — extending the suggest-only entity-resolution stance, **never auto-deciding**

## v2 Requirements

### Local Agent Platform (deferred to v2.0 — ENDGAME-PLAN.md §3)

- **DMON-**: daemon + ONE permission model + generalized ToolExecutor; watched folders → directory panels with Claude-Code-class attached chats (fs/terminal/git); browser panel CDP-first; tool registry as per-user allowlist; embedded editor + agent self-repository as stretch

### Deep nauta purge in live state (999.20 — next, needs DB access + user-driven infra)

- **PURG-**: migration 0037 for `entity_instances.nauta_id` (lockstep drizzle + Python domain/repo + tests); AWS `nauta-services-*` resource renames (re-parked Hazard A/B/C — S3 bucket holds real inbound email); local directory rename

## Out of Scope

| Feature | Reason |
|---------|--------|
| The three v1.9 live legs — LIVE-03 (§A OAuth), LIVE-04 (§B.3–6 real email), CLUS-07 (§H) | Owed as v1.9 debt (user declined to fold in, 2026-07-14, second ask); user-only console actions, no dev work — MORNING-CHECKLIST.md. Consequence: inbox/canvas redesigned against seeded fixtures, LEARN loop built without a real inbound message |
| v2.0 Local Agent Platform | The next epoch; lands on the finished UI this milestone produces |
| Perception/vision browser stack (pixelrag/ui-tars/etc.) | v2.0 E5 research fork, deliberately not locked now |
| Native mobile apps | Web-first, mobile-responsive only (VISION E2) |
| DSGN-02 visual-compare repair loop / DSGN-04 screenshot→token extraction | Not "cheap"; v2+ (999.4) |
| A promptable design system beyond the shipped NL re-theme (PANL-04) | Generation-side design engine is v2+ (999.4) |

## Traceability

Which phases cover which requirements. Filled by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STCK-01 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-02 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-03 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-04 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| RCNV-01 | Phase 56 — Research Canvas: Backend & Semantic Context Model | Complete |
| RCNV-04 | Phase 56 — Research Canvas: Backend & Semantic Context Model | Pending |
| LEARN-01 | Phase 57 — Email Learning Loop | Complete |
| LEARN-02 | Phase 57 — Email Learning Loop | Complete |
| IDNT-01 | Phase 58 — Visual Identity: Sketch & Pick (HUMAN GATE) | Pending |
| IDNT-02 | Phase 58 — Visual Identity: Sketch & Pick (HUMAN GATE) | Pending |
| IDNT-03 | Phase 59 — Visual Identity: Designed Token Set & Brand Guide | Pending |
| IDNT-04 | Phase 59 — Visual Identity: Designed Token Set & Brand Guide | Pending |
| SURF-01 | Phase 60 — Surface Redesign: Inbox & Email Detail | Pending |
| SURF-04 | Phase 60 — Surface Redesign: Inbox & Email Detail | Pending |
| SURF-02 | Phase 61 — Surface Redesign: Chat, Canvas & Mobile Panel Chrome | Pending |
| SURF-07 | Phase 61 — Surface Redesign: Chat, Canvas & Mobile Panel Chrome | Pending |
| SURF-03 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| SURF-05 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| SURF-06 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| RCNV-02 | Phase 63 — Research Canvas: Visual Surfaces | Pending |
| RCNV-03 | Phase 63 — Research Canvas: Visual Surfaces | Pending |
| RCNV-05 | Phase 63 — Research Canvas: Visual Surfaces | Pending |

**Coverage:**
- v1 requirements: 22 total (STCK 4 + IDNT 4 + SURF 7 + RCNV 5 + LEARN 2)
- Mapped to phases: 22/22 ✓
- Unmapped: 0

**Note on RCNV-03:** RCNV-03 ("user can select auto-collected sources into a personal canon
through a canvas-level curation UX") is owned by Phase 63 because the requirement is only
user-observably TRUE once the canvas curation UX exists. Phase 56 lays the palette-independent
promotion-gate-reuse groundwork it depends on, but does not claim the requirement.

---
*Requirements defined: 2026-07-14 (from the v1.10 opening Q&A; yolo mode, user asleep — scoping taken from the recorded decisions rather than an interactive pass)*
*Last updated: 2026-07-15 — ROADMAP.md created (Phases 55–63); traceability filled, 22/22 requirements mapped, coverage complete*
