# Phase 24 — UI Review

**Audited:** 2026-07-05
**Baseline:** `24-UI-SPEC.md` (design contract, status: draft)
**Screenshots:** not captured (no dev server on :3000/:5173/:8080 — code-only audit against live source)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Mandatory "This was already answered." string is never rendered anywhere; `CompactInteractionEntry`'s clarify branch hand-rolls a `<dl>` instead of the mandated `key-value-list` catalog primitive; Phase-19's leftover "Submitted ✓" text contradicts the new "Submitting…" row |
| 2. Visuals | 2/4 | The submitted (locked) proposal view strips the Card's border/shadow/`rounded-xl` identity, replacing it with a plain `rounded-lg` div — cards visually stop looking like cards at the exact moment of selection |
| 3. Color | 3/4 | New Phase-24 code is 100% token-based with correct accent reservation; deduct for the pre-existing `text-emerald-600` (non-token, non-dark-mode-aware) that surfaces live during this phase's clarify-widget submit flow, unaddressed |
| 4. Typography | 4/4 | Only `text-xs`/`text-sm`/`text-base` used across all new files, matching the declared Label/Body/Heading roles exactly; no new weights introduced |
| 5. Spacing | 2/4 | `SubmittedProposalView`'s hand-rolled cards use `p-4` (16px) where the UI-SPEC explicitly declares Card's `p-6` (24px, "lg" token) as "inherited, not overridden by this phase" — it IS overridden, causing a visible padding jump on selection |
| 6. Experience Design | 2/4 | State-machine derivation (CAS lock, staleness, canvas parity) is solid and tested, but a real, reproducible defect shows "Submitted ✓" and "Submitting…" simultaneously during every clarify-widget round-trip, and dimmed/superseded cards remain keyboard-focusable (not `aria-disabled`/removed from tab order) contrary to the Accessibility contract |

**Overall: 15/24**

---

## Top 3 Priority Fixes

1. **`FormComponent`'s own "Submitted ✓" text collides with `InteractiveWidgetBoundary`'s "Submitting…" row on every clarify-widget submit** — user sees contradictory state simultaneously ("Submitted" and "Submitting" at once, and again "Submitted ✓" reappearing next to a re-enabled, editable form after a 422 rejection) — undermines this phase's core promise of precise, non-contradictory interaction feedback. Fix: suppress or hide Phase-19's internal `submitted`/"Submitted ✓" affordance when the form is rendered inside `InteractiveWidgetBoundary` (e.g. thread a `hideOwnSubmittedAffordance` prop into `FormComponent`, or simply never let `handleSubmit` set local `submitted=true` when an `onSubmit` handler was successfully invoked through the registry — the boundary's own badge is the sole source of truth for "submitted").
   `apps/web/src/app/chat/_components/interactive-widget-boundary.tsx:264-274` (submitting state wraps the SAME live `FormComponent` instance, preserving its internal state) + `packages/genui/src/catalog/form-component.tsx:210,229,244,279-283` ("Submitted ✓" / `text-emerald-600`).

2. **Submitted (locked) proposal cards lose their Card identity and shrink their padding** — `SubmittedProposalView` renders plain `rounded-lg` divs with no border/shadow and `p-4` instead of the live catalog Card's `rounded-xl border shadow-sm p-6` — a visible layout/style jump exactly when the user's choice locks in (the moment D-06 says should read as the clearest, most linear confirmation). Fix: match the live Card's visual shell (`rounded-xl`, `border`, `shadow`, `p-6`) in the hand-rolled submitted view, or restyle via the same CSS custom properties the catalog `Card` component uses so pending → submitted is a state change, not a container swap.
   `apps/web/src/app/chat/_components/interactive-widget-boundary.tsx:150-183` (`SubmittedProposalView`, `rounded-lg`/`p-4`) vs. `packages/ui/src/card.tsx:11-17,26` (`rounded-xl border ... shadow`, `p-6`).

3. **Two Copywriting Contract requirements are silently unimplemented** — (a) the double-submit conflict message "This was already answered." is never rendered anywhere in the client (confirmed via full-repo grep); a user whose submit loses a race sees only a silent state reconciliation with no explanation. (b) `CompactInteractionEntry`'s clarify branch hand-rolls a bare `<dl>` (no `aria-label`) instead of routing through the mandated `key-value-list` catalog primitive the way `SubmittedClarifyView` correctly does — an inconsistency between the widget's own submitted view (correct) and the transcript's compact entry for the same data (incorrect). Fix: populate `errorMessages` for the `"conflict"` `errorKind` with the UI-SPEC string (currently only `"invalid"` gets a message, `use-conversation-controller.ts:630-635`); rebuild `ClarifySummary` on top of `buildClarifySubmittedSpec` + `GenuiPartBoundary` instead of a hand-rolled `<dl>`.
   `apps/web/src/app/chat/_hooks/use-conversation-controller.ts:339-353,630-635` + `apps/web/src/app/chat/_components/compact-interaction-entry.tsx:44-56`.

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

**Correctly implemented (verified against UI-SPEC's Copywriting Contract table):**
- `"Choose this option"` fallback CTA + mandatory `aria-label="{label} — {title}"` — `build-proposal-cards-spec.ts:30,75`.
- `role="group" aria-label="Choose an option"` (or the agent's own prompt) — `interactive-widget-boundary.tsx:279-284,298-299`.
- `submitLabel` structurally required (`minLength:1`) at the tool schema level, never a "Submit" fallback in the builder — `chat_tools.py:182-203`, `build-clarify-widget-spec.ts:82` (passes `declaration.submitLabel` verbatim).
- Badge copy exact match: Selected/Superseded/Stale/Submitted with correct icons — `widget-status-badge.tsx`.
- Superseded/Stale captions verbatim — `interactive-widget-boundary.tsx:102-103,292-294`.
- Validation-error copy verbatim ("This response couldn't be saved. Please try again.") — `use-conversation-controller.ts:634`.
- Compact `interaction_result` for proposal cards (`Selected "{title}"`) — `compact-interaction-entry.tsx:28-31`.

**Violations:**
- **"This was already answered." never renders.** The server produces the reason string `"this widget has already been answered"` (`submit_widget_interaction.py:118`), the client classifies it as `errorKind: "conflict"` (`use-conversation-controller.ts:341-346`), but `errorMessages` is populated ONLY when `errorKind === "invalid"` (`use-conversation-controller.ts:630-635`) — a conflict rejection produces no message text anywhere in the UI. Confirmed via a full-repo grep for "already answered" — zero matches in any `.tsx`/`.ts` file under `apps/web`.
- **`CompactInteractionEntry`'s clarify branch violates the Component Inventory's mandated mechanism.** UI-SPEC: "Rendered via the existing `key-value-list` catalog primitive (`aria-label={formTitle ?? "Your response"}`)". Actual: a hand-rolled `<dl>` with no `aria-label` at all (`compact-interaction-entry.tsx:44-56`). This was flagged as a "known stub" in 24-03's SUMMARY ("full key-value-list treatment lands in 24-04") but 24-04 only updated the DATA shape consumed (`{fields:[{label,value}]}`), not the rendering mechanism — confirmed by `build-clarify-widget-spec.test.ts`/`clarify-widget-boundary.test.tsx` covering `SubmittedClarifyView`'s correct `key-value-list` usage, with no equivalent test ever asserting `CompactInteractionEntry` does the same.
- **Copy collision:** Phase-19's `FormComponent` still renders its own `"Submitted ✓"` (`text-emerald-600`) on every successful `handleSubmit` call (`form-component.tsx:244,279-283`) — including calls routed through the new `InteractiveWidgetBoundary` registry enrichment. See Experience Design for the full mechanics; the copy-level symptom is that a user reads "Submitted ✓" and "Submitting…" (or, on the 422 retry path, "Submitted ✓" next to a fully re-enabled, editable form) at the same time.

### Pillar 2: Visuals (2/4)

**Correctly implemented:**
- The mandatory `bare` variant prerequisite fix is genuinely landed: `GenuiPartBoundary` routes all four return paths through one `Wrapper`, `GenuiPanelNodeBody` passes `variant="bare"` uniformly for both the genui and interactive-widget branches, collapsing the canvas to one surviving `p-4` layer — the 23-UI-REVIEW triple-nest defect is closed (`genui-part-boundary.tsx:92-108`, `genui-panel-node.tsx:95-134`).
- Clear focal point on selection: ring+wash+badge on the chosen option, `opacity-50`+`aria-disabled` on the rest (D-06) — strong visual hierarchy while it works (see Spacing finding for the identity loss).
- No icon-only buttons without accessible text: `Loader2`/`AlertTriangle`/badge icons all carry `aria-hidden` with adjacent visible text.

**Violations:**
- **Card identity is lost on submit.** The live (pending) proposal cards render through the real catalog `card` node → `@nauta/ui`'s `Card`/`CardHeader`/`CardContent` (`rounded-xl border bg-card ... shadow`, `p-6` — `packages/ui/src/card.tsx:11-17,26,60`). `SubmittedProposalView` (the view that replaces it once a choice locks in) instead hand-rolls a plain `<div className="rounded-lg ... p-4 ...">` with no border and no shadow (`interactive-widget-boundary.tsx:162-169`). The visual container changes shape, radius, and elevation at the exact moment (selection) the UI-SPEC's D-06 says should read as the clearest, most linear confirmation — instead it reads as a downgrade/glitch.
- The same pattern (bypassing the live catalog rendering with a hand-rolled equivalent) is more carefully done for the clarify-widget's submitted view (`SubmittedClarifyView` correctly re-enters `GenuiPartBoundary`/`SpecRenderer` via `buildClarifySubmittedSpec` — a real catalog node, re-validated by `SpecRootSchema.safeParse`), which makes the proposal-cards shortcut's visual regression stand out as an inconsistency between the two widget kinds this same phase shipped.

### Pillar 3: Color (3/4)

**Correctly implemented:**
- Zero hardcoded hex/rgb/off-palette color classes anywhere in the Phase-24 `_components`/`_canvas` files (grep-verified across `interactive-widget-boundary.tsx`, `widget-status-badge.tsx`, `compact-interaction-entry.tsx`, `build-proposal-cards-spec.ts`, `build-clarify-widget-spec.ts`, `genui-panel-node.tsx`).
- Accent (`bg-primary`/`ring-primary`/`text-primary`) usage is minimal and exactly matches the declared reservation: chosen-card ring+wash (`interactive-widget-boundary.tsx:166`), the pre-existing canvas selection ring and streaming dot (`genui-panel-node.tsx:48,87`, both pre-existing 23-phase chrome, unchanged). No accent leakage onto Superseded/Stale/Submitted badges — all three correctly use `variant="secondary"` (neutral), distinguished by icon+text only, per Design Decision 4/Accessibility.

**Violation:**
- Phase-19's `FormComponent` renders `"Submitted ✓"` in `text-emerald-600` (`form-component.tsx:280`) — a raw Tailwind color with no corresponding entry in the declared token table (`background`/`foreground`/`card`/`popover`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring`), and not dark-mode-aware (no `.dark` variant defined for `emerald-600`). This predates Phase 24 (the file is "UNMODIFIED" per D-09's mandate, aside from the one-line `handleSubmit` enrichment), but Phase 24 is the first phase to route this component through a chrome layer explicitly designed around precise, deviation-only state signaling — leaving this off-palette green active and reachable inside the new flow is an unaddressed integration gap, not a pre-existing, out-of-scope quirk the UI-SPEC documented (contrast with the `text-lg` title exception, which the UI-SPEC explicitly calls out as an accepted, transparent exception — this emerald-600 interaction has no equivalent documentation).

### Pillar 4: Typography (4/4)

- Every new Phase-24 file uses only `text-xs` (Label, 12px), `text-sm` (Body, 14px), and `text-base` (Heading, 16px) — grep-verified across `interactive-widget-boundary.tsx` (`text-sm`×4, `text-base`×1, `text-xs`×1), `compact-interaction-entry.tsx` (`text-sm`×2), `widget-status-badge.tsx` (no size overrides — inherits Badge's own baked-in `text-xs font-semibold`).
- No new font weights introduced; `font-semibold` on the chosen-card title (`text-base font-semibold`, `interactive-widget-boundary.tsx:172`) matches the declared Heading role (16px/600) exactly.
- The one documented exception (`FormComponent`'s `text-lg` title, one increment above the declared 16px Heading role) is pre-existing Phase-19 code, explicitly and transparently documented in `24-UI-SPEC.md`'s Typography section as an inherited, out-of-contract exception — not a new violation this phase introduces.

### Pillar 5: Spacing (2/4)

**Correctly implemented:**
- `gap-1`/`gap-2` (xs/sm tokens) used consistently for badge-icon gaps and header-to-content gaps (`interactive-widget-boundary.tsx:131,140,158,166-167,171,200`).
- `GenuiPanelNodeBody`'s single surviving `p-4` (md token) content layer, per the mandatory prerequisite fix — confirmed the ONE padding layer now, not two (`genui-panel-node.tsx:96`).
- No arbitrary bracket spacing values (`[Npx]`/`[Nrem]`) introduced anywhere in the Phase-24-specific files (grep-verified; the only bracket values in the whole `chat/` tree predate this phase — canvas node min-dimensions, composer min-height, rail width).

**Violation:**
- `SubmittedProposalView`'s cards use `p-4` (16px) where the UI-SPEC's own Spacing Scale table explicitly declares: `lg | 24px | Existing @nauta/ui Card/CardHeader/CardContent internal padding (p-6) — inherited, not overridden by this phase`. The live (pending) cards DO inherit `p-6` via the real `Card`/`CardHeader`/`CardContent` components; the submitted view's hand-rolled replacement uses `p-4` instead — a direct, measurable override the UI-SPEC itself said would not happen. This produces a visible padding contraction (24px → 16px) at the exact moment a card locks into its "Selected" state, compounding the Visuals-pillar card-identity-loss finding above.

### Pillar 6: Experience Design (2/4)

**Correctly implemented (verified in source, not just summaries):**
- `deriveWidgetDisplayState` is a genuinely pure, correctly-ordered derivation (submitted > submitting > superseded > stale > pending) reading from the DB-authoritative `state` column plus reactive turn/sibling staleness — `widget-display-state.ts:67-86`.
- D-02 (composer never blocked): `composer.tsx` only disables on `isStreaming`, never on pending-widget presence; typing optimistically marks pending interactions `superseded` before the send request starts — `use-conversation-controller.ts:432-440`.
- D-08 canvas parity is real, not aspirational: `GenuiPanelNodeBody` reads the SAME `controller.widgets` surface the transcript reads and fires the SAME `onSubmitResult` — one message-part source of truth, confirmed by both the dual-surface test noted in 24-03's SUMMARY and by direct source read (`genui-panel-node.tsx:97-123`).
- 422 is correctly the one rejection that re-enables the widget with a retryable inline error row; 409 conflict/stale correctly reconcile via `getWidgetInteractions` invalidation rather than a stuck "Submitting…" state.

**Violations:**
- **State-contradiction bug (reproducible on every clarify-widget submit):** `InteractiveWidgetBoundary`'s `"submitting"` display state re-renders the SAME live `<form>` (same `specJson`, same React tree position — confirmed no `key` or unmount point exists between `pending` and `submitting` renders) wrapped in `pointer-events-none` with a "Submitting…" row appended below it (`interactive-widget-boundary.tsx:264-274,312`). But `FormComponent.handleSubmit` (Phase-19, invoked synchronously on click, BEFORE the server round-trip resolves) sets its own internal `submitted` state to `true` and renders `"Submitted ✓"` right next to the (now-disabled) submit button (`form-component.tsx:229-244,279-283`) — because React preserves a component's local state across a re-render at the same tree position, this internal flag is never reset by the parent's `displayState` transition. The result: for the entire "submitting" window (the full network round-trip), the user sees "Submitted ✓" and "Submitting…" simultaneously — and if the submit is rejected with a 422, the widget re-enables the live form for retry, but `FormComponent`'s own `"Submitted ✓"` text remains visible (only cleared by the user editing a field) next to a form that the UI is explicitly telling the user was NOT saved. This directly undermines the phase's stated Design Decision 4 premise ("badges communicate a DEVIATION from the default only") — an unintended, undocumented second status channel is bleeding through from the reused Phase-19 component.
- **Dimmed/superseded/stale controls are not actually removed from the tab order.** UI-SPEC Accessibility: "dimmed/inactive cards and disabled form controls get `aria-disabled="true"` (removed from tab order) AND `aria-describedby` pointing at the widget's status badge text." The implementation applies `aria-disabled`/`aria-describedby` only to the OUTER wrapping `<div>` (`interactive-widget-boundary.tsx:297-302`), not to each individual `<button>` inside the (still fully rendered) live spec. `pointer-events-none` on the wrapper blocks mouse clicks but does nothing to keyboard focus/activation — a Tab-navigating or screen-reader user can still focus and "activate" (Enter/Space) an individual card's button during `superseded`/`stale` states; the action silently no-ops (via `NOOP_ACTIONS`) rather than being unreachable, but the per-control `aria-disabled` the spec calls for is absent, so assistive tech has no way to know that specific control is dead before activating it.

---

## Files Audited

**Web (`apps/web/src/app/chat/`):**
- `_components/interactive-widget-boundary.tsx`
- `_components/widget-status-badge.tsx`
- `_components/compact-interaction-entry.tsx`
- `_components/widget-display-state.ts`
- `_components/build-proposal-cards-spec.ts`
- `_components/build-clarify-widget-spec.ts`
- `_components/genui-part-boundary.tsx`
- `_components/message-turn.tsx`
- `_components/message-list.tsx`
- `_hooks/use-chat-stream.ts`
- `_hooks/use-conversation-controller.ts`
- `_canvas/genui-panel-node.tsx`

**Shared catalog (out-of-phase, read for integration correctness):**
- `packages/genui/src/catalog/form-component.tsx`
- `packages/genui/src/renderer/spec-renderer.tsx`
- `packages/ui/src/card.tsx`

**Backend (spot-checked for copywriting-contract enforcement):**
- `apps/email-listener/app/infrastructure/llm/chat_tools.py`
- `apps/email-listener/app/application/use_cases/submit_widget_interaction.py`

**Planning docs read:**
- `24-UI-SPEC.md`, `24-CONTEXT.md`
- `24-01-SUMMARY.md`, `24-02-SUMMARY.md`, `24-03-SUMMARY.md`, `24-04-SUMMARY.md`

**Registry Safety:** not applicable — no `components.json` present in the repo (confirmed), UI-SPEC declares no third-party registries this phase.
