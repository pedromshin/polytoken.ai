---
phase: 28-design-system-token-upgrades
verified: 2026-07-07T02:25:00Z
status: human_needed
score: 4/4 roadmap success criteria verified (code-level); 5/5 TOKEN-01..05 requirements satisfied
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "Chart series colors and the sidebar visibly use teal-derived hues instead of stock shadcn demo colors (ROADMAP Phase 28 Success Criterion #2, sidebar clause) — closed by commit 69c3afa"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Screenshot the main /chat + /studio surfaces in both light and dark mode and compare against pre-Phase-28 baselines"
    expected: "The change reads as \"the same app, slightly more defined\" — not a retheme (28-CONTEXT.md's max-drift guard; all 6 changed neutrals stay within ≤2.8 lightness points of baseline, already computed and verified by the committed contrast test, but overall visual gestalt still needs a human eye)"
    why_human: "Visual gestalt/perception judgment — cannot be reduced to a numeric gate"
  - test: "With the /chat dev server up, drop/generate a genui panel on the canvas; confirm it fades+zooms in once on mount (not on drag, stream update, or selection toggle); select the node and confirm the shadow visibly lifts (elevation-1 -> elevation-2 alongside the ring); then enable OS-level prefers-reduced-motion and confirm the entrance is fully cancelled"
    expected: "Single fade+zoom entrance on mount only (250ms via [animation-duration:250ms]); visible shadow lift on selection; zero motion under reduced-motion"
    why_human: "Real-time animation/motion behavior and OS-level reduced-motion state cannot be verified by static grep — code-level wiring was confirmed (className strings present, applied to GenuiPanelNode's outer shell only, never to GenuiPanelNodeBody/GenuiPartBoundary/InteractiveWidgetBoundary/SpecRenderer) but the runtime behavior itself needs a live check"
  - test: "With the /studio dev server up, open the History tab and the Page Ideas tab; confirm list items cascade in with a visible stagger (first ~6 items staggered 0/40/80/120/160/200ms, rest appear flat at 200ms); then enable reduced-motion and confirm items appear immediately with no cascade"
    expected: "Visible capped stagger on initial render/filter change; immediate appearance with reduced-motion"
    why_human: "Real-time animation/motion behavior; code-level wiring (Math.min(index,5)*40 formula, animate-in classes, motion-reduce:animate-none) was confirmed by direct grep against both files, but the visual cascade itself needs a live check"
  - test: "With the /chat dev server up, populate the canvas with >=3 overlapping genui panels behind the conversation rail, open the rail, and confirm conversation-row text/hover states read cleanly with no distracting canvas-content bleed-through now that backdrop-blur-md has been replaced with bg-background/95"
    expected: "Clean, legible rail content over live canvas panels with no bleed-through; if bleed-through is visible, 28-UI-SPEC.md's Fallback 1 (drop to fully opaque bg-background) should be applied and the bans-doc closure note updated accordingly"
    why_human: "The UI-SPEC itself frames this as an execution-time visual check against arbitrary, moving canvas content, not a static WCAG-style computation — explicitly deferred to a human/live check by the phase's own design contract"
---

# Phase 28: Design-System Token Upgrades Verification Report

**Phase Goal:** The foundational token layer (`globals.css` + Tailwind preset) stops papering over
gaps with hardcoded values — every surface that consumes `secondary`/`muted`/`accent`, `chart-*`/
`sidebar-*`, shadow, radius, or entrance-animation tokens benefits at once.
**Verified:** 2026-07-07T02:25:00Z (codebase HEAD `69c3afa`)
**Status:** human_needed (all automated checks pass; 4 visual/motion items await a live check)
**Re-verification:** Yes — after gap closure (initial verification 2026-07-07T02:10:44Z found 1 gap, closed same session)

## Gap-Closure Addendum (2026-07-07)

The initial verification (committed `14d49d2`) found one BLOCKER gap: the `--sidebar-*` CSS
variables were correctly rebased by Phase 28, but no `colors.sidebar` family was registered in any
Tailwind config that actually compiles `apps/web`, so `bg-sidebar`/`ring-sidebar-ring`/etc. in
`packages/ui/src/sidebar.tsx` were dead class strings and the live `AppSidebar`'s focus ring fell
through to Tailwind's stock blue-500 default.

**Closed by commit `69c3afa`** (`fix(28): register sidebar color family in compiling Tailwind
preset`), which adds the full 8-entry `sidebar` color family (`DEFAULT`/`foreground`/`primary`/
`primary-foreground`/`accent`/`accent-foreground`/`border`/`ring` → `hsl(var(--sidebar-*))`) to
`packages/tailwind-config/base.ts` — mirroring the shape that previously existed only in the
IDE-only `packages/ui/tailwind.config.ts`.

**Independent re-verification evidence (not trusting the closure claim):**
- Read the actual diff `14d49d2..HEAD`: exactly the 8 `sidebar` color entries added to
  `base.ts`'s `theme.extend.colors` (plus 2 unrelated interim fixes, sanity-checked below).
- Fresh Tailwind CLI compile (`npx tailwindcss -c tailwind.config.ts -i src/app/globals.css`,
  app config whose `content` includes `../../packages/ui/src/**`): **30 compiled rules now
  reference `var(--sidebar-*)`** (previously zero), including `.bg-sidebar`, `.border-sidebar-border`,
  `.ring-sidebar-ring`, `.focus-visible\:ring-sidebar-ring:focus-visible`, and every
  hover/active/data-state `sidebar-accent` variant `sidebar.tsx` uses.
- Full resolution chain confirmed teal in the compiled output:
  `.ring-sidebar-ring { --tw-ring-color: hsl(var(--sidebar-ring)); }` →
  `--sidebar-ring: var(--primary)` → `--primary: 164 39% 22%`. The stock blue ring fallback is
  no longer reachable on the sidebar's focus ring.

**Two unrelated interim fixes on the same range (`64f3cbc`), sanity-checked for regression:**
1. **globals.css comment self-termination bug** — a Phase-27-era comment contained the literal
   `--duration-*/`, whose `*/` closed the CSS comment early and left raw prose in the stylesheet,
   breaking postcss. (Independently confirmed: this verifier's own pre-fix Tailwind CLI probe
   failed with a parse error at exactly that line; the post-fix compile succeeds.) The fix rewords
   the comment only — zero token values changed (verified via diff), and the contrast gate re-run
   passes 6/6 against the edited file.
2. **`duration-[250ms]` → `[animation-duration:250ms]`** on the genui panel mount entrance — the
   original UI-SPEC-literal class collided with the shell's `duration-150` in the same
   transitionDuration utility family (Tailwind emitted an "ambiguous" warning, independently
   observed pre-fix). The arbitrary-property form unambiguously sets `animation-duration: 250ms`
   for the entrance keyframe while `duration-150` keeps governing `transition-shadow`. Confirmed:
   `.\[animation-duration\:250ms\] { animation-duration: 250ms; }` emits in the compiled CSS, the
   ambiguity warning is gone, and `animate-in`/`fade-in-0`/`zoom-in-95`/`motion-reduce` all still
   emit. This deviates from the UI-SPEC's literal string but preserves (and corrects) the intended
   250ms entrance behavior — accepted as a Rule-1-style bug fix, not a regression.
- Locked files (`spec-renderer.tsx`, `genui-part-boundary.tsx`, `interactive-widget-boundary.tsx`)
  remain untouched across the new range; zero dependency changes (`git diff 14d49d2..HEAD` on all
  package.json files is empty).

## Goal Achievement

### Observable Truths (ROADMAP Phase 28 Success Criteria — non-negotiable contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `secondary`/`muted`/`accent` render as tonally distinct neutral tones (no longer one shared stock gray) in both light/dark, still 60/30/10-compliant | VERIFIED | `globals.css` lines 23-28 (`:root`) / 65-70 (`.dark`): 6 distinct hue-164 values, none identical; saturation capped at 10-12% (whisper-teal, not a second brand hue); `token-contrast.test.ts` run directly — 6/6 pass, all pairs >=4.5:1 WCAG-AA (re-run after gap-closure commits, still 6/6) |
| 2 | Chart series colors and the sidebar visibly use teal-derived hues instead of stock shadcn demo colors | VERIFIED (after gap closure `69c3afa`) | Chart half: `--chart-1..5` correctly teal-anchored (globals.css lines 34-38/76-80); zero live chart consumers yet, transparently documented in UI-SPEC/28-01-SUMMARY as an intentional forward-looking value-only fix. Sidebar half: `--sidebar-*` vars aliased to existing tokens AND (post-closure) the `colors.sidebar` Tailwind family is registered in `base.ts`, so `bg-sidebar`/`ring-sidebar-ring`/etc. now compile — 30 emitted rules, ring resolves to teal `164 39% 22%` (see addendum) |
| 3 | A real elevation/shadow scale (`elevation-1/2/3`, teal-tinted) exists in `packages/tailwind-config/base.ts` and is visibly applied; `xl`/`2xl` radius steps exist and `card.tsx` consumes the radius token | VERIFIED | `base.ts` (`boxShadow.elevation-1/2/3`); `web.ts` (`borderRadius.xl/2xl`); 4 named consumers confirmed wired: `card.tsx:12` (`shadow-elevation-1`), `composer.tsx:76` (`shadow-elevation-2`), `chat-node.tsx:150`, `genui-panel-node.tsx:157` (resting/selected elevation split) |
| 4 | Genui panel mount and Studio's history/page-ideas list items visibly animate in via `tailwindcss-animate`, beyond bare Radix open/close transitions | VERIFIED (code-level; visual confirmation pending human check) | `genui-panel-node.tsx:157` carries `animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none` on the outer shell only (duration form corrected in `64f3cbc`, see addendum); `history-island.tsx:304-309` and `page-ideas-island.tsx:117-131` both carry `Math.min(index, 5) * 40`ms stagger with the exact class string from the UI-SPEC |

**Score:** 4/4 verified (code-level). Visual/motion runtime confirmation routed to human verification.

### Requirements-Level Truths (TOKEN-01..05)

| Requirement | Status | Evidence |
|---|---|---|
| TOKEN-01 | SATISFIED | Values + contrast test, as above |
| TOKEN-02 | SATISFIED | `--chart-*`/`--sidebar-*` values correct; sidebar utilities now compile (post-`69c3afa`), so the rebase reaches the rendered DOM on the live `AppSidebar` |
| TOKEN-03 | SATISFIED | elevation vars/config/4 consumers, as above |
| TOKEN-04 | SATISFIED | radius vars/config; `card.tsx`'s `rounded-xl` now resolves through `--radius-xl` via `web.ts`'s `extend` precedence |
| TOKEN-05 | SATISFIED | mount entrance + list stagger, as above |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/app/globals.css` | TOKEN-01/02 values, `--elevation-1/2/3`, `--radius-xl/2xl` | VERIFIED | All values byte-match the UI-SPEC's "Final values" tables in both `:root` and `.dark`; post-`64f3cbc` comment fix changes prose only, zero token values |
| `packages/tailwind-config/base.ts` | `boxShadow.elevation-1/2/3` + (post-closure) `colors.sidebar` family | VERIFIED | Both present, wired to `var(--elevation-N)` / `hsl(var(--sidebar-*))` |
| `packages/tailwind-config/web.ts` | `borderRadius.xl/2xl` | VERIFIED | Present, wired to `var(--radius-xl)`/`var(--radius-2xl)`; `tailwindcss-animate` plugin registered |
| `apps/web/src/app/__tests__/token-contrast.test.ts` | Committed WCAG-AA regression gate | VERIFIED | Exists, runs standalone, 6/6 pass (re-run post-closure) |
| `packages/ui/src/card.tsx` | `shadow-elevation-1` consumer | VERIFIED | Line 12 exact match |
| `apps/web/src/app/chat/_components/composer.tsx` | `shadow-elevation-2` consumer | VERIFIED | Line 76 exact match |
| `apps/web/src/app/chat/_canvas/chat-node.tsx` | resting/selected elevation split | VERIFIED | Line 150 exact match |
| `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` | elevation split + mount entrance | VERIFIED | Line 157; entrance classes scoped to outer shell only; duration form corrected to `[animation-duration:250ms]` (behavior-preserving fix, see addendum) |
| `apps/web/src/app/studio/_components/history-island.tsx` | capped-6 stagger | VERIFIED | Lines 304-309 exact match |
| `apps/web/src/app/studio/_components/page-ideas-island.tsx` | capped-6 stagger via `index` prop | VERIFIED | Lines 117-131, 358-362 exact match |
| `apps/web/src/app/chat/_components/conversation-rail.tsx` | blur removed, `bg-background/95` | VERIFIED | Line 111 exact match, no `backdrop-blur` anywhere in file |
| `docs/design/product-register-and-bans.md` | item-3 resolved note + item-10 radius allowlist | VERIFIED | Both notes present verbatim with citation |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `base.ts` `boxShadow.elevation-N` | `globals.css` `--elevation-N` | `var(--elevation-N)` | WIRED | Confirmed both directions |
| `web.ts` `borderRadius.xl/2xl` | `globals.css` `--radius-xl/2xl` | `var(--radius-xl)` | WIRED | Confirmed |
| `genui-panel-node.tsx` outer shell | `tailwindcss-animate` plugin | `animate-in`/`fade-in-0`/`zoom-in-95` classes | WIRED | Plugin registered in `web.ts`; classes present, scoped correctly; all emit in compiled CSS |
| `globals.css` `--sidebar-ring: var(--primary)` | `packages/ui/src/sidebar.tsx`'s `ring-sidebar-ring` className | Tailwind `colors.sidebar.ring` registration in `base.ts` | WIRED (post-`69c3afa`) | Compiled output: `.ring-sidebar-ring { --tw-ring-color: hsl(var(--sidebar-ring)); }` with `--sidebar-ring: var(--primary)` = teal `164 39% 22%` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Effect | Status |
|----------|---------------|--------|----------------------|--------|
| `genui-panel-node.tsx` mount entrance | static className string (no runtime state) | pure CSS/Tailwind — plugin registered, utilities emit | Yes | FLOWING |
| `history-island.tsx` / `page-ideas-island.tsx` stagger | `index` (mapped from array position) | `rows.map`/`filtered.map` → `animationDelay` inline style | Yes | FLOWING |
| `card.tsx`/`composer.tsx`/`chat-node.tsx`/`genui-panel-node.tsx` elevation | static className string | `boxShadow.elevation-N` (`base.ts`) → `var(--elevation-N)` (`globals.css`) | Yes | FLOWING |
| `AppSidebar` sidebar-* accent/ring/border | static className strings in `packages/ui/src/sidebar.tsx` | `colors.sidebar.*` in `base.ts` → `hsl(var(--sidebar-*))` → aliased existing tokens | Yes (post-`69c3afa`) | FLOWING — 30 compiled rules confirmed |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Contrast regression gate passes standalone | `npx vitest run src/app/__tests__/token-contrast.test.ts` (apps/web) | 6/6 tests passed (re-run post-closure) | PASS |
| Full web test suite unaffected | `npx vitest run` (apps/web, run once during initial verification) | 24 files / 174 tests passed | PASS |
| Typecheck clean | `npm run typecheck` (apps/web, initial verification) | Clean; post-closure `base.ts` additionally proven loadable by the Tailwind CLI compile (config parses + satisfies at runtime) | PASS |
| Sidebar utilities emit in real compile | `npx tailwindcss -c tailwind.config.ts -i src/app/globals.css` + grep | 30 rules reference `var(--sidebar-*)`; ring chain resolves to teal | PASS (post-`69c3afa`; was FAIL at initial verification) |
| CSS parses (comment self-termination fixed) | same compile | Pre-fix probe errored at the broken comment line; post-fix compile succeeds, no warnings | PASS |
| Locked files untouched across full phase range | `git log b95f953..HEAD -- <3 locked files>` (re-run over extended range) | Zero commits touch `spec-renderer.tsx`/`genui-part-boundary.tsx`/`interactive-widget-boundary.tsx` | PASS |
| Zero new dependencies | `git diff b95f953..HEAD --stat -- package.json */package.json` (re-run over extended range) | No diff | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| TOKEN-01 | 28-01 | secondary/muted/accent tonal differentiation | SATISFIED | See truths table |
| TOKEN-02 | 28-01 (+ gap-closure `69c3afa`) | chart-1..5 + sidebar-* rebase off teal primary | SATISFIED | See truths table + addendum |
| TOKEN-03 | 28-01 (vars) / 28-02 (consumers) | elevation/shadow scale | SATISFIED | See truths table |
| TOKEN-04 | 28-01 (vars) / 28-03 (docs) | xl/2xl radius steps + card.tsx | SATISFIED | See truths table |
| TOKEN-05 | 28-02 (a) / 28-03 (b) | entrance/stagger animation | SATISFIED | See truths table |

No orphaned requirements — REQUIREMENTS.md confirms 23/23 v1.4 requirements mapped, TOKEN-01..05 all attributed to Phase 28.

### Anti-Patterns Found

None. Scanned all 12 phase-modified files (plus the 3 gap-closure/interim-fix files) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches.

### Human Verification Required

See frontmatter `human_verification` — 4 items harvested from `<human-check>` blocks across all 3 PLAN.md files (28-01, 28-02 x1, 28-03 x2), all explicitly deferred by the executor's own SUMMARY.md "Manual Verification Deferred" sections since this project runs in `yolo`/`skip_checkpoints` mode. All are visual/motion/live-canvas checks that cannot be reduced to a static code check.

### Gaps Summary

None remaining. The single gap from the initial verification (sidebar Tailwind color family not
registered in the compiling config, leaving `AppSidebar`'s focus ring on Tailwind's stock blue
default) was closed by commit `69c3afa` and independently re-verified via a fresh compile of the
real config chain — see the Gap-Closure Addendum above. Status is `human_needed` solely because the
4 visual/motion checks above require a live dev server and a human eye.

---

*Verified: 2026-07-07T02:25:00Z (re-verification after gap closure)*
*Initial verification: 2026-07-07T02:10:44Z (gaps_found, 3/4)*
*Verifier: Claude (gsd-verifier)*
