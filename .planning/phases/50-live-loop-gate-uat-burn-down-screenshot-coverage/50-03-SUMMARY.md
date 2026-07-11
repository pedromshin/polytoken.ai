---
phase: 50-live-loop-gate-uat-burn-down-screenshot-coverage
plan: 03
subsystem: testing
tags: [playwright, supabase-auth, middleware, thread-grouping, inbox, gotrue-magiclink]

# Dependency graph
requires:
  - phase: 49-03
    provides: "apps/web/e2e/helpers/seed-session.ts — seedAuthenticatedContext, reused unmodified"
  - phase: 50-02
    provides: "Confirmed seeded-session + test.describe.configure({mode:'serial'}) pattern for GoTrue magiclink race avoidance within a single spec file"
provides:
  - "apps/web/e2e/uat-43-auth.spec.ts — DB/DOM-verified session-persistence (43.2) and sign-out-loop (43.3) spec"
  - "apps/web/e2e/uat-45-threads.spec.ts — DB/DOM-verified thread-grouping (45.1-45.4) + verification-code UI-visibility (45.7) spec"
  - "apps/web/e2e/helpers/uat-thread-fixtures.ts — seedThreadFixtures(userId), a reusable multi-message-thread + null-thread_id-singleton + verification-code-email fixture"
  - "LIVE-05's auth+threads slice CLOSED — all 11 backlog UAT scenarios in 43/45-HUMAN-UAT.md now dispositioned (8 passed, 3 moved-to-morning-checklist), none pending (LIVE-05 also spans 39/41/47/48-HUMAN-UAT.md, closed by 50-02/50-04, rolled up by 50-05)"
affects: [50-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "File-level test.describe.configure({ mode: 'serial' }) is REQUIRED in every spec that calls seedAuthenticatedContext more than once — GoTrue invalidates a user's prior magiclink token when a new one is generated for the SAME email, so concurrent seedAuthenticatedContext calls race with 'Email link is invalid or has expired'. This is a per-FILE fix only; two spec FILES that both seed the shared default user still race if run in the same Playwright invocation (documented limitation, not fixed this plan — see Issues Encountered)."
    - "Scope role='button' accessible-name locators to the literal HTML tag (page.locator('button').filter({hasText})) when a component renders BOTH a real <button> (disclosure trigger) and a div[role='button'] (selectable row) that can share identical text — e.g. a thread's collapsed summary row and its own latest member's InboxRow both display the same subject once expanded. getByRole('button', {name}) alone matches both and throws a strict-mode violation."
    - "Prefer asserting a deep-link's href attribute (e.g. the 'Open editor ->' link's href) over parsing rendered text to prove 'the reading preview now shows email X' — stronger, unambiguous, and avoids getByText matching both a container and its descendant span for the same substring."

key-files:
  created:
    - apps/web/e2e/uat-43-auth.spec.ts
    - apps/web/e2e/uat-45-threads.spec.ts
    - apps/web/e2e/helpers/uat-thread-fixtures.ts
  modified:
    - .planning/milestones/v1.7-phases/43-auth-google-oauth-sessions-supabase-auth/43-HUMAN-UAT.md
    - .planning/milestones/v1.7-phases/45-email-threads-forwarding-seam/45-HUMAN-UAT.md

key-decisions:
  - "45.7's disposition is SPLIT, not a single passed/deferred line: the UI-visibility half (a seeded verification code is visible via the inbox without DB access) passed locally against a synthetic fixture; the real-Gmail-verification-email-arrival half genuinely requires live SES and rides on Test 6 / 49-HUMAN-UAT.md Section 2 (LIVE-04). Recording this as one flat disposition would have either overclaimed (marking the whole scenario passed) or underclaimed (deferring a slice that was genuinely provable) — the plan's own must_haves explicitly called for this exact split."
  - "Discovered (documented, not worked around) that /emails/[id]'s editor renders plain-text body ONLY via a PDF/attachment preview pane — a plain-text fixture email with no attachment shows 'No document open' there, never the body text. The genuinely UI-visible surface for 45.7 is the inbox's own reading preview (right pane), not the editor page a literal reading of '45-HUMAN-UAT.md's wording ('inbox -> email detail') might suggest. This is recorded transparently in both the spec's own comments and 45-HUMAN-UAT.md rather than silently assumed or the editor page modified to add body rendering (out of scope for this plan)."
  - "Test 5 (Gmail-forward fixture realism) is dispositioned moved-to-morning-checklist WITHOUT a LIVE-0x cross-reference, unlike Test 6 — it is a standalone manual confirmation step the user performs directly against their own Gmail UI, not gated behind a tracked deploy/OAuth gate."

requirements-completed: []  # LIVE-05 spans 39/41/43/45/47/48-HUMAN-UAT.md across plans 50-02/03/04; this plan closes only the 43+45 slice — the requirement itself is marked complete by 50-05's roll-up once every slice is closed.

# Metrics
duration: ~47min
completed: 2026-07-11
---

# Phase 50 Plan 03: Live-Loop UAT Burn-Down (Auth + Threads) Summary

**Closed all 8 locally-provable Phase-43/45 UAT scenarios (session persistence, sign-out loop, thread grouping/expand/singleton/styling, verification-code visibility) via DB/DOM-verified seeded-session specs, and explicitly routed the 3 genuinely-external scenarios (live Google OAuth, real Gmail forward, live SES round-trip) to the morning checklist with cross-references — zero scenarios left silently pending.**

## Performance

- **Duration:** ~47 min
- **Started:** 2026-07-11T06:59:00Z (approx, following 50-02)
- **Completed:** 2026-07-11T07:46:00Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Closed all 3 locally-provable Phase-43 auth scenarios (43.2 session persistence across a full reload AND a second tab in the same browser context; 43.3 sign-out loop, proven via a REAL protected-route re-redirect after sign-out, not just a cosmetic `/login` landing; 43.4 delegated to the existing `auth-redirect.spec.ts`, run alongside rather than duplicated) against the local seeded-session stack — 43.1 (live Google OAuth) explicitly routed to the morning checklist
- Closed 5 of 7 Phase-45 thread/inbox scenarios (45.1 single grouped entry with count Badge + latest snippet; 45.2 expand -> member-select -> exact "Open editor ->" deep-link; 45.3 null-`thread_id` singleton renders with no chevron/badge; 45.4 Badge `variant="secondary"`/`text-muted-foreground` token-only styling; 45.7's UI-visibility slice) against a new deterministic thread fixture — 45.5/45.6 (real Gmail forward realism, live SES round-trip) explicitly routed to the morning checklist, 45.6 cross-referencing `49-HUMAN-UAT.md` Section 2 (LIVE-04)
- Both `43-HUMAN-UAT.md` and `45-HUMAN-UAT.md` moved from `partial` to `complete` — zero pending scenarios remain in either file
- Found and fixed (in the SAME session, before either task commit) a real Playwright locator strict-mode collision: a thread's collapsed summary `<button>` and its own latest member's `InboxRow` (`div[role=button]`) render identical subject text once expanded, so `getByRole('button', {name})` alone matched both — fixed by scoping to the literal `button` HTML tag

## Task Commits

Each task was committed atomically:

1. **Task 1: Phase-43 auth burn-down (43.2/43.3/43.4 pass, 43.1 -> morning)** - `7d0d2e6` (feat)
2. **Task 2: Phase-45 threads burn-down (45.1-45.4 + 45.7 UI slice pass, 45.5/45.6 -> morning)** - `7444cd8` (feat)

**Plan metadata:** (this commit, following SUMMARY/STATE/ROADMAP updates)

_Note: both tasks were `tdd="true"` per plan frontmatter; each closes with a real passing e2e spec against the live local stack rather than a separate RED/GREEN cycle, since the target behavior (session middleware, sign-out route, thread grouping) already existed in production code — the "test" IS the live-stack verification the plan calls for, matching 50-02's precedent._

## Files Created/Modified
- `apps/web/e2e/uat-43-auth.spec.ts` - Seeded-session spec: 43.2 (reload + new-tab persistence) and 43.3 (sign-out loop with a real protected-route re-redirect proof)
- `apps/web/e2e/uat-45-threads.spec.ts` - Seeded-session spec covering 45.1-45.4 (grouping/expand/singleton/styling) + 45.7's UI-visibility slice
- `apps/web/e2e/helpers/uat-thread-fixtures.ts` - `seedThreadFixtures(userId)`: idempotent 3-message thread, null-`thread_id` singleton, and synthetic verification-code email, own fixture-id namespace (`50030...`)
- `.planning/milestones/v1.7-phases/43-auth-google-oauth-sessions-supabase-auth/43-HUMAN-UAT.md` - status `partial` -> `complete`, 3/4 `passed`, 1/4 `moved-to-morning-checklist`
- `.planning/milestones/v1.7-phases/45-email-threads-forwarding-seam/45-HUMAN-UAT.md` - status `partial` -> `complete`, 5/7 `passed` (incl. 45.7's UI slice), 2/7 `moved-to-morning-checklist`

## Decisions Made
- Split 45.7's disposition rather than flattening it (see key-decisions above) — the plan's must_haves explicitly required this granularity
- Documented (not worked around) that `/emails/[id]`'s editor doesn't render plain-text body for attachment-less emails — used the inbox reading preview as the genuine UI-visibility surface for 45.7 instead
- Test 5 dispositioned as a standalone user confirmation step, no LIVE-0x cross-reference (unlike Test 6, which is gated behind the tracked SES apply)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] GoTrue magiclink race within uat-43-auth.spec.ts**
- **Found during:** Task 1, first run of `uat-43-auth.spec.ts`
- **Issue:** Both 43.2 and 43.3 tests call `seedAuthenticatedContext` for the SAME shared local seed user. Playwright's default `fullyParallel: true` ran them concurrently; GoTrue invalidates a user's prior magiclink token when a new one is generated for that user, so one test's `verifyOtp` failed with "Email link is invalid or has expired" depending on run order
- **Fix:** Added `test.describe.configure({ mode: "serial" })` at file scope — the same fix already established in `uat-41-knowledge-preview.spec.ts` (50-02)
- **Files modified:** `apps/web/e2e/uat-43-auth.spec.ts`
- **Verification:** 2 consecutive clean 3/3 runs post-fix (chromium)
- **Committed in:** `7d0d2e6` (Task 1 commit)

**2. [Rule 1 - Bug] Playwright locator strict-mode collision in uat-45-threads.spec.ts (test-file only)**
- **Found during:** Task 2, first run of `uat-45-threads.spec.ts`'s 45.2 test
- **Issue:** `InboxThreadGroup`'s collapsed summary row is a real `<button aria-expanded>`; a member row is an unmodified `InboxRow` (`div[role="button"]`). The thread fixture's LATEST member IS the row whose subject the summary button displays (by design — the summary shows the latest member's subject) — once the group is expanded, BOTH the summary `<button>` and the latest member's `InboxRow` carry the identical subject substring in their accessible name, so `page.getByRole("button", { name: regex })` resolved to 2 elements and threw a strict-mode violation on `toHaveAttribute("aria-expanded", "true")`
- **Fix:** Scoped the thread-summary locator to the literal HTML `button` tag (`page.locator("button").filter({ hasText: ... })`) instead of the ARIA role query — this can never match a `div[role="button"]`, resolving the ambiguity structurally rather than by adding an exclusion filter
- **Files modified:** `apps/web/e2e/uat-45-threads.spec.ts`
- **Verification:** 45.1/45.2/45.4 (all three uses of the thread-summary locator) pass consistently across 2 subsequent full-file runs
- **Committed in:** `7444cd8` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed, both test-file-only precision/concurrency fixes. No production code was touched this plan — every scenario's target behavior (session middleware, sign-out route, thread grouping/rendering) already existed and worked correctly; both fixes were in the NEW spec files this plan wrote, not pre-existing code.
**Impact on plan:** No scope creep. No production bugs found this plan (contrast with 50-02, which found and fixed a real `chat-canvas.tsx` bug) — Phase 43/45's auth and threads code held up correctly under live-stack DOM/DB verification.

## Issues Encountered
- **Documented, not fixed (pre-existing, out of scope):** running `uat-43-auth.spec.ts` and `uat-45-threads.spec.ts` TOGETHER in the same `playwright test` invocation re-triggers the same GoTrue magiclink race ACROSS files (each file's own `mode: "serial"` only serializes tests WITHIN that file; separate files still run in parallel workers by default). This is not new to this plan — every existing seeded-session spec (`live-loop-green.spec.ts`, `uat-39-tool-round.spec.ts`, `uat-41-knowledge-preview.spec.ts`, and now these two) defaults to the SAME shared seed email via `seed-session.ts`, so the same cross-file race exists for ANY two of them run together. This plan's own acceptance criteria only requires each task's spec(s) to pass in isolation (exactly as specified in the plan's `<verify>` blocks), which both do, reproducibly (3 consecutive green runs each). Fixing this properly (e.g., per-spec-file email variants, or a global `workers: 1` for e2e) is an architecture-level change to the shared seeding helper affecting every existing spec — filed as an observation here rather than a todo, since it does not block this plan and a broader fix belongs to whichever plan next touches `seed-session.ts` or the Playwright config.

## User Setup Required

None - no external service configuration required. All scenarios ran against the local stack (Supabase local + Next.js dev server, both already running from the prior plan's session), no hosted target was ever addressed.

## Next Phase Readiness
- LIVE-05's auth+threads slice is fully closed: 8 of 11 backlog scenarios (43x3 + 45x5, incl. 45.7's UI half) have a DB/DOM-verified `passed` disposition; the remaining 3 (43.1, 45.5, 45.6) are explicitly `moved-to-morning-checklist` with cross-references, feeding directly into 50-05's `50-UAT-BURNDOWN.md` roll-up. LIVE-05 itself stays Pending until 50-04 (47/48) closes its slice too.
- The cross-file GoTrue magiclink race (Issues Encountered) is worth a future todo if the e2e suite ever needs `npm run test:e2e` (no file args, i.e. the FULL suite) to be reliably green in one shot — today every seeded-session spec file must be run in isolation or accept flakiness.
- `apps/web/e2e/helpers/uat-thread-fixtures.ts`'s `seedThreadFixtures` is reusable by any future thread-surface test (e.g. a Band-3 E3 thread-card canvas spec) without re-deriving the fixture shape.

---
*Phase: 50-live-loop-gate-uat-burn-down-screenshot-coverage*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 5 claimed files verified present on disk; both task commit hashes (`7d0d2e6`, `7444cd8`) verified present in git history.
