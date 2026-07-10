---
phase: 47-brand-foundation-verification-tooling
plan: 03
subsystem: docs
tags: [brand, docs, project-md, requirements, user-lock]

# Dependency graph
requires:
  - phase: 47-brand-foundation-verification-tooling
    provides: "47-01's real brand-mark.tsx/icon.svg assets (this plan's mark-usage section cites them) and 47-02's completed copy sweep (this plan's guard runs after all wave-1 app copy is in place)"
provides:
  - "docs/design/brand-guide.md — in-repo polytoken brand guide (USER-LOCKED naming record with verbatim quote, voice do/don't table, mark usage, accepted CLI-tool collision, NOT-done/user-gated list)"
  - "PROJECT.md Key Decisions row recording the USER-LOCKED brand decision (v1.8 Phase 47 BRND)"
affects: [48-design-token-extensions, 49-total-ui-reskin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repo-level brand-name guard: grep -rniE for purged direction names scoped to apps/web/src + docs/, historical .planning/research/ exempt as record"

key-files:
  created:
    - docs/design/brand-guide.md
  modified:
    - .planning/PROJECT.md

key-decisions:
  - "Removed all literal instances of the four purged direction names from the guide's own prose (including from the guard-command illustration) — the plan's acceptance grep scopes docs/ with no carve-out for the guide's own explanatory text, so even historical-context references to the superseded names would self-trip the guard; rewrote those passages to reference '.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md' indirectly instead"
  - "Accepted collision (§4) framed strictly as a recorded risk, never a mitigation — matches the plan's explicit instruction not to write copy that dances around the collision"

requirements-completed: [BRND-03]

# Metrics
duration: ~12min
completed: 2026-07-10
---

# Phase 47 Plan 03: Brand Guide + PROJECT.md Key Decisions Summary

**Authored `docs/design/brand-guide.md` (USER-LOCKED naming record with verbatim quote, warm-voice do/don't table, real mark-asset usage rules, accepted CLI-tool-collision note, NOT-done/user-gated list) and appended the corresponding Key Decisions row to PROJECT.md — closing BRND-03.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-10T18:15:00Z (approx.)
- **Completed:** 2026-07-10T18:24:34Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `docs/design/brand-guide.md` (126 lines): 7 sections — USER-LOCKED naming (verbatim D-47-01 quote), voice principles + a 6-pair before→after copy table drawn from real 47-01/47-02 shipped surfaces, mark usage referencing the real `brand-mark.tsx`/`icon.svg` (geometry, variants, tones, clear space, minimum size), the accepted `polytoken` CLI-tool collision recorded as risk (not mitigation), an explicit "NOT done — user-gated" list (domain purchase, trademark search/filing), a pointer to `product-register-and-bans.md` as the still-authoritative bans doc, and the repo-level brand guard description.
- `.planning/PROJECT.md` Key Decisions table gained one new row (`**v1.8 Phase 47 (BRND)**: ...`) recording the USER-LOCKED decision, the overridden dossier recommendation, the accepted collision, and the user-gated remainder — table structure (3-column, all prior rows) unchanged.
- BRND-03 marked Complete in `.planning/REQUIREMENTS.md` (checkbox + traceability table).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the in-repo polytoken brand guide** - `a4ecfb3` (feat)
2. **Task 2: Record the USER-LOCKED brand decision in PROJECT.md** - `f6a6d0b` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified
- `docs/design/brand-guide.md` - new in-repo brand guide (7 sections, 126 lines)
- `.planning/PROJECT.md` - Key Decisions table gained one Phase 47 (BRND) row

## Decisions Made
- The guide's historical-context references to the four superseded brand-direction names were written out entirely (no literal mentions anywhere in the guide, including inside the guard-command illustration) — see Deviations below.
- The accepted-collision section (§4) explicitly instructs future writers not to frame copy around avoiding the collision, matching the plan's `<interfaces>` directive verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] First draft of the brand guide self-tripped its own repo-level brand guard**
- **Found during:** Task 1, acceptance-criteria verification pass
- **Issue:** The first draft of `docs/design/brand-guide.md` named the four purged brand-direction names literally (once in §1 explaining what was purged, once in §2's voice-principles provenance note, and once embedded inside the illustrative `grep -rniE "cortex|nodal|lattice|constellation" apps/web/src docs` guard command in §7). The plan's acceptance criterion scopes that exact grep over `apps/web/src` AND `docs` with no exception for the guide's own explanatory prose — so the guide's historical-context references and its own guard-command illustration both self-tripped the check it was supposed to pass.
- **Fix:** Rewrote all three passages to reference the names indirectly (pointing to `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` as "four named directions" / "the superseded direction names" rather than spelling them out) and removed the literal grep command from §7's prose, replacing it with a pointer to the plan's own acceptance criteria for the exact command.
- **Files modified:** `docs/design/brand-guide.md`
- **Verification:** Re-ran `grep -rniE "cortex|nodal|lattice|constellation" apps/web/src docs` — zero matches (exit 1, i.e. no matches found).
- **Committed in:** `a4ecfb3` (Task 1 commit)

**2. [Rule 1 - Bug] gsd-sdk `state.advance-plan` mis-advanced STATE.md for this non-sequential-execution phase**
- **Found during:** Post-Task-2 state-update step
- **Issue:** Phase 47's plans execute out of dependency-graph order (47-04 already ran before 47-03, per this plan's own `wave: 2, depends_on: [47-01, 47-02]` frontmatter). The generic `state.advance-plan` verb assumes strictly sequential plan numbers: it incremented "Plan 4 of 5" to "Plan 5 of 5" (skipping past 47-03 entirely) and reset `progress.percent` from 60 to 0, while leaving the human-readable "47-03 still pending" text stale — silently wrong on every axis.
- **Fix:** Reverted the SDK's STATE.md write (`git checkout -- .planning/STATE.md`) and hand-edited the frontmatter (`completed_plans: 3→4`, `percent: 60→80`) and the "Current Position" section (`Plan: 4 of 5`→`Plan: 5 of 5 (47-05 still pending; 47-01/02/03/04 complete)`) directly, plus appended two entries to the Decisions Log. Also discovered `requirements.mark-complete` and a same-session `git diff` on `.planning/REQUIREMENTS.md`/`ROADMAP.md` triggered CRLF→LF normalization across the entire file (113 insertions/113 deletions for a 2-line semantic change on REQUIREMENTS.md) — reverted both and hand-edited the same two-line changes directly to keep the diffs minimal and preserve the repo's existing CRLF convention.
- **Files modified:** `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
- **Verification:** `git diff --stat` on each file shows only the intended line-level changes (2-4 lines each); `grep -n "Phase 47" .planning/PROJECT.md` and `grep -n "BRND-03" .planning/REQUIREMENTS.md` confirm correct final state.
- **Committed in:** this plan-metadata commit

---

**Total deviations:** 2 auto-fixed (2 bugs — a self-tripping doc draft, and generic state-tooling that doesn't handle this phase's non-sequential plan ordering or this repo's CRLF convention).
**Impact on plan:** Both fixes were necessary for correctness (the guide must actually pass its own stated acceptance gate; STATE.md/ROADMAP.md/REQUIREMENTS.md must reflect the true execution state). No scope creep — no other files touched.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- BRND-03 is now Complete: `docs/design/brand-guide.md` exists (126 lines, references `product-register-and-bans.md` + the real `brand-mark.tsx`/`icon.svg` assets, quotes the USER-LOCK verbatim, has a 6-pair do/don't table, an accepted-collision section, and a NOT-done/user-gated list); `.planning/PROJECT.md` Key Decisions has the new Phase 47 (BRND) row; the repo-level brand guard (`grep -rniE "cortex|nodal|lattice|constellation" apps/web/src docs`) is green.
- BRND-01, BRND-02, BRND-03, and VRFY-01 are all now Complete for Phase 47; VRFY-02 (47-05, screenshot review harness) is the sole remaining plan.
- Ready for 47-05 (screenshot-driven visual review harness) to close out Phase 47.

---
*Phase: 47-brand-foundation-verification-tooling*
*Completed: 2026-07-10*

## Self-Check: PASSED

`docs/design/brand-guide.md` verified present on disk (126 lines); `.planning/PROJECT.md` verified
to contain the new "Phase 47 (BRND)" row; both task commits (`a4ecfb3`, `f6a6d0b`) verified present
in `git log --oneline`. All plan acceptance criteria re-verified via grep immediately before this
write: line count ≥40 (126), "polytoken.ai" present (3x), `product-register-and-bans`/`brand-mark`
both referenced, verbatim USER-LOCK quote present, "domain"/"trademark" both present, glassmorphism
mentions all in banned/see-bans context (no license), and the repo-level brand guard
(`grep -rniE "cortex|nodal|lattice|constellation" apps/web/src docs`) returns zero matches.
