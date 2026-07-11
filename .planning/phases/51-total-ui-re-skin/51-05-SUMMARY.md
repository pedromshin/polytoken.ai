---
phase: 51-total-ui-re-skin
plan: 05
subsystem: ui
tags: [tailwind, design-tokens, react, studio, settings, login, hover-active]

# Dependency graph
requires:
  - phase: 48-token-system-extensions
    provides: "D-48-06 hover/active + focus-visible convention (docs/design/hover-active-convention.md) — the recipe this plan applies"
  - phase: 47-brand-foundation-verification-tooling
    provides: "docs/design/brand-guide.md §2 voice register + the login copy Do/Don't table — the contract this plan confirms and corrects the button label against"
provides:
  - "/studio chrome (studio-tabs.tsx segments + Showcase link, history-island.tsx rows) on the D-48-06 hover/active + focus-visible convention"
  - "/login Google sign-in CTA copy corrected to the locked brand-guide string \"Sign in with Google\" and explicitly on the bg-primary filled-semantic recipe"
  - "RSKN-04 complete (/studio, /settings/forwarding, /login)"
affects: [51-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared className constant for repeated Radix TabsTrigger overrides (TAB_TRIGGER_CLASS) instead of 5x duplicated literal strings — same neutral/ghost recipe, DRY"
    - "Pinned-state hover-reassert via data-[state=active]:hover:bg-transparent data-[state=active]:hover:text-foreground: when a segment's active treatment isn't itself an accent/alias fill (studio-tabs uses a border-only active indicator), the hover-active-convention's §2c exception is expressed by explicitly cancelling the neutral hover on the active data-state rather than needing a colored active fill to reassert"

key-files:
  created: []
  modified:
    - apps/web/src/app/studio/_components/studio-tabs.tsx
    - apps/web/src/app/studio/_components/history-island.tsx
    - apps/web/src/app/login/_components/google-signin-button.tsx

key-decisions:
  - "studio/page.tsx, generation-state-chrome.tsx, page-ideas-island.tsx, catalog-browser-island.tsx (Task 1) and settings/forwarding/page.tsx, forwarding-address-card.tsx, login/page.tsx (Task 2) were read in full per the plan's read_first but received zero edits — each was already palette-clean, and their interactive controls (all built on the shared @polytoken/ui Button's outline/ghost/default variants) already inherit the D-48-06 recipe from the shared component's cva definition. Confirmed via literal file read, not assumed."
  - "google-signin-button.tsx's button label was 'Continue with Google' at execution time, not 'Sign in with Google' as the plan's read_first assumed ('already present per research'). Treated as a Rule-1 auto-fix (copy doesn't match the locked brand-guide/UI-SPEC Copywriting Contract string) rather than a checkpoint — the plan's own acceptance criteria mandates the literal grep match, so silently leaving the stale copy would fail the plan's own gate."
  - "Added an explicit bg-primary/hover:bg-primary/90/focus-visible:ring-ring override on the Google CTA even though the shared Button's default variant already renders bg-primary — the plan's acceptance criteria requires a literal 'bg-primary' grep match against this specific file, and the explicit override also serves as a durable, self-documenting confirmation that this CTA is intentionally pinned to the primary token (matches the confirm-deny-controls.tsx / graph-toolbar.tsx precedent of explicit overrides layered on shared-component defaults elsewhere in this phase)."
  - "HistoryRow's selected state (bg-muted) is the pinned-state exception (hover reasserts bg-muted rather than moving to bg-accent); unselected rows are neutral/ghost and move to hover:bg-accent — replaced the prior ad-hoc hover:bg-muted/50 + focus:bg-muted/70 pair with the D-48-06-compliant version plus a proper focus-visible ring (the previous focus:bg-muted/70 was a background-only focus indicator with no ring, a pre-existing accessibility gap fixed in the same pass since it's the exact row/button affordance this task named)."

patterns-established: []

requirements-completed: [RSKN-04]

# Metrics
duration: 8min
completed: 2026-07-11
---

# Phase 51 Plan 05: /studio, /settings/forwarding, /login Register + Hover/Active Summary

**Applied the D-48-06 hover/active + focus-visible convention to `/studio`'s tab strip and history rows, and closed a copy drift found on `/login`'s Google sign-in button (label was "Continue with Google", the locked brand-guide string is "Sign in with Google") while confirming every other named surface was already palette-clean and on-convention via the shared Button component.**

## Performance

- **Started:** 2026-07-11T21:13:08Z (session start, immediately following 51-04's completion)
- **Task 1 commit:** 2026-07-11T21:19:42Z (`30b3d7f`)
- **Task 2 commit:** 2026-07-11T21:21:18Z (`e419543`)
- **Duration:** ~8 min wall-clock (read_first context + edits + gates)
- **Tasks:** 2 completed
- **Files modified:** 3 (studio-tabs.tsx, history-island.tsx, google-signin-button.tsx)
- **Files read + confirmed compliant, zero edits:** 7 (studio/page.tsx, generation-state-chrome.tsx, page-ideas-island.tsx, catalog-browser-island.tsx, settings/forwarding/page.tsx, forwarding-address-card.tsx, login/page.tsx)

## Accomplishments

- **studio-tabs.tsx:** Replaced five duplicated `TabsTrigger` `className` literals with a single `TAB_TRIGGER_CLASS` constant carrying `hover:bg-accent hover:text-accent-foreground` (neutral/ghost recipe) on inactive segments, `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`, and a `data-[state=active]:hover:bg-transparent data-[state=active]:hover:text-foreground` pair that reasserts (rather than intensifies) the active tab's border-only treatment on hover — the pinned-state exception from `hover-active-convention.md` §2c, expressed for a border-indicator active state rather than a colored-fill one. The "Showcase" `next/link` affordance (a neutral-ghost nav item, not a `TabsContent`) picked up the same `hover:bg-accent hover:text-accent-foreground` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` treatment plus `rounded-md` so the hover surface renders cleanly.
- **history-island.tsx:** `HistoryRow`'s hover/focus classes moved off the ad-hoc `hover:bg-muted/50 focus:outline-none focus:bg-muted/70` pair onto the D-48-06 recipe: selected rows reassert `bg-muted` on hover (pinned-state exception — a row is a persistent-selection element exactly like `tier-filter-control.tsx`'s active segment), unselected rows move to `hover:bg-accent hover:text-accent-foreground`, and a proper `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` replaces the previous background-only focus indicator (Rule 2 — the old `focus:bg-muted/70` was not a real focus-visible ring, an accessibility gap on a keyboard-focusable row/button affordance this task explicitly named).
- **google-signin-button.tsx:** Register-confirm pass found the button label read "Continue with Google" — not the locked brand-guide/UI-SPEC Copywriting Contract string "Sign in with Google" the plan's `read_first` assumed was already present. Corrected (Rule 1 — copy doesn't match the locked spec) and added an explicit `bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` override confirming the CTA sits on the filled-semantic primary recipe. `handleSignIn`, `safeNextPath`, `createClient`, and the OAuth redirect flow are byte-identical — only the visual `className` and the button's text child changed (confirmed via diff), holding the plan's T-51-05-A threat disposition (chrome-only re-skin, auth surface untouched).
- **Confirmed, zero edits:** `studio/page.tsx` (header chrome, non-interactive `Badge`s only), `generation-state-chrome.tsx` (four read-only status states, no interactive elements), `page-ideas-island.tsx` (every button is a shared `@polytoken/ui/button` `outline`/`default` variant — already inherits `hover:bg-accent`/`hover:bg-primary/90` + `focus-visible:ring-1 ring-ring` from the primitive's own `cva` definition), `catalog-browser-island.tsx` (the phase's own exemplar — imitated, not touched), `settings/forwarding/page.tsx` (layout wrapper, no interactive elements), `forwarding-address-card.tsx` (copy-address button is `variant="outline"`, same shared-component inheritance as above; copy already carries the warm first-person register — "Forward mail here to ingest it into polytoken"), `login/page.tsx` (`CardTitle`/`CardDescription` already exact-match the brand-guide's locked login copy — no change).
- Zero raw palette classes across all 10 plan-named files (full regression grep run at the end of execution, matches Phase-48 scout's ~0 expectation for this surface); zero `backdrop-blur`/raw-hex.
- `token-contrast.test.ts` (6 tests) + `token-registration.test.ts` (4 tests) green.
- `cd apps/web && npx tsc --noEmit` clean outside the pre-existing `apps/web/src/app/dev/design/**` scratch exclusion (confirmed via `grep -v`).
- No `package.json` diff anywhere in the repo (T-51-SC supply-chain mitigation holds — no new dependency was installed).

## Task Commits

Each task was committed atomically:

1. **Task 1: /studio chrome — hover/active + register pass** - `30b3d7f` (feat)
2. **Task 2: /settings/forwarding + /login — register/hover pass + brand-copy confirm + grep gate** - `e419543` (fix)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `apps/web/src/app/studio/_components/studio-tabs.tsx` — `TAB_TRIGGER_CLASS` constant (hover/active/focus-visible convention, DRY across 5 triggers); Showcase link gets matching neutral-ghost hover + focus-visible ring
- `apps/web/src/app/studio/_components/history-island.tsx` — `HistoryRow` hover/focus classes moved onto the D-48-06 recipe (pinned-state exception for selected rows, neutral-ghost for unselected, real focus-visible ring)
- `apps/web/src/app/login/_components/google-signin-button.tsx` — button label corrected to "Sign in with Google"; explicit `bg-primary` filled-semantic recipe override added

## Decisions Made

See `key-decisions` in frontmatter — summarized: (1) seven of the ten plan-named files needed zero edits because the shared `@polytoken/ui/button` component's `cva` variants already encode the D-48-06 recipe, confirmed by literal read rather than assumed; (2) the "Continue with Google" → "Sign in with Google" copy fix is a Rule-1 auto-fix, not a checkpoint, since the plan's own acceptance criteria mandates the corrected string; (3) the explicit `bg-primary` override on the Google CTA is intentionally redundant with the shared Button's default variant, added to satisfy the plan's literal grep gate and to self-document the CTA's token pin; (4) `HistoryRow`'s selected/hover treatment is modeled as the hover-active-convention's pinned-state exception, matching `tier-filter-control.tsx`'s precedent from Phase 48.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Google sign-in button label did not match the locked brand-guide copy**
- **Found during:** Task 2
- **Issue:** `google-signin-button.tsx` read "Continue with Google". The plan's `read_first` and the UI-SPEC's Copywriting Contract table both assumed "Sign in with Google" was already landed (per prior research); it was not — the string had drifted or was never updated in this file.
- **Fix:** Changed the button's text child to "Sign in with Google" (exact match to `brand-guide.md`'s Do/Don't table and `51-UI-SPEC.md`'s Copywriting Contract). No other copy on `/login` needed correction — `CardTitle` and `CardDescription` were already exact matches.
- **Files modified:** `apps/web/src/app/login/_components/google-signin-button.tsx`
- **Commit:** `e419543`

**2. [Rule 2 - Missing functionality] HistoryRow's focus indicator was background-only, not a real focus-visible ring**
- **Found during:** Task 1
- **Issue:** The row/button used `focus:bg-muted/70` (a plain `:focus` background change, not `:focus-visible`, and not the app's standard ring treatment) — inconsistent with every other interactive element's `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-*` contract, and this task explicitly named "row/button affordances" in `history-island` as in-scope for the hover/active pass.
- **Fix:** Replaced with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` (inset chosen over offset since the row spans full width inside a scroll container — an offset ring would clip against the container edge).
- **Files modified:** `apps/web/src/app/studio/_components/history-island.tsx`
- **Commit:** `30b3d7f`

Or: both fixes above were fully in-scope for this plan's named files/tasks — no out-of-scope discoveries logged to `deferred-items.md`.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced or found in the touched files.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes were introduced — `google-signin-button.tsx`'s OAuth initiation logic (`handleSignIn`, `safeNextPath`, `createClient`, the `/auth/callback` redirect) is byte-identical to before this plan; only the button's visual `className` and text child changed, matching the plan's own T-51-05-A disposition (accept, chrome-only).

## Issues Encountered

None beyond the copy-drift auto-fix documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- RSKN-04 requirements-completed: `/studio`, `/settings/forwarding`, and `/login` all confirmed on the polytoken register and (where interactive chrome exists) the D-48-06 hover/active convention.
- No settings hub/index page was created (D-49-09 held) — `/settings/forwarding` remains the only settings route.
- `packages/genui/renderer/*` untouched (D-49-07); style-pack machinery (`packages/genui/src/theme/packs.ts`) untouched (D-49-02); the code-island frames and generation logic in `studio-tabs.tsx`/`generation-sandbox-island.tsx`/`code-sandbox-island.tsx` were not modified beyond the tab-strip chrome.
- Before-state screenshot baseline (`.planning/ui-reviews/2026-07-11T04-32-30-989Z/{studio,forwarding,login}-{desktop,mobile}.png`) confirmed present and unchanged by this plan; after-pixel validation is 51-07's job per this plan's `<verification>` block — no screenshot was captured in this execution.
- No blockers for sibling Wave-1 plans; this plan touched only files in its own `files_modified` list.

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 3 modified source files + this SUMMARY.md confirmed present on disk; both task commits
(`30b3d7f`, `e419543`) confirmed present in `git log --oneline --all`.
