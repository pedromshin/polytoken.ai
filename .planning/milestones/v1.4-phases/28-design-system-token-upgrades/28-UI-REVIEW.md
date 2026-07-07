# Phase 28 — UI Review

**Audited:** 2026-07-06 (retroactive, post-execution)
**Baseline:** `.planning/phases/28-design-system-token-upgrades/28-UI-SPEC.md` (approved contract)
**Screenshots:** captured — `.planning/ui-reviews/28-20260706-232301/` (chat-desktop.png, chat-dark.png, studio-desktop.png, studio-page-ideas.png), dev server live at `localhost:3000`
**Cross-reference:** `28-VERIFICATION.md` flagged one gap (sidebar Tailwind color family not registered in the compiling preset); confirmed CLOSED by commit `69c3afa` (`packages/tailwind-config/base.ts` now carries a `colors.sidebar` block, verified by direct read + `packages/ui/src/sidebar.tsx` class-string grep).

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Zero new copy introduced, as the contract promised — confirmed by diff-scope review of all 7 touched component files |
| 2. Visuals | 3/4 | New elevation/entrance visuals are coherent, but `chat-node.tsx`'s `border-l-2 border-l-primary` stripe directly contradicts bans-doc item 1 ("accent side-stripe borders... never intentional") — a live contradiction Phase 28 had the opportunity to reconcile (it touched this exact doc) but didn't |
| 3. Color | 4/4 | TOKEN-01/02 values byte-exact vs. spec; contrast gate 6/6 passing live; sidebar-ring gap fully closed |
| 4. Typography | 4/4 | 2-weight discipline (`font-normal`/`font-semibold` only) holds exactly across every touched file |
| 5. Spacing | 4/4 | 8px shadow-blur ceiling respected exactly (ghost-card ban compliance verified byte-for-byte); no new off-grid spacing |
| 6. Experience Design | 3/4 | Motion-reduce gating correct and verified; but the sidebar-ring a11y gap shipped in the initial delivery and needed a same-day hotfix, and `28-02-SUMMARY.md` now documents a stale/incorrect class string that doesn't match shipped code |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **Bans-doc item 1 contradiction left unreconciled** — `chat-node.tsx:150` renders `border-l-2 border-l-primary` on every mount, which is the literal pattern `docs/design/product-register-and-bans.md` item 1 calls "never intentional here." This predates Phase 28 (FIX-04, Phase 26), but Phase 28 edited this exact doc file this session (item 3's blur-debt closure, item 10's radius allowlist) without touching item 1 — a missed, cheap opportunity to either add a documented exception (mirroring item 3's "Resolved" pattern) or flag it as a known-open contradiction. **Fix:** add one sentence to item 1 acknowledging the `ChatNode` exception with its FIX-04 citation, so the doc stops silently contradicting the rendered app.

2. **`28-02-SUMMARY.md` documents a stale, buggy class string** — it states the shipped TOKEN-05(a) class string is `...zoom-in-95 duration-[250ms] motion-reduce:animate-none`, but the actual shipped code (post-commit `64f3cbc`) is `...zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none` — changed same-day to fix a real PostCSS build break (commit message: "CSS comment self-terminated by `--duration-*`/ wildcard breaking postcss"). A future maintainer copying the SUMMARY's documented pattern would reintroduce the bug. **Fix:** amend `28-02-SUMMARY.md`'s Task/Artifact description to the corrected string, or add a one-line addendum pointing to `64f3cbc`.

3. **No regression guard against the exact bug class that shipped mid-phase** — the sidebar-ring gap (`--sidebar-ring` correct in CSS, but no compiling Tailwind `colors.sidebar` utility to carry it into the DOM) was caught only by `28-VERIFICATION.md`'s manual compiled-CSS grep, not by any automated check, and the same failure mode (a CSS custom property that's "correct" but has zero real Tailwind utility consumer) could recur for `chart-*` the moment a real chart consumer is built. **Fix:** add a lightweight test (e.g., grep `packages/tailwind-config/base.ts`'s compiled Tailwind output for `.bg-sidebar`/`.ring-sidebar-ring`/`.bg-chart-1` rule presence whenever a new `colors.*` family is referenced by a component) so this class of "wired-but-invisible" token bug fails CI next time, not just a verifier's manual read.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Confirmed zero new user-facing strings across all 7 touched files (`composer.tsx`, `conversation-rail.tsx`, `chat-node.tsx`, `genui-panel-node.tsx`, `history-island.tsx`, `page-ideas-island.tsx`, `card.tsx`). Every existing string in these files (`"No conversations yet."`, `"New chat"`, `"Failed to load generation history..."`, `"No generations yet."`, etc.) predates Phase 28 and is untouched — exactly matching the UI-SPEC's Copywriting Contract ("zero new user-facing copy... every change is a token value, config entry, or className/style swap").

### Pillar 2: Visuals (3/4)

- Elevation resting/selected split (TOKEN-03) is visually confirmed in the `studio-desktop.png` screenshot — Catalog cards show a clean hairline border + soft ambient shadow (`shadow-elevation-1`), consistent with the "clinical blueprint" reference.
- Icon-only buttons retain `aria-label` (composer's Send/Stop button, `composer.tsx:93`) — unaffected by this phase, still compliant.
- **Finding (WARNING):** `chat-node.tsx:150` — `"...border border-border/60 border-l-2 border-l-primary bg-background..."` — a 2px colored left-edge stripe used purely for chrome differentiation. `docs/design/product-register-and-bans.md` item 1 states plainly: "A `border-left`/`border-right` thicker than 1px used as a decorative colored accent on a card, row, or callout is never intentional here." This is a pre-existing Phase-26 decision (FIX-04) that explicitly claims to supersede item 1's clause, but the bans doc itself was never updated to record that supersession as a documented exception (unlike item 3, which now has a clean "Resolved (Phase 28...)" note). Since Phase 28 touched this exact file this session for two other items, this was a cheap, missed reconciliation — the doc still reads as an absolute, unexplained ban that the live app visibly violates on every `ChatNode` render.

### Pillar 3: Color (4/4)

- `globals.css` TOKEN-01 values are byte-exact matches to the spec's "Final values" table, both `:root` (lines 23-28) and `.dark` (lines 65-70).
- `token-contrast.test.ts` run directly: **6/6 tests pass** (verified live, not just cited from `28-VERIFICATION.md`) — `npx vitest run apps/web/src/app/__tests__/token-contrast.test.ts` → all green.
- TOKEN-02 `chart-1..5` values byte-match spec in both modes; zero live consumers today (documented, accepted, forward-looking fix).
- **Sidebar gap CLOSED:** `28-VERIFICATION.md` flagged (status: `gaps_found`) that `--sidebar-*` vars were correct but `colors.sidebar` was never registered in any Tailwind config that compiles `apps/web`, meaning `ring-sidebar-ring` fell back to Tailwind's stock blue-500 default on every keyboard-focused sidebar item — the exact "accidental blue ring" TOKEN-02 was supposed to kill. Commit `69c3afa` (same day, post-verification) added a full `colors.sidebar` block to `packages/tailwind-config/base.ts` (the real, compiling config). Confirmed by direct read: `base.ts` now has `sidebar: { DEFAULT/foreground/primary/accent/border/ring }` all wired to `hsl(var(--sidebar-*))`, and `packages/ui/src/sidebar.tsx`'s `ring-sidebar-ring`/`bg-sidebar`/`border-sidebar-border` classes (11+ call sites) now resolve to real CSS. Gap genuinely closed — but see Experience Design pillar for the process implication.
- **Informational (not a defect):** `chart-4` light-mode contrast-vs-background is 2.60:1, under the 3:1 non-text-graphics guideline (WCAG SC 1.4.11) — explicitly documented in the UI-SPEC as an accepted tradeoff of a 5-step pastel ramp, with a "never color-only encoding" mitigation recorded. No live chart consumer exists yet, so this is backlog, not a shipped defect.

### Pillar 4: Typography (4/4)

Grepped every touched file for `font-*` weight classes: only `font-normal` and `font-semibold` appear (`chat-node.tsx:119`, `genui-panel-node.tsx:92`, `history-island.tsx:411,487`, `page-ideas-island.tsx:323`, `card.tsx:38`) — the 2-weight discipline established in Phase 26 holds exactly, as the spec claimed ("zero new font-weight usage"). No new type-scale value introduced.

### Pillar 5: Spacing (4/4)

- Elevation shadow blur radii checked against the spec's hard ceiling ("no elevation layer's blur radius may exceed 8px" — ban item 9, ghost-card): `globals.css` lines 50-54 (light) / 89-93 (dark) use `2px`/`4px`/`8px` blur — max is exactly `8px` (`elevation-3`), never exceeded. `card.tsx` (the one consumer with both a `border` and a shadow) uses only `elevation-1` (max blur `2px`), safely inside the exception.
- No new arbitrary spacing (padding/margin/gap) values introduced by Phase 28's consumer-file edits. The arbitrary-bracket values present in touched files (`min-h-[240px]`, `min-w-[320px]`, `w-[280px]`, `min-h-[44px]`, `text-[10px]`) are all pre-existing component dimension constraints (predate Phase 28's diff scope), not new spacing-grid violations.
- Radius derivations (`--radius-xl`/`--radius-2xl`, `+4px`/`+8px` off base) match spec exactly and are correctly exempted from the 4-point spacing grid per the UI-SPEC's own "motion-value exemptions" clause.

### Pillar 6: Experience Design (3/4)

- TOKEN-05 mount entrance (`genui-panel-node.tsx:157`) and both list-stagger consumers (`history-island.tsx:308`, `page-ideas-island.tsx:130`) all carry `motion-reduce:animate-none` — confirmed by direct grep, all 3 consumers gated correctly. `GenuiPanelNode`'s entrance classes are scoped to the outer shell only (never `GenuiPanelNodeBody`/boundaries), matching the "fires once per mount, never mid-drag/mid-stream" contract.
- No stacking with Phase 27's `.t-*`/`.generating-ring` classes on the same reveal — confirmed neither exists in `genui-panel-node.tsx`.
- Elevation resting/selected split gives the existing `ring-2 ring-primary` selection idiom a real companion signal (shadow lift) on both canvas node types — a genuine UX improvement, correctly implemented per spec.
- Conversation-rail blur-debt resolved to `bg-background/95` (outcome 1, "default outcome" per the spec's own decision tree) — verbatim match, `backdrop-blur-md` fully removed from the file (confirmed, zero `backdrop-blur` string remains).
- **Finding (WARNING) — process/delivery quality, not a currently-live defect:** the sidebar-ring accessibility gap (stock blue-500 focus ring instead of teal on every keyboard-focused `AppSidebar` menu item) shipped in the phase's initial delivery and reached `gaps_found` status in `28-VERIFICATION.md` before being hotfixed same-day via `69c3afa`. This is now resolved, but it means the ROADMAP's own explicit "kill the accidental blue ring" success criterion failed on first delivery — a real a11y-adjacent regression (wrong-colored focus indicator) that shipped and needed a second pass to catch.
- **Finding (WARNING):** `28-02-SUMMARY.md` still documents the pre-fix, buggy class string (`duration-[250ms]`) for the genui-panel mount entrance, rather than the corrected, shipped string (`[animation-duration:250ms]`, fixed in commit `64f3cbc` same day for a documented PostCSS build break). This is a real documentation/code drift — low severity today, but a trap for any future maintainer who copies the SUMMARY's documented pattern instead of reading the live source.
- **Not independently re-verified by this audit (static screenshots only):** the two `28-VERIFICATION.md` human-check items requiring live interaction — (a) dragging/selecting a genui panel to watch the elevation lift and confirm single-fire mount entrance, and (b) toggling OS-level `prefers-reduced-motion` to confirm the cascade is fully cancelled. Code-level wiring for both was confirmed (as detailed above), but true runtime/motion behavior under a live interaction session remains unverified by this pass, consistent with `28-VERIFICATION.md`'s own framing that these are execution-time visual/motion checks, not static-code gates.

---

## Files Audited

- `.planning/phases/28-design-system-token-upgrades/28-UI-SPEC.md`
- `.planning/phases/28-design-system-token-upgrades/28-VERIFICATION.md`
- `.planning/phases/28-design-system-token-upgrades/28-01-SUMMARY.md`, `28-02-SUMMARY.md`, `28-03-SUMMARY.md`
- `apps/web/src/app/globals.css`
- `packages/tailwind-config/base.ts`
- `packages/tailwind-config/web.ts`
- `packages/ui/src/card.tsx`
- `packages/ui/src/sidebar.tsx`
- `apps/web/src/app/chat/_components/composer.tsx`
- `apps/web/src/app/chat/_components/conversation-rail.tsx`
- `apps/web/src/app/chat/_canvas/chat-node.tsx`
- `apps/web/src/app/chat/_canvas/genui-panel-node.tsx`
- `apps/web/src/app/studio/_components/history-island.tsx`
- `apps/web/src/app/studio/_components/page-ideas-island.tsx`
- `apps/web/src/app/__tests__/token-contrast.test.ts` (executed live: 6/6 pass)
- `docs/design/product-register-and-bans.md`
- `node_modules/tailwindcss-animate/index.js` (checked for the `duration` utility collision theory)
- Git history: `69c3afa` (sidebar color family fix), `64f3cbc` (animation-duration disambiguation fix)
- Screenshots: `.planning/ui-reviews/28-20260706-232301/chat-desktop.png`, `chat-dark.png`, `studio-desktop.png`, `studio-page-ideas.png`

Registry audit: not applicable — no `components.json` (`shadcn_initialized: false` per UI-SPEC frontmatter, confirmed).
