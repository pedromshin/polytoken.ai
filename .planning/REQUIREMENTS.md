# Requirements: polytoken — v1.8 Polytoken Re-skin

**Defined:** 2026-07-10
**Core Value:** Reliably receive every inbound email and make it observable — now wrapped in a product that looks and feels like the personal AI workspace VISION describes.

Sources: `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` (DSSR-01; naming USER-LOCKED to polytoken 2026-07-10, alternates purged),
`.planning/research/v1.8-design/DESIGN-PATTERN-DOSSIER.md` (DSSR-02, 8-item token punch list),
VISION.md E2 remainder, backlog 999.7 (editable panels) + 999.4 cheap slice (promptable design).

## v1 Requirements

### Brand Application (BRND)

- [x] **BRND-01**: All user-facing copy speaks the polytoken brand register (warm, companion, first-person — "Your workspace", not systems vocabulary; the product always names itself polytoken) across login, empty states, sidebar chrome, page titles, and toasts (login/sidebar slice done in 47-01; empty states/page titles/toasts remain — 47-02)
- [x] **BRND-02**: A committed logo mark exists (rounded node/brain hybrid SVG, anchored on the existing teal `color.primary`) and is used in the sidebar brand slot, login card, and favicon
- [x] **BRND-03**: The brand decision is recorded — PROJECT.md Key Decisions entry + an in-repo brand guide (voice, do/don't, mark usage) — capturing the USER-LOCKED naming (polytoken / polytoken.ai, alternates purged, CLI-tool collision explicitly accepted by the user) and what remains user-gated (domain purchase, trademark filing)

### Token-System Extensions (TOKN)

- [x] **TOKN-01**: `radius.pill` alias exists in `TOKEN_ALIASES` and all 6 style packs, and the existing chip surfaces consume it (citation chip `ProvenanceLink` + chat-canvas edge label; no follow-up-chip or pill-shaped-tab component exists in the app — studio tabs are underline-by-design, deliberately excluded per D-48-01 discretion; pill-tab treatment, if wanted, belongs to Phase 49's studio re-skin) *(wording amended 2026-07-10 per 48-VERIFICATION override)*
- [x] **TOKN-02**: `color.success` / `color.successForeground` exist in all packs (WCAG-AA verified via the existing per-pack contrast gate) pairing the existing destructive side
- [x] **TOKN-03**: `typography.code.family` alias exists in all packs; `brutalist`'s display-family JetBrains Mono workaround is migrated onto it
- [x] **TOKN-04**: Purpose-built tier-ladder tokens (e.g. `color.tier.inferred` / `color.tier.extracted`) exist and the knowledge tier badges consume them (no overloading of `color.accent`/`color.muted`)
- [x] **TOKN-05**: A closed palette of graph node/edge-type tokens exists and the `/knowledge` xyflow canvas consumes it for node-type differentiation (entity / email-component / email — the canvas's actual categories; the `/chat` canvas's node types were already token-driven) — zero raw hex (D-03/STYLE-03 holds) *(wording amended 2026-07-10: original "(email/chat/knowledge/artifact)" was the design dossier's generic illustration, never this codebase's node set)*
- [x] **TOKN-06**: A hover/active interactive-state convention is defined once (documented derivation rule) and applied consistently across re-skinned surfaces
- [x] **TOKN-07**: The breakpoint-awareness question (density/layout behavior across breakpoints) is resolved as a recorded design decision with a minimal working mechanism that MOBL builds on — scoped as a design conversation, not a single alias

### Total UI Re-skin (RSKN)

- [ ] **RSKN-01**: `/chat` is re-skinned in the polytoken register on extended tokens — composer, message stream, tool-round activity rows, citation chips
- [ ] **RSKN-02**: The thread inbox (three-pane, thread groups) and email detail view are re-skinned on extended tokens
- [ ] **RSKN-03**: `/knowledge` canvas is re-skinned — tier badges on TOKN-04 tokens, node types on TOKN-05 palette
- [ ] **RSKN-04**: `/studio`, `/settings/*`, and `/login` are re-skinned in the polytoken register
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

- [x] **VRFY-01**: `@playwright/test` (+ firefox) is installed; the parked code-island isolation spec runs green on chromium AND firefox, and the auth-redirect spec runs green (closes todo 2026-07-10-playwright-code-island-isolation-run)
- [x] **VRFY-02**: A screenshot-driven visual review harness exists (Playwright screenshots of the re-skinned surfaces across packs/viewports) and is used to review the re-skin

## v2 Requirements

### Design Engine (deferred remainder of 999.4)

- **DSGN-02**: Rendered-visual-compare repair step (screenshot the render, judge, repair loop)
- **DSGN-04**: Screenshot/URL → design-token extraction

### Brand/Design

- **CNVP-01**: Canvas-first 7th style pack (spatial register) — dossier follow-up #7, low priority

## Out of Scope

| Feature | Reason |
|---------|--------|
| Domain purchase / trademark filing / dashboard changes | User-only external actions; brand work here is in-repo only |
| DSGN-02 visual-compare repair loop | Not "cheap" — VISION's absorption rule was "where cheap"; deferred to v2 |
| DSGN-04 screenshot→token extraction | Same — research-heavy, own milestone-sized effort |
| Native mobile apps | VISION E2: web-first, mobile-responsive only |
| Tailwind v4 / React 19 migration (999.12) | Orthogonal platform risk; keeping the re-skin on the stable stack |
| Marketing site | Brand applies in-app first; site is post-v1.8 / launch work |
| Any product/brand name other than polytoken | USER-LOCKED 2026-07-10: "everything will be called polytoken and domain polytoken.ai. everything else is purged" |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRND-01 | Phase 47 | Complete |
| BRND-02 | Phase 47 | Complete |
| BRND-03 | Phase 47 | Complete |
| VRFY-01 | Phase 47 | Complete |
| VRFY-02 | Phase 47 | Complete |
| TOKN-01 | Phase 48 | Complete |
| TOKN-02 | Phase 48 | Complete |
| TOKN-03 | Phase 48 | Complete |
| TOKN-04 | Phase 48 | Complete |
| TOKN-05 | Phase 48 | Complete |
| TOKN-06 | Phase 48 | Complete |
| TOKN-07 | Phase 48 | Complete |
| RSKN-01 | Phase 49 | Pending |
| RSKN-02 | Phase 49 | Pending |
| RSKN-03 | Phase 49 | Pending |
| RSKN-04 | Phase 49 | Pending |
| RSKN-05 | Phase 49 | Pending |
| MOBL-01 | Phase 50 | Pending |
| MOBL-02 | Phase 50 | Pending |
| PANL-01 | Phase 51 | Pending |
| PANL-02 | Phase 51 | Pending |
| PANL-03 | Phase 51 | Pending |
| PANL-04 | Phase 51 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-10*
*Last updated: 2026-07-10 after v1.8 roadmap created (5 phases, 47–51, 23/23 requirements mapped)*
