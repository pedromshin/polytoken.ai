---
phase: 51-total-ui-re-skin
plan: 07
subsystem: ui
tags: [tailwind, design-tokens, vitest, playwright, regression-gate, blocked]

# Dependency graph
requires:
  - phase: 51-total-ui-re-skin
    provides: "51-01..51-06's full Wave-1 palette burn-down (every production surface converted to design tokens) — the precondition this plan's gate verifies"
provides:
  - "Committed D-49-05 palette-ban regression gate (apps/web/src/app/__tests__/palette-ban.test.ts), green, making RSKN-05 enforceable"
  - "Confirmation that token-contrast.test.ts + token-registration.test.ts stayed green through the whole re-skin"
affects: [51-total-ui-re-skin-verification, live-loop-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Committed vitest file-walk + regex-family grep gate mirroring token-registration.test.ts's idiom, with an empty inline ALLOWLIST array as the escape hatch for genuinely-justified exceptions"
    - "Self-referential gate: because the gate walks its own containing directory, documentation/examples inside the gate file itself must avoid forming literal matches against its own ban pattern (worked around by describing example classes in prose rather than literal `prefix-family-number` strings)"

key-files:
  created:
    - apps/web/src/app/__tests__/palette-ban.test.ts
  modified: []

key-decisions:
  - "Excluded the gate's own file from producing false positives by rewriting its illustrative doc comments in prose (\"a filled violet swatch at weight 500\") instead of literal Tailwind class strings (\"bg-violet-500\") — a literal example string in the gate's own JSDoc was caught by its own regex on first run, since the walk covers apps/web/src/app/__tests__/ too and nothing in the D-49-05 spec exempts the gate's own source file (only globals.css, tailwind.config.ts, and app/dev/** are named exclusions)"
  - "Did not add anything to the ALLOWLIST — the independent grep confirmation (this plan's own acceptance criterion) already returned zero violations across the whole apps/web/src tree before this gate was even authored, meaning Wave 1 (51-01..51-06) left nothing for this gate to catch; the mechanism exists and is proven functional (it DID fail on the self-referential false positive above before the fix), but has nothing to allowlist today"
  - "Tasks 2 (E2E regression) and Task 3 (screenshot re-capture) could NOT be executed this session — see Issues Encountered / blocker detail below. Not faked, not skipped silently: documented as an infrastructure blocker requiring the local Docker-backed Supabase stack, which could not be brought to a ready state in this execution session despite ~25 minutes across three wait cycles and one clean process restart."

patterns-established:
  - "When authoring a committed grep-based regression gate that walks its own containing tree, verify the gate's own source file first — doc-comment examples are a common self-referential false-positive source"

requirements-completed: [RSKN-05]

# Metrics
duration: ~40min (Task 1 execution + verification); Tasks 2/3 blocked, not executed
completed: 2026-07-11
---

# Phase 51 Plan 07: Palette-Ban Gate (DONE) + E2E/Screenshot Regression (BLOCKED — Docker unavailable) Summary

**Authored and landed the committed D-49-05 palette-ban regression gate (green, zero production violations across all of Wave 1's conversions) — RSKN-05 is now enforceable, not aspirational. Tasks 2 (E2E regression suite) and 3 (16-surface screenshot re-capture) could not run: the local Docker-backed Supabase stack never reached a ready state in this execution session, confirmed via ~25 minutes of polling, a clean Docker Desktop restart, and Docker's own host log showing 2000+ consecutive "context deadline exceeded" failures dialing its internal Linux-VM backend.**

## Performance

- **Duration:** Task 1 ~40 min (read/write/verify/commit); ~25 min additional spent attempting to bring up the local stack for Tasks 2/3, which never became available
- **Started:** 2026-07-11T18:45:00Z (approx, session start)
- **Task 1 committed:** 2026-07-11T21:51:05Z (`150bfac`)
- **Docker readiness abandoned:** 2026-07-11T22:28Z (final poll exhausted)
- **Tasks:** 1/3 completed (Task 1); Tasks 2 and 3 blocked, not executed
- **Files modified:** 1 created (`palette-ban.test.ts`)

## Accomplishments

- **Task 1 (COMPLETE):** `apps/web/src/app/__tests__/palette-ban.test.ts` — a committed vitest
  gate mirroring `token-registration.test.ts`'s grep idiom. Recursively walks `apps/web/src`
  (`.ts`/`.tsx` only), banning every classic Tailwind palette family
  (`slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|
  indigo|violet|purple|fuchsia|pink|rose`) on any color-bearing utility prefix
  (`bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|divide|placeholder|caret|
  accent|shadow`) with a numeric scale, plus literal `bg/text/border/fill/stroke-white|black`.
  Excludes `app/dev/**` (structural directory-walk exclusion) and `globals.css`/
  `tailwind.config.ts` (never walked — not `.ts`/`.tsx`, and the config lives outside
  `apps/web/src` entirely). Ships with an empty inline `ALLOWLIST` mechanism for future
  justified exceptions.
- Gate is **green** with zero violations: every production surface Wave 1 (51-01 through 51-06)
  touched was already fully converted. Independently confirmed via the plan's own literal
  acceptance-criteria grep command, run twice (before and after authoring the gate) — both times
  returned nothing.
- `token-contrast.test.ts` (6 tests) and `token-registration.test.ts` (4 tests) reconfirmed green
  alongside the new gate — the whole re-skin's regression surface holds.
- No `package.json` diff anywhere in the repo (T-51-SC supply-chain mitigation holds — zero new
  dependencies).

## Task Commits

1. **Task 1: Author the D-49-05 palette-ban regression gate + make it green** - `150bfac` (feat)

**Plan metadata:** this commit (docs: complete plan, partial — see below)

Tasks 2 and 3 produced no commits — no source files were authored or modified for either (both
are verification-only tasks per the plan's own `<files>` field: "no source files authored —
verification run"), and neither could be executed at all in this session.

## Files Created/Modified

- `apps/web/src/app/__tests__/palette-ban.test.ts` — new committed regression gate (D-49-05); see Accomplishments for full behavior

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) fixed a self-referential false positive in
the gate's own doc comments (the gate walks its own file and its own JSDoc literally contained
example violation strings on first run — rewritten as prose); (2) the ALLOWLIST mechanism ships
empty and unused — proven functional by the self-referential failure it caught, but Wave 1 left
nothing else for it to catch; (3) Tasks 2/3 are documented as blocked, not silently skipped or
faked green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Gate's own doc-comment examples tripped its own regex (self-referential false positive)**
- **Found during:** Task 1, first `vitest run` of the new gate
- **Issue:** The gate walks every `.ts`/`.tsx` file under `apps/web/src`, which includes its own
  file (`apps/web/src/app/__tests__/palette-ban.test.ts`). Two JSDoc-style comments illustrating
  the pattern's shape (`` `bg-violet-500`, `text-emerald-800`, `ring-blue-200` `` and
  `` `bg-white`, `text-black`, `border-white` ``) were literal matches against the gate's own
  regex, failing the very first run with 6 "violations" inside the gate's own source.
- **Fix:** Rewrote both comments in prose ("a filled violet swatch at weight 500...", "literal
  white/black fills with no numeric scale...") that documents the same intent without forming a
  literal `prefix-family-number` token the regex can match.
- **Files modified:** `apps/web/src/app/__tests__/palette-ban.test.ts` (same file, pre-commit — no
  separate commit; folded into the Task 1 commit `150bfac`)
- **Verification:** Re-ran `vitest run` — all 3 gates green; re-ran the independent acceptance
  grep — zero matches anywhere outside `app/dev/**`, including inside the gate's own file.
- **Committed in:** `150bfac` (Task 1 commit; this was caught and fixed before the commit was made)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in the gate's own authoring, caught before commit)
**Impact on plan:** Contained entirely within the one new file this plan created. No scope creep.

## Issues Encountered

### BLOCKER: Local Docker-backed Supabase stack unavailable — Tasks 2 and 3 not executed

Tasks 2 (E2E regression suite) and 3 (16-surface screenshot re-capture) both require the live
local stack (`scripts/preflight-local.ps1` → Supabase in Docker + the FastAPI listener + `npm run
dev`) per the plan's own `<local_stack>` context block. **Docker Desktop's backend never reached a
ready state in this execution session**, despite:

1. Initial cold start (`Start-Process 'Docker Desktop.exe'`) — polled up to 150s, not ready.
2. A clean kill (`Stop-Process -Force` on `Docker Desktop`/`com.docker.backend`) + fresh restart —
   polled up to 200s, not ready.
3. A final extended poll — up to 300s, not ready. Exhausted at 2026-07-11T22:28Z.

Total: ~25 minutes of wall-clock waiting across three cycles, plus interleaved manual checks.

**Diagnostic evidence** (not a transient slow-boot — a persistent, non-recovering failure):

- `docker info` / `docker ps` consistently returned `request returned 500 Internal Server Error
  ... check if the server supports the requested API version` throughout — the named pipe
  (`dockerDesktopLinuxEngine`) existed and accepted connections, but the backend behind it never
  answered successfully.
- Docker Desktop's own host log
  (`%LOCALAPPDATA%\Docker\log\host\monitor.log`) shows the `apiproxy` component's requests
  consistently failing with `dialing 192.168.65.7:2376: context canceled` / `context deadline
  exceeded` — the proxy could not reach its own internal Linux-VM engine. This pattern recurred
  **2271+ times** across the session and persisted unchanged through the clean process restart
  (confirming it is not a one-off transient failure).
- Every `wsl`/`wsl.exe`-invoking command issued during this session (`wsl -l -v`, `wsl --status`)
  hung indefinitely with zero output rather than erroring or completing — consistent with Docker
  Desktop's WSL2 backend (which shells out to `wsl.exe` to manage its internal distros) being
  unable to complete initialization in this specific non-interactive execution context.
- **This is very likely session-specific, not a fundamental host/repo incompatibility**: the exact
  spec this plan needed to re-run (`live-loop-green.spec.ts`) has a persisted evidence artifact at
  `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/local-green-db-verification.md`
  proving it ran successfully against a live Docker-backed local stack earlier the same day
  (captured 2026-07-11T02:08:24Z) — so Docker Desktop demonstrably CAN and DID work in this
  environment under different (almost certainly interactive-console) session conditions.

**What this means for the plan's must-haves:**
- ✅ "A committed palette-ban regression gate... passes green" — satisfied (Task 1).
- ✅ "The WCAG-AA contrast gate and the token-family registration gate stay green" — reconfirmed
  green in this session (Task 1's verify step re-ran all three together).
- ❌ "The E2E regression suite... stays green" — **not verified this session**. Not proven broken
  either — this is an unexecuted verification, not a failing one. The suite was last known green
  per prior phase work (50-01..50-04's UAT burn-down); nothing in Wave 1's diffs (all
  `className`-only token conversions, confirmed file-by-file in 51-01..51-06's own summaries)
  gives specific reason to suspect regression, but that is an inference, not the DB/pixel-verified
  proof this plan exists to produce.
- ❌ "All 16 authenticated surfaces re-captured and diffed" — **not executed this session**. The
  before-baseline at `.planning/ui-reviews/2026-07-11T04-32-30-989Z/` remains the most recent
  captured evidence; no after-capture exists yet.

**Not fixed by this executor** because it is outside the scope of Rules 1-4 (deviation rules):
this is neither a code bug, missing functionality, a blocking issue fixable by editing repo
files, nor an architectural question — it is a host/session-level infrastructure availability
constraint (Docker Desktop's WSL2-backed engine not completing startup in this non-interactive
shell context). No fake pass was recorded; no test was skipped-and-reported-as-passing.

**Recommended next action:** re-run Task 2 and Task 3 of this plan (`51-07-PLAN.md`) in a session
where Docker Desktop can reach a ready state (e.g. an interactive desktop session, or after
confirming `docker info` succeeds before invoking the executor) — `scripts/preflight-local.ps1`
followed by the two `<verify>` commands in the plan file. No code changes are needed first; this
is purely an execution-environment gate.

## User Setup Required

None for Task 1 (no external service configuration required). Tasks 2/3 require a session where
Docker Desktop's backend is reachable — no other user action needed beyond that.

## Next Phase Readiness

- RSKN-05 is enforceable (Task 1 delivered), matching its already-`[x]` status in
  `REQUIREMENTS.md` (set by 51-02/51-03 when the conversions themselves landed) — this plan
  supplies the missing enforcement mechanism those earlier plans anticipated.
- Phase 51 (Total UI Re-skin)'s conversion work (51-01 through 51-06) is otherwise complete and
  gate-verified per-plan; the ONLY outstanding phase-51 obligation is this plan's Tasks 2/3
  (E2E regression proof + full-surface screenshot diff), which need a re-run once Docker is
  available.
- Not a blocker for starting other work: Tasks 2/3 are read-only verification, not source changes
  — no downstream plan's files are affected by leaving them unexecuted.
- `.planning/ui-reviews/2026-07-11T04-32-30-989Z/` (the before-baseline) is untouched and remains
  valid for the eventual after-capture diff.

---
*Phase: 51-total-ui-re-skin*
*Completed: 2026-07-11 (Task 1 only — Tasks 2/3 blocked, see Issues Encountered)*

## Self-Check: PASSED

`apps/web/src/app/__tests__/palette-ban.test.ts` confirmed present on disk; commit `150bfac`
confirmed present in `git log --oneline --all`. No other files were claimed as created/modified
in this plan (Tasks 2/3 produced no commits, honestly reflected above).

---

## Addendum (2026-07-11): App-wide glassmorphism-ban closure (UI-review-driven fix)

`51-UI-REVIEW.md` (Top Priority Fix #1) independently re-grepped the whole `apps/web/src` tree
and found `backdrop-blur` still live in 11 sites across 8 files that 51-01..51-06's per-plan
file-ownership fences never opened (each plan owned a named file list; these 8 files sat outside
every list, and `inbox-three-pane.tsx` was actively mis-labeled an "exemplar" in `51-UI-SPEC.md`,
so no plan ever inspected it). This addendum closes that gap.

**Hit list (11 sites, 8 files) — all converted:**

| File | Site(s) | Before | After |
|------|---------|--------|-------|
| `apps/web/src/app/_components/inbox-three-pane.tsx` | lines 88, 123, 137, 314 (FiltersRail, ReadingPreview empty state, ReadingPreview header, Inbox list header) | `bg-background/70 backdrop-blur-md` (line 123: `bg-background/70 ... backdrop-blur-md`) | `bg-background/95` |
| `apps/web/src/app/chat/page.tsx` | line 67 (conversation toolbar) | `bg-background/70 px-4 backdrop-blur-md` | `bg-background/95 px-4` |
| `apps/web/src/app/entity-types/page.tsx` | line 176 (master-list header) | `bg-background/70 px-3 backdrop-blur-md` | `bg-background/95 px-3` |
| `apps/web/src/app/entities/_components/entities-mosaic.tsx` | line 83 (MosaicCard) | `backdrop-blur-sm ...` ternary with `bg-card/80` | `border-border/50 ...` ternary with `bg-card/95` (backdrop-blur-sm dropped; `bg-tier-inferred/10` candidate-status tint left as-is — it's a status highlight, not a glass overlay) |
| `apps/web/src/app/entities/_components/entities-gallery.tsx` | line 251 (page header) | `bg-background/70 backdrop-blur-md border-border/50` | `bg-background/95 border-border/50` |
| `apps/web/src/app/chat/_canvas/chat-canvas.tsx` | line 733 ("Toggle minimap" button — the exact material-mismatch sibling the review called out next to the already-converted `ChatCanvasViewToggle`) | `size-11 bg-background/70 backdrop-blur-md` | `size-11 bg-background/95` |
| `apps/web/src/app/chat/_canvas/canvas-keyboard-hint.tsx` | line 28 (dismissible caption bar) | `bg-background/70 px-4 py-2 backdrop-blur-md` | `bg-background/95 px-4 py-2` |
| `apps/web/src/app/chat/_canvas/add-knowledge-preview-popover.tsx` | line 79 (popover trigger — the other material-mismatch sibling in the same toolbar row) | `size-11 bg-background/70 backdrop-blur-md` | `size-11 bg-background/95` |

Same solid-recipe idiom `51-04` used on `graph-toolbar.tsx`/`filter-rail.tsx`/`node-detail-pane.tsx`/
`taxonomy-banner.tsx`: translucent `bg-{token}/NN + backdrop-blur-*` → solid `bg-{token}/95`
(nearest existing token surface), backdrop-blur class removed entirely.

**Adjacent stale comment fixed:** `inbox-three-pane.tsx`'s file-level JSDoc described the
component as "a resizable, glassy three-pane Gmail-style inbox" — updated to drop "glassy" since
the file no longer has any glass material. Three other stale "frosted"/"glassy" doc-comment
mentions (`components/app-sidebar.tsx:106`, `app/layout.tsx:17`, `components/theme-provider.tsx:10`)
were investigated and left untouched — none of those files contain a `backdrop-blur` class today
(confirmed via grep), so they're pre-existing D-20/D-21-era documentation drift unrelated to this
fix's scope, not a site this task converted.

**Out of scope (not touched, none found):** `packages/genui/renderer/*` and `packages/ui` shared
primitives — grepped, zero `backdrop-blur` hits in either, so nothing needed leaving/reporting there.

**Gates re-run, all green:**
- `grep -rn "backdrop-blur" apps/web/src --include="*.tsx" --include="*.ts"` — zero hits (previously 11).
- `npx vitest run apps/web/src/app/__tests__/{palette-ban,token-contrast,token-registration}.test.ts` — 3 files, 12/12 tests pass.
- `npx tsc --noEmit` — zero errors outside the known pre-existing `apps/web/src/app/dev/design/**` module-resolution failures (unrelated `@nauta/ui` vs `@polytoken/ui` package-name drift in a dev-only preview gallery, not touched by this fix).

**Commit:** `9ee850c` — `fix(51): close app-wide glassmorphism ban — convert remaining backdrop-blur sites`

**Result:** `51-UI-REVIEW.md`'s Top Priority Fix #1 and Pillar 3 (Color) finding are now resolved.
The phase's "zero glassmorphism exceptions remain in the app" claim is now actually true
app-wide, not just within the 5 files the original burn-down table named. Pillar 2 (Visuals)
material-mismatch finding (de-glassed `ChatCanvasViewToggle` sitting next to frosted siblings in
the same toolbar row) is also resolved as a side effect — all three buttons in that row now share
the same solid material. `51-UI-SPEC.md`'s "Confirmed exemplars to imitate" table still incorrectly
lists `inbox-three-pane.tsx` as pre-converted; that spec-accuracy correction is out of scope for
this fix (spec document, not source code) and is flagged here for a future doc pass.

---

## Addendum (2026-07-12): §G.3 E2E regression suite — Task 2 completed (Docker now available)

Docker Desktop reached a ready state in this session (project_id=polytoken, all containers
healthy, migration 0036 applied) — the blocker documented above under "Issues Encountered" no
longer applies. This addendum executes the deferred Task 2 (E2E regression suite) that the
2026-07-11 session couldn't reach.

**Initial run** (`npx playwright test e2e/live-loop-green.spec.ts e2e/uat-39-tool-round.spec.ts
e2e/uat-41-knowledge-preview.spec.ts e2e/uat-43-auth.spec.ts e2e/uat-45-threads.spec.ts
e2e/uat-48-token-surfaces.spec.ts --reporter=line`) surfaced 7 failures (15 passed, 10
cascaded-skip): `live-loop-green.spec.ts` (chromium+firefox), `uat-41-knowledge-preview.spec.ts`
41.1 (chromium)/41.2 (firefox), `uat-43-auth.spec.ts` 43.2 (chromium), `uat-48-token-surfaces.spec.ts`
48.1 (chromium+firefox).

**Root-caused via `/gsd:debug`** (full investigation trail:
`.planning/debug/resolved/e2e-regressions-51-07.md`) — **all 7 failures were e2e test-suite
topology/contention bugs, ZERO were Phase 51/52/53/54 product regressions.** Bundling more spec
files into one shared-local-stack run than the 2026-07-11 baseline (notably Phase 54's new
`uat-45-threads.spec.ts`, adding 7 more `seedAuthenticatedContext` calls to the shared-seed-user
contention budget) exposed four distinct pre-existing test-infra races:

1. **Magic-link mint race** (`seed-session.ts`) — GoTrue invalidates a user's prior unconsumed
   magic-link token the instant a new one is minted for the same email; every spec file
   authenticates as the same `DEFAULT_SEED_EMAIL`, and file-level `serial` mode only prevented
   INTRA-file races, never inter-file ones. Fixed with bounded retry (5 attempts, jittered
   backoff) around `generateLink`+`verifyOtp`.
2. **Inbox default-select race** (`live-loop-green.spec.ts`) — relied on "most recent email"
   auto-selection instead of explicitly picking its own seeded thread; a sibling spec's
   concurrent DB insert could win the "most recent" slot mid-test (confirmed: it landed on
   `uat-45-threads.spec.ts`'s own fixture email). Fixed by explicitly clicking its own thread row
   first, mirroring `uat-45-threads.spec.ts`'s established pattern.
3. **Stale-role idempotency bug** (`uat-48-token-surfaces.spec.ts`) — the FIELD fixture
   component's `ON CONFLICT DO UPDATE` omitted `role` from its SET list, leaving a stale
   `role='entity'` value from an earlier DB state that could never self-correct (confirmed via
   direct DB query), producing a duplicate-labeled entity treeitem. Fixed by adding
   `role = 'field'` to the SET clause.
4. **Global sign-out cross-contamination** (`uat-43-auth.spec.ts`) — the app's real sign-out
   route calls `supabase.auth.signOut()` with the SDK's default `scope: "global"`, revoking
   every session for that user, not just its own context. Since every spec shares
   `DEFAULT_SEED_EMAIL`, running the 43.3 sign-out scenario globally signed out every other
   concurrently-running test mid-flight (confirmed via GoTrue auth logs showing clustered
   `session_not_found` 403s across multiple concurrent request_ids, and ruled out passive
   session-limiting via a standalone refresh-token isolation script). Fixed by giving 43.3 its
   own dedicated seed email — production sign-out semantics untouched (plausibly intentional
   security behavior, out of scope to change on a test-topology finding alone).

**Verification:** 2 consecutive full-suite re-runs, **32/32 passed both times** (up from 15
passed / 7 failed / 10 cascaded-skip). No assertion was weakened or skipped to fake a pass —
every fix addresses a confirmed root cause backed by direct evidence (DB queries, GoTrue auth
logs, a standalone refresh-token isolation script, and cross-referencing a wrongly-navigated URL
against a sibling spec's own fixture).

**Commit:** `dec6402` — `fix(51-07): resolve 7 E2E regression-run failures (test-infra races, not product bugs)`

**Files changed:** `apps/web/e2e/helpers/seed-session.ts`, `apps/web/e2e/live-loop-green.spec.ts`,
`apps/web/e2e/uat-43-auth.spec.ts`, `apps/web/e2e/uat-48-token-surfaces.spec.ts` — all e2e
test/fixture code; zero application source files touched.

**Task 3 (16-surface screenshot re-capture) remains open** — out of scope for this debug session
(a read-only visual-diff verification, not an E2E correctness question); still needs a dedicated
re-run per the "Issues Encountered" section above.
