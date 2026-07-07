---
phase: 27-adopted-external-design-picks
verified: 2026-07-07T13:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Observe <GeneratingRing> teal sweep in Chat (streaming genui_spec_streaming / interactive_widget_streaming cards) and in Studio's Generation Sandbox (#sandbox-output-region) while a generation is in flight, in both light and dark mode."
    expected: "A 2px teal ring sweeps around the ringed region only while generating; the ring disappears once the part/generation finalizes; the existing 'Generating…' label / streaming skeleton is unchanged; no visible artifact in dark mode (mask-composite: exclude renders a clean ring, not a filled glow)."
    why_human: "CSS animation rendering (gradient sweep, mask-composite ring geometry, color contrast in both themes) cannot be confirmed by static grep — requires visual/browser observation."
  - test: "Browse the Code-Island tab's FileTree: expand/collapse each of the 4 preset folders, observe icon swap (Folder -> FolderOpen), chevron rotation, indentation, and click an island.js leaf to confirm the code editor below updates to that preset (same behavior the old <Select> provided)."
    expected: "Folders expand smoothly with a rotating chevron and icon swap; selected file row shows the teal bg-primary/10 + text-primary treatment; selecting a leaf loads that preset's code without auto-running it; 'Run preset' remains a separate manual action."
    why_human: "Visual layout (indentation steps, icon swap, selected-row highlight) and interaction feel are UI-rendering concerns not verifiable via static analysis."
  - test: "Trigger each of the 3 wired transitions in the browser: open the delete-conversation confirmation dialog (.t-modal-reveal), collapse/expand the conversation rail (.t-panel-reveal), and open the model-picker dropdown (.t-dropdown-reveal)."
    expected: "Modal fades/scales in over ~250ms with a soft ambient shadow; rail collapses/expands smoothly over ~400ms width transition; dropdown fades/scales in over ~150ms — none of the 3 changes any copy, border, or padding beyond the reveal motion itself."
    why_human: "Animation timing/easing feel and the absence of visual regression at each call site require an interactive browser session, not a code-level check."
  - test: "With OS-level 'reduce motion' accessibility setting enabled, repeat the above 3 checks (ring, transitions) and confirm all animations are frozen/disabled — ring stays a static highlight, modal/dropdown appear instantly (no scale/fade), rail collapses without a width transition."
    expected: "No motion plays anywhere; the reduced-motion CSS gates (verified statically to exist in globals.css) actually take effect in a real browser with the OS setting enabled."
    why_human: "prefers-reduced-motion is an OS/browser-level media query that can only be exercised via an actual browser environment with the setting toggled — not verifiable via grep."
---

# Phase 27: Adopted External Design Picks Verification Report

**Phase Goal:** The five researched external resources' narrowly-scoped, zero/near-zero-footprint
takeaways are actually present in the app and its documentation — not just decided in research.
**Verified:** 2026-07-07T13:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | `UI-SPEC.md`/6-pillar review contains an appendix with impeccable.style's product-register rules + 13-item bans checklist | ✓ VERIFIED | `docs/design/product-register-and-bans.md` exists, H1 "Product Register & Absolute Bans", Apache-2.0 attribution header (line 3), numbered 1-13 list under "## 13-Item Absolute Bans Checklist" (exactly 13 counted via awk), "Available Transition Utilities" section documents all 3 `.t-*` names + consumers |
| 2 | Code-island file browser renders a ported Magic UI `file-tree` built only from `@radix-ui/react-accordion` + `lucide-react` (zero new deps) | ✓ VERIFIED | `apps/web/src/components/file-tree.tsx` imports `* as AccordionPrimitive from "@radix-ui/react-accordion"` directly (not `@nauta/ui/accordion`), zero `font-medium` occurrences, MIT attribution header; mounted in `code-sandbox-island.tsx` (old `<Select>`/`SelectContent`/etc. imports fully removed, `<FileTree>` renders `FILE_TREE_DATA` derived from `PRESETS`, `onSelect` resolves to the same `handlePreset`, "Run preset" button unchanged); colocated `file-tree.test.tsx` (5 substantive tests, all pass); no `package.json`/`package-lock.json` changed anywhere in the repo across the full phase commit range |
| 3 | A teal-only, `motion-safe:`-gated `<GeneratingRing>` visibly marks "generating" state on genui cards in Chat and the sandbox tab in Studio | ✓ VERIFIED | `globals.css` `.generating-ring`/`::before`/`generating-ring-sweep` keyframes teal-only via `hsl(var(--primary))`, animated only under `@media (prefers-reduced-motion: no-preference)`; `generating-ring.tsx` component exists with colocated test (5 tests, pass); mounted in `generation-sandbox-island.tsx` around `#sandbox-output-region` driven by `chromeProps.isPending`, and in `message-turn.tsx` around ONLY the two streaming branches (`genui_spec_streaming`, `interactive_widget_streaming`) — finalized branches unwrapped; `git diff --name-only 2330065..HEAD` confirms `genui-part-boundary.tsx`, `interactive-widget-boundary.tsx`, `spec-renderer.tsx` are absent from the entire phase's diff (non-interference intact) |
| 4 | A slim project reference doc contains the 3 copied `ux-designer-skill` files | ✓ VERIFIED | `docs/design/references/{canvas-navigation,canvas-objects-performance,ai-ux-patterns}.md` all exist, each with a `Source:.../License: MIT/Fetched:` attribution header line, correct H1s ("Canvas Navigation", "Canvas Objects & Performance", "AI UX Patterns"); exactly 3 files, no skill machinery |
| 5 | 3-4 retokenized `transitions.dev` CSS snippets (modal, panel-reveal, dropdown) are visibly used at their corresponding UI moments | ✓ VERIFIED | `globals.css` defines `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` (hand-authored per license-blocked verbatim-copy finding, attributed, reduced-motion-gated); wired to exactly their designated consumers: `delete-conversation-dialog.tsx` (`<div className="t-modal-reveal">` inner wrapper, copy strings "Delete this conversation?"/"Keep conversation" unchanged), `conversation-rail.tsx` (`t-panel-reveal` replaces the old `motion-safe:transition-[width]` trio — confirmed removed), `model-picker.tsx` (`<div className="t-dropdown-reveal">` inner wrapper); `packages/ui/src/command.tsx` `CommandGroup`'s `[cmdk-group-heading]` selector now `font-semibold` + `py-1` (FIX-02 spillover fix, line 92) — the separate, out-of-scope `CommandDialog` `font-medium` occurrence (line 32) is untouched as documented |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `docs/design/product-register-and-bans.md` | Product-register paraphrase + 13-item bans + ADOPT-05 transition reference, Apache-2.0 attribution | ✓ VERIFIED | Exists, correct H1, 13 numbered items, 3 transition utilities documented |
| `docs/design/references/canvas-navigation.md` | Copied ux-designer-skill file, MIT attribution | ✓ VERIFIED | Exists, MIT header, H1 "Canvas Navigation" |
| `docs/design/references/canvas-objects-performance.md` | Copied ux-designer-skill file, MIT attribution | ✓ VERIFIED | Exists, MIT header, H1 "Canvas Objects & Performance" |
| `docs/design/references/ai-ux-patterns.md` | Copied ux-designer-skill file, MIT attribution | ✓ VERIFIED | Exists, MIT header, H1 "AI UX Patterns" |
| `apps/web/src/components/file-tree.tsx` | FileTree on raw AccordionPrimitive, zero font-medium, MIT attribution | ✓ VERIFIED | 178 lines, exports `FileTree`/`FileTreeNode`/`FileTreeProps`, `@radix-ui/react-accordion` import confirmed, `font-medium` count = 0 |
| `apps/web/src/components/file-tree.test.tsx` | Colocated vitest coverage | ✓ VERIFIED | 135 lines, 5 substantive tests (render, select-callback, selected treatment, expand/collapse, no-bold-weight), all pass |
| `apps/web/src/app/studio/_components/code-sandbox-island.tsx` | FileTree mounted, replaces `<Select>` | ✓ VERIFIED | `<FileTree>` mounted and visible; `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` imports fully removed; `handlePreset`/`handleRunPreset` intact |
| `apps/web/src/app/globals.css` | Additive `.generating-ring` + 3 `.t-*` utilities, token count unchanged | ✓ VERIFIED | All 4 utilities present with reduced-motion gating; actual `:root`/`.dark` token-value count = 55 (confirmed by excluding a false-positive grep match on a comment line referencing external `--duration-*`/`--scale-*` names) |
| `apps/web/src/components/generating-ring.tsx` | GeneratingRing wrapper, MIT attribution | ✓ VERIFIED | Exports `GeneratingRing`/`GeneratingRingProps`, `cn(active && "generating-ring", className)` body, decorative-only (no ARIA role, no handler) |
| `apps/web/src/components/generating-ring.test.tsx` | Colocated vitest coverage | ✓ VERIFIED | 5 tests (active toggles class, inactive omits, className merges, children render, decorative-only), all pass |
| `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` | GeneratingRing mount around `#sandbox-output-region` | ✓ VERIFIED | `<GeneratingRing active={chromeProps.isPending} ...>` wraps the region; `GenerationStateChrome`'s "Generating…" label untouched |
| `apps/web/src/app/chat/_components/message-turn.tsx` | GeneratingRing mount on 2 streaming sites only | ✓ VERIFIED | Wraps `genui_spec_streaming` and `interactive_widget_streaming` returns only; finalized `genui_spec`/`interactive_widget` branches unwrapped |
| `apps/web/src/app/chat/_components/delete-conversation-dialog.tsx` | `.t-modal-reveal` inner wrapper | ✓ VERIFIED | New `<div className="t-modal-reveal">` wraps header..footer content; copy unchanged |
| `apps/web/src/app/chat/_components/conversation-rail.tsx` | `.t-panel-reveal` replaces ad hoc pair | ✓ VERIFIED | `t-panel-reveal` present; old `motion-safe:transition-[width]` trio confirmed removed |
| `apps/web/src/app/chat/_components/model-picker.tsx` | `.t-dropdown-reveal` inner wrapper | ✓ VERIFIED | New `<div className="t-dropdown-reveal">` wraps `<Command>` inside `<PopoverContent>` |
| `packages/ui/src/command.tsx` | `CommandGroup` heading fixed to `font-semibold` + on-grid `py` | ✓ VERIFIED | Line 92: `font-semibold` + `py-1`; `CommandDialog`'s separate, out-of-scope `font-medium` (line 32) untouched as documented |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `code-sandbox-island.tsx` | `handlePreset` | FileTree `onSelect` -> `handleFileTreeSelect` | ✓ WIRED | `handleFileTreeSelect` resolves parent preset id from the leaf id and calls `handlePreset(parentPresetId)`; "Run preset" stays a separate manual trigger |
| `file-tree.tsx` | `@radix-ui/react-accordion` | direct import, not `@nauta/ui/accordion` | ✓ WIRED | Confirmed via grep; zero `font-medium` inherited |
| `generation-sandbox-island.tsx` | `chromeProps.isPending` | `GeneratingRing active={...}` prop | ✓ WIRED | Confirmed; layout-preserving `flex flex-1 min-h-0` moved onto the wrapper per SUMMARY's documented Rule-1 fix |
| `message-turn.tsx` | `GenuiPartBoundary` (via caller) | `GeneratingRing` wraps from outside, boundary files untouched | ✓ WIRED | `git diff` across full phase range confirms `genui-part-boundary.tsx`/`interactive-widget-boundary.tsx`/`spec-renderer.tsx` never touched |
| 3 chat consumers | `.t-modal-reveal`/`.t-panel-reveal`/`.t-dropdown-reveal` (globals.css) | new inner wrapper / same bespoke div | ✓ WIRED | Each utility appears in exactly its one designated consumer; no shared-primitive className override |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| file-tree + generating-ring colocated tests pass | `npx vitest run --root apps/web file-tree generating-ring` | 2 files, 10 tests, all passed | ✓ PASS |
| Full web vitest suite green (matches SUMMARY's claimed 168/168) | `npx vitest run --root apps/web` | 23 files, 168 tests, all passed | ✓ PASS |
| Web typecheck clean | `npm run typecheck --workspace=@nauta/web` | exit 0, no errors | ✓ PASS |
| UI package typecheck clean | `npm run typecheck --workspace=@nauta/ui` | exit 0, no errors | ✓ PASS |
| Zero new deps across entire repo, full phase range | `git diff --stat 2330065 HEAD -- '**/package.json' '**/package-lock.json'` | empty diff | ✓ PASS |
| Non-interference: locked files untouched | `git diff --name-only 2330065 HEAD` | `genui-part-boundary.tsx`/`interactive-widget-boundary.tsx`/`spec-renderer.tsx` absent | ✓ PASS |
| No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) in phase-modified files | grep across all 16 phase-touched app/docs files | zero hits | ✓ PASS |
| font-medium regression check in chat/studio | `grep -rn 'font-medium' apps/web/src/app/chat apps/web/src/app/studio` | 2 hits, both pre-existing test-assertion text (comment + `.not.toContain` string), not live classes | ✓ PASS (no regression) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ADOPT-01 | 27-01 | impeccable.style product-register + 13-item bans appendix | ✓ SATISFIED | `docs/design/product-register-and-bans.md` |
| ADOPT-02 | 27-02 | Magic UI file-tree ported, zero new deps | ✓ SATISFIED | `file-tree.tsx` + mount in `code-sandbox-island.tsx` |
| ADOPT-03 | 27-03 (CSS) + 27-04 (component/mounts) | `<GeneratingRing>` hand-ported CSS technique, mounted in Chat + Studio | ✓ SATISFIED | `.generating-ring` CSS + `generating-ring.tsx` + 2 mounts |
| ADOPT-04 | 27-01 | 3 ux-designer-skill reference files copied | ✓ SATISFIED | `docs/design/references/*.md` (3 files) |
| ADOPT-05 | 27-03 (blocked) + 27-05 (hand-authored + wired) | 3-4 transitions.dev snippets, retokenized, wired to 3 consumers | ✓ SATISFIED | `globals.css` `.t-*` utilities (hand-authored per amended wording — verbatim copy license-blocked) + 3 consumer wirings + command.tsx spillover fix |

No orphaned requirements — all 5 ADOPT-01..05 IDs are declared across the 5 plans and match REQUIREMENTS.md's traceability table (all marked Complete).

### Anti-Patterns Found

None. Scanned all 16 files touched across the phase's full commit range (2330065..HEAD) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — zero hits. No stub patterns (`return null`, hardcoded empty arrays/objects feeding render, empty handlers) found in any new component. No `eval`/`dangerouslySetInnerHTML`/`process.env` in any new file.

### Notable Finding (documented deviation, not a gap)

**ADOPT-05's mechanism changed mid-phase from "hand-copied" to "hand-authored"** — Plan 03 discovered at execution time that `Jakubantalik/transitions.dev` carries no verifiable license grant for its CSS-snippet content (GitHub API returns `license: null`, no `LICENSE*` file in the git tree, the only "MIT" text found is scoped to an unrelated sub-tool). Plan 03 correctly SKIPPED the verbatim copy rather than shipping unlicensed content. Plan 05 then hand-authored original CSS implementing the same locked numeric timing/scale contract (durations/easing/scale values are facts, not copyrightable expression) under an explicit orchestrator amendment. REQUIREMENTS.md's ADOPT-05 wording was amended accordingly ("hand-authored ... verbatim copy license-blocked"). This is exactly the disposition the task brief flagged as expected and pre-approved — verified as correctly executed and documented, not treated as a gap.

### Human Verification Required

The 4 items below need a real browser session (visual rendering, animation timing/easing, and OS-level `prefers-reduced-motion` toggling cannot be confirmed via static code analysis). See YAML frontmatter `human_verification` for the structured form.

1. **GeneratingRing sweep visibility** — confirm the teal ring animates correctly around Chat's streaming genui parts and Studio's Generation Sandbox output region, in both light and dark mode, and disappears once generation finalizes.
2. **FileTree browse/select interaction** — confirm folder expand/collapse, icon swap, chevron rotation, indentation, and selected-row highlight render correctly and that leaf-select loads the right preset without auto-running it.
3. **3 transition reveals at their UI moments** — confirm the delete-dialog modal reveal, conversation-rail panel reveal, and model-picker dropdown reveal all animate smoothly with no visual regression (copy/border/padding unchanged).
4. **Reduced-motion compliance** — with the OS `prefers-reduced-motion: reduce` setting enabled, confirm all 4 new animations (ring sweep + 3 transitions) are frozen/disabled in a real browser.

### Gaps Summary

None. All 5 ROADMAP Phase 27 success criteria are code-verified with passing artifacts, correct wiring, non-interference with locked files, zero new dependencies, and a green test suite (168/168) + clean typechecks (web + ui). Status is `human_needed` rather than `passed` solely because this is a visual/CSS-heavy phase whose animation rendering and OS-level reduced-motion behavior require human browser verification — not because any automated check failed.

---

*Verified: 2026-07-07T13:00:00Z*
*Verifier: Claude (gsd-verifier)*
