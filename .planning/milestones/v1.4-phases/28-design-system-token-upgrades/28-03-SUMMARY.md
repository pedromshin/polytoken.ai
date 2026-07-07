---
phase: 28-design-system-token-upgrades
plan: 03
subsystem: ui
tags: [design-tokens, tailwind, tailwindcss-animate, glassmorphism, radius-allowlist]

# Dependency graph
requires:
  - phase: 28-design-system-token-upgrades (28-01)
    provides: "--radius-xl/--radius-2xl custom properties + xl/2xl borderRadius Tailwind config, so the radius-allowlist docs note describes tokens that already exist"
provides:
  - "TOKEN-05 fully consumed: item (b), the Studio history-island/page-ideas-island list stagger (capped-6, 40ms step), lands alongside 28-02's item (a) genui-panel mount entrance -- TOKEN-05 now complete"
  - "TOKEN-04 fully closed: the two-value radius allowlist is recorded as forward guidance in the bans doc (item 10)"
  - "conversation-rail's backdrop-blur-md glassmorphism debt (bans-doc item 3, open since Phase 22) is resolved -- solid bg-background/95 surface, no exception remains"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capped-6 index-based stagger: Math.min(index, 5) * 40ms via inline style={{ animationDelay }}, paired with animate-in/fade-in-0/slide-in-from-bottom-1/duration-200 classes and motion-reduce:animate-none -- the standard Tailwind JIT escape hatch for a per-item dynamic delay that can't be a static utility class"
    - "Blur-debt resolution via opacity escalation (/70 -> /95) instead of blur removal alone -- keeps the existing border-r border-border/50 as sole separator, default branch of a 3-branch fallback chain documented in 28-UI-SPEC.md"

key-files:
  created: []
  modified:
    - apps/web/src/app/studio/_components/history-island.tsx
    - apps/web/src/app/studio/_components/page-ideas-island.tsx
    - apps/web/src/app/chat/_components/conversation-rail.tsx
    - docs/design/product-register-and-bans.md

key-decisions:
  - "Shipped the UI-SPEC's default/first-attempt branch for the rail (bg-background/95, blur dropped) autonomously -- the legibility fallback criterion is an execution-time visual check that can't be judged headlessly; documented in this summary that the user's live testing is the actual legibility gate, with Fallback 1 (full bg-background) and Fallback 2 (restore backdrop-blur-md + promote to permanent allowlist) available and described in 28-UI-SPEC.md if /95 reads wrong over live canvas content"
  - "bans-doc item 3 rewritten from 'documented debt' framing to a dated 'Resolved (Phase 28, 2026-07-06)' closure note, per the UI-SPEC's outcome-1/2 template (blur removed) -- no permanent-allowlist template needed since Fallback 2 wasn't triggered"
  - "Radius allowlist note appended verbatim under bans-doc item 10, plus an explicit source citation line (styles.refero.design's two-value radius allowlist, via .planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md) so the paraphrase-attribution convention already used elsewhere in this doc (impeccable.style header) is followed for the new note too"

requirements-completed: [TOKEN-04, TOKEN-05]

# Metrics
duration: ~10min
completed: 2026-07-06
---

# Phase 28 Plan 03: Design-System Token Upgrades (Studio Stagger + Blur-Debt Resolution) Summary

**Studio history/page-ideas lists now cascade in with a capped-6, 40ms-step stagger; the last standing glassmorphism exception (conversation-rail's backdrop-blur-md) is resolved to a solid bg-background/95 surface; both bans-doc obligations (blur-debt closure, TOKEN-04 radius-allowlist forward guidance) are recorded -- closing every v1.4 requirement.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-07T01:40:05Z (continuing directly from 28-02)
- **Completed:** 2026-07-06T22:51:44-03:00
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `history-island.tsx`'s `<li>` rows and `page-ideas-island.tsx`'s `IdeaCard` (`<Card>`) both thread a mapped `index` into `Math.min(index, 5) * 40`ms `animationDelay`, paired with `animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none` -- delays land at 0/40/80/120/160/200ms for the first 6 items then flat 200ms beyond, and `prefers-reduced-motion: reduce` fully cancels the entrance
- `conversation-rail.tsx`'s panel wrapper dropped `backdrop-blur-md` and raised `bg-background/70` to `bg-background/95` -- the default/first-attempt branch of the UI-SPEC's 3-branch legibility chain; `border-r border-border/50` remains the sole visual separator from canvas content behind it
- `docs/design/product-register-and-bans.md` item 3's "documented debt, 2026-07-06" exception paragraph is replaced with a dated "Resolved (Phase 28, 2026-07-06)" closure note -- no glassmorphism exception remains in the app
- `docs/design/product-register-and-bans.md` item 10 gained the TOKEN-04 "Radius allowlist (added Phase 28)" forward-guidance blockquote plus a source citation (styles.refero.design via `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md`)
- `npm --prefix apps/web run typecheck` clean; full `apps/web` vitest suite green (24 files / 174 tests, unchanged count -- no new tests added, none needed for className/inline-style/prose-doc changes)

## Task Commits

Each task was committed atomically:

1. **Task 1: history-island.tsx per-row stagger** - `5e03dc1` (feat)
2. **Task 2: page-ideas-island.tsx per-card stagger via index prop** - `d583cfb` (feat)
3. **Task 3: conversation-rail blur-debt resolution + bans-doc closure + radius allowlist note** - `53a8f22` (docs)

**Plan metadata:** (this commit -- docs: complete plan)

## Files Created/Modified
- `apps/web/src/app/studio/_components/history-island.tsx` - `rows.map` now threads `index`; `<li>` carries the stagger classes + `Math.min(index, 5) * 40`ms `animationDelay`
- `apps/web/src/app/studio/_components/page-ideas-island.tsx` - `IdeaCard` gained a `readonly index: number` prop threaded from `filtered.map`; its `<Card>` carries the same stagger classes/formula
- `apps/web/src/app/chat/_components/conversation-rail.tsx` - `bg-background/70 backdrop-blur-md` -> `bg-background/95` (blur dropped, opacity raised); `t-panel-reveal` and width classes unchanged
- `docs/design/product-register-and-bans.md` - item 3 exception paragraph replaced with a "Resolved (Phase 28, ...)" closure note; item 10 gained the radius-allowlist blockquote + source citation

## Decisions Made
See `key-decisions` in frontmatter: shipped the UI-SPEC's default rail-surface branch autonomously (execution-time legibility checks can't be judged headlessly), closed the bans-doc note with the "blur removed" template (not the permanent-allowlist template), and added an explicit citation line for the radius-allowlist source.

## Deviations from Plan

None - plan executed exactly as written. All four cited interface strings (`history-island.tsx` `rows.map`/`<li>`, `page-ideas-island.tsx` `IdeaCard`/`filtered.map`, `conversation-rail.tsx` line 111's `cn(...)` first entry, and both bans-doc paragraphs) matched the plan's "exact current call sites" verbatim before editing.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Manual Verification Deferred

Both `<human-check>` items (Task 2: Studio history/page-ideas cascade + reduced-motion behavior; Task 3: conversation-rail legibility over live canvas content with >=3 overlapping panels) were not performed interactively in this autonomous run -- `config.json` runs in `yolo`/`skip_checkpoints` mode with `auto_advance: true`, and this plan's tasks are all `type="auto"` (no `checkpoint:human-verify` task type present). All automatable gates (grep class-string/formula assertions, typecheck, full vitest suite) passed.

**The rail's legibility is the real open item.** The shipped `bg-background/95` is the UI-SPEC's own prescribed default/first attempt, but the spec is explicit that the actual pass/fail criterion is a live visual check over moving canvas content, which this session cannot perform. Recommend a quick visual pass next time the `/chat` dev server is up: open the rail with >=3 overlapping canvas panels behind it and confirm conversation-row text/hover states read cleanly. If bleed-through degrades legibility, apply Fallback 1 (drop the `/95` for a fully opaque `bg-background`) per 28-UI-SPEC.md's "Conversation-Rail Backdrop-Blur Debt Resolution" section; only if that still reads wrong, Fallback 2 (restore `bg-background/70 backdrop-blur-md` and upgrade the bans-doc note to the "Permanent allowlist entry" template instead of the "Resolved" one currently shipped).

## Next Phase Readiness
- TOKEN-04 and TOKEN-05 both fully complete -- every v1.4 requirement (TOKEN-01..05, plus Phases 26/27's FIX/POLISH/ADOPT sets) is now closed.
- No token-layer, config, or consumer-file work remains open for Phase 28 or the v1.4 milestone.
- Only remaining item is the live-canvas legibility spot-check noted above (non-blocking -- the default branch already ships a solid, non-glassmorphism surface either way).

---
*Phase: 28-design-system-token-upgrades*
*Completed: 2026-07-06*

## Self-Check: PASSED

All 4 modified files confirmed present on disk with the expected content (grep-verified during Task 3 verification); all 3 task commit hashes (`5e03dc1`, `d583cfb`, `53a8f22`) confirmed present in `git log --oneline`.
