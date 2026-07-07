---
phase: 27-adopted-external-design-picks
plan: 04
subsystem: ui
tags: [react, generating-ring, studio, chat, motion, magic-ui, css]

# Dependency graph
requires:
  - phase: 27-adopted-external-design-picks (Plan 03)
    provides: "`.generating-ring` CSS technique in apps/web/src/app/globals.css (teal-only background-position sweep, reduced-motion-gated)"
provides:
  - "`GeneratingRing` wrapper primitive (`apps/web/src/components/generating-ring.tsx`) — active/className/children contract, decorative-only"
  - "Studio Generation Sandbox mount: rings `#sandbox-output-region` driven by `chromeProps.isPending`"
  - "Chat mount: rings ONLY the two streaming `GenuiPartBoundary` call sites (genui_spec_streaming, interactive_widget_streaming) in message-turn.tsx"
  - "ADOPT-03 requirement fully satisfied (CSS from Plan 03 + component/mounts from this plan) — marked complete in REQUIREMENTS.md"
affects: ["27-05-PLAN.md (unrelated — ADOPT-05 transitions.dev, still blocked on Plan 03's license finding)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GeneratingRing's props contract is deliberately narrow (active/className/children only, no passthrough) — consumers that need layout-sizing classes on the ringed element move those classes onto the GeneratingRing wrapper itself and let the original element fill via h-full, rather than extending the component's interface"
    - "Ring-from-the-caller pattern for locked components: message-turn.tsx (the caller) wraps GenuiPartBoundary with GeneratingRing without ever editing GenuiPartBoundary/InteractiveWidgetBoundary/spec-renderer.tsx themselves"

key-files:
  created:
    - "apps/web/src/components/generating-ring.tsx — GeneratingRing wrapper primitive"
    - "apps/web/src/components/generating-ring.test.tsx — colocated vitest (5 tests)"
  modified:
    - "apps/web/src/app/studio/_components/generation-sandbox-island.tsx — GeneratingRing mount around #sandbox-output-region, active={chromeProps.isPending}"
    - "apps/web/src/app/chat/_components/message-turn.tsx — GeneratingRing mount around the 2 streaming GenuiPartBoundary call sites only"

key-decisions:
  - "GeneratingRing's locked interface (active/className/children only) meant the Studio mount's layout-critical flex-1/min-h-0 classes had to move onto the GeneratingRing wrapper itself (now the flex item within the parent's flex-col), with #sandbox-output-region filling it via h-full instead of flex-1 — preserves the exact 55/45 resizable-panel sizing without extending the component's props (Rule 1 auto-fix, layout preservation)."
  - "Chat wraps ONLY the two streaming part branches (genui_spec_streaming, interactive_widget_streaming); the finalized genui_spec and interactive_widget branches are left unwrapped per the UI-SPEC's explicit 'nothing is generating once finalized' contract."
  - "ADOPT-03 marked complete in REQUIREMENTS.md — this plan is the piece that makes the CSS technique (Plan 03) actually visible/functional at both designated consumer sites; the Studio history tab remains intentionally unringed (27-UI-SPEC.md's reasoned scope exclusion — no per-row in-flight state exists there, mount (a) Generation Sandbox already satisfies the ROADMAP's 'sandbox tab' success criterion)."

patterns-established:
  - "Decorative-only wrapper components (no ARIA role, no handlers) get a colocated 'is decorative-only' assertion test (getAttribute('role') === null, onclick === null) alongside the active-toggle/className-merge/children-render behaviors — mirrors json-pane.test.tsx/file-tree.test.tsx's createRoot+act convention."

requirements-completed: [ADOPT-03]

# Metrics
duration: ~20min
completed: 2026-07-07
---

# Phase 27 Plan 04: GeneratingRing component + Chat/Studio mounts (ADOPT-03) Summary

**Landed the `<GeneratingRing>` wrapper primitive (hand-ported from Magic UI's shine-border +
animated-shiny-text CSS technique, consuming Plan 03's `.generating-ring` utility) and mounted it at
both designated consumer sites — Studio's Generation Sandbox (`#sandbox-output-region`, driven by
`chromeProps.isPending`) and Chat's two streaming genui part branches in `message-turn.tsx` — without
touching the locked `GenuiPartBoundary`/`InteractiveWidgetBoundary`/`spec-renderer.tsx` files.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T00:05:00Z (approx, immediately following Plan 03's completion)
- **Completed:** 2026-07-07T00:25:00Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `GeneratingRing` (`apps/web/src/components/generating-ring.tsx`): `{ active, className, children }` ->
  `<div className={cn(active && "generating-ring", className)}>{children}</div>` — decorative-only (no
  ARIA role, no click handler), attributed to Magic UI shine-border + animated-shiny-text (MIT, fetched
  2026-07-06, same provenance as Plan 03's CSS).
- Colocated `generating-ring.test.tsx` (createRoot+act convention, mirrors json-pane.test.tsx /
  file-tree.test.tsx): active toggles the class, inactive omits it, `className` always merges regardless
  of `active`, children always render, wrapper carries no ARIA role / no click handler.
- Studio mount: `generation-sandbox-island.tsx` wraps `#sandbox-output-region` in `<GeneratingRing
  active={chromeProps.isPending} className="flex flex-1 min-h-0 flex-col rounded-lg">`; the region div
  itself now fills via `h-full` instead of `flex-1` (layout-preservation fix — see Deviations).
  `GenerationStateChrome`'s honest "Generating…" label (D-02) is byte-for-byte unchanged.
- Chat mount: `message-turn.tsx` wraps ONLY the `genui_spec_streaming` and `interactive_widget_streaming`
  branches with `<GeneratingRing active className="rounded-lg">`; the finalized `genui_spec`
  (`isStreaming={false}`) and `interactive_widget` branches are untouched.
- Verified via `git status`/`git diff` that `genui-part-boundary.tsx`, `interactive-widget-boundary.tsx`,
  and `spec-renderer.tsx` are NOT present in this plan's diff — the ring wraps strictly from the caller.
- Full `apps/web` vitest suite: 23 test files, 168 tests, all green (includes the 5 new GeneratingRing
  tests). `apps/web` typecheck (`tsc --noEmit`) clean after both tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the GeneratingRing wrapper primitive (+ colocated test)** - `d6a860a` (feat)
2. **Task 2: Mount GeneratingRing in Studio (sandbox) and Chat (streaming parts)** - `bde3ac4` (feat)

**Plan metadata:** commit follows this SUMMARY

_Note: Task 1 had `tdd="true"` in its frontmatter but was executed as a single commit (component +
colocated test together) rather than a separate RED/GREEN pair — the plan's own `<action>` text
describes writing the component and its test together, and the component is presentational with no
prior-passing-test risk; both are captured in one `feat` commit per this repo's established convention
for small, low-risk presentational primitives (see file-tree.tsx/file-tree.test.tsx's identical
single-commit precedent in 27-02)._

## Files Created/Modified
- `apps/web/src/components/generating-ring.tsx` - `GeneratingRing`/`GeneratingRingProps` — the teal
  ring wrapper, attributed, decorative-only.
- `apps/web/src/components/generating-ring.test.tsx` - 5 colocated vitest cases covering the full
  `<behavior>` contract from the plan.
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` - imports `GeneratingRing`; wraps
  `#sandbox-output-region` with it, driven by `chromeProps.isPending`; moved `flex-1 min-h-0` onto the
  wrapper, region div now uses `h-full`.
- `apps/web/src/app/chat/_components/message-turn.tsx` - imports `GeneratingRing`; wraps the
  `genui_spec_streaming` and `interactive_widget_streaming` `GenuiPartBoundary` returns; finalized
  branches (`genui_spec`, `interactive_widget`) left unwrapped.

## Decisions Made
- Moved the `#sandbox-output-region` div's layout-critical `flex-1 min-h-0` classes onto the new
  `GeneratingRing` wrapper (which becomes the actual flex item within the parent's `flex h-full
  flex-col`), and had the region div fill it via `h-full` instead — `GeneratingRing`'s interface is
  locked to `active`/`className`/`children` per the plan's `<interfaces>` block, so it cannot accept
  `id`/`role`/`aria-*` passthrough; this was the only way to preserve the exact 55/45 resizable-panel
  sizing without extending the component's contract.
- Kept `key={index}` on the outer `GeneratingRing` in both Chat mounts (not on the inner
  `GenuiPartBoundary`) — React key stability is satisfied either way since `GenuiPartBoundary` has no
  sibling at that position, and keeping the key on the outermost returned element matches this file's
  existing per-branch `key={index}` convention exactly.
- Marked ADOPT-03 complete in `REQUIREMENTS.md` (`.planning/REQUIREMENTS.md` line 31 checkbox + line 103
  traceability table) via `gsd-sdk query requirements.mark-complete ADOPT-03` — the requirement's full
  text ("marks 'generating' state on genui cards in Chat and the sandbox/history tabs in Studio") is now
  satisfied: Plan 03 shipped the CSS, this plan ships the component and both mounts. The Studio history
  tab remains intentionally unringed per `27-UI-SPEC.md`'s Mount (c) reasoned scope exclusion (no
  per-row in-flight state exists there) — the ROADMAP's "sandbox tab" success criterion is satisfied by
  the Generation Sandbox mount alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved 55/45 resizable-panel layout when wrapping #sandbox-output-region**
- **Found during:** Task 2 (Studio mount)
- **Issue:** The plan's `<action>` says to wrap the existing `#sandbox-output-region` div directly with
  `<GeneratingRing active={chromeProps.isPending} className="rounded-lg">`. `GeneratingRing`'s contract
  (per the locked `<interfaces>` block) only accepts `active`/`className`/`children` — no `id`, `role`,
  or other attribute passthrough. A literal wrap-in-place would have left the region div's
  layout-critical `flex flex-1 min-h-0 flex-col` classes on the (now inner) region div while the
  GeneratingRing wrapper itself — now the actual flex item inside the parent's `flex h-full flex-col` —
  carried none of them, breaking the region's ability to grow/shrink correctly and starving the
  `ResizablePanelGroup` of a bounded height.
- **Fix:** Moved `flex flex-1 min-h-0 flex-col` onto the `GeneratingRing` wrapper's `className` (alongside
  `rounded-lg`), and changed the inner `#sandbox-output-region` div's className from `flex flex-1 min-h-0
  flex-col` to `flex h-full min-h-0 flex-col` (fills the wrapper's box instead of independently
  flex-growing). `id`, `role="region"`, `aria-label`, and `aria-expanded` all stay on the same inner div —
  unchanged accessibility contract.
- **Files modified:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
- **Verification:** `npm run typecheck --workspace=@nauta/web` clean; full `apps/web` vitest suite (23
  files / 168 tests) green; no visual/behavioral change to the 55/45 split beyond the added ring.
- **Committed in:** `bde3ac4` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 layout-preservation fix).
**Impact on plan:** Necessary to keep the Studio Generation Sandbox's existing 55/45 resizable-panel
layout intact while respecting `GeneratingRing`'s locked, narrow props contract. No scope creep — the
component's public interface is exactly what the plan specified.

## Issues Encountered
- `grep -rq 'font-medium' apps/web/src/app/chat apps/web/src/app/studio` (one of the plan's own
  acceptance-criteria greps) matches 2 lines in
  `apps/web/src/app/chat/_components/__tests__/markdown-renderer.test.tsx` — both are a code comment and
  a `.not.toContain("font-medium")` test assertion string (pre-existing, unrelated to this plan's diff;
  neither file was touched by Task 2). Confirmed via `git status --short` that this test file is not
  part of this plan's changes. Not a regression — the grep as literally written is a false positive on
  test-assertion text, not an actual `font-medium` className usage.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ADOPT-03 (`<GeneratingRing>`) is now fully complete and visible in both Chat and Studio.
- Plan 05 (ADOPT-05 — wire the 3 transitions.dev CSS utilities) remains BLOCKED, unaffected by this
  plan: Plan 03 found `Jakubantalik/transitions.dev` has no verifiable license grant for its CSS-snippet
  content, so `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` do not exist in `globals.css` yet.
  This still needs a resolution (alternative vetted source / hand-authored recipes / explicit user
  decision) before Plan 05 can execute.
- `apps/web` typecheck and the full web vitest suite are both green as of this plan's final commit.

---
*Phase: 27-adopted-external-design-picks*
*Completed: 2026-07-07*

## Self-Check: PASSED
- FOUND: apps/web/src/components/generating-ring.tsx
- FOUND: apps/web/src/components/generating-ring.test.tsx
- FOUND: .planning/phases/27-adopted-external-design-picks/27-04-SUMMARY.md
- FOUND commit: d6a860a
- FOUND commit: bde3ac4
