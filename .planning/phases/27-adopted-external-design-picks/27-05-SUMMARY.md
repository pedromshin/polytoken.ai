---
phase: 27-adopted-external-design-picks
plan: 05
subsystem: ui
tags: [css, tailwind, chat, transitions, command, fix-02-spillover, licensing]

# Dependency graph
requires:
  - phase: 27-adopted-external-design-picks (plan 03)
    provides: "globals.css `@layer utilities` append pattern (`.generating-ring` precedent); documented the transitions.dev license-verification failure this plan resolves"
provides:
  - "`.t-modal-reveal` / `.t-panel-reveal` / `.t-dropdown-reveal` CSS utilities (hand-authored, not copied) in apps/web/src/app/globals.css"
  - "3 consumers wired: delete-conversation-dialog.tsx (modal), conversation-rail.tsx (panel), model-picker.tsx (dropdown)"
  - "packages/ui/src/command.tsx CommandGroup group-heading typography fix (FIX-02 spillover closed)"
affects: ["Phase 28 (token upgrades) — no overlap, this plan touches zero token VALUES"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "License-blocked external port resolved via hand-authoring original CSS from already-locked numeric timing/scale values (unprotectable facts) instead of copying source text or substituting an unvetted alternative source"
    - "Reduced-motion gating pattern (per-utility @media (prefers-reduced-motion: reduce) block) continued from Plan 03's .generating-ring precedent"
    - "New-inner-wrapper wiring at call sites (never a className override on a shared @nauta/ui primitive already carrying its own tailwindcss-animate treatment)"

key-files:
  created: []
  modified:
    - "apps/web/src/app/globals.css — appended .t-modal-reveal/.t-panel-reveal/.t-dropdown-reveal (hand-authored, attributed)"
    - "apps/web/src/app/chat/_components/delete-conversation-dialog.tsx — new inner div.t-modal-reveal wrapper"
    - "apps/web/src/app/chat/_components/conversation-rail.tsx — t-panel-reveal replaces ad hoc motion-safe:transition-[width] trio"
    - "apps/web/src/app/chat/_components/model-picker.tsx — new inner div.t-dropdown-reveal wrapper around Command"
    - "packages/ui/src/command.tsx — CommandGroup [cmdk-group-heading] font-medium/py-1.5 -> font-semibold/py-1"
    - ".planning/REQUIREMENTS.md — ADOPT-05 text amended + checked off"

key-decisions:
  - "Applied the orchestrator amendment verbatim: hand-authored the 3 .t-* utilities as original CSS implementing the UI-SPEC's already-locked numeric timing/easing/scale values (150/250/350/400ms, scale 0.96/0.98, cubic-bezier(0.16,1,0.3,1)) rather than copying transitions.dev's unlicensed source text or substituting an alternative library"
  - "Kept :root/.dark completely untouched (byte-for-byte, confirmed via git diff) — the new CSS is purely additive @layer utilities, same append pattern as Plan 03's .generating-ring and Phase 26's .scrollbar-token"
  - "Wired all 3 consumers via new inner wrapper elements, never a className override on AlertDialogContent/PopoverContent (avoids two tailwindcss-animate-driven animation systems colliding on the same element, per the UI-SPEC's documented tailwind-merge non-dedup rationale)"
  - "Left CommandDialog's separate, unrelated font-medium occurrence (command-palette surface, not rendered in /chat or /studio) untouched — out of this task's declared scope"

patterns-established:
  - "When a hand-copy port is license-blocked, hand-author using the same locked numeric contract (values are facts, not expression) and document the vetting outcome per-source in the SUMMARY rather than silently ok'ing a lower bar"

requirements-completed: [ADOPT-05]

# Metrics
duration: ~15min
completed: 2026-07-07
---

# Phase 27 Plan 05: Wire ADOPT-05 transitions + close FIX-02 spillover Summary

**Hand-authored the 3 transitions.dev-inspired CSS reveal utilities (license-blocked from verbatim copy in Plan 03) and wired each to its single designated consumer — delete-conversation dialog, conversation-rail collapse, model-picker dropdown — then closed the FIX-02 typography spillover in `packages/ui/src/command.tsx`'s `CommandGroup` heading.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-06T21:10:00-03:00 (approx)
- **Completed:** 2026-07-07T00:25:38Z
- **Tasks:** 3 of 3 completed (Task 0 inserted per orchestrator amendment; original plan's Task 1 and Task 2 both completed)
- **Files modified:** 5 (globals.css, 3 chat consumers, command.tsx) + REQUIREMENTS.md

## Accomplishments
- `.t-modal-reveal` / `.t-panel-reveal` / `.t-dropdown-reveal` now exist in `apps/web/src/app/globals.css`, hand-authored (not copied) per the orchestrator's amended ADOPT-05 mechanism, implementing the exact numeric timing/scale contract already locked in `27-UI-SPEC.md` (durations 150/250/350/400ms, scales 0.96/0.98, easing `cubic-bezier(0.16, 1, 0.3, 1)` / `ease-out`), each reduced-motion-gated.
- `:root`/`.dark` verified byte-for-byte unchanged (`git diff` shows a pure append at end-of-file; no token VALUE added, changed, or removed).
- All 3 transitions wired to their exactly-one designated consumer via new inner wrapper elements — no className override on any shared `@nauta/ui` primitive.
- `packages/ui/src/command.tsx`'s `CommandGroup` group-heading fixed: `font-medium` → `font-semibold`, `py-1.5` → `py-1` (4px grid) — closes the FIX-02 escape that lived in `packages/ui`, outside Phase 26's app-scoped grep, live today in `ModelPicker`'s group headings.
- `apps/web` + `@nauta/ui` typecheck clean; full `apps/web` vitest suite (23 files, 168 tests) green after every task.
- `.planning/REQUIREMENTS.md`'s ADOPT-05 line amended to reflect hand-authored (not hand-copied) provenance and checked off; traceability table updated to Complete.

## Task Commits

Each task was committed atomically:

1. **Task 0 (orchestrator amendment): Hand-author the 3 `.t-*` utilities in globals.css** - `e6a837f` (feat)
2. **Task 1: Wire the 3 transition utilities to their designated consumers** - `9979a0c` (feat)
3. **Task 2: Fix command.tsx CommandGroup group-heading typography (FIX-02 spillover)** - `4477da0` (fix)

**Plan metadata:** commit follows this SUMMARY

## Files Created/Modified
- `apps/web/src/app/globals.css` - Appended `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` + their keyframes + reduced-motion gate, hand-authored, attributed
- `apps/web/src/app/chat/_components/delete-conversation-dialog.tsx` - Wrapped `AlertDialogHeader`..`AlertDialogFooter` in a new `<div className="t-modal-reveal">` inside `AlertDialogContent`
- `apps/web/src/app/chat/_components/conversation-rail.tsx` - Replaced the ad hoc `motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out` trio on the collapse div with `t-panel-reveal`
- `apps/web/src/app/chat/_components/model-picker.tsx` - Wrapped `<Command>` in a new `<div className="t-dropdown-reveal">` inside `<PopoverContent>`
- `packages/ui/src/command.tsx` - `CommandGroup`'s `[cmdk-group-heading]` selector: `font-medium`→`font-semibold`, `py-1.5`→`py-1`
- `.planning/REQUIREMENTS.md` - ADOPT-05 checklist line + traceability table row amended and checked off

## Decisions Made
- Followed the orchestrator amendment exactly: hand-authored original CSS rather than attempting a fresh license search for an alternative source or escalating further, since Plan 03 had already exhausted the "unreachable/incompatible source" contingency and the amendment was already decided at the orchestrator level. Attribution comment states plainly that this is a clean-room implementation of the same numeric contract, not a port, and explains why (license blocked).
- Kept the reduced-motion media query structure identical in shape to Plan 03's `.generating-ring` gate (separate `@media (prefers-reduced-motion: reduce)` block disabling the 3 new utilities) for stylistic consistency within the same file.
- No new npm dependency, no new token, no restyle beyond the specified wrapper at any of the 3 consumers.

## Deviations from Plan

### Auto-fixed Issues

None - no bugs, missing critical functionality, or blocking issues arose beyond the orchestrator-directed amendment itself (which is not a Rule 1-4 auto-fix; it's an explicit instruction executed as given).

### Orchestrator Amendment Applied (not a Rule 1-4 deviation)

**Task 0 inserted ahead of the plan's declared Task 1/Task 2 — CSS utilities hand-authored instead of hand-copied.**
- **Found during:** Pre-execution read of 27-03-SUMMARY.md and the orchestrator's amendment block.
- **Issue:** 27-05-PLAN.md assumed the 3 `.t-*` CSS utilities already existed in `globals.css` (delivered by Plan 03). Plan 03 skipped that delivery after finding `Jakubantalik/transitions.dev` has no discoverable license anywhere in its repo (no LICENSE file, no package.json license field, GitHub license API `null`, the only MIT text scopes an unrelated sub-tool).
- **Fix:** Per the orchestrator's explicit amendment, hand-authored the 3 utilities as original CSS in `globals.css`, implementing the exact numeric timing/easing/scale values already locked in `27-UI-SPEC.md`'s ADOPT-05 section (these are unprotectable facts, not copyrightable expression) — with an attribution comment explaining the clean-room provenance and why verbatim copy was blocked.
- **Files modified:** `apps/web/src/app/globals.css`
- **Verification:** `git diff` confirms the change is a pure append after the existing `.generating-ring` block; `:root`/`.dark` custom-property declarations are byte-for-byte unchanged (33 root + 32 dark = 65 declared custom properties, identical count before and after).
- **Committed in:** `e6a837f`

---

**Total deviations:** 1 (orchestrator-directed amendment, executed as instructed — not a Rule 1-4 auto-fix).
**Impact on plan:** ADOPT-05 now ships end-to-end (CSS + wiring) within this single plan, closing the gap Plan 03 left open. No scope creep beyond what the amendment specified.

## Per-Source Vetting Outcome (Phase 27, ADOPT-01..05 — required evidence table)

| Source | License | Outcome |
|---|---|---|
| impeccable.style (`pbakaus/impeccable`) | Apache-2.0 | Fetched + reviewed — confirmed via `gh api repos/pbakaus/impeccable` (`apache-2.0`, SPDX) — no flags — prose paraphrased, not verbatim (Plan 01) |
| Magic UI (`magicuidesign/magicui`) | MIT | Fetched + reviewed — confirmed via `gh api repos/magicuidesign/magicui` (`spdx_id: MIT`) — source read line-by-line, CSS/style-object-only, no JS orchestration copied — no flags (Plans 02, 03) |
| `ux-designer-skill` (`szilu/ux-designer-skill`) | MIT | Fetched + reviewed — confirmed via `gh api repos/szilu/ux-designer-skill` (`mit`, SPDX) + repo's own `LICENSE` file (copyright Szilárd Hajba, 2026) — exactly 3 reference files copied verbatim per the locked verdict — no flags (Plan 01) |
| `Jakubantalik/transitions.dev` | **NO LICENSE** | Fetched + reviewed — **NOT CONFIRMED MIT**: `gh api` returns `license: null`, no `LICENSE*`/`COPYING*` file anywhere in the git tree, no `package.json` license field, the only "MIT" text found (`terms.html`) is explicitly scoped to an unrelated sub-tool (`transitions-refine` CLI), not the CSS-snippet/skill library — **verbatim copy BLOCKED (Plan 03)**; resolved by hand-authoring the same locked numeric timing/scale contract as original CSS (this plan, Task 0, per orchestrator amendment) |

## Issues Encountered
None beyond the documented amendment above. All acceptance-criteria greps, `@nauta/ui` + `@nauta/web` typecheck, and the full `apps/web` vitest suite (168 tests, 23 files) passed on first run for every task.

One acceptance-criteria grep (`! grep -rq 'font-medium' apps/web/src/app/chat`) initially reported a hit in `apps/web/src/app/chat/_components/__tests__/markdown-renderer.test.tsx` — inspected and confirmed this is a pre-existing, unmodified test file whose own assertions and comments *reference* the string "font-medium" only to assert its absence from rendered output (`expect(el?.className).not.toContain("font-medium")`); it is not a live utility class and is outside this plan's declared file scope, so left untouched per the deviation-rules scope boundary.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ADOPT-05 is now fully shipped (CSS + wiring) — Phase 27's "3-4 retokenized transitions.dev snippets visibly used at their UI moments" success criterion is met, with the license-blocked source substituted by a clean-room hand-authored implementation of the same locked values.
- FIX-02's `packages/ui` spillover (CommandGroup heading) is closed; `CommandDialog`'s separate, unrelated `font-medium` occurrence (command-palette surface, not rendered anywhere in /chat or /studio) remains open — flagged for backlog, same disposition Plan 03/the UI-SPEC already recorded.
- Phase 27's ADOPT-01..05 requirement set is now fully Complete in `.planning/REQUIREMENTS.md`. Phase 28 (token upgrades) is unblocked to start — this plan touched zero token VALUES.

---
*Phase: 27-adopted-external-design-picks*
*Completed: 2026-07-07*
