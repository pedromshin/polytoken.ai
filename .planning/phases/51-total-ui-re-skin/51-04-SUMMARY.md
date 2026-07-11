---
phase: 51-total-ui-re-skin
plan: 04
subsystem: ui
tags: [tailwind, design-tokens, react, knowledge, glassmorphism]

# Dependency graph
requires:
  - phase: 48-token-system-extensions
    provides: "color.graph.* closed palette, color.tier.* ladder — the token surfaces this plan confirms (does not touch)"
  - phase: 28-design-uplift
    provides: "conversation-rail.tsx's backdrop-blur-md -> bg-background/95 precedent, the exact fix mirrored here"
provides:
  - "/knowledge chrome (graph-toolbar, filter-rail, node-detail-pane, taxonomy-banner) with zero glassmorphism-ban violations"
  - "graph-toolbar.tsx's layout-toggle on a lucide-react LayoutGrid icon instead of a raw ⊞ glyph"
  - "D-48-06 hover/active convention applied to graph-toolbar.tsx + filter-rail.tsx interactive controls"
  - "RSKN-03 complete; todo 2026-07-07-knowledge-preexisting-ui-debt.md closed"
affects: [51-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sr-only checkbox + peer/peer-focus-visible: when the native input is visually hidden (sr-only) but drives a custom visual indicator, route the focus-visible ring through peer-focus-visible on the visual element rather than trying to ring the invisible input or the whole label"
    - "Glassmorphism burn-down fix is always the same shape: bg-background/70 backdrop-blur-md -> bg-background/95, no other class changes (v1.4 conversation-rail.tsx precedent, repeated in Phase 51 across app-sidebar.tsx and now these 4 /knowledge files)"

key-files:
  created: []
  modified:
    - apps/web/src/app/knowledge/_components/graph-toolbar.tsx
    - apps/web/src/app/knowledge/_components/filter-rail.tsx
    - apps/web/src/app/knowledge/_components/node-detail-pane.tsx
    - apps/web/src/app/knowledge/_components/taxonomy-banner.tsx
    - .planning/todos/pending/2026-07-07-knowledge-preexisting-ui-debt.md (moved to .planning/todos/done/)

key-decisions:
  - "graph-toolbar.tsx's disabled layout-toggle button still received the full hover/active + focus-visible className override (harmless while disabled — disabled:pointer-events-none already suppresses the visual effect — but keeps the control consistent with its sibling if it's ever re-enabled, e.g. when a second layout algorithm ships)"
  - "Task 1 commit ended up including graph-toolbar.tsx's Button hover/active classNames alongside the glassmorphism/glyph fix (touched in the same file in the same edit pass) rather than deferring them to the Task 2 commit as the plan's task split implied; filter-rail.tsx's hover/active + the todo move landed in Task 2 as planned. No functional difference — both tasks' acceptance criteria are satisfied by the final state either way."
  - "Node-detail-pane.tsx's 'Knowledge Rule' badge (bg-primary/10 text-primary border-primary/30) was left untouched — it's on the primary token (not a raw palette violation) and isn't part of the tier/graph confidence-badge family the plan named for confirmation; no drift, no action needed"

patterns-established:
  - "Focus-visible ring on a peer-driven custom control (checkbox/radio built from sr-only input + styled sibling span) uses peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 on the visual sibling"

requirements-completed: [RSKN-03]

# Metrics
duration: 24min
completed: 2026-07-11
---

# Phase 51 Plan 04: /knowledge Glassmorphism Burn-down + Hover/Active Summary

**Cleared all four remaining glassmorphism-ban violations on `/knowledge` chrome, swapped the raw `⊞` glyph for a `lucide-react` `LayoutGrid` icon, applied the D-48-06 hover/active convention to the toolbar and filter-rail controls, confirmed tier/graph badges already sit on their TOKN-04/05 tokens, and closed the pre-existing UI-debt todo.**

## Performance

- **Started:** 2026-07-11T21:03:30Z
- **Completed:** 2026-07-11T21:08:47Z
- **Duration:** 5 min (wall-clock, this execution session)
- **Tasks:** 2 completed
- **Files modified:** 5 (graph-toolbar.tsx, filter-rail.tsx, node-detail-pane.tsx, taxonomy-banner.tsx, todo file moved)

## Accomplishments
- All four `bg-background/70 backdrop-blur-md` surfaces (`graph-toolbar.tsx:42`, `filter-rail.tsx:96`, `node-detail-pane.tsx:373`, `taxonomy-banner.tsx:46`) converted to solid `bg-background/95` — zero `backdrop-blur` remains anywhere in the four files, including stale JSDoc comments that referenced the old blur styling
- `graph-toolbar.tsx:73`'s raw `⊞` Unicode glyph replaced with a `lucide-react` `LayoutGrid` icon (`import { LayoutGrid, Maximize2 } from "lucide-react"`), sized `size-4` to match the adjacent zoom-to-fit icon
- D-48-06 neutral/ghost hover/active convention applied: `graph-toolbar.tsx`'s zoom-to-fit and layout-toggle buttons now carry an explicit `hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` override (the shared `Button` ghost variant already provides `hover:bg-accent`/`focus-visible:ring-1` with no offset — the override upgrades the focus ring to the app-wide `ring-2`/`ring-offset-1` standard via `tailwind-merge`); `filter-rail.tsx`'s six node-type checkbox rows get the same neutral-ghost hover treatment on the `<label>`, with the focus-visible ring routed through a `peer`/`peer-focus-visible` pair on the visual checkbox indicator (the native `<input>` is `sr-only`)
- Confirmed, not re-touched: `tier-filter-control.tsx` (pinned-state hover exception, unchanged), `tier-edge-style.ts` (token-only edge styling, unchanged), and `node-detail-pane.tsx`'s Instance/Component badges (`bg-graph-entity/10 ...`, `bg-graph-email-component/10 ...`) — all already on their `TOKN-04/05` `color.graph.*`/`color.tier.*` tokens, no drift found
- `edge-detail-popover.tsx` was not opened — outside this plan's `files_modified`, content order LOCKED per the UI-SPEC
- Todo `.planning/todos/pending/2026-07-07-knowledge-preexisting-ui-debt.md` moved to `.planning/todos/done/` with a resolution note pointing at this plan

## Task Commits

Each task was committed atomically:

1. **Task 1: Glassmorphism burn-down (4 files) + ⊞ → lucide LayoutGrid** - `76098c5` (feat)
2. **Task 2: Hover/active on toolbar+filter controls, confirm tier/graph badges, grep gate, close todo** - `3bca5ba` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `apps/web/src/app/knowledge/_components/graph-toolbar.tsx` - `bg-background/70 backdrop-blur-md` → `bg-background/95`; raw `⊞` → `LayoutGrid` icon; hover/active + focus-visible ring added to both toolbar buttons
- `apps/web/src/app/knowledge/_components/filter-rail.tsx` - `bg-background/70 backdrop-blur-md` → `bg-background/95`; checkbox row `<label>`s get neutral-ghost hover; visual checkbox indicator gets `peer-focus-visible` ring; stale "frosted" JSDoc wording updated
- `apps/web/src/app/knowledge/_components/node-detail-pane.tsx` - `bg-background/70 backdrop-blur-md` → `bg-background/95`; stale "frosted" JSDoc wording updated
- `apps/web/src/app/knowledge/_components/taxonomy-banner.tsx` - `bg-background/70 backdrop-blur-md` → `bg-background/95`; stale JSDoc `Style:` line updated to match
- `.planning/todos/pending/2026-07-07-knowledge-preexisting-ui-debt.md` → `.planning/todos/done/2026-07-07-knowledge-preexisting-ui-debt.md` - resolution note appended

## Decisions Made
- **Disabled layout-toggle button still got the hover/active className override.** It's currently `disabled` (dagre is the only layout), so `disabled:pointer-events-none` (baked into the shared `Button` primitive) suppresses any visible hover effect today — but adding the same recipe as its zoom-to-fit sibling keeps both toolbar buttons consistent and future-proofs the control if a second layout algorithm is ever added.
- **Task-1/Task-2 commit split absorbed graph-toolbar.tsx's hover/active edits into the Task 1 commit** rather than strictly deferring them to Task 2, since both changes landed in the same file in the same edit pass. `filter-rail.tsx`'s hover/active and the todo move stayed in the Task 2 commit as planned. Both commits' own acceptance criteria (grepped independently against the final working tree state) pass regardless of which commit a given hunk landed in — no functional or verification impact.
- **`node-detail-pane.tsx`'s "Knowledge Rule" badge (`bg-primary/10 text-primary border-primary/30`) left untouched.** It uses the registered `--primary` token (not a raw palette class) and isn't part of the tier/graph confidence-badge family the plan asked to confirm — no violation, no action needed, not called out as a stub or deferred item.
- **Doc-comment accuracy fix (Rule 1-adjacent, in-scope):** all three JSDoc headers that described the panels as "frosted" or explicitly cited the old `backdrop-blur-md` class were updated to match the new solid styling, since leaving stale documentation describing a class that no longer exists would mislead the next person touching these files (and the acceptance grep pattern would technically flag the doc-comment match too — the code fix alone wasn't sufficient for a clean `backdrop-blur` grep across the files).

## Deviations from Plan

None beyond the two Decisions-Made notes above (doc-comment accuracy touch-ups, both within the four `files_modified` files and directly caused by this plan's own edits — not out-of-scope work).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RSKN-03 requirements-completed; `/knowledge` chrome fully de-glassed, icon vocabulary compliant, hover/active convention applied.
- Todo `2026-07-07-knowledge-preexisting-ui-debt.md` closed — no remaining pre-existing `/knowledge` UI debt tracked.
- `edge-detail-popover.tsx` content order untouched, as LOCKED — 51-06 (owns `knowledge-graph.tsx`) and any downstream `/knowledge` work is unaffected by this plan's scope.
- Before-state screenshot baseline (`.planning/ui-reviews/2026-07-11T04-32-30-989Z/knowledge-{desktop,mobile}.png`) is unchanged by this plan; after-pixel validation is 51-07's job per the plan's `<verification>` block — no screenshot was captured in this execution.
- No blockers for sibling Wave-1 plans; this plan touched only files in its own `files_modified` list (`knowledge-graph.tsx` was never opened, per the D-49-07/51-06 file-ownership fence).

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 4 modified source files + the done/ todo file + this SUMMARY.md confirmed present on disk;
the pending todo file confirmed removed; both task commits (`76098c5`, `3bca5ba`) confirmed
present in `git log --oneline --all`.
