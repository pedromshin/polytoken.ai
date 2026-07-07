# Phase 28: Design-System Token Upgrades - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommended answers auto-accepted per yolo config; each marked [auto])

<domain>
## Phase Boundary

The foundational token layer (`apps/web/src/app/globals.css` + `packages/tailwind-config/base.ts` +
`packages/ui/src/card.tsx`) stops papering over gaps: `secondary`/`muted`/`accent` become tonally
distinct (TOKEN-01), `chart-1..5` + `sidebar-*` rebase off the teal primary (TOKEN-02), a real
shadow/elevation scale lands (TOKEN-03), `xl`/`2xl` radius steps exist and card.tsx consumes the
token (TOKEN-04), and `tailwindcss-animate` powers entrance/stagger beyond Radix defaults
(TOKEN-05). THIS is the one phase allowed to change token VALUES — the Phase 26/27 "token count
stays 55" gate retires here by design.

**Locked source of truth:** `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` → "Design system"
audit + Phase C plan + the styles.refero.design verdict (cite its numeric backing: two-value radius
allowlist, stacked hairline shadow recipe, ±0.05em letter-spacing bounds).

**Hard constraints:** teal `primary` `hsl(164 39% 22%)` unchanged — it IS the brand anchor, never
a second brand hue; 2-weight typography; 4-role type scale; 4-point grid; 60/30/10 discipline
(changes stay neutral-reading — this is differentiation, not colorization);
`spec-renderer.tsx`/`GenuiPartBoundary`/`InteractiveWidgetBoundary` untouched; zero new npm deps;
Tailwind v3.4.4. Every changed token must keep WCAG-AA contrast for its `*-foreground` pair in BOTH
light and dark mode (the repo has WCAG tooling precedent in Phase 17's style_metrics).

**Drift check (2026-07-06, HEAD):** `--secondary`/`--muted`/`--accent` all literally `0 0% 96.1%`
(light); `--chart-1..5` = stock shadcn demo (12 76% 61% etc.); `--sidebar-ring: 217.2 91.2% 59.8%`
(blue!); single `--radius: 0.5rem`; NO boxShadow config anywhere in `packages/tailwind-config/base.ts`;
`packages/ui/src/card.tsx:12` hardcodes `rounded-xl`.

</domain>

<decisions>
## Implementation Decisions

### TOKEN-01 — secondary/muted/accent differentiation
- [auto] Stay in one neutral family, differentiate by LIGHTNESS + a whisper of the teal hue
  (hue 164, saturation ≤ 8%) so neutrals read cohesive with the brand without becoming a second
  hue: `muted` = the recessive fill (roughly current value), `secondary` = a step darker/more
  present (real fills like table header bands), `accent` = the interactive-hover tint (slightly
  teal-leaning). Exact HSL values at planner/executor discretion within these roles; both modes;
  every `*-foreground` pair stays WCAG-AA (assert with a small script/test, not by eye).
- [auto] Blast-radius control: after changing values, screenshot-compare the main surfaces if the
  dev server is up; the change must read as "the same app, slightly more defined", not a retheme.

### TOKEN-02 — chart + sidebar rebase
- [auto] `chart-1..5`: teal-anchored categorical ramp — chart-1 = primary; chart-2..5 = analogous/
  desaturated companions (e.g. hue 164 ± spread, varied lightness) that stay mutually
  distinguishable in both modes (this is data-viz differentiation, not decoration — small
  saturation is fine here; the 60/30/10 accent-allowlist governs UI chrome, not chart series).
- [auto] `sidebar-*`: map onto EXISTING tokens (background/foreground/primary/border) rather than
  invent new values — kill the accidental blue `--sidebar-ring` by pointing it at the teal ring.
  No surface currently consumes sidebar-* heavily; correctness over novelty.

### TOKEN-03 — shadow/elevation scale
- [auto] Add `--elevation-1/2/3` CSS vars in globals.css + `boxShadow: { elevation-1/2/3 }` in
  `packages/tailwind-config/base.ts` (theme.extend). Recipe: stacked hairline (refero's numeric
  backing — a 0-1px hairline + a soft ambient layer), ambient tinted with the teal hue at very low
  alpha instead of pure black. Dark mode: reduce shadow reliance (raise via border/surface instead)
  — define dark values explicitly, don't let light-mode shadows leak.
- [auto] Adopt into the OBVIOUS existing consumers only (card `shadow` → elevation-1; composer
  dock's top shadow; canvas node shells if trivially clean) — no app-wide shadow sweep this phase.

### TOKEN-04 — radius steps + card
- [auto] Add `--radius-xl`/`--radius-2xl` derived from `--radius` (e.g. calc(var(--radius) + 4px) /
  +8px → 12px/16px at the current 8px base) and register `xl`/`2xl` borderRadius entries in the
  Tailwind preset mapping to the vars. `packages/ui/src/card.tsx` swaps its hardcoded `rounded-xl`
  for the token-driven `rounded-xl` — VISUALLY IDENTICAL (12px stays 12px), but now token-driven.
- [auto] Keep refero's "two-value radius allowlist" spirit documented in the bans doc: interactive
  controls use the base radius family, containers use xl/2xl — note it, don't police old code.

### TOKEN-05 — entrance/stagger animation
- [auto] Use the already-wired `tailwindcss-animate` utilities (animate-in fade-in slide-in-*,
  motion-safe:-gated where the variant applies to plugin utilities; otherwise the hand-CSS gating
  pattern from Phase 27) on: (a) genui panel mount on the canvas — applied at the CANVAS NODE
  wrapper (GenuiPanelNode body), NEVER inside GenuiPartBoundary/SpecRenderer; (b) Studio history
  list items + page-ideas list items with a small stagger (CSS animation-delay by index, capped
  ~6 items). Durations from the Phase 27 `.t-*`/UI-SPEC scale; respect prefers-reduced-motion.
- [auto] Do NOT stack with the Phase 27 GeneratingRing or `.t-*` consumers (one animation per
  reveal — the a08cb6c precedent).

### Folded debt — conversation-rail backdrop-blur (from 27-UI-REVIEW / bans doc exception)
- [auto] Resolve the documented exception during this phase's material pass: replace the rail's
  `backdrop-blur-md` with a solid token surface (`bg-background/95` or full `bg-background` +
  border) and verify legibility over canvas content. If legibility clearly suffers (screenshot
  check), keep blur and UPGRADE the bans-doc exception to a permanent allowlisted entry with
  rationale. Either outcome closes the debt item.

### Claude's Discretion
- Exact HSL values (within the roles above), exact shadow layer numbers, stagger delay values,
  and whether sidebar tokens alias vars (`var(--background)`) or copy values — planner/executor
  choice with WCAG assertions as the gate.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 17 WCAG-AA contrast machinery precedent (`style_metrics.py` — Python side; for this phase a
  tiny TS/vitest contrast assertion over the parsed globals.css pairs is enough).
- Phase 27's reduced-motion CSS gating pattern + `.t-*` timing scale; Phase 26's additive @layer
  precedent.
- `tailwindcss-animate` installed + wired in `packages/tailwind-config`.

### Established Patterns
- Tokens: HSL triplets in `:root`/`.dark` consumed as `hsl(var(--x))`; Tailwind preset in
  `packages/tailwind-config/base.ts` (theme.extend).
- Shared-component + colocated-test convention; npm-workspaces commands; typecheck + targeted
  vitest per change.

### Integration Points
- `apps/web/src/app/globals.css` (:root/.dark blocks — VALUE changes now allowed)
- `packages/tailwind-config/base.ts` (boxShadow, borderRadius extensions)
- `packages/ui/src/card.tsx` (rounded-xl token consumption)
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` (mount animation wrapper)
- `apps/web/src/app/studio/_components/history-island.tsx`, `page-ideas-island.tsx` (list stagger)
- `apps/web/src/app/chat/_components/conversation-rail.tsx` (blur debt resolution)
- `docs/design/product-register-and-bans.md` (radius allowlist note + blur exception closure)

</code_context>

<specifics>
## Specific Ideas

- Research doc: Phase C items each "lift every surface at once" — the win is systemic, so keep
  individual choices conservative; the app must not read as rethemed.
- Cite styles.refero.design's numeric backing in the shadow/radius commits (the research doc
  explicitly defers that citation to this phase).

</specifics>

<deferred>
## Deferred Ideas

- Custom typeface — out of scope (locked).
- App-wide shadow adoption sweep beyond the obvious consumers — later polish.
- impeccable `checks.mjs` vendoring — still deferred (repair-loop work).

</deferred>
