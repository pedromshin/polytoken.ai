# Phase 23 — UI Review

**Audited:** 2026-07-05
**Baseline:** `.planning/phases/23-2d-canvas-panels-as-nodes-shared-state/23-UI-SPEC.md` (approved, 6/6 checker PASS)
**Screenshots:** partially captured — dev server running at `localhost:3000/chat` (Next.js), `.planning/ui-reviews/23-20260705-023542/`. The chat shell (rail, Phase-22 toolbar chrome) rendered, but the local session's `chat.listConversations` query never resolved past a loading skeleton (a session/auth-state issue in this dev environment, unrelated to Phase 23's own code), so the Canvas view itself could not be reached live. This review is therefore primarily a **code-level audit** of `apps/web/src/app/chat/_canvas/*` and `_components/genui-part-boundary.tsx`, cross-referenced line-by-line against `23-UI-SPEC.md`'s declared tokens/copy/interactions.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every checked string (empty state, placeholder, picker labels/errors, save status, keyboard hint, provenance caption) matches the Copywriting Contract verbatim. |
| 2. Visuals | 2/4 | `GenuiPanelNode` double-boxes its content: the node shell + an inner `p-4` wrapper + `GenuiPartBoundary`'s own `GenuiCard` border/padding stack three chrome layers inside the tightest allowed node (320×240). |
| 3. Color | 3/4 | 60/30/10 discipline and accent-reserved list are honored almost everywhere; one minor out-of-contract accent use (`bg-primary/10` on the loading skeleton). |
| 4. Typography | 4/4 | Only `text-xs`/`text-sm`/`text-base` and `font-normal`/`font-semibold` used anywhere in `_canvas` — exact match to the declared 2-weight, 4-role system. |
| 5. Spacing | 2/4 | Three concrete deviations from the declared Spacing Scale table, two of them in tokens the spec names for these EXACT elements (empty-state icon-gap and vertical padding; unknown-node-type icon-to-label gap). |
| 6. Experience Design | 3/4 | Loading/empty/degrade/save states and reduced-motion gating are all implemented faithfully; the contract's two-level keyboard focus model (stable Tab order, Enter-to-enter-content, graduated Escape) is not implemented — only the baseline pan/zoom fallback is. |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **`GenuiPanelNode` triple-nests chrome around its own content** — `apps/web/src/app/chat/_canvas/genui-panel-node.tsx:82-91` wraps `GenuiPartBoundary` in a `<div className="p-4">` (16px), and `GenuiPartBoundary` (`apps/web/src/app/chat/_components/genui-part-boundary.tsx:78-82`, `GenuiCard`) unconditionally wraps its output in ANOTHER `my-2 rounded-lg border border-border p-4` box — inside a node shell (`genui-panel-node.tsx:102-103`) that already supplies `rounded-lg border border-border/60 bg-background`. **User impact:** in a 320px-wide panel (the contract's own stated minimum), content usable width drops to roughly 254px after two stacked 16px paddings + 2 borders, and the panel visually reads as a box-in-a-box-in-a-box instead of the "neutral shell, content carries its own distinctiveness" language the UI-SPEC's Node Visual Language table calls for. **Fix:** give `GenuiPartBoundary` a `bare`/`variant="canvas"` prop that skips `GenuiCard`'s wrapper when rendering inside a node shell that already provides the border/background (keep the wrapped version for the docked chat message-list use case, where the card border is load-bearing).

2. **Spacing Scale violations on named tokens** — `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx:18` uses `gap-3` (12px) for the icon-to-heading gap and `p-8` (32px) for the vertical centering padding, but `23-UI-SPEC.md`'s Spacing Scale table explicitly assigns these exact two elements to `lg` (24px, `gap-6`) and `3xl` (64px, `p-16`) respectively — both are named-by-usage in the contract, not general guidance. Separately, `apps/web/src/app/chat/_canvas/unknown-node-type-placeholder.tsx:38` uses `gap-2` (8px) for the `AlertTriangle`-to-label gap, but the spec's `xs` token (4px, `gap-1`) is explicitly captioned "Node internal icon-to-label gaps." **User impact:** none of these break functionality, but they are objectively measurable, checkable-in-code contract deviations — exactly the class of drift a design contract exists to prevent. **Fix:** `gap-3`→`gap-6`, `p-8`→`p-16` in `canvas-empty-state.tsx`; `gap-2`→`gap-1` in `unknown-node-type-placeholder.tsx`.

3. **Two-level keyboard focus model (23-UI-SPEC.md Accessibility) is unimplemented** — `apps/web/src/app/chat/_canvas/chat-canvas.tsx:399-456`'s `handleKeyDown` only implements arrow-pan / `+`/`-`-zoom / `0`-fitView / Escape-deselect (self-documented as an intentional interim in 23-03-SUMMARY.md and 23-04-SUMMARY.md). The contract's stated model — Tab cycles nodes in stable left-to-right/top-to-bottom order (not DOM/z-order), Enter/Space on a focused node moves focus INTO its first interactive control, and a two-step Escape (content→shell→canvas) — is absent; React Flow's raw default Tab behavior (DOM/mount order) is what actually governs today. `apps/web/src/app/chat/_canvas/canvas-keyboard-hint.tsx:31`'s own displayed copy ("Tab to move between panels") therefore promises more precision than the implementation delivers. **User impact:** a keyboard-only user cannot reliably reach a specific panel's interactive controls (e.g. a genui-panel's button or the chat composer) in a predictable order, especially after nodes have been dragged (DOM order and visual position diverge). **Fix:** implement the documented two-level model, or (lower-cost interim) narrow the keyboard hint's copy to only claim what's actually true today.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Checked every string in the Copywriting Contract table against the implementation:

- Empty state heading/body — `canvas-empty-state.tsx:21-24` — verbatim match ("No panels yet" / "Genui responses from this chat will appear here as panels. Switch to Chat view to start a conversation.").
- Unknown-node-type placeholder — `unknown-node-type-placeholder.tsx:40-46` — verbatim match, including the `Type: {nodeType} · The canvas layout is unaffected — this panel is skipped safely.` caption.
- Node provenance label — `genui-panel-node.tsx:69-70` — "From turn {turnIndex}" verbatim.
- Streaming indicator — `genui-panel-node.tsx:72-78` — no text label on the node, `aria-label="Streaming"` on the pulsing dot, matches spec exactly.
- Edge-creation picker — `edge-creation-picker.tsx:135` ("Connect panels"), `:144`/`:162` ("Source field"/"Target field"), `:139` ("This panel doesn't expose any fields yet — add state to it first."), `:196`/`:203-207` ("Don't connect" / "Connect fields" — never a literal "Cancel"), `:181` ("This value type isn't compatible with the target field.") — all verbatim.
- Data-edge label pill — `data-edge.tsx:126` — `{sourcePath} → {targetKey}` on `bg-background/80`/`text-muted-foreground` — verbatim.
- Save/restore feedback — `save-status-indicator.tsx:48-63` — "Saved" (2s motion-safe fade) / "Not saved — retrying…" — verbatim, no retry button (matches "no CRDT/multiplayer" posture).
- Keyboard hint — `canvas-keyboard-hint.tsx:31` — "Use arrow keys to pan, +/- to zoom, Tab to move between panels." verbatim (see Pillar 6 for the gap between this copy and actual Tab behavior — a copy-accuracy note, not a copy-content violation).
- No generic "Submit"/"Cancel"/"OK"/"Click here" patterns found anywhere in `_canvas` (`grep` returned zero hits).

No deductions found. This is a genuinely tight, faithful implementation of the Copywriting Contract.

### Pillar 2: Visuals (2/4)

- **BLOCKER-adjacent WARNING — nested double-card chrome.** See Top Fix #1 above (`genui-panel-node.tsx:82-91` + `genui-part-boundary.tsx:78-82`). This is a genuine, demonstrable-in-code visual regression: `GenuiPartBoundary` was built in Phase 22 for a chat message-stream context, where its own bordered card is the ONLY chrome separating a genui block from surrounding markdown/text. Phase 23 reused it wholesale inside `GenuiPanelNode`, which already has its own bordered node shell — the result is redundant chrome that was never re-evaluated for the new host context, despite the UI-SPEC's own Node Visual Language table stating the shell should stay neutral ("the panel's OWN rendered content, not the shell, carries any visual distinctiveness").
- Icon-only buttons are correctly paired with `aria-label`s throughout: minimap toggle (`chat-canvas.tsx:625`), keyboard-hint dismiss (`canvas-keyboard-hint.tsx:38`), rail-collapse (`page.tsx:171`).
- Visual hierarchy through size/weight is otherwise well-executed: chat-node title (`text-sm font-semibold`), genui-panel provenance caption (`text-xs font-normal`), selection ring (`ring-2 ring-primary ring-offset-1`) consistently applied to both node types per the "never special-case chat" rule.
- Focal point: the canvas correctly defaults to a single centered chat node on first visit (`withDefaultChatNode`, `use-canvas-persistence.ts:201-217`) rather than an empty pane competing with the empty-state copy.

### Pillar 3: Color (3/4)

- No hardcoded hex/`rgb()` anywhere in `_canvas` (`grep` returned zero hits).
- Accent (`primary`) correctly scoped to the four contract-declared usages: selection ring (`genui-panel-node.tsx:43`, `chat-node.tsx:79`), data-edge stroke (`data-edge.tsx:111`, `!stroke-primary`), streaming dot (`genui-panel-node.tsx:74`). Plain layout has no data edges in this phase (edges are always data-carrying once created), so there's no live counter-example of the "never on plain edges" rule, but nothing violates it either.
- **Minor finding:** `canvas-skeleton.tsx:21` applies `bg-primary/10` to the chat-node loading ghost. This isn't in the UI-SPEC's "Accent reserved for" allowlist (edge stroke, streaming dot, selection ring, edge-handle hover) — a strict reading of the contract's "reserved for exactly these four things" language means this is scope creep, even though the visual effect (a 10%-opacity tint) is subtle and arguably harmless. Flagging per the adversarial-audit mandate against accepting "close enough" on an allowlisted token.
- The unknown-node-type placeholder's `border-destructive/30` (not full-destructive) matches the spec's "degraded-gracefully, not user-caused-error" distinction exactly (`unknown-node-type-placeholder.tsx:37`).

### Pillar 4: Typography (4/4)

`grep` across all of `_canvas` for `text-*`/`font-*` classes returns only:
- Sizes: `text-xs`, `text-sm`, `text-base` (3 of the 4 declared roles are actually exercised; `text-base`/16px Display role is reserved-but-unused per the spec's own note, consistent).
- Weights: `font-normal`, `font-semibold` only — zero `font-medium` hits, matching the carried-forward "no font-medium" rule from `/knowledge`.

This is an exact match to the declared 2-weight/4-role typography system with no drift.

### Pillar 5: Spacing (2/4)

Concrete, named-token deviations found:

1. `canvas-empty-state.tsx:18` — `gap-3` (12px) used for the icon→heading gap; spec's Spacing Scale table names this exact element for the `lg` (24px) token.
2. `canvas-empty-state.tsx:18` — `p-8` (32px) used for the empty-state's vertical centering padding; spec's Spacing Scale table names this exact element for the `3xl` (64px) token.
3. `unknown-node-type-placeholder.tsx:38` — `gap-2` (8px) between the `AlertTriangle` icon and its label; spec's `xs` (4px) token is explicitly captioned "Node internal icon-to-label gaps."
4. The `GenuiCard` double-wrap (Pillar 2 finding) also stacks two `p-4` (16px) layers where the spec's Spacing Scale names a single `md` (16px) token for "genui-panel node inner content padding" — the same underlying defect scored again here because it's a genuine spacing-scale violation, not just an aesthetic one.

Correctly implemented spacing: the `h-9` (36px) node header exception, `size-11` (44px) touch targets on the minimap toggle and keyboard-hint dismiss button, and the `320×240`/`400×320` minimum node dimensions (all explicitly declared exceptions in the contract, all matched verbatim).

### Pillar 6: Experience Design (3/4)

State coverage is strong:
- **Loading:** `CanvasSkeleton` (`role="status"`, `aria-label="Loading canvas"`) gates React Flow from mounting until restore resolves — no flash of an unlaid-out default (`chat-canvas.tsx:566-568`).
- **Empty:** `CanvasEmptyState` — informational-only, no button, matches the "remedy lives elsewhere" precedent.
- **Degrade/error:** `UnknownNodeTypePlaceholder` — position honored, never throws, correctly wired into the module-level `nodeTypes` map (a real bug from 23-04's own dev cycle — a missing registry entry that would have silently broken this exact guarantee — was caught and fixed before this review, per 23-04-SUMMARY.md).
- **Save feedback:** `SaveStatusIndicator` — idle/saving/saved/error all covered, non-blocking, auto-retry on next change, no manual-retry button (matches the "no CRDT/multiplayer" posture).
- **Live region:** `aria-live="polite"` announcements for "Canvas layout restored" / "New panel added" / "Layout saved" (`chat-canvas.tsx:305,322,337`) — restrained, transitions-only, never streaming-token chatter.
- **Reduced motion:** correctly gated via `motion-safe:` on the new-panel fade-in, streaming pulse, and "Saved" fade-in; `animated: false` unconditionally on every `DataEdge` construction site (verified both in `toFlowEdge` and `handlePickerConfirm`).

Gap: the contract's two-level keyboard focus model (stable Tab order by position, Enter/Space-to-enter-node-content, graduated Escape) is not implemented — only the REQUIRED baseline (arrow-pan, `+`/`-`-zoom, `0`-fitView, Escape-deselect) exists, scoped safely to fire only when the canvas container itself has focus (`chat-canvas.tsx:405`, correctly guards against hijacking a node's composer/form inputs). This is honestly self-documented as a known scope decision in 23-03-SUMMARY.md/23-04-SUMMARY.md rather than hidden, which is why this isn't scored as a 1 — but it is a real, unresolved divergence from an approved contract section, not a "nice to have" that was descoped with a UI-SPEC amendment.

Edge creation's explicit-confirm-only gate (`onConnect`/`onConnectEnd` never call `setEdges` directly — only the picker's "Connect fields" does) is correctly implemented and independently proven by an end-to-end test (23-06's `panel-data-flow.test.tsx`).

---

## Files Audited

- `apps/web/src/app/chat/_canvas/chat-canvas.tsx`
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx`
- `apps/web/src/app/chat/_canvas/chat-node.tsx`
- `apps/web/src/app/chat/_canvas/unknown-node-type-placeholder.tsx`
- `apps/web/src/app/chat/_canvas/data-edge.tsx`
- `apps/web/src/app/chat/_canvas/edge-creation-picker.tsx`
- `apps/web/src/app/chat/_canvas/edge-payload-schema.ts`
- `apps/web/src/app/chat/_canvas/edge-types.ts`
- `apps/web/src/app/chat/_canvas/canvas-empty-state.tsx`
- `apps/web/src/app/chat/_canvas/canvas-skeleton.tsx`
- `apps/web/src/app/chat/_canvas/canvas-keyboard-hint.tsx`
- `apps/web/src/app/chat/_canvas/chat-canvas-view-toggle.tsx`
- `apps/web/src/app/chat/_canvas/chat-canvas-island.tsx`
- `apps/web/src/app/chat/_canvas/save-status-indicator.tsx`
- `apps/web/src/app/chat/_canvas/node-types.ts`
- `apps/web/src/app/chat/_canvas/canvas-layout.ts`
- `apps/web/src/app/chat/_canvas/node-data-schemas.ts`
- `apps/web/src/app/chat/_canvas/use-canvas-persistence.ts`
- `apps/web/src/app/chat/_canvas/canvas-store-context.tsx`
- `apps/web/src/app/chat/page.tsx`
- `apps/web/src/app/chat/_components/genui-part-boundary.tsx`
- `.planning/phases/23-2d-canvas-panels-as-nodes-shared-state/23-UI-SPEC.md` (baseline)
- All 6 `23-0N-SUMMARY.md`/`23-0N-PLAN.md` files (cross-referenced, not scored directly)

**Registry Safety:** skipped — no `components.json` in this repo (`shadcn_initialized: false` per `23-UI-SPEC.md` frontmatter, confirmed via direct file check), so the registry-safety audit does not apply per its own gating condition.
