---
phase: 52-editable-genui-panels-studio-on-canvas
plan: 02
subsystem: ui
tags: [react, radix-select, zustand, genui, canvas, theming, style-packs, tdd]

# Dependency graph
requires:
  - phase: 52-01
    provides: panel-overlay.ts (resolveActivePanel/setPack/PanelOverlay), panel-overlay-context.tsx (usePanelOverlay/CanvasPersistenceProvider/PanelActionControlProps/PanelActionId), panel-theme-scope.tsx (PanelThemeScope)
provides:
  - PanelActionsToolbar — the h-8 toolbar row (role="toolbar") composing the pack-switcher + 4 action controls, owning the per-panel mutual-exclusion lock + generating signal
  - PackSwitcher — PANL-01 delivered end-to-end: optimistic apply, persists via writeOverlay/scheduleSave, reverts + toasts on failure, rehydrates on reload
  - 4 interface-first skeleton controls (EditParamsControl/RegenerateControl/RethemeControl/VersionHistoryControl) implementing the full PanelActionControlProps contract, inert until Plans 52-03/52-04/52-06 implement them
  - GenuiPanelNode extended: overlay-resolved active spec/pack (resolveActivePanel), PanelThemeScope wrap on the genui_spec branch, GeneratingRing shell, min-h-[272px]
affects: [52-03-parameter-editor, 52-04-regenerate-history, 52-06-nl-retheme-client, panel-toolbar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interface-first skeleton pattern for toolbar action controls — full PanelActionControlProps implemented but inert (disabled), so downstream plans consume a stable prop contract without ever touching the toolbar or panel node"
    - "Persist-failure test seam: writeOverlay/scheduleSave are fire-and-forget in production (no promise to await); tests inject a synchronously-throwing scheduleSave to exercise the revert-on-error + toast path deterministically"
    - "Radix Select in jsdom needs only a scrollIntoView no-op polyfill — ResizeObserver is unused on the position=popper path with no Arrow subcomponent, confirmed against the installed @radix-ui/react-popper + @floating-ui/dom sources rather than assumed"

key-files:
  created:
    - apps/web/src/app/chat/_canvas/panel-actions-toolbar.tsx
    - apps/web/src/app/chat/_canvas/controls/pack-switcher.tsx
    - apps/web/src/app/chat/_canvas/controls/edit-params-control.tsx
    - apps/web/src/app/chat/_canvas/controls/regenerate-control.tsx
    - apps/web/src/app/chat/_canvas/controls/retheme-control.tsx
    - apps/web/src/app/chat/_canvas/controls/version-history-control.tsx
    - apps/web/src/app/chat/_canvas/controls/panel-action-button-class.ts
    - apps/web/src/app/chat/_canvas/__tests__/pack-switcher.test.tsx
    - apps/web/src/app/chat/_canvas/__tests__/genui-panel-node-toolbar.test.tsx
  modified:
    - apps/web/src/app/chat/_canvas/genui-panel-node.tsx

key-decisions:
  - "PackSwitcher shipped as an inert Task 1 stub (disabled Select bound to resolvedPackId), then TDD-replaced in Task 2 — pack-switcher.tsx is not in Task 1's own explicit create-list, but the toolbar's left slot references it, so a stub was required first for the toolbar to compile (Rule 3: missing referenced file); RED then genuinely failed against real (if inert) behavior, not just an import error"
  - "PANEL_ACTION_ICON_BUTTON_CLASS extracted to its own module (controls/panel-action-button-class.ts, not in the plan's file list) to avoid a toolbar<->controls circular import — the toolbar imports the 4 controls, and the controls needed the shared class"
  - "PanelThemeScope wraps only the genui_spec branch's rendered content, not the interactive_widget branch — mirrors this same file's own pre-existing BIND-01 scoping precedent (useDataBindings is also genui_spec-only) rather than reinterpreting 'wrap the ScrollArea body' as covering both branches"
  - "Toolbar forwards onGeneratingChange straight through (no redundant internal useState mirror) — the plan's literal 'own const [generating, setGenerating]' would have created an unread local; simplified since nothing in the toolbar body reads it"
  - "GeneratingRing wrapper given full flex layout classes (flex min-h-0 w-full flex-1 flex-col rounded-lg), not just the plan's literal 'rounded-lg' — GenuiPanelNodeBody's Fragment children (drag-handle/toolbar/ScrollArea) became a layout level deeper once wrapped, and a bare rounded-lg would have broken the ScrollArea's flex-1 sizing (Rule 1 auto-fix, verified against generation-sandbox-island.tsx's identical GeneratingRing usage precedent)"

patterns-established:
  - "Pattern: shared per-control prop contract (PanelActionControlProps) + a Record<ActionId, ComponentType> lookup in the toolbar — adding a 5th action later means one map entry, never a switch statement"
  - "Pattern: overlay-resolved rendering (resolveActivePanel) as the ONE spec/pack source every panel-body branch reads, feeding both the renderer (specJson) and the theming boundary (packId/tokenOverrides) from the same resolution call"

requirements-completed: [PANL-01]

# Metrics
duration: ~28min
completed: 2026-07-11
---

# Phase 52 Plan 02: Panel Toolbar Chrome + Pack Switch End-to-End Summary

**PanelActionsToolbar (role="toolbar" row, mutual-exclusion lock) mounted into GenuiPanelNode, with PackSwitcher delivering PANL-01 end-to-end (optimistic apply → persist → revert-on-error/toast → rehydrate-on-reload) and 4 interface-first skeleton controls (edit/regenerate/re-theme/history) ready for Plans 52-03/52-04/52-06.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-07-11T22:00:00-03:00 (approx, first context read)
- **Completed:** 2026-07-11T22:28:10-03:00
- **Tasks:** 3 completed
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments
- `PanelActionsToolbar` — the `h-8` `role="toolbar"` row (52-UI-SPEC Component 1) mounted between `GenuiPanelNode`'s existing `h-9` drag-handle row and its `ScrollArea` body, owning the per-panel mutual-exclusion lock (`busyAction`) every control shares via `PanelActionControlProps.isLocked`/`onBusyChange`, plus `isStreaming` force-locking and the `onGeneratingChange` signal forwarded to the panel shell's `GeneratingRing`
- `PackSwitcher` — PANL-01 delivered end-to-end: `onValueChange` optimistically updates the visible Select value AND writes `setPack(overlay, id)` through `usePanelOverlay`'s `writeOverlay` (persists via the canvas's existing `scheduleSave` debounce); a persist failure (modeled via an injectable throwing `scheduleSave`) reverts the value and fires `toast.error("Couldn't switch style — try again.", { action: { label: "Retry", onClick } })`; disabled + `aria-busy` while locked or pending
- 4 interface-first skeleton controls (`EditParamsControl`/`RegenerateControl`/`RethemeControl`/`VersionHistoryControl`) — each implements the full `PanelActionControlProps` contract, renders the correct lucide icon + exact UI-SPEC tooltip copy + matching `aria-label`, inert (`disabled`) until Plans 52-03/52-04/52-06 implement them
- `GenuiPanelNode` extended: `resolveActivePanel(overlay, specJson, isStreaming)` feeds the genui_spec branch's ACTUAL rendered content (an active version's spec if any, else the base spec — streaming always forces the base spec verbatim); that content is wrapped in `PanelThemeScope(packId, tokenOverrides)` so a panel now themes by its resolved pack; outer shell grew `min-h-[240px]` → `min-h-[272px]` and wraps its content in `<GeneratingRing>`
- Proved rehydration end-to-end: a canvas store seeded with `shared.panelOverlays.{panelId}.stylePackId = "playful-rounded"` renders the panel with `--primary: 262 83% 58%` inline on first mount — no user interaction needed, confirming PANL-01's "the pack choice rehydrates on reload" truth

## Task Commits

Each task was committed atomically (Task 2 is TDD — RED then GREEN):

1. **Task 1: Toolbar shell + control-prop contract + four interface-first control skeletons**
   - `9fa8c28` feat: panel toolbar shell + control-prop contract + skeleton controls
2. **Task 2: PackSwitcher — PANL-01 optimistic apply / revert-on-error / persist (TDD)**
   - `006b843` test: add failing test for PackSwitcher optimistic apply/revert (RED)
   - `5dfdd94` feat: implement PackSwitcher optimistic apply/revert/persist (GREEN)
3. **Task 3: Mount toolbar + theme wrap + overlay-resolved spec in GenuiPanelNode**
   - `e9afcf7` feat: mount toolbar + overlay-resolved spec + theme scope in GenuiPanelNode

**Plan metadata:** (this commit) docs: complete plan

_Task 2's RED test genuinely failed against Task 1's inert PackSwitcher stub (2/4 assertions), not just a missing import — see Deviations below for why the stub existed first._

## Files Created/Modified
- `apps/web/src/app/chat/_canvas/panel-actions-toolbar.tsx` - `PanelActionsToolbar`: `role="toolbar"` row, mutual-exclusion lock, generating-signal forwarding
- `apps/web/src/app/chat/_canvas/controls/pack-switcher.tsx` - `PackSwitcher`: PANL-01 optimistic apply/revert/persist Select
- `apps/web/src/app/chat/_canvas/controls/edit-params-control.tsx` - `EditParamsControl` interface-first skeleton (PANL-02)
- `apps/web/src/app/chat/_canvas/controls/regenerate-control.tsx` - `RegenerateControl` interface-first skeleton (PANL-03)
- `apps/web/src/app/chat/_canvas/controls/retheme-control.tsx` - `RethemeControl` interface-first skeleton (PANL-04)
- `apps/web/src/app/chat/_canvas/controls/version-history-control.tsx` - `VersionHistoryControl` interface-first skeleton (PANL-03)
- `apps/web/src/app/chat/_canvas/controls/panel-action-button-class.ts` - shared `PANEL_ACTION_ICON_BUTTON_CLASS` constant (deviation, see below)
- `apps/web/src/app/chat/_canvas/__tests__/pack-switcher.test.tsx` - 4 tests: resolved-value display, optimistic write+persist, revert-on-failure+toast, isLocked disabling
- `apps/web/src/app/chat/_canvas/__tests__/genui-panel-node-toolbar.test.tsx` - 3 tests: toolbar renders for genui_spec, no toolbar for interactive_widget, rehydrated pack themes the panel
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` - overlay resolution, toolbar mount, theme scope wrap, `min-h-[272px]`, `GeneratingRing` shell, explicit `React` import fix

## Decisions Made
See `key-decisions` in frontmatter above (PackSwitcher stub-then-TDD sequencing, the extracted shared icon-button-class module, PanelThemeScope's genui_spec-only scope, dropping the toolbar's redundant internal `generating` mirror, and the corrected `GeneratingRing` wrapper flex classes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PackSwitcher needed a stub before Task 1's own typecheck could pass**
- **Found during:** Task 1
- **Issue:** Task 1's action text composes `<PackSwitcher {...} />` into the toolbar, but `pack-switcher.tsx` is not in Task 1's own explicit "create controls/X, Y, Z" sentence — it's Task 2's TDD target. Without it, Task 1's own `npm run typecheck` verification would fail on a missing module.
- **Fix:** Created `controls/pack-switcher.tsx` as an inert, disabled Select stub in Task 1 (typechecks, mounts, does nothing on selection); Task 2's TDD RED test then failed genuinely (2/4 assertions) against that stub's real-but-wrong behavior, and GREEN replaced the body with the actual optimistic-apply/revert/persist logic.
- **Files modified:** apps/web/src/app/chat/_canvas/controls/pack-switcher.tsx
- **Verification:** Task 1's typecheck passed with the stub in place; Task 2's RED genuinely failed then GREEN passed 4/4.
- **Committed in:** `9fa8c28` (Task 1 stub), `006b843`/`5dfdd94` (Task 2 RED/GREEN)

**2. [Rule 3 - Blocking] Toolbar/controls circular import avoided via a new shared module**
- **Found during:** Task 1
- **Issue:** The plan's "shared icon-button class (all 4 action buttons)" has no home in the plan's own file list; putting it in `panel-actions-toolbar.tsx` would force each control to import FROM the toolbar, while the toolbar imports the controls — a circular dependency.
- **Fix:** Extracted `PANEL_ACTION_ICON_BUTTON_CLASS` to a new file, `controls/panel-action-button-class.ts`, imported one-way by all 4 controls.
- **Files modified:** apps/web/src/app/chat/_canvas/controls/panel-action-button-class.ts (new), the 4 control files
- **Verification:** `npm run typecheck -w @polytoken/web` clean.
- **Committed in:** `9fa8c28`

**3. [Rule 1 - Bug] `import * as React from "react"` missing for direct-mount tests**
- **Found during:** Task 3 (writing `genui-panel-node-toolbar.test.tsx`)
- **Issue:** `genui-panel-node.tsx` only imported `{ memo, useState }` from `"react"`. Mounting `GenuiPanelNode` directly via `createRoot` in vitest's classic-JSX-runtime transform threw `ReferenceError: React is not defined` — the exact same documented gotcha already fixed in `canvas-store-context.tsx` and `panel-overlay-context.tsx` (Next.js's SWC automatic runtime hides this; vitest's esbuild classic runtime does not).
- **Fix:** Added `import * as React from "react";` alongside the existing named imports, with the same explanatory comment convention those two files already use.
- **Files modified:** apps/web/src/app/chat/_canvas/genui-panel-node.tsx
- **Verification:** All 3 `genui-panel-node-toolbar.test.tsx` tests pass; full `_canvas` regression suite (19 files / 166 tests) stays green.
- **Committed in:** `e9afcf7`

**4. [Rule 1 - Bug] `GeneratingRing` wrapper needed full flex layout classes, not just `rounded-lg`**
- **Found during:** Task 3
- **Issue:** The plan's literal instruction ("wrap ... in `<GeneratingRing active={generating} className="rounded-lg">`") would insert `GeneratingRing`'s plain wrapper `<div>` between the outer shell (`flex flex-col`) and `GenuiPanelNodeBody`'s Fragment children (drag-handle/toolbar/`ScrollArea`) — those children need a `flex flex-col` ancestor to lay out correctly, and a bare `rounded-lg` div would collapse `ScrollArea`'s `flex-1` sizing.
- **Fix:** Used `className="flex min-h-0 w-full flex-1 flex-col rounded-lg"`, mirroring `generation-sandbox-island.tsx`'s identical `GeneratingRing` usage (`"flex flex-1 min-h-0 flex-col rounded-lg"`) — the established precedent for this exact composition.
- **Files modified:** apps/web/src/app/chat/_canvas/genui-panel-node.tsx
- **Verification:** `genui-panel-node-toolbar.test.tsx`'s toolbar-and-theming assertions pass with the node's normal flex layout intact; no visual-regression tooling available this session (Docker down) so this is a code-level fix, not screenshot-verified — flagged for `.planning/MORNING-CHECKLIST.md` §G alongside this plan's other deferred live-canvas confirmation.
- **Committed in:** `e9afcf7`

---

**Total deviations:** 4 auto-fixed (2 blocking/Rule 3, 2 bug/Rule 1)
**Impact on plan:** All four were necessary for the plan's own tasks to compile, pass their own TDD gates, or render correctly — no scope creep. None change the plan's must-haves, artifacts, or key-links.

## Issues Encountered
- Verified (before writing the real test) that Radix Select's item-mounting model works with `.click()` alone in jsdom: `pointerTypeRef.current` defaults to `"touch"`, so both the trigger's open handler and each item's select handler fire on a plain synthetic click (no `PointerEvent`/`hasPointerCapture` needed). The only jsdom gap that matters is `scrollIntoView` (Select's open/highlight effects call it unconditionally) — polyfilled as a no-op in both new test files. `ResizeObserver` was checked and confirmed NOT needed (no `Arrow` subcomponent rendered; `@floating-ui/dom`'s `autoUpdate` guards its resize-tracking behind `typeof ResizeObserver === "function"`).
- Confirmed Radix Select shows the correct label on FIRST render without ever opening the dropdown: even while closed, `SelectItem`/`SelectItemText` mount into a hidden `DocumentFragment`-backed portal (not `document.body`), and the selected item's text is portaled into the trigger's `SelectValue` node regardless of open state — this is why `pack-switcher.test.tsx`'s Test 1 needs no `openSelect()` call.
- `npm run typecheck -w @polytoken/web` reports pre-existing errors confined entirely to `src/app/dev/design/**` (untracked scratch content, already carved out by `tsconfig.json`'s own `exclude` entry and 52-01-SUMMARY.md's identical precedent note) — confirmed via `grep -v "app/dev/design"` that zero errors originate outside that known exclusion.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 52-03 (Parameter Editor / Regenerate+History) and 52-06 (NL Re-theme client) can now implement `EditParamsControl`/`RegenerateControl`/`VersionHistoryControl`/`RethemeControl` directly against the stable `PanelActionControlProps` contract without touching `panel-actions-toolbar.tsx` or `genui-panel-node.tsx` again.
- REQUIREMENTS.md's PANL-01 was already marked Complete by 52-01's frontmatter (data-layer half); this plan confirms the record is now genuinely accurate end-to-end — the user-visible switcher exists, applies immediately, persists, reverts on failure, and rehydrates on reload. No correction needed.
- Live-canvas visual confirmation of the toolbar + pack switch on a real panel (screenshot-diffed against the Phase-51 baseline) remains DEFERRED to `.planning/MORNING-CHECKLIST.md` §G per 52-CONTEXT.md's environment-constrained posture (Docker/WSL down this session) — this plan shipped real UI chrome (unlike 52-01), so that live check now has something concrete to confirm, including deviation #4's flex-layout fix.
- No blockers.

---
*Phase: 52-editable-genui-panels-studio-on-canvas*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 10 files created/modified confirmed present on disk (plus this SUMMARY.md); all 4 task
commit hashes (`9fa8c28`, `006b843`, `5dfdd94`, `e9afcf7`) confirmed present in `git log`.
