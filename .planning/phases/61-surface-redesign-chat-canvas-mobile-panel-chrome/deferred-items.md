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

## D-61-04 — `/knowledge`'s "tier" is a DIFFERENT AXIS from `_vocabulary/tier.ts`'s (Phase 62 HAZARD)

**Found:** 61-02 Task 2, while reading the canvas's existing edge treatments.

61-02-PLAN says Phase 62 "moves `/knowledge`'s tier edges onto this map". **They are not the same
axis, and the map does not fit as written.**

- `_vocabulary/tier.ts` -> `confirmed` / `suggested` / `terminal`, keyed on a component's
  **`extractionStatus`**, on the `--conf` / `--sugg` identity ladder.
- `knowledge/_components/tier-edge-style.ts` -> `EXTRACTED` / `INFERRED` / `AMBIGUOUS`, keyed on a
  knowledge-node-edge's **trust tier**, on the `--tier-extracted` / `--tier-inferred` ladder
  (D-48-04). Applies to `kne-*` edges only; structural FK edges get no override.

Two unions called "tier" sharing **not one value**. This is the same shape as the
`parseStatus` != `extractionStatus` trap 60-06 came one line from shipping — both are `string`, so
routing one through the other's map compiles, type-checks, and paints a confident lie.

`CANVAS_EDGE_TIER` deliberately does **not** claim to cover trust tiers. Note that
`chat/_canvas/knowledge-preview-mini-graph.tsx` already imports `tierEdgeStyle`, so the chat canvas
hosts BOTH vocabularies today (its own edges + the mini-graph's).

**Phase 62 must decide, not rename:** does trust tier map onto the confirmed/suggested language
(is an `INFERRED` edge "suggested"? is `AMBIGUOUS` a third thing?), or does it stay a separate axis
with its own token ladder? Either is defensible; silently merging them is not. If they merge, the
`--tier-*` ladder and `tier-edge-style.ts` retire; if they don't, say so in the brand guide so the
next reader stops re-deriving this question.

## D-61-05 — `build:local` has no root-level script

**Found:** 61-02, running the plan's verification block verbatim.

61-02-PLAN's verification says `cd apps/web && npm run build:local`, but 61-CONTEXT and several
plans quote `npm run build:local` bare. From the repo ROOT that fails with
`npm error Missing script: "build:local"` — the script exists only in `apps/web/package.json`
(`dotenv -e ../../.env.local -v NEXT_DIST_DIR=.next-verify -- next build`). Always run it from
`apps/web/`. Cheap fix for a later plan: add a root passthrough script.

## D-61-06 — EVERY `ScrollArea` in the app has Radix's `display:table` content wrapper (SYSTEMIC)

**Found:** 61-03 Task 1, by looking at a screenshot — not by any gate.

`@polytoken/ui/scroll-area`'s `ScrollAreaPrimitive.Viewport` wraps its children in a div Radix
styles **inline** with `{min-width:100%; display:table}`. `display:table` shrink-wraps to CONTENT,
so that div grows past the viewport whenever any child is naturally wider — and every descendant
then lays out against the grown width, so `flex-1 min-w-0 truncate` silently stops binding and
absolutely-positioned/`shrink-0` siblings land outside the clip.

61-03 hit this in the conversation rail: the overflow-menu button (the rail's ONLY route to Rename
and Delete) sat at x=608 against a rail whose right edge is x=464. **It was invisible, and it
predates Phase 61** (visible in 61-01's own 280px capture). Fixed at that ONE call site with
`[&>[data-radix-scroll-area-viewport]>div]:block!` — the `!` is required because Radix's `display`
is an inline style.

**Why this is logged rather than fixed globally:** the honest fix is in the shared primitive
(`packages/ui/src/scroll-area.tsx`), which every surface in the app consumes — a blast radius no
restyle plan should take unasked (`table` is load-bearing for any ScrollArea that genuinely wants a
HORIZONTAL scrollbar, which the primitive cannot know from the inside).

**Who should care, concretely:**
- **61-04** — `message-list.tsx` renders `<ScrollArea className="h-full">` around
  `<div className="mx-auto max-w-3xl …">`. `mx-auto` centres against the CONTENT box, so if any turn
  (a wide table, a long unbroken URL, a genui panel) exceeds the viewport, the whole transcript
  column silently de-centres and the composer below it — which is bounded normally — stops lining
  up. Worth measuring before restyling turns.
- **61-05 / 62** — the rail/legend/detail ScrollAreas on `/knowledge` and the canvas have the same
  wrapper.
- **A shared decision:** either fix the primitive (and let a horizontal-scroll consumer opt back
  in), or make the override an explicit, named prop. Repeating the arbitrary variant at each call
  site is the third option and the worst one.

**No gate sees it.** jsdom computes no layout; `test:geometry` measures VERTICAL document/scroller
geometry, so a horizontal overflow inside a correctly-bounded box is exactly its blind spot. Both
were green through this bug. A cheap, high-value extension for a later plan: assert
`viewport.scrollWidth <= viewport.clientWidth + ε` for the rail and the transcript — one line,
catches this entire class.

## D-61-07 — two "New chat" controls now disagree on weight (61-03 finding)

`ChatHomeEmptyState` renders its CTA through the shared `EmptyState` primitive's `action`, which
builds a FILLED ink button. 61-03 made the rail's New-chat control OUTLINED (the sketch's
`.newchat`, a hierarchy correction). So the two New-chat controls on the same route now carry
different weights.

This is arguably correct — the empty state's CTA is the only action on an otherwise empty surface,
while the rail's sits above a list where picking an existing conversation is equally valid — but it
was not a decided choice, and it is visible in
`.planning/ui-reviews/2026-07-16T01-56-41-998Z/chat-desktop-{light,dark}.png`.

**Not actioned because** `EmptyState` is a shared primitive (`~/components/empty-state`) consumed by
`entities-gallery` and others; changing its action's variant is a cross-surface decision, and
`chat-home-empty-state.tsx` is outside 61-03's `files_modified`. Whoever owns the empty/landing
surfaces should decide deliberately.

## D-61-03 — 999.25 remains open (explicitly out of scope, per 61-01-PLAN)

The screenshot fixture seeds zero entities/extractions, so pencil-amber `--sugg` has still never
rendered. The 61-01 settle work did NOT make it trivially visible — the captured chips are seeded
entity regions, not `--sugg` suggestions. Untouched by design; see 61-CONTEXT "do not block on it".
Flagged for Phase 62 as the plan requested.
