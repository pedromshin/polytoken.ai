---
phase: 47-brand-foundation-verification-tooling
plan: 02
subsystem: ui
tags: [brand, copy, register-shift, next-app-router, sonner, empty-state]

# Dependency graph
requires:
  - phase: 47-brand-foundation-verification-tooling
    provides: "47-01's BrandMark component + login/sidebar warm-register copy (this plan closes the remaining BRND-01 slice)"
provides:
  - "Every page Metadata.title in the warm polytoken voice register (root, entities, entity detail, knowledge, studio, studio preview, forwarding settings)"
  - "Chat-home, canvas, and inbox empty states in warm companion framing"
  - "Toast copy (success/error/warning) across the email-detail canvas editor in the warm polytoken voice, with all variants/durations/Undo affordances preserved"
affects: [49-total-ui-reskin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Copy-only register sweep: string literal changes only, zero prop/logic/import changes, verified via acceptance-gate greps for literal-string absence + variant preservation"

key-files:
  created: []
  modified:
    - apps/web/src/app/layout.tsx
    - apps/web/src/app/entities/page.tsx
    - apps/web/src/app/entities/[id]/page.tsx
    - apps/web/src/app/knowledge/page.tsx
    - apps/web/src/app/studio/page.tsx
    - apps/web/src/app/studio/preview/page.tsx
    - apps/web/src/app/settings/forwarding/page.tsx
    - apps/web/src/app/chat/_components/chat-home-empty-state.tsx
    - apps/web/src/app/chat/_canvas/canvas-empty-state.tsx
    - apps/web/src/app/_components/inbox-three-pane.tsx
    - apps/web/src/app/emails/[id]/_components/email-detail.tsx
    - apps/web/src/app/emails/[id]/_components/use-autofill-fields.ts
    - apps/web/src/app/emails/[id]/_components/pdf-preview-pane.tsx

key-decisions:
  - "confirm-deny-controls.tsx's toast.info('Field value cleared.', {Undo, 3000ms}) left unchanged — the plan's own read_first note flags this exact copy as governed by an existing Copywriting Contract (D-10/D-18 era decision recorded in STATE.md); rewriting it risked contradicting a locked prior decision for zero brand-register benefit, since the copy was already plain/non-systems-y"
  - "studio/preview/page.tsx's title diverged from studio/page.tsx's ('Component showcase — Polytoken' vs 'Your studio — Polytoken') instead of reusing the same string, matching the page's own h1 ('Component Showcase') for internal consistency"
  - "emails/[id]/page.tsx's 'Loading… — Polytoken' generateMetadata title left as-is per the plan's explicit allowance (transient loading state, not a systems label)"

requirements-completed: [BRND-01]

# Metrics
duration: ~20min
completed: 2026-07-10
---

# Phase 47 Plan 02: Copy Register Sweep (Titles, Empty States, Toasts) Summary

**Register-shifted every page `<title>`, the chat/canvas/inbox empty states, and the email-detail toast copy into the warm first-person polytoken voice — string-level only, zero layout/logic/prop changes, all toast variants and non-copy args (Undo, durations) preserved.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-10T17:30:00Z (approx.)
- **Completed:** 2026-07-10T17:49:54Z
- **Tasks:** 3 completed
- **Files modified:** 13

## Accomplishments
- 7 page titles shifted from bare systems labels to first-person warmth: `layout.tsx` ("Polytoken — Emails" → "Your inbox — Polytoken"), `entities/page.tsx` ("Entities — Polytoken" → "Your entities — Polytoken"), `entities/[id]/page.tsx` ("Entity — Polytoken" → "Your entity — Polytoken"), `knowledge/page.tsx` ("Knowledge — Polytoken" → "Your knowledge — Polytoken"), `studio/page.tsx` ("Studio — Polytoken" → "Your studio — Polytoken"), `studio/preview/page.tsx` ("Studio — Polytoken" → "Component showcase — Polytoken"), `settings/forwarding/page.tsx` ("Forwarding address — Polytoken" → "Your forwarding address — Polytoken"). `login/page.tsx` (Plan 47-01's file) and `emails/[id]/page.tsx`'s transient "Loading…" title untouched.
- 3 empty states shifted to companion framing: chat-home ("Start a new conversation" → "Ask me anything", body warmed while keeping the streaming/widgets meaning; "New chat" CTA action label untouched), canvas ("No panels yet" → "Panels will appear here", body still explains panels land here after chatting), inbox (both inline branches — with-entities and general — shifted to companion framing, conditional logic untouched).
- 4 toast call sites in the email-detail canvas editor warmed: `email-detail.tsx`'s success toast ("Email sent for reprocessing" → "On it — reprocessing this email"), its two error toasts (lightly warmed, stayed clear/actionable, still `toast.error`), and its warning toast (region-attach failure); `use-autofill-fields.ts`'s degrade error toast (6000ms duration preserved); `pdf-preview-pane.tsx`'s too-small warning. No toast variant was downgraded (verified: every touched site still calls the same `toast.success/error/warning` it called before).

## Task Commits

Each task was committed atomically:

1. **Task 1: Register-shift the page titles into the warm polytoken voice** - `6e4b902` (feat)
2. **Task 2: Register-shift the empty states into warm companion framing** - `36ae62c` (feat)
3. **Task 3: Register-shift the toasts into the warm polytoken voice (preserve semantics)** - `ba82ec1` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/src/app/layout.tsx` - root `<title>` warmed
- `apps/web/src/app/entities/page.tsx` - `<title>` warmed
- `apps/web/src/app/entities/[id]/page.tsx` - `generateMetadata` title warmed
- `apps/web/src/app/knowledge/page.tsx` - `<title>` warmed
- `apps/web/src/app/studio/page.tsx` - `<title>` warmed
- `apps/web/src/app/studio/preview/page.tsx` - `<title>` warmed (diverged from studio/page.tsx for internal consistency with its own h1)
- `apps/web/src/app/settings/forwarding/page.tsx` - `<title>` lightly warmed
- `apps/web/src/app/chat/_components/chat-home-empty-state.tsx` - heading/body warmed
- `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx` - heading/body warmed
- `apps/web/src/app/_components/inbox-three-pane.tsx` - both inline empty-copy branches warmed
- `apps/web/src/app/emails/[id]/_components/email-detail.tsx` - 3 toast copy strings warmed (1 success, 2 error/warning kept actionable)
- `apps/web/src/app/emails/[id]/_components/use-autofill-fields.ts` - degrade error toast warmed, 6000ms preserved
- `apps/web/src/app/emails/[id]/_components/pdf-preview-pane.tsx` - too-small warning warmed

## Decisions Made
- `confirm-deny-controls.tsx`'s `toast.info("Field value cleared.", { Undo, 3000ms })` left unchanged. The plan's own `<read_first>` note flags this exact copy as "governed by an existing Copywriting Contract" (a locked D-10/D-18-era decision recorded in STATE.md line 2167). Rewriting a contract-governed string for marginal brand-register benefit — the copy is already plain and non-systems-y — risked contradicting a documented prior decision. The Undo action and 3000ms duration remain intact, verified by grep.
- `studio/preview/page.tsx` got a distinct title ("Component showcase — Polytoken") rather than reusing `studio/page.tsx`'s ("Your studio — Polytoken"), matching the page's own rendered h1 ("Component Showcase") — avoids two open browser tabs reading identically while keeping both in-register.

## Deviations from Plan

None - plan executed exactly as written. The `confirm-deny-controls.tsx` non-edit and the title-wording choices above are within the plan's explicit discretion ("Finalize wording within the warm polytoken voice register"), not deviations from stated tasks.

## Issues Encountered
- `npm run typecheck -w @polytoken/web` fails on the same pre-existing `src/app/dev/design/previews-*.tsx` baseline errors documented in 47-01-SUMMARY.md (stale `@nauta/ui/*` import paths + 2 implicit-`any` params, from the untracked `apps/web/src/app/dev/design/` directory) — unrelated to this plan's files, confirmed by filtering those paths out of every typecheck run and finding zero remaining errors after each task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- BRND-01 is now fully satisfied: the login/sidebar slice (47-01) plus this plan's titles/empty-states/toasts slice together cover all user-facing copy the requirement names. Marked Complete in REQUIREMENTS.md.
- `npm run typecheck -w @polytoken/web` and `npm run test -w @polytoken/web` (294/294) stay green outside the pre-existing `dev/design` baseline, matching 47-01's documented state.
- No purged alternate brand name (Cortex/Nodal/Lattice/Constellation) appears anywhere in the swept copy — verified by grep across every touched file.
- Ready for the next 47-0N plan (brand guide doc / Playwright toolchain / screenshot harness per 47-CONTEXT.md D-47-03/D-47-04/D-47-05).

---
*Phase: 47-brand-foundation-verification-tooling*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 13 modified files verified present on disk plus this SUMMARY.md; all three task
commits (`6e4b902`, `36ae62c`, `ba82ec1`) verified present in `git log`. Every plan
acceptance criterion re-verified via grep before this write (literal-string absence,
"Polytoken" retention, toast-variant preservation, Undo/duration preservation, no
purged brand name); `npm run typecheck -w @polytoken/web` and
`npm run test -w @polytoken/web` (294/294) both re-confirmed green outside the
pre-existing `dev/design` baseline.
