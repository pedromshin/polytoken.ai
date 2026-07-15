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
