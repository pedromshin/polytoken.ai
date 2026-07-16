# Polytoken Brand Guide

> Working reference doc, not marketing prose. Sits beside
> [`product-register-and-bans.md`](./product-register-and-bans.md), which stays authoritative
> for the absolute bans (glassmorphism, gradient text, etc.) — this guide references those bans,
> it never restates or contradicts them.

## 1. USER-LOCKED naming

**Verbatim user decision (2026-07-10):**

> "everything will be called polytoken and domain polytoken.ai. everything else is purged."

This is a USER-LOCK (D-47-01) that overrides all prior brand-direction research. Consequences:

- The product is named **polytoken** everywhere — every surface, every doc, every commit message.
- The domain of record is **polytoken.ai** — recorded here as the target domain; it has **not**
  been purchased (see §6).
- Every alternate brand direction previously explored during early v1.8 brand research (four
  named directions — see `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` for the
  historical record) is **purged**. Those direction names must never appear in app copy or
  committed docs (enforced by the repo-level brand guard, §8) — this guide does not repeat them.
- There is no rename pending. The name is permanently polytoken.

## 2. Voice principles

The warm polytoken voice register carries over from the research dossier's warm/companion
direction tone analysis (see `BRAND-IDENTITY-OPTIONS.md`) — **as a tone only, not as a name**.
No alternate naming survives the USER-LOCK in §1.

- **Warm, human, companion** — the product reads like a second brain that already knows you, not
  a console you operate.
- **First-person framing** — "your workspace," "your inbox," "pick up where you left off."
- **Reference points:** Notion AI, Mem — approachable daily-use software, not developer tooling.
- **Never infrastructure vocabulary** in user-facing copy — no "node," "pipeline," "daemon,"
  "compute," "mesh," or similar systems language reaching the UI (that vocabulary is fine in code
  and docs; it must not leak into copy the user reads).

### Do / Don't (before → after, from real shipped surfaces)

| Surface | Don't (systems register) | Do (warm polytoken register) |
|---|---|---|
| Login card title | "Sign in to Polytoken" | "Welcome back to your workspace" |
| Login card description | "Use your Google account to continue." | "Pick up right where you left off — sign in with Google." |
| Inbox page `<title>` | "Polytoken — Emails" | "Your inbox — Polytoken" |
| Chat home empty state heading | "Start a new conversation" | "Ask me anything" |
| Canvas empty state heading | "No panels yet" | "Panels will appear here" |
| Email reprocess success toast | "Email sent for reprocessing" | "On it — reprocessing this email" |

When writing new copy: keep error/warning toasts clear and actionable (do not soften urgency out
of them), and never stage a meta-critical aside about the product itself (banned — see
`product-register-and-bans.md` ban #13).

## 3. Visual identity

Realized in `apps/web/src/app/globals.css` by Phase 59 (`59-01` ported the ladder, `59-02` added
the type/density/signature layer), from the user-picked, user-locked decision record
[`58-IDENTITY.md`](../../.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md)
(**D-58-01**, locked 2026-07-15). That document is the contract — this section documents what
actually shipped from it, sitting alongside the voice/tone this guide has always defined (§2). It
does not reinterpret D-58-01; where the two could be read to disagree, `58-IDENTITY.md` wins.

### Thesis and the three laws

> Every fact has a source, and colour is reserved for what the data means.

polytoken's substance is provenance — OCR token polygons, extraction regions, a confidence tier
separating what a human confirmed from what a machine guessed. Three laws make that visible:

1. **Colour is earned, never decorative.** Chrome is monochrome. A hue appears only where it
   carries data meaning, and it means exactly one thing in both themes: verdigris (`--conf`) means
   a human confirmed a fact, pencil-amber (`--sugg`) means a machine inferred it and nobody has
   confirmed it yet, madder (`--bad`) means an action is irreversible. Every button, link, nav
   item, selection, and focus ring carries **no hue at all** — ink weight, underline, rule, fill,
   and elevation do that work instead. Adding a hue requires a demonstrated usability failure of
   the monochrome treatment — not a preference — documented as an amendment to `58-IDENTITY.md`.
2. **Chrome speaks sans, evidence speaks serif.** Content that came from the user's own mail
   (mail, saved sources, values pulled out of them) renders in a document serif (`font-serif`);
   all product chrome is sans (`font-sans`, self-hosted Archivo). No exceptions — one exception
   makes the rule unlearnable.
3. **Entity type is shape, never hue.** Supplier = square · Person = circle · Amount = diamond ·
   Document = triangle · Email = hollow circle. Type surrendered its five hues so tier could own
   colour outright — that is what makes law 1 possible.

### The palette

The 12-token identity ladder holds hue and chroma constant across themes — only lightness moves.
Values below are read directly from `globals.css`'s `:root`/`.dark` blocks (oklch, `L% C H`):

| Token | Means | Light | Dark |
|---|---|---|---|
| `--conf` | Verdigris — confirmed (a human verified this) | `oklch(49% 0.068 176.3)` | `oklch(78% 0.068 176.3)` |
| `--sugg` | Pencil-amber — suggested (machine-inferred, unconfirmed) | `oklch(50.5% 0.08 78.7)` | `oklch(78.5% 0.08 78.7)` |
| `--bad` | Madder — irreversible only, never errors/warnings | `oklch(49.4% 0.126 32.4)` | `oklch(70% 0.126 32.4)` |
| `--ink` | Text, and every action/selection/focus-ring | `oklch(26.7% 0.015 124.2)` | `oklch(92.4% 0.019 83.1)` |
| `--faded` | Secondary text; type shapes | `oklch(46.6% 0.021 124.4)` | `oklch(75.2% 0.024 78.2)` |
| `--pencil` | Muted metadata; "uncertain" | `oklch(51% 0.022 119.2)` | `oklch(65% 0.025 78.1)` |
| `--shelf` | Page ground — warm archival paper / warm graphite | `oklch(92.4% 0.014 97.5)` | `oklch(19.9% 0.009 59.1)` |
| `--leaf` | Panel — one step above the page | `oklch(95.1% 0.011 95.2)` | `oklch(22.2% 0.011 60.9)` |
| `--bright` | Elevated — the sheet you're working on | `oklch(98.2% 0.007 97.4)` | `oklch(26.5% 0.015 76.2)` |
| `--shade` | Well — pressed into the page; hover fills | `oklch(89.9% 0.016 99)` | `oklch(31.3% 0.016 75)` |
| `--rule` | Structural boundary | `oklch(82.1% 0.021 100.6)` | `oklch(38.8% 0.026 78.8)` |
| `--hair` | Divider — a boundary that carries less weight | `oklch(88.3% 0.018 99.6)` | `oklch(32.6% 0.017 70.9)` |

**Which token backs which shadcn class.** Every existing shadcn semantic token is now a `var()`
reference onto the ladder above, never a literal colour — this table answers "which token is
`bg-muted`?":

| shadcn class | Resolves to |
|---|---|
| `bg-background` | `--shelf` (page ground) |
| `bg-card` | `--leaf` (panel) |
| `bg-popover` | `--bright` (elevated sheet) |
| `bg-primary` | `--ink` |
| `bg-secondary` | `--shade` |
| `bg-muted` | `--shade` |
| `text-muted-foreground` | `--faded` (never `--pencil` — see the enforcement list below) |
| `bg-accent` (hover well) | `--shade` |
| `bg-destructive` | `--bad` |
| `bg-success` | `--conf` |
| `border` / `input` | `--rule` |
| `ring` | `--ink` |

**The consequence readers trip on:** `bg-primary`/`ring` resolve to `--ink`, not a hue. There is
no brand button colour and no accent teal — the stock-shadcn value that used to live there
(`oklch(38.9% 0.053 173.7)`) is deleted from this product entirely. A branded action colour is not
expressible through these classes any more; that is law 1 being structural, not a style choice a
surface can opt out of.

`--chart-1..5` is the one colour family left out of this ladder entirely — see the open flag in §6.

### The type scale

A 6-step designed scale (`text-2xs` through `text-xl`), anchored on the identity's own
`14px/1.55` body — not Tailwind's stock 16px base — and registered in `globals.css`'s native
`@theme` block, so it **replaces** stock Tailwind sizing wherever `text-xs`/`sm`/`base`/`lg`/`xl`
classes are already used app-wide:

| Step | Size / line-height | Usage |
|---|---|---|
| `text-2xs` | 11px / 1.3 | Micro labels, captions, counts |
| `text-xs` | 12px / 1.4 | Chip/badge text, small UI labels |
| `text-sm` | 13px / 1.45 | Secondary/meta text, nav links |
| `text-base` | 14px / 1.55 | Primary UI text |
| `text-lg` | 15.5px / 1.7 | Reading-pane serif body — law 2's evidence text |
| `text-xl` | 18.5px / 1.3 | Headings |

Law 2's sans/serif split has real token roles: `font-sans` (self-hosted Archivo via
`next/font/google`, weights 400/600 only) is every product surface's default. `font-serif` (a
system stack — no webfont needed) is reserved for the user's own material and nothing else, with
no exceptions. `tabular` is a named utility (`font-variant-numeric: tabular-nums lining-nums`) for
law 2's other half — tabular numerals on every amount, date, and count.

### Density and spacing

Nine named `--spacing-*` steps plus two card/frame radii give Phases 60-63 a measured rhythm
instead of ad-hoc px, derived from the identity's own control/chip/row/panel paddings:

| Step | Value | Where |
|---|---|---|
| `spacing-control-y` / `-x` | 7px / 14px | Buttons |
| `spacing-control-sm-y` / `-x` | 6px / 11px | Small buttons |
| `spacing-chip-y` / `-x` | 4px / 7px | Chips |
| `spacing-row-y` / `-x` | 12px / 16px | List rows |
| `spacing-panel` | 20px | Panel padding |
| `radius-card` | 10px (`--radius` + 2px) | Cards |
| `radius-frame` | 12px (`--radius` + 4px) | Frames |

### The signature: the provenance mark

The provenance mark is the one thing this product should be remembered by: an
OCR-token-polygon-derived highlight used identically on entity chips, cited spans inside chat
answers, and knowledge entity labels — one mark language everywhere.

- **Solid mark = confirmed.** Reach for `pmark pmark-confirmed` — solid `--conf-line` border,
  `--conf-wash` background, `--conf` text.
- **Dashed mark = suggested.** Reach for `pmark pmark-suggested` — dashed `--sugg-line` border,
  `--sugg-wash` background, `--sugg` text.

Do not rebuild a chip per surface — `pmark`/`pmark-confirmed`/`pmark-suggested` already exist as
reusable `@utility` declarations in `globals.css`; that reuse is the entire point of building them
once.

Law 3's shape vocabulary is the `tshape` family: `tshape-supplier` (square) · `tshape-person`
(circle) · `tshape-amount` (diamond) · `tshape-document` (triangle) · `tshape-email` (hollow
circle) — all drawn in `--faded`, none carry a hue. **Placement rule (not gateable): type shapes
belong only where there is no room for a word** — filter rails, canvas nodes — never beside a
label that already states the type. There is deliberately no shape for `date`; do not invent one.

### Enforcement — what a gate catches, what is on you

A rule with a gate is a rule; a rule without one is a wish. Do not re-litigate a rule a committed
gate already owns — cite it and move on. What each gate catches:

- **WCAG-AA** on every semantic pair, the pencil/faded ground rules, and the tier-on-wash worst
  case — `apps/web/src/app/__tests__/token-contrast.test.ts`. (Light `--sugg` on its own wash has
  only 0.02 of headroom: 4.52 measured against the 4.50 AA floor — any lightness drift breaks it.)
- **Law 1** — no hue on chrome, an earned-hue floor, cross-theme hue/chroma invariance —
  `apps/web/src/app/__tests__/colour-law.test.ts`.
- **Token registration** — every declared token family has a `@theme` mapping —
  `apps/web/src/app/__tests__/token-registration.test.ts`.
- **No raw Tailwind palette classes in app source** —
  `apps/web/src/app/__tests__/palette-ban.test.ts`.

Nothing else checks these — they are the guide's job alone, and the reason this section exists:

- **Law 2's serif rule has no exception.** Nothing polytoken says in its own voice wears the
  serif — not even a manifesto. One exception makes the rule unlearnable (D-58-01 audited all 86
  serif elements in the sketch; the only violation found was the sketch's own manifesto lede, set
  back to sans).
- **Law 3's placement rule** — type shapes only where there is no room for a word, never beside a
  label that already says the type. No shape for `date`.
- **Madder (`--bad`) is for the irreversible only.** Never errors, never warnings.
- **`--pencil` is legal on `--shelf`/`--leaf`/`--bright` but never on `--shade`** (4.23:1 light /
  4.02:1 dark — below the 4.5 AA floor). The gate catches the pair it can see; this rule stops the
  usage that would produce it.
- **Adding a hue requires a demonstrated usability failure** of the monochrome treatment — not a
  preference — documented as an amendment to `58-IDENTITY.md`.

Finish this section knowing which rules CI will catch for you, and which ones are yours alone to
hold the line on.

### Realized surface patterns (Phases 60-61)

Everything above this line is the token SET. This subsection is the realized surface PATTERNS built
on it — inbox (`/`) and email-detail (`/emails/[id]`) by Phase 60; `/chat` and its canvas by Phase
61. **Phases 62-63 inherit these rather than re-deriving them from the static sketch**, which is how
two surfaces end up disagreeing about the same fact. Each pattern names the file that owns it; read
that file, do not re-implement it.

#### The provenance chip

One mark language on inbox chips, region label chips, entity rails, and extraction values. Shape:
**the value first (serif + `tabular` + `data-evidence`), then a subordinate `· type` word in
sans**, coloured *only* by tier.

**Canonical implementation: `apps/web/src/app/_components/entity-chips.tsx`.** Reuse it; do not
rebuild a chip.

```tsx
<Link data-field="chip" data-tier={entity.tier}
      className={`pmark ${tierClass} inline-flex items-baseline gap-1 px-chip-x py-chip-y font-sans`}>
  <span data-evidence className="truncate font-serif tabular">{primaryText}</span>
  <span className="shrink-0 text-2xs opacity-75">· {entity.typeLabel}</span>
</Link>
```

**The trap that shape exists to dodge — `pmark` IMPLIES serif** (it sets
`font-family: var(--font-serif)`). So the container carries `font-sans` to *cancel* that default,
and the value span re-applies `font-serif` explicitly. Skip the `font-sans` and the
product-generated type word silently inherits the serif and breaks law 2 — and **no
className-reading gate can see it**, because the violation is an inherited property, not a class.
This is 60-05's finding, re-confirmed by 60-06.

**The resulting export discipline** on `REGION_TIER` (below) — get this wrong and you smuggle serif
onto chrome:

| Reach for | When | Because |
|---|---|---|
| `.chip` (= `pmark`) | The **document's own words** — a value, a content snippet | Evidence. Serif is correct here. |
| `.badge` + `.swatch` | **Chrome that names a tier** — the words "Confirmed"/"Suggested" | polytoken's vocabulary, not the document's. Law 2 gives it sans. |

`.chip` looks like the obvious "tier colour" export. It is not. It is the *evidence* export.

#### The tier/role orthogonality rule

**Owner: `apps/web/src/app/emails/[id]/_components/region-vocabulary.ts`.** This is the single most
reusable decision Phase 60 made, and Phases 61-63 need it for canvas nodes and edges.

> **Tier owns colour and solid-vs-dashed. Role owns weight, style, and opacity — never hue.**
> The two axes are orthogonal: a box reads "entity, suggested" as *thick and amber-dashed*, and
> neither reading interferes with the other.

- **`tierOf(status)`** — `confirmed` → confirmed; `candidate`/`pending` → suggested;
  `rejected`/`superseded` → terminal (a ghost: no tier claim, so no colour at all).
  **Any unrecognized status defaults to `suggested`, NEVER `confirmed`** (T-60-08). Tier is a claim
  that *a human confirmed this*, so a new status value must never silently inherit a confirmation
  the user never gave. The product's stance is suggest-only; this default is that stance in code.
- **`REGION_TIER`** — tier's colour + solid/dashed, plus `.chip`/`.badge`/`.swatch`/`.ring`.
  `.ring` is **ink on every tier** by design: tier owns fill and border, it never owns selection
  (law 1 — selected states carry no hue).
- **`REGION_ROLE_GEOMETRY`** — role's structure only. **`unrelated` is DOTTED, not dashed, because
  tier already owns dashed.** `field` carries `opacity-80` beyond a bare `border` so it cannot
  collapse into `none`'s plain `border` and become structurally indistinguishable at a fixed tier.
- **`REGION_ROLE_LABEL`** — polytoken's word per role, in one place (it replaced two divergent
  copies in `role-picker.tsx` and `inspector-panel.tsx`). Sans; never behind `chip`/`pmark`.
- **`REGION_ROLE_SWATCH`** — law 3 applied to chrome: chrome that must *show* a role renders a
  **miniature of the real box geometry**, composed from `REGION_ROLE_GEOMETRY` at module load so it
  cannot drift. Base is `border-ink` — a swatch has no tier to claim. This is why the role picker
  teaches the document's own vocabulary instead of a colour key that dies in greyscale.

**One mapping, not two.** Do not re-derive tier locally next to a component that already has it —
two maps of one fact drift, and the drift reads to the user as two panels disagreeing.

#### Law 2 in practice — the `data-evidence` convention

**`font-serif` and `data-evidence` mutually imply each other.** The gates enforce the pair, so
marking one without the other is a test failure, not a style nit. `regionLabelFor` exists to make
this decidable: it discriminates a label by PROVENANCE (`type` / `text` / `status`) instead of
collapsing three different origins into one string — which is what made the pre-60 code
structurally unable to obey law 2.

| Evidence — serif + `data-evidence` | Chrome — sans, no `data-evidence` |
|---|---|
| Subjects, bodies, snippets | Type names, property labels |
| Extracted values (**even inside an `<Input>`** — provenance is about where the text came from, not which element holds it) | Status words, counts |
| Content-derived labels (`regionLabelFor` → `kind: "text"`) | Addresses-as-metadata; `kind: "type"` / `kind: "status"` |

#### The madder rule in practice

**`variant="destructive"` / `bg-destructive` on an irreversible CONTROL is correct.
`text-destructive` / `border-destructive` on a STATE is banned.** An error is ink on a rule; a
warning is ink weight; an uncertain read is `--pencil`.

Gate: **`apps/web/src/app/__tests__/role-hue-ban.test.ts`**, with an exported **`SCOPED_DIRS`**
ratchet (today: `_components`, `emails/[id]`, `chat`, `_vocabulary`). **Phase 62 appends
`knowledge/` and `entities/` as it sweeps them.** The scope only ever grows; a pinning test makes
*narrowing* it break a test instead of passing as a one-word diff nobody reviews. `graph-*` is still
legitimately in use across `knowledge/` and `entities/`, which is why the ban is scoped rather than
global — a gate that is red on arrival gets allowlisted into meaninglessness within a week.

**The append is the LAST step of a sweep, never the first** (61-08). `chat/` was red on arrival with
11 real violations — 10 madder-on-a-state (both inline error cards, the widget error row, a WebGPU
warning) and one retired role hue — every one a *state* talking, so every one was swept rather than
allowlisted. `ALLOWLIST` is still **empty** and should stay that way: an entry is an amendment to
D-58-01 (LOCKED), which requires a demonstrated usability failure of the monochrome treatment, not a
preference.

**The swept treatment, landed on independently by Phase 60 and Phase 61:** an error is
`border-rule` + `text-ink`, the glyph carries the role (shape survives greyscale), `role="alert"`
carries it accessibly, and `p-panel` is the density step. A *retryable* failure is the sharpest test
of the rule — a card with a Retry button beside it is the one thing that must not say "this cannot be
undone".

**The gate is a floor, not a ceiling — its blind spot is real, not theoretical.** The
fill-vs-text rule is a *proxy* for intent, and it cannot read intent. `pdf-preview-pane.tsx`
shipped `<Badge variant="destructive">Preview failed</Badge>` — a *status* talking through the
`variant` door the gate deliberately leaves open for genuine reject/deny buttons. It **passed the
gate** and still violated law 1. A human found it by reading; grep could not. Two traps that each
cost a rework in 60-06:

1. **The gate reads LINES, not prose** — a comment citing a banned literal turns the gate red on
   its own documentation. Describe retired tokens ("the retired entity node-TYPE hue"); never name
   them.
2. **The pattern must require the colour-utility PREFIX, not the bare family name** — the walk
   covers `__tests__` dirs inside the scoped roots, where sibling gates legitimately assert on the
   banned family by name. Widen it to a bare match and the gate executes its own siblings.

#### The density steps in practice

Reach for the named step, not a fresh number:

| Step | Landed on | Example |
|---|---|---|
| `px-row-x` / `py-row-y` | List rows and header bars | `inbox-row.tsx`, `email-detail.tsx`'s header |
| `px-chip-x` / `py-chip-y` | Chips (and the `+N` overflow chip) | `entity-chips.tsx` |
| `p-panel` | Rails, panels, framed error/empty states | `inbox-entities-rail.tsx`, `email-detail.tsx` |

---

#### The canvas card language (Phase 61)

**Owner: `chat/_canvas/canvas-node-shell-class.ts`.** Every node shell on the board is the sketch's
flat `.card` — `rounded-card border-rule bg-bright`, **zero shadow**, hover is a RULE change
(`--rule-hi`), never a lift. Three things it fixes that each shipped for milestones:

1. **`--bright`, not `bg-background`.** `--background` resolves to `--shelf`, the PAGE ground — so
   every node card was the exact colour of the board behind it. A card sits ABOVE the page.
2. **Selection is an ink OUTLINE, not a ring.** `--tw-ring-offset-color` defaults to `#fff`, so
   `ring-offset-1` paints a **white halo** around every selected node in dark. Prefer `outline-*`
   over `ring-*` anywhere a dark ground is possible. Note `focus-visible:outline-none` survives
   tailwind-merge and silently kills `outline-2` — evict it with `outline-solid`.
3. **Kind is stated as ink, not routed through `--primary`.** `border-l-primary` resolved to ink
   only by indirection, which is exactly how a hue lived in those files unread for three milestones.

**Chrome that sits on a genui panel must live OUTSIDE `PanelThemeScope`** (61-08). The scope injects
the *pack's* `--card`/`--border`/`--background` as inline vars, and packs have **no dark variants**
(D-61-07-A), so anything inside it is light in both themes. The panel toolbar is polytoken's own
chrome → the app's ink, outside the scope; the rendered spec is the pack's → inside it. Getting this
backwards produces a light toolbar on a dark app, and no class-string gate can see it.

#### Tier on edges — and why a data wire is neutral (Phase 61)

**Owner: `chat/_canvas/canvas-vocabulary.ts`.** The tier/role rule above, applied to the board:
tier owns colour + solid-vs-dashed (`--conf-line` solid / `--sugg-line` dashed); a node's KIND owns
left-rule WEIGHT (chat `border-l-4` → email-thread `border-l-2` → genui-panel `border-l`, the axis
being *how much of the user's own material this node carries*), and **DOTTED, never dashed** — tier
owns dashed on every surface.

**A `DataEdge` is `neutral`, and `neutral` is deliberately NOT a `Tier`:** it is the *absence* of a
tier claim. A wire from `sourcePath` to `targetKey` is plumbing, not provenance, and law 1 says
colour is earned.

**THE TRAP, and it is the most transferable thing Phase 61 learned:** `@xyflow/react/dist/style.css`
is imported from a client component, so Next emits it **UNLAYERED** — and an unlayered normal
declaration beats **any** declaration inside a Tailwind cascade layer, *before specificity is ever
consulted*. So a `className` on a React Flow primitive can be a **DEAD STRING that agrees by
accident**: `[stroke:var(--edge)]` lost to the stock rule which happened to resolve to the same
colour, while `[stroke-width:1.5]` lost to a stock `1` and was simply wrong on screen. And `!` cannot
rescue it — Tailwind v4 scans for LITERAL strings, so a runtime-composed `` `!${cls}` `` emits
nothing. The fix is a second projection of the same fact as CSS **values**
(`CANVAS_EDGE_TIER_STYLE`), with a gate asserting the two projections agree. **Wire it and LOOK at
it.**

#### Law 2's clearest worked example: two titles, one screen (Phase 61)

On the chat canvas, adjacent cards carry two titles at the same size and weight:

| Element | Treatment | Why |
|---|---|---|
| `ChatNode`'s conversation title | **sans**, no `data-evidence` | polytoken's own label for a conversation |
| `EmailThreadNode`'s subject | **serif + `data-evidence`** | the mail's own words |

**The only thing that differs is where the words came from** — which is the entire law, visible
without reading source. Ask "where did the WORDS come from?", never "which element holds them".
`email-thread-node.tsx` applies `font-serif` to the SPANS, never the header row, and deliberately
avoids `pmark`/`chip` there because those **imply** serif and would smuggle it onto chrome past every
class-string gate.

#### The `TranscriptPanelHost` seam (Phase 61)

**Owner: `chat/_canvas/transcript-panel-host.tsx`.** The docked/mobile transcript gets the canvas's
overlay store and persistence **without mounting React Flow**, so a panel re-themed on the board
renders re-themed in the transcript (999.17) and is EDITABLE there (criterion 3 — the canvas never
mounts below `md`, so this is the only place those controls can exist on a phone).

Three rules it encodes, all generalisable well beyond this surface:

1. **Readiness travels in VALUES, never in SHAPE.** `ready ? <Providers>{children}</Providers> :
   <>{children}</>` **remounts the entire subtree** when it flips — React reconciles by element type
   — discarding composer drafts, scroll position and every effect's state the instant a background
   query settles. Render ONE tree and put readiness in the values (a placeholder store, a `null`
   context, a `false` marker). A `null` context value is indistinguishable from an absent provider to
   any consumer that already null-checks.
2. **A MARKER, not store presence, tells two transcripts apart.** The canvas's own `ChatNode`
   transcript has the store *and* the persistence context, so store-presence gating grows a **second**
   toolbar inside a node on the board. `useIsTranscriptPanelHost()` is provided by that host and
   nothing else. Not a viewport check either — "can reach on mobile" is not "only on mobile".
3. **A write with nothing wired to persist it SHOULD throw.** `usePanelOverlay` throws; the optional
   read is for display only. Gate the control's MOUNT on the marker (a conditional render, never a
   conditional hook call), because children render before the providers exist.

#### Custom utilities: `@utility`, never `@layer utilities` (Phase 61)

A rule hand-written into `@layer utilities` is plain CSS that Tailwind copies through **without
learning the name** — so the bare class works and **every variant of it silently emits nothing**.
`touch-target` (D-48-07's 44px WCAG floor) was declared that way and is reached exclusively as
`pointer-coarse:touch-target`, so the floor **never applied anywhere, for three milestones**, while
a class-string gate asserting the substring stayed green. Measured: the app's only two
`@media (pointer: coarse)` blocks carried `height`/`width` and there was no `min-height` rule in
158KB of CSS; the panel toolbar's icon buttons rendered **24×24px** on a touch device.

**Declare custom utilities with `@utility`, and prove they EMIT in the built sheet** — a naive grep
of source proves nothing (`break-words` is v3 and emits nothing in v4; `w-[--x]` is v3, v4 needs
`w-(--x)`). A class string being present is not the class rendering.

#### Documented deviations from the sketch — and why

These are deliberate. Do not "restore" them from `direction-final.html` without reading the reason.

- **No `tshape` on inbox or detail.** The reference's own placement rule (law 3): type shapes
  belong only where there is no room for a word. Both surfaces state the type in words already.
- **No unread dot, no attachment row** on the inbox list row — there is **no read-state model and
  no attachment metadata on the row**. The sketch drew data the product does not have.
- **No Confirm/Dismiss in the inbox entities rail** — the canonical control lives on the detail
  view. Two controls for one action is how the two surfaces drift apart.
- **The entities rail hides below `xl` (1280px)**, not the reference's 1120px — Tailwind's own
  breakpoint, rather than a bespoke number nothing else in the app shares.
- **`parseStatus` is NOT routed through `REGION_TIER`.** Different domain: `tierOf("parsed")`
  returns `suggested` (its unknown-status default), so routing would paint a *succeeded* parse
  amber; and verdigris means precisely "a human verified this", while a parse succeeding is a
  machine fact nobody confirmed. Spending the confirmed hue on it would make verdigris mean two
  things — the one thing law 1 cannot survive. **That both are called "status" is the trap.**

## 4. Mark usage

The mark is the `BrandMark` component
(`apps/web/src/components/brand-mark.tsx`) plus the static favicon it mirrors
(`apps/web/src/app/icon.svg`).

- **Geometry:** two interlocking soft-edged "lobe" shapes (an organic, brain-like reading) plus
  one small bridging circle "node" (a node-cluster reading) — deliberately not sharp graph lines
  and not a hand-drawn doodle (see ban #11).
- **Variants:** `variant="glyph"` is the square mark alone (sidebar avatar slot, login card
  header, favicon). `variant="lockup"` pairs the glyph with the "Polytoken" wordmark — reserved
  for future header/marketing-facing chrome (Phase 49), not consumed by any surface yet.
- **Tones:** `tone="brand"` (default) keeps the secondary lobe at `opacity-55` for the softer
  two-tone read. `tone="mono"` drops that opacity split to a single flat fill — **use `mono` at
  any render size at or below ~16px** (favicon, small avatar slots) where a semi-transparent
  overlap turns muddy.
- **Color:** the mark is `currentColor`-driven — it always inherits the `text-*` context it
  renders in (both current call sites use `text-primary`, which now resolves through the visual
  identity's `--ink` — see §3 — rather than a hue). Never hardcode a color onto the mark; change
  the surrounding `text-*` class instead.
- **Clear space:** keep a minimum clear margin around the glyph equal to the width of the smaller
  "node" circle (roughly 1/8 of the glyph's bounding box) — do not crop the lobes or crowd the
  glyph against adjacent text/icons.
- **Minimum size:** do not render the glyph below `size-4` (16px); below that the two-lobe
  overlap and the small node circle stop reading clearly even in `mono` tone.
- **Never:** stretch the mark to a non-square aspect ratio, recolor individual shapes with
  separate raw colors, or add drop shadows/gradients/blur to the mark (glassmorphism ban, §7
  below).

## 5. Accepted collision (recorded risk, not a mitigation)

An existing local-first AI coding-agent dev tool is **also named `polytoken`**
(`docs.polytoken.dev`, npm package `polytoken`, `polytoken.com` registered) — an exact-name
collision in an adjacent (AI agent tooling) space, surfaced during v1.8 brand research
(`.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md`).

The user **explicitly accepted this collision on 2026-07-10** as part of the USER-LOCK in §1.
This is recorded here as an **accepted risk**, not something the product's copy or brand voice is
designed to work around. Do not write copy that dances around the collision, disclaims it, or
otherwise references it in-product — the warm polytoken voice register (§2) is a tone choice
grounded in the product's own north star, not a mitigation for this collision.

## 6. NOT done — user-gated

The following are explicitly **not done** and require the user's direct action (external
dashboards, purchases, legal filings — out of scope for any autonomous phase):

- **Domain purchase** — `polytoken.ai` is the domain of record per §1 but has **not** been
  purchased/registered.
- **Trademark search / filing** — no trademark search or filing has been performed for
  "polytoken" in any jurisdiction. The accepted collision in §5 means a search is advisable before
  any commercial launch, but it has not happened.

No other user-gated items exist for the naming/domain brand decision itself.

### Open flags carried from §3

Two items from the visual-identity system (§3) are deliberately **not resolved** — recorded here honestly,
with the concrete cost, rather than as a vague "revisit later":

- **D-58-03 — entity type is shape, never hue.** `58-IDENTITY.md` flags this as "the one item the
  user has not explicitly blessed" — it was inferred from the user's colour law (law 1), not
  instructed. Cheap to revisit now, expensive after Phase 62; if revisited, laws 1 and 2 stand
  regardless. Phase 59's port made the cost concrete: law 3 forced
  `--graph-entity`/`--graph-email-component`/`--graph-email` to surrender their hues (59-01), and
  `extraction-summary-panel.tsx`'s `candidate: "bg-graph-email-component"` uses a node-TYPE hue to
  mean a TIER — exactly the confusion law 3 exists to eliminate.
- **`--chart-1..5`** — the single colour family left out of the identity entirely. Not in
  D-58-01's 12-token ladder; its only consumer is the spreadsheet grid's
  `conditional-formatting-dialog.tsx` as USER-ASSIGNED cell annotation, the same category as the
  out-of-scope `packages/genui/src/theme/packs.ts`. Left byte-identical in `globals.css` and
  exempted by name from the law-1 gate (`colour-law.test.ts`). Needs a user decision: fold it into
  the identity, or keep it as a bounded user-annotation exemption. Also note a pre-existing,
  out-of-scope defect found during Phase 59 planning: `conditional-formatting-dialog.tsx` offers
  `chart-6`/`chart-7`/`chart-8`, which `globals.css` has never defined.

## 7. Bans this guide never overrides

`product-register-and-bans.md` remains authoritative for the app's absolute design bans (the
13-item checklist, including item 3's glassmorphism ban and item 11's hand-drawn-illustration
ban). This brand guide does not license blur, frosted-glass panels, gradients, or sketchy
illustration on the mark or anywhere else — see that doc for the full list.

## 8. Repo-level brand guard

None of the superseded direction names from `BRAND-IDENTITY-OPTIONS.md` (§1) may appear in app
source (`apps/web/src`) or any committed doc under `docs/`. This is enforced by a repo-level grep
guard scoped to those two paths — see `47-03-PLAN.md`'s acceptance criteria for the exact command.
Historical research files under `.planning/research/` are intentionally exempt and retained as a
record of the superseded directions.

## 9. Design conventions

Three design-convention docs sit alongside this guide and govern token realization,
interactive-state styling, and responsive layout across the re-skin:

- **§3 above (Visual identity)** — the palette/type-scale/density/signature system itself
  (D-58-01), realized as real tokens by Phase 59.
- [`hover-active-convention.md`](./hover-active-convention.md) — the ONE hover/active-state
  derivation rule (D-48-06): neutral/ghost elements move to the accent surface pair on hover,
  filled semantic elements self-intensify (`/90` then `/80`), with worked examples from this
  phase's chips/badges.
- [`breakpoint-decision.md`](./breakpoint-decision.md) — the breakpoint-awareness decision
  (D-48-07): pack tokens stay breakpoint-static, the Tailwind `md` breakpoint (768px) is the
  canvas → feed switch line, and a `.touch-target` (44px) guard protects interactive elements
  regardless of pack density. Scopes what Phase 50's mobile-responsive answer may and may not
  add.

---

*Phase: 47-brand-foundation-verification-tooling (naming, voice/tone, mark) ·
59-visual-identity-designed-token-set-brand-guide (visual identity, §3)*
*Established: 2026-07-10 (D-47-01, D-47-02, D-47-03) · 2026-07-15 (D-58-01, visual identity §3)*
