---
phase: 48-token-system-extensions
plan: 05
subsystem: design-docs
tags: [design-conventions, hover-active-state, breakpoint-awareness, documentation]

# Dependency graph
requires:
  - phase: 48-01
    provides: the .touch-target (44px) utility + md-breakpoint convention comment in apps/web/src/app/globals.css — the minimal mechanism this plan's breakpoint-decision.md records the decision for
provides:
  - "docs/design/hover-active-convention.md — D-48-06, the ONE hover/active-state derivation rule (neutral/ghost -> accent surface pair; filled semantic -> self-intensify /90 then /80), with worked examples from this phase's own chips/badges"
  - "docs/design/breakpoint-decision.md — D-48-07, the breakpoint-awareness decision (pack tokens breakpoint-static; md/768px canvas->feed switch line; touch-target guard independent of pack density; Phase 50 MAY/MAY NOT scope)"
  - "docs/design/brand-guide.md section 8 citing both convention docs"
affects: [49-total-ui-reskin, 50-mobile-responsive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Design-convention docs (docs/design/*.md) record DECISIONS and RULES, never token values — token values stay in packs.ts; this keeps the convention docs stable even if a value is retuned later"

key-files:
  created:
    - docs/design/hover-active-convention.md
    - docs/design/breakpoint-decision.md
  modified:
    - docs/design/brand-guide.md

key-decisions:
  - "D-48-06: hover/active-state derivation is ONE fixed recipe (neutral/ghost -> accent surface pair; filled semantic -> /90 hover, /80 active) with one documented exception (pinned/selected state on a toggle/radio segment suppresses the transient hover step, per TierFilterControl)"
  - "D-48-07: pack tokens stay breakpoint-static; the Tailwind md breakpoint (768px) is the canvas->feed switch line; spacing.density remains a single per-pack scalar with no breakpoint variant; a per-breakpoint token dimension is explicitly rejected this milestone"

requirements-completed: [TOKN-06, TOKN-07]

# Metrics
duration: ~10min
completed: 2026-07-10
---

# Phase 48 Plan 05: Token System Extensions — Design Conventions (Hover/Active + Breakpoint) Summary

**Two design-convention docs recorded in `docs/design/`: the one hover/active-state derivation rule (D-48-06) with worked examples from this phase's own chips, and the breakpoint-awareness decision (D-48-07) that scopes Phase 50's mobile-responsive answer — both cited from the brand guide.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-10
- **Tasks:** 2/2 completed
- **Files modified:** 1 (+ 2 created)

## Accomplishments

- `docs/design/hover-active-convention.md` records D-48-06 as a two-row table (neutral/ghost →
  accent surface pair; filled semantic → self-intensifying opacity step) plus one documented
  exception for persistent selected/active state on toggle-like controls, with three worked
  examples pulled directly from this phase's own shipped chips/badges: `ProvenanceLink`'s
  citation chip (neutral/ghost), `ConfirmDenyControls`'s success confirm affordance (filled
  semantic), and `TierFilterControl`'s cumulative tier-filter segments (the pinned-state
  exception).
- `docs/design/breakpoint-decision.md` records D-48-07, answering all three required questions:
  (1) the Tailwind `md` breakpoint (768px) is the canvas → feed switch line; (2)
  `spacing.density` stays a single per-pack scalar, with the `.touch-target` (44px) guard
  protecting interactive elements independent of pack density; (3) Phase 50 MAY add layout
  primitives/Tailwind conventions collapsing the canvas to an inline feed below `md` (and a
  narrowly-scoped density mechanism only if the feed layout genuinely needs one), but MAY NOT
  add a per-breakpoint token dimension — explicitly rejected this milestone. Market evidence
  (ChatGPT's 2026-05-28 Canvas removal from mobile; Claude Artifacts rendering inline on mobile)
  is cited as the rationale for the inline-first-on-mobile direction. The doc explicitly
  references the `.touch-target` utility and `md`-breakpoint comment already shipped in 48-01 as
  the minimal working mechanism this decision codifies — no new code was written.
- `docs/design/brand-guide.md` gained a new "§8 Design conventions" section citing both docs by
  relative link and one-line summary each.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the hover/active-state derivation rule (TOKN-06)** - `b81e506` (docs)
2. **Task 2: Write the breakpoint-awareness decision (TOKN-07) + brand-guide citations** - `b59e0ed` (docs)

## Files Created/Modified

- `docs/design/hover-active-convention.md` - new; D-48-06 derivation rule + worked examples
- `docs/design/breakpoint-decision.md` - new; D-48-07 decision, three required questions answered, Phase 50 scope boundary
- `docs/design/brand-guide.md` - new §8 citing both convention docs

## Decisions Made

- The hover/active rule intentionally documents ONE named exception (pinned/selected state on a
  segmented/toggle control) rather than either (a) forcing `TierFilterControl`'s active segment
  into the generic filled-semantic self-intensify pattern (which would visually compete with the
  selection itself) or (b) leaving it undocumented as an ad-hoc special case. Naming it as a
  bounded, single exception keeps the rule "ONE recipe" per the plan's constraint while staying
  honest about the one real deviation already shipped in the codebase.
- The breakpoint doc reuses (does not restate) the exact mechanism prose already present as code
  comments in `apps/web/src/app/globals.css` from 48-01, framing this doc explicitly as "the
  recorded decision, not new code" — avoiding any drift between the CSS comment and the design
  doc's description of the same mechanism.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' automated verify gates (grep-based)
passed on the first attempt; no auto-fixes, no scope changes, no architectural questions arose
(this was a docs-only plan with no runtime trust boundary, per the plan's own threat model).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required; docs-only plan.

## Next Phase Readiness

- Phase 49 (total UI re-skin) has a single source-of-truth hover/active recipe
  (`hover-active-convention.md`) to apply broadly across chat/inbox/canvas/studio/settings/login
  — no per-component re-derivation needed.
- Phase 50 (mobile-responsive answer) has its scope boundary pre-negotiated
  (`breakpoint-decision.md`): it may build the canvas→feed collapse using the `md` breakpoint and
  the already-shipped `.touch-target` guard, but must not introduce a per-breakpoint token
  dimension — that question is closed for this milestone.
- No blockers or concerns carried forward from this plan.

## Self-Check: PASSED

Both created files (`docs/design/hover-active-convention.md`, `docs/design/breakpoint-decision.md`)
and the modified `docs/design/brand-guide.md` verified present on disk with required grep-gated
content; both task commit hashes (`b81e506`, `b59e0ed`) verified present in `git log`.

---
*Phase: 48-token-system-extensions*
*Completed: 2026-07-10*
