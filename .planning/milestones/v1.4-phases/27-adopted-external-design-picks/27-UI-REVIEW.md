# Phase 27 — UI Review (Retroactive)

**Audited:** 2026-07-07
**Baseline:** `27-UI-SPEC.md` (approved contract) + `27-VERIFICATION.md` (code-verified facts, not re-derived)
**Screenshots:** not captured — no dev server detected on :3000 (HTTP 500) or :5173 (no connection). Code-only audit.
**Status:** ADVISORY — non-blocking. This phase already passed verification (5/5 truths, `human_needed` only for browser-rendering confirmation). This review re-derives 6-pillar scores adversarially from the actual source, independent of `27-VERIFICATION.md`'s pass/fail framing.

**Pillar set used:** this audit uses the 6 dimensions specified by the orchestrator for this phase (Typography / Color-token / Spacing / Interaction-motion / Consistency / A11y) rather than the generic copywriting+visuals set, since ADOPT-01..05 introduces near-zero new copy and the phase's own risk surface is almost entirely CSS/motion/token discipline.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Typography | 4/4 | Exactly 2 weights held; zero live `font-medium` in any ADOPT-01..05 file; `CommandGroup` spillover fix confirmed at `command.tsx:92`. |
| 2. Color / Token | 4/4 | Accent allowlist holds at exactly 2 members (ring sweep + FileTree selected row); zero raw hex/rgb paint in any new file; no token VALUE changed. |
| 3. Spacing | 3/4 | `file-tree.tsx:87`'s `gap-0.5` (2px) row-list gap is off the declared 4-point grid and undocumented in the spec's own visual-contract table. |
| 4. Interaction / Motion | 3/4 | Reduced-motion gating is genuinely effective for all 4 new animations, but `.t-modal-reveal` and `.t-dropdown-reveal` stack a second, differently-timed transform/opacity animation *inside* `AlertDialogContent`/`PopoverContent`, which already animate `zoom-in`/`fade-in` themselves — a real double-animation, not just the className-conflict risk the spec's own reasoning addressed. |
| 5. Consistency | 3/4 | `conversation-rail.tsx`'s `backdrop-blur-md` (touched by this very phase to swap in `.t-panel-reveal`) directly contradicts bans-item #3 in the phase's own brand-new `docs/design/product-register-and-bans.md` ("blur/backdrop-filter is not part of this app's committed material palette") — undisclosed, unflagged. |
| 6. Accessibility | 4/4 | `GeneratingRing` correctly decorative (`pointer-events:none`, no ARIA role); FileTree icons `aria-hidden` with visible text labels; native focus rings untouched (no `outline-none`/`focus:ring-0` in any new file). |

**Overall: 21/24**

---

## Top 3 Priority Fixes

1. **Double motion stack on modal + dropdown reveals** — `delete-conversation-dialog.tsx`'s `.t-modal-reveal` wrapper and `model-picker.tsx`'s `.t-dropdown-reveal` wrapper both sit *inside* a Radix primitive (`AlertDialogContent`, `PopoverContent`) that already carries its own `tailwindcss-animate` `zoom-in-95 fade-in-0` entrance (`packages/ui/src/alert-dialog.tsx:39` at `duration-200`; `packages/ui/src/popover.tsx:24` at the library default ~150ms). The result is two independently-timed scale+opacity animations compounding on nested elements — on the modal specifically, the outer settles at 200ms while the inner (250ms, custom cubic-bezier) is still finishing, producing a visible two-stage settle rather than one clean reveal. User impact: motion reads as slightly janky/over-engineered on every dialog open and every model-picker open — exactly the "motion conveys state and nothing else" violation this same phase's own new bans doc warns against. Concrete fix: either strip the outer primitive's `data-[state=open]:animate-in ... zoom-in-95 fade-in-0` classes for these two specific call sites (pass an override that removes just those utilities, keeping `animate-out` for exit), or drop the inner `.t-modal-reveal`/`.t-dropdown-reveal` scale component and let the wrapper only contribute the box-shadow/differentiated easing on top of the outer's existing scale+fade.

2. **`gap-0.5` (2px) breaks FileTree's own declared 4-point grid** — `apps/web/src/components/file-tree.tsx:87`, the `AccordionPrimitive.Root` wrapping every level, uses `className="flex flex-col gap-0.5"`. 2px is not in the spec's stated spacing set (`{4,8,16,24,32,48,64}`) and this class isn't mentioned anywhere in `27-UI-SPEC.md`'s FileTree visual-contract table at all (it lists Row/Folder/File/Indentation/Children-container classes but never a list-level gap). User impact: none functionally, but it's a real, citable spec deviation that a future retokenization pass would silently inherit as "intentional" if not caught now. Concrete fix: change to `gap-1` (4px, on-grid) or `gap-0` and rely on `min-h-11` + `px-2` alone for row separation, then add the gap value to the spec's visual-contract table so it's governed going forward.

3. **`conversation-rail.tsx`'s `backdrop-blur-md` contradicts this phase's own new bans doc, undisclosed** — `docs/design/product-register-and-bans.md` item 3 explicitly bans "blurred 'frosted glass' panels used purely for aesthetic flourish" and states "this app's surfaces... stay solid `bg-background`/`bg-popover` — blur/backdrop-filter is not part of this app's committed material palette." `conversation-rail.tsx:111` carries `bg-background/70 backdrop-blur-md` on the exact div this phase edited (to swap in `.t-panel-reveal`) — pre-existing since Phase 22, but the phase's own scouting caught and flagged the analogous `CommandGroup font-medium` spillover in the UI-SPEC's "Scout finding" section, while this one went unmentioned entirely, even though the phase's own new doc makes it a live contradiction on day one. User impact: none directly (rail visually unchanged), but the design-docs convention this phase establishes is already stale about the app's own rail. Concrete fix: either drop `backdrop-blur-md` (make the rail `bg-background` solid) to align code with the day-one doc, or add an explicit named exception to bans-item #3 for translucent overlay rails if that's genuinely intentional — currently neither happened.

---

## Detailed Findings

### Pillar 1: Typography (4/4)
- `file-tree.tsx`: `ROW_BASE` includes exactly `font-normal` (line 49); zero `font-medium` occurrences anywhere in the file (component or test) — confirmed by direct grep, not just trusting `27-VERIFICATION.md`.
- `generating-ring.tsx`, `delete-conversation-dialog.tsx`, `model-picker.tsx`, `conversation-rail.tsx`: only `text-xs`/`text-sm` sizes present; no third weight introduced.
- `packages/ui/src/command.tsx:92` — `CommandGroup`'s `[cmdk-group-heading]` selector confirmed now `font-semibold` + `py-1` (the FIX-02 spillover repair Verification claimed) — independently re-checked by direct file read, matches.
- `packages/ui/src/command.tsx:32` — `CommandDialog`'s own `[cmdk-group-heading]]:font-medium` is a SEPARATE, still-live occurrence, correctly left untouched and already flagged as an explicit out-of-scope item in `27-UI-SPEC.md`'s "Deferred, not forgotten" section — not a new gap, disclosed.
- No issues found that would justify docking below 4/4.

### Pillar 2: Color / Token (4/4)
- Accent allowlist grep across every ADOPT-01..05 file confirms exactly 2 live `primary`-class members: `file-tree.tsx:51` (`bg-primary/10 text-primary`) and `globals.css`'s `.generating-ring::before` gradient (`hsl(var(--primary))` at 3 stops). No other touched file (`delete-conversation-dialog.tsx`, `conversation-rail.tsx`, `model-picker.tsx`, `generation-sandbox-island.tsx`, `code-sandbox-island.tsx`) introduces a new `primary`-class usage.
- No raw hex/`rgb()` color paint in any new file — the one `#000`/`#000` match in `globals.css:163` is a `mask` luminance stencil value (standard CSS mask-compositing technique, not a rendered color), not a palette violation.
- `:root`/`.dark` token VALUES unchanged (spec's own hard constraint) — not re-verified byte-for-byte here since `27-VERIFICATION.md` already confirmed the count (55) via grep; no reason to distrust a mechanical count.

### Pillar 3: Spacing (3/4)
- FileTree's documented values all check out: `pl-2`/`pl-6` indentation (`file-tree.tsx:56`), `min-h-11` touch target (`ROW_BASE`, line 49), `ml-4 border-l border-border/40` children-container indicator (line 131) — all exactly as the spec's visual-contract table states.
- **Deviation:** `file-tree.tsx:87` — `AccordionPrimitive.Root`'s own `className="flex flex-col gap-0.5"` uses a 2px gap, off the declared `{4,8,16,24,32,48,64}` grid and absent from the spec's visual-contract table entirely (the table only documents Row/Folder/File/Indentation/Children-container, never a list-gap value). This is new code (the whole file is new to this phase), so it isn't a pre-existing carry-over — it's an unreviewed addition.
- No other arbitrary-bracket spacing values (`[...px]`/`[...rem]`) in any ADOPT-01..05 file — the two `w-[280px]`/`w-[26rem]` matches in `conversation-rail.tsx`/`model-picker.tsx` are pre-existing component widths (not part of the spacing-scale contract, and not touched by this phase's edits).

### Pillar 4: Interaction / Motion (3/4)
- Reduced-motion gating is correctly implemented and effective for all 4 new animations: `.generating-ring::before`'s `animation` property is only ever declared inside `@media (prefers-reduced-motion: no-preference)` (so under `reduce` it simply never gets an animation at all, falling back to the static gradient at rest); `.t-modal-reveal`/`.t-dropdown-reveal`/`.t-panel-reveal` are each explicitly disabled (`animation: none` / `transition: none`) under `@media (prefers-reduced-motion: reduce)`.
- `.t-panel-reveal` on `conversation-rail.tsx:113` correctly replaces (not stacks with) the prior ad hoc `motion-safe:transition-[width]` pair on the SAME bespoke div — no double-animation risk here since it's the app's own JSX, not a shared primitive.
- **Deviation:** `.t-modal-reveal` (`delete-conversation-dialog.tsx:41`) and `.t-dropdown-reveal` (`model-picker.tsx:119`) are both applied to a NEW inner wrapper div nested INSIDE `AlertDialogContent`/`PopoverContent` — both of which already carry their own `tailwindcss-animate` entrance (`packages/ui/src/alert-dialog.tsx:39`: `duration-200 data-[state=open]:animate-in ... zoom-in-95 fade-in-0`; `packages/ui/src/popover.tsx:24`: `data-[state=open]:animate-in ... zoom-in-95 fade-in-0` at the library's default ~150ms). The spec's own risk note ("inner-wrapper approach avoids this entirely") only addresses className-level override conflicts (tailwind-merge not deduping custom vs. `tailwindcss-animate` utility names on the SAME element) — it does not address two INDEPENDENT nested animations both scaling+fading the same visual event. On the modal specifically, the durations don't even match (outer 200ms vs. inner 250ms custom cubic-bezier), so the outer's `animate-in` finishes while the inner is still settling its box-shadow — a genuine compounded/two-stage motion artifact, not a hypothetical risk.
- `GeneratingRing` mounts are clean — the ring is a decorative pseudo-element sweep, not a transform/opacity animation on the wrapped content itself, so it never compounds with any streaming skeleton/caret animation inside `GenuiPartBoundary`.

### Pillar 5: Consistency (3/4)
- Attribution headers present and correct in every required location: `file-tree.tsx` (Magic UI, MIT, 2026-07-06), `generating-ring.tsx` (Magic UI, MIT), `globals.css`'s ADOPT-03/05 comment blocks, all 4 `docs/design/**` files (Apache-2.0 / MIT as applicable). Spot-checked 3/4 docs files directly (not just trusting Verification) — all correct H1s and source lines.
- FileTree and GeneratingRing both follow the shared-component + colocated-test convention (`file-tree.test.tsx`, `generating-ring.test.tsx` sit beside their components, mirroring `json-pane.test.tsx`'s mount convention).
- **Deviation:** `conversation-rail.tsx:111`'s `bg-background/70 backdrop-blur-md` (pre-existing since Phase 22, confirmed via `git log -S`) directly contradicts bans-item #3 of `docs/design/product-register-and-bans.md` (authored BY this phase), which explicitly states blur/backdrop-filter isn't part of this app's committed material palette. This phase touched the exact same div (swapping in `.t-panel-reveal`) without surfacing the contradiction anywhere — contrast with the `CommandGroup font-medium` spillover, which the phase's own scouting explicitly caught and documented as a flagged, out-of-scope item in `27-UI-SPEC.md`. This one simply wasn't looked for.
- `docs/design/product-register-and-bans.md`'s 13-item bans list is correctly exactly 13 items, correctly paraphrased (not verbatim), with the "Available Transition Utilities" section correctly naming all 3 `.t-*` utilities and their designated consumers, matching the actual wiring.

### Pillar 6: Accessibility (4/4)
- `GeneratingRing`: confirmed decorative-only via direct read — no ARIA role on the wrapper, `pointer-events: none` on the pseudo-element (`globals.css:166`), colocated test explicitly asserts `role` is null and `onclick` is null.
- `FileTree`: all 3 icon types (`ChevronRight`, `Folder`/`FolderOpen`, `FileCode2`) carry `aria-hidden`; visible text labels are the accessible name for every row (folder trigger text, file button text) — no separate `aria-label` needed, matches spec. Radix `AccordionPrimitive.Trigger` supplies `aria-expanded` automatically (colocated test explicitly asserts the `false`→`true` transition).
- No focus-ring suppression (`outline-none`, `focus:ring-0`, `focus-visible:ring-0`) in any ADOPT-01..05 file — native focus behavior preserved throughout.
- Both `GeneratingRing` mounts retain an independent accessible signal alongside the ring (Studio: `GenerationStateChrome`'s `aria-live` region; Chat: the existing streaming skeleton/caret inside `GenuiPartBoundary`) — the ring is never the sole signal of an in-progress state, as required.

---

## Registry Safety

Not applicable — no `components.json` in the repo (`shadcn` never initialized), consistent with `27-UI-SPEC.md`'s own "Tool: none" declaration. This phase's 4 external sources were vetted via attribution headers + execution-time license checks (documented in the phase's SUMMARYs), not the shadcn CLI registry gate — outside this audit's registry-safety mechanism by design.

---

## Files Audited

- `apps/web/src/components/file-tree.tsx` + `file-tree.test.tsx`
- `apps/web/src/components/generating-ring.tsx` + `generating-ring.test.tsx`
- `apps/web/src/app/globals.css` (ADOPT-03 `.generating-ring` block, ADOPT-05 `.t-*` block)
- `apps/web/src/app/studio/_components/code-sandbox-island.tsx`
- `apps/web/src/app/studio/_components/generation-sandbox-island.tsx`
- `apps/web/src/app/chat/_components/message-turn.tsx`
- `apps/web/src/app/chat/_components/delete-conversation-dialog.tsx`
- `apps/web/src/app/chat/_components/conversation-rail.tsx`
- `apps/web/src/app/chat/_components/model-picker.tsx`
- `packages/ui/src/command.tsx`
- `packages/ui/src/alert-dialog.tsx`, `packages/ui/src/popover.tsx` (read to verify the double-animation finding)
- `docs/design/product-register-and-bans.md`
- `docs/design/references/canvas-navigation.md`, `canvas-objects-performance.md`, `ai-ux-patterns.md`
- `.planning/phases/27-adopted-external-design-picks/27-UI-SPEC.md`, `27-VERIFICATION.md`
