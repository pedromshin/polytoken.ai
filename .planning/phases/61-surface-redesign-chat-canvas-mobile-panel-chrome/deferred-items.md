# Phase 61 — Deferred items

Out-of-scope discoveries logged during execution. **Not fixed** — recorded so they are not
re-derived, and so the next reader is not misled by them.

## D-61-01 — `.planning/ui-reviews/dark-probe/` breaks "latest run" resolution (HAZARD)

**Found:** 61-01 Task 2, while running the plan's own verification command.

`.planning/ui-reviews/` is a directory of ISO-timestamped run dirs (`2026-07-16T00-44-36-677Z/`).
It also contains `dark-probe/` — a leftover from the throwaway 999.23 probe run earlier tonight.

Any consumer that resolves "the newest run" by lexicographic sort picks **`dark-probe`**, because
`"d" > "2"` — every ISO timestamp starts with `2026-`. This is not hypothetical: 61-01 Task 2's
own verification one-liner (`readdirSync(...).sort().pop()`, straight from the PLAN) reported
`dark-probe dark frames: 2` and PASSED — reading the **probe's** frames, not the run's 16. It
returned the right verdict for the wrong reason. Task 2 was re-verified with an ISO filter
(`/^\d{4}-/`), which found the real run: 32 PNGs, 16 light / 16 dark.

Plans 61-03..61-07 and Phases 62-63 all review these captures. Any of them resolving the newest
run by sort order will silently review 5 stale probe PNGs from a different night.

**Not actioned because:** these are the user's untracked debugging artifacts (gitignored, nothing
tracked under `.planning/ui-reviews/` except two historical `index.md` files). Deleting another
agent's scratch output unasked is not a call this executor should make.

**Fix (cheap, user or a later plan):** `rm -rf .planning/ui-reviews/dark-probe/`, and/or filter to
`/^\d{4}-/` in any "newest run" lookup. Prefer BOTH — the filter is the durable half.

## D-61-02 — `tsconfig.json` + `next-env.d.ts` auto-generated drift

**Found:** 61-01, in `git status` (pre-existing; not caused by this plan's edits).

Both files are modified in the working tree and were left **unstaged**:

- `next-env.d.ts`: `/// <reference path="./.next/types/routes.d.ts" />` -> `./.next-verify/types/...`
- `tsconfig.json`: reformatted (one-line arrays expanded), `include` gained
  `.next-verify/types/**/*.ts` and reordered.

Next.js rewrites these itself on compile, and `build:local` runs with `NEXT_DIST_DIR=.next-verify`
(`7df5ad2`), so whichever of `next dev` / `build:local` ran last wins and flips them back and
forth. They are generated files outside 61-01's `files_modified`, so they were not swept into a
commit.

**Worth deciding (not here):** whether `build:local`'s dist-dir switch should stop mutating tracked
files — right now every `build:local` dirties the tree and every `next dev` un-dirties it, which
makes `git status` noisy for every future plan in this phase.

## D-61-03 — 999.25 remains open (explicitly out of scope, per 61-01-PLAN)

The screenshot fixture seeds zero entities/extractions, so pencil-amber `--sugg` has still never
rendered. The 61-01 settle work did NOT make it trivially visible — the captured chips are seeded
entity regions, not `--sugg` suggestions. Untouched by design; see 61-CONTEXT "do not block on it".
Flagged for Phase 62 as the plan requested.
