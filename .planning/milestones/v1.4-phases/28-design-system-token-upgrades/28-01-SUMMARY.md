---
phase: 28-design-system-token-upgrades
plan: 01
subsystem: ui
tags: [design-tokens, tailwind, css-custom-properties, wcag, vitest]

# Dependency graph
requires:
  - phase: 27-adopted-external-design-picks
    provides: "stable :root/.dark token layer + shadcn-derived component set to rebase onto"
provides:
  - "TOKEN-01: secondary/muted/accent as tonally distinct hue-164 neutrals (both modes)"
  - "TOKEN-02: chart-1..5 teal-anchored categorical ramp + sidebar-* aliased to existing tokens"
  - "TOKEN-03: --elevation-1/2/3 custom properties + shadow-elevation-1/2/3 Tailwind utilities"
  - "TOKEN-04: --radius-xl/--radius-2xl custom properties + xl/2xl borderRadius Tailwind utilities"
  - "Committed WCAG-AA contrast regression gate (token-contrast.test.ts) over the 3 neutral pairs, both modes"
affects: [28-02-design-system-token-upgrades, 28-03-design-system-token-upgrades]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Token-VALUE-only phase: :root/.dark edits + theme.extend config entries, zero consumer-file edits"
    - "Alias-not-copy for derived var groups (sidebar-* -> var(--background)/var(--primary)/etc.) for single-source-of-truth correctness"
    - "Stacked-hairline shadow recipe (0 0 0 1px hairline + soft ambient layer) capped at <=8px blur (ban item 9 ceiling)"
    - "Committed regression-gate test that parses live CSS and computes ratios from actual values, never hardcoded expected numbers"

key-files:
  created:
    - apps/web/src/app/__tests__/token-contrast.test.ts
  modified:
    - apps/web/src/app/globals.css
    - packages/tailwind-config/base.ts
    - packages/tailwind-config/web.ts

key-decisions:
  - "Split the single globals.css file edit into two commits (Task 1: TOKEN-01/02 values; Task 2: TOKEN-03/04 vars) by temporarily staging/reverting hunks, to preserve one-commit-per-task traceability even though both tasks touch the same file"
  - "token-contrast.test.ts resolves globals.css via path.dirname(fileURLToPath(import.meta.url)) instead of new URL(relative, import.meta.url) directly -- vitest's jsdom environment resolves relative URL references against jsdom's document location (http://localhost:3000/) rather than the module's own file: base, so the UI-SPEC's literal `new URL(\"../globals.css\", import.meta.url)` pattern throws 'The URL must be of scheme file' at runtime on this stack"
  - "TOKEN-01/02 marked complete in REQUIREMENTS.md; TOKEN-03/04 left open per orchestrator instruction -- their full contract (card.tsx/composer.tsx/chat-node.tsx/genui-panel-node.tsx consumer wiring) lands in 28-02/28-03, this plan only lands the token declarations + config registration"

patterns-established:
  - "Regression-gate TDD variant: when a task's job is to lock down already-correct values (not drive out new behavior), the test commit legitimately follows the value commits rather than preceding them -- sensitivity proven by a manual temporary-corruption + revert cycle instead of a literal pre-implementation RED commit"

requirements-completed: [TOKEN-01, TOKEN-02]

# Metrics
duration: ~15min
completed: 2026-07-07
---

# Phase 28 Plan 01: Design-System Token Upgrades (Foundation Layer) Summary

**Rebased secondary/muted/accent to tonally-distinct hue-164 neutrals, chart-1..5 to a teal-anchored ramp, aliased all sidebar-* vars onto existing tokens, declared a teal-tinted --elevation-1/2/3 shadow scale + --radius-xl/2xl steps with their Tailwind utility registrations, and locked all six neutral-pair contrast ratios behind a committed vitest WCAG-AA gate — zero consumer files touched.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-07T01:20:24Z
- **Completed:** 2026-07-07T01:31:30Z
- **Tasks:** 3
- **Files modified:** 3 modified, 1 created

## Accomplishments
- `secondary`/`muted`/`accent` are now hue-164 tonally distinct neutrals in both light and dark mode (no longer one shared `0 0% 96.1%` gray), verified >=4.5:1 WCAG-AA against every changed `*-foreground` pair
- `chart-1..5` rebased onto a teal-anchored categorical ramp (`chart-1` = `primary` verbatim in light mode); all 8 `sidebar-*` vars now alias existing tokens in both `:root` and `.dark` — the accidental blue `--sidebar-ring` is gone, now `var(--primary)`
- `--elevation-1/2/3` (stacked-hairline + teal-tinted ambient, light / neutral-black ambient, dark) declared and registered as `shadow-elevation-1/2/3` Tailwind utilities via `base.ts`; max blur across the scale is exactly 8px, at the ban-item-9 ceiling, never over it
- `--radius-xl`/`--radius-2xl` declared (12px/16px at the current 8px base) and registered in `web.ts`'s `borderRadius` — `card.tsx`'s existing literal `rounded-xl` now resolves through the token at the same visual size, with zero className edit needed
- Committed `token-contrast.test.ts` parses the live `globals.css`, computes HSL→linear-sRGB→relative-luminance→contrast-ratio for all 3 neutral pairs in both modes (6 assertions), and is proven sensitive to regressions (manually verified: reverting `muted-foreground` to the pre-phase stock value drops the ratio to 4.10:1 and fails the gate)

## Task Commits

Each task was committed atomically:

1. **Task 1: TOKEN-01 + TOKEN-02 value changes in globals.css** - `d0804b6` (feat)
2. **Task 2: TOKEN-03 elevation vars + TOKEN-04 radius vars, and their Tailwind config entries** - `c9f67c0` (feat)
3. **Task 3: Committed WCAG-AA contrast regression test over the neutral pairs** - `21ce56f` (test)

**Plan metadata:** (this commit — docs: complete plan)

_Note: Task 3 is a regression-gate test over values already landed in Tasks 1/2, not classic feature-driving TDD — see "Deviations from Plan" and "TDD Gate Compliance" below._

## Files Created/Modified
- `apps/web/src/app/globals.css` - TOKEN-01/02 neutral+chart+sidebar-alias values (Task 1); TOKEN-03/04 `--elevation-*`/`--radius-xl`/`--radius-2xl` custom properties (Task 2)
- `packages/tailwind-config/base.ts` - `boxShadow.elevation-1/2/3` theme.extend entries
- `packages/tailwind-config/web.ts` - `borderRadius.xl`/`borderRadius["2xl"]` theme.extend entries
- `apps/web/src/app/__tests__/token-contrast.test.ts` - committed WCAG-AA contrast regression gate (new file)

## Decisions Made
- Split the combined globals.css edit into two clean per-task commits (temporarily removing/re-adding the Task-2 lines) rather than one large commit, to preserve the plan's one-commit-per-task traceability contract.
- Resolved the test's CSS-path lookup via `path.dirname(fileURLToPath(import.meta.url))` instead of the UI-SPEC's literal `new URL("../globals.css", import.meta.url)` pattern — a Rule 1 auto-fix (the literal pattern throws under vitest's jsdom environment on this stack; see Deviations below). The resulting parse/assert logic is otherwise the exact contract specified.
- Marked only TOKEN-01/TOKEN-02 complete in REQUIREMENTS.md per explicit scope: TOKEN-03/04's full requirement text also names consumer files (`card.tsx`, etc.) that land in 28-02/28-03, so those two stay open until their consumers wire up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `new URL(relative, import.meta.url)` throws under vitest's jsdom environment**
- **Found during:** Task 3 (writing token-contrast.test.ts)
- **Issue:** The UI-SPEC's literal instruction was `new URL("../globals.css", import.meta.url)` passed to `node:fs`. On this stack (vitest 2.1.9, `environment: "jsdom"`), the global `URL` constructor resolves relative references against jsdom's default document location (`http://localhost:3000/`) rather than the module's own `file:` base — `new URL("../globals.css", import.meta.url)` silently returns `http://localhost:3000/src/app/globals.css` instead of a `file://` path, and `fileURLToPath()` on that result throws `TypeError: The URL must be of scheme file`. Confirmed via a throwaway debug test that printed the raw URL string (`import.meta.url` alone: correct `file:///...`) vs. the same value after relative-URL resolution (wrong scheme).
- **Fix:** Resolve the test file's own path via `fileURLToPath(import.meta.url)` (no relative resolution through the global `URL` constructor), then build the target path with `path.resolve(path.dirname(selfPath), "..", "globals.css")` — sidesteps jsdom's URL polyfill entirely while reading the exact same file.
- **Files modified:** `apps/web/src/app/__tests__/token-contrast.test.ts`
- **Verification:** Test passes (6/6) reading the real file; a throwaway debug test confirmed the root cause before/after the fix.
- **Committed in:** `21ce56f` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for Task 3's done criteria ("runs under vitest... exits 0") to be achievable at all on this project's actual vitest/jsdom configuration. No scope creep — same file read, same parsing/assertion contract, only the path-resolution mechanism changed.

## TDD Gate Compliance

Task 3 is marked `tdd="true"`, but its job is a **regression gate over values already implemented in Tasks 1/2** (its own `<action>` describes writing a test over the current `globals.css`, not driving out unimplemented behavior) — the plan's own text calls it "this phase's single committed token gate," distinct from feature-driving TDD. Consequently the git log order is `feat` (d0804b6) → `feat` (c9f67c0) → `test` (21ce56f), i.e. the test commit follows the implementation commits rather than preceding them. Per the plan-level TDD gate check ("a `test(...)` commit exists (RED gate); a `feat(...)` commit exists after it (GREEN gate)"), this ordering is technically inverted.

**Why this is not a compliance gap in substance:** the plan explicitly separates "implement the values" (Tasks 1/2) from "commit a regression gate over the values" (Task 3) as distinct, ordered tasks — there is no unimplemented behavior left for a literal RED phase to fail against. To prove the gate is real rather than vacuously passing, its sensitivity was verified manually before committing: `--muted-foreground` (light) was temporarily reverted from `164 5% 41.5%` to the pre-phase stock `164 5% 45.1%`, the suite was re-run and the `muted`/`muted-foreground` (light) assertion failed (`4.10:1 < 4.5`), then the value was reverted and the suite re-run again to confirm 6/6 green — this is the substantive equivalent of a RED→GREEN cycle, executed against a throwaway edit rather than as separate commits.

## Issues Encountered
None beyond the jsdom URL-resolution deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Token layer (TOKEN-01..04) is fully in place; `bg-muted`/`text-muted-foreground`/`bg-secondary`/`hover:bg-accent`/`shadow-elevation-*`/`rounded-xl` all resolve to the new values automatically wherever they're already used.
- 28-02/28-03 can now safely wire the 4 named `shadow-elevation-*` consumers (`card.tsx`, `composer.tsx`, `chat-node.tsx`, `genui-panel-node.tsx`) and the TOKEN-05 entrance/stagger animations — no further token-layer changes needed.
- TOKEN-03/TOKEN-04 requirement checkboxes intentionally left open in REQUIREMENTS.md until their consumer-file wiring lands.
- `docs/design/product-register-and-bans.md`'s radius-allowlist note and the conversation-rail backdrop-blur debt resolution (also in 28-UI-SPEC.md) are out of this plan's scope — deferred to whichever of 28-02/28-03 covers them.

---
*Phase: 28-design-system-token-upgrades*
*Completed: 2026-07-07*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all 3 task commit hashes (`d0804b6`, `c9f67c0`, `21ce56f`) confirmed present in `git log --oneline --all`.
