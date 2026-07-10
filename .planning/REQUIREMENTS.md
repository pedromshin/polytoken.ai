# Requirements: polytoken — v1.8 Cortex Re-skin

**Defined:** 2026-07-10
**Core Value:** Reliably receive every inbound email and make it observable — now wrapped in a product that looks and feels like the personal AI workspace VISION describes.

Sources: `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` (DSSR-01, Cortex adopted),
`.planning/research/v1.8-design/DESIGN-PATTERN-DOSSIER.md` (DSSR-02, 8-item token punch list),
VISION.md E2 remainder, backlog 999.7 (editable panels) + 999.4 cheap slice (promptable design).

## v1 Requirements

### Brand Application (BRND)

- [ ] **BRND-01**: All user-facing copy speaks the Cortex register (warm, companion, first-person — "Your workspace", not systems vocabulary) across login, empty states, sidebar chrome, page titles, and toasts
- [ ] **BRND-02**: A committed logo mark exists (rounded node/brain hybrid SVG, anchored on the existing teal `color.primary`) and is used in the sidebar brand slot, login card, and favicon
- [ ] **BRND-03**: The brand decision and naming-collision mitigation posture are recorded — PROJECT.md Key Decisions entry + an in-repo brand guide (voice, do/don't, mark usage) — explicitly noting what was NOT done (no domain purchase, no trademark filing; user-gated)

### Token-System Extensions (TOKN)

- [ ] **TOKN-01**: `radius.pill` alias exists in `TOKEN_ALIASES` and all 6 style packs, and chips/tabs/pills (citation chips, follow-up chips, tab pills) consume it
- [ ] **TOKN-02**: `color.success` / `color.successForeground` exist in all packs (WCAG-AA verified via the existing per-pack contrast gate) pairing the existing destructive side
- [ ] **TOKN-03**: `typography.code.family` alias exists in all packs; `brutalist`'s display-family JetBrains Mono workaround is migrated onto it
- [ ] **TOKN-04**: Purpose-built tier-ladder tokens (e.g. `color.tier.inferred` / `color.tier.extracted`) exist and the knowledge tier badges consume them (no overloading of `color.accent`/`color.muted`)
- [ ] **TOKN-05**: A closed palette of graph node/edge-type tokens exists and the xyflow canvas consumes it for node-type differentiation (email/chat/knowledge/artifact) — zero raw hex (D-03/STYLE-03 holds)
- [ ] **TOKN-06**: A hover/active interactive-state convention is defined once (documented derivation rule) and applied consistently across re-skinned surfaces
- [ ] **TOKN-07**: The breakpoint-awareness question (density/layout behavior across breakpoints) is resolved as a recorded design decision with a minimal working mechanism that MOBL builds on — scoped as a design conversation, not a single alias

### Total UI Re-skin (RSKN)

- [ ] **RSKN-01**: `/chat` is re-skinned in the Cortex register on extended tokens — composer, message stream, tool-round activity rows, citation chips
- [ ] **RSKN-02**: The thread inbox (three-pane, thread groups) and email detail view are re-skinned on extended tokens
- [ ] **RSKN-03**: `/knowledge` canvas is re-skinned — tier badges on TOKN-04 tokens, node types on TOKN-05 palette
- [ ] **RSKN-04**: `/studio`, `/settings/*`, and `/login` are re-skinned in the Cortex register
- [ ] **RSKN-05**: The re-skin holds the token discipline: zero raw hex outside token sources, existing WCAG-AA contrast + token-family registration regression gates stay green and extend to the new aliases

### Mobile-Responsive Answer (MOBL)

- [ ] **MOBL-01**: On small screens, canvas surfaces (chat canvas, knowledge) collapse to a list/feed presentation (inline-first, market-validated pattern); desktop keeps the 2D canvas
- [ ] **MOBL-02**: Core flows (login → inbox → thread → email detail → chat) are usable on a mobile viewport — no horizontal overflow, ≥44px touch targets even on dense packs

### Editable Panels / Studio-on-Canvas (PANL — absorbs backlog 999.7)

- [ ] **PANL-01**: User can switch a genui panel's `style_pack_id` in place from per-panel controls; the choice persists across reloads
- [ ] **PANL-02**: User can tweak a panel's spec parameters in place through a bounded editing surface (schema-validated, same untrusted-input gate as FOUND-6)
- [ ] **PANL-03**: User can regenerate a panel variant in place, with provenance retained and prior version reachable
- [ ] **PANL-04**: A promptable design slice exists: a natural-language re-theme instruction on a panel resolves to pack/token choices (DSGN-03's cheap generation-side slice; no visual-compare repair loop)

### Visual Verification (VRFY)

- [ ] **VRFY-01**: `@playwright/test` (+ firefox) is installed; the parked code-island isolation spec runs green on chromium AND firefox, and the auth-redirect spec runs green (closes todo 2026-07-10-playwright-code-island-isolation-run)
- [ ] **VRFY-02**: A screenshot-driven visual review harness exists (Playwright screenshots of the re-skinned surfaces across packs/viewports) and is used to review the re-skin

## v2 Requirements

### Design Engine (deferred remainder of 999.4)

- **DSGN-02**: Rendered-visual-compare repair step (screenshot the render, judge, repair loop)
- **DSGN-04**: Screenshot/URL → design-token extraction

### Brand/Design

- **CNVP-01**: Canvas-first 7th style pack (Constellation register) — dossier follow-up #7, low priority under Cortex

## Out of Scope

| Feature | Reason |
|---------|--------|
| Domain purchase / trademark filing / dashboard changes | User-only external actions; brand work here is in-repo only |
| DSGN-02 visual-compare repair loop | Not "cheap" — VISION's absorption rule was "where cheap"; deferred to v2 |
| DSGN-04 screenshot→token extraction | Same — research-heavy, own milestone-sized effort |
| Native mobile apps | VISION E2: web-first, mobile-responsive only |
| Tailwind v4 / React 19 migration (999.12) | Orthogonal platform risk; keeping the re-skin on the stable stack |
| Marketing site | Brand applies in-app first; site is post-v1.8 / launch work |
| Renaming code/packages to "Cortex" | Cortex is a brand voice/visual register, NOT a code identity; polytoken code scope stays |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (filled by roadmap) | | |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️ (roadmap pending)

---
*Requirements defined: 2026-07-10*
*Last updated: 2026-07-10 after v1.8 milestone open*
