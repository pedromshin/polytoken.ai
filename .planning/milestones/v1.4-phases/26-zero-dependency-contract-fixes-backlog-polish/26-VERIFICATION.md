---
phase: 26-zero-dependency-contract-fixes-backlog-polish
verified: 2026-07-06T22:30:00Z
status: human_needed
score: 5/5 must-haves verified (code-level); 4 visual/dark-mode items need human confirmation
overrides_applied: 0
human_verification:
  - test: "Load /chat with a multi-panel canvas in both light and dark mode; inspect React Flow's Controls, MiniMap, Background dot-grid, and Attribution"
    expected: "Controls/MiniMap use card/border/muted token colors (not stock light-gray boxes) in both modes; Background dots and MiniMap node fills read from --border/--muted-foreground; Attribution bar is a subtle translucent background/muted-foreground caption"
    why_human: "Token-correctness in BOTH light and dark mode is a rendered-pixel judgment; grep can confirm the CSS/props reference hsl(var(--token)) but cannot confirm the resulting visual contrast/appearance is correct in each theme"
  - test: "On a fresh canvas, create a chat node plus 3-4 genui panels and observe the dagre auto-layout"
    expected: "Panels spread with real horizontal/vertical breathing room (nodesep 64px) instead of a cramped single vertical column; ChatNode (teal left stripe + MessageSquare icon) and GenuiPanelNode (lighter bg-muted/40 header + PanelsTopLeft icon) are visually distinguishable at a glance"
    why_human: "Layout spacing and at-a-glance visual differentiation are rendered-pixel/perception judgments, not gate-able by grep"
  - test: "Open /studio and exercise code-island-frame (PHASE_TONE states, ViolationList), page-ideas curveball badge, and history-island FallbackNotice in both light and dark mode"
    expected: "All previously-amber/red/white treatments now render from destructive/primary/muted tokens with correct contrast and no washed-out or invisible text in dark mode"
    why_human: "Dark-mode contrast/appearance of the token recipes is a rendered judgment; code confirms the classes are token-based (grep-verified zero amber/red/emerald/bg-white), not that the resulting dark-mode rendering looks correct"
  - test: "Visually compare the three EmptyState call sites (ChatHomeEmptyState, CanvasEmptyState, UnknownNodeTypePlaceholder) side by side, and separately confirm every Button label (Send, New chat, Retry, model-picker trigger) now renders at normal (not medium) weight app-wide"
    expected: "The three empty states read as differentiated (spacious+CTA vs compact vs inline+destructive+caption) while each individually looks pixel-identical to its pre-refactor rendering; Button labels show no weight regression anywhere in /chat or /studio"
    why_human: "Pixel-identical-to-before and weight legibility are visual comparisons across two states (before/after) that cannot be verified by static analysis of the current tree alone"
---

# Phase 26: Zero-Dependency Contract Fixes + Backlog Polish Verification Report

**Phase Goal:** `/chat` and `/studio`'s hand-built chrome stops reading as an unstyled library
drop-in or a set of undifferentiated boxes — every surface correctly uses the app's existing token
system, in both light and dark mode — and two small, independent backlog defects (declared-state
text binding, cramped canvas auto-layout) are fixed.

**Verified:** 2026-07-06T22:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | React Flow chrome (`Controls`/`MiniMap`/`Background`/`Attribution`) renders with app token vars in light+dark; `ChatNode` vs `GenuiPanelNode` visually distinguishable via per-kind accent/icon | ✓ VERIFIED (code) / needs visual confirm | `globals.css` has `.react-flow__controls/-controls-button/-controls-button:hover/-controls-button svg/-minimap/-attribution` all resolving to `hsl(var(--token))`/`@apply` token utilities (lines 89-107); `chat-canvas.tsx:642` `<Background color="hsl(var(--border))">`, `:648-650` `<MiniMap maskColor/nodeColor/nodeStrokeColor>` all token-based; `chat-node.tsx:118,150` has `MessageSquare` icon + `border-l-2 border-l-primary`; `genui-panel-node.tsx:86,88` has `bg-muted/40` + `PanelsTopLeft` icon |
| 2 | No rendered text in `/chat`/`/studio` uses `font-medium` — fixed at `buttonVariants` base + all 11 Studio call-sites | ✓ VERIFIED | `packages/ui/src/button.tsx:9` uses `font-normal` (zero `font-medium`); `grep -rn "font-medium" apps/web/src/app/chat apps/web/src/app/studio` (excluding tests) returns **zero** matches; the only remaining hits anywhere in those trees are the negative assertion + comment in `markdown-renderer.test.tsx` |
| 3 | Studio's 3 hardcoded amber/red color systems + 3 duplicated raw-JSON panes replaced by token-based treatments; JSON panes share one component with copy button; catalog prop table has zebra + muted header | ✓ VERIFIED | `grep -rnE "amber-|red-[0-9]|emerald-|bg-white"` across `code-island-frame.tsx`, `page-ideas-island.tsx`, `history-island.tsx`, `code-sandbox-island.tsx` returns zero matches; no `dark:(bg|text|border)-(amber|red|emerald)` overrides remain; `json-pane.tsx` exists (`JsonPane`/`JsonPaneProps` exports) and is imported+used by `generation-sandbox-island.tsx:70,399`, `history-island.tsx:43,441`, `preview/page.tsx:15,88`; `catalog-browser-island.tsx:111-120` has `bg-muted/40` header band + `odd:bg-muted/20` zebra rows + `font-semibold` headers |
| 4 | Conversation rows, turn-action buttons, composer, and scrollbars present consistent eased hover/transition + dock treatment; assistant messages carry a thin role-chrome rail | ✓ VERIFIED | `conversation-row.tsx:65,68,105` has `transition-colors` + `hover:bg-muted`; `turn-action-row.tsx:58,72` has `transition-colors hover:bg-muted hover:text-foreground`; `composer.tsx:76` outer wrapper `w-full shrink-0 border-t border-border/60 bg-background shadow-sm`; `message-turn.tsx:127` assistant branch `border-l-2 border-l-border/60 pl-3`; `globals.css:114-128` `.scrollbar-token` utility (10px thumb, `bg-border`, `rounded-full`) applied to composer Textarea (`composer.tsx:86`), markdown Pre/Table use actual Radix `ScrollArea`/`ScrollBar` |
| 5 | Empty-states differentiated; new canvas panels no longer stack cramped; "counter bound to state" prompt produces live-updating `dataRef` render | ✓ VERIFIED | `apps/web/src/components/empty-state.tsx` exists (`EmptyState`/`EmptyStateProps`), imported by `chat-home-empty-state.tsx`, `canvas-empty-state.tsx`, `unknown-node-type-placeholder.tsx`; `canvas-layout.ts:65-67` `nodesep: 64` (was 32), `rankdir: "LR"` unchanged; `genui_generator_adapter.py:114-129` `_SYSTEM_PROMPT_TEXT` teaches `dataRef`-bound `list`/`conditional` binding + `setState` absolute-vs-increment semantics; regression test `test_system_prompt_teaches_dataref_state_binding` (line 677) passes |

**Score:** 5/5 truths verified at the code level. All 5 carry a genuine visual/dark-mode component
that only a human in a browser can confirm (see Human Verification Required below) — this is why
overall status is `human_needed`, not `passed`.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/app/globals.css` | React Flow `@layer components` chrome + `.scrollbar-token` `@layer utilities` | ✓ VERIFIED | Both blocks present (lines 89-128); purely additive diff vs pre-phase HEAD — no `:root`/`.dark` custom-property line touched |
| `apps/web/src/app/chat/_canvas/chat-canvas.tsx` | Token SVG-fill props on `Background`/`MiniMap` | ✓ VERIFIED | `color="hsl(var(--border))"`, `maskColor`/`nodeColor`/`nodeStrokeColor` all token-based |
| `apps/web/src/app/chat/_components/composer.tsx` | Dock band + scrollbar-token textarea | ✓ VERIFIED | `border-t border-border/60 bg-background shadow-sm` wrapper; `scrollbar-token` on Textarea |
| `packages/ui/src/button.tsx` | `buttonVariants` base emits `font-normal` | ✓ VERIFIED | Line 9 confirmed |
| `apps/web/src/app/studio/_components/json-pane.tsx` | Shared `JsonPane` w/ copy button | ✓ VERIFIED + WIRED | Exists, exports `JsonPane`/`JsonPaneProps`, `aria-label="Copy JSON"` present; consumed at 3 call sites |
| `apps/web/src/app/studio/_components/code-island-frame.tsx` | Token-based PHASE_TONE/ViolationList/iframe | ✓ VERIFIED | Zero amber/red/emerald/bg-white/dark: overrides |
| `apps/web/src/app/studio/_components/catalog-browser-island.tsx` | Zebra rows + muted header | ✓ VERIFIED | `bg-muted/40` header, `odd:bg-muted/20` rows, `font-semibold` th |
| `apps/web/src/app/chat/_canvas/chat-node.tsx` / `genui-panel-node.tsx` | Differentiated header chrome | ✓ VERIFIED | `border-l-primary`+`MessageSquare` vs `bg-muted/40`+`PanelsTopLeft` |
| `apps/web/src/app/chat/_canvas/canvas-layout.ts` | `nodesep` widened, 8-pt compliant | ✓ VERIFIED | `nodesep: 64`, `ranksep: 64`, `rankdir: "LR"` unchanged |
| `apps/web/src/components/empty-state.tsx` | Shared `EmptyState` primitive | ✓ VERIFIED + WIRED | Exists; imported by all 3 call sites |
| `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` | `dataRef`/`setState` prompt guidance | ✓ VERIFIED | Lines 114-129; regression test passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `chat-canvas.tsx` | `globals.css` `.react-flow__*` | React Flow class names + inline color props | ✓ WIRED | `Background`/`MiniMap`/`Controls` mount unchanged; CSS selectors match rendered DOM classes from `@xyflow/react` |
| `composer.tsx` | `globals.css .scrollbar-token` | className | ✓ WIRED | `scrollbar-token` present on Textarea className |
| `generation-sandbox-island.tsx`/`history-island.tsx`/`preview/page.tsx` | `json-pane.tsx` | `import { JsonPane }` | ✓ WIRED | All 3 import + render `<JsonPane value={...} />`; zero residual `JSON.stringify` panes |
| `chat-home-empty-state.tsx`/`canvas-empty-state.tsx`/`unknown-node-type-placeholder.tsx` | `empty-state.tsx` | `import { EmptyState } from "~/components/empty-state"` | ✓ WIRED | All 3 confirmed |
| `genui_generator_adapter.py` | test suite | `_build_system_blocks()` regression assertion | ✓ WIRED | `test_system_prompt_teaches_dataref_state_binding` passes; `test_build_system_blocks_identical_regardless_of_pack` (byte-identical/pack-agnostic gate) also passes |

### Hard Constraints (locked, phase-wide)

| Constraint | Status | Evidence |
|---|---|---|
| `packages/genui/src/renderer/spec-renderer.tsx` unmodified | ✓ VERIFIED | `git log --oneline 9ab8173..8f08d0f -- packages/genui/src/renderer/spec-renderer.tsx` returns empty |
| `GenuiPartBoundary`/`InteractiveWidgetBoundary` untouched | ✓ VERIFIED | No boundary files appear in `git log` for the phase 26 commit range |
| Zero new npm dependencies | ✓ VERIFIED | `git diff --stat 9ab8173..8f08d0f -- package.json package-lock.json "**/package.json"` is empty across the whole phase-26 commit range |
| No token VALUE change in `globals.css` `:root`/`.dark` | ✓ VERIFIED | Full `git diff` of `globals.css` across the phase range is purely additive (2 new `@layer` blocks appended after line 81); zero lines removed/changed in the existing `:root`/`.dark` blocks |
| Zero `font-medium` app-wide (excluding negative-assertion test) | ✓ VERIFIED | Recursive grep across `apps/web/src/app/chat` + `apps/web/src/app/studio` (incl. test dirs) shows only the intentional negative assertion in `markdown-renderer.test.tsx` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Web typecheck (full workspace, one run) | `npm run typecheck -w @nauta/web` | exits 0, no errors | ✓ PASS |
| `empty-state` + `json-pane` colocated tests | `npm run test -w @nauta/web -- empty-state json-pane --run` | 2 files, 7/7 tests pass | ✓ PASS |
| POLISH-01 regression test (named, not full suite) | `uv run pytest tests/infrastructure/test_genui_generator_adapter.py -k "dataref_state_binding or identical_regardless_of_pack"` | 2 passed, 23 deselected | ✓ PASS |
| Debt-marker scan (TBD/FIXME/XXX/TODO/HACK) across all 26 phase-modified files | `grep -nE "TBD|FIXME|XXX|TODO|HACK"` | zero hits | ✓ PASS |

Full-suite claims from SUMMARY.md (158/158 web, 477 genui, 25 generator-adapter pytest) were not
re-run in full per the verification approach's guidance to avoid redundant full-suite execution;
the targeted spot-checks above corroborate the specific artifacts this phase touched.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FIX-01 | 26-05 | React Flow chrome tokens | ✓ SATISFIED | globals.css + chat-canvas.tsx |
| FIX-02 | 26-01,02,03 | Zero font-medium | ✓ SATISFIED | button.tsx + grep gate |
| FIX-03 | 26-01,02 | Studio hardcoded colors → tokens | ✓ SATISFIED | code-island-frame.tsx, history-island.tsx, page-ideas-island.tsx, code-sandbox-island.tsx |
| FIX-04 | 26-04 | Node header differentiation | ✓ SATISFIED | chat-node.tsx, genui-panel-node.tsx |
| FIX-05 | 26-01 | Shared JsonPane | ✓ SATISFIED | json-pane.tsx + 3 call sites |
| FIX-06 | 26-02 | Catalog prop table zebra/header | ✓ SATISFIED | catalog-browser-island.tsx |
| FIX-07 | 26-03 | Hover affordances | ✓ SATISFIED | conversation-row.tsx, turn-action-row.tsx |
| FIX-08 | 26-03 | Assistant left rail | ✓ SATISFIED | message-turn.tsx |
| FIX-09 | 26-05 | Composer dock | ✓ SATISFIED | composer.tsx |
| FIX-10 | 26-05 | Uniform scrollbars | ✓ SATISFIED | globals.css `.scrollbar-token` + ScrollArea wraps |
| FIX-11 | 26-06 | Differentiated empty states | ✓ SATISFIED | empty-state.tsx + 3 call sites |
| POLISH-01 | 26-07 | dataRef state-binding prompt | ✓ SATISFIED | genui_generator_adapter.py + regression test |
| POLISH-02 | 26-04 | Canvas auto-layout | ✓ SATISFIED | canvas-layout.ts nodesep 32→64 |

**Note — REQUIREMENTS.md traceability-table inconsistency (documentation only, not a code gap):**
`.planning/REQUIREMENTS.md`'s top checklist marks FIX-01/FIX-09/FIX-10 `[x]` (complete), but the
"Traceability" table near the bottom (lines 88, 96-97) still lists these three as **Pending** while
FIX-02..08/11 and POLISH-01/02 are marked Complete. Code-level verification above confirms all
three (FIX-01/09/10, all delivered by 26-05-PLAN.md) are fully implemented and wired identically to
the other "Complete" rows — this is a stale traceability-table row that wasn't updated during
26-05's close-out, not evidence of missing work. Recommend a docs-only follow-up to sync the table;
does not block phase 26 or gate phase 27/28.

### Anti-Patterns Found

None. Debt-marker scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) across all 26 files touched by phase 26
returned zero blocking markers — every `placeholder` string match is either an HTML `placeholder`
attribute, a pre-existing/legitimate "safe placeholder" fallback-UI concept (code-island sandbox
healing), or explicit anti-placeholder guidance text added to the LLM system prompt (POLISH-01).

### Human Verification Required

See YAML frontmatter `human_verification` for the structured list. In summary, 4 items — all
inherent to a visual/token-discipline phase whose success criteria explicitly require "light and
dark mode" correctness and "at a glance" differentiation, neither of which is verifiable from
source code alone:

1. **React Flow chrome + composer dock + scrollbars** — token-correct rendering in light AND dark mode
2. **Canvas auto-layout + node differentiation** — panel spacing and at-a-glance visual distinction
3. **Studio dark-mode color correctness** — PHASE_TONE/ViolationList/curveball/FallbackNotice contrast in dark mode
4. **Empty-state differentiation + button-weight regression check** — before/after visual comparison across the whole app

### Gaps Summary

No code-level gaps found. All 5 ROADMAP success criteria, all 13 requirements (FIX-01..11,
POLISH-01/02), and all locked hard constraints (spec-renderer untouched, zero new deps, no token
value changes) are verified directly against the current codebase — not inferred from SUMMARY.md
claims. The phase is code-complete. The only reason status is `human_needed` rather than `passed`
is that this phase's own success criteria are partly visual/dark-mode judgments that no static
analysis can close — a one-time browser pass (light + dark) covering the 4 items above is the
remaining step before this phase can be marked fully closed out.

One informational-only documentation gap was found (REQUIREMENTS.md traceability table stale for
FIX-01/09/10) — does not affect phase-goal achievement, recommend syncing in a follow-up docs commit.

---

*Verified: 2026-07-06T22:30:00Z*
*Verifier: Claude (gsd-verifier)*
