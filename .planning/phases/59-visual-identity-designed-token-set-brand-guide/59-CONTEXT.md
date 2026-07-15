# Phase 59: Visual Identity — Designed Token Set & Brand Guide — Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated — the spec already exists as a locked decision record

<domain>
## Phase Boundary

Realize D-58-01 (the user-picked visual identity, LOCKED 2026-07-15) as the app's real design
system: the oklch token set in `apps/web/src/app/globals.css` + the brand guide's visual-identity
section (which has never existed — the guide defines only voice/tone today).

IN scope: globals.css token values (both themes), the type scale, the spacing/density system, the
signature element as reusable tokens/utilities, `docs/design/brand-guide.md`'s new visual-identity
section, and keeping the WCAG-AA + token-registration gates green against the new values.

OUT of scope: per-surface redesign (Phases 60-62), research-canvas visual surfaces (Phase 63).
This phase makes the SYSTEM; the surfaces consume it next.
</domain>

<decisions>
## Implementation Decisions

**There are no grey areas to discuss — the design decisions were made by the user and locked.**

THE CONTRACT: `.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md` (D-58-01).
Read it as authoritative. It carries the verbatim user pick, the three laws, the signature element,
the complete 12-token oklch ladder for BOTH themes with literal values, and measured contrast.

REFERENCE RENDER: `.planning/phases/58-visual-identity-sketch-pick-human-gate/sketches/direction-final.html`
— a working implementation of the identity, already shaped as `:root { --token }` +
`:root[data-theme="dark"]` overrides to mirror globals.css. It ports without restructuring.
It is a SKETCH, not the source of truth. 58-IDENTITY.md is the contract.

Claude's discretion applies ONLY to mechanics: how tokens map onto the existing shadcn semantic
names, how the type scale and density system are expressed as Tailwind v4 `@theme` entries, and
how the provenance mark becomes a reusable utility. Never to the identity itself.
</decisions>

<code_context>
## Existing Code Insights

- Phase 55 migrated the stack to Tailwind v4 (`@theme inline` + native `@theme`, oklch, CSS-first
  config) + React 19. globals.css is already oklch-shaped — this phase replaces the VALUES (still
  stock-shadcn-derived) with the designed ones.
- `grep -c "hsl(var(--" apps/web/src/app/globals.css` must stay 0 (Phase 55's hard gate).
- Two committed gates must stay green and are load-bearing:
  `apps/web/src/app/__tests__/token-contrast.test.ts` (oklch-aware WCAG-AA; parses `readTokenBlock`)
  `apps/web/src/app/__tests__/token-registration.test.ts` (string-parses the @theme blocks)
  Both were rewritten in 55-03 and PROVEN able to fail. They will need their expected token
  families/pairs updated for the new ladder — update them to gate the NEW system, never weaken them.
- `packages/genui/src/theme/packs.ts` is the genui WCAG surface and stayed HSL through Phase 55 by
  decision — do NOT touch it in this phase (out of scope; the app token layer is what's designed here).
- `.claude/skills/polytoken-design-system/SKILL.md` documents the token source + conventions and was
  updated in 55-06 — it must reflect the new designed system after this phase.
- The 16-surface screenshot harness (`npm run screenshot:review`) is the regression rail for the
  surface phases that follow.
</code_context>

<specifics>
## Specific Ideas

The three laws from D-58-01 must be structurally enforceable where possible, not just documented:
1. Colour is earned — chrome is monochrome. Only `--conf` / `--sugg` / `--bad` carry hue. Consider
   extending the committed palette-ban gate to catch a hue reaching chrome.
2. Chrome speaks sans, evidence speaks serif — the serif is a real token role, not an ad-hoc class.
3. Entity type is shape, never hue — the shape vocabulary needs a home (tokens/utilities).

WCAG: light tier-on-wash has only ~0.09 headroom (4.59 vs the 4.5 floor). Any lightness drift
breaks the gate. Two of Direction A's original values already failed AA and are corrected in the
locked ladder (`--sugg` 54.7%→50.5%, `--pencil` 62.9%→51.0%) — the locked values are canonical.
</specifics>

<deferred>
## Deferred Ideas

- Per-surface redesign — Phases 60-62.
- Research-canvas visual surfaces — Phase 63.
- Revisiting D-58-03 (entity-type-as-shape), the one item inferred rather than user-instructed.
  Cheap here, expensive after Phase 62 — surface it if the port makes the cost concrete.
</deferred>
