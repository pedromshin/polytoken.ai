# Phase 26 — UI Review (Retroactive Audit)

**Audited:** 2026-07-06
**Baseline:** `26-UI-SPEC.md` (literal target classes per FIX-01..11/POLISH-01/02)
**Screenshots:** captured (dev server was live on `localhost:3000`) — `.planning/ui-reviews/26-20260706-193623/` (chat-light.png, chat-dark.png, studio-light.png, studio-dark.png; gitignored, not committed)
**Scope note:** this audit uses the phase-specific 6-dimension rubric supplied by the review task (Typography discipline / Color-token discipline / Spacing / Interaction states / Consistency / A11y), not the generic 6-pillar template, since `26-UI-SPEC.md` is a literal per-fix diff contract rather than a from-scratch design system.

---

## Pillar Scores

| Dimension | Score | Key Finding |
|-----------|-------|-------------|
| 1. Typography discipline | 4/4 | All 11 FIX-02 call-sites + `button.tsx` base match the spec's literal target verbatim; grep confirms zero `font-medium` outside one intentional negative-assertion test; exactly 4 font sizes (`text-xs/sm/base/2xl`) in scope |
| 2. Color/token discipline | 4/4 | Zero `amber-`/`red-`/`emerald-`/`bg-white`/`dark:` overrides remain in `/chat` or `/studio`; `ChatNode`'s stripe+icon is the only new `primary` use, every other `primary` hit in scope is a pre-existing allowlisted use |
| 3. Spacing | 4/4 | All new classes (`pl-3`, `px-2 py-2`, `border-l-2`, `nodesep: 64`) are on the 4-point grid; the only arbitrary-px values present (`min-w-[400px]`, `text-[10px]` badges, etc.) pre-date this phase and are explicitly out of scope per the spec itself |
| 4. Interaction states | 3/4 | `button.tsx` focus-visible ring intact; FIX-07 hover fixes correct — but `JsonPane`'s new icon-only copy button ships at the default 36px touch target while every other isolated icon-only action button this phase touches (composer Send/Stop, conversation-row overflow, minimap toggle) was explicitly bumped to 44px (`size-11`) |
| 5. Consistency | 3/4 | `JsonPane`/`EmptyState` correctly consumed at exactly 3 call sites each; `/chat` has one scrollbar aesthetic everywhere — but `/studio` still mixes native `overflow-y-auto`/`overflow-x-auto` (6+ untouched spots) with the Radix `ScrollArea` look FIX-10 established, contradicting the spec's own closing claim of "exactly ONE scrollbar aesthetic ... per page" |
| 6. A11y | 4/4 | All new/changed icons correctly `aria-hidden` or carry their own `aria-label`; `JsonPane`'s copy button has `aria-label="Copy JSON"`; no heading/labeling regressions found in any touched file |

**Overall: 22/24 — 4/6 dimensions clean, 2/6 carry a WARNING-level flag (no BLOCKERs)**

---

## Top Priority Fixes

1. **`JsonPane` copy button ships below the app's own 44px touch-target convention** — `apps/web/src/app/studio/_components/json-pane.tsx:59-65` uses `<Button variant="ghost" size="icon">` with no size override, resolving to the base `size-icon` class `h-9 w-9` (36px). Every other isolated (non-dense-row) icon-only button this same phase touches was bumped to `size-11` (44px) — `composer.tsx:88-92` (Send/Stop), `conversation-row.tsx:100-108` (overflow menu), and the pre-existing minimap toggle in `chat-canvas.tsx:654-664`. **User impact:** the JSON-pane copy affordance is a harder mouse/touch target than every sibling icon button in the same visual language, and on a touch device it falls under the generally-recommended 44px minimum. **Fix:** add `className="size-11"` to the `Button` in `json-pane.tsx:59-65` to match the established convention (this does not visually clash — the header bar already has `py-3` of vertical room).

2. **`/studio` does not actually have "one scrollbar aesthetic per page" despite FIX-10's closing claim** — FIX-10 (`26-UI-SPEC.md`) literally scoped and correctly fixed exactly 3 spots (composer `Textarea`, markdown `Pre`, markdown `Table`), and its own text asserts "Either way, exactly ONE scrollbar aesthetic ... exists per page." That is true for `/chat` (verified: `message-list.tsx:118`, `conversation-rail.tsx:132` both use Radix `ScrollArea`, plus the new `.scrollbar-token` textarea). It is **not** true for `/studio`: `generation-sandbox-island.tsx:371`, `history-island.tsx:426` (detail rendered pane), `page-ideas-island.tsx:345` (card grid), `studio-tabs.tsx:125,143` (tab containers), `preview/page.tsx:69`, and `catalog-browser-island.tsx:104` (prop-table overflow) all still use plain `overflow-y-auto`/`overflow-x-auto` with the browser's native scrollbar, sitting alongside `JsonPane`'s and `HistoryMasterList`'s Radix `ScrollArea` in the very same tab strip. **User impact:** scrolling any of these 6+ containers shows the OS-default scrollbar while the JSON pane two panels over shows the app's styled thumb — a visible inconsistency on any non-trivial-height generation output. **Fix:** either (a) narrow the phase's own closing claim in a docs follow-up to "one aesthetic per page for the 3 named FIX-10 spots only," or (b) extend `.scrollbar-token`/`ScrollArea` to the 6 listed native-scroll spots in a follow-up phase (Phase 28 is already the declared home for elevation/scrollbar-adjacent polish work).

3. **(Informational, not a defect)** `.planning/REQUIREMENTS.md`'s traceability table still marks FIX-01/FIX-09/FIX-10 "Pending" while the top checklist and this code audit both confirm all three are fully implemented and wired — already flagged by `26-VERIFICATION.md` as a stale-docs-only gap, repeated here only so it isn't lost between the two review artifacts. No code fix required, a table-sync commit closes it.

---

## Detailed Findings

### 1. Typography discipline (4/4)

- `grep -rn "font-medium" apps/web/src/app/chat apps/web/src/app/studio apps/web/src/components` returns only `markdown-renderer.test.tsx:14,121` — an intentional negative assertion, not a leaked instance.
- `packages/ui/src/button.tsx:9` — `buttonVariants` base is `text-sm font-normal ...` (was `font-medium`) — exact target match.
- All 11 FIX-02 call-sites individually verified against the spec's literal table and match verbatim:
  - `catalog-browser-island.tsx:112-115` — `font-semibold` on all 4 `<th>` ✓
  - `generation-state-chrome.tsx:75` — `text-sm font-semibold text-destructive` ✓
  - `generation-state-chrome.tsx:108` — no local weight override; `Badge`'s own `font-semibold` base (`packages/ui/src/badge.tsx:8`) applies ✓
  - `code-sandbox-island.tsx:152` — `text-sm font-semibold` ✓
  - `code-island-frame.tsx:200` — `font-semibold` ✓
  - `history-island.tsx:145` — weight class dropped entirely (plain `text-sm`) ✓
  - `history-island.tsx:406` — `text-xs font-normal text-muted-foreground` ✓
  - `page-ideas-island.tsx:318` — `text-sm font-semibold` ✓
- Font-size distribution in scope: `text-xs` (73), `text-sm` (57), `text-base` (8), `text-2xl` (3) — exactly the spec's 4-role scale (Label/Body/Heading/Display), no `text-lg`/`xl`/`3xl` leaked in.
- Font-weight distribution: `font-semibold` (33), `font-normal` (3) — exactly 2 weights, matching the "no third weight" contract.

### 2. Color/token discipline (4/4)

- `grep -rnE "amber-|red-[0-9]|emerald-|bg-white"` across `apps/web/src/app/chat`, `apps/web/src/app/studio`, `apps/web/src/components` → zero matches.
- `grep -rn "dark:"` across the same scope → zero matches (no manual dark-mode overrides remain).
- `grep -rnE "#[0-9a-fA-F]{3,8}|rgb\("` across the same scope → zero matches (no hardcoded hex/rgb).
- FIX-03(a) `PHASE_TONE` (`code-island-frame.tsx:62-69`) — matches the spec's 3-bucket recipe verbatim (`running`/`healing` → `border-border bg-muted/40 text-foreground`; `rendered`/`healed` → `border-primary/30 bg-primary/10 text-primary`; `rejected`/`fallback` → `border-destructive/30 bg-destructive/10 text-destructive`).
- FIX-03(b) `ViolationList` tone prop (`code-island-frame.tsx:207-230`) — `destructive`/`muted` recipes match verbatim.
- FIX-03(c) iframe wrapper (`code-island-frame.tsx:160`) — `bg-background` confirmed (was `bg-white`).
- FIX-03(d) curveball badge (`page-ideas-island.tsx:105-109`) — `<Badge variant="outline" className="text-xs">curveball</Badge>` matches target exactly.
- FIX-03(e) `FallbackNotice` (`history-island.tsx:243-252`) — matches the `generation-state-chrome`-derived destructive recipe verbatim, copy unchanged.
- FIX-03(f) `code-sandbox-island.tsx:165` — `text-destructive` confirmed (was `text-red-600`).
- Accent-allowlist check: `grep -rnE "text-primary|bg-primary|border-primary|border-l-primary|ring-primary"` across scope returns 11 files; all uses beyond `chat-node.tsx:118,150` (the new stripe+icon) are pre-existing allowlisted uses (selection rings in `chat-node.tsx`/`genui-panel-node.tsx`, streaming dot, markdown link color, active-conversation-row tint, model-picker active dot, app-sidebar active item) — no scope creep.
- `GenuiPanelNode`'s header (`genui-panel-node.tsx:86`) correctly stays `bg-muted/40` (one step lighter than `ChatNode`'s `bg-muted/60`), no second hue invented.

### 3. Spacing (4/4)

- New classes introduced by this phase (`border-l-2`, `pl-3` in `message-turn.tsx:127`, `px-2 py-2`/`py-1` in `catalog-browser-island.tsx`, `nodesep: 64`/`ranksep: 64` in `canvas-layout.ts:66-67`) are all on-grid.
- `grep -rnE "\[[0-9]+(px|rem)\]"` across scope surfaces only pre-existing arbitrary values explicitly carved out by the spec (`min-w-[400px] min-h-[320px]` node dimensions from 23-UI-SPEC.md, `w-[280px]` rail width, `text-[10px]` badge captions in Studio, `min-h-[44px]` composer textarea) — none of these were touched or introduced by Phase 26.
- `CASCADE_STEP_PX = 32` (`canvas-layout.ts:107`) stays on the 8-pt scale, unchanged per spec's explicit allowance.

### 4. Interaction states (3/4) — WARNING

- `packages/ui/src/button.tsx:9` — `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring` preserved after the `font-medium` → `font-normal` edit. No regression.
- FIX-07 verified: `conversation-row.tsx:65` (`transition-colors` on the row), `conversation-row.tsx:105` (`hover:bg-muted` added to the overflow trigger), `turn-action-row.tsx:58,72` (`transition-colors hover:bg-muted hover:text-foreground`, `disabled:opacity-30` preserved on regenerate).
- FIX-01 hover: `globals.css:95-97` `.react-flow__controls-button:hover { @apply bg-muted; }` matches target.
- **Flag:** `json-pane.tsx:59-65` — the copy `Button` (`variant="ghost" size="icon"`) resolves to the default `h-9 w-9` (36px) touch target. Every other isolated icon-only button this phase's own diff touches uses an explicit `size-11` (44px) override: `composer.tsx:92`, `conversation-row.tsx:105`, and the pre-existing minimap toggle at `chat-canvas.tsx:660`. `JsonPane`'s copy button is the same category of control (single-purpose, not part of a dense inline row like `TurnActionRow`, which the spec explicitly exempts from the 44px rule) — this is an inconsistency the phase introduced with its own new component, not a pre-existing condition.

### 5. Consistency (3/4) — WARNING

- `JsonPane` (FIX-05) consumed at exactly 3 call sites, confirmed via import + render: `generation-sandbox-island.tsx:70,399`, `history-island.tsx:43,441`, `preview/page.tsx:15,88`. All 3 wrappers keep the identical `bg-muted` outer `div` the spec requires.
- `EmptyState` (FIX-11) consumed at exactly 3 call sites, confirmed: `chat-home-empty-state.tsx`, `canvas-empty-state.tsx`, `unknown-node-type-placeholder.tsx` — each a thin wrapper reproducing its documented variant configuration (spacious+action / compact+centered / inline+destructive+caption) exactly per the spec's table.
- `/chat` scrollbar aesthetic is fully unified: `message-list.tsx:118` and `conversation-rail.tsx:132` both use `ScrollArea`; the composer `Textarea` (`composer.tsx:86`) uses the new `.scrollbar-token` utility (the one native element that structurally cannot host `ScrollArea`, exactly as FIX-10 specifies); markdown `Pre`/`Table` (`markdown-renderer.tsx:84-96,122-134`) both wrap in `ScrollArea`/`ScrollBar orientation="horizontal"`.
- **Flag:** `/studio` is NOT unified. Native `overflow-y-auto`/`overflow-x-auto` (no `.scrollbar-token`, no `ScrollArea`) remain at: `generation-sandbox-island.tsx:371`, `history-island.tsx:426` (detail's rendered-spec pane), `page-ideas-island.tsx:345` (card grid), `studio-tabs.tsx:125,143` (tab content containers), `preview/page.tsx:69`, `catalog-browser-island.tsx:104` (prop-table horizontal scroll). These sit in the same tab strip as `JsonPane`'s and `HistoryMasterList`'s Radix `ScrollArea`, so a user scrolling the rendered-output pane vs. the JSON pane two panels over sees two different scrollbar looks. FIX-10's own text ("exactly ONE scrollbar aesthetic ... exists per page") oversells what the 3 literally-scoped fixes deliver — true for `/chat`, not for `/studio`.

### 6. A11y (4/4)

- FIX-04: `MessageSquare` (`chat-node.tsx:118`) and `PanelsTopLeft` (`genui-panel-node.tsx:88-91`) icons both carry `aria-hidden`; the accessible name for each node header remains the existing title/`"From turn {n}"` text, unchanged.
- FIX-05: `JsonPane`'s copy button has `aria-label="Copy JSON"` (`json-pane.tsx:63`); `Copy`/`Check` icons inside it are `aria-hidden`.
- FIX-07/08: no `aria-label` changes on `conversation-row.tsx`/`turn-action-row.tsx` buttons — hover/rail additions are purely visual, confirmed no regression.
- FIX-01: React Flow's `Controls` built-in button labels are untouched by the CSS-only diff (verified — `globals.css`'s new rules target only color/background classes, no markup change).
- FIX-11: `EmptyState`'s icon is `aria-hidden` in all three branches (`empty-state.tsx:113-116,130-133,146-149`); the heading element carries the accessible content in every variant.
- `GenuiPanelNode`'s streaming dot (`genui-panel-node.tsx:97-102`) correctly carries its own `aria-label="Streaming"` rather than `aria-hidden` (it is a meaningful status indicator, not decorative) — matches the Copywriting Contract table.
- Reduced-motion check: all `animate-pulse` usages introduced/touched by this phase (`message-turn.tsx:208`, `genui-panel-node.tsx:98`) are correctly `motion-safe:`-gated; FIX-07's `transition-colors` is intentionally left ungated (color easing is out of `prefers-reduced-motion` scope, matching `Button`'s own pre-existing base class) — no regression found.

---

## Screenshot Evidence

Dev server was live at `localhost:3000` during this audit (unusual for a retroactive/advisory review, captured opportunistically). 4 screenshots taken via `npx playwright screenshot` (light + dark, `/chat` + `/studio`), stored at `.planning/ui-reviews/26-20260706-193623/` (gitignored):

- `chat-light.png` / `chat-dark.png` — confirms `ChatHomeEmptyState`'s spacious `EmptyState` variant renders correctly in both themes: `MessageSquarePlus` icon, `text-2xl font-semibold` heading, muted body copy, primary "New chat" CTA — no visual regression, dark-mode contrast reads correctly.
- `studio-light.png` / `studio-dark.png` — confirms the Catalog tab's prop table renders the FIX-06 zebra (`odd:bg-muted/20`) + header band (`bg-muted/40`) + `font-semibold` headers correctly in both themes (zebra is intentionally subtle per spec, visible on close inspection in both modes).

Interactive states requiring clicks (Code-Island preset run states, History detail FallbackNotice, canvas node differentiation with live nodes) were not captured — the CLI `playwright screenshot` tool has no click/interaction capability, and the local `playwright` npm package was not resolvable outside the `npx` cache for a custom interaction script. These remain the "human verification required" items already flagged in `26-VERIFICATION.md`; this audit corroborates the code-level claims underlying them but does not independently re-verify the pixel-level dark-mode contrast for those specific interactive states.

---

## Files Audited

- `.planning/phases/26-zero-dependency-contract-fixes-backlog-polish/26-UI-SPEC.md`
- `.planning/phases/26-zero-dependency-contract-fixes-backlog-polish/26-VERIFICATION.md`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/chat/_canvas/chat-node.tsx`
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx`
- `apps/web/src/app/chat/_canvas/canvas-layout.ts`
- `apps/web/src/app/chat/_canvas/chat-canvas.tsx` (Background/MiniMap/Controls mount + CanvasEmptyState parent)
- `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx`
- `apps/web/src/app/chat/_canvas/unknown-node-type-placeholder.tsx`
- `apps/web/src/app/chat/_components/message-turn.tsx`
- `apps/web/src/app/chat/_components/conversation-row.tsx`
- `apps/web/src/app/chat/_components/turn-action-row.tsx`
- `apps/web/src/app/chat/_components/composer.tsx`
- `apps/web/src/app/chat/_components/markdown-renderer.tsx`
- `apps/web/src/app/chat/_components/cost-cap-blocked-card.tsx`
- `apps/web/src/app/chat/_components/inline-error-card.tsx`
- `apps/web/src/app/chat/_components/chat-home-empty-state.tsx`
- `apps/web/src/app/chat/_components/message-list.tsx`
- `apps/web/src/app/chat/_components/conversation-rail.tsx`
- `apps/web/src/app/chat/page.tsx`
- `apps/web/src/app/studio/_components/json-pane.tsx`
- `apps/web/src/app/studio/_components/code-island-frame.tsx`
- `apps/web/src/app/studio/_components/catalog-browser-island.tsx`
- `apps/web/src/app/studio/_components/generation-state-chrome.tsx`
- `apps/web/src/app/studio/_components/code-sandbox-island.tsx`
- `apps/web/src/app/studio/_components/page-ideas-island.tsx`
- `apps/web/src/app/studio/_components/history-island.tsx`
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` (JsonPane call site + native-scroll check)
- `apps/web/src/app/studio/preview/page.tsx` (JsonPane call site + native-scroll check)
- `apps/web/src/components/empty-state.tsx`
- `packages/ui/src/button.tsx`
- `packages/ui/src/badge.tsx`
- `packages/ui/src/scroll-area.tsx`

**Registry Safety:** not applicable — no `components.json`/shadcn CLI registry exists in this repo (confirmed by `26-UI-SPEC.md`'s own Design System table); registry audit skipped per the gate condition.
