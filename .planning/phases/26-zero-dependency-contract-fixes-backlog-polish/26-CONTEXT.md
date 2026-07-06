# Phase 26: Zero-Dependency Contract Fixes + Backlog Polish - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommended answers auto-accepted per yolo config; each marked [auto])

<domain>
## Phase Boundary

`/chat` and `/studio`'s hand-built chrome stops reading as an unstyled library drop-in or a set of
undifferentiated boxes — every surface correctly uses the app's existing token system, in both light
and dark mode — and two small, independent backlog defects (declared-state text binding via the
generator prompt, cramped canvas auto-layout) are fixed. Requirements: FIX-01..11, POLISH-01,
POLISH-02.

**Locked source of truth:** `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` — every FIX item's
exact file/line locus is documented there (code-level audit, 2026-07-05, drift-verified 2026-07-06).
Do not re-derive; read it during planning.

**Hard constraints (non-negotiable):**
- Zero new npm dependencies.
- Teal `primary` (`hsl(164 39% 22%)`) only — never a second brand hue.
- 2-weight typography: `font-normal`/`font-semibold` only (no `font-medium`).
- 4-role type scale (`text-xs`/`sm`/`base`/`2xl`); 8-point spacing; 60/30/10 color discipline.
- `packages/genui/src/renderer/spec-renderer.tsx` is UNMODIFIED (locked since v1.1).
- `GenuiPartBoundary`/`InteractiveWidgetBoundary` chrome is untouched (owned by Phase 24).
- This phase introduces NO design-token changes to `globals.css`/tailwind preset (that is Phase 28)
  — Phase 26 corrects drift against tokens that already exist.

</domain>

<decisions>
## Implementation Decisions

### Canvas node & React Flow chrome (FIX-01, FIX-04)
- [auto] Style React Flow chrome (`.react-flow__controls`, `__minimap`, `__background`,
  `__attribution`) via global CSS targeting the library classes with existing token vars
  (`--background`/`--border`/`--muted` etc.) — both light and dark mode.
- [auto] FIX-04 differentiation: per-kind header icon + thin left-border accent. ChatNode gets the
  teal `primary` accent (it is THE conversational surface — accent-allowlist-compliant);
  GenuiPanelNode gets a neutral tonal treatment (border/muted shift), NOT a second hue.
- [auto] Node shells share a base recipe but stop being byte-identical — differentiation lives in
  the header treatment, not layout dimensions (canvas layout math untouched).

### Shared components (FIX-05, FIX-06, FIX-11)
- [auto] FIX-05: one app-local shared JSON pane component in `apps/web` (not `packages/ui` — it is
  a debug/inspector affordance, not a design-system primitive): consistent 2-space indentation,
  monospace `text-xs`, Radix `ScrollArea`, ghost-variant copy button (existing `Button`), token
  colors only. Replaces the 3 `JSON.stringify` panes (generation-sandbox, history, preview).
- [auto] FIX-06: catalog prop table styled in place (zebra via `odd:bg-muted/40`-style token
  classes, muted header fill matching the surrounding card chrome) — plain markup, no table library.
- [auto] FIX-11: consolidate the 3–4 near-duplicate empty states into ONE shared EmptyState
  primitive with per-surface icon/copy/tone variants — differentiation through variants, not four
  bespoke components.

### Chat surface affordances (FIX-07, FIX-08, FIX-09, FIX-10)
- [auto] FIX-07: add `transition-colors` + real rest/hover backgrounds to conversation rows and
  turn-action icon buttons (token classes only).
- [auto] FIX-08: assistant messages get a thin left rail (border-l, token color) as minimal role
  chrome — no bubble, no avatar (research doc: "a thin left rail is enough").
- [auto] FIX-09: composer dock = `border-t` + subtle token-safe top shadow (existing shadow
  utilities only — Phase 28 owns any new shadow scale).
- [auto] FIX-10: for native-scroll elements that cannot nest in Radix ScrollArea (the composer
  textarea), add a token-matched scrollbar CSS utility (`::-webkit-scrollbar*` + `scrollbar-width`)
  replicating the ScrollArea thumb aesthetic; wrap markdown code/table wrappers in ScrollArea where
  structurally possible, otherwise apply the same utility. One scrollbar aesthetic per page.

### Studio token discipline (FIX-02, FIX-03)
- [auto] FIX-02: remove `font-medium` from `packages/ui/src/button.tsx` `buttonVariants` base class
  (replace with nothing — inherits `font-normal`; anything needing emphasis uses `font-semibold`),
  then sweep the 11 verified call-sites across 6 studio files. Add/extend a grep-able check if one
  exists; otherwise the UI review pass is the gate.
- [auto] FIX-03: replace the three hardcoded color systems with semantic tokens —
  `code-island-frame.tsx` PHASE_TONE map + ViolationList tones → `destructive`/`primary`/`muted`
  recipes; the `bg-white` iframe wrapper → `bg-background` (or `bg-card`); `page-ideas-island.tsx`
  curveball badge + `history-island.tsx` FallbackNotice + `code-sandbox-island.tsx` `text-red-600`
  → token equivalents. Dark mode must render correctly with zero `dark:` raw-palette overrides.

### Backlog polish (POLISH-01, POLISH-02)
- [auto] POLISH-01 is generator-PROMPT-only (999.8 option (a)): teach the declarative generator to
  express declared-state display via `dataRef`-bound nodes (never `{{mustache}}` inside text
  `content`), and clarify `setState` absolute-vs-increment semantics. Add a regression
  fixture/test asserting a "counter bound to state" prompt shape produces a `dataRef` binding.
  ZERO renderer changes (999.8 option (b) explicitly out of scope).
- [auto] POLISH-02: drift-check found `canvas-layout.ts` already uses `rankdir: "LR"` — the cramped
  vertical column comes from same-rank stacking and/or `offsetCascadePosition` cascade placement.
  Fix at the layout-utility level (nodesep/ranksep tuning, smarter initial placement for new
  panels); do NOT rewrite the persistence or node-registry layers.

### Claude's Discretion
- Exact icon choices (lucide-react only — the app's sole icon set), exact token-class recipes,
  where the shared EmptyState/JsonPane components live within `apps/web`, and test granularity are
  at Claude's discretion during planning/execution.

</decisions>

<code_context>
## Existing Code Insights

### Drift check (2026-07-06 — audit claims re-verified against HEAD)
- `packages/ui/src/button.tsx:9` — `font-medium` still in `buttonVariants` base class ✓
- Zero `.react-flow__*` styling anywhere in `apps/web/src` ✓
- Exactly 11 `font-medium` occurrences across 6 studio files (code-sandbox-island 1,
  page-ideas-island 1, code-island-frame 1, catalog-browser-island 4, generation-state-chrome 2,
  history-island 2) ✓
- `code-island-frame.tsx:62` PHASE_TONE raw-palette map, `:160` `bg-white` iframe wrapper ✓
- `apps/web/src/app/chat/_canvas/canvas-layout.ts:58` — dagre `rankdir: "LR"` already; POLISH-02's
  observed stacking is same-rank/cascade behavior, not rank direction

### Reusable Assets
- Radix-styled `ScrollArea` (used by MessageList/ConversationRail) — the scrollbar reference look
- `Button` ghost variant for the JSON-pane copy button; `lucide-react` icon set
- `tailwindcss-animate` installed and wired (do not expand usage here — Phase 28 owns entrances)
- Full file/line inventory of every defect: `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md`
  → "Current state (code-level audit)"

### Established Patterns
- Token system: `globals.css` CSS custom properties + `packages/tailwind-config` preset
  (Tailwind v3.4.4 — NOT v4 syntax)
- Repo is npm-workspaces canonical (`npm install --workspace=@nauta/web`), NOT pnpm
- Vitest for web/app tests; unmocked DOM tests are the norm for chat/canvas
  (`panel-data-flow.test.tsx` precedent)
- Generator prompts live in the Python email-listener app (declarative generator);
  its tests are pytest with RED→GREEN TDD convention

### Integration Points
- `apps/web/src/app/chat/_canvas/*` — ChatNode/GenuiPanelNode shells, canvas-layout.ts
- `apps/web/src/app/chat/_components/*` — message-turn, conversation-row, turn-action-row,
  composer, empty states
- `apps/web/src/app/studio/_components/*` — the 6 files with token violations
- `packages/ui/src/button.tsx` — the font-medium root cause (app-wide blast radius: every Button
  label changes weight; visually verify Send/New chat/Retry/model picker after)
- Python generator prompt module (locate via grep for the declarative generator's system prompt;
  the code-island generator prompt is separate and NOT in scope)

</code_context>

<specifics>
## Specific Ideas

- Research doc's phrasing is the spec: canvas must stop being "the single most
  off-the-shelf-library-dropped-in visual moment"; assistant turns need chrome "beyond alignment
  alone"; "one scrollbar aesthetic per page".
- FIX-02's blast radius is intentional — fixing `buttonVariants` at the source changes every
  Button in the app; that is the point (restore the contract at the design-system level).

</specifics>

<deferred>
## Deferred Ideas

- Any new/changed token values (secondary/muted/accent split, shadow scale, radius steps,
  chart/sidebar rebase) → Phase 28.
- External adoptions (file-tree, GeneratingRing, impeccable bans appendix, reference docs)
  → Phase 27.
- 999.8 option (b) renderer affordance → backlog (touches locked SpecRenderer).
- Richer empty-state illustrations (unDraw/Hero Patterns) → noted in research doc as a later
  option if Phase A's treatment wants more.

</deferred>
