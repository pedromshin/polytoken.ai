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

## D-61-04-A — the committed capture harness CANNOT SEE the message stream

`screenshot-review.spec.ts` never selects a conversation, so `chat-{desktop,mobile}-{light,dark}.png`
show the **empty state only** — "Ask me anything" and a New-chat button. The transcript, the turn
rhythm, the user bubble, both tool rows and every citation chip are **absent from all 4 chat
captures**, in both themes, at both viewports. 61-03 hit this too and worked around it with
throwaway probes; 61-04 did the same (a seeded 6-turn conversation, captured to the scratchpad).

This is worth stating plainly: **the surface 61-04 redesigned has zero coverage in the committed
visual review.** Every visual claim in 61-04-SUMMARY.md rests on a throwaway probe that no longer
exists. The next reviewer looking at `.planning/ui-reviews/` will see an empty chat column and have
no way to know the stream was ever looked at.

**Not actioned because** `screenshot-review.spec.ts` is 61-01's file and outside 61-04's
`files_modified`, and seeding a conversation-with-turns fixture into the shared harness affects
every future capture run (it changes what "the chat surface" means for Phases 62-63 too). The fix is
cheap and known — the probe recipe is in 61-04-SUMMARY.md — but it is a harness decision, not a
restyle. **Whoever owns the harness next: seed one settled conversation and select it.** Until then
"the chat captures look fine" means "the chat EMPTY STATE looks fine".

## D-61-04-B — `chat/` still cannot join `role-hue-ban`'s SCOPED_DIRS, and here is the exact cost

61-03-SUMMARY told 61-04/61-05 to append `chat/` to the ratchet. **61-04 cannot**, and this was
measured rather than assumed:

| Family | Count | Where |
|---|---|---|
| madder text/border on a STATE | 13 | `chat/_canvas/` (edit-params, retheme, edge-creation-picker, add-knowledge-preview-popover, email-thread-node, unknown-node-type-placeholder) |
| madder text/border on a STATE | 11 | `chat/_components/` (**cost-cap-blocked-card**, inline-error-card, and others) |
| retired role-as-hue (`text-graph-email`) | 2 | `_canvas/email-thread-node.tsx` |
| retired role-as-hue (`text-graph-email`) | 1 | `_components/thread-cluster-indicator.tsx` |

12 files total. Adding `chat/` now makes the gate **red on arrival**, which that gate's own header
names as the failure mode that gets a ratchet "allowlisted into meaninglessness within a week".

61-04 swept what its plan scoped (the two tool rows) and **pre-cleared** them. The remainder is
mostly `_canvas/` (61-05/61-06's surface) plus two `_components/` files 61-04 does not own:
`cost-cap-blocked-card.tsx` / `inline-error-card.tsx` (D-19/D-21's cards — a *state* wearing a
madder border, so a real law-1 question, not just a ratchet chore) and `thread-cluster-indicator.tsx`
(Phase 45's). **The ratchet append belongs to the LAST plan that sweeps `chat/`, and it should be
one of that plan's tasks rather than a footnote.**

## D-61-04-C — the assistant's prose measure is ~120 characters, and the column is the wrong fix

`max-w-3xl` (768px) minus `px-4` leaves a 736px measure. At Phase 59's `text-sm` (13px) body step
that is **~120 characters per line** — well past the 45-75 typographic ideal, and longer than
comparable chat products, which run ~85-95 at a *larger* font in the same width.

The cause is traceable and nobody decided it: `max-w-3xl` was chosen when the body step was larger.
**Phase 59 dropped the body to 13px and lengthened the measure by ~20% without the column ever being
re-decided.**

**Not actioned, deliberately** (see 61-04-SUMMARY.md's reading-column decision): the column is a
LAYOUT number — the composer aligns to it (61-03) and 61-07 renders panels into it — and narrowing
it to `max-w-2xl` only reaches ~103 chars while squeezing every table, code fence and panel the same
column carries. The right instrument is a prose-level cap on the paragraph in `markdown-renderer.tsx`
(which 61-04's plan explicitly scopes out), leaving panels at full column width. **Whoever picks this
up: change the prose, not the column.**

## D-61-05-A — the CANVAS still has zero coverage in any committed capture

61-01 added the theme axis and a `chat-thread` surface that selects a conversation, which finally
made 61-04's message stream reviewable. **The canvas is still invisible**: `chat-thread` captures
the surface with the header toggle on **Chat**, and the canvas only mounts on **Canvas**. So every
committed PNG of `/chat` shows either the empty state or the transcript — never the board.

This is not academic. 61-05 found FOUR pieces of stock chrome on the canvas (white controls, white
minimap, navy handles, a stock-grey arrowhead), **every one invisible in light and glaring in dark**,
by driving a throwaway probe. **61-06 owns `data-edge.tsx` and all four node components** — i.e. it
redesigns a surface no committed capture can see, exactly as 61-04 did.

**The recipe is ~30 lines and 61-05 ran it working.** Add a `chat-canvas` surface alongside
`chat-thread`:

1. Seed a `chat_canvas_layouts` row for the fixture conversation (`screenshot-fixtures.ts`):
   `nodes` = a `chat` node (`data.conversationId`) + an `email-thread` node
   (`data.threadId` = the existing `FIXTURE_THREAD_ID`); `edges` = one
   `{ id, source, target, data: { sourcePath, targetKey } }` (restored as a `data-edge` by
   `toFlowEdge`); `viewport` = `{ x, y, zoom: 1 }` — **zoom 1 matters**: at 0.75 the grid is
   sub-pixel and unjudgeable. `node_registry_version` must be `NODE_REGISTRY_VERSION` (imported from
   `_canvas/node-registry-version`) or the nodes degrade to the inert placeholder.
2. After selecting the conversation, click `getByRole("tab", { name: "Canvas view" })`.
3. Optionally click `getByRole("button", { name: "Toggle minimap" })` — the minimap is session-only
   and off by default, and it is where the worst of the stock chrome lived.

**Do NOT go near `saveCanvasLayout`** (T-61-21) — this is a direct fixture seed, not the app's save
path. Note the fixture conversation gets an auto-seeded `chat:<conversationId>` node too
(`withDefaultChatNode`), so the board shows one extra chat node; give the seeded chat node the same
id or expect two.

## D-61-05-B — `canvas-keyboard-hint.tsx` is still an opacity trick

`border-t border-border/50 bg-background/95` — the last `bg-background/95` on the canvas after 61-05
turned the top-right Panel cluster into a real card. Same defect class (a 95%-opaque page ground
floated over the board instead of a designed surface), same fix (`border-hair` + a real ground). It
spans the board's full width and overlaps both the Controls card and the minimap.

**Left to 61-06**, which is already sweeping `chat/_canvas/`. 61-05 scoped Task 2 to `chat-canvas.tsx`
and had already extended into three sibling files (the two Add-* popovers + the save-status
indicator) to keep the Panel cluster from shipping as three controls that disagree; a fourth
component with its own dismissal behaviour was a step too far for a plan that does not own it.

## D-61-05-C — the plan's own §F comment-hazard check is RED ON ARRIVAL, and over-broad

61-05-PLAN Task 1's `<automated>` block scans **every** comment in `globals.css` for a
token-name-plus-colon. It fails on two **pre-existing** comments, neither of them 61-05's:

- Phase 59's law-3 shape-vocabulary block — *"drawn in `--faded`, not `--ink`: per the sketch's own
  finding…"*
- Phase 27's ADOPT-05 block — *"…its own documented duration tokens: `--duration-quick: 150ms`…"*

Measured: **2 matches at HEAD before 61-05, 2 after** — the plan's command could never have passed.

It is also over-broad. The real §F hazard is a comment inside one of the FOUR blocks
`readTokenBlock` actually parses (`:root` / `.dark` / `@theme inline` / `@theme`), because only there
can a comment's `--name:` substring swallow the next real declaration. Both offenders sit at top
level, outside every parsed block, so they are inert. 61-05 verified the **scoped** version instead
and it is clean (0 token-colon, 0 stray-close across all four blocks).

**Not actioned:** both comments belong to other phases and neither can harm anything. If the check is
ever promoted to a committed gate, scope it to the parsed blocks — a file-wide version is red on
arrival and will be deleted rather than obeyed.

## D-61-05-D — 61-03/61-04's `(--custom-property)` call sites can now become utilities

61-05 registered all nine unregistered palette tokens, so `hover:bg-(--fill-hi)` (composer send),
`hover:border-(--rule-hi)` (rail New-chat) and friends can now be spelled `hover:bg-fill-hi` /
`hover:border-rule-hi`. Both spellings emit identical CSS — **verified in the built sheet** — so this
is tidying, not a fix, and it was left alone: those are 61-03's files and a cosmetic sweep of a
committed plan's call sites is not worth a merge conflict. `bg-ink/5` stays legal too (D-61-03-B):
`bg-ink/5` and `bg-ink-05` are the same colour by construction.

## D-61-06-A — the node SELECTION treatment is in no committed capture

61-06 changed every node shell's selection from `ring-2 ring-primary ring-offset-1` to an ink
OUTLINE (law 1 says it out loud instead of reaching through `--primary`; D-61-05-6/D-61-03-F say
outline over ring, because `--tw-ring-offset-color` defaults to `#fff` and paints a white halo
around every selected node in dark).

**What was verified:** the classes EMIT (`outline-2` / `outline-offset-2` / `outline-ink`, matched
by exact escaped selector in the built sheet — note `outline-2` emits as TWO rules, the minifier
splits `outline-style` and `outline-width:2px`, and `@property --tw-outline-style` defaults to
`solid`), and `canvas-node-law.test.tsx` asserts the selected-vs-unselected class difference is
non-empty, names ink, and carries no tier hue.

**What was NOT verified: how it looks.** The `chat-canvas` fixture seeds no selected node, so no
committed PNG shows a selected card in either theme.

**Not actioned because** seeding selection means either persisting a `selected` flag (not part of
the persisted node schema — `toFlowNode` would drop it) or clicking a node in
`screenshot-review.spec.ts` before the capture, which changes what "the canvas surface" means for
every future run and risks a drag/misclick on the `x` control in a harness that currently passes
`select:ok tab:ok` on both themes. That is a harness decision, not a restyle. **Cheap recipe for
whoever owns it next:** click the thread card's header row (NOT the card body, and avoid the
`x` at its right edge) after switching to Canvas view, then assert `.react-flow__node.selected`
exists before shooting.

## D-61-06-B — the canvas Controls card was covering the React Flow attribution (fixed as a side effect)

Worth recording because T-61-16 makes it a contract, not a preference: the keyboard-hint bar's
full-width `bg-background/95` strip spanned the bottom of the board and sat on top of the
attribution as well as the Controls card. 61-05 restyled the attribution to stay visible and left
`proOptions={{ hideAttribution: false }}` untouched — correctly — while a sibling component was
quietly painting over it anyway. Turning the hint into a bottom-centre card (61-06) revealed the
attribution in the committed capture for the first time. **No gate saw this**: 61-05's stock-ban
gate reads the stylesheet and would report the attribution's own selectors as correctly themed,
which they were. An element being OCCLUDED by an unrelated sibling is invisible to every gate this
phase has.

## D-61-06-C — two `_canvas/` components had never been mounted by any test

`data-edge.tsx` and `unknown-node-type-placeholder.tsx` both lacked `import * as React`, so both
threw `ReferenceError: React is not defined` the first time 61-06's gate mounted them (vitest's
esbuild transform defaults to the CLASSIC JSX runtime; every sibling shell carries the import and
a comment explaining it). Both are fixed at their sites.

The point for later plans: **the missing import is not the finding — the reason it survived is.**
Nothing had ever mounted either component, so `data-edge.tsx` shipped since Phase 23 and the
placeholder since Phase 26 with zero component-level coverage. Both are CANVAS-03/T-23-05 surfaces
(the placeholder IS the degrade-gracefully mitigation for an untrusted persisted `node.type`). If
you add a component under `_canvas/`, check that something mounts it; the `React` import is a
symptom that only shows up when something finally does.

## D-61-06-D — `chat/_components/` still blocks the `role-hue-ban` ratchet (11 madder, 2 files + one more)

61-06 cleared **all** of `chat/_canvas/` — the three violations its plan named, a fourth found by
reading (the thread card's error icon), and six more measured in four sibling files the plan does
not list (validation/server errors in `add-knowledge-preview-popover`, `edge-creation-picker`,
`controls/edit-params-control`, `controls/retheme-control`). So the `_canvas/` half of D-61-04-B is
done and 61-08's precondition holds for that subtree.

**`chat/_components/` is untouched and still red.** D-61-04-B's count stands there: ~11 madder
text/border, concentrated in `cost-cap-blocked-card.tsx` / `inline-error-card.tsx` (D-19/D-21's
cards — a *state* wearing a madder border, so a real law-1 question and not just a ratchet chore)
plus `thread-cluster-indicator.tsx`'s retired role-as-hue (Phase 45's). **61-08 must clear those
before appending `chat/` to `SCOPED_DIRS`**, or the gate is red on arrival — the exact failure its
own header names as how a ratchet gets "allowlisted into meaninglessness within a week".

## D-61-07-A — genui style packs are LIGHT-ONLY, so every genui panel is a white card in dark mode (SYSTEMIC)

**Found:** 61-07 Task 2, by looking at `chat-thread-desktop-dark.png` — after fixing the harness
so a dark transcript could be photographed at all (see D-61-07-B).

`PanelThemeScope` injects `getStylePack(packId).resolvedVars` — `--card`, `--background`,
`--foreground`, `--border` and friends — as inline CSS vars. **`packs.ts` has no dark variants**, so
those values are light in both themes. A genui panel therefore renders as a **blazing white card in
the dark app**, with dark text, surrounded by dark chrome.

**This is PRE-EXISTING and it is not 61-07's doing**, which is worth stating precisely because
61-07 makes it visible on a second surface:

- `GenuiPanelNode` has wrapped every panel in `PanelThemeScope` since Phase 23 — including
  pack-LESS specs, which resolve to `DEFAULT_PACK_ID` via `resolveActivePanel`. So the canvas's
  panel nodes have been light-on-dark for three milestones. Visible in
  `.planning/ui-reviews/2026-07-16T06-24-06-201Z/chat-canvas-desktop-dark.png` (the "From turn 0"
  node, bottom-right).
- The docked transcript previously rendered a pack-less spec with NO theme scope at all, so it
  inherited the app's dark tokens. 61-07 mirrors the canvas's chain exactly — as its plan requires
  in three separate places ("if the canvas and the transcript resolve differently, the bug you
  shipped is the bug you set out to fix") — so the transcript's panels are now light-on-dark too.

**The two surfaces now AGREE, which is criterion 4's actual requirement**, and the same capture
shows it: the ChatNode's transcript panel and the genui-panel node render the same content in the
same pack. Not wrapping pack-less specs would have made the transcript disagree with the canvas for
the COMMON case (most specs carry no `style_pack_id`) — i.e. it would have re-created 999.17.

**Not actioned because** the fix is to give `packs.ts` dark variants (or to make `ThemedRoot`/
`PanelThemeScope` theme-aware), which is an architectural change to `packages/genui`'s theme
contract affecting `/studio`, the catalog, and every genui surface in the app — Rule 4, not a
restyle. **Whoever picks this up:** the question is whether a style pack is a *light-mode design
artifact the app frames* (in which case a panel should perhaps sit on its own light plate
deliberately, and this is a feature) or a *theme that must follow the app* (in which case packs need
dark ladders). That is a product decision, and it should be made once for both surfaces rather than
patched on one.

## D-61-07-B — the dark `chat-thread` captures were photographs of the CANVAS (FIXED, recorded as a pattern)

**Found:** 61-07, by opening `chat-thread-desktop-dark.png` and noticing the header toggle read
**Canvas**.

`chat-thread` and `chat-canvas` are the SAME conversation. `chat-canvas` clicks "Canvas view", and
`chat-canvas-view-toggle.tsx` PERSISTS that choice to
`localStorage["polytoken.chat.canvas-view:{conversationId}"]` — correctly; a user's view choice
should survive a reload. The capture loop reuses one browser context across every surface and both
theme passes, so the light pass's `chat-canvas` left "canvas" behind and the dark pass's
`chat-thread` faithfully restored it — capturing the BOARD under the transcript's filename, with
`select:ok` in `index.md` beside it.

True since `chat-canvas` joined the surface list (61-05). **No gate could see it**: the harness is a
camera, and the picture was of a real, correctly-rendered surface — just not the one on the label.
It is the D-61-01 defect's cousin: a verification artifact that returns a confident answer to a
question nobody asked.

**Fixed** in 61-07 (`screenshot-review.spec.ts`): an `addInitScript` drops every
`polytoken.chat.canvas-view:*` key before each capture, so each surface renders the mode its own
definition asks for. Clearing storage rather than clicking "Chat view" because the toggle does not
exist below `md` and `openTabName`'s wait gates on the React Flow pane only the canvas mounts.

**The pattern worth carrying:** any surface whose state persists to localStorage will BLEED into
every later capture in the run, in file order, silently. `chat:canvas-view` was one. Phases 62-63
add more persisted UI state; reset it per capture rather than per run.

## D-61-07-C — the seeded genui-panel node lands OUTSIDE the canvas fixture's viewport

**Found:** 61-07, in `chat-canvas-desktop-dark.png` after seeding a genui_spec part.

The `chat-canvas` fixture seeds a layout row with a chat node + an email-thread node + one edge. It
does NOT seed a node for the new genui_spec part, so `reconcileNodesFromHistory`'s Pass 2 places one
itself (dagre-seeded, `offsetCascadePosition`-nudged) — at the board's bottom-right, **half outside
the seeded viewport**. Its header, pack switcher and card are legible enough to verify against, but
it is clipped.

**Not actioned because** the canvas board is not 61-07's criterion and the panel node was visible
enough for the claim being made. **61-08 should fix it**: it redesigns `PanelActionsToolbar`, which
lives in that node's header, and will want the node fully in frame. The cheap fix is to add a
`genui-panel` node to `SEEDED_CANVAS_NODES` at a chosen position with
`id = genuiPanelNodeId(messageId, partIndex)` — the message id is the fixture's own assistant row,
so it needs reading back after insert.

## D-61-08-A — 60-07's `.next`-corruption tell-tale is OVER-BROAD (would order a needless `rm -rf`)

**Found:** 61-08 Task 3, running 60-07's own liveness check before reviewing frames.

61-08-PLAN §G (inheriting 60-07) names the tell-tale of a corrupted `.next` as "production
artifacts (`BUILD_ID`, `prerender-manifest.json`, `server/pages/_document.js` — a Pages-Router file
in an App-Router app) beside `.next/static/development`", with the recovery "stop the server,
`rm -rf apps/web/.next`, restart".

**Two of those three are normal `next dev` output**, and following the heuristic literally would
have had me destroy a perfectly healthy dev server mid-plan:

| Artifact | Measured | Verdict |
|---|---|---|
| `.next/BUILD_ID` | **absent** | the real discriminator — this is what a production build writes |
| `.next/prerender-manifest.json` | `2026-07-15 20:22:04.202` | **dev output** — same second as `.next/static/development` (`20:22:04.134`) and `.next/package.json` (`20:22:03.520`), i.e. written by the dev server at startup |
| `.next/server/pages/_document.js` | `2026-07-16 03:09:56` | **dev output** — Next compiles a default Pages-Router document even in an App-Router app |
| `.next-verify/BUILD_ID` | `2026-07-16 03:18:17` | `build:local`'s target since `7df5ad2`, working correctly |

**The rule that actually holds: `BUILD_ID` inside `.next/` is the discriminator.** Since `7df5ad2`,
`build:local` runs with `NEXT_DIST_DIR=.next-verify`, so a production `BUILD_ID` should never appear
in `.next` — and if it does, a second compiler really did write there (999.22). The other two
artifacts carry no signal at all.

**Also worth keeping**: the decisive liveness proof is not artifact archaeology, it is
`curl`ing the linked stylesheet and confirming it contains something you *just changed*. 61-08 did
that (the `@utility touch-target` rule appeared in the served sheet within seconds of the edit),
which proves the dev server is compiling current source — a much stronger claim than any file's
presence.

**Not actioned because** §G's wording lives in 60-07's summary and this phase's plans, not in a
committed gate. Whoever writes the Phase 62 briefs: carry the corrected rule, not the original list.

## D-61-08-B — `touch-target`'s three OTHER call sites were dead too (fixed at the root, verify if you move them)

**Found:** 61-08 Task 1, measuring the built stylesheet.

`pointer-coarse:touch-target` emitted NOTHING because `touch-target` was declared with
`@layer utilities` (plain CSS, name never registered) instead of `@utility`. Fixed at the root in
`globals.css`, which repairs **all four** call sites at once:

1. `controls/panel-action-button-class.ts` — the panel toolbar's four icon buttons. **This one was
   live and reachable**: 61-08 mounts that toolbar in the mobile transcript, and the buttons
   measured **24×24px** on a touch device before the fix.
2. `canvas-keyboard-hint.tsx` — canvas only.
3. `email-thread-node.tsx:183` — canvas only.
4. `knowledge-preview-node.tsx:136` — canvas only.

2–4 are canvas-only, and the canvas never mounts below `md` (`effectiveViewMode = isMobile ? "chat"
: viewMode`), so they were unreachable by a phone — but they are reachable by a **touch laptop or a
tablet ≥768px**, where `(pointer: coarse)` matches at a desktop width. They are now genuinely
44px for the first time. **Not separately verified by measurement** (61-08's e2e gate measures the
toolbar's four, which share the same constant and the same root fix); if a later phase moves any of
them onto a different recipe, measure it rather than trusting the class string.

**The generalisable warning:** `touch-target-pointer-coarse.test.tsx` asserted the class STRING and
was green for three milestones while the rule never rendered. Its own header called a class-string
assertion "the correct, and only testable, contract at this layer". Any custom utility reached only
through a variant has this failure mode. If you add one, declare it with `@utility` and prove it
emits in the built sheet.

## D-61-07-D — no MOBILE capture of the transcript with a conversation selected

`chat-thread`/`chat-canvas` record `select:n/a-overlay-rail` on mobile: below `md` the rail is an
overlay Sheet, so no conversation row exists to click without opening it. Every mobile chat capture
is therefore the EMPTY STATE, and criterion 4's "docked/**mobile** transcript" half has no
photograph.

**Deliberately not actioned.** `screenshot-review.spec.ts`'s own header records that **two** prior
attempts at driving the rail toggle were actively harmful ("NO TOGGLE CLICKING... so the third
person does not try a fourth"). A third attempt against an explicit warning, in a harness that
currently passes, is not a trade 61-07 should make for a photograph of a code path that is
*identical* to the desktop one it did photograph.

**What covers mobile instead, stated honestly:** `effectiveViewMode = isMobile ? "chat" : viewMode`
means mobile renders the SAME docked branch, the same `TranscriptPanelHost`, the same `MessageTurn`
— there is no mobile-specific transcript code. And `chat-mobile-feed.test.tsx` proves the host
genuinely mounts there: its tRPC mock had to learn `getCanvasLayout`/`saveCanvasLayout` in this
plan, because the mobile docked branch now really queries them. That is mechanism evidence, not a
picture. **If a picture is wanted**, the honest route is a `Surface` flag that opens the rail Sheet,
selects, and closes it — designed deliberately, by whoever owns the harness, not bolted on.
