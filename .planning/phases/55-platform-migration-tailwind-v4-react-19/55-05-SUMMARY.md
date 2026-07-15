---
phase: 55-platform-migration-tailwind-v4-react-19
plan: 05
subsystem: ui
tags: [react-day-picker, react-resizable-panels, react-19, calendar, dependency-bump]

# Dependency graph
requires:
  - phase: 55-04
    provides: "unified react@19.2.7/react-dom@19.2.7 tree-wide, packages/ui peerDependencies widened to accept ^19, six low-risk packages/ui runtime deps already bumped"
provides:
  - "react-day-picker@^9 with packages/ui/src/calendar.tsx fully rewritten to the v9 API (Day/DayButton slot split, UI/DayFlag/SelectionState classNames enum, navLayout=\"around\", custom Chevron/DayButton components) -- visual contract (selected=bg-primary, today=bg-accent, range rounding, outside/disabled dimming) preserved and live-verified"
  - "react-resizable-panels@^3 with zero API fallout at the packages/ui/src/resizable.tsx consumer -- PanelGroup/Panel/PanelResizeHandle usage unchanged"
  - "55-04's root package.json overrides react/react-dom pin removed and verified redundant (both bumped packages now natively declare React 19 peers) -- single react@19.2.7 instance confirmed tree-wide post-removal via a full node_modules+lockfile regeneration"
  - "STCK-02 now fully satisfiable: every packages/ui runtime dependency requiring a React-19-compatible bump (8 total across 55-04+55-05) is bumped, both high/medium-risk API-surface components (Calendar, resizable dock) are revalidated"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "react-day-picker v9's Day (<td>, grid cell) / DayButton (<button>) slot split means selection/today/range CSS classes are auto-merged onto the CELL by the library, not the button -- but DayButton receives the real `modifiers` object as a React prop (not just DOM state), so a custom DayButton component reading `props.modifiers.selected/.today/.range_start/...` directly in its render function is the v9-native way to drive the actual visible highlight, replacing v8's `:has([aria-selected])` CSS-selector-on-the-parent-cell trick entirely"
    - "react-day-picker v9's default layout renders a single detached <nav> above all months (not flanking each month's caption like v8 did) -- `navLayout=\"around\"` opts back into v8's caption-with-flanking-nav-buttons DOM structure (PreviousMonthButton/NextMonthButton as direct siblings of MonthCaption inside each Month), which is what a `relative`-positioned Month + `absolute left-1`/`right-1` button classNames actually expects"
    - "when verifying a Tailwind `transition-colors` element's post-interaction computed style via Playwright, read it AFTER a short wait (e.g. 300ms) past the default ~150ms transition duration -- reading immediately post-click/re-render captures a mid-transition interpolated color (in this app's oklch/color-mix-based v4 tokens, this showed up as a real but misleadingly-tiny alpha channel, e.g. 0.033 instead of 1.0), not a real bug"
    - "when removing a root package.json `overrides` pin that was added specifically to defeat npm's incremental-resolver hoisting behavior, verify the removal the same way the addition itself had to be verified (55-04's own documented lesson): a full `rm -rf node_modules **/node_modules package-lock.json && npm install`, not an incremental `npm install`, since npm's resolver preserves prior lockfile placements by default"

key-files:
  created: []
  modified:
    - packages/ui/package.json
    - packages/ui/src/calendar.tsx
    - packages/ui/src/spreadsheet-grid/cell-editors/DateCellEditor.tsx
    - package.json
    - package-lock.json
    - .planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md

key-decisions:
  - "Rewrote calendar.tsx by reading the INSTALLED react-day-picker@9.14.0 package's own .d.ts/.js source directly (UI.js enum, DayPicker.js render logic, DayButton.js/Day.js component source, getClassNamesForModifiers.js) rather than trusting a cached/training-data characterization of the v9 API -- Context7 MCP and the ctx7 CLI fallback were both unavailable in this environment (no mcp__context7__* tools in the toolset, `command -v ctx7` not found), so ground-truth-from-the-actual-installed-package was the highest-confidence available source, consistent with 55-RESEARCH.md Pitfall 3 + Assumption A4's explicit LOW-confidence flag on any cached v9 characterization"
  - "Added navLayout=\"around\" to the DayPicker call (not in the plan's explicit interface description) -- discovered via reading DayPicker.js's render logic that v9's DEFAULT layout (navLayout unset) renders a single detached <nav> above all months, structurally different from v8's caption-flanking nav buttons; \"around\" is the officially-supported v9 layout mode that reproduces v8's actual DOM structure (PreviousMonthButton/NextMonthButton as siblings of MonthCaption), which the ported classNames (`month: relative`, `button_previous/next: absolute left-1/right-1`) require to render correctly. Confirmed live via screenshot -- chevrons correctly flank the \"July 2026\" caption."
  - "DateCellEditor.tsx's initialFocus prop updated to autoFocus (v9 deprecates the former in favor of the latter, per the installed package's own props.d.ts) -- one-line, in-scope fix since it's a direct Calendar consumer touched by this plan's API-surface change (Rule 1)"
  - "Removed 55-04's root `overrides: { react, react-dom }` pin after confirming both react-day-picker@9.14.0 (`react: >=16.8.0`) and react-resizable-panels@3.0.6 (`react: ^16.14.0 || ... || ^19.0.0`) now natively accept React 19 -- verified via a full node_modules+lockfile wipe and fresh install (not an incremental one, per 55-04's own documented lesson that `overrides` changes aren't honored against an existing lockfile) that `npm ls react react-dom --all` resolves a single react@19.2.7/react-dom@19.2.7 instance tree-wide with every consumer \"deduped\" against it"
  - "Did not attempt to fix or further investigate the pre-existing sidebar pointer-events-interception bug (documented in deferred-items.md since 55-02, re-confirmed unchanged in 55-04) that causes 2 of the 8 E2E failures (token-render /knowledge, uat-48.1) -- neither of this plan's commits touches packages/ui/src/sidebar.tsx; re-ran the full E2E suite twice (post-bump, post-overrides-removal) and got the identical 38 passed/8 failed/4-did-not-run signature both times, confirming non-regression rather than re-litigating an out-of-scope pre-existing bug (SCOPE BOUNDARY)"
  - "Did not start the local FastAPI listener to unblock live-loop-green.spec.ts/uat-39-tool-round.spec.ts (the 2 other E2E failures, both needing a live DB-backed backend) -- unlike 55-04, which did this as a one-time read-only recovery, this plan's execution_rules explicitly note a Python-only executor may be running concurrently in apps/email-listener; starting/stopping a server there risked colliding with that concurrent work for zero benefit (neither failing spec touches Calendar or resizable-panels)"

patterns-established:
  - "Pattern: for a major-version UI-library rewrite where official migration-guide fetching is unavailable (no MCP/CLI doc access), read the ACTUALLY-INSTALLED package's own compiled .d.ts and .js source directly -- enum definitions, component render source, and prop-type declarations are ground truth for the exact resolved version, higher-confidence than any cached summary and immune to version drift between what a migration guide describes and what actually got installed"

requirements-completed: [STCK-02]

# Metrics
duration: ~2h15m
completed: 2026-07-15
---

# Phase 55 Plan 05: react-day-picker v9 + react-resizable-panels v3 Summary

**react-day-picker v8->v9 with packages/ui/src/calendar.tsx rewritten to the v9 Day/DayButton slot-split API (custom DayButton reading the real `modifiers` prop, navLayout="around" for v8-equivalent nav-button placement) and react-resizable-panels v2->v3 with zero consumer-side API fallout — both isolated in separate commits, both live-verified via authenticated Playwright interaction (selected day resolves exact `--primary`/`--accent` oklch values, dock resize handle drag moves panel size 18.0->26.3), and 55-04's now-redundant root React overrides pin removed and re-verified clean.**

## Performance

- **Duration:** ~2h15m
- **Tasks:** 2 (both `type="auto"`) + 1 post-task cleanup step (overrides removal, mandated by execution_rules)
- **Files modified:** 6 (packages/ui/package.json, packages/ui/src/calendar.tsx, packages/ui/src/spreadsheet-grid/cell-editors/DateCellEditor.tsx, root package.json, package-lock.json, deferred-items.md)

## Accomplishments

- **Task 1 — react-day-picker v9 + calendar.tsx rewrite:** Registry + repository.url re-verified live (gpbl/react-day-picker) before install. Bumped `react-day-picker` `^8.10.1` -> `^9.14.0` in `packages/ui`. Read the installed package's own `UI.js` (enum), `DayPicker.js` (render logic), `DayButton.js`/`Day.js` (component source), and `getClassNamesForModifiers.js` directly to build a ground-truth v8->v9 API map (not a cached/trained characterization — 55-RESEARCH.md's own Pitfall 3/Assumption A4 flagged this as LOW-confidence without fresh verification, and Context7 MCP/ctx7 CLI were both unavailable in this environment). Full rewrite of `packages/ui/src/calendar.tsx`:
  - classNames keys remapped 1:1 to v9's `UI`/`DayFlag`/`SelectionState` enum values: `cell`->`day`, `day`->`day_button`, `table`->`month_grid`, `head_row`/`head_cell`->`weekdays`/`weekday`, `row`->`week`, `caption`->`month_caption`, `nav_button_previous`/`next`->`button_previous`/`button_next`, `day_selected`/`day_today`/`day_outside`/`day_disabled`/`day_range_*`->`selected`/`today`/`outside`/`disabled`/`range_*`.
  - v9 splits v8's combined day-cell/button element into `Day` (`<td>`, the grid cell — receives selection/today/range classNames auto-merged by the library) and `DayButton` (`<button>` — receives only its static base classNames, but the REAL `modifiers` object as a React prop). A custom `CalendarDayButton` component reads `props.modifiers.selected/.today/.range_start/.range_end/.range_middle/.outside/.disabled/.hidden` directly to drive the visible highlight — the v9-native replacement for v8's `:has([aria-selected])` CSS-selector-on-the-parent-cell trick.
  - v8's `IconLeft`/`IconRight` component slots consolidated into v9's single `Chevron` slot (`orientation` prop); a custom `CalendarChevron` renders the correct icon.
  - `navLayout="around"` added (not explicitly named in the plan's interface description, discovered by reading `DayPicker.js`'s render logic) — v9's default layout renders one detached `<nav>` above all months, structurally different from v8's caption-flanking buttons; "around" reproduces v8's actual DOM shape (Previous/NextMonthButton as siblings of MonthCaption), which the ported `month: relative` / `button_previous/next: absolute left-1/right-1` classNames require.
  - `DateCellEditor.tsx`'s `initialFocus` prop -> `autoFocus` (v9 deprecates the former).
  - Visual contract confirmed via a live authenticated Playwright session against `/dev/design`: after waiting past the `transition-colors` animation, the selected day's computed background resolved to `oklch(0.389 0.053 173.7)` (exact match to `globals.css`'s `--primary: oklch(38.9% 0.053 173.7)`) and today's to `oklch(0.958 0.003 178.7)` (exact match to `--accent: oklch(95.8% 0.003 178.7)`); a control plain-`bg-primary` Button elsewhere on the same page confirmed these aren't a rendering artifact. Screenshot captured showing correct nav-chevron placement, today highlight, and selected-day highlight.
- **Task 2 — react-resizable-panels v3:** Registry + repository.url re-verified live (bvaughn/react-resizable-panels) before install. Bumped `react-resizable-panels` `^2.0.19` -> `^3.0.6`. Zero API fallout: `packages/ui/src/resizable.tsx`'s `PanelGroup`/`Panel`/`PanelResizeHandle` usage typechecked clean with no edits (confirmed the exported member names are unchanged in the installed 3.0.6 package's own `.d.ts`). Dock-resize proof: a live authenticated Playwright drag on the first `PanelResizeHandle` of the inbox three-pane dock (`apps/web/src/app/_components/inbox-three-pane.tsx`, the closest analog to a "chat/canvas resizable dock" this repo has) moved the left panel's `data-panel-size` from `18.0` to `26.3`, confirming the resize interaction still works.
- **Post-task: 55-04 overrides pin removal.** Both newly-bumped packages now natively declare React 19 in their own `peerDependencies` (`react-day-picker@9.14.0`: `react: >=16.8.0`; `react-resizable-panels@3.0.6`: `react: ^16.14.0 || ^17.0.0 || ^18.0.0 || ^19.0.0 || ^19.0.0-rc`) — the root `overrides` pin 55-04 added specifically to suppress npm's default hoisting of a stale `react@18.3.1` (forced by these two packages' then-still-18-capped peers) is redundant. Removed it, then did a full `node_modules` + `package-lock.json` wipe and fresh `npm install` (per 55-04-SUMMARY's own documented lesson that `overrides` changes are not honored against an existing lockfile under incremental install — removal must be verified the same rigorous way the addition was). Verified: `npm ls react react-dom --all` resolves a single `react@19.2.7`/`react-dom@19.2.7` instance tree-wide, every consumer (Radix, ag-grid, next, zustand, @xyflow/react, etc.) shown as "deduped" against it, zero `18.x` instances anywhere.
- **Full revalidation, after both bumps and after the overrides removal:** `npm run typecheck -w @polytoken/ui` / `-w @polytoken/web` / `-w @polytoken/genui` all exit 0. `npm run test -w @polytoken/web` -> **64 files / 464 tests, 0 failed** (exact 55-04 baseline, confirmed unchanged both after the bumps and again after the overrides removal + full reinstall). `npm run test -w @polytoken/genui` -> 546/548, 2 pre-existing failures (the already-documented `artifacts.test.ts` registryVersion hash drift, unrelated to React). `npm run web:build` -> exit 0, full 20/20-route production build (ran twice, once per major checkpoint).

## Task Commits

1. **Task 1 (react-day-picker v9 bump + calendar.tsx rewrite):** `7382925` (feat)
2. **Task 2 (react-resizable-panels v3 bump):** `a40741f` (feat)
3. **Post-task (remove redundant 55-04 overrides pin):** `70fd3b5` (chore)

## Files Created/Modified

- `packages/ui/package.json` — `react-day-picker` `^8.10.1` -> `^9.14.0`; `react-resizable-panels` `^2.0.19` -> `^3.0.6`
- `packages/ui/src/calendar.tsx` — full rewrite to the react-day-picker v9 API (see Accomplishments above)
- `packages/ui/src/spreadsheet-grid/cell-editors/DateCellEditor.tsx` — `initialFocus` -> `autoFocus`
- `package.json` (root) — removed the `overrides: { react, react-dom }` block added by 55-04
- `package-lock.json` — regenerated across all three commits (dependency bumps, then a full from-scratch regeneration for the overrides removal)
- `.planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md` — appended a 55-05 confirmation note to the existing sidebar-pointer-events entry (re-ran the full E2E suite twice this session, identical pre-existing failure signature both times, non-regression confirmed)

## Decisions Made

See `key-decisions` in frontmatter. Summary: rewrote calendar.tsx from the installed package's own source (no live doc-fetch tooling available in this environment); added `navLayout="around"` (an in-scope, necessary addition discovered via source-reading, not named explicitly in the plan's interface description) to preserve v8's nav-button placement; updated `DateCellEditor.tsx`'s deprecated `initialFocus` prop; removed and re-verified 55-04's now-redundant overrides pin via a full lockfile regeneration (not an incremental install, per 55-04's own documented gotcha).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DateCellEditor.tsx used react-day-picker v9's deprecated `initialFocus` prop**
- **Found during:** Task 1, reading the installed package's `props.d.ts` while identifying every `<Calendar>` consumer
- **Issue:** `packages/ui/src/spreadsheet-grid/cell-editors/DateCellEditor.tsx` passed `initialFocus` to `<Calendar>` — still valid in v9 (backward-compatible) but marked `@deprecated` in favor of `autoFocus` in the installed package's own type declarations, with "will be removed" language.
- **Fix:** Changed `initialFocus` to `autoFocus`.
- **Files modified:** `packages/ui/src/spreadsheet-grid/cell-editors/DateCellEditor.tsx`
- **Verification:** `npm run typecheck -w @polytoken/ui` clean; no runtime behavior change (both props do the same thing in v9, this just moves off the deprecated name before it's removed in a future major).
- **Committed in:** `7382925` (Task 1 commit)

**2. [Rule 3 - blocking issue, mandated by this plan's own execution_rules] Removed 55-04's now-redundant root `overrides` pin**
- **Found during:** Post-Task-2, per this plan's explicit execution_rules instruction to check whether the pin was still needed
- **Issue:** 55-04 added a root `overrides: { react, react-dom }` pin to defeat npm's default hoisting of a stale React 18 instance, caused by react-day-picker@8/react-resizable-panels@2's then-18-capped peerDependencies. Both packages are now bumped past that constraint.
- **Fix:** Removed the `overrides` block; did a full `node_modules` + `package-lock.json` wipe and fresh `npm install` (an incremental install would not have honored the removal, per 55-04's own documented finding about `overrides` and existing lockfiles); verified a single `react@19.2.7`/`react-dom@19.2.7` instance resolves tree-wide with zero `18.x` instances.
- **Files modified:** `package.json` (root), `package-lock.json`
- **Verification:** `npm ls react react-dom --all` shows every consumer "deduped" to `react@19.2.7`/`react-dom@19.2.7`; typecheck (ui/web/genui) clean; vitest web 464/464, genui 546/548 (matching pre-existing baseline); `web:build` exit 0; full E2E suite re-run showing the identical pre-existing 38-passed/8-failed/4-did-not-run signature as before the removal.
- **Committed in:** `70fd3b5`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking-issue cleanup explicitly mandated by this plan's own execution_rules).
**Impact on plan:** Both necessary for correctness/API-currency; the overrides removal was explicitly required by this plan's execution_rules, not scope creep.

## Issues Encountered

- Documentation tooling unavailable: no `mcp__context7__*` tools were present in this environment's toolset, and the `ctx7` CLI fallback was not installed (`command -v ctx7` returned not-found). Per the plan's own instruction to fetch the v9 migration guide fresh rather than trust a cached characterization, the fallback was reading the actually-installed `react-day-picker@9.14.0` package's own compiled `.d.ts`/`.js` source directly (`UI.js`'s enum, `DayPicker.js`'s render logic, `DayButton.js`/`Day.js`'s component source, `getClassNamesForModifiers.js`'s merge logic) — arguably a higher-confidence source than a migration guide since it's ground truth for the exact resolved version, not a version-agnostic doc.
- A first attempt at the day-highlighting visual-interaction proof produced a misleading result: reading `getComputedStyle().backgroundColor` immediately after `.click()` (no wait) captured a mid-`transition-colors` interpolated frame — an oklab color with alpha ~0.033 instead of the final opaque `bg-primary`. Diagnosed by comparing against a control plain-`bg-primary` Button on the same page (which showed the correct, non-interpolated color, ruling out a real color-mix/oklch regression) and by adding a 300ms wait past the default ~150ms transition duration, after which the selected day's background resolved to the exact expected `--primary` oklch value. Not a bug in `calendar.tsx` — a test-timing artifact in the verification script.
- The pre-existing sidebar pointer-events-interception bug (documented since 55-02, re-confirmed in 55-04) continues to cause 2 of 8 E2E failures (`token-render.spec.ts`'s `/knowledge` case, `uat-48-token-surfaces.spec.ts`'s 48.1 case); 2 more E2E failures (`live-loop-green.spec.ts`, `uat-39-tool-round.spec.ts`) require a locally-running FastAPI listener that was not started this session (see key-decisions — avoided to prevent colliding with the concurrent Python-only executor noted in this plan's execution_rules). Re-ran the full E2E suite twice this session (post-bumps, post-overrides-removal) and got the identical 38-passed/8-failed/4-did-not-run signature both times — confirmed non-regression, not re-investigated further (out of scope, neither failure touches Calendar or resizable-panels).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **STCK-02 is now fully satisfiable and marked complete.** All 8 `packages/ui` runtime dependencies RESEARCH identified as needing a React-19-compatible version bump are bumped (6 low-risk in 55-04: vaul, sonner, react-hook-form, next-themes, lucide-react, tailwind-merge; 2 high/medium-risk in this plan: react-day-picker, react-resizable-panels). Both API-surface-changing components (`Calendar`, the resizable dock) are revalidated with live interaction proof, not just typecheck. The tree runs a single, unified `react@19.2.7`/`react-dom@19.2.7` instance with zero override hacks needed.
- 55-06 (per the phase's plan list — STCK-03 Radix-vs-Base-UI decision doc + STCK-04 `@kibo-ui` registry-install proof) is unblocked: React 19 migration work (STCK-02) is fully closed out, leaving only the two doc/proof-of-concept requirements.
- The pre-existing sidebar pointer-events-interception bug (`deferred-items.md`, 3+ confirmed occurrences across 55-02/55-04/55-05) remains open and is a good candidate for a dedicated investigation phase, independent of this migration. The 2 live-DB-backed E2E specs needing a running FastAPI listener remain an operator-started prerequisite, not something any web-side plan should start itself.

---
*Phase: 55-platform-migration-tailwind-v4-react-19*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 7 files listed under Files Created/Modified (plus this SUMMARY.md itself and
deferred-items.md) confirmed present on disk. All 3 commit hashes (`7382925` Task 1,
`a40741f` Task 2, `70fd3b5` post-task overrides removal) confirmed present via
`git log --oneline --all`.
