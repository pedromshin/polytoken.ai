---
phase: 51-total-ui-re-skin
plan: 02
subsystem: ui
tags: [tailwind, design-tokens, graph-palette, hover-active-convention, accessibility, email-detail]

# Dependency graph
requires:
  - phase: 48-token-system-extensions
    provides: "color.graph.* CLOSED palette (entity/email-component/email + -foreground pairs), color.tier.*, D-48-06 hover/active convention doc"
provides:
  - "Email-detail region/entity type-coding (violet=entity, amber=field/component, slate=unrelated) on the color.graph.* closed palette across all 7 owned files"
  - "confirm-deny-controls.tsx (the filled-semantic exemplar) on the exact bg-{alias} hover:{alias}/90 active:{alias}/80 text-{alias}-foreground recipe, both buttons"
  - "layers-tree-row.tsx's parallel inline confirm/deny controls + expand toggle brought onto the same recipe (found missing focus-visible entirely)"
affects: [51-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Role-coding Record<Role,string> maps (ROLE_BORDER/ROLE_SELECTED_RING/ROLE_HOVER/ROLE_CHIP/ACTIVE_CLASS) converted in place, preserving the existing per-file constant-table structure rather than restructuring"
    - "Filled solid-fill chips (bg-graph-entity text-white) -> bg-{alias} text-{alias}-foreground; light-tint badges (bg-violet-100 text-violet-800) -> bg-{alias}/10 text-{alias}, matching the pre-existing node-detail-pane.tsx/graph-nodes.tsx/filter-rail.tsx idiom from Phase 48's /knowledge canvas work"
    - "Dropped redundant dark:border-violet-900/40 / dark:bg-violet-950/20 variants when converting to graph-entity/graph-email-component (both tokens hold the IDENTICAL HSL value in light and dark globals.css blocks, so a single non-dark:-prefixed class already resolves correctly in both themes -- confirmed by grep on globals.css before dropping)"
key-files:
  modified:
    - apps/web/src/app/emails/[id]/_components/region-overlay-box.tsx
    - apps/web/src/app/emails/[id]/_components/extraction-summary-panel.tsx
    - apps/web/src/app/emails/[id]/_components/inspector-panel.tsx
    - apps/web/src/app/emails/[id]/_components/role-picker.tsx
    - apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx
    - apps/web/src/app/emails/[id]/_components/active-parent-banner.tsx
    - apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx

key-decisions:
  - "extraction-summary-panel.tsx's StatusDot 'candidate' tone (bg-amber-500) classified as region/component-type coding, not confidence-tier coding -> converted to bg-graph-email-component (not tier-inferred), per the plan's explicit conversion_map note that 'no confidence badges live in THIS file set -- email detail is region-type coding'"
  - "region-overlay-box.tsx's 'unrelated' role slate family converted to graph-email (not a bare neutral alias) -- the plan's own success-criteria truth statement names the 3-way mapping explicitly (violet->graph-entity, amber->graph-email-component, slate->graph-email), confirming 'unrelated' is the third rung of the SAME closed role-coding enum, not a structural neutral"
  - "Brought layers-tree-row.tsx's inline confirm/deny buttons and expand/collapse toggle onto the identical filled-semantic + focus-visible recipe applied to the confirm-deny-controls.tsx exemplar, even though Task 2's action text named confirm-deny-controls.tsx specifically -- same visual/interaction language (paired ✓/✗ circular buttons), and the file was already in Task 2's explicit file list with 'any interactive element in these 4 files missing it' language covering the gap"

patterns-established:
  - "When converting a role-coding constant table to graph.* aliases, opacity modifiers (/10, /20, /40, /50, /80, arbitrary [0.06]) re-attach directly to the alias exactly as they applied to the raw palette class -- Phase 48's base.ts comment confirms graph.* colors mirror the primary hsl(var(--x)) idiom so opacity modifiers resolve identically"

requirements-completed: [RSKN-02, RSKN-05]

# Metrics
duration: ~25min
completed: 2026-07-11
---

# Phase 51 Plan 02: Email-Detail Palette Burn-down Summary

**Converted the heaviest off-token cluster in the app (region-overlay-box.tsx's 17 violet/amber/slate role-coding occurrences plus 6 sibling files) onto the `color.graph.*` closed palette, and completed confirm-deny-controls.tsx's filled-semantic hover/active recipe as the phase's canonical exemplar.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-11T21:15:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 7 (all `apps/web/src/app/emails/[id]/_components/*`)

## Accomplishments

- `region-overlay-box.tsx`: all five role-coding constant tables (`ROLE_BORDER`,
  `ROLE_SELECTED_RING`, `ROLE_HOVER`, `ROLE_CHIP`) plus the active-parent glow
  ring and its describing comment converted from raw violet/amber/slate
  Tailwind classes to `graph-entity` / `graph-email-component` / `graph-email`
  (+ `-foreground` pairs on the filled label chip)
- `extraction-summary-panel.tsx`: the entity-section card wrapper (border+bg),
  its header border, and its heading text color converted to
  `graph-entity`/10/30 (matching the established `node-detail-pane.tsx` idiom);
  the candidate-status dot converted to `bg-graph-email-component`
- `inspector-panel.tsx`, `role-picker.tsx`, `layers-tree-row.tsx`: the three
  parallel role-chip constant tables converted to the same
  `bg-{alias}/10 text-{alias}` light-tint recipe
- `active-parent-banner.tsx`: violet banner tint converted to
  `bg-graph-entity/10`, doc comment updated to match
- `confirm-deny-controls.tsx` (phase exemplar): deny button's `text-white` ->
  `text-destructive-foreground`; both confirm/deny buttons now carry the
  **complete** filled-semantic recipe (`bg-{alias} hover:bg-{alias}/90
  active:bg-{alias}/80 text-{alias}-foreground`) plus a `focus-visible:ring-2
  focus-visible:ring-ring focus-visible:ring-offset-1` ring neither button had
  before
- `layers-tree-row.tsx`'s own inline confirm/deny buttons (a second,
  independent implementation of the same ✓/✗ pattern used inside the LAYERS
  tree) and its expand/collapse chevron toggle brought onto the identical
  recipe — all three were missing `focus-visible` entirely; the confirm/deny
  pair was also missing the `active:` step
- Zero palette classes and zero raw hex remain across all 7 owned files
  (verified via the plan's exact acceptance-criteria greps); `graph-*` alias
  usage confirmed present in `region-overlay-box.tsx`
- `token-contrast.test.ts` (6 tests) and `token-registration.test.ts` (4
  tests) both green
- `npx tsc --noEmit` clean for every file this plan touched (remaining
  repo-wide errors are 100% inside the pre-existing, out-of-scope
  `apps/web/src/app/dev/design/` scratch exclusion — confirmed via `grep -v
  "app/dev/design"` on the full tsc output returning zero lines)

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert region/entity type-coding — region-overlay-box (17x) + extraction-summary + inspector** - `3783a6c` (feat)
2. **Task 2: Convert remaining email-detail files + deny-button + hover/active + surface grep gate** - `6656735` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/emails/[id]/_components/region-overlay-box.tsx` — 5 role-coding constant tables + active-parent ring -> `graph.*`
- `apps/web/src/app/emails/[id]/_components/extraction-summary-panel.tsx` — entity-section wrapper/header/heading -> `graph-entity`; status dot -> `graph-email-component`
- `apps/web/src/app/emails/[id]/_components/inspector-panel.tsx` — `ROLE_CHIP` -> `graph.*`/10 recipe
- `apps/web/src/app/emails/[id]/_components/role-picker.tsx` — `ACTIVE_CLASS` -> `graph.*`/10 recipe
- `apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx` — `ROLE_CHIP` -> `graph.*`/10 recipe; confirm/deny buttons + expand toggle gain the filled-semantic/focus-visible recipe
- `apps/web/src/app/emails/[id]/_components/active-parent-banner.tsx` — violet tint -> `bg-graph-entity/10`
- `apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx` — deny `text-white` -> `text-destructive-foreground`; both buttons complete the filled-semantic recipe + focus-visible ring

## Decisions Made

See `key-decisions` in frontmatter — summarized: (1) classified
extraction-summary-panel's "candidate" status dot as region/component-type
coding (not confidence-tier), per the plan's own file-set note; (2) treated
"unrelated" role's slate coloring as the third leg of the closed
violet/amber/slate role enum (`graph-email`), not a bare structural neutral,
per the plan's success-criteria truth statement; (3) extended the
filled-semantic + focus-visible fix to `layers-tree-row.tsx`'s parallel
confirm/deny buttons and expand toggle, not just the named exemplar file,
since the same accessibility gap existed there and the file was already
in-scope for Task 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `layers-tree-row.tsx` confirm/deny buttons and expand/collapse toggle had zero focus-visible styling**
- **Found during:** Task 2 (enumerating every interactive element in the 4 named files before writing classes, per the read_first instruction)
- **Issue:** Three raw `<button>` elements (confirm ✓, deny ✗, and the entity-row expand/collapse chevron) had no `focus-visible:` classes at all — a real keyboard-accessibility gap, and the confirm/deny pair also lacked the `active:` step of the filled-semantic recipe that the plan mandated verbatim for the sibling `confirm-deny-controls.tsx` exemplar
- **Fix:** Added `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` to all three; added `active:bg-success/80` / `active:bg-destructive/80` to the confirm/deny pair; converted the deny button's `text-white` to `text-destructive-foreground` in the same pass (same bug the exemplar had)
- **Files modified:** `apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx`
- **Verification:** `npx tsc --noEmit` clean for this file; surface-wide grep confirms zero `text-white`/palette classes remain
- **Committed in:** `6656735` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — accessibility gap found while classifying elements per the plan's own read-first instruction, not scope creep)
**Impact on plan:** Strict quality improvement within a file the plan already scoped for Task 2; no new files touched, no architectural changes, no shared-primitive edits.

## Issues Encountered

- `cd apps/web && npx tsc --noEmit` does not exit 0 in isolation, but every
  error lives in the untracked `apps/web/src/app/dev/design/` scratch page
  (pre-rename `@nauta/ui` imports) — the same pre-existing, out-of-scope
  breakage already documented in `deferred-items.md` by 51-01. Confirmed via
  `grep -v "app/dev/design"` returning zero lines; not touched (out of scope,
  not caused by this plan).
- No region/entity kind lacked a `graph.*` alias to land on — the closed
  3-color palette (entity/field/unrelated -> violet/amber/slate) mapped
  cleanly onto `graph-entity`/`graph-email-component`/`graph-email` for every
  occurrence in all 7 files. No new deferred items to log.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Email-detail canvas (region overlay, layers tree, inspector panel,
  role/entity-type pickers, confirm/deny controls, active-parent banner) is
  fully on the `color.graph.*` closed palette and the D-48-06 filled-semantic
  recipe; no file this plan touched overlaps any other 51-0X plan's
  `files_modified`
- `51-07`'s Wave-2 screenshot re-capture can diff against
  `.planning/ui-reviews/2026-07-11T04-32-30-989Z/emails-{desktop,mobile}.png`
  as this plan's literal before-state
- `contrast`/`registration` regression gates and `tsc --noEmit` (scoped to
  this plan's files) both green — no blockers for downstream plans

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 7 claimed modified files found on disk; both task commit hashes
(`3783a6c`, `6656735`) confirmed present in `git log --oneline --all`.
