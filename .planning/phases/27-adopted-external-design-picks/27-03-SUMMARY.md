---
phase: 27-adopted-external-design-picks
plan: 03
subsystem: ui
tags: [css, tailwind, globals, motion, generating-ring, transitions, licensing]

# Dependency graph
requires:
  - phase: 26-zero-dependency-contract-fixes
    provides: "globals.css `.scrollbar-token` @layer utilities block (append point + additive pattern)"
provides:
  - "`.generating-ring` CSS technique (ADOPT-03) — teal-only background-position sweep, reduced-motion-gated, in apps/web/src/app/globals.css"
  - "License-verification finding for transitions.dev (ADOPT-05) blocking Task 2 — documented for Plan 05"
affects: ["27-04-PLAN.md (consumes .generating-ring)", "27-05-PLAN.md (blocked — no .t-* utilities exist yet)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive @layer utilities append pattern (Phase 26 precedent) continued for ported CSS techniques"
    - "Pre-copy license re-verification via `gh api repos/<owner>/<repo>` (license field) + full git-tree scan for LICENSE files before hand-copying external CSS"

key-files:
  created: []
  modified:
    - "apps/web/src/app/globals.css — appended `.generating-ring` + `generating-ring-sweep` keyframes + reduced-motion gate (Task 1 only; Task 2 skipped)"

key-decisions:
  - "Task 2 (ADOPT-05 transitions.dev CSS) SKIPPED per the plan's own FALLBACK clause: Jakubantalik/transitions.dev has NO LICENSE file anywhere in its git tree, no `license` field in package.json, and GitHub's license-detection API returns `license: null` for the repo. The only 'MIT License' text found anywhere in the repo (terms.html) is explicitly scoped to a different sub-component (the separate 'Refine' npm CLI tool, `transitions-refine`), not the CSS snippet/skill library this plan needed to copy from. Copying the 3 recipes under an assumed MIT license would misrepresent an unverified license grant — treated as license-verification failure, not source unreachability, but resolved via the identical SKIP+document+do-not-substitute path the plan already specifies for both its unreachable-source and ADOPT-04 incompatible-license contingencies."
  - "Did not mark ADOPT-03 or ADOPT-05 complete in REQUIREMENTS.md from this plan. ADOPT-03's requirement text requires the ring to actually mark 'generating' state on genui cards in Chat/Studio — that mounting happens in Plan 04, not here. ADOPT-05 requires the 3 utilities to be 'visibly used' — Task 2 (the CSS itself) did not ship, so Plan 05 cannot wire anything yet."

patterns-established:
  - "License-verification gate for hand-copied external CSS: check (1) GitHub API `license` field, (2) full git-tree scan for any LICENSE*/COPYING* file, (3) package.json `license` field, (4) any README/terms text — and if the only permissive-license text found is scoped to a different sub-component of the source repo, treat verification as FAILED, not passed by association."

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-07-07
---

# Phase 27 Plan 03: Additive globals.css — GeneratingRing CSS technique (ADOPT-03) Summary

**Landed the `.generating-ring` teal-only, reduced-motion-gated background-position sweep technique
(hand-ported from Magic UI's shine-border + animated-shiny-text, MIT-confirmed) in globals.css;
SKIPPED the 3 transitions.dev recipes (ADOPT-05) after execution-time license re-verification found
the source repo carries no license grant for its CSS-snippet content — the only "MIT" text in the
repo is scoped to an unrelated npm CLI tool in the same monorepo.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-06T23:52:00Z (approx, per STATE.md's last recorded activity before this plan)
- **Completed:** 2026-07-07T00:02:31Z
- **Tasks:** 1 of 2 completed (Task 2 skipped per plan's own FALLBACK clause)
- **Files modified:** 1 (`apps/web/src/app/globals.css`)

## Accomplishments
- `.generating-ring` CSS technique shipped: `position:relative; isolation:isolate` wrapper +
  `::before` ring (inset:-2px/padding:2px/border-radius:inherit/mask-composite:exclude) with a
  teal-only (`hsl(var(--primary))`) linear-gradient sweep, animated via `generating-ring-sweep`
  `@keyframes` (background-position 0%→200%) ONLY under `@media (prefers-reduced-motion:
  no-preference)`.
- Source vetted at execution time: `magicuidesign/magicui` confirmed MIT via `gh api
  repos/magicuidesign/magicui` (`license.key: "mit"`); read the actual `shine-border.tsx` +
  `animated-shiny-text.tsx` source to confirm the technique is a pure CSS/style-object approach with
  no `<script>`/JS event-handler orchestration — a clean CSS-only port.
- Token-value count in `:root`/`.dark` verified unchanged at exactly 55, both before and after the
  edit.
- Discovered (and did NOT act on) a license-verification failure for `Jakubantalik/transitions.dev`
  — see Deviations below. This blocks ADOPT-05's CSS delivery and, transitively, Plan 05's wiring.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append the `.generating-ring` CSS technique (ADOPT-03)** - `7992ebc` (feat)
2. **Task 2: Append the 3 transitions.dev recipes (ADOPT-05)** - SKIPPED, no commit (see Deviations)

**Plan metadata:** commit follows this SUMMARY

## Files Created/Modified
- `apps/web/src/app/globals.css` - Appended a new `@layer utilities` block (46 lines) after the
  Phase-26 `.scrollbar-token` block: `.generating-ring` / `.generating-ring::before` / the
  `generating-ring-sweep` keyframes / the `prefers-reduced-motion: no-preference` gate. Attribution
  comment leads the block (Magic UI shine-border + animated-shiny-text, MIT, fetched 2026-07-06).

## Decisions Made
- Followed the plan's Task 1 instructions exactly — fetched the actual Magic UI component source
  (not just the docs) to confirm the CSS-only nature of the technique before porting.
- Applied the plan's own SKIP+document+do-not-substitute contingency to Task 2 rather than
  proceeding on an unverified license assumption or substituting a different transitions library
  (both explicitly prohibited by the plan).
- Left both ADOPT-03 and ADOPT-05 as "Pending" in REQUIREMENTS.md (see rationale in frontmatter
  `key-decisions`) — neither requirement's full text is satisfied by this plan alone.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blocking issues arose in Task 1.

### Task 2 SKIPPED (per plan's own FALLBACK clause, not a Rule 1-4 deviation)

**License-verification failure for `Jakubantalik/transitions.dev` — Task 2 not executed.**

- **Found during:** Task 2 pre-work (license re-verification step mandated by the plan's `<action>`
  and the phase's Registry Safety gate).
- **Evidence gathered:**
  1. `gh api repos/Jakubantalik/transitions.dev` → `"license": null` (GitHub's own license-detection
     algorithm found nothing).
  2. `gh api repos/Jakubantalik/transitions.dev/git/trees/main?recursive=true` → zero files matching
     `licen*` anywhere in the full repo tree (no `LICENSE`, `LICENSE.md`, `COPYING`, etc.).
  3. `package.json` → `"private": true`, no `"license"` field.
  4. The only "MIT License" text found anywhere in the repo is in `terms.html`, under the H1 "Terms
     & License" — but that page's own `<title>` and content are explicitly scoped to **"Transitions.dev
     Refine"**, a separate npm CLI package (`transitions-refine`) bundled in the same monorepo. The
     license statement ("Refine is released under the MIT License… Copyright © 2026 Jakub Antalik /
     Transitions.dev") covers the Refine tool, not the CSS-snippet/skill library (`skills/transitions-dev/*.md`,
     `index.html`'s showcase snippets) the plan needed to copy from.
  5. Read all 3 target recipe files (`06-modal.md`, `07-panel-reveal.md`, `05-menu-dropdown.md`)
     directly — none carries its own embedded license/attribution header either.
- **Resolution:** Per the plan's Task 2 `<action>` — "FALLBACK: if the source is unreachable, SKIP
  this task, record the deviation in the SUMMARY, do NOT substitute a different source" — and the
  identical pattern the plan/UI-SPEC already establishes for ADOPT-04 ("if incompatible, SKIP and
  document the deviation… rather than substituting different content"). The source WAS reachable
  (HTTP 200 on every fetch); the failure is license-verification, which is the same underlying gate
  the unreachability fallback protects — proceeding would mean shipping externally-authored CSS
  under a license grant that does not actually exist for that content. Task 2 was skipped in full;
  no `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` utilities were added to globals.css.
- **Impact:** ADOPT-05 is now BLOCKED, not just "open" — Plan 05 ("Wire the 3 transitions to their
  consumers") has no CSS to wire. This needs a decision before Plan 05 executes: (a) find and vet an
  alternative CSS source under a confirmed-permissive license for the same 3 interaction patterns
  (modal reveal / panel reveal / dropdown reveal), (b) hand-author the 3 recipes originally (no
  copying, so no license concern) using the same literal duration/scale/easing numbers already
  locked into `27-UI-SPEC.md` (these are generic timing values, not copyrightable expression), or (c)
  escalate to the user for an explicit license call. Per this plan's `<hard_constraints>` requiring
  a documented per-source vetting outcome and the "do NOT substitute a different source" rule, no
  fallback source was substituted — this is left as an explicit open item for Plan 05 / the phase
  orchestrator.
- **Per-source vetting outcome (required by 27-UI-SPEC.md "Evidence requirement"):**
  - **Magic UI (`magicuidesign/magicui`)** — fetched + reviewed — MIT confirmed via GitHub API
    (`license.key: "mit"`) — source files reviewed line-by-line, confirmed CSS/style-object-only, no
    JS orchestration copied — no flags — 2026-07-06.
  - **`Jakubantalik/transitions.dev`** — fetched + reviewed — **NOT CONFIRMED MIT** — no LICENSE file
    in the repo, no license field in package.json, the one "MIT" statement found is scoped to an
    unrelated sub-component (Refine CLI) — **FLAGGED, task skipped, no code copied** — 2026-07-06.

---

**Total deviations:** 1 (Task 2 skipped per the plan's own explicit contingency — not a Rule 1-4
auto-fix, no code written under an unverified license).
**Impact on plan:** ADOPT-03's CSS layer ships clean and fully attributed. ADOPT-05's CSS layer does
NOT exist yet — this is a real scope gap for Plan 05, flagged prominently above and in STATE.md.

## Issues Encountered
See "Task 2 SKIPPED" above — this is the plan's own anticipated contingency (unreachable/incompatible
source), triggered here by a license-verification failure rather than unreachability. No other issues.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Plan 04** (GeneratingRing component + Chat/Studio mounts, ADOPT-03) can proceed — `.generating-ring`
  is ready to consume.
- **Plan 05** (wire the 3 transitions.dev utilities, ADOPT-05) is BLOCKED until a resolution is chosen
  for the transitions.dev license gap (alternative vetted source / hand-authored recipes / user
  decision). Do not attempt to wire `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` — they
  do not exist in globals.css.
- `apps/web` typecheck (`npm run typecheck --workspace=@nauta/web`) verified clean after Task 1's
  change.

---
*Phase: 27-adopted-external-design-picks*
*Completed: 2026-07-07*

## Self-Check: PASSED
- FOUND: apps/web/src/app/globals.css
- FOUND: .planning/phases/27-adopted-external-design-picks/27-03-SUMMARY.md
- FOUND commit: 7992ebc
