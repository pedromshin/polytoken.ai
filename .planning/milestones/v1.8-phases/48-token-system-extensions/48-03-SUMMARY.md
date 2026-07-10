---
phase: 48-token-system-extensions
plan: 03
subsystem: ui
tags: [design-tokens, tailwind, radius-pill, color-success, font-code, react-flow]

# Dependency graph
requires:
  - phase: 48-01
    provides: "rounded-pill / bg-success / text-success-foreground / font-code app-layer utilities this plan consumes at their designated call sites"
provides:
  - "The shared <ProvenanceLink> citation chip (+ the chat canvas data-edge label) rendering as a true rounded-pill instead of rounded-md/rounded-full"
  - "Chat-markdown inline code + fenced code blocks, and the studio JSON pane, rendering on font-code instead of font-mono"
  - "Confirmed-good visuals in layers-tree-row/extraction-summary-panel/confirm-deny-controls migrated off hardcoded green/emerald onto color.success, with deny/stop controls left untouched"
  - "A textual before/after visual-evidence artifact (D-48-08) under .planning/ui-reviews/, documenting the gap where live-browser capture is blocked on OAuth"
affects: [48-04, 48-05, 49-brand-reskin-application]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Success-affordance hover recipe: one-step-stronger opacity (hover:bg-success/90) rather than a second hardcoded shade — the pattern 48-05's convention doc will record"

key-files:
  created:
    - .planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md
  modified:
    - apps/web/src/components/provenance-link.tsx
    - apps/web/src/app/chat/_canvas/data-edge.tsx
    - apps/web/src/app/chat/_components/markdown-renderer.tsx
    - apps/web/src/app/studio/_components/json-pane.tsx
    - apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx
    - apps/web/src/app/emails/[id]/_components/extraction-summary-panel.tsx
    - apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx

key-decisions:
  - "Converted the chat canvas data-edge label (rounded-full, label-carrying) to rounded-pill alongside the citation chip — the only other genuine pill chip found on the chat surface per the plan's grep instruction"
  - "Live-browser screenshot capture skipped in favor of a documented textual before/after artifact: both changed surfaces sit behind the auth middleware with no live Supabase session available (OAuth remains user-gated), and /emails/[id] isn't even a harness-covered surface — recorded as a gap with a concrete follow-up, not silently dropped"

patterns-established: []

requirements-completed: [TOKN-01, TOKN-02, TOKN-03]

# Metrics
duration: 8min
completed: 2026-07-10
---

# Phase 48 Plan 03: Token System Extensions — Utility Token Consumers Summary

**Citation chip + canvas edge label converted to true `rounded-pill`, chat/studio code onto `font-code`, and three confirmed-good affordances migrated off hardcoded green/emerald onto `color.success` — with deny/stop controls provably untouched.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-10T17:24:00-03:00 (approx.)
- **Completed:** 2026-07-10T17:31:42-03:00
- **Tasks:** 3/3 completed
- **Files modified:** 7 (+ 1 created)

## Accomplishments

- `provenance-link.tsx`'s `CHIP_CLASS_NAME` (the ONE shared citation-chip primitive used by `ToolInvocationResultRow` today and Phase 41's knowledge-preview footer later) now renders `rounded-pill` instead of `rounded-md` — a single-primitive edit converts every consumer at once.
- Grepped the whole `/chat` surface for any other genuine label-carrying pill chip per the plan's discretion clause: found exactly one (the `data-edge.tsx` canvas connection label, `sourcePath → targetKey`), previously a hardcoded `rounded-full`, now `rounded-pill` — token-driven instead of a Tailwind built-in. Studio's underline-style tabs were confirmed NOT pills and left untouched, as instructed.
- Chat markdown's inline `<Code>` and fenced `<Pre>` blocks, plus the studio `<JsonPane>`, now render on `font-code` instead of `font-mono`/inherited — architecturally now resolves through the `typography.code.family` DTCG token (48-01), visually identical today since `font-code` currently resolves to the same monospace stack.
- `layers-tree-row.tsx`: confirmed-row tint `bg-green-50` → `bg-success/10`; confirm dot `bg-green-500 hover:bg-green-600 text-white` → `bg-success hover:bg-success/90 text-success-foreground`. A stale doc comment referencing the old `bg-green-50` class was corrected in the same edit.
- `extraction-summary-panel.tsx`: the confirmed status dot `bg-emerald-500` → `bg-success`; the "In the entities gallery" label `text-emerald-700 dark:text-emerald-400` → `text-success`.
- `confirm-deny-controls.tsx`: the CONFIRM button `bg-green-500 hover:bg-green-600 text-white` → `bg-success hover:bg-success/90 text-success-foreground`. The DENY button in this file and the deny (✗) button in `layers-tree-row.tsx` are provably untouched (`bg-destructive`) — verified by re-reading both files post-edit.
- Post-edit grep (`bg-green-|emerald-|bg-lime-`) over all three success files returns zero matches (exit 1), matching the plan's automated verify gate exactly.
- `npm run typecheck -w @polytoken/web` stays clean of any new error — reproduces only the pre-existing, already-deferred `apps/web/src/app/dev/design/` scratch-dir failures (48-01/48-02's documented, unrelated gap).
- `provenance-link.test.tsx` — 6/6 pass unchanged (tests assert `href`/text content, not classNames, so insensitive to the radius change).
- D-48-08 visual evidence: since both changed surfaces (`/chat` citation chips, `/emails/[id]` confirmed-good visuals) sit behind the auth middleware with no live Supabase session in this environment (OAuth remains user-gated per STATE.md), and `/emails/[id]` isn't even in the `screenshot-review.spec.ts` harness's static `SURFACES` list, a textual before/after artifact was produced instead — the actual committed diffs are the exact source of visual truth for pure className swaps. Saved to `.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md`, with the gap and concrete follow-up (extend the harness's `SURFACES` list + a real session) explicitly recorded.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pill radius on the shared citation chip + code typography** - `0a03b54` (feat)
2. **Task 2: Migrate confirmed-good visuals onto color.success (no control relabelling)** - `d36dd46` (feat)
3. **Task 3: Before/after screenshot artifact for a chip + success surface** - `d709176` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/components/provenance-link.tsx` - `CHIP_CLASS_NAME`: `rounded-md` → `rounded-pill`
- `apps/web/src/app/chat/_canvas/data-edge.tsx` - connection-label button: `rounded-full` → `rounded-pill`
- `apps/web/src/app/chat/_components/markdown-renderer.tsx` - inline `Code` + fenced `Pre`: `font-mono`/inherited → `font-code`
- `apps/web/src/app/studio/_components/json-pane.tsx` - JSON body `<pre>`: `font-mono` → `font-code`
- `apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx` - confirmed tint + confirm dot → success tokens; stale doc comment fixed
- `apps/web/src/app/emails/[id]/_components/extraction-summary-panel.tsx` - confirmed status dot + gallery label → success tokens
- `apps/web/src/app/emails/[id]/_components/confirm-deny-controls.tsx` - CONFIRM button → success tokens; DENY untouched
- `.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md` - new; textual before/after visual-evidence artifact (D-48-08)

## Decisions Made

- The chat canvas data-edge label was the only other genuine `rounded-full` label-carrying chip on the `/chat` surface (verified via grep across `apps/web/src/app/chat/`); converted alongside the citation chip per the plan's discretion clause. Studio tabs remain underline-style, untouched.
- Chose to correct a stale inline doc comment in `layers-tree-row.tsx` that still referenced `bg-green-50` after the className changed underneath it — a same-file, same-edit accuracy fix (Rule 1, doc-only, no functional impact).
- Chose a documented textual artifact over forcing a live-browser capture: standing up a real Supabase session to get past the auth middleware would mean touching auth/env configuration explicitly out of scope for this plan and this environment; the gap is recorded with a concrete unblock path rather than silently skipped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Doc correction, no functional impact] Stale doc comment referencing the pre-change class name**
- **Found during:** Task 2 verification (the automated grep check initially matched `bg-green-` in a doc comment, not a className)
- **Issue:** `layers-tree-row.tsx`'s `LayersTreeRow` doc comment said "confirmed rows show bg-green-50" — still describing the pre-Task-2 class after the actual className was migrated to `bg-success/10`.
- **Fix:** Updated the comment to say `bg-success/10`.
- **Files modified:** `apps/web/src/app/emails/[id]/_components/layers-tree-row.tsx`
- **Verification:** Re-ran the plan's exact grep verify command; zero matches (exit 1).
- **Committed in:** `d36dd46` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (doc-only correction, no code/behavior impact)
**Impact on plan:** No scope creep — the fix lives in a file already in this plan's `files_modified` list, caught by re-running the plan's own verify command.

## Issues Encountered

- The Phase-47 `screenshot:review` harness cannot capture either changed surface in this environment: `/chat` and `/emails/[id]` both sit behind the auth middleware, and there is no live Supabase session (OAuth remains user-gated per STATE.md Deferred Items — "OAuth/deploys/domain still hard-parked"). `/emails/[id]` additionally isn't in the harness's static `SURFACES` list at all (it needs a concrete email id from a live DB row). Per the plan's own fallback instruction, resolved by documenting the before/after via the actual committed diffs instead of forcing a browser session — see `.planning/ui-reviews/2026-07-10T20-30-05.134Z/index.md` for the full writeup and the recorded follow-up.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `rounded-pill`, `bg-success`/`text-success-foreground`, and `font-code` all now have real consumers proving the 48-01 utilities render correctly end-to-end (not just registered in the token layer).
- Zero hardcoded `green-`/`emerald-`/`lime-` classes remain in the three confirmed-good visual files — grep-verified.
- Blocker/concern carried forward: live-browser visual confirmation of the pill chip and success-token confirmed row is deferred pending the user completing `GOOGLE-OAUTH-RUNBOOK.md` (unblocks a real session) — tracked alongside the other OAuth-gated UAT items from Phases 43/45 in STATE.md Deferred Items. When unblocked, also extend `screenshot-review.spec.ts`'s `SURFACES` list with an `/emails/[id]` entry to close this gap for real.
- `apps/web` typecheck's pre-existing `dev/design` scratch-dir failure (documented in 48-01's `deferred-items.md`) remains unresolved and will keep surfacing in every future plan's typecheck verify step until a future plan fixes it.

## Self-Check: PASSED

All 8 files (7 modified, 1 created incl. the artifact) verified present on disk; all 3 task commit hashes (`0a03b54`, `d36dd46`, `d709176`) verified present in `git log`.

---
*Phase: 48-token-system-extensions*
*Completed: 2026-07-10*
