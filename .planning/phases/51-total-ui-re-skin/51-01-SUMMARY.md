---
phase: 51-total-ui-re-skin
plan: 01
subsystem: ui
tags: [tailwind, design-tokens, hover-active-convention, accessibility, chat, sidebar]

# Dependency graph
requires:
  - phase: 48-token-system-extensions
    provides: "radius.pill / color.success / color.tier.* / color.graph.* token aliases, D-48-06 hover/active convention doc"
provides:
  - "D-48-06 hover/active + focus-visible convention applied across /chat interactive surfaces (composer, tool-round rows, turn actions, conversation rail rows, jump-to-bottom, canvas view toggle)"
  - "Global app-sidebar glassmorphism ban cleared (bg-background/70 backdrop-blur-md -> bg-background/95, last remaining violation per 51-UI-SPEC.md burn-down table)"
  - "Citation-chip overflow indicator migrated to the rounded-pill radius token"
affects: [51-02, 51-03, 51-04, 51-05, 51-06, 51-07, 51-total-ui-re-skin-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-48-06 two-family hover/active classification (neutral/ghost -> hover:bg-accent; filled-semantic -> hover:bg-{alias}/90) applied via className override at the call site rather than editing shared @polytoken/ui primitives (Button/Tabs/Sidebar), preserving Registry Safety for surfaces this plan doesn't own"
    - "twMerge-based className override: explicit hover:/focus-visible: classes passed through cn()/className props reliably beat a shared primitive's baked-in defaults because twMerge dedupes same-group+same-variant utilities, keeping only the last one in the merged string"

key-files:
  created:
    - .planning/phases/51-total-ui-re-skin/deferred-items.md
  modified:
    - apps/web/src/app/chat/_components/composer.tsx
    - apps/web/src/app/chat/_components/tool-round-activity-row.tsx
    - apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
    - apps/web/src/app/chat/_components/turn-action-row.tsx
    - apps/web/src/app/chat/_components/conversation-row.tsx
    - apps/web/src/app/chat/_components/jump-to-bottom-button.tsx
    - apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx
    - apps/web/src/components/app-sidebar.tsx

key-decisions:
  - "Did not edit shared @polytoken/ui primitives (button.tsx, tabs.tsx, sidebar.tsx, sonner.tsx) even though several fall short of the D-48-06 recipe (Button's focus-visible:ring-1 has no offset; SidebarMenuButton's focus ring resolves to --sidebar-ring which aliases --primary, not the neutral --ring the UI-SPEC's Color contract mandates) -- fixed via className overrides at each of this plan's call sites instead, consistent with Registry Safety (no shared-primitive changes without a vetting gate this phase)"
  - "tool-round-activity-row.tsx (a role=status, non-clickable div) got literal hover:/focus-visible: classes per the plan's explicit classification and acceptance-criteria grep, even though the element itself is never focusable -- the focus-visible rule is inert (never triggers) but the hover rule is a real, if debatable, mouse-hover highlight on a non-interactive status line; documented here rather than silently deviating from a binding acceptance criterion"
  - "jump-to-bottom-button.tsx keeps its bg-secondary resting fill (not switched to bg-muted/bg-background) since Secondary and Muted are both members of this app's 30%-tonal-band and changing the visible resting color of an already-shipped floating affordance was judged riskier than the plan intended for a hover/focus-only refinement pass -- only the hover destination (now bg-accent) and focus-visible ring were brought onto the D-48-06 recipe"

patterns-established:
  - "Non-owning-file interactive-state fix: when a shared design-system primitive under-delivers the binding convention, override at the specific call site owned by the current plan rather than touching the primitive (avoids unreviewed collateral drift across every other consumer of that primitive)"

requirements-completed: [RSKN-01]

# Metrics
duration: ~20min
completed: 2026-07-11
---

# Phase 51 Plan 01: Chat + Global Chrome Re-skin Summary

**Applied the D-48-06 hover/active + focus-visible convention across every /chat interactive surface and cleared the app-sidebar's last glassmorphism-ban violation, with zero raw hex/palette classes remaining in any touched file.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-11T20:26:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 8 (7 chat surfaces + app-sidebar.tsx); 1 file created (deferred-items.md)

## Accomplishments

- Composer's Send/Stop CTA now carries the filled-semantic recipe explicitly
  (`hover:bg-primary/90` / `hover:bg-secondary/80` while streaming +
  `focus-visible:ring-2 ring-ring ring-offset-1`)
- Tool-round activity row, jump-to-bottom button, and the chat/canvas view
  toggle's inactive segments now move to the `bg-accent` neutral-ghost hover
  surface per D-48-06
- Fixed a genuine accessibility gap: `TurnActionRow`'s copy/regenerate icon
  buttons had **no focus-visible ring at all** (Rule 2 — missing critical
  functionality) and hovered to the wrong surface (`bg-muted` instead of the
  accent pair) — both fixed
- `ConversationRow`: inactive rows now hover to the accent surface (was
  `bg-muted`); the active/selected row explicitly reasserts its primary tint
  on hover per the documented pinned-state exception; the row's clickable
  title button and the overflow-menu trigger both gained focus-visible rings
  they were missing
- Citation-chip overflow `+N` indicator migrated from `rounded-md` to
  `rounded-pill`, matching `ProvenanceLink`'s `CHIP_CLASS_NAME` pill recipe
  (the `radius.pill` target named in 51-UI-SPEC.md)
- App-sidebar's last glassmorphism-ban violation cleared:
  `bg-background/70 backdrop-blur-md` → `bg-background/95` (solid, no blur —
  the v1.4 conversation-rail precedent). Zero glassmorphism exceptions remain
  in the app.
- Sidebar nav items and the theme-toggle button brought onto the same
  hover/focus-visible recipe (inactive items: `hover:bg-accent` +
  `focus-visible:ring-ring`; active item: reasserts its primary tint on hover)
- `layout.tsx`'s `<Toaster />` register-confirmed clean — already fully
  token-driven (`bg-background`/`text-foreground`/`bg-primary`/`bg-muted`),
  no edit needed, not touched (Registry Safety: no un-vetted shared-primitive
  changes)
- Copy register confirmed unchanged: `chat-home-empty-state.tsx` still reads
  "Ask me anything", `canvas-empty-state.tsx` still reads "Panels will appear
  here" — no infrastructure-vocabulary stragglers found in any touched file
- `message-list.tsx`, `message-turn.tsx`, `chat-node.tsx`,
  `genui-panel-node.tsx`, `save-status-indicator.tsx` reviewed in full — all
  already token-clean with no interactive elements missing D-48-06 states, so
  left untouched (no spurious diffs)

## Task Commits

Each task was committed atomically:

1. **Task 1: Chat interactive surfaces — hover/active + citation-chip + copy register pass** - `d3408bb` (feat)
2. **Task 2: Global chrome — sidebar de-glass + hover/active + Toaster/layout register** - `22f67c9` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/chat/_components/composer.tsx` — explicit hover/focus-visible on the Send/Stop CTA (filled-semantic family)
- `apps/web/src/app/chat/_components/tool-round-activity-row.tsx` — neutral-ghost hover/focus-visible on the status row
- `apps/web/src/app/chat/_components/tool-invocation-result-row.tsx` — overflow chip `rounded-md` → `rounded-pill`
- `apps/web/src/app/chat/_components/turn-action-row.tsx` — added missing focus-visible rings; fixed hover target on copy/regenerate buttons
- `apps/web/src/app/chat/_components/conversation-row.tsx` — hover target fix + pinned-state hover reassert + missing focus-visible rings
- `apps/web/src/app/chat/_components/jump-to-bottom-button.tsx` — hover target + focus-visible ring
- `apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx` — neutral-ghost hover on inactive tab segments
- `apps/web/src/components/app-sidebar.tsx` — glassmorphism fix + nav/theme-toggle hover-focus recipe
- `.planning/phases/51-total-ui-re-skin/deferred-items.md` — documents the pre-existing, out-of-scope `dev/design` typecheck breakage (created, not part of the app surface)

## Decisions Made

See `key-decisions` in frontmatter — summarized: (1) fixed shared-primitive
shortfalls via call-site className overrides rather than editing
`@polytoken/ui` primitives directly (Registry Safety); (2) honored the plan's
literal acceptance-criteria grep for `tool-round-activity-row.tsx` even though
the element is non-focusable, documenting the tension rather than silently
dropping the requirement; (3) kept `jump-to-bottom-button.tsx`'s existing
`bg-secondary` resting fill, only correcting its hover/focus-visible targets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `TurnActionRow` copy/regenerate buttons had no focus-visible ring**
- **Found during:** Task 1 (reading every interactive element in the named files before writing classes)
- **Issue:** Both icon-only `<button>` elements (`Copy`/`Check` and `RefreshCw`) had zero focus-visible styling — a real keyboard-accessibility gap on always-visible (never hover-only) controls, and their hover target (`hover:bg-muted hover:text-foreground`) didn't match the D-48-06 neutral/ghost recipe (`hover:bg-accent hover:text-accent-foreground`)
- **Fix:** Added `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`, corrected hover target to `bg-accent`/`text-accent-foreground`, upgraded `rounded` (Tailwind's unthemed default) to `rounded-md` (this app's token-driven radius scale) on both buttons
- **Files modified:** `apps/web/src/app/chat/_components/turn-action-row.tsx`
- **Verification:** `npx tsc --noEmit` clean for this file; visual class classification confirmed against `hover-active-convention.md`'s neutral/ghost row
- **Committed in:** `d3408bb` (Task 1 commit)

**2. [Rule 2 - Missing Critical] `ConversationRow`'s clickable title button had no focus-visible ring**
- **Found during:** Task 1
- **Issue:** The inner `<button type="button">` that selects a conversation (keyboard-focusable, since it has no `tabIndex={-1}`) rendered with zero focus-visible styling
- **Fix:** Added `rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`
- **Files modified:** `apps/web/src/app/chat/_components/conversation-row.tsx`
- **Verification:** `npx tsc --noEmit` clean; grep-confirmed no palette classes introduced
- **Committed in:** `d3408bb` (Task 1 commit)

**3. [Rule 1 - Bug] Sidebar focus ring resolved to the brand-primary color instead of the neutral `--ring` token**
- **Found during:** Task 2 (tracing `SidebarMenuButton`'s baked-in `ring-sidebar-ring`, which `globals.css` aliases to `--primary`, against 51-UI-SPEC.md's Color contract: "Focus ring — `--ring`... a separate neutral token, not `--primary`... never dropped or reinterpreted by this phase")
- **Issue:** The shared `SidebarMenuButton` primitive's base class string sets its focus ring color from `--sidebar-ring` (= `--primary`), conflicting with the binding UI-SPEC rule that every interactive element's focus-visible ring must use the neutral `--ring` token
- **Fix:** Added an explicit `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` override in `app-sidebar.tsx`'s per-nav-item `className` (both active and inactive branches) — the `focus-visible:`-scoped utility beats the primitive's unscoped `ring-sidebar-ring` via CSS specificity, and twMerge keeps only one width utility per variant group, so the override is deterministic, not a visual toggle race
- **Files modified:** `apps/web/src/components/app-sidebar.tsx`
- **Verification:** Confirmed via `globals.css` grep that `--sidebar-ring: var(--primary)` — a real mismatch, not a misreading; did NOT edit `sidebar.tsx` itself (shared primitive, other consumers untouched, Registry Safety)
- **Committed in:** `22f67c9` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1/2 — accessibility/correctness gaps found while classifying elements per the plan's own read-first instruction, not scope creep)
**Impact on plan:** All three are strict quality improvements within the exact files the plan already scoped; no new files touched, no architectural changes, no shared-primitive edits.

## Issues Encountered

- `.planning/STATE.md` and `.planning/HANDOFF.json` were observed changing mid-session (a sibling Phase-51 wave-1 plan executing in parallel per this project's `parallelization.enabled: true` config) — deliberately did not stage or touch either file in either task commit to avoid clobbering concurrent writes; STATE.md is updated fresh, read-then-write, only in this plan's own final state-update step below.
- `cd apps/web && npx tsc --noEmit` does not exit 0 in isolation — but every one of its 52 errors lives in `apps/web/src/app/dev/design/` (untracked, user-owned scratch per `51-UI-SPEC.md`'s own exclusion list and `.claude/skills/polytoken-design-system/SKILL.md`), importing the pre-rename `@nauta/ui` package name. Confirmed via `grep -v "app/dev/design"` on the full tsc output returning zero lines — no error exists in any file this plan touched or anywhere else in the shipped app. Logged to `.planning/phases/51-total-ui-re-skin/deferred-items.md` per the executor's scope-boundary rule rather than fixed (out of scope, pre-existing, not caused by this plan).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `/chat` and global chrome now speak the D-48-06 convention; `51-02` through
  `51-07` (thread inbox, `/knowledge`, `/studio`, settings/login, `/entities`
  badges, and the Wave-2 full re-capture) are unaffected by this plan's file
  boundaries (zero overlap — verified no file this plan touched appears in
  any other 51-0X plan's `files_modified`)
- The Wave-2 screenshot re-capture (51-07) can diff against
  `.planning/ui-reviews/2026-07-11T04-32-30-989Z/{chat,login}-{desktop,mobile}.png`
  as this plan's literal before-state
- Blocker for a fully-green aggregate `tsc --noEmit`: the pre-existing
  `apps/web/src/app/dev/design/` scratch-page import breakage (not this
  plan's to fix — see Issues Encountered / deferred-items.md)

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 10 claimed files found on disk (8 modified surfaces + deferred-items.md +
this SUMMARY); both task commit hashes (`d3408bb`, `22f67c9`) confirmed present
in `git log --oneline --all`.
