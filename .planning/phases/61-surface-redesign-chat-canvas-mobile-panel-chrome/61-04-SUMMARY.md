---
phase: 61-surface-redesign-chat-canvas-mobile-panel-chrome
plan: 04
subsystem: chat-surface
tags: [chat, message-stream, citation-chip, tool-rounds, law-1, law-2, SURF-02, tailwind-v4, provenance]
requires:
  - "61-01's npm run test:geometry (run after every structural edit here)"
  - "61-03's committed composer — the reading column is a PAIR and this plan owned the call"
  - "Phase 59's density steps + the --ink/--shade/--leaf/--rule/--pencil token ladder"
  - "58-IDENTITY.md D-58-01 laws 1/2 (LOCKED); brand-guide.md §3's regionLabelFor pattern"
provides:
  - "message-turn.tsx: the sketch's .uturn/.aturn — the assistant's role rail is gone"
  - "message-list.tsx: the sketch's .turns (flex flex-col gap-4 px-4 py-5) — the reading column KEPT at max-w-3xl"
  - "USER_BUBBLE_CLASS — the one user-bubble recipe, shared with compact-interaction-entry"
  - "provenance-link.tsx: chipLabelFor() — law-2 provenance discrimination + the evidence/chrome pair"
  - "both tool rows as quiet pencil bookkeeping; the in-flight row is no longer dressed as a button"
  - "message-stream-law.test.tsx — 7 legs / 29 tests, three negative proofs executed"
affects:
  - "61-05 (owns @theme registration for --rule-hi/--fill-hi/--ink-05 — all three consumed here via var())"
  - "61-07 (edits message-turn.tsx's genui_spec branch — left clean and unwrapped; renders panels into the max-w-3xl column this plan kept)"
  - "61-05/61-06 (the role-hue-ban SCOPED_DIRS append is NOT done — see D-61-04-B, measured cost)"
tech-stack:
  added: []
  patterns:
    - "discriminate provenance, then style the BRANCH — never collapse two origins into one string"
    - "verify every new class EMITTED in built CSS; `break-words` is v3 and emits NOTHING in v4"
    - "match class families as whole TOKENS — /\\bchip\\b/ matches px-chip-x and fires on the right answer"
    - "look at the surface: the committed capture harness cannot see the stream at all"
key-files:
  created:
    - apps/web/src/app/chat/_components/__tests__/message-stream-law.test.tsx
    - apps/web/src/app/chat/_components/user-bubble-class.ts
  modified:
    - apps/web/src/app/chat/_components/message-turn.tsx
    - apps/web/src/app/chat/_components/message-list.tsx
    - apps/web/src/app/chat/_components/compact-interaction-entry.tsx
    - apps/web/src/components/provenance-link.tsx
    - apps/web/src/app/chat/_components/tool-round-activity-row.tsx
    - apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
    - apps/web/src/app/chat/_components/{cost-cap-blocked-card,inline-error-card,turn-action-row,turn-status-badge}.tsx
    - apps/web/e2e/uat-48-token-surfaces.spec.ts
    - .planning/phases/61-surface-redesign-chat-canvas-mobile-panel-chrome/deferred-items.md
decisions:
  - "D-61-04-A: the reading column STAYS max-w-3xl — it is a LAYOUT number (the composer aligns to it, 61-07 renders panels into it), not a prose measure; the ~120-char measure is real but the column is the wrong instrument"
  - "D-61-04-B: the citation chip COMPOSES border/bg and puts font-serif on the evidence span ONLY — it does NOT use pmark (pmark implies serif on the container; pmark is the TIER mark and this chip makes no tier claim)"
  - "D-61-04-C: the user bubble is rounded-frame (12px) — the sketch wrote a literal 12px and --radius-frame IS 12px; rounded-card (10px) would pick a number the sketch never drew to get a friendlier word"
  - "D-61-04-D: the transcript pads px-4 (16px), NOT the sketch's 18px — it must align to the composer's px-4; the sketch never had to align them"
  - "D-61-04-E: the errored tool round is INK, not madder — isError is a STATE (found by reading, not by the gate)"
  - "D-61-04-F: wrap-break-word, not break-words — the v3 name emits NOTHING in v4"
metrics:
  duration: ~105 min
  completed: 2026-07-16
  tasks: 3
  commits: 3
  tests_added: 29
---

# Phase 61 Plan 04: The Message Stream, Tool Rounds & Citation Chip — Summary

Removed v1.4's assistant role rail so the two chat roles are told apart by **hierarchy** instead of
a border, rebuilt the citation chip so law 2 is **structurally possible** on it rather than merely
asserted, stripped two milestones' worth of affordance lies off a status div, and **found a real
law-1 violation by reading** — the errored tool round has been speaking in madder since Phase 39.

Two things nearly shipped invisible and were caught by refusing to trust a class list: **`break-words`
is the Tailwind v3 name and emits nothing in v4**, and my own gate's `/\bchip\b/` **fired on the
correctly-built chip** because it matched `px-chip-x`.

## What Shipped

| Task | Commit | What |
|------|--------|------|
| 1 | `1611496` | the turn — a conversation, not a stack of bordered cards |
| 2 | `64c80e4` | the chip learns provenance; the tool round stops pretending to be a button |
| 3 | `f733bc5` | `message-stream-law.test.tsx` (7 legs / 29 tests) |

## The reading-column decision — `max-w-3xl` KEPT (D-61-04-A)

61-03 handed this over deliberately, and it is the one call this plan owned outright. **It stays.**

Not "because it is already 3xl" — I measured it with the turns in front of me, which is what 61-03
said the decision needed. **The measure is genuinely too long**: 768px minus `px-4` leaves 736px, and
at Phase 59's 13px body step that is **~120 characters per line**, well past the 45-75 ideal and
longer than comparable chat products (which run ~85-95 at a *larger* font in the same width). The
cause is traceable and nobody chose it: `max-w-3xl` was picked when the body step was larger, and
**Phase 59 lengthened the measure ~20% by dropping the body to 13px without the column ever being
re-decided.**

I still kept it, because **the column is a LAYOUT number, not a prose measure**:

1. **The composer aligns to it** (61-03) and **61-07 renders panels into it** — this plan's own
   `<output>` says so. Both move if it moves; neither asked.
2. **Narrowing does not actually fix the thing that is wrong.** `max-w-2xl` only reaches ~103 chars.
   A real measure needs ~550px, which would squeeze every markdown table, code fence and genui panel
   the same column carries — trading a typographic win for a layout loss, right before the plan that
   fills it with panels.
3. **The sketch offers no number here.** Its 388px `.chatcol` shares a frame with a board; ours owns
   the full width and the canvas is a *toggled view*, not a sibling (61-03's reasoning, still true).

**The right instrument is a cap on the prose, not on the column** — the paragraph in
`markdown-renderer.tsx`, which this plan explicitly scopes out ("do not touch it beyond reading").
That leaves panels at full column width and fixes only the thing that is broken. Logged as
D-61-04-C in `deferred-items.md`: **change the prose, not the column.**

**61-07: the column is unchanged at `max-w-3xl`, and the pair with the composer holds.**

## The `pmark`-vs-compose decision, recorded verbatim (D-61-04-B)

**The citation chip COMPOSES `border`/`bg` directly and applies `font-serif` to the evidence span
alone. It does NOT use the `pmark` utility.** Four reasons; the first is the one that matters:

1. **`pmark` IMPLIES `font-serif`** (globals.css:419). On this chip that would put serif on the
   **container** — and therefore on the icon and on the fallback label, which are chrome. No
   className-reading gate can catch that, because the violation is an **inherited property, not a
   class** (60-05's finding, re-hit by 60-06). **The sketch agrees**: `.srcchip` sets no font and
   puts serif on the inner `.st` span alone (direction-final.html:428).
2. **`pmark` is the TIER mark** — its colour comes from `pmark-confirmed`/`pmark-suggested`. This
   chip is neutral-palette and makes **no tier claim**, so bare `pmark` would be a tier mark with no
   tier, and a tier variant would be a claim we have not earned.
3. brand-guide §3 says it outright: *"`.chip` looks like the obvious 'tier colour' export. It is
   not. It is the *evidence* export."* This container is not evidence; only its evidence branch's
   text is.
4. The geometry differs anyway — `pmark` is 3px/`0 0.22em`; `.srcchip` is 4px/`5px 9px`.

**The container states `font-sans` explicitly anyway**, even though nothing here inherits serif
today. `ProvenanceLink` is a SHARED primitive — a future consumer may render it inside a `pmark`'d
context, and then the chrome branch would silently inherit the serif. Stating the cancel makes chrome
sans **by declaration rather than by luck**, and mirrors the canonical chip's own shape
(`entity-chips.tsx`). **61-07: this chip renders into your panels; do not wrap it in `pmark`.**

## The user-bubble radius (D-61-04-C in the plan's words)

**`rounded-frame` (12px).** The sketch's `.uturn` writes a literal `border-radius:12px`, and
`--radius-frame` **is** 12px (`calc(var(--radius) + 4px)`, globals.css:190). `rounded-card` is 10px —
picking it would mean choosing **a number the sketch never drew** in order to get a word that sounds
more bubble-like. The shipped value was `rounded-lg` = 8px. Verified in a real browser:
`userBubbleRadius: "12px"`.

## Per-File Changes

**`message-turn.tsx`** — the turn.

- **THE ASSISTANT'S LEFT RAIL IS GONE.** `border-l-2 border-l-border/60 pl-3` — v1.4's "assistant
  role rail", added when the roles needed telling apart and the system had nothing else to say it
  with. The sketch's `.aturn` has no rail, no card, no border: the user's turn is a right-aligned
  `--shade` bubble and the assistant's **is** the page. Verified rendered: `assistantBorderLeft: "0px"`.
- **Two wrapper divs collapsed to one.** With `message-list` now a real flex column, `.uturn`
  right-aligns with `self-end` exactly as the sketch has them as siblings. The old per-turn
  `flex justify-end|justify-start` div existed only to re-create that one level deeper.
- `min-w-0` on the assistant turn — the D-61-06 guard, so a wide child shrinks instead of demanding
  width from the ScrollArea's `display:table` wrapper.
- The tail caret says `text-ink` instead of reaching it through `--primary`'s indirection.
- **Every part-switch branch and its order preserved**, including `tool_invocation → null` and the
  `isFailed`/`isCostCapBlocked` full-content replacements — now pinned by Leg 7 rather than trusted.
  **The `genui_spec` branch is untouched and unwrapped for 61-07.**

**`message-list.tsx`** — the sketch's `.turns`.

- `space-y-8` (32px — spaced like a *document*) → **`gap-4`** (16px, the sketch's — spaced like a
  *conversation*). `py-5` is the sketch's 20px. Verified rendered: `turnGap: "16px"`.
- **`px-4`, not the sketch's 18px (D-61-04-D).** The sketch pads `.turns` 18px and `.composer` 16px
  and **never had to align them** — its `.chatcol` is a fixed 388px box with no centred reading
  column. Ours are two stacked `mx-auto max-w-3xl` columns, so 18-vs-16 would offset the composer's
  field from the prose directly above it by 2px, forever. Pair alignment beats 2px of fidelity to a
  number the sketch never had to make true.
- **`w-full` is load-bearing (D-61-06).** `mx-auto` centres against the CONTENT box, and Radix's
  Viewport child is `display:table`, which shrink-wraps to content. Without `w-full` the column
  centres against the widest turn rather than the viewport. **Confirmed live**:
  `contentWrapperDisplay: "table"` — the hazard is real on this viewport, exactly as 61-03 said.
- `GeneratingIndicator`: `border-border/50` → `border-hair`, `text-muted-foreground` → `text-pencil`
  (it sits between the transcript and the composer's own `border-hair` dock — the two rules were
  visibly disagreeing about what a hairline is), and its spinner is now `motion-safe:` guarded like
  every other spinner in the column.

**`user-bubble-class.ts`** (new) — one recipe, mirroring `panel-action-button-class.ts`'s precedent
(same cycle, same fix: `message-turn` imports `compact-interaction-entry`, so the entry cannot import
back). The bubble was **hand-copied** into `compact-interaction-entry.tsx` under a header promising
it reused *"MessageTurn's existing user-bubble classes verbatim (`flex justify-end` + `max-w-[85%]
rounded-lg bg-muted px-4 py-2`)"* — a duplicate held true only by discipline, in the one place drift
is most visible: **both bubbles render in the same transcript**, the user's typed message and the
user's widget response. Now true by construction.

**`provenance-link.tsx`** — law 2's hardest case, made structural.

- The defect was **structural, not cosmetic**: `label ?? fallbackLabel(kind, id)` collapses an
  email's real subject (the user's material → evidence) and polytoken's `Email · 1a2b3c4d`
  placeholder (chrome) into **one string**. Once collapsed, no downstream styling can obey law 2 —
  the component was *unable* to, regardless of what classes it wore. `chipLabelFor()` discriminates,
  reusing `regionLabelFor`'s shape rather than inventing one.
- evidence → `font-serif` **and** `data-evidence` (the pair, always) + `tabular` (a subject routinely
  carries invoice ids, lot numbers, amounts).
- **`hrefFor` still builds from `kind`+`id`, never `label`** (T-61-12) — now load-bearing twice over,
  because the typography makes a **provenance claim**. Pinned by a test asserting the href is
  *identical* across both branches.
- The sketch's `.srcchip`: `rounded-sm` (= `--radius-sm` = `calc(var(--radius) - 4px)` = **8px-4px =
  4px**, the sketch's exactly — resolved by construction, not assumed), `--leaf` fill, `--rule`
  border, `--faded` icon. **A pill read as a BUTTON; this is a link to a document.**
- `px-chip-x py-chip-y` (7/4) is the **named** chip step rather than `.srcchip`'s literal 9px/5px —
  brand-guide §3 asks for one mark language across inbox, region and citation chips, and the named
  step is what the other two spend.
- Focus is an ink **outline**, not a ring (D-61-03-F inherited: `--tw-ring-offset-color` defaults to
  `#fff` = a white halo in dark).

**`tool-round-activity-row.tsx`** — it was never a button.

A `role="status"` div with no handler and no tabindex, wearing `hover:bg-accent
hover:text-accent-foreground` and `focus-visible:ring-2 focus-visible:ring-ring
focus-visible:ring-offset-1`. **Both are affordance lies**: a hover inviting a click that does
nothing, and a focus ring on an element that can never receive focus. It has been dressed as a button
for two milestones. Now the sketch's `.tool` — a `--pencil` status line at the small step. Copy,
`role="status"`, spinner and `motion-safe:` guards all kept verbatim.

**`tool-invocation-result-row.tsx`** — bookkeeping, and one real law-1 fix (below).

Label and chips now **stack** (the sketch's order: `.tool` line → `.srcchip` → the answer). They
shipped inline, which gave the bookkeeping the same visual weight as the evidence it produced. The
degraded row is `--pencil` ("an uncertain read is pencil"). **Exactly the fields it rendered before**
(T-61-13) — in particular `results[].subject` is still not rendered; see the citation-label gap below.

## The law-1 read the plan asked for — performed, and it found one

**Checked by reading, not by grep — and the read found a violation the gate would have missed.**

`tool-invocation-result-row.tsx:144` shipped `<AlertTriangle className="size-4 shrink-0
text-destructive" />` on the `isError` row. **`isError` is a STATE.** 58-IDENTITY: madder means
"irreversible — this cannot be undone", allowed on irreversible **controls** and "never errors, never
warnings" in as many words. A failed lookup is neither a control nor irreversible — retrying it is one
click away.

Now **ink** — one step up from the pencil a normal round wears, so the error reads as more important
*without* spending the identity's loudest colour on a lookup that did not return. The triangle still
carries the meaning **by shape**, which survives greyscale. The row keeps `role="alert"` and its copy:
law 1 removed the colour, not the signal (pinned by a test, so "fixing" it by deleting the row fails).

**This is the 60-06 pattern repeating**: the gate is a proxy, and reading is what finds these. Visible
in both probe captures as a reddish triangle before, ink after.

## The citation-label gap — the plan's own success criterion is NOT met, and cannot be met here

**Stated plainly, because a green gate would otherwise imply otherwise.**

The plan's success criterion reads: *"An email's real subject reaches a chat answer in serif."* **It
does not, today.** The chip's evidence branch has **no production caller**:

- `ProvenanceLink` (the component) has **exactly one** call site — `tool-invocation-result-row.tsx`'s
  `CitationChips` — and it passes `kind` and `id` only. (Every other importer — `email-thread-node`,
  `knowledge-preview-node`, `knowledge-preview-mini-graph`, `thread-cluster-indicator` — imports
  `hrefFor` only, **not** the component.)
- The envelope carries no label to pass: `build_citation(kind, entity_or_email_id)` produces
  `{kind, id, route}` and nothing else (`apps/email-listener/app/infrastructure/tools/envelope.py:42`),
  and `tool_envelope_gate` validates that shape.

So **every citation chip in production renders the fallback** — `Email · ee000000` — which is
correctly sans, correctly chrome, and **tells the user nothing**. The sketch's chip reads *"Cotação
frete SP → POA — Lote 88"*. Mine reads a hex prefix. That gap is visible in both probe captures.

**I did not close it, deliberately.** `results[]` *does* carry `subject` (the fixture proves it), so
pairing citation→result by id is a few lines. But T-61-13 fences exactly this: *"do not add a field to
the row because there is room now. Render exactly the fields rendered today."* The tier-filtered
envelope is enforced upstream by FOUND-6 and Phase 38's three belts; widening what crosses that
boundary is a deliberate backend decision, not a restyle's side effect.

**What this plan actually delivered is the capability plus its gate**: the discrimination is real,
proven both ways, and the day a label legitimately reaches the chip, law 2 holds on it automatically.
**Whoever wires the label: the chip is ready; the envelope is the work, and it crosses a trust
boundary on purpose.**

## What the gate caught on itself

**`/\bchip\b/` matched `px-chip-x`.** Leg 6's first run failed on the **correctly-built chip** —
`\bchip\b` matches inside `px-chip-x`/`py-chip-y`, the named spacing step **every** chip in the app
uses. The pattern fired on the one element that was right. `role-hue-ban.test.ts`'s header warns about
this exact failure — *"widen the pattern to a bare family match and this gate will execute its own
siblings"* — and I walked straight into it. Now matched as a whole class **token**, with an assertion
pinning that `px-chip-x` is present and is not the tier mark. A gate that cries wolf on the right
answer gets deleted.

## Negative Proofs — all three executed, RED output verbatim, all reverted

**1. `font-serif` on `MarkdownRenderer`'s wrapper in `message-turn.tsx`** — note **three** legs bit,
including the positive control:

```
× LEG 3 — polytoken's voice is SANS > an assistant text turn's prose carries neither font-serif nor data-evidence
  → The assistant's answer is POLYTOKEN SPEAKING, so it is sans. The serif marks the user's own
    MATERIAL — mail, saved sources, values pulled out of them — never a voice. Offender:
    <div class="font-serif"> "Acme Freight came back at R$ 4.820,00 — ": expected true to be false
× LEG 3 > a user turn's typed message carries neither either
  → A user's TYPED MESSAGE is the user talking to polytoken — not material quoted from their mail.
    Sans. Offender:
    <div class="font-serif"> "What did Acme Freight quote for Lote 88?": expected true to be false
× LEG 3 > the ONLY serif in a full assistant turn comes from a labelled citation chip
  → expected [ …(2) ] to have a length of 1 but got 2
× LEG 1 — the pair holds BOTH ways > holds across an assistant turn mixing prose, a tool round and chips
  → font-serif and data-evidence must imply each other, but this element has font-serif=true and
    data-evidence=false
× LEG 1 > holds on a user turn
Tests  5 failed | 24 passed (29)
```

**2. `data-evidence` dropped from the evidence branch, `font-serif` kept** — the pair's second jaw:

```
× LEG 1 — the pair holds BOTH ways > holds on a citation chip carrying a real subject (the evidence branch)
  → ProvenanceLink[label]: font-serif and data-evidence must imply each other, but this element has
    font-serif=true and data-evidence=false:
    <span class="min-w-0 truncate font-serif tabular"> "Cotação frete SP → POA — Lote 88"
    Law 2 marks the USER'S OWN MATERIAL. font-serif without data-evidence is serif on something we
    have not claimed is evidence; data-evidence without font-serif is a claim we are not honouring.
    Both, or neither.: expected false to be true
× LEG 2 — evidence is DISCRIMINATED > a real subject renders serif AND data-evidence
  → expected false to be true
Tests  2 failed | 27 passed (29)
```

**3. `hover:bg-accent` + `focus-visible:ring-2` re-added to `ToolRoundActivityRow`**:

```
× LEG 4 — the tool round is NOT a button > renders no hover-background class and no focus-ring class,
  and is not focusable
  → a hover BACKGROUND on a non-interactive status div invites a click that does nothing:
    "flex items-center gap-1.5 text-xs text-pencil hover:bg-accent hover:text-accent-foreground
     focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in
     motion-safe:duration-200": expected 'flex items-center gap-1.5 text-xs tex…' not to match /hover:bg-/
Tests  1 failed | 28 passed (29)
```

**4. No proof edit leaked.** `git diff --stat 64c80e4 -- apps/web/src/app/chat/ apps/web/src/components/`
after all three reverts lists **only** the four React-import files (the intentional Rule 3 fix below) —
`message-turn.tsx`, `provenance-link.tsx` and `tool-round-activity-row.tsx` are **absent from the
diff**, i.e. byte-identical to the Task 2 commit.

## Deviations from Plan

**1. [Rule 1 — Bug] `break-words` is the Tailwind v3 name and emits NOTHING in v4 (D-61-04-F).**
Written as `break-words`, the user bubble's `overflow-wrap` guard would have been **a comment
describing a class that does not exist** — in a file whose entire justification is that guard. v4
renames it `wrap-break-word`. Caught only by checking the built sheet, never by reasoning:
```
.wrap-break-word{overflow-wrap:break-word}     <- emitted
break-words                                    <- no rule at all (negative control: None)
```
This is the **same shape** as the bug that shipped the sidebar at half width through 730 green tests
(`w-[--sidebar-width]` is v3; v4 needs `w-(--sidebar-width)`). Every one of this plan's 26 new classes
was verified emitted individually, by exact escaped selector, in Python — **because a naive shell grep
of built CSS lies** (61-02/61-03's warning, which bit me twice more: `head -1` picked a 1.3KB sheet
instead of the 114KB one, and `grep -c` counts *lines* on single-line minified CSS, so `text-xs` read
as "1 occurrence").

**2. [Rule 2 — law 1 correctness] The errored tool round was madder (D-61-04-E).** Full detail above.
Found by reading; the gate that now guards it did not find it.

**3. [Rule 3 — Blocking] Four components had no explicit React import.**
`cost-cap-blocked-card.tsx`, `inline-error-card.tsx`, `turn-action-row.tsx`, `turn-status-badge.tsx`
threw `ReferenceError: React is not defined` the moment Leg 7 mounted `MessageTurn`'s
failed/cost-capped/settled branches — the documented gotcha (Next's SWC automatic JSX runtime
tolerates the absence; vitest's classic-runtime esbuild transform does not). Fixed with the one-liner
every sibling already carries, with the same explanatory comment. **These branches had never been
mounted by any test before** — which is itself a finding: D-19's retry card and D-21's cost-cap card
are load-bearing failure paths and had zero unit coverage.

**4. [Rule 1 — Bug, in my own gate] `/\bchip\b/` fired on the correct chip.** Full detail above.

**5. [Scope — taken] `compact-interaction-entry.tsx` edited though it is outside `files_modified`.**
Its header promised verbatim reuse of the exact bubble classes Task 1 changed. Leaving it would have
shipped two user bubbles disagreeing **in the same transcript**. Resolved by extracting one shared
constant rather than editing a second copy — the smallest change that makes the promise true.

**6. [Scope — taken] `uat-48-token-surfaces.spec.ts` re-baselined.** It asserted the chip's
`borderRadius === 9999` (the pill). The claim was always *"the radius token resolves"*, not *"it is a
pill"* — Phase 48 was verifying token resolution. Now asserts the sketch's 4px, with a message
distinguishing the two failure modes (0 = token dead; 9999 = the pill is back). **It is an e2e spec,
outside `npx vitest run`, so no gate in this plan's verification would have caught it** — it would
have failed silently in the next `test:e2e` run.

**7. [Scope — flagged, not taken] `chat/` still cannot join `role-hue-ban`'s `SCOPED_DIRS`.**
61-03 assigned this to "61-04/61-05". **It cannot be 61-04**, and I measured rather than assumed:
**24 madder-on-a-state occurrences across 12 files** (13 in `_canvas/`, 11 in `_components/`) plus 3
`text-graph-email`. Adding `chat/` now makes the gate **red on arrival** — the exact failure its own
header names. 61-04's two tool rows are **pre-cleared**. Full table in `deferred-items.md`
(D-61-04-B). **The append belongs to the LAST plan that sweeps `chat/`, as a task, not a footnote.**
Notably `cost-cap-blocked-card.tsx`/`inline-error-card.tsx` carry a madder **border on a state** —
a real law-1 question in `_components/`, not just a ratchet chore.

**8. [Scope — flagged, not taken] The committed capture harness cannot see the message stream at
all.** `screenshot-review.spec.ts` never selects a conversation, so all 4 chat PNGs show the empty
state only. **The surface this plan redesigned has zero coverage in the committed visual review.**
Worked around with a throwaway probe (recipe below). Logged as D-61-04-A.

**9. [Scope] Prettier is NOT this repo's formatter.** Running it on `message-turn.tsx` reformatted
the whole file (no `.prettierrc`, no dependency). Reverted immediately and the structural edit was
done by hand; zero formatting churn is in the diff.

**10. [Scope] `tsconfig.json`/`next-env.d.ts` churn left unstaged** — the `build:local` dist-dir flip
(D-61-02). Independently confirmed by 61-01/61-02/61-03; not this plan's doing.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **76 files / 910 passed**, 2 skipped — baseline 75/881 + this plan's 29, **zero regressions** |
| `npm run test:geometry` | **3 passed**, after every structural edit (Task 1, Task 2, Task 3) |
| `npm run build:local` | clean |
| `npm run screenshot:review` | 33 files / 16 dark |
| plan's Task 1 greps (0 `border-l-2`; ≥4 part branches) | PASS (0 / 6) |
| plan's Task 2 greps (0 `hover:bg-accent`/`focus-visible:ring`; `data-evidence` + `font-serif` present) | PASS |
| every new class EMITTED in built CSS | **26/26 verified by exact escaped selector** |

**The rendered read (a real browser, not a class list)** — the geometry gate's fixture conversation
has **zero messages**, so its transcript leg can only prove containment *vacuously*. The probe seeded
6 turns including a long unbreakable URL:

```
viewportClientWidth: 976    viewportScrollWidth: 976    <- D-61-06 holds WITH real content
contentWrapperDisplay: "table"                          <- the hazard is real on this viewport
columnWidth: 768   turnGap: "16px"                      <- the sketch's rhythm
userBubbleRadius: "12px"                                <- rounded-frame = the sketch's 12px
assistantBorderLeft: "0px"                              <- the rail is GONE
proseFont: "Archivo…"  userBubbleFont: "Archivo…"       <- law 2: both roles' prose is SANS
chipRadius: "4px"                                       <- .srcchip, was 9999px
```

**Visual read, both themes, full size** (probe captures — the committed harness cannot see this
surface, D-61-04-A): the rail is gone and the assistant's answer sits directly on the column; the
user's `--shade` bubble is the only filled thing in the stream; the long URL **wraps** inside it
(`wrap-break-word` working — the class that would have been a no-op); the tool label is a quiet pencil
line **above** its chips rather than beside them; the chips read as document links, not buttons; **the
madder triangle is gone** — ink in both themes. The one thing that reads wrong is not a styling bug:
the chips say `Email · ee000000`, because no caller passes a label (see the citation-label gap).

## The probe recipe (for whoever fixes D-61-04-A)

Seed `chat_conversations` + `chat_messages` rows (`parts` jsonb is replayed verbatim by
`chat.getHistory`, D-18 — `uat-48-token-surfaces.spec.ts:222` is the working precedent), select the
row by anchored regex, wait on `getByPlaceholder("Ask the agent anything…")`. Drive it with a config
declaring **no server-spawning block** (copy `playwright.geometry.config.ts`) against the live dev
server — **never a bare `npx playwright test`** (999.22). Probe artifacts went to the scratchpad and
were deleted; **nothing was written to a non-ISO dir under `.planning/ui-reviews/`** (D-61-01).

## Success criteria

- [x] **The stream reads as a conversation** — one bubble, no rails, the sketch's 16px rhythm.
      Distinct in STRUCTURE, not colour: a border was deleted, two wrapper divs became one, and the
      roles are now told apart by hierarchy. A re-token can make none of those changes.
- [x] **Tool rounds are quiet bookkeeping and no longer pretend to be clickable** — and one of them
      stopped speaking in the identity's irreversible colour about a retryable state.
- [x] **Law 2's hardest case is executable, and the gate detects all three ways to break it** —
      proven RED, individually, with the output recorded.
- [~] **An email's real subject reaches a chat answer in serif.** **The capability ships and is
      gated both ways; the criterion itself does NOT hold in production**, because no caller passes a
      label and the envelope carries none. Fencing that is T-61-13's explicit instruction, not an
      oversight. See "The citation-label gap" — this is the one criterion I am not claiming.

## Notes for later plans

- **61-07: the reading column is unchanged (`max-w-3xl`) and the composer pair holds.** Your panels
  render into that 768px column. `message-turn.tsx`'s `genui_spec` branch is untouched and unwrapped.
  Do not wrap the citation chip in `pmark` (D-61-04-B).
- **61-05: register FOUR tokens.** `--rule-hi` (consumed here as `hover:border-(--rule-hi)`),
  `--fill-hi`, `--ink-05`, `--edge`/`--grid`. 61-03 already flagged `--fill-hi` as the un-listed
  fourth; this plan adds no new dependency on an unregistered token beyond `--rule-hi`.
- **61-05/61-06: the `SCOPED_DIRS` append is a TASK, not a footnote** — 12 files, 27 occurrences,
  measured table in `deferred-items.md`. Two of them (`cost-cap-blocked-card`, `inline-error-card`)
  are a genuine law-1 question, not a chore.
- **Whoever owns the harness: `.planning/ui-reviews/` currently proves nothing about the chat
  stream.** The recipe above is ~30 lines.
- **The prose measure is ~120 chars.** Fix it on the paragraph, not the column (D-61-04-C).

## Self-Check: PASSED

```
FOUND: apps/web/src/app/chat/_components/__tests__/message-stream-law.test.tsx
FOUND: apps/web/src/app/chat/_components/user-bubble-class.ts
FOUND: apps/web/src/app/chat/_components/message-turn.tsx
FOUND: apps/web/src/app/chat/_components/message-list.tsx
FOUND: apps/web/src/components/provenance-link.tsx
FOUND: apps/web/src/app/chat/_components/tool-round-activity-row.tsx
FOUND: apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
```
Commits verified in `git log`: `1611496`, `64c80e4`, `f733bc5`.

**Known stubs:** none introduced. **One pre-existing gap made visible and NOT closed**: the citation
chip's evidence branch has no production caller (the envelope carries no label). Documented above
rather than papered over; closing it is a deliberate backend decision fenced by T-61-13.

**Threat model compliance:** T-61-10 (`markdown-renderer.tsx` untouched — read only; no
`dangerouslySetInnerHTML`, no raw-HTML plugin, no `skipHtml`/`rehype-raw`, sanitization posture
unchanged); T-61-11 (the chip's `label` stays a React text node inside a `<span>`, never interpolated
into a class or `style`; the serif-vs-sans choice is selected by a **closed union**, never by
inspecting the label's content — the one content-touching check is a blank test that can only DEMOTE
evidence→chrome, never promote, so it cannot be used to steal the claim); T-61-12 (`hrefFor` still
takes `kind`+`id` only, pinned by a test asserting the href is identical across both branches);
T-61-13 (both tool rows render exactly the fields they rendered before — `results[].subject` is
deliberately still not rendered); T-61-SC (no packages installed).

**Threat flags:** none. No network, auth, file or schema boundary touched — this plan restyles client
components and adds a test.
