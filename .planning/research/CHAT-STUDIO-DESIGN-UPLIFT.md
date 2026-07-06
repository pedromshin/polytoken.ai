# Chat & Studio — Design Uplift Research

**Date:** 2026-07-05
**Trigger:** User request to research external design resources (impeccable.style, Magic UI,
Tailark, styles.refero.design, agent design skills) and figure out how to make `/chat` and
`/studio` "look better," informed by a sibling project's `DESIGN-RESEARCH.md`.
**Constraint (hard, from user):** zero new npm dependencies unless strongly justified; no bloat.
**Status:** Research + plan complete. **Execution deferred** — user explicitly wants this to run
*after* all current GSD work (v1.3, Phases 24–25) finishes, not in parallel with it. See
`ROADMAP.md` → Backlog 999.6 and `REQUIREMENTS.md` → Future Requirements → Visual Design Uplift.

This doc is the durable source of truth for that future phase/milestone — it exists so a future
`/gsd:plan-phase` (or `/gsd:new-milestone`) run does not need to re-derive any of this from scratch.

---

## Method

Ran a background research workflow (3 parallel codebase-inventory agents + 5 parallel external-
resource research agents + 1 gap-check critic), then resolved the critic's 3 follow-ups directly
via targeted greps. Full agent transcripts: `wf_aa4e8a8f-933` (session
`7b06f86a-54e0-40ff-bfd1-2246d6adbdd7`), journal at
`subagents/workflows/wf_aa4e8a8f-933/journal.jsonl` if raw agent output is ever needed.

---

## Current state (code-level audit, not a visual guess)

### `/chat`

Functionally complete, visually flat. Every surface uses the same recipe: thin border,
`bg-muted/60` or `bg-background`, `shadow-sm` at most — almost no per-component visual identity.

- **React Flow's own chrome is completely unstyled.** Repo-wide grep for `.react-flow` returns
  zero matches — `Controls`/`MiniMap`/`Background`/`Attribution` render in the library's stock
  light-gray boxes, ignoring the app's teal/dark token system entirely. This is the single most
  "off-the-shelf-library-dropped-in" visual moment on either surface.
- `ChatNode` (`_canvas/chat-node.tsx:132-138`) and `GenuiPanelNode`
  (`_canvas/genui-panel-node.tsx:102-113`) share byte-identical shell classes — the canvas reads as
  undifferentiated boxes regardless of node type.
- Assistant turns render with **zero chrome** (`_components/message-turn.tsx:96-100`, self-
  documented in-code as "plain on the background") — only alignment + the user's flat `bg-muted`
  bubble distinguish role.
- 3–4 near-duplicate empty-state components (`chat-home-empty-state.tsx`, `canvas-empty-state.tsx`,
  `unknown-node-type-placeholder.tsx`) reuse the identical icon+heading+paragraph recipe.
- `conversation-row.tsx:64-69` and `turn-action-row.tsx:52-85` swap hover backgrounds with no
  `transition-colors` — abrupt, not eased; icon buttons have no background/border affordance at
  rest or hover.
- Scrollbar inconsistency: `MessageList`/`ConversationRail` use the Radix-styled thin-thumb
  `ScrollArea`, but the composer textarea and markdown code/table wrappers use plain native
  `overflow-auto` — two scrollbar aesthetics on one page.
- `packages/ui/src/button.tsx:9` bakes `font-medium` into `buttonVariants`' base class — every
  Button label in the app (Send, New chat, Retry, Delete, model picker, …) is off-contract against
  the locked 2-weight (`font-normal`/`font-semibold`) typography system at the design-system level.

### `/studio`

State coverage (loading/empty/error) is the most complete of any surface, but token discipline is
weak — three independent hardcoded-color systems bypass the token set entirely:

- `code-island-frame.tsx:62-69` (`PHASE_TONE` map) and `:216-219` (`ViolationList` tone) — raw
  `bg-amber-50`/`bg-emerald-50`/`bg-red-50` etc., no dark-mode variants at all.
- `code-island-frame.tsx:160` — iframe wrapper hardcodes `bg-white`, a stark white rectangle in
  dark mode.
- `page-ideas-island.tsx:106` — curveball badge hardcodes `bg-amber-500/15` etc., a third parallel
  raw-amber pattern.
- `history-island.tsx:246` — `FallbackNotice` hardcodes `border-amber-500/30` with a manual `dark:`
  override instead of a token.
- `code-sandbox-island.tsx:165` — error text uses `text-red-600` instead of the `destructive` token
  used everywhere else.
- 11 occurrences of bare `font-medium` across `catalog-browser-island.tsx`,
  `generation-state-chrome.tsx`, `code-sandbox-island.tsx`, `code-island-frame.tsx`,
  `history-island.tsx`, `page-ideas-island.tsx` — the single most common contract violation on
  either surface.
- 3 near-identical raw `JSON.stringify` panes (`generation-sandbox-island.tsx:404`,
  `history-island.tsx:440`, `preview/page.tsx:96`) — no highlighting, no copy button, duplicated
  instead of shared.
- Catalog prop table (`catalog-browser-island.tsx:109-143`) is a bare unstyled HTML `<table>`
  sitting inside otherwise-polished card chrome.

### Design system (`globals.css`, `packages/tailwind-config`, `packages/ui`)

- **Tailwind v3.4.4, confirmed** (not v4) — matters directly for external-block compatibility.
- `secondary`, `muted`, and `accent` tokens are **byte-identical stock shadcn grays** in both light
  and dark mode (`globals.css:23-28` light / `:58-63` dark) — three semantically distinct tokens
  render as one gray.
- `chart-1..5` and `sidebar-*` are unmodified stock shadcn demo colors, never wired to the teal
  `primary` (`hsl(164 39% 22%)`) — the sidebar's "brand" color is accidentally blue/black.
- No shadow scale anywhere; single `--radius` var with no `xl`/`2xl` step;
  `packages/ui/src/card.tsx` hardcodes `rounded-xl` independent of the token.
- `tailwindcss-animate` is already installed and wired into the Tailwind plugin chain, but only
  exercised via Radix's own `data-state` open/close transitions — its entrance/stagger utilities
  sit unused.
- No custom typeface anywhere — `apps/web/tailwind.config.ts` explicitly re-asserts Tailwind's own
  default system-ui sans stack.

---

## External resource verdicts

| Resource | Verdict | Why |
|---|---|---|
| **impeccable.style** | **Adopt now** (content only) | Apache-2.0 agent skill (not a component lib). Zero footprint confirmed — writes only to `.claude/skills/` + `.impeccable/`, no `package.json` impact even fully installed. Its "product" register (distinct from "brand/marketing") maps almost exactly onto what `/chat`/`/studio` already are. **Take:** paraphrase the product-register rules + 13-item "absolute bans" checklist (ghost-cards, gradient text, over-rounded cards, glassmorphism-as-default, hero-metric template, …) into `UI-SPEC.md`/6-pillar review as an appendix — pure prose, no install. **Later:** its `checks.mjs` is a real, dependency-free JS rules engine worth vendoring into the genui repair loop as a pre-flight gate on *generated* code specifically (highest-risk surface for these exact tells). |
| **Magic UI** | **Adopt now — narrow** | MIT copy-paste registry, verified against actual source (not docs). Mostly landing-page glitter; most "effect" components need the `motion` package (absent from this repo). **Take:** `file-tree` — zero new deps (only needs `@radix-ui/react-accordion` + `lucide-react`, both already installed) for code-island's multi-file output. **Take:** hand-port the CSS *technique* only from `shine-border` + `animated-shiny-text` (pure `background-position` keyframes, zero JS) as a teal-only "generating" ring/shimmer — reject `border-beam` (needs `motion` + `offset-path`, weaker browser support) in favor of this. **Reject:** `animated-list` (wrong shape — reverse-stack/spring-pop vs. our top-to-bottom transcript), `terminal` (typewriter reveal is theater when users want to read/copy real code immediately), `dock`, `highlighter` (no matching UI need; drags in 2 new deps). |
| **Agent design skills** | **Adopt now — narrow** | 6 candidates surveyed (anthropics/frontend-design, canvas-design, taste-skill, transitions.dev, ux-designer-skill, hallmark). **Take:** from `ux-designer-skill`, copy exactly 3 reference files — `13a-canvas-navigation.md`, `13b-canvas-objects-performance.md`, `14-ai-ux-patterns.md` — the only material speaking directly to a React Flow canvas + streaming chat/copilot surface. **Take:** from `transitions.dev`, hand-copy 3-4 concrete CSS snippets (modal, panel-reveal, dropdown), retokenized to our custom properties. **Reject as a group:** frontend-design/taste-skill/hallmark/canvas-design — mutually overlapping anti-slop/landing-page process systems that duplicate what this repo's own GSD UI-SPEC + 6-pillar review already enforce; stacking them costs instruction budget with no new information. |
| **styles.refero.design** | **Adopt later — reference only** | Free gallery of ~2,000 real-product style extractions, each downloadable as a `DESIGN.md`. Zero footprint: save the useful ones as static Markdown, read on demand. The shadcn/ui **"clinical blueprint on frosted paper"** style is structurally near-identical to our own 60/30/10 contract — take its numeric backing verbatim (two-value radius allowlist, stacked hairline shadow recipe, ±0.05em letter-spacing bounds) as harder numeric backing we don't currently have written down. Seline Analytics' "exactly one chromatic accent per viewport, only the primary CTA" is a clean, quotable restatement of our own accent-allowlist wording. |
| **Tailark blocks** | **Skip** | MIT, confirmed via direct GitHub listing: all 17 block families (hero/pricing/testimonials/footer/auth/…) are marketing/auth blocks — **zero** app-shell, dashboard, table, empty-state, or illustration content. No marketing/landing route exists in this app for these blocks to serve. Real Tailwind v4-vs-v3 incompatibility also confirmed (newer blocks are CSS-first v4 syntax; this repo is pinned to v3.4.4). **Gap-check follow-up, resolved:** double-checked whether Tailark quietly covers the empty-state/illustration gap flagged 4 times across both surfaces — it doesn't; no such category exists in its catalog. Skip stands. |

**Other gap-check follow-ups, resolved directly (no new agents needed):**
- **Iconography** — already consistent. Every icon in both surfaces comes from `lucide-react`; no
  mixed icon sets (verified via grep across all `_canvas`/`_components` files).
- **Keyboard focus states** — already centralized in `packages/ui/src/button.tsx:9`'s base
  `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring` class. Not a gap; app-
  level files rarely declare it themselves because they consume the shared `Button` primitive.
- No `div`-with-`onClick` pattern found anywhere in `_canvas` (confirmed via grep) — the "every
  interactive control is a native button/input" rule is already being followed.

---

## The plan (three phases, in dependency order)

### Phase A — Zero-dependency fixes

Pure token/class-level changes. No new package, no new file most of the time — just correcting
drift against contracts that already exist. Highest fix-to-impact ratio; do this first so phases
B–C build on a clean base.

1. Style React Flow's own DOM classes (`.react-flow__controls`, `__minimap`, `__attribution`,
   `__background`) with existing token vars.
2. Fix `font-medium` at the source — `packages/ui/src/button.tsx`'s `buttonVariants` base class,
   then the 11 Studio call-sites.
3. Replace hardcoded Tailwind palette colors in Studio's 3 amber/red systems with
   `destructive`/`primary`/`muted` tokens (fixes dark-mode breakage for free).
4. Differentiate `ChatNode` vs `GenuiPanelNode` header chrome (small left-border accent or per-kind
   icon) so the canvas isn't a field of identical gray boxes.
5. Consolidate the 3 raw-JSON panes into one shared component (consistent indentation + copy
   button).
6. Restyle the catalog prop `<table>` (zebra rows, muted header fill matching surrounding card
   chrome).
7. Add `transition-colors` + real hover backgrounds to conversation rows and turn-action icon
   buttons.
8. Give assistant messages minimal role chrome (a thin left rail is enough).
9. Give the composer a visual "dock" (`border-t` + a subtle token-safe top shadow).
10. Normalize scrollbar treatment across composer textarea + markdown code/table wrappers to match
    the Radix-styled `ScrollArea` used elsewhere.
11. Differentiate the empty-state components instead of repeating the identical icon+heading+
    paragraph shape four times.

### Phase B — Adopted external picks

Everything researched, narrowed to what earns its footprint. Still zero or near-zero new
dependencies.

1. Fold impeccable's product-register rules + 13-item absolute-bans list into `UI-SPEC.md` as an
   appendix (pure documentation, no install).
2. Port Magic UI's `file-tree` into the code-island file browser (zero new deps).
3. Hand-port a `<GeneratingRing>` primitive from Magic UI's shine-border + animated-shiny-text CSS
   techniques (teal-only, `motion-safe:`-gated, zero JS) — use for "generating" state on genui
   cards in Chat and the sandbox/history tabs in Studio.
4. Copy 3 `ux-designer-skill` reference files (canvas-navigation, canvas-objects-performance,
   ai-ux-patterns) into a slim project reference doc.
5. Hand-copy 3-4 `transitions.dev` CSS snippets (modal, panel-reveal, dropdown), retokenized to our
   custom properties.

### Phase C — Design-system token upgrades

Foundational changes to `globals.css` and the Tailwind preset. Higher leverage than A or B (each
lifts every surface at once) but sequenced last — easiest to get right once Phase A has surfaced
every place a token gap was papered over with a hardcoded value.

1. Differentiate `secondary`/`muted`/`accent` tonally (still neutral, still 60/30/10-compliant, no
   longer three names for one gray).
2. Rebase `chart-1..5` and `sidebar-*` off the teal `primary`.
3. Add a real shadow scale (e.g. `elevation-1/2/3`, teal-tinted ambient) in
   `packages/tailwind-config/base.ts`.
4. Add `xl`/`2xl` radius steps; fix `packages/ui/src/card.tsx`'s hardcoded `rounded-xl` to consume
   the token.
5. Put the already-installed `tailwindcss-animate` to work beyond Radix defaults — entrance/stagger
   on genui panel mount and Studio's history/page-ideas list items.

### Deferred, not forgotten

- styles.refero.design's numeric backing (radius allowlist, shadow recipe, letter-spacing bounds) —
  cite when Phase C's shadow/radius work happens.
- impeccable's `checks.mjs` — vendor into the genui repair loop once that loop is being touched for
  other reasons, not as standalone work.
- Illustration libraries (unDraw, Hero Patterns) — not in the 5 resources scoped here (the sibling
  project's `DESIGN-RESEARCH.md` names them), but a legitimate zero-dependency option if empty-state
  polish (Phase A, item 11) wants a richer treatment later.

### Explicit non-interference

`GenuiPartBoundary`'s triple-nested chrome (node shell + inner padding + its own card wrapper) was
flagged in `23-UI-REVIEW.md` and is already scoped as a mandatory prerequisite of Phase 24
(`24-03-PLAN.md`'s new `variant="bare"` prop). **Nothing in this plan touches that file** — Phase 24
owns that fix.

---

## Locked constraints this plan must keep respecting

- Teal `primary` (`hsl(164 39% 22%)`) — never introduce a second brand hue.
- 2-weight typography (`font-normal`/`font-semibold` only, no `font-medium`).
- 4-role type scale (`text-xs`/`sm`/`base`/`2xl`).
- 8-point spacing scale.
- 60/30/10 color discipline; accent reserved for an explicit allowlist, never decoration.
- No new npm dependency without strong justification (this plan introduces zero).
