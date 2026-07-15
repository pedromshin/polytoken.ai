---
phase: 55-platform-migration-tailwind-v4-react-19
plan: 02
subsystem: frontend-design-tokens
tags: [tailwindcss-v4, oklch, css-theme, css-source, design-tokens, genui-theme]

# Dependency graph
requires: ["55-01"]
provides:
  - "apps/web/src/app/globals.css on the canonical shadcn v4 shape: full oklch(...) color tokens + @theme inline + native @theme (radius/shadow/font/animation) + @source registration for packages/ui and packages/genui + zero internal hsl(var(--x))"
  - "every external hsl(var(--x)) call site (11 in-scope apps/web + packages/ui files) converted to bare var(--x)/color-mix(); packages/genui's ThemedRoot and apps/web's PanelThemeScope both wrap only color-group vars in hsl(...) at injection time so pack overrides stay valid colors"
  - "the @config JS-theme bridge removed; packages/tailwind-config/{base,web}.ts + both tailwind.config.ts files neutralized to minimal stubs (CSS is now the single source of truth)"
affects: ["55-03-gate-rewrites", "55-04-react-19-bump", "55-05-radix-decision-plus-registry-proof", "55-06-dev-design-scratch-cleanup"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "shadcn v4 canonical globals.css shape: @source x2 -> @theme inline (color family mapping) -> native @theme (radius/shadow/font/keyframe-animation registration) -> :root/.dark oklch(...) token blocks -> @layer base/components/utilities"
    - "Radius theme keys (--radius-sm/md/lg/xl/2xl/pill) inside @theme RECOMPUTE the same calc()/literal formula already declared on the identically-named :root property rather than var()-referencing it — avoids a self-referential (circular) custom property, which the CSS spec treats as invalid at computed-value time"
    - "--font-code inside @theme repeats :root's literal font stack rather than var(--font-code) (same anti-circularity reasoning) — the PANL-04/genui per-panel override path still works because an inline style on a DOM descendant always outranks any :root-level rule for that property, independent of which stylesheet declaration wins at :root scope"
    - "tailwindcss-animate's v3 JS plugin (addUtilities/matchUtilities) has no confirmed v4 @plugin compatibility path — ported its exact closed usage surface (animate-in/out, fade-in(-0)/fade-out-0, zoom-in/out-95, 7 slide-in-from-*/slide-out-to-* variants) natively as @keyframes + @utility rules, scoped to only the classes this repo actually uses (verified via grep), not the plugin's full dynamic-value API"
    - "color-mix(in srgb, var(--x) N%, transparent) is the v4-native replacement for hsl(var(--x) / N) opacity-modified tokens, used identically in globals.css's own internal consumers and every external call site"
    - "ThemedRoot (packages/genui) and PanelThemeScope (apps/web, app-owned sibling) both derive an immutable color-var-name Set from TOKEN_ALIAS_TO_CSS_VAR (aliases starting with 'color.') and wrap ONLY those vars in hsl(...) before injecting pack.resolvedVars/tokenOverrides as inline style — packs.ts itself stays bare-HSL by design (Pitfall 1)"

key-files:
  created:
    - .planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md
  modified:
    - apps/web/src/app/globals.css
    - apps/web/tailwind.config.ts
    - packages/tailwind-config/base.ts
    - packages/tailwind-config/web.ts
    - packages/ui/tailwind.config.ts
    - apps/web/src/app/chat/_canvas/chat-canvas.tsx
    - apps/web/src/app/chat/_canvas/panel-theme-scope.tsx
    - apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx
    - apps/web/src/app/chat/_canvas/__tests__/panel-theme-scope.test.tsx
    - apps/web/src/app/chat/_canvas/__tests__/retheme-apply-integration.test.tsx
    - apps/web/src/app/knowledge/_components/graph-legend.tsx
    - apps/web/src/app/knowledge/_components/graph-nodes.tsx
    - apps/web/src/app/knowledge/_components/tier-edge-style.ts
    - apps/web/src/app/knowledge/_components/tier-edge-style.test.ts
    - packages/ui/src/sidebar.tsx
    - packages/ui/src/spreadsheet-grid/theme.css
    - packages/ui/src/spreadsheet-grid/SpreadsheetGrid.tsx
    - packages/ui/src/spreadsheet-grid/conditional-formatting-dialog.tsx
    - packages/genui/src/theme/themed-wrapper.tsx
    - packages/genui/src/theme/tokens.ts
    - packages/genui/src/theme/__tests__/themed-wrapper.test.tsx

key-decisions:
  - "@source relative path verified as exactly '../../../../packages/ui/src' and '../../../../packages/genui/src' (FOUR '../' — apps/web/src/app is 4 levels below repo root) — confirmed via the compiled-CSS proof, not assumed from RESEARCH's own flagged-unverified 3-level example (Assumption A2, now resolved)"
  - "oklch values precomputed once via a throwaway Node script (Björn Ottosson's OKLab forward/inverse matrices, standard WCAG relative-luminance math) rather than adding a culori runtime dependency — Open Question 2's recommended path, adopted as-is"
  - "container utility ported via @utility container with a literal 1400px breakpoint (not tied to the --breakpoint-2xl theme var, which drives the unrelated app-wide 2xl: variant at Tailwind's default 1536px) — the v3 config's container.screens override was always container-scoped only. Coexists with Tailwind's own default responsive .container scale in the compiled CSS rather than cleanly replacing it; zero live impact since no component in this repo actually renders className=\"container\" (verified via repo-wide grep pre-implementation) — documented as a known, non-gated cosmetic gap, not fixed further"
  - "[Rule 1 - bug] apps/web/src/app/chat/_canvas/panel-theme-scope.tsx (PanelThemeScope) was not in the plan's 'comment only' fix list but shares ThemedRoot's exact unwrapped-injection contract — fixed identically (same TOKEN_ALIAS_TO_CSS_VAR-derived color-var Set, same conditional hsl() wrap) since leaving it broken would silently strip color from every Tailwind utility rendered inside a re-themed canvas panel (PANL-01/04)"
  - "duration-150/200/300/500 (used alongside the ported animate-in/animate-out utilities) are left as Tailwind's own built-in transition-duration utilities — the ported animate-in/out always fall back to this file's 150ms default for animation-duration since replicating tailwindcss-animate's own --tw-duration override behavior for duration-* was judged out of scope (cosmetic timing only, not a visibility/color regression, not covered by any gate)"

patterns-established:
  - "Pattern: when a native @theme key must share a name with an already-declared :root custom property (radius scale, font-code), recompute the identical literal/calc() formula inside @theme rather than var()-referencing the same name — a harmless duplicate declaration, never a circular one"
  - "Pattern: any component that injects globals.css-token-shaped CSS custom properties from an HSL-holding source (packs.ts) must wrap ONLY the color-named subset (derived from TOKEN_ALIAS_TO_CSS_VAR) in hsl(...) — apply this check to every future ThemedRoot-shaped consumer, not just the one named in a plan"

requirements-completed: []  # STCK-01 spans 55-01..55-03 (engine swap, then oklch token port, then gate rewrites) — not marked complete until 55-03 lands per the established multi-plan-per-requirement precedent (54-01/MOBL-01).

# Metrics
duration: ~2h10min
completed: 2026-07-15
---

# Phase 55 Plan 02: oklch Token Port + @source Registration + Call-Site Conversion Summary

**globals.css ported to the canonical shadcn v4 shape (full oklch(...) color functions + @theme inline + @source for both sibling packages + native @theme radius/shadow/font/animation registration), every one of the 86 hsl(var(--x)) call sites across globals.css's own internals, 11 external component/test files, and both genui/app re-theme wrapper components converted to the new var(--x)-bare / color-mix() contract — proven by real production-build compiled-CSS assertions and a live E2E computed-style guard, not just a green build.**

## Performance

- **Duration:** ~2h10min
- **Tasks:** 2 (both `type="auto"`)
- **Files touched:** 21 committed across 2 commits (5 in Task 1 + 1 new deferred-items.md; 16 in Task 2) + 1 new deferred-items.md file

## Accomplishments

- `apps/web/src/app/globals.css`: every `:root`/`.dark` color token converted from bare HSL triplet to a precomputed, WCAG-AA-verified `oklch(...)` color function; `@theme inline` block registers all 40 color-family entries (background/foreground/card/popover/primary/secondary/muted/accent/destructive/success/border/input/ring/chart-1..5/tier-*/graph-*/sidebar family); native `@theme` block ports borderRadius/boxShadow/fontFamily; the 9 magicui `@keyframes`/`--animate-*` pairs and the Radix `animate-in`/`animate-out`/`fade`/`zoom`/`slide` closed utility set ported natively as `@keyframes` + `@utility` rules (tailwindcss-animate has no confirmed v4 compatibility path); globals.css's own 4 internal `hsl(var(--x))` consumer clusters (React Flow Controls fill, `.scrollbar-token`, `.generating-ring` gradient, modal/dropdown box-shadow keyframes) converted in the same pass.
- `@source "../../../../packages/ui/src";` and `@source "../../../../packages/genui/src";` added and proven against a REAL production build (`npm run web:build` + grepping `apps/web/.next/static/css/*.css`) — not just dev-mode, which can mask a missing `@source` path.
- `@config` bridge removed; `apps/web/tailwind.config.ts`, `packages/tailwind-config/{base,web}.ts`, `packages/ui/tailwind.config.ts` gutted to minimal stubs.
- All 11 in-scope external call-site files (apps/web + packages/ui) converted from `hsl(var(--x))`/`hsl(var(--x) / a)` to bare `var(--x)`/`color-mix(in srgb, var(--x) N%, transparent)`.
- `packages/genui/src/theme/themed-wrapper.tsx` (ThemedRoot) and `apps/web/src/app/chat/_canvas/panel-theme-scope.tsx` (PanelThemeScope, app-owned sibling — Rule 1 fix, see Deviations) both now wrap only color-group `resolvedVars`/`tokenOverrides` entries in `hsl(...)` before injection, keeping `packages/genui/src/theme/packs.ts` untouched (still bare HSL, `git diff --stat` empty) per Pitfall 1.

## Task Commits

1. **Task 1: Port globals.css to oklch + @theme inline + @source + native @theme; convert internal consumers; remove the @config bridge** - `10e182b` (feat)
2. **Task 2: Drop the hsl() wrapper at every EXTERNAL call site + adapt the genui re-theme surface** - `3da2947` (feat)

## Files Created/Modified

- `apps/web/src/app/globals.css` — full oklch port, `@theme inline`/native `@theme`/`@source`/`@utility` blocks, internal call-site conversions, `@config` removed (511 lines changed)
- `apps/web/tailwind.config.ts`, `packages/tailwind-config/base.ts`, `packages/tailwind-config/web.ts`, `packages/ui/tailwind.config.ts` — gutted to minimal stubs, no longer the source of truth
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx` — React Flow `Background`/`MiniMap` inline color props converted
- `apps/web/src/app/chat/_canvas/panel-theme-scope.tsx` — comment reworded + Rule 1 runtime fix (color-var hsl() wrapping)
- `apps/web/src/app/chat/_canvas/knowledge-preview-mini-graph.tsx`, `apps/web/src/app/knowledge/_components/graph-legend.tsx`, `graph-nodes.tsx`, `tier-edge-style.ts(+.test.ts)` — SVG stroke / arbitrary-value shadow / stroke-map call sites converted
- `packages/ui/src/sidebar.tsx`, `spreadsheet-grid/theme.css`, `spreadsheet-grid/SpreadsheetGrid.tsx`, `spreadsheet-grid/conditional-formatting-dialog.tsx` — every ag-grid theme var + arbitrary-value shadow converted
- `packages/genui/src/theme/themed-wrapper.tsx(+tokens.ts+__tests__/themed-wrapper.test.tsx)` — ThemedRoot color-var hsl() wrapping + doc rewording + T-17-02 test updated to unwrap before comparison
- `apps/web/src/app/chat/_canvas/__tests__/panel-theme-scope.test.tsx`, `retheme-apply-integration.test.tsx` — updated to expect the hsl()-wrapped form
- `.planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md` (new) — 2 pre-existing, out-of-scope issues isolated via bisection (see Deviations)

## Verified `@source` Relative Path

**`../../../../packages/ui/src`** and **`../../../../packages/genui/src`** — FOUR `../` levels (`apps/web/src/app` → `src` → `web` → `apps` → repo root), confirmed correct via the compiled-CSS proof below (RESEARCH's Assumption A2 flagged 3 levels as unverified; the actual answer is 4).

**Compiled-CSS proof (real `npm run web:build`, not dev mode):**
- packages/ui-only class `min-h-svh` (from `packages/ui/src/sidebar.tsx`, verified absent from `apps/web/src` via grep) → present in `apps/web/.next/static/css/228475ab5e169040.css`: `.min-h-svh{min-height:100svh}`
- packages/genui-only class `max-w-4xl` (from `packages/genui/src/renderer/spec-renderer.tsx`, verified absent from `apps/web/src`/`packages/ui/src` via grep) → present in the same compiled CSS file: `.max-w-4xl{max-width:var(--container-4xl)}`
- `hsl(oklch` occurrence count in the compiled CSS: **0** (grep -o count across all 4 chunk files)

## WCAG-AA Contrast Parity (before/after, precomputed oklch, gated neutral pairs)

Computed via a throwaway conversion script (Björn Ottosson OKLab matrices + the exact `relativeLuminance`/`contrastRatio` math from `token-contrast.test.ts`), verifying the oklch literal actually written to `globals.css` round-trips to the same contrast ratio (not just the pre-rounding intermediate value):

| Mode | Pair | Before (raw HSL) | After (oklch round-trip) | Status |
|------|------|-------------------|---------------------------|--------|
| light (:root) | muted/muted-foreground | 4.696 | 4.698 | PASS (≥4.5) |
| light (:root) | secondary/secondary-foreground | 14.733 | 14.718 | PASS (≥4.5) |
| light (:root) | accent/accent-foreground | 14.522 | 14.506 | PASS (≥4.5) |
| dark (.dark) | muted/muted-foreground | 6.290 | 6.286 | PASS (≥4.5) |
| dark (.dark) | secondary/secondary-foreground | 12.550 | 12.520 | PASS (≥4.5) |
| dark (.dark) | accent/accent-foreground | 12.445 | 12.448 | PASS (≥4.5) |

All 6 gated pairs clear WCAG-AA in both modes; every ratio is within 0.03 of its pre-migration value (rounding noise from the 3-decimal `oklch(L% C H)` literal precision, not a real contrast loss).

## Animate-Plugin Resolution

**Ported natively**, not plugin-loaded. `tailwindcss-animate@1.0.7` (the v3 JS plugin every Radix `data-[state=open]`/`data-[state=closed]` animation class depends on) has no confirmed Tailwind v4 `@plugin` compatibility path verified in this session — rather than risk a silent utility-generation gap, its exact `enter`/`exit` `@keyframes` mechanics and the closed set of utility classes this repo actually uses (verified via `grep -rohE` across `packages/ui/src`/`apps/web/src`: `animate-in`, `animate-out`, `fade-in`, `fade-in-0`, `fade-out-0`, `zoom-in-95`, `zoom-out-95`, `slide-in-from-{top,bottom,left,right}-2`, `slide-in-from-{left,bottom}-1`, `slide-out-to-left-1`) were hand-ported as top-level `@keyframes enter`/`@keyframes exit` + `@utility` rules in `globals.css`. `duration-150/200/300/500` (used alongside these) are left as Tailwind's own built-in `transition-duration` utilities — a known, documented, non-blocking timing gap (see key-decisions).

## `hsl(var(--` Zero-Match Confirmation

- `grep -c "hsl(var(--" apps/web/src/app/globals.css` → **0** (confirmed post-Task-1 and re-confirmed at Task-2 completion)
- `grep -rn "hsl(var(--" apps/web/src packages/ui/src packages/genui/src` → **0 matches** outside the untracked `apps/web/src/app/dev/design/` scratch (explicitly out of scope, handled in 55-06)

## `packages/genui/src/theme/packs.ts` — Confirmed NOT Touched

`git diff --stat packages/genui/src/theme/packs.ts` → **empty output** (zero changes) at both Task 1 and Task 2 completion. The genui runtime re-theme surface stays HSL per 55-RESEARCH.md Pitfall 1; only its two consuming wrapper components (`ThemedRoot`, `PanelThemeScope`) were adapted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `apps/web/src/app/chat/_canvas/panel-theme-scope.tsx` (PanelThemeScope) shares ThemedRoot's exact unwrapped-injection bug but wasn't in the plan's fix list**
- **Found during:** Task 2, while reading `panel-theme-scope.tsx` per the plan's own `<read_first>` list (it IS in `files_modified`, flagged "comment only")
- **Issue:** `PanelThemeScope` (the app-owned PANL-01/04 canvas-panel re-theme wrapper) injects `pack.resolvedVars`/`tokenOverrides` — bare HSL triplets, packs.ts's contract — directly as `--{cssVarName}: value`, with zero `hsl()` wrapping, in the EXACT same shape `ThemedRoot` had before this plan's mandated fix. Once every external call site reads the var bare (Task 2's whole point), any panel with a non-default pack or a token override applied would render every `bg-primary`/`text-primary`/etc. Tailwind utility inside its subtree as an invalid CSS color (silently dropped, falling back to unset/inherited) — the identical Pitfall 1 corollary bug the plan explicitly fixes for `ThemedRoot`, just in a sibling component the plan's interfaces section didn't name for a runtime fix.
- **Fix:** Applied the identical fix pattern the plan mandates for `ThemedRoot`: derived an immutable `Set` of color-group CSS var names from `TOKEN_ALIAS_TO_CSS_VAR` (aliases starting with `color.`), imported from `@polytoken/genui/theme`; wrap only those vars in `hsl(...)` when building `cssVarStyle` from both `pack.resolvedVars` and `tokenOverrides`.
- **Files modified:** `apps/web/src/app/chat/_canvas/panel-theme-scope.tsx`, `apps/web/src/app/chat/_canvas/__tests__/panel-theme-scope.test.tsx` (4 assertions updated to expect the `hsl(...)`-wrapped form), `apps/web/src/app/chat/_canvas/__tests__/retheme-apply-integration.test.tsx` (1 assertion updated identically)
- **Verification:** `npm run typecheck -w @polytoken/web` clean; `npm run test -w @polytoken/web` — both updated test files pass (confirmed no other regression in the full suite run, see Gate Results)
- **Committed in:** `3da2947`

## Environment / Gate Results

- **`npm run web:build`** → **exit 0** at both Task-1 and Task-2 checkpoints (full 20-route production build; ran with `.env.local` exported into the shell, same pre-existing note as 55-01)
- **`npm run typecheck -w @polytoken/web`** → **exit 0** (Task 1 and Task 2)
- **`npm run typecheck -w @polytoken/ui`** → **exit 0** (Task 1 and Task 2)
- **`npm run typecheck -w @polytoken/genui`** → **exit 0** (Task 2, extra check since Task 2 touches genui's theme files)
- **`npm run test:e2e -w @polytoken/web --grep token-render`** (REGRESSION GATE, run after Task 1 AND after Task 2 per the elevated-blast-radius instruction):
  - `/` (inbox) — **PASS** both times (real `bg-background`/`text-foreground`/`bg-sidebar` computed-style assertions)
  - `/chat` (canvas) — **PASS** both times (React Flow attribution chrome `bg-background/70` resolves)
  - `/knowledge` — **FAILS on a click-interception timeout BEFORE reaching any color assertion** (sidebar content div intercepts a filter-rail checkbox click). **Root-cause isolated as pre-existing**: fully reverted all 5 of Task 1's files to their exact 55-01 committed state and re-ran this exact test in isolation — the IDENTICAL failure reproduced on the untouched baseline. This is the first live execution of this spec ever (Docker was unreachable in 55-01's session); not a regression from this plan. Logged to `deferred-items.md`, out of scope.
- **`npm run test -w @polytoken/web`** → 1 file failed (`token-contrast.test.ts`, all 6 tests — `Cannot parse HSL triplet from "oklch(...)"`, exactly the plan's stated EXPECTED failure), 1 file skipped (`token-registration.test.ts`, carried over from 55-01, also expected), **62 files / 448 tests passed** — `palette-ban.test.ts` (2 tests) explicitly confirmed green, no other file regressed.
- **`npm run test -w @polytoken/genui`** → 1 file failed (`artifacts.test.ts`'s `registryVersion` hash-drift assertion), 27 files / 547 tests passed. **Root-cause isolated as pre-existing**: `git stash`'d all 3 of this plan's `packages/genui/src/theme` file changes and re-ran the exact test in isolation — identical failure on the untouched baseline (unrelated content-hash of the Bedrock catalog/registry payload, no color/CSS surface). Logged to `deferred-items.md`, out of scope; stash restored (`git diff --stat` confirmed byte-identical).
- **`npm run screenshot:review -w @polytoken/web`** — NOT run (not a pass/fail gate per the plan; deferred to the Phase-58 human-review gate, same posture as 55-01).

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced by this plan's changes.

## Threat Flags

None. This plan's only new CSS-parsing surface (`color-mix(in srgb, ...)`, `oklch(...)` literals, native `@theme`/`@utility` rules) is build-time-generated, static CSS with no user input path — matches the plan's own `<threat_model>` (T-55-02a/b mitigated via the executable guards above; T-55-02c accepted-by-exclusion, `packs.ts` confirmed untouched).

## Issues Encountered

- Both root-cause isolations (the `/knowledge` E2E click-interception failure and the genui `artifacts.test.ts` hash drift) required a live bisection against the untouched baseline (full-file revert via `git show HEAD:<path>` / `git stash`, re-run, restore) rather than static reasoning alone, since neither failure mode is self-evidently unrelated to a large CSS/theme-surface change from its symptom alone. Both are documented in `deferred-items.md` with the exact bisection method used, so a future session doesn't need to re-derive causality.
- `npm run web:build` continues to require `.env.local` exported into the shell first (no `dotenv` wrapper on the plain `next build` script) — same pre-existing environment note as 55-01, not a code change.

## User Setup Required

None for this plan's own deliverable. Two follow-up investigations are logged in `deferred-items.md` for a future session (both confirmed pre-existing, neither blocks 55-03):
1. `/knowledge` filter-rail's "Knowledge Rules" checkbox is unclickable in the seeded E2E fixture (sidebar content intercepts the click) — needs its own investigation independent of this migration.
2. `packages/genui`'s `GENUI_PROMPT_PATH` committed artifact has drifted from a fresh `buildGenuiPromptPayload()` computation — needs regeneration once the actual drift cause is diagnosed.

## Next Phase Readiness

- 55-03 (gate rewrites) can proceed directly: `token-contrast.test.ts` needs its oklch-aware parser (per 55-RESEARCH.md Pitfall 5's own recommended fix — parse `oklch(L C H)` triplets directly, no conversion math needed at test time since values are already precomputed literals); `token-registration.test.ts`'s `describe.skip` block (from 55-01) needs a real implementation parsing the `@theme inline` block this plan just wrote.
- 55-04/55-05 (React 19 bump, Radix decision) are unblocked — this plan's Tailwind v4 CSS surface is now stable and complete except for the two named gate rewrites.
- 55-06 (dev/design scratch cleanup) has a clear, already-scoped target: `apps/web/src/app/dev/design/page.tsx`'s `isHslTriplet` Swatch-rendering regex needs to also accept `oklch(...)` strings once `design-data.json` is regenerated against this plan's oklch tokens (per 55-RESEARCH.md Pitfall 6, already anticipated) — untouched here per the plan's explicit DO NOT TOUCH instruction.

---
*Phase: 55-platform-migration-tailwind-v4-react-19*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 21 committed files (5 in Task 1 + 16 in Task 2, across the 2 task commits) plus
`deferred-items.md` and this SUMMARY confirmed present on disk via direct file existence checks.
Both task commit hashes (`10e182b`, `3da2947`) confirmed present in `git log --oneline --all`.
