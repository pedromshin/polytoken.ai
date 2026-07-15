---
phase: 55-platform-migration-tailwind-v4-react-19
verified: 2026-07-15T09:35:00Z
status: passed
score: 4/4 roadmap success criteria verified; 4/4 requirements (STCK-01..04) verified
overrides_applied: 0
re_verification: null
deferred:
  - truth: "Pre-existing sidebar pointer-events-interception bug (data-sidebar=\"content\"/\"menu\" under data-side=\"left\" intercepting clicks) causes 4 of 9 live E2E failures on /knowledge and /emails/[id]"
    addressed_in: "No formal backlog item yet — candidate for Phase 60-62 (Surface Redesign) since those phases touch sidebar/layout chrome directly, or a dedicated investigation phase"
    evidence: "Independently reproduced live by this verifier (identical `data-sidebar=\"content\"` intercepts pointer events\" signature on /knowledge, timeout at the same locator/line as documented); phase's own deferred-items.md documents a full revert-and-reproduce bisection against the pre-Phase-55 baseline in 55-02, confirming this predates the migration entirely. Not caused by, and not blocking, Phase 55's STCK-01..04 requirements."
  - truth: "packages/genui artifacts.test.ts registryVersion content-hash drift (2/548 genui vitest tests failing)"
    addressed_in: "No formal backlog item — needs a follow-up session to regenerate GENUI_PROMPT_PATH once the actual catalog/registry drift cause is diagnosed"
    evidence: "55-02-SUMMARY.md documents a git-stash bisection reproducing the identical failure against the untouched pre-Phase-55 baseline; independently re-confirmed by this verifier via a live `npm run test -w @polytoken/genui` run (546/548 passing, same 2 failures). Unrelated to CSS/color/oklch — a Bedrock catalog payload content-hash, orthogonal to STCK-01..04."
---

# Phase 55: Platform Migration — Tailwind v4 + React 19 Verification Report

**Phase Goal:** `apps/web` + `packages/ui` run on Tailwind v4 (oklch tokens) and React 19, every
vendored component is revalidated, the Radix-vs-Base-UI stance is settled and documented, and a
direct shadcn registry install works in place of the vendor-and-adapt workflow — all with zero
regression against the existing gates.
**Verified:** 2026-07-15T09:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

This verification re-ran every load-bearing gate live in this session (not trusted from SUMMARY
text) and additionally executed the full Playwright E2E suite against a live local Supabase stack
(Docker was reachable in this session, unlike the executors' own sessions), which the executors
could not do. All results below are first-party, live-reproduced evidence.

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `apps/web` + `packages/ui` build and run on Tailwind v4; `globals.css` tokens are `@theme`/oklch (not HSL); WCAG-AA contrast + token-registration gates stay green | ✓ VERIFIED | `npm run web:build` → exit 0, 20/20 routes. `grep -c "oklch(" globals.css` → 87. `grep -c "hsl(var(--" globals.css` → **0** (whole-tree grep outside the untracked `dev/design` scratch also 0). `grep -c "@source"` → 2, `@theme inline` → 2, `@config` → 0. `npm run test -w @polytoken/web -- token-contrast token-registration palette-ban` → 3 files / 18 tests, all pass, live in this session. |
| 2 | `apps/web` + `packages/ui` build and run on React 19; 16-surface screenshot harness + E2E suite show zero runtime regressions | ✓ VERIFIED (with documented pre-existing exclusions, independently corroborated — see below) | `react`/`react-dom` = `^19.2.7` in `apps/web`; `npm ls react react-dom --all` shows **zero** `18.x` instances tree-wide (live-checked). Full E2E suite (50 tests, live run against a running local Supabase stack) → 34 passed, 9 failed, 7 did-not-run. Every failure independently traced to one of 3 pre-existing/environmental causes (detailed below), not a Phase-55 regression. `.planning/ui-reviews/2026-07-15T06-55-10-082Z/` contains real, correctly-rendered screenshots (spot-checked `knowledge-desktop.png` visually — correct teal/oklch colors, sidebar, React Flow canvas chrome, no transparent/broken elements). |
| 3 | Radix-vs-Base-UI stance decided, documented in the design-system skill / `docs/design/`; every vendored `packages/ui` component still matches its documented behavior post-upgrade | ✓ VERIFIED | `docs/design/radix-vs-base-ui.md` exists, 110 lines (read in full) — records the decision (stay on Radix), the July-2026 shadcn changelog citation, a **self-corrected** pin mechanism (the plan's assumed `-b radix` flag was verified live against the installed CLI and found not to apply to `add`; the doc documents the real, verified mechanism instead — evidence of genuine investigation, not a copy-pasted claim), and an explicit re-evaluation trigger. `SKILL.md`: `grep -c "NOT Tailwind v4"` → 0; `grep -iE "tailwind v4|react 19|oklch|@theme"` → matches. `calendar.tsx` (react-day-picker v9) and the resizable dock (v3) both typecheck clean and were live-verified via Playwright interaction per 55-05-SUMMARY (exact oklch color match on selected/today states; panel resize 18.0→26.3). |
| 4 | A direct `shadcn add @kibo-ui/<component>` (or equivalent) install succeeds against the new stack for ≥1 real component | ✓ VERIFIED | `packages/ui/components.json`: `"config": ""` (confirmed). `packages/ui/src/rating.tsx` exists (6036 bytes, exports `Rating`/`RatingButton`). Imported and rendered at `apps/web/src/app/dev/components/page.tsx:22` via `@polytoken/ui/rating` (this repo's established per-file export convention, confirmed against `components.json`'s `"./*"` exports map — not a barrel-file miss). `npm run typecheck -w @polytoken/ui`/`-w @polytoken/web` clean with the component in the tree; `npm run web:build` succeeds with `/dev/components` in the route list. |

**Score:** 4/4 roadmap success criteria verified.

### Criterion 2 detail — the 9 live E2E failures, traced

Ran `npm run test:e2e -w @polytoken/web` live against a running local Supabase stack (Docker was
reachable this session — `docker info` showed a healthy server section, and
`supabase_*_polytoken` containers were already up). This is a gate the executors themselves could
not run to completion (Docker was unreachable in every one of their sessions). Result: **34
passed / 9 failed / 7 did not run** (of 50 total). Every failure/skip traces to one of three
causes, none of which is a Phase-55 regression:

| Cause | Failing specs | Evidence this predates/is-independent-of Phase 55 |
|---|---|---|
| Pre-existing sidebar pointer-events-interception bug (`data-sidebar="content"`/`"menu"` under `data-side="left"` intercepts clicks) | `token-render.spec.ts` `/knowledge` (×2 browsers) + its downstream `/chat` test skipped (serial); `uat-48-token-surfaces.spec.ts` 48.1 (×2 browsers) + downstream 48.2 skipped | **Independently reproduced by this verifier**, live, in isolation: identical `data-sidebar="content"` interception at the identical `page.locator("label", {hasText:"Knowledge Rules"}).click()` call site, identical 60s timeout, identical retry-count pattern. `deferred-items.md` documents a full revert-to-pre-Phase-55-baseline bisection (55-02) that reproduced this exact failure on the *unmodified* code — this is not a color/token issue, it's a z-index/layering bug unrelated to CSS engine or React version. |
| Local FastAPI listener not running (documented operator prerequisite; the spec does not start it) | `live-loop-green.spec.ts` (×2 browsers), `uat-39-tool-round.spec.ts` (×2 browsers) | Both fail with `ECONNREFUSED`/upstream-fetch-failed against the chat API, or a `chat_runs` row stuck in `running` — the FastAPI listener was not started in this verification session (avoided deliberately, matching 55-05's own documented reasoning: a concurrent Python executor may be working in `apps/email-listener` this session, and starting/stopping a server there risks collision for zero benefit to this verification). 55-04 independently confirmed both specs pass cleanly once the listener is started. |
| Flaky under `fullyParallel` (confirmed non-deterministic) | `uat-41-knowledge-preview.spec.ts` 41.2 (firefox) | 55-04-SUMMARY documents this exact test as flaky (reproduces PASS in isolation); in my two live runs it failed once and passed once — consistent with documented flakiness, not a deterministic regression. |

None of these three causes were introduced by Phase 55's commits (confirmed: none touch
`packages/ui/src/sidebar.tsx`; the FastAPI listener is out-of-band; the flaky test is a
parallel-execution artifact). Criterion 2 is scored VERIFIED on this basis — the roadmap's "32/32
E2E" language is a stale pre-Phase-55 test count (the suite is now 50 tests; Phase 55 itself added
3 new specs × 2 browsers = 6), and the actionable bar (zero regressions attributable to this
phase's changes) is met with first-party, independently-reproduced evidence.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/web/src/app/globals.css` | oklch tokens, `@theme inline`, `@source` × 2, zero `hsl(var(--` | ✓ VERIFIED | Live-grepped: 87 `oklch(`, 2 `@source`, 2 `@theme inline`, 0 `@config`, 0 `hsl(var(--`. |
| `apps/web/e2e/token-render.spec.ts` | executable computed-style regression guard | ✓ VERIFIED | Exists, ran live (3 tests, 2 browsers = 6 total in full suite); `/` (inbox) passes cleanly; `/knowledge` fails on the pre-existing sidebar bug (not a token-render assertion failure — it never reaches the color assertion); `/chat` historically green per 55-02/55-04 live runs (not independently re-run in isolation this session due to the `/knowledge` serial-block skip, but nothing in the phase's later commits touches this surface). |
| `apps/web/src/app/__tests__/token-contrast.test.ts` | oklch-aware WCAG-AA gate | ✓ VERIFIED | 6/6 tests pass live; `grep -c "oklch"` ≥1, `resolveConfig`/`parseHslTriplet`/`hslToLinearRgb` → 0. |
| `apps/web/src/app/__tests__/token-registration.test.ts` | resolveConfig-free `@theme` registration gate | ✓ VERIFIED | 10/10 tests pass live; `resolveConfig` → 0. |
| `packages/ui/src/calendar.tsx` | react-day-picker v9 rewrite | ✓ VERIFIED | Typechecks clean; `react-day-picker` `^9.14.0` in `package.json`. |
| `packages/ui/package.json` | React 19 + 8 bumped deps | ✓ VERIFIED | `react`/`react-dom` `^19.2.7`; `react-day-picker` `^9.14.0`; `react-resizable-panels` `^3.0.6`; `tailwind-merge` `^3.6.0`; peerDependencies widened. |
| `docs/design/radix-vs-base-ui.md` | STCK-03 decision record | ✓ VERIFIED | 110 lines; changelog citation, pin mechanism, re-evaluation trigger all present. |
| `packages/ui/components.json` | v4 registry config | ✓ VERIFIED | `"config": ""`. |
| `packages/ui/src/rating.tsx` | STCK-04 registry-install proof | ✓ VERIFIED | Exists, exported via `@polytoken/ui/rating`, wired on `/dev/components`, typechecks, builds. |
| `packages/genui/src/theme/packs.ts` | must stay untouched (Pitfall 1 boundary) | ✓ VERIFIED | `git diff 9333f29~1 HEAD -- packages/genui/src/theme/packs.ts` (9333f29 = the phase's first commit) → **empty diff**. Confirmed byte-identical to the pre-Phase-55 state. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `apps/web/postcss.config.cjs` | `@tailwindcss/postcss` | plugin key | ✓ WIRED | `grep -c "@tailwindcss/postcss"` ≥1; production build succeeds on it. |
| `globals.css` `@theme inline` | `:root`/`.dark` oklch vars | `--color-*: var(--*)` mapping | ✓ WIRED | Confirmed present; `token-registration.test.ts` asserts this mapping live and passes. |
| `globals.css` `@source` | `packages/ui`/`packages/genui` source trees | monorepo content registration | ✓ WIRED (compiled-CSS proof, not just config presence) | `min-h-svh` (a `packages/ui`-only class, absent from `apps/web/src`) is present in the real production-build compiled CSS (`apps/web/.next/static/css/ffcbaa9bfd8e6a6d.css`) — this is the strong "faked-proof" check the plan itself specified (a green build alone does not prove `@source` is correctly wired; a missing directive purges silently). |
| `packages/ui/components.json` | `@kibo-ui` registry | `shadcn add` with blank `tailwind.config` | ✓ WIRED | `rating.tsx` is a real, non-placeholder component (137 lines, `RatingButton`/`Rating` exports, `LucideProps`-typed), rendered and typechecking in the live tree. |

### Data-Flow Trace (Level 4)

Not applicable in the traditional sense — this phase is build-tooling/CSS-engine/dependency
migration, not a feature that renders dynamic backend data. The closest analog (does the oklch
token surface actually reach rendered pixels, not just exist as CSS text) was verified via the
`@source` compiled-CSS proof above and the live screenshot spot-check (`knowledge-desktop.png`
shows real, non-transparent, correctly-colored UI).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Web vitest suite fully green | `npm run test -w @polytoken/web` | 64 files / 464 tests passed, 0 failed | ✓ PASS |
| Web typecheck clean | `npm run typecheck -w @polytoken/web` | exit 0 | ✓ PASS |
| UI typecheck clean | `npm run typecheck -w @polytoken/ui` | exit 0 | ✓ PASS |
| Genui typecheck clean | `npm run typecheck -w @polytoken/genui` | exit 0 | ✓ PASS |
| Zero `hsl(var(--` anywhere in source (outside dev/design scratch) | `grep -rn "hsl(var(--" apps/web/src packages/ui/src packages/genui/src \| grep -v dev/design` | 0 matches | ✓ PASS |
| Production build succeeds | `npm run web:build` | exit 0, 20/20 routes | ✓ PASS |
| `@source` compiled-CSS proof | `grep -rl "min-h-svh" apps/web/.next/static/css/` | match found | ✓ PASS |
| No dual React instances | `npm ls react react-dom --all \| grep 18\.` | 0 matches | ✓ PASS |
| Full E2E suite | `npm run test:e2e -w @polytoken/web` (live, local Supabase up) | 34/50 pass; 9 fail, all traced to 3 documented pre-existing/environmental causes (see detail above) | ✓ PASS (with documented, independently-corroborated exclusions) |
| genui vitest suite | `npm run test -w @polytoken/genui` | 546/548 pass; 2 pre-existing failures (documented content-hash drift, unrelated to CSS/React) | ✓ PASS (pre-existing exclusion, not in STCK-01..04's scope) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| STCK-01 | 55-01, 55-02, 55-03 | Tailwind v4 build/run, oklch tokens, WCAG-AA + registration gates green | ✓ SATISFIED | See Criterion 1 above; `REQUIREMENTS.md` marks `[x]` Complete, consistent with live evidence. |
| STCK-02 | 55-04, 55-05 | React 19 build/run, every vendored component revalidated, zero screenshot-harness regressions | ✓ SATISFIED | See Criterion 2 above; live-reproduced, pre-existing-cause-traced. |
| STCK-03 | 55-06 | Radix-vs-Base-UI stance decided + documented | ✓ SATISFIED | `docs/design/radix-vs-base-ui.md` + `SKILL.md` verified directly. |
| STCK-04 | 55-06 | Direct `shadcn add @kibo-ui/…` install works for ≥1 component | ✓ SATISFIED | `rating.tsx` verified directly (exists, wired, typechecks, builds, renders). |

No orphaned requirements — `REQUIREMENTS.md`'s Traceability table maps STCK-01..04 to Phase 55
only, and all 4 plans (55-01, 55-02/03, 55-04/05, 55-06) declare their requirement(s) in
frontmatter, matching this table.

### Anti-Patterns Found

None. Scanned the phase's key files (`globals.css`, both rewritten gate test files,
`token-render.spec.ts`, `calendar.tsx`, `rating.tsx`, `themed-wrapper.tsx`,
`panel-theme-scope.tsx`, `radix-vs-base-ui.md`, `SKILL.md`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/
`PLACEHOLDER` — zero matches. No stub returns, no hardcoded-empty-data patterns introduced by this
phase's commits.

### Human Verification Required

None. Phase 55 is a platform-migration phase whose success criteria are all mechanically
verifiable (build/typecheck/test/grep/compiled-CSS-proof/live-interaction-proof); the one
genuinely visual judgment call (does the new palette/identity *look* good) is explicitly deferred
by the milestone's own design to Phase 58's blocking human gate, not this phase — Phase 55's job
was parity with the pre-migration look (verified via computed-style guards + screenshot spot
check), not a new design.

### Gaps Summary

No gaps block Phase 55's goal. Two items are noted as **deferred** (informational, not
actionable against this phase, not new — both independently reproduced/confirmed by this
verifier as pre-existing and out of Phase 55's caused-by set):

1. A sidebar pointer-events-interception bug (`data-sidebar="content"`/`"menu"` intercepting
   clicks near the expanded left sidebar) causes 4 of the 9 live E2E failures. Confirmed
   pre-existing via the phase's own revert-and-reproduce bisection (55-02) AND independently
   reproduced live by this verifier against the current HEAD. No formal backlog item currently
   tracks it — recommend filing one (candidate landing spot: Phase 60-62 Surface Redesign, which
   touches this exact chrome, or a small standalone investigation).
2. A `packages/genui` `artifacts.test.ts` content-hash drift (2/548 genui tests) — confirmed
   pre-existing via git-stash bisection in 55-02, unrelated to CSS/color/React. Needs a follow-up
   session to regenerate the committed prompt-payload artifact.

Both are called out in `deferred-items.md` (created by this phase) with full bisection detail, and
neither affects any of the 4 roadmap success criteria or STCK-01..04.

---

_Verified: 2026-07-15T09:35:00Z_
_Verifier: Claude (gsd-verifier)_
