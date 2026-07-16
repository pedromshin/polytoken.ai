---
name: polytoken-design-system
description: Polytoken web design system — token source, @polytoken/ui conventions, and the shadcn CLI + registry vendor-and-adapt workflow. Use when building, styling, or reviewing any UI in apps/web or packages/ui.
---

# Polytoken Design System

## Stack pin (hard constraints)

- Tailwind **v4** (`@theme inline` + oklch tokens, CSS-first config) + React **19** + Next 15.
  Migrated in Phase 55 (STCK-01/STCK-02) — `packages/ui/components.json`'s `tailwind.config`
  is blank (`""`) per the v4 registry-install shape.
- Primitives: **Radix** (`@radix-ui/react-*`) — DECIDED, documented in
  [`docs/design/radix-vs-base-ui.md`](../../../docs/design/radix-vs-base-ui.md) (STCK-03).
  Upstream shadcn defaults to Base UI since July 2026, but its own changelog states Radix is
  not deprecated. `-b radix` is `shadcn init`-only (verified: no `--base` flag exists on
  `add` in the installed CLI) — never re-run `init` against this repo's `components.json`
  without it. This repo's existing `style: "new-york"` already pins canonical `@shadcn` `add`
  calls to Radix with no flag needed (verified live). Third-party registries (`@kibo-ui`,
  `@magicui`, `@coss`) have no Radix/Base-UI toggle at all — diff any payload before vendoring
  regardless.
- Third-party registry payloads are increasingly Tailwind v4-native (`@theme`, oklch) — this
  is now this repo's own shape too, so a v4/oklch payload usually needs **no adaptation**
  (see STCK-04 proof: a direct `shadcn add @kibo-ui/rating` install required zero v3/Base-UI
  changes). Still inspect every payload via `--dry-run --view` first — never auto-install
  blindly — but "adapt Tailwind v4 syntax to v3" is no longer a default step, only a
  contingency if a payload assumes a different token shape than this repo's.

## Where things live

- Components: `packages/ui/src/*.tsx` — FLAT, one file per component
  (no `components/ui/` nesting). Includes vendored clones from Magic UI
  (border-beam, marquee, confetti, number-ticker, …) and Kibo UI (code-block,
  dropzone, dialog-stack, tags, …) — already adapted to this repo's conventions; their
  keyframes live in `packages/tailwind-config/web.ts`. These were vendored **before** the
  Phase 55 Tailwind **v4** migration — the stack pin above is authoritative; never re-adapt a
  payload down to v3.
- `cn` util: exported from the `@polytoken/ui` root (`packages/ui/src/index.ts`).
- Tokens: `apps/web/src/app/globals.css` — full-color-function CSS variables
  (`oklch(...)`), shadcn v4 `@theme inline` convention. **The visual identity
  is D-58-01's 12-token oklch ladder** (locked
  [`58-IDENTITY.md`](../../../.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md),
  realized by Phase 59) — every shadcn semantic name (`--primary`,
  `--background`, `--muted`, `--accent`, ...) is a `var()` reference onto
  that ladder now, never a literal colour. **Under law 1 there is no brand
  primary colour any more** — `--primary`/`--ring` resolve to `--ink` (no
  hue at all); the old stock-derived teal that used to live there is
  deleted from this product entirely (see `59-01-SUMMARY.md`). See
  [`docs/design/brand-guide.md`](../../../docs/design/brand-guide.md) §3
  "Visual identity" for the full palette/type-scale/spacing/signature
  reference — do not duplicate it here, see the pointer below instead.
  Sidebar tokens extended in `packages/ui/tailwind.config.ts`
  (IntelliSense-only file). Call sites read the var directly
  (`var(--primary)`), never re-wrapped in `hsl(...)`.
- Tailwind preset: `@polytoken/tailwind-config/web`.
- Import convention: `import { Button } from "@polytoken/ui/button"`,
  `import { cn } from "@polytoken/ui"`.
- This is an **npm workspaces** monorepo (NOT pnpm).
  Typecheck: `npm run typecheck -w @polytoken/ui`.

## Visual identity (D-58-01) — pointer, not a duplicate

The realized system is documented in
[`docs/design/brand-guide.md`](../../../docs/design/brand-guide.md) §3 "Visual identity"
(palette, type scale, spacing, signature-element usage rules) and locked by
[`58-IDENTITY.md`](../../../.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md)
(D-58-01) — read those as the authority. Do not build a surface without reading §3 first; the
summary below exists only so this file stops being wrong, not to replace it.

- **Law 1** — colour is earned, never decorative: chrome is monochrome, only
  `--conf`/`--sugg`/`--bad` carry hue, and every action/selection/focus-ring is ink.
- **Law 2** — chrome speaks sans, evidence speaks serif: `font-serif` is reserved for the user's
  own material (mail, saved sources, values pulled out of them) — no exceptions, ever.
- **Law 3** — entity type is shape, never hue: use the `tshape`/`tshape-supplier`/`tshape-person`/
  `tshape-amount`/`tshape-document`/`tshape-email` utilities, never a per-type colour. Type shapes
  only belong where there's no room for a word (filter rails, canvas nodes).
- **Signature (THE provenance mark):** `pmark pmark-confirmed` (solid border/wash) /
  `pmark pmark-suggested` (dashed border/wash) — the one mark language for entity chips, cited
  spans inside chat answers, and knowledge entity labels. Reuse it; do not rebuild a chip.
- **Type scale:** `text-2xs`/`text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl` — this REPLACES
  stock Tailwind sizing app-wide, anchored on a 14px/1.55 body, not Tailwind's 16px default. Use
  `tabular` for amounts/dates/counts.
- **Gates (all committed under `apps/web/src/app/__tests__/`):** `token-contrast.test.ts`
  (WCAG-AA on every semantic pair), `colour-law.test.ts` (law 1 — chrome ceiling, earned-hue
  floor, cross-theme hue/chroma invariance), `token-registration.test.ts` (every declared token
  family has a `@theme` mapping), `palette-ban.test.ts` (no raw Tailwind palette classes in app
  source). Run `cd apps/web && npx vitest run src/app/__tests__/` before/after any `globals.css`
  edit.

## Realized surface patterns (Phases 60-61) — pointer, not a duplicate

Phase 59 shipped the token SET; Phase 60 shipped the first realized surface PATTERNS (inbox +
email-detail); Phase 61 added `/chat` and its canvas. **Full reference:
[`docs/design/brand-guide.md`](../../../docs/design/brand-guide.md) §3 "Realized surface patterns".**
Inherit these — do not re-derive them from the sketch.

- **Tier/role orthogonality** — `apps/web/src/app/emails/[id]/_components/region-vocabulary.ts`.
  **Tier owns colour + solid-vs-dashed; role owns weight/style/opacity, never hue.** `tierOf`
  defaults an unknown status to `suggested`, **never** `confirmed` (suggest-only stance).
  `unrelated` is DOTTED because tier already owns dashed. Reuse `REGION_TIER` /
  `REGION_ROLE_GEOMETRY` / `REGION_ROLE_LABEL` / `REGION_ROLE_SWATCH` for canvas nodes and edges —
  a fifth local role map is how this debt accumulated.
- **The provenance chip** — canonical: `apps/web/src/app/_components/entity-chips.tsx`. Value
  (serif + `tabular` + `data-evidence`), then a subordinate `· type` in sans; coloured only by tier.
- **⚠ `pmark` IMPLIES serif.** `REGION_TIER[...].chip` is `pmark`, which sets `font-family:
  var(--font-serif)`. Use `.chip` **only** for the document's own words; use `.badge` + `.swatch`
  to state a tier in CHROME. Get this wrong and serif lands on chrome where **no className-reading
  gate can see it** — it is an inherited property, not a class.
- **`font-serif` ⇔ `data-evidence`** mutually imply each other; the gates enforce the pair.
- **Madder** — `variant="destructive"`/`bg-destructive` on an irreversible CONTROL is fine;
  `text-destructive`/`border-destructive` on a STATE is banned. Gate: `role-hue-ban.test.ts`, whose
  exported `SCOPED_DIRS` is a **ratchet — append your surface root as you sweep**. It now covers
  `_components`, `emails/[id]`, **`chat`** (the whole subtree, 61-08) and **`_vocabulary`**;
  **Phase 62 appends `knowledge/` + `entities/`**, which is why the ban is still scoped. `ALLOWLIST`
  is EMPTY and an entry amends D-58-01 (LOCKED). **The append is the LAST step of a sweep** — `chat/`
  was red on arrival with 11 violations. It reads LINES, not prose: never name a banned literal in a
  comment (construct patterns from parts). Its madder rule is a proxy that cannot read intent — a
  `variant="destructive"` status badge passed it and still violated law 1, so **read, then gate**.
  Swept treatment: an error is `border-rule` + `text-ink`, the glyph carries the role.
- **The canvas card language** — `chat/_canvas/canvas-node-shell-class.ts` + `canvas-vocabulary.ts`.
  Flat `.card` (`bg-bright`, NOT `bg-background` — that resolves to the page ground), **zero shadow**,
  hover is a rule change. **Selection is an ink `outline`, not a `ring`** (`--tw-ring-offset-color`
  defaults `#fff` → a white halo in dark; and `focus-visible:outline-none` survives tailwind-merge
  and kills `outline-2` — evict with `outline-solid`). Kind = left-rule WEIGHT, never hue; a
  `DataEdge` is `neutral` because plumbing states no tier.
- **⚠ xyflow's stylesheet is UNLAYERED**, so it beats ANY layered utility *before specificity* — a
  `className` on a React Flow primitive can be a **dead string that agrees by accident**. `!` cannot
  save you (v4 scans LITERAL strings, so a runtime-composed `` `!${cls}` `` emits nothing). Project
  the fact as CSS **values** (`CANVAS_EDGE_TIER_STYLE`) and gate that the two projections agree.
- **⚠ Custom utilities need `@utility`, NOT `@layer utilities`** — the latter is plain CSS Tailwind
  never learns the name of, so the bare class works and **every variant silently emits nothing**.
  `pointer-coarse:touch-target` emitted nothing for three milestones (44px WCAG floor, never
  applied, class-string gate green throughout). **Prove new classes EMIT in the built sheet.**
- **Chrome must sit OUTSIDE `PanelThemeScope`** — it injects the *pack's* palette, and packs have no
  dark variants (D-61-07-A). A toolbar inside it is light on a dark app.
- **The `TranscriptPanelHost` seam** — `chat/_canvas/transcript-panel-host.tsx`. Readiness travels in
  **values, never in shape** (`ready ? <Providers>{c}</Providers> : <>{c}</>` remounts everything
  below it). A **marker**, not store presence, tells the docked transcript from the canvas's own
  ChatNode transcript — both have the providers.
- **Density** — reach for the named step: `px-row-x`/`py-row-y` (list rows), `px-chip-x`/`py-chip-y`
  (chips), `p-panel` (rails/panels, framed error/empty states).

## Component discovery — read the catalog, don't search

**When composing a page, read `references/component-catalog.md` FIRST.** It
pre-enumerates every available component — all 55 local `@polytoken/ui` components
(including vendored Magic UI effects and Kibo UI utilities) plus all ~900
registry items (@shadcn, @kibo-ui, @magicui, @coss) with descriptions — so you
never need to stop and run `shadcn search` mid-build. Prefer local components
first; they have zero adaptation cost.

Refresh the catalog when registries drift or new components are vendored:
`node .claude/skills/polytoken-design-system/scripts/build-catalog.mjs`

## shadcn CLI workflow (vendor + adapt)

`packages/ui/components.json` wires the CLI and registries — `tailwind.config` is
blank (v4 shape, per shadcn v4 docs: "For Tailwind CSS v4, leave this blank"). Run
from `packages/ui/`.

- Discover: catalog first (above); fall back to `npx shadcn@latest search @kibo-ui -q <term>`
- Inspect: `npx shadcn@latest add <item> --dry-run --view`
  (import rewriting to `@polytoken/ui` conventions is correct in the payload; `-b`/`--base` is
  `init`-only in the installed CLI — there is no per-`add` override, see
  `docs/design/radix-vs-base-ui.md` §4)
- Diff vendored components against canonical: `npx shadcn@latest diff <name>`
- **DO NOT run plain `add`** — it resolves the write path through the package
  `exports` map and targets `src/index.ts/<name>.tsx` (broken). Instead:
  1. Copy the payload from `--dry-run --view` into `packages/ui/src/<name>.tsx`.
  2. **Since this repo's own tokens are now Tailwind v4/oklch (Phase 55), a v4-native
     payload usually needs NO adaptation** — verified live for `@kibo-ui/rating`
     (STCK-04 proof: the payload's classes, imports (`@polytoken/ui` convention
     already matched), and Radix-based runtime hook all landed unmodified). Only
     adapt if the payload assumes a different token/class shape than this repo's.
  3. Confirm the payload's own primitive import is Radix (`@shadcn` items: this repo's
     `style: "new-york"` already pins that with no flag needed, verified live; third-party
     registries have no toggle — read the payload's own imports at `--dry-run --view` time).
     If a needed component is Base-UI-only, treat that as the re-evaluation trigger in
     `docs/design/radix-vs-base-ui.md`, not a silent exception.
  4. Add runtime deps to `packages/ui/package.json` (check first — a dep may
     already be present, e.g. `@radix-ui/react-use-controllable-state` was
     already installed for `relative-time`/`dialog-stack`/`code-block`); `npm
     install` at root if a new one is needed.

## Approved external sources

| Registry | Use for | Caveat |
|---|---|---|
| `@shadcn` (canonical) | app UI staples | Base UI default since 2026-07 — diff first |
| `@kibo-ui` | complex app components (Gantt, Kanban, AI chat, dropzone) | v4-leaning payloads |
| `@coss` (ex-Origin UI) | input/button/dialog variants | Base UI-based now |
| `@magicui` | animated effects, polish | v4 + Motion; v3 legacy docs at v3.magicui.design |
| `@tweakcn` | theme presets | **do not hand-port a generated preset wholesale** — it would violate law 1 (chrome must stay monochrome, D-58-01) and fail `colour-law.test.ts`; the identity ladder in §3 of `docs/design/brand-guide.md` is this repo's only source for token values now |

- 21st.dev Magic MCP: do not use (abandoned early 2026).
- shadcn MCP server: intentionally not wired — the skills + CLI path is
  preferred (lower token cost; GSD subagents with `tools:` restrictions
  can't see MCP tools anyway).

## Gotchas

- **CSS comment text colliding with the token gates — bitten 3x this milestone (Phase 59), real
  hazard, not theoretical.** `globals.css`'s gates (`token-contrast.test.ts`,
  `token-registration.test.ts`) parse the `:root`/`.dark`/`@theme` blocks with a
  comment-UNAWARE regex (`/--([\w-]+):\s*([^;]+);/g`) by design — it does not strip `/* ... */`
  first. Two distinct failure modes, both hit for real during 59-01/59-02:
  1. A literal `*/` inside comment PROSE (e.g. describing `"p-*/gap-*/m-*"` utilities) closes the
     CSS block comment early, leaving the remaining comment text parsed as raw CSS — webpack
     rejects it as an "Unknown word" syntax error.
  2. A comment containing a colon-terminated `--token-name:` substring (e.g. explaining
     `"NOT --pencil: --shade + --pencil computes to..."`) matches the gate's token-parsing regex
     and silently swallows the NEXT real declaration into a bogus captured value, corrupting that
     token's gated value with no build error.
  **The rule:** never write a literal `*/` inside comment prose (reword around it — "p-, gap-,
  m-" not "p-*/gap-*"), and never write a literal `--name:` inside a comment (reword to
  `--name.` or `NOT --name` without the trailing colon). Before committing a `globals.css` change
  with new comment text, scan it yourself for `*/` and `--[\w-]+:` patterns that aren't real
  declarations.
- **`npm run build:local` (i.e. `next build`) while `npm run dev` is running CORRUPTS the dev
  server — root-caused 2026-07-15, cost a whole verification leg.** Both share `apps/web/.next`.
  The build overwrites the dev server's server chunks with production output; the dev server keeps
  its old module graph and starts throwing `Cannot find module './N.js'`, serving SSR HTML whose
  client JS never executes — skeletons that never resolve, theme toggles stuck on their pre-mount
  placeholder, inert tab clicks. **It fails silently**: the build reports success, and the damage
  only surfaces the next time someone opens the app. Tell-tale: production artifacts
  (`.next/BUILD_ID`, `prerender-manifest.json`, `server/pages/_document.js` — a Pages-Router file
  in this App-Router app) sitting next to `.next/static/development`. **Stop the dev server before
  building, or give the build its own `distDir`.** Recovery: stop the server, `rm -rf
  apps/web/.next`, restart `npm run web:dev`.
- Edits to `packages/tailwind-config/web.ts` (keyframes/animations) do NOT
  reach a dev server whose `apps/web/.next/cache` predates the edit — the
  transpiled preset is cached. Fix: stop the server, delete
  `apps/web/.next/cache`, restart.
- Stopping `npm run dev` on Windows can orphan the `next dev` child, which
  keeps holding the port. Verify with `Get-NetTCPConnection -LocalPort <port>`
  and kill the owning PID.
- Visual smoke surface: `/dev/components` renders every vendored
  registry component (apps/web/src/app/dev/components/page.tsx) — extend it
  when vendoring more.
- Consultation page: `/dev/design` is the generated design-system reference —
  every component rendered live (49/55; variant matrices driven by extracted
  CVA data) alongside all tokens with light/dark values, motion utilities, and
  each component's props/defaults/variants/token-refs. Preview registry:
  `apps/web/src/app/dev/design/previews-*.tsx`. Regenerate the data after
  token or component changes:
  `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs`

## Design quality bar

- The `frontend-design` plugin skill (user scope) sets the aesthetic floor —
  follow it for any new surface.
- Verify UI work visually before declaring it done — a green gate is not a look. (Phase 55 shipped
  a half-width sidebar through 4/4 verification and 730 green tests; 60-06 found a status badge
  talking in madder that the role-hue gate structurally could not see.)
- **The capture harness: `cd apps/web && npm run screenshot:review`** — 6 surfaces × {390, 1440},
  plus a seeded `/emails/[id]` against a local stack, into a gitignored
  `.planning/ui-reviews/{timestamp}/`. **Only ever invoke it via that script.** It uses
  `playwright.screenshot.config.ts`, whose webServer has `reuseExistingServer: true` on port 3000.
  A bare `npx playwright test` uses the DEFAULT config, which spawns a **second `next dev` sharing
  `apps/web/.next`** — two compilers on one build directory corrupts it, and the app then serves
  SSR HTML whose client JS never executes (skeletons that never resolve, `Cannot find module
  './N.js'`). Recovery: stop the dev server, `rm -rf apps/web/.next`, restart `npm run web:dev`.
- **The harness photographs a crash and still reports `1 passed`** — it is a camera, not a gate.
  Read the PNGs; check the app actually hydrated (skeletons everywhere = it did not). The decisive
  liveness proof is not artifact archaeology: `curl` the linked `layout.css` and confirm it contains
  something you *just changed*. That proves the server is compiling current source. (`BUILD_ID`
  inside `.next/` is the one real corruption tell-tale — `prerender-manifest.json` and
  `server/pages/_document.js` are normal `next dev` output, and `build:local` targets `.next-verify`
  since `7df5ad2`.)
- **It HAS a theme axis since 61-01** — surface × viewport × {light, dark}, ~40 PNGs. The applied
  theme is asserted, never trusted. Phase 61 reviewed `/chat` and its canvas in **both** themes; that
  claim is now honest off this harness. Two live caveats:
  - **Persisted UI state BLEEDS across captures in file order** (D-61-07-B). `chat-canvas` writes its
    tab choice to `localStorage`, so the dark `chat-thread` pass restored it and photographed the
    **canvas** under the transcript's filename — with `select:ok` beside it. No gate can see this:
    the picture is of a real, correctly-rendered surface, just not the labelled one. Reset persisted
    state **per capture**. **Verify a frame is the surface it claims before drawing conclusions.**
  - **Mobile chat captures are the EMPTY STATE** (`select:n/a-overlay-rail`, D-61-07-D): below `md`
    the rail is an overlay Sheet, so no row exists to click. There is still no mobile photograph of
    the transcript. The harness header records two prior rail-driving attempts as actively harmful —
    do not try a fourth *there*; give the surface its own terms instead (see `test:geometry` below,
    which reaches it).
- **The rendered-geometry gate: `cd apps/web && npm run test:geometry`** (61-01, extended 61-08).
  A real browser measuring real boxes against the ALREADY-RUNNING dev server — its config declares
  **no webServer at all**, by construction, so it cannot spawn a second compiler. What it catches:
  - **A broken height chain** — `documentElement.scrollHeight <= innerHeight + ε`, plus
    scroll-containment for the rail/transcript. `/chat`'s rail once scrolled the document to
    **11,296px at a 900px viewport** with all 44 chat suites green.
  - **Radix ScrollArea's `display:table` content wrapper** (D-61-06, SYSTEMIC — every ScrollArea in
    the app has it). It shrink-wraps to CONTENT, so a wide child silently de-bounds every descendant
    and pushes controls off-screen. Fix the CONTENT (`w-full`/`min-w-0`); never widen the container,
    never weaken the gate.
  - **A React reconciliation bug presenting as a layout symptom** — it caught a provider host
    remounting the whole transcript (0px viewport while the height chain measured 783px) that 15
    green unit assertions could not see.
  - **Touch targets on a real coarse pointer** (61-08) — `hasTouch`/`isMobile`, not a 390px viewport:
    `pointer-coarse:` is keyed on pointer CAPABILITY, and a mouse-driven 390px window correctly gets
    the compact chrome. It measured the panel toolbar's buttons at **24×24px** on a phone.
  **jsdom does no layout.** Anything about a rendered box belongs here, not in a unit suite.
- GSD integration: this file is auto-read by `gsd-ui-researcher` during
  `/gsd:ui-phase` and by `gsd-ui-auditor` during `/gsd:ui-review`. Keep it
  current when tokens or conventions change.
