# Phase 49: Total UI Re-skin - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous — grey areas resolved with dossier/scout-grounded recommendations
auto-accepted under the user's standing "DO EVERYTHING" mandate (v1.8 precedent, Phases 47/48).
Every decision below is in-repo, reversible, and token-additive-only.

<domain>
## Phase Boundary

Every major product surface — /chat (composer, message stream, tool-round activity rows, citation
chips, canvas chrome), thread inbox (three-pane + email detail), /knowledge canvas, /studio,
/settings/forwarding, /login, plus global chrome (sidebar, toasts, layout) — speaks the polytoken
register on the EXTENDED token system (TOKN-01..07), with token discipline holding throughout
(zero raw hex AND zero classic Tailwind palette classes outside token sources/dev scratch).
This phase does NOT restructure layouts for mobile (Phase 50), does NOT add panel editing
(Phase 51), and does NOT add or rename tokens (Phase 48 closed; consume only).

</domain>

<decisions>
## Implementation Decisions

### D-49-01 (LOCKED): Re-skin = refinement pass, not redesign
The re-skin refines EXISTING layouts: extended-token adoption (radius.pill, color.success,
typography.code.family, tier/graph palettes where semantically correct), the D-48-06 hover/active
convention applied to interactive elements, spacing/typography consistency via pack tokens, and
polytoken-register copy stragglers (47-02 did the main sweep). No layout restructuring, no new
top-level components — Phase 50 owns responsive structure, Phase 51 owns panel editing. Dossier
per-surface mappings (flows a–d) are the taste reference; third-party "reverse-engineered" token
tables stay excluded (dossier caveat).

### D-49-02 (LOCKED): Pack-agnostic consumption; polytoken-teal stays default
All changes consume token aliases (Tailwind semantic utilities / hsl(var(--x)) idiom) so all 6
packs remain valid. No 7th canvas-first pack (CNVP-01 stays v2). No pack value edits unless a
WCAG-AA gate failure forces one (then: minimal value fix within the pack's register identity).

### D-49-03 (LOCKED): Palette-class conversion map
The ~50 hardcoded Tailwind palette-class occurrences (12 files, all in emails/[id] + entities
surfaces — scout 2026-07-10) convert as:
- Region/entity type-coding (violet/amber/slate in region-overlay-box.tsx [17×], entity-chips.tsx,
  entities-table.tsx, entities-mosaic.tsx, inspector-panel.tsx, role-picker.tsx, etc.) → the
  TOKN-05 closed graph palette (color.graph.entity/emailComponent/email = the SAME violet/amber/
  slate semantics, established 48-02). If a region/entity kind has no graph.* alias, use the
  nearest semantic alias — do NOT mint new aliases this phase; log a deferred item instead.
- Confirmed-good greens: already on color.success (48-03); convert any stragglers.
- bg-white/text-white and gray/zinc/slate neutrals → semantic equivalents (background/card/
  foreground/muted per context).
Also fix globals.css:242 `#000` mask literal only if trivially expressible via a var; otherwise
document as token-source-internal (it lives in the token source file, technically compliant).

### D-49-04 (LOCKED): /entities surfaces in the sweep, light-touch
RSKN-05's discipline criterion is global, so /entities pages (~12 violations) get the palette
conversion + register check, but NO redesign — they are not named by RSKN-01..04 and get no
structural attention.

### D-49-05 (LOCKED): Palette-class regression gate
Add a committed test (mirroring token-registration.test.ts's grep idiom) banning classic Tailwind
palette color classes (e.g. bg-zinc-*, text-gray-*, bg-violet-*, text-emerald-*, bg-white,
text-white...) in apps/web/src, excluding: token sources (globals.css, tailwind config),
src/app/dev/** (999.14 user-owned scratch + showcase), and an explicit inline-allowlist mechanism
for genuinely-justified cases. This makes RSKN-05 enforceable, not aspirational.

### D-49-06 (LOCKED): /knowledge scope + todo absorption
Tier badges and node/edge types already consume TOKN-04/05 (48-02..48-04). Phase 49's /knowledge
work: absorb pending todo 2026-07-07-knowledge-preexisting-ui-debt (resolves_phase: 49) — remove
`backdrop-blur-md` at graph-toolbar.tsx:42, filter-rail.tsx:96, node-detail-pane.tsx:373,
taxonomy-banner.tsx:46 (replace with solid bg-background/95-style per the v1.4 conversation-rail
precedent) and swap graph-toolbar.tsx:73's raw `⊞` glyph for a lucide icon (LayoutGrid) — plus
hover/active convention + register copy check. Move the todo to done when verified.
CONSTRAINT: edge-detail-popover.tsx content order (header/Relation/Tier/Confidence) is UI-SPEC
LOCKED — restyle only, never reorder.

### D-49-07 (LOCKED): Locked-renderer boundary holds
packages/genui/src/renderer/* (spec-renderer.tsx, render-node.tsx, genui-part-boundary.tsx) stay
byte-identical; generation artifacts (spec.schema.json / genui-prompt.json) must not drift
(artifacts.test.ts gate). All token consumption changes land in apps/web consumer components.

### D-49-08 (LOCKED): Global chrome in scope; glassmorphism ban enforced
app-sidebar.tsx, Toaster (sonner), root layout: apply register + hover/active convention. The
sidebar's frosted treatment: if it uses backdrop-blur, convert to solid bg-background/95 per
docs/design/product-register-and-bans.md item 3 (same precedent as D-49-06). Icons stay
lucide-react-only across all touched surfaces.

### D-49-09 (LOCKED): /settings = what exists
Re-skin /settings/forwarding only. Do NOT create a settings hub/index page (deferred idea).
RSKN-04 is satisfied by re-skinning the surfaces that exist today.

### D-49-10 (LOCKED): Verification
- WCAG-AA contrast gate (token-contrast.test.ts) + token-family registration gate
  (token-registration.test.ts) stay green throughout.
- New D-49-05 palette-ban gate lands green.
- Screenshot harness (screenshot:review, 47-05) captures before/after per re-skinned surface;
  auth-gated surfaces (no live OAuth session — user-gated) fall back to the textual before/after
  artifact under .planning/ui-reviews/ (48-03 precedent, D-48-08).
- UI-SPEC generated before planning; gsd-ui-review audit after execution (advisory).
- Definition of done per surface: gates green + hover/active convention applied to its interactive
  elements + register copy holds + evidence captured.

### Claude's Discretion
- Exact class-by-class conversion choices within the D-49-03 map; which neutral maps to
  background vs card vs muted per context.
- Hover/active application order and any per-surface exceptions consistent with the documented
  pinned-state exception (docs/design/hover-active-convention.md).
- Palette-ban test implementation shape (regex list, file walk, allowlist mechanism).
- Small component extractions where a conversion would otherwise duplicate classes 3+ times.
- Whether the chat canvas ReactFlow chrome needs any extended-token refinement beyond what
  48-03/48-04 landed (minimap/background/edge labels already hsl(var()) — touch only if drifting).

</decisions>

<code_context>
## Existing Code Insights

Scouted 2026-07-10 (Explore agent, full report in session):
- Surfaces: /chat ~60 files (app/chat/_components + _canvas), inbox 5 (app/_components/
  inbox-three-pane.tsx etc.), email detail ~35 (app/emails/[id]/_components), /knowledge ~18,
  /studio ~11, /settings 1 (forwarding), /login 2. Global chrome: app/layout.tsx,
  components/app-sidebar.tsx, globals.css, tailwind.config.ts.
- Token-discipline state: raw hex in production surfaces = 0 (only globals.css mask + /dev
  demos). rgb()/hsl() literals = 0 violations (all hsl(var(--x))). Real work = ~50 classic
  Tailwind palette classes in 12 files, ALL in emails/[id] + entities surfaces; top offender
  region-overlay-box.tsx (17). chat/knowledge/studio/login are already clean.
- Exemplars to imitate: tier-edge-style.ts, tier-filter-control.tsx, inbox-three-pane.tsx,
  save-status-indicator.tsx, catalog-browser-island.tsx.
- Gates: apps/web/src/app/__tests__/token-contrast.test.ts + token-registration.test.ts;
  packages/genui/src/theme/__tests__/{token-allowlist,packs}.test.ts.
- Screenshot harness: apps/web/e2e/screenshot-review.spec.ts + playwright.screenshot.config.ts —
  6 surfaces × mobile 390/desktop 1440 → .planning/ui-reviews/{timestamp}/ (gitignored).
- Constraints found: edge-detail-popover.tsx:7 UI-SPEC LOCKED order; TOKEN_ALIASES/packs
  Object.freeze (canonical source — Phase 48 closed, consume only); spec-renderer drift gates.
- Design docs authoritative for this phase: docs/design/brand-guide.md (voice/mark),
  product-register-and-bans.md (bans incl. glassmorphism item 3), hover-active-convention.md
  (D-48-06 recipe + pinned-state exception), breakpoint-decision.md (D-48-07 — Phase 50's
  contract; Phase 49 must not preempt it).

</code_context>

<specifics>
## Specific Ideas

- The TOKN-05 graph palette (violet/amber/slate) was deliberately designed with the SAME
  semantics as the email-detail region coding — the D-49-03 conversion is the palette landing on
  its intended remaining consumers, not a reinterpretation.
- Dossier usage rule worth encoding in the plan: color.destructive is reserved for irreversible/
  delete actions; stop/cancel controls use muted (never destructive); success never relabels
  stop/deny (48-03 held this — keep holding it).
- linear-clean is the dossier's "closest to Claude/ChatGPT chat chrome" reference — useful taste
  anchor when judging chat surface refinements, while polytoken-teal remains the default.

</specifics>

<deferred>
## Deferred Ideas

- Settings hub/index page (only forwarding exists today) — future milestone when more settings land.
- Motion/animation timing tokens (dossier flow a gap) — backlog candidate, not TOKN scope.
- CNVP-01 canvas-first 7th style pack — v2 (REQUIREMENTS.md).
- New graph.* aliases for any region/entity kind not covered by the closed palette — log during
  execution if hit; minting aliases is out of scope this phase.
- 999.14 dev/design scratch rename — stays user-owned, exempt from the palette gate.

</deferred>

---

*Phase: 49-total-ui-re-skin*
*Context gathered: 2026-07-10 via autonomous smart discuss*
