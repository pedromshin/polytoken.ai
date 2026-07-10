---
phase: 48-token-system-extensions
plan: 01
subsystem: ui
tags: [design-tokens, tailwind, dtcg, wcag-contrast, vitest, genui]

# Dependency graph
requires:
  - phase: 26-28 (v1.4 Chat & Studio Design Uplift)
    provides: the DTCG token contract (TOKEN_ALIASES, TOKEN_ALIAS_TO_CSS_VAR, 6 style packs, resolveVars) this plan extends
provides:
  - radius.pill / color.success / color.successForeground / typography.code.family aliases wired through TOKEN_ALIASES, TOKEN_ALIAS_TO_CSS_VAR, all 6 packs.ts token maps, and resolveVars
  - App-layer utilities bg-success/text-success-foreground, rounded-pill, font-code, .touch-target guard, and a documented md-breakpoint convention
  - Computational WCAG-AA contrast regression gate (colocated contrast.ts helper) and a per-alias CSS-var registration gate in packs.test.ts
affects: [48-02, 48-03, 48-05, 50-mobile-responsive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named SEMANTIC_STATUS_PAIRS array in packs.test.ts — future plans append pairs to the SAME contrast-gate loop instead of standing up parallel mechanisms"
    - "Colocated pure test helper (theme/__tests__/contrast.ts) for computational (not eyeballed) WCAG-AA verification"

key-files:
  created:
    - packages/genui/src/theme/__tests__/contrast.ts
    - .planning/phases/48-token-system-extensions/deferred-items.md
  modified:
    - packages/genui/src/theme/tokens.ts
    - packages/genui/src/theme/packs.ts
    - packages/genui/src/theme/__tests__/packs.test.ts
    - apps/web/src/app/globals.css
    - packages/tailwind-config/base.ts
    - packages/tailwind-config/web.ts
    - apps/web/tailwind.config.ts

key-decisions:
  - "Brutalist keeps radius.pill='0rem' (zero-radius identity beats pill-ness) and migrates its existing JetBrains Mono display font explicitly onto typography.code.family, per D-48-01/D-48-03"
  - "playful-rounded's success pair darkened from the plan's suggested L=40% to L=30% (142 70% 30% / white fg) — the L=40% suggestion computed to 2.92:1, failing WCAG-AA; L=30% computes to 4.88:1"
  - "Breakpoint convention (D-48-07) fixed at Tailwind's stock md (768px) as the canvas->feed switch line; pack tokens stay breakpoint-static by design (no per-breakpoint token dimension)"

patterns-established:
  - "Extensible named-pairs array for contrast gates (SEMANTIC_STATUS_PAIRS) so later plans append rather than duplicate the loop"

requirements-completed: [TOKN-01, TOKN-02, TOKN-03, TOKN-07]

# Metrics
duration: 20min
completed: 2026-07-10
---

# Phase 48 Plan 01: Token System Extensions — Utility Primitives Summary

**Four load-bearing token aliases (radius.pill, color.success/successForeground, typography.code.family) wired through both the genui pack registry and the app CSS/Tailwind layer, backed by a computational WCAG-AA contrast gate and a per-alias CSS-var registration gate.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-10T16:30:00-03:00 (approx.)
- **Completed:** 2026-07-10T16:43:24-03:00
- **Tasks:** 3/3 completed
- **Files modified:** 7 (+ 2 created)

## Accomplishments
- `TOKEN_ALIASES` grew from 21 entries (not the plan's assumed 20 — see Deviations) to 25, adding `radius.pill`, `color.success`, `color.successForeground`, `typography.code.family`, each wired into `TOKEN_ALIAS_TO_CSS_VAR` with a compile-time `satisfies` completeness gate.
- All 6 style packs (`polytoken-teal`, `linear-clean`, `warm-editorial`, `brutalist`, `corporate-saas`, `playful-rounded`) define the 4 new values with inline WCAG-AA contrast comments; `resolveVars` extended with the 4 matching CSS-var lines.
- App-layer surface: `globals.css` gained `--success`/`--success-foreground`/`--radius-pill`/`--font-code` in `:root` + `.dark`, a `.touch-target` (44px) utility, and a documented `md`-breakpoint convention comment. `tailwind-config/base.ts` gained a `success` color entry in the exact `primary` idiom (opacity modifiers work identically). `tailwind-config/web.ts` gained `borderRadius.pill`. `apps/web/tailwind.config.ts` gained `fontFamily.code`.
- A new colocated `theme/__tests__/contrast.ts` pure helper (HSL -> sRGB -> WCAG relative luminance -> contrast ratio) backs a parametrized `describe("WCAG-AA contrast — semantic status pairs")` gate proving `color.success`/`color.successForeground` clears 4.5:1 in all 6 packs, structured as an extensible named-pairs array for 48-02 to append to.
- A new `describe("Token-family registration...")` gate iterates `TOKEN_ALIASES` x packs proving every alias resolves through `TOKEN_ALIAS_TO_CSS_VAR` to a non-empty `resolvedVars` entry — the exact "var exists but utility never registered" regression class this phase's must-haves target.
- 60/60 tests pass in `packs.test.ts` (43) + `token-allowlist.test.ts` (17); full `src/theme` suite (73 tests incl. `themed-wrapper.test.tsx`) green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 4 utility aliases to the genui token registry (all 6 packs)** - `7a8230c` (feat)
2. **Task 2: Register app-layer utilities + touch-target/md-breakpoint mechanism** - `9df71a2` (feat)
3. **Task 3: Extend regression gates — real WCAG-AA contrast + per-alias CSS-var registration** - `7fe7c41` (test)

_Note: Task 1 and Task 3 were both flagged `tdd="true"` in the plan, but the plan structures them as an implement-then-gate pair rather than a single-task RED/GREEN cycle — Task 1 lands the values, Task 3 lands the regression tests that lock them in. Both tasks' own `<verify>` blocks (typecheck / test-run) expect a passing state, not a failing RED step, so no artificial failing commit was introduced._

## Files Created/Modified
- `packages/genui/src/theme/tokens.ts` - 4 new aliases in `TOKEN_ALIASES` + `TOKEN_ALIAS_TO_CSS_VAR`
- `packages/genui/src/theme/packs.ts` - 4 new values per pack (6 packs) + `resolveVars` extension + WCAG comments
- `packages/genui/src/theme/__tests__/contrast.ts` - new pure WCAG contrast-ratio test helper
- `packages/genui/src/theme/__tests__/packs.test.ts` - 2 new `describe` blocks (contrast gate, registration gate)
- `apps/web/src/app/globals.css` - `--success`/`--success-foreground`/`--radius-pill`/`--font-code` vars, `.touch-target` utility, md-breakpoint comment
- `packages/tailwind-config/base.ts` - `success` color entry
- `packages/tailwind-config/web.ts` - `borderRadius.pill`
- `apps/web/tailwind.config.ts` - `fontFamily.code`
- `.planning/phases/48-token-system-extensions/deferred-items.md` - new; logs an out-of-scope pre-existing typecheck issue found during verification

## Decisions Made
- Success pair values per pack (all computationally verified >= 4.5:1 via the new `contrast.ts` gate): teal/linear-clean/corporate-saas share `142 71% 29%` fg `0 0% 98%` (4.90:1); warm-editorial `142 60% 30%` fg `0 0% 98%` (5.11:1, warmer register); brutalist `120 100% 25%` fg `0 0% 100%` (5.17:1, stark); playful-rounded `142 70% 30%` fg `0 0% 100%` (4.88:1) — see Deviations for why this differs from the plan's suggested value.
- Brutalist's `radius.pill` stays `0rem` (documented D-48-01 exception) and `typography.code.family` explicitly carries `'JetBrains Mono', 'Courier New', Courier, monospace` while `typography.display.family` is left untouched.
- `.touch-target` and the `md`-breakpoint convention are declared now (ahead of their first consumer) per the plan's explicit instruction, targeting Phase 50's mobile-responsive answer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] playful-rounded's suggested success color failed WCAG-AA; darkened to pass**
- **Found during:** Task 3 (running the new computational contrast gate)
- **Issue:** The plan suggested `142 70% 40%` fg `0 0% 100%` for playful-rounded's success pair. Manual WCAG computation (and the automated gate) showed this computes to 2.92:1 — well below the 4.5:1 floor.
- **Fix:** Darkened the background lightness to 30% (`142 70% 30%`), keeping hue/saturation and the white foreground — computes to 4.88:1.
- **Files modified:** `packages/genui/src/theme/packs.ts`
- **Verification:** New `WCAG-AA contrast — semantic status pairs` test for `playful-rounded` passes (60/60 tests green).
- **Committed in:** `7a8230c` (Task 1 commit — the value was set correctly at authoring time before Task 3's gate confirmed it)

**2. [Rule 1 - Doc correction, no functional impact] Plan's `TOKEN_ALIASES.length === 24` premise was based on an inaccurate baseline**
- **Found during:** Task 1/3 verification (manual count of the pre-existing tuple)
- **Issue:** The plan's interfaces section and Task 1's `<behavior>` both state "currently 20 entries" / "After this task, `TOKEN_ALIASES.length` === 24 (was 20)". Counting the actual pre-existing tuple (before this plan's edits) yields 21 entries, not 20 — so the correct post-task total is 25, not 24.
- **Fix:** No code change needed — all 4 required new aliases (`radius.pill`, `color.success`, `color.successForeground`, `typography.code.family`) are present exactly as specified; no test hardcodes a literal `20`/`24`/`25` count (`token-allowlist.test.ts`'s "has exactly TOKEN_ALIASES.length options" assertion is self-referential against the live tuple, not a magic number), so nothing was broken and nothing needed correcting in test code.
- **Files modified:** none (informational only)
- **Verification:** `grep -n '^\s*"'` count of the tuple confirms 25 entries; full test suite green.
- **Committed in:** n/a (documented here, not a code change)

---

**Total deviations:** 2 auto-fixed (1 bug fix — Rule 1 contrast failure; 1 doc-only correction — Rule 1, no code impact)
**Impact on plan:** Both auto-fixes were necessary/informational only. No scope creep — every alias, pack, and utility specified in the plan was delivered.

## Issues Encountered
- `npm run typecheck -w @polytoken/web` reports ~50 pre-existing errors, all confined to the untracked (no git history) `apps/web/src/app/dev/design/` scratch directory (stale `@nauta/ui/*` imports predating the Phase 42 rename). `apps/web/tsconfig.json` already carries an `exclude: ["src/app/dev/design"]` entry intended to hide this, but `npx tsc --listFilesOnly` proves the exclude is not effective. Verified none of these errors reference anything this plan touched (`success`, `radius-pill`, `font-code`, `borderRadius`, `fontFamily`); confirmed out of scope per the scope-boundary rule (neither `tsconfig.json` nor `src/app/dev/design/` are in this plan's `files_modified`). Logged to `.planning/phases/48-token-system-extensions/deferred-items.md` for a future plan/session to resolve.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `packages/genui/src/theme/packs.ts`'s `SEMANTIC_STATUS_PAIRS` array is ready for 48-02 to append tier-ladder and graph node/edge contrast pairs to the same computational gate.
- `bg-success`/`text-success-foreground`/`rounded-pill`/`font-code`/`.touch-target` are all available for 48-03's utility-token consumer plan and 48-05's design-convention docs.
- Blocker/concern: the pre-existing `apps/web` typecheck failure (dev/design scratch directory + ineffective tsconfig exclude) will surface again in any future plan's `npm run typecheck -w @polytoken/web` verification until a future plan fixes the exclude mechanism or resolves the scratch files — see `deferred-items.md`.

## Self-Check: PASSED

All 10 files (7 modified, 3 created incl. this summary) verified present on disk; all 3 task commit hashes (`7a8230c`, `9df71a2`, `7fe7c41`) verified present in `git log`.

---
*Phase: 48-token-system-extensions*
*Completed: 2026-07-10*
