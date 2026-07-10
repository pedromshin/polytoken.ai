---
phase: 45-email-threads-forwarding-seam
plan: 04
subsystem: ui
tags: [trpc, drizzle, react, tanstack-query, threads, inbox]

# Dependency graph
requires:
  - phase: 45-email-threads-forwarding-seam
    plan: 01
    provides: "threads table + emails.thread_id FK (SET NULL) — the grouping key this projection reads"
  - phase: 45-email-threads-forwarding-seam
    plan: 03
    provides: "ThreadResolver live at ingest + idempotent backfill executed locally (16 emails -> 9 threads) — real thread data to group"
  - phase: 44-tenancy-user-id-scoping-enforced-isolation
    plan: 05
    provides: "emailsRouter on protectedProcedure + userOwnedImporterIds/resolveListScope — reused verbatim by listThreads"
provides:
  - "emails.listThreads tRPC procedure — thread-grouped inbox projection, tenant-scoped identically to emails.list"
  - "groupEmailsIntoThreads pure helper (list-threads.ts) — DB-free, unit-testable thread aggregation"
  - "resolveListScope extracted to list-scope.ts, re-exported from index.ts (shared by list + listThreads)"
  - "45-UI-SPEC.md — the thread-grouped inbox design contract"
  - "InboxThreadGroup component — expandable thread-entry row"
  - "45-HUMAN-UAT.md — pending visual verification items (auth-gated, blocked on Phase 43's live OAuth)"
affects: [E3-next-epoch, v1.8-reskin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetch-flat-rows-then-aggregate-in-a-pure-helper (same idiom as aggregateEntitySummary in entity-summary.ts): listThreads selects one row per scoped email, then groupEmailsIntoThreads (list-threads.ts) collapses them into thread entries — DB-free, exhaustively unit-testable without a live-DB fake-chain fixture for the aggregation logic itself"
    - "Circular-import-avoidance via extraction: resolveListScope moved out of index.ts into list-scope.ts so both index.ts's `list` and list-threads.ts's `listThreads` can import it without index.ts <-> list-threads.ts forming a cycle; re-exported from index.ts so existing test imports (`from '../index'`) keep working unchanged"
    - "Client-side supplemental full-row lookup: emails.listThreads returns grouping metadata (subject/count/snippet/date + member ids) but not per-member sender/recipient fields; inbox-three-pane.tsx runs a SECOND bounded emails.list fetch (EMAIL_LOOKUP_LIMIT=100, same cap as entitySummary) to resolve InboxRow's required shape for both expanded/singleton member rows and the reading preview — a documented v1 limitation for mailboxes exceeding the cap (45-UI-SPEC 'Non-goals')"

key-files:
  created:
    - .planning/phases/45-email-threads-forwarding-seam/45-UI-SPEC.md
    - .planning/phases/45-email-threads-forwarding-seam/45-HUMAN-UAT.md
    - packages/api-client/src/router/emails/list-scope.ts
    - packages/api-client/src/router/emails/list-threads.ts
    - packages/api-client/src/router/emails/__tests__/thread-grouping.test.ts
    - apps/web/src/app/_components/inbox-thread-group.tsx
  modified:
    - packages/api-client/src/router/emails/index.ts
    - apps/web/src/app/page.tsx
    - apps/web/src/app/_components/inbox-three-pane.tsx

key-decisions:
  - "listThreads scans all of the caller's scoped emails (ordered newest-first, capped at MAX_SCAN_ROWS=5000) rather than doing full SQL-side window-function aggregation with DB-level LIMIT/OFFSET over threads — grouping/pagination happens in the pure groupEmailsIntoThreads helper instead. This mirrors the codebase's established 'fetch flat scoped rows, aggregate in a pure JS helper' idiom (aggregateEntitySummary) and is the right tradeoff at this phase's local/personal-use scale; a future high-volume mailbox would need SQL-side aggregation, flagged as a follow-up, not attempted here (out of this plan's scope per 45-CONTEXT.md's anti-scope-creep instruction)"
  - "Entry subject = the LATEST member email's subject (not threads.subject, the resolver's stored original/normalized subject) — matches the plan's literal action text ('the latest email's subject... as the entry snippet') and reflects the live conversation (e.g. 'Re: X') rather than the thread's origin subject; threads.subject was never joined/read by this projection"
  - "inbox-row.tsx left byte-identical — despite being named in the plan's files_modified, no structural change was needed: its existing InboxEmail shape already covers member-row rendering (indentation is applied by a wrapping div in InboxThreadGroup, not by modifying InboxRow itself), keeping the row component's contract, and the risk surface, unchanged"
  - "THRD-03 marked Complete in REQUIREMENTS.md — the requirement text ('User can see emails grouped by thread in the inbox list') is code-genuinely satisfied (projection + UI shipped, tsc clean, dev server confirmed serving without errors) and only the human VISUAL confirmation remains, which is blocked on a DIFFERENT phase's pending item (Phase 43's live Google OAuth sign-in, 43-HUMAN-UAT.md Test 1) rather than anything in this plan's own scope. This mirrors the exact precedent Phase 43 itself set: marked Complete with 4 live-OAuth UAT items deferred to its own HUMAN-UAT.md"

patterns-established:
  - "Two-query inbox hydration for grouped lists: a cheap grouping-metadata query (listThreads) drives pagination/filtering, and a separate bounded full-row lookup (emails.list) hydrates only what the UI needs to actually paint — avoids re-deriving row-shape logic twice in the backend while keeping the grouping query itself lean"

requirements-completed: [THRD-03]

# Metrics
duration: ~28min
completed: 2026-07-10
---

# Phase 45 Plan 04: Thread-Grouped Inbox UI Summary

**`emails.listThreads` tRPC projection (tenant-scoped identically to `emails.list`, pure `groupEmailsIntoThreads` aggregation) backs a new expandable `InboxThreadGroup` inbox row — the milestone's one real UI change, governed by a written `45-UI-SPEC.md` contract, with the existing `/emails/[id]` detail view left untouched.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-07-10T09:00:00Z (approx.)
- **Completed:** 2026-07-10T09:24:35Z
- **Tasks:** 3 (2 auto + 1 checkpoint, auto-approved per the autonomous run mandate)
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- `45-UI-SPEC.md`: the thread-grouped inbox design contract — thread-entry anatomy (subject + count Badge + latest snippet/date), the expand/collapse interaction (singleton threads render flat, count>1 threads disclose via local `useState`), the "existing detail view untouched" boundary, and the explicit minimal-v1.4-tokens rationale (zero new npm dependencies).
- `emails.listThreads` (`packages/api-client/src/router/emails/list-threads.ts`): reuses `userOwnedImporterIds` + `resolveListScope` verbatim (T-45-04-01), scans the caller's scoped emails newest-first (capped at `MAX_SCAN_ROWS=5000` — a Rule 2 DoS addition), and collapses them via the pure `groupEmailsIntoThreads` helper — `emails.thread_id` is the grouping key, COALESCEd to a per-email singleton key (`email:{id}`) when null so pre-backfill orphans still list. `memberEmailIds` returned most-recent-first, capped at `MEMBER_EMAIL_ID_CAP=50` (T-45-04-02).
- `resolveListScope` extracted from `index.ts` into `list-scope.ts` (avoiding a circular import between `index.ts` and the new `list-threads.ts`) and re-exported from `index.ts` unchanged — the existing `emails-user-scoping.test.ts` import path (`from "../index"`) needed zero changes.
- 8 new tests (`thread-grouping.test.ts`): pure-helper collapse/count/latest-snippet (Test 1), null-thread singleton (Test 2), ordering (Test 3), member cap (Test 4); router-level session gate (Test 5), owner-less empty page + zero queries (Test 6), cross-tenant importerId rejection (Test 7), owned-filter grouping (Test 8). Full `packages/api-client` suite: 342/342 passing (was 334 baseline + 8 new).
- Web: `page.tsx` seeds from `emails.listThreads`; `inbox-three-pane.tsx` renders `InboxThreadItem` groups via the new `InboxThreadGroup` component (count-1 threads render as a flat, unmodified `InboxRow`; count>1 threads expand to reveal members through the same unmodified `InboxRow`); a bounded supplemental `emails.list` fetch (`EMAIL_LOOKUP_LIMIT=100`) resolves the full sender/subject/date rows `listThreads`'s grouping metadata doesn't carry, feeding both member rows and the reading preview; the "With entities" filter now checks whether ANY member of a thread carries extracted entities; default selection is the first thread's latest member.
- `apps/web/src/app/emails/[id]` (the detail/editor) is byte-identical — confirmed via `git diff --stat` showing zero changes in that path.
- `npx tsc --noEmit` clean in both `packages/api-client` and `apps/web` (the only errors present are the pre-existing `src/app/dev/design` baseline, unrelated untracked files per this session's project notes). `packages/api-client`'s `dist/` was rebuilt (`npm run build`) so `apps/web`'s type-resolution against `@polytoken/api-client`'s published `.d.ts` picked up the new `listThreads` procedure — `dist/` is gitignored, not a tracked change.
- Automated best-effort verification of the checkpoint: started `npm run dev` (port 3002, auto-selected — 3000 was in use), confirmed `GET /login -> 200` and `GET / -> 307 -> /login?redirectTo=%2F` with zero server errors in the dev log — the app is runtime-healthy with these changes. Full visual confirmation of the grouped inbox itself requires a signed-in session, which is blocked on Phase 43's still-pending live Google OAuth setup (not this plan's scope) — recorded as 4 pending items in `45-HUMAN-UAT.md`.
- `THRD-03` marked Complete in `REQUIREMENTS.md` (see key-decisions).

## Task Commits

Each task was committed atomically:

1. **Task 1: UI-SPEC contract + thread-grouped tRPC projection** - `535abec` (feat)
2. **Task 2: Web inbox renders expandable thread groups** - `731ca5e` (feat)
3. **Task 3: Human visual verification checkpoint** — auto-approved per the autonomous run mandate; no code changes (pure verification task). Pending visual items recorded in `45-HUMAN-UAT.md` (this commit, alongside plan metadata).

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `.planning/phases/45-email-threads-forwarding-seam/45-UI-SPEC.md` - Thread-grouped inbox design contract
- `.planning/phases/45-email-threads-forwarding-seam/45-HUMAN-UAT.md` - Pending visual verification items (auth-gated)
- `packages/api-client/src/router/emails/list-scope.ts` - `resolveListScope` (extracted from index.ts)
- `packages/api-client/src/router/emails/list-threads.ts` - `emails.listThreads` procedure + `groupEmailsIntoThreads` pure helper
- `packages/api-client/src/router/emails/__tests__/thread-grouping.test.ts` - 8 tests (pure helper + router wiring/tenancy)
- `packages/api-client/src/router/emails/index.ts` - Spreads in `emailThreadListProcedures`; re-exports `resolveListScope`
- `apps/web/src/app/_components/inbox-thread-group.tsx` - Expandable thread-entry component
- `apps/web/src/app/page.tsx` - Seeds from `emails.listThreads`
- `apps/web/src/app/_components/inbox-three-pane.tsx` - Renders thread groups; supplemental email-row lookup; adapted filters/selection/load-more

## Decisions Made

See key-decisions in frontmatter. Summary: (1) JS-side aggregation over a capped flat scan instead of SQL-side windowed aggregation — right tradeoff at this phase's scale; (2) entry subject sourced from the latest member (not `threads.subject`) per the plan's literal text; (3) `inbox-row.tsx` needed zero changes; (4) THRD-03 marked Complete, mirroring the Phase 43 precedent for a code-complete feature with a deferred cross-phase-blocked visual UAT item.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `MAX_SCAN_ROWS` DoS ceiling on the underlying email scan**
- **Found during:** Task 1, designing `listThreads`'s query
- **Issue:** The plan's own threat model (T-45-04-02) caps `memberEmailIds` per thread but doesn't address the underlying row scan itself — an owner with an extremely large mailbox could still trigger an unbounded `SELECT` before grouping.
- **Fix:** Added `MAX_SCAN_ROWS = 5000` (newest-first, so the cap drops the oldest emails first, never the most relevant ones) as a generous ceiling appropriate to this phase's local/personal-use scale.
- **Files modified:** `packages/api-client/src/router/emails/list-threads.ts`
- **Verification:** `npx tsc --noEmit` clean; covered implicitly by the existing scoping tests (the cap doesn't change behavior at the current ~16-email local scale).
- **Committed in:** `535abec` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — a DoS-mitigation extension of the plan's own threat-model concern, not a scope change).
**Impact on plan:** Defensive addition only; no behavioral change at current scale, no scope creep.

## Issues Encountered

- **`apps/web`'s typecheck initially failed to see `emails.listThreads`** — `@polytoken/api-client`'s package.json resolves TS types through `./dist/index.d.ts`, and `dist/` was stale (pre-dated this plan's new procedure). Fixed by running `npm run build` in `packages/api-client` to regenerate `dist/`. Not a deviation (no plan/behavior change) — a build-order note for future plans touching `packages/api-client`'s public surface: rebuild `dist/` before typechecking `apps/web` against it. `dist/` is gitignored, so this produced no tracked file changes.
- **`npm run lint` in `apps/web` fails with an interactive ESLint-config prompt** — confirmed via `git log` that no ESLint config file (`.eslintrc*` / `eslint.config.*`) has EVER existed in this repo's history; `next lint` prompts for first-time setup. This is a pre-existing, repo-wide gap unrelated to this plan's changes (scope boundary — not auto-fixed). `npx tsc --noEmit` (clean) and the full apps/web vitest suite (294/294 passing) stood in as the automated correctness gate for this plan's UI changes.

## User Setup Required

None - no new external service configuration required. (Live Google OAuth sign-in remains the user's pending action from Phase 43, tracked in `43-HUMAN-UAT.md` — not introduced or changed by this plan.)

## Next Phase Readiness

- Phase 45 (Email Threads + Forwarding Seam) is now fully executed: Plans 01, 02, 03, 04, 05, 06 all complete. THRD-01/THRD-03/THRD-04 Complete; THRD-02 remains Pending per 45-02's own decision (fallback-tier code is live and operationally proven against a real local fixture, but was never this plan's own frontmatter requirement — a phase-verifier judgment call, same precedent as 45-01/45-02/45-03).
- `45-HUMAN-UAT.md` carries 4 pending visual-verification items, blocked on Phase 43's live Google OAuth setup (a cross-phase, user-owned action) — not a blocker for phase completion given this milestone's established precedent (Phase 43 itself shipped Complete with deferred live-OAuth UAT).
- E3 (thread cards on canvas, next epoch) can now consume a real, UI-proven thread model — `emails.listThreads`'s shape (`ThreadListEntry`) is a clean starting contract, though E3 will likely want its own canvas-specific projection rather than reusing this inbox-shaped one directly.
- v1.8 (brand/design re-skin) will restyle `InboxThreadGroup` along with the rest of the inbox — this plan's minimal-tokens posture (documented in `45-UI-SPEC.md`) is the known, intentional starting point.

## Self-Check: PASSED

- Created files verified on disk: `.planning/phases/45-email-threads-forwarding-seam/45-UI-SPEC.md`, `45-HUMAN-UAT.md`, `packages/api-client/src/router/emails/list-scope.ts`, `list-threads.ts`, `__tests__/thread-grouping.test.ts`, `apps/web/src/app/_components/inbox-thread-group.tsx` — all FOUND
- Commits verified in `git log --oneline`: `535abec`, `731ca5e` — both FOUND
- Re-ran plan-level `<verification>`:
  - `cd packages/api-client && npx tsc --noEmit` — clean
  - `cd packages/api-client && npm run test -- thread-grouping` — 8/8 passed
  - `cd packages/api-client && npx vitest run` (full suite) — 342/342 passed
  - `cd apps/web && npx tsc --noEmit` — clean outside the pre-existing `dev/design` baseline
  - `cd apps/web && npm run test` (full suite) — 294/294 passed
  - `git diff --stat -- apps/web/src/app/emails` — empty (detail view untouched)
  - `npm run dev` (apps/web) — compiled clean, `GET /login -> 200`, `GET / -> 307 /login?redirectTo=%2F`, zero server errors
- Acceptance criteria re-verified for both auto tasks: UI-SPEC anatomy/interaction/boundary/rationale present; `listThreads` reuses `userOwnedImporterIds`/`resolveListScope`; tests prove collapse/singleton/isolation/ordering; page.tsx seeds from `listThreads`; middle pane renders thread groups expandable to members; `emails/[id]` untouched.

---
*Phase: 45-email-threads-forwarding-seam*
*Completed: 2026-07-10*
