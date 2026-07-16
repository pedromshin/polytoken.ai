---
phase: 61-surface-redesign-chat-canvas-mobile-panel-chrome
plan: 03
subsystem: chat-surface
tags: [chat, rail, composer, law-1, SURF-02, tailwind-v4, radix, geometry]
requires:
  - "61-01's npm run test:geometry (run after every structural edit here)"
  - "Phase 59's density steps + the --ink/--shade/--hair/--leaf/--bright token ladder"
  - "58-IDENTITY.md D-58-01 laws 1/2 (LOCKED)"
provides:
  - "the merged single header rule (ChatHeaderRule) — 61-04/61-07 mount into it, not above it"
  - "conversation-rail.tsx at the sketch's 208px with an outlined New-chat control"
  - "selection as fill+weight, no hue (.citem.on) — the row contract 61-04+ inherit"
  - "composer.tsx: ink send fill, ink focus OUTLINE, hairline dock, zero shadow"
  - "chat-frame-structure.test.tsx — 7 legs, all four negative proofs executed"
affects:
  - "61-04 (owns message-list.tsx: the max-w-3xl reading column is now a PAIR decision; D-61-06 hazard)"
  - "61-05 (owns @theme registration for --rule-hi/--fill-hi/--ink-05, consumed here via var())"
  - "61-04/61-05 (must append chat/ to role-hue-ban's SCOPED_DIRS — conversation-row is pre-cleared)"
tech-stack:
  added: []
  patterns:
    - "say the token where the sketch says it — never inherit ink through primary's indirection"
    - "verify every new class EMITTED in built CSS; a naive grep of built CSS lies (escaping)"
    - "tailwind-merge groups are not intuitive: outline-none survives outline-2"
    - "look at the surface; jsdom and a vertical geometry gate were both green through a real bug"
key-files:
  created:
    - apps/web/src/app/chat/_components/__tests__/chat-frame-structure.test.tsx
  modified:
    - apps/web/src/app/chat/page.tsx
    - apps/web/src/app/chat/_components/conversation-rail.tsx
    - apps/web/src/app/chat/_components/conversation-row.tsx
    - apps/web/src/app/chat/_components/composer.tsx
    - .planning/phases/61-surface-redesign-chat-canvas-mobile-panel-chrome/deferred-items.md
decisions:
  - "D-61-03-A: the reading column STAYS max-w-3xl — it is the transcript's number, not the composer's; moving it alone misaligns the pair, moving both is 61-04's call"
  - "D-61-03-B: --ink-05 is consumed as bg-ink/5 — not an approximation but the SAME colour by construction, proven in emitted CSS"
  - "D-61-03-C: 44px touch floor beats the sketch's 36px send and 32px row (D-48-07)"
  - "D-61-03-D: the rail row is title-only (the sketch's .citem) — the timestamp restated the list's own updatedAt DESC sort"
  - "D-61-03-E: the row's Delete menu item is INK, not madder — it opens a CANCELLABLE dialog; the dialog's own Delete keeps the madder fill"
  - "D-61-03-F: focus is an OUTLINE, not Phase 60's ring — --tw-ring-offset-color defaults to #fff (a white halo in dark)"
metrics:
  duration: ~90 min
  completed: 2026-07-16
  tasks: 3
  commits: 4
  tests_added: 7
---

# Phase 61 Plan 03: The Chat Frame, Rail & Composer — Summary

Merged `/chat`'s two stacked `h-11` bars into one header rule beside a now full-height 208px
registry rail, corrected the New-chat control from a filled ink block to the sketch's outlined
`.newchat`, restated selection as fill **and weight** with no hue, and rebuilt the composer as an
ink control on a hairline rule with zero shadow — then **found, by looking at it, that the rail's
overflow menu has been off-screen this whole time**, taking Rename and Delete with it.

## What Shipped

| Task | Commit | What |
|------|--------|------|
| 1 | `26de79e` | the frame + the rail + the row |
| 2 | `ca520b4` | the composer |
| 3 | `e1d0b24` | `chat-frame-structure.test.tsx` (7 legs) |
| — | `0e47899` | **Rule 1 fix:** the rail's overflow menu was clipped off-screen |

## Per-File Changes

**`apps/web/src/app/chat/page.tsx`** — the frame.

- **Two `h-11` bars became ONE.** ChatPage's own bar (rail toggle + a "Chat" title the nav rail
  already says) is gone. The remaining rule lives in the MAIN COLUMN beside a full-height rail —
  never spanning it, which is what made the old page bar read as a third stacked bar. That is the
  sketch's frame (`#chat`, lines 992-1032: rail full height, column beside it, no page-title bar).
- New local `ChatHeaderRule` component — used by ConversationView AND by the empty/loading branch,
  so the header never appears/disappears as conversations are selected and deleted.
- `railToggle` is **constructed in ChatPage** (which owns both booleans) and passed down as a
  `React.ReactNode` prop. One element, one definition, one aria contract, still outside the rail's
  subtree so it survives the rail collapsing to 0px (D-11).
- The docked chat body lifts to `bg-bright` — the sketch's `.chatcol`. Chrome stays on the page
  ground (`--shelf`).
- **A height-chain bug avoided, not discovered:** `EmptyState`'s `centered` layout is
  `flex h-full flex-col …` (`empty-state.tsx:129`). Pre-61-03 it was the column's only child, so
  `h-full` meant "the column". With a 44px header above it, an unwrapped `h-full` resolves to
  44px + 100% and scrolls the document by exactly the header's height. Both branches are now wrapped
  in `min-h-0 flex-1`, mirroring ConversationView's own body wrapper.

**`apps/web/src/app/chat/_components/conversation-rail.tsx`** — the registry.

- 280px → **208px** (`w-52` IS 208px on Tailwind's scale). `RAIL_WIDTH` declared once: three places
  must agree or the collapse animation tears.
- `.convrail`'s `padding:14px 10px` → `px-2.5 py-3.5`; `gap:2px` → `gap-0.5`. **Not `p-panel`**
  (20px): that step was measured off 236-280px panels and would spend 40 of 208px on air. Reaching
  for a named step is the rule; reaching for the *wrong* named step because it is named is not.
- `border-border/50` → `border-hair`; `bg-background/95` → `bg-shelf`. A hairline is a token here,
  not an opacity trick on a heavier rule, and the rail was previously the *same colour as the
  column, at 95% of it*, for no stated reason.
- **The New-chat control: `variant="default"` → `variant="outline"`.** It was a FILLED INK block —
  the single loudest control on the surface — spent on the least consequential action on it. Plus
  `bg-bright` (the variant fills with the page ground; the sketch fills with `--bright`),
  `shadow-none`, `hover:border-(--rule-hi)`, and `text-sm font-semibold` (`size="sm"` gives the
  right box but `text-xs`/`font-normal`; `.newchat` is 13px/600).
- `-mx-2.5` on the ScrollArea + `px-2.5` on its content: the scrollbar rides the rail's true edge
  while rows keep the 10px gutter.
- The `RailSkeleton` row is now `h-8`, matching the real single-line row rather than being a taller
  ghost of the list it stands in for. Its `aria-busy`/`aria-label` are untouched — 61-01's capture
  settle keys on them.

**`apps/web/src/app/chat/_components/conversation-row.tsx`** — the row.

- **Selection is fill AND weight, no hue:** `bg-shade font-semibold text-ink` vs
  `text-faded hover:bg-ink/5 hover:text-ink`. It shipped as `bg-primary/10 text-primary` — already
  hueless, but only *by accident of an indirection* (`--primary: var(--ink)`), and stated with fill
  alone. **The weight is the half that was missing**, and it is the half that survives greyscale and
  a fill too faint to see.
- Single-line truncated title (`.citem`); `data-field="conversation-row"` + `data-active` added so
  the gate can find rows semantically rather than by colour.
- T-61-07 honoured: `conversation.title` stays a plain React text node, never interpolated into a
  class, a style, or `dangerouslySetInnerHTML`.

**`apps/web/src/app/chat/_components/composer.tsx`** — the ink control.

- Dock: `shadow-elevation-2` **removed** ("flat surfaces, hairline rules, zero shadow anywhere" —
  the hairline rule IS the separation); `border-border/60` → `border-hair`; `bg-background` dropped
  so it inherits the column's `--bright` instead of drawing a tone seam across a surface the sketch
  treats as one.
- Send: `bg-ink text-on-fill hover:bg-(--fill-hi)`. It resolved to ink already via
  `variant="default"` → `bg-primary` → `--ink`; `hover:bg-primary/90` is stock shadcn's opacity
  trick wearing ink's clothes — **90% of ink is not `--fill-hi`, which is a DARKER ink in light mode
  and a BRIGHTER one in dark.** Stop is ink on `--shade`, never madder: interrupting is not
  destroying.
- Field: `bg-leaf border-rule placeholder:text-pencil shadow-none` (the primitive's
  `muted-foreground` resolves to `--faded`, one step louder than the sketch asks).

## The Bug I Found By Looking — the rail's overflow menu was off-screen (`0e47899`)

The plan said to read the PNGs at full size. The first capture showed titles running past the rail's
edge with no ellipsis and **no `...` button on any row**. The 46px row pitch proved the 44px button
was in the DOM — so it was somewhere off to the right. Measured in a real browser at 1440x900:

| | before | after |
|---|---|---|
| ScrollArea viewport width | 208 | 208 |
| viewport **scrollWidth** | **406** | **208** |
| content div `display` | **`table`** | **`block`** |
| content div width | **406** | **208** |
| row width | 386 | **188** |
| title button | 340 (never clipped) | **142** (ellipsized) |
| `...` button | **x=608 → 652** | **x=410 → 454** |

**The rail's right edge is x=464.** The overflow menu — the rail's ONLY route to Rename and Delete —
sat 144px outside it, clipped by `overflow-hidden`.

Radix's `ScrollArea.Viewport` wraps its children in a div it styles **inline** with
`{min-width:100%; display:table}`. `display:table` shrink-wraps to content, so it grew to the widest
row and every descendant laid out against 406px: the title's `flex-1 min-w-0 truncate` never bound
(its `text-overflow:ellipsis` *computed* — it just had nothing to overflow), and the `shrink-0`
button landed past the clip.

**It is PRE-EXISTING, not a 61-03 regression** — 61-01's own 280px capture
(`2026-07-16T00-44-36-677Z/chat-desktop-light.png`) shows the same missing button. Narrowing to
208px only made it obvious. Fixed with `[&>[data-radix-scroll-area-viewport]>div]:block!`; the `!` is
required because the offending `display` is an inline style, and `block` is correct because `table`
exists only so Radix can measure content width for a horizontal scrollbar this rail must not grow.

**Why no gate caught it, stated plainly:** jsdom computes no layout, and `test:geometry` measures
**vertical** document/scroller geometry — a *horizontal* overflow inside a correctly-bounded rail is
precisely its blind spot. Both were green through this bug, before and after. Logged as **D-61-06**
with the systemic version (every `ScrollArea` in the app has this wrapper; `message-list.tsx`'s
`mx-auto max-w-3xl` transcript is the one 61-04 should measure) and a cheap one-line gate extension
that would catch the whole class: `viewport.scrollWidth <= viewport.clientWidth + ε`.

## The Other Thing That Would Have Shipped Invisible: `outline-none` survives tailwind-merge

The plan asks for focus as the sketch's `outline:2px solid var(--ink); outline-offset:1px`. Writing
`focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-1` produces a class
list that reads perfectly and **renders nothing**:

- the vendored `Textarea` base carries `focus-visible:outline-none`;
- tailwind-merge does **not** drop it — `outline-none` is in the outline-**style** group,
  `outline-2` is outline-**width**. Both survive. Verified directly:
  ```
  outline-none survived: true
  ```
- and in the built sheet, `outline-none` is emitted **after** `outline-2`:
  ```
  .focus-visible\:outline-2:focus-visible{outline-style:var(--tw-outline-style);outline-width:2px}
  .focus-visible\:outline-none:focus-visible{--tw-outline-style:none;outline-style:none}
  ```
  so it wins twice over — directly, and by poisoning the very variable `outline-2` reads.

Fix: add `focus-visible:outline-solid`, which IS in the outline-style group and therefore evicts
`outline-none` through twMerge (`outline-none EVICTED: true`). Chosen over Phase 60's
`ring-2 ring-ink ring-offset-1` idiom because `--tw-ring-offset-color` defaults to `#fff` — a
ring-offset here paints a **1px white halo in dark mode**; an outline-offset just reveals the ground
behind it, in both themes, which is what the sketch drew (**D-61-03-F**).

The focus outline is visible in `probe-chat-focus-{light,dark}.png` — I confirmed it renders rather
than trusting the class list.

## Decisions the plan asked me to record

**The reading-column width — `max-w-3xl` KEPT (D-61-03-A).** Not "because it is already 3xl": it is
**not this component's number**. It is the transcript's reading column (`message-list.tsx:124`,
`mx-auto max-w-3xl px-4`), and the composer's job is to line its field up with the text above it.
Narrowing it here alone *misaligns the pair*; narrowing both means editing `message-list.tsx`, which
is **61-04's file** and 61-04's call to make with the turns in front of it. The sketch's 388px
`.chatcol` is not the number to import — that is a chat column sharing a frame with a board, whereas
this column owns the full width and the canvas is a **toggled view, not a sibling**. **61-04: the
column width is now a two-file decision; if you move it, move both.**

**`--ink-05` → `bg-ink/5` (D-61-03-B).** Not an approximation — the **same colour by construction**:
`--ink-05` is declared as `--ink`'s own oklch at `/0.05` in both themes (`globals.css:516`, `:639`),
and `bg-ink/5` emits `color-mix(in oklab, var(--ink) 5%, transparent)`. Verified in built CSS:
```
.bg-ink\/5{background-color:var(--ink)}
@supports (color:color-mix(in lab,red,red)){.bg-ink\/5{background-color:color-mix(in oklab,var(--ink) 5%,transparent)}}
```
Preferred over "`bg-shade` at a lower emphasis" because **`--shade` is what SELECTION uses** — a
hover borrowing the selected fill would say "chosen" on mouseover. No new token invented; 61-05 may
register one, but this call site does not need it to be correct.

**44px vs the sketch's 36px (D-61-03-C).** The sketch draws `.send` at 36px and `.citem` at ~32px.
Both stay at the project's committed 44px touch floor (D-48-07) — the send control via `size-11`,
and the row because its `size-11` overflow button, not its text, sets its height. Where the sketch
and an accessibility floor disagree, **the floor wins**, per the plan and per brand-guide §3's
"Documented deviations from the sketch — and why". The cost is real and worth naming: the 44px
button leaves the title 142px of a 208px rail (~20 characters). Real titles ("Freight quote — Lote
88") mostly fit; the pathological fixture titles in the captures do not.

## Deviations from Plan

**1. [Rule 1 — Bug] The rail's overflow menu was clipped off-screen.** Full detail above.
Pre-existing; found by looking, invisible to both gates. *Commit `0e47899`.*

**2. [Rule 2 — law 1 correctness] The row's Delete menu item is INK, not madder (D-61-03-E).**
It shipped as `text-destructive focus:text-destructive`. Two things are wrong with that, and only
one is the gate's:
- **Law 1 substance:** madder means "irreversible — this cannot be undone". *This item is not that*
  — it opens the rail's confirm dialog, which is cancellable. The genuinely irreversible control is
  that dialog's own Delete, and it already wears madder as a **fill**
  (`delete-conversation-dialog.tsx:60`), the treatment law 1 earns. Spending the identity's loudest
  colour on merely *asking* also teaches the eye that madder means "delete-ish" rather than "no way
  back".
- **The ratchet:** `role-hue-ban.test.ts` bans `text-destructive` outright, and **61-04/61-05 must
  append `chat/` to its `SCOPED_DIRS`** (61-02-SUMMARY). This file would have gone red on arrival.
  It is now pre-cleared. *That gate is a proxy and I did not lean on it — the substance above is the
  reason; the ratchet is why it mattered now.*

**3. [Rule 3 — Blocking] Tailwind v4 arbitrary-value syntax.** The Tailwind LSP flagged
`hover:border-[var(--rule-hi)]` on first write. Given this repo's history — the sidebar shipped at
**half width** through 730 green tests because `w-[--sidebar-width]` is v3 and v4 needs
`w-(--sidebar-width)` — every unregistered-token call site uses v4's `(--custom-property)` form and
**every new class was verified emitted in the production build** rather than reasoned about.
61-02-SUMMARY's warning that "a naive grep for an arbitrary-value class in built CSS will lie to
you" is correct and bit me twice (`.px-2\.5`, `.bg-ink\/5` both read as MISSING until I grepped the
escaped form).

**4. [Scope — flagged, not taken] `--fill-hi` is also unregistered.** 61-03-PLAN §E lists
`--edge`/`--grid`/`--rule-hi`/`--ink-05` as declared-but-not-`@theme`-registered and does not mention
`--fill-hi`. It is in the same state (`globals.css:521`, `:644`; no `--color-fill-hi` in the `@theme
inline` block), so `bg-fill-hi` does not exist and the send hover uses `hover:bg-(--fill-hi)`.
**61-05: register four, not three.**

**5. [Scope — flagged, not taken] Two "New chat" controls now disagree on weight.** The rail's is
outlined; `ChatHomeEmptyState`'s comes from the shared `EmptyState` primitive's `action` and is a
filled ink block. Arguably correct (the empty state's CTA is the only action on an empty surface),
but it was not a *decided* choice. `EmptyState` is shared with `entities-gallery` and others, and
`chat-home-empty-state.tsx` is outside this plan's `files_modified`. Logged as **D-61-07**.

**6. [Scope] Two stacked 44px bars remain at MOBILE.** The app shell's `md:hidden` header
(`layout.tsx:74`) sits above my header rule. I merged `/chat`'s own two bars, which is what the plan
scoped; the shell's header belongs to every route and merging it is an architectural call (Rule 4),
not taken unasked.

**7. [Scope] `tsconfig.json`/`next-env.d.ts` churn left unstaged** — the `build:local` dist-dir flip
(D-61-02). Independently confirmed by 61-01 and 61-02; not this plan's doing.

## Negative Proofs — all four executed, RED output verbatim, all reverted

**1. A tier token on the selected row** (`bg-shade font-semibold text-ink` + `border-l-2 border-l-conf-line`):

```
× Leg 1: selection is NOT a hue — the selected/unselected class difference carries no tier or retired node-type token (law 1)
  → selection is stated with "border-l-conf-line", which carries a tier/retired-node-type family.
    Law 1: selected states carry NO hue — selection is FILL and WEIGHT (the sketch's .citem.on:
    --shade fill + ink text + font-semibold).: expected 'border-l-conf-line' not to contain 'conf'
Tests  1 failed | 6 passed (7)
```

**2. Selected and unselected made identical** — note **both jaws bit**, which is the design (Leg 1
alone is satisfiable by deleting selection entirely):

```
× Leg 1 → selection changed no classes at all — see Leg 2: expected 0 to be greater than 0
× Leg 2 → the selected and unselected rows are styled identically — selection was deleted, not
    re-encoded: expected 'group flex items-center gap-0.5 round…' not to be
    'group flex items-center gap-0.5 round…' // Object.is equality
Tests  2 failed | 5 passed (7)
```

**3. `shadow-elevation-2` restored on the dock**:

```
× Leg 5: no elevation on the dock — the identity's 'zero shadow anywhere' for this surface
  → the composer dock carries an elevation shadow. The identity's own note is 'flat surfaces,
    hairline rules, zero shadow anywhere' — a hairline top rule IS the separation between the
    composer and the transcript.: expected 'w-full shrink-0 border-t border-hair …' not to match
    /shadow-elevation/
Tests  1 failed | 6 passed (7)
```

**4. (Unasked, and the most valuable) `e2a2abf` itself — `h-full` removed from the `<Collapsible>`**:

```
× Leg 6: the rail's height chain is DECLARED at every link (e2a2abf's exact shape)
  → a link in the rail's height chain declares no height: "(no class)".
Tests  1 failed | 6 passed (7)
```

**`"(no class)"` is literally Radix's bare unstyled `<div>`** — the gate reports the exact object
that caused the 11,296px bug. The unit suite now catches the *declaration* half of a bug that 363
green tests slept through; `test:geometry` still owns the *resolution* half (it measures 11,296px).

**No proof edit leaked.** `git diff --stat ca520b4 -- apps/web/src/app/chat/` after all four reverts:
**empty**.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **75 files / 881 passed**, 2 skipped — baseline 74/874 + this plan's 7, zero regressions |
| `npm run test:geometry` | **3 passed** at 390 and 1440, after every structural edit |
| `npm run build:local` (from `apps/web`) | clean |
| `npm run screenshot:review` | 33 files / 16 dark |
| every new class EMITTED in built CSS | verified individually (see below) |
| plan's Task 1 grep gate (`h-svh` in page.tsx ≥ 1) | PASS |
| plan's Task 2 grep gates (0 `shadow-elevation`, `MAX_TEXTAREA_HEIGHT_PX` present) | PASS |

**Emitted-CSS proofs** (the check that matters, since the failure mode is silent):
```
.hover\:border-\(--rule-hi\):hover{border-color:var(--rule-hi)}      <- resolves as COLOUR, not width
.hover\:bg-\(--fill-hi\):hover{background-color:var(--fill-hi)}
.focus-visible\:outline-solid:focus-visible{--tw-outline-style:solid;outline-style:solid}
.focus-visible\:outline-ink:focus-visible{outline-color:var(--ink)}
.focus-visible\:outline-offset-1:focus-visible{outline-offset:1px}
.placeholder\:text-pencil::placeholder{color:var(--pencil)}
.px-2\.5{padding-inline:calc(var(--spacing) * 2.5)}                  <- 10px, the sketch's exactly
.gap-0\.5{gap:calc(var(--spacing) * .5)}                             <- 2px, .convrail's gap
.[&>[data-radix-scroll-area-viewport]>div]:block!>[data-radix-scroll-area-viewport]>div{display:block!important}
```

**Visual read (both themes, full size)** — `2026-07-16T01-56-41-998Z/chat-desktop-{light,dark}.png`
plus two throwaway probe captures of the conversation-OPEN state (the capture harness never selects
a conversation, so the composer and the `--bright` column are invisible to it — written to the
scratchpad, **never** to a non-ISO dir under `.planning/ui-reviews/`, per D-61-01):

- one header rule (toggle | Chat/Canvas | model picker | … | session cost), no "Chat" title;
- the `--bright` column steps visibly off the `--shelf` rail at x=464 — **in both themes**;
- the selected row reads clearly as selected by fill + weight, with no hue;
- the composer's ink focus outline **renders** (the thing that would have been invisible);
- `bg-ink` correctly inverts in dark: a light send fill with a dark `--on-fill` glyph;
- the `--leaf` field recesses into the `--bright` column, as `.composer input` does;
- the `...` buttons are present on every row and titles ellipsize.

## Success criteria

- [x] **The frame is designed** — one header rule, a 208px registry rail, a full-height rail beside
      the column. Distinct in STRUCTURE, not only colour: two bars became one, the page title is
      gone, the New-chat control changed hierarchy (fill → outline), the rail changed width and
      ground, and the row lost a line. A re-token can make none of those changes.
- [x] **Selection and focus are ink, stated rather than inherited** through `primary`'s/`ring`'s
      indirection — and selection gained the WEIGHT it never had.
- [x] **The composer's send is an ink control on a hairline rule with no shadow.**
- [x] **The height chain that broke tonight is provably intact in a real browser** — `test:geometry`
      3/3 after every structural edit, and Leg 6 now makes its *declaration* red in jsdom too.

## Notes for later plans

- **61-04: `max-w-3xl` is now a PAIR.** The composer aligns to `message-list.tsx`'s column. Move
  both or neither.
- **61-04: measure your ScrollArea before restyling turns** (D-61-06). `mx-auto` centres against the
  CONTENT box; one wide table or long URL silently de-centres the whole transcript while the
  composer stays put.
- **61-05: register FOUR tokens, not three** — `--fill-hi` is unregistered too. Then
  `hover:bg-(--fill-hi)`, `hover:border-(--rule-hi)` and `bg-ink/5` here can become utilities.
- **61-04/61-05: `chat/` joins `role-hue-ban`'s `SCOPED_DIRS`.** `conversation-row.tsx` is already
  clear. Do not narrow the ratchet.
- **The composer's placeholder and the toggle's aria-labels are load-bearest**: 61-01's geometry gate
  keys its hydration proof, its transcript locator and its mobile rail-open on
  `"Ask the agent anything…"`, `"Collapse conversation list"`. Keyed on semantics, so a restyle is
  safe — a **re-word** is not.

## Self-Check: PASSED

```
FOUND: apps/web/src/app/chat/_components/__tests__/chat-frame-structure.test.tsx
FOUND: apps/web/src/app/chat/page.tsx
FOUND: apps/web/src/app/chat/_components/conversation-rail.tsx
FOUND: apps/web/src/app/chat/_components/conversation-row.tsx
FOUND: apps/web/src/app/chat/_components/composer.tsx
```
Commits verified in `git log`: `26de79e`, `ca520b4`, `e1d0b24`, `0e47899`.

**No stubs.** No `TODO`/`FIXME`/placeholder introduced; every component renders real data.

**Threat model compliance:** T-61-07 (`conversation.title` stays a React text node — it is now the
row's ONLY child, and never touches a class string, a style or `dangerouslySetInnerHTML`);
T-61-08 (the clamp is unchanged and Leg 4 gates both halves of it — the rendered `max-h-52`/
`overflow-y-auto` and the scripted `Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)`);
T-61-09 (one element, one tab stop, `aria-label` swapping in the same expression as the handler —
Leg 3 gates it across both `isStreaming` values); T-61-SC (no packages installed).

**Threat flags:** none. No network, auth, file or schema boundary touched — this plan restyles four
client components and adds a test.
