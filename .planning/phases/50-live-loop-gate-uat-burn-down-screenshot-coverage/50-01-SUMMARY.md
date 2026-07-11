---
phase: 50-live-loop-gate-uat-burn-down-screenshot-coverage
plan: 01
subsystem: testing
tags: [playwright, supabase-ssr, gotrue, pg, screenshot-review, e2e]

# Dependency graph
requires:
  - phase: 49-03
    provides: "apps/web/e2e/helpers/seed-session.ts — seedAuthenticatedContext, GoTrue admin magiclink + verifyOtp session minting, reused here unmodified"
provides:
  - "apps/web/e2e/helpers/screenshot-fixtures.ts — seedEmailFixture(userId), a reusable DB fixture-seed helper for /emails/[id] captures"
  - "screenshot-review.spec.ts's isLocalTarget(baseURL, supabaseUrl) guard — reusable local-only pattern for any future harness that needs a seeded session"
  - "A fresh .planning/ui-reviews/<timestamp>/ run with authenticated captures for every surface, used as visual evidence baseline for 50-04 and Phase 51 re-skin"
  - "LIVE-06 requirement CLOSED — todo W-1 closed"
affects: [50-04, 51]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isLocalTarget(baseURL, supabaseUrl) fail-closed host-allowlist guard (T-50-01): any unparseable URL or non-localhost/127.0.0.1 host returns false, so a service_role-minted session can never reach a hosted target even on an unexpected error path"
    - "Own fixture-id constants per spec file (screenshot-fixtures.ts's thread/email UUIDs are distinct from live-loop-green.spec.ts's) so two specs seeding fixtures for the same local DB never collide on ON CONFLICT(id) DO UPDATE"

key-files:
  created:
    - apps/web/e2e/helpers/screenshot-fixtures.ts
  modified:
    - apps/web/e2e/screenshot-review.spec.ts

key-decisions:
  - "seedEmailFixture's to_addresses field looks up the seeded user's real auth.users email (not the fixture sender's address) so the rendered /emails/[id] card reads realistically (\"To: pedromaschio.shin@gmail.com\") rather than an inverted/nonsensical To: line — a small correctness improvement over a literal minimal reading of the interface spec, which only specified the userId parameter"
  - "Did not run scripts/preflight-local.ps1 before Task 2 — the script's Step 1 kills all python/uvicorn/node processes, which would have killed the already-running npm run dev (9h uptime) for no benefit. Verified DB-green state directly instead (has_table_privilege = t, 25 public tables, seed user present), matching docs/RUN-LOCAL.md's own 'trust the DB, not the terminal' discipline without unnecessary disruption to an already-green stack"
  - "The FastAPI listener (port 8000) was NOT started for this plan — none of the eight captured surfaces (login, inbox, chat, knowledge, studio, forwarding, emails) depend on it; the web app reads/writes Supabase directly and the fixture rows are DB-inserted, not routed through the listener's inbound-email pipeline"

requirements-completed: [LIVE-06]

# Metrics
duration: ~25min
completed: 2026-07-11
---

# Phase 50 Plan 01: Screenshot Harness — /emails/[id] + Seeded-Session Auth Summary

**Extended the 47-05 screenshot-review harness with a local-only seeded-session guard (`isLocalTarget`) and a DB-fixture-backed `/emails/[id]` surface — a live run now captures all 8 surfaces (16 PNGs + 2 studio pack variants) as real authenticated pixels instead of `/login` redirects.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-11T04:10:00Z (approx)
- **Completed:** 2026-07-11T04:35:23Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `apps/web/e2e/helpers/screenshot-fixtures.ts` (114 lines) exports `seedEmailFixture(userId)`, which idempotently upserts a fixed-id thread + parsed email owned by the seeded user's own importer (mirroring `live-loop-green.spec.ts`'s proven fixture-seed pattern, but with its own distinct fixture UUIDs so the two specs never collide when run back-to-back). It looks up the seed user's real `auth.users` email for the `to_addresses` field so the rendered email card reads realistically, and throws a clear, secret-free error if the user owns no importer.
- `screenshot-review.spec.ts` gained an exported `isLocalTarget(baseURL, supabaseUrl)` guard (T-50-01) that returns true ONLY when both hosts are `localhost`/`127.0.0.1`, fails closed on any parse error, and gates `seedAuthenticatedContext` + `seedEmailFixture` — a non-local target keeps the original unauthenticated, no-cookie-injection best-effort capture behavior byte-for-byte.
- SURFACES is now built dynamically: the base six D-47-05 surfaces plus `{ name: "emails", path: "/emails/" + fixture.emailId }`, added ONLY when seeding succeeded (never a hardcoded `/emails/[id]` literal).
- `writeIndex`'s header note now branches on whether auth was seeded, documenting the T-50-01 supersession of the T-47-11 "never fake a session" note for the local case (still true for non-local, unchanged).
- **Ran the harness live** against the already-running local stack (Supabase 9h up under `project_id=polytoken`, DB-verified green via `has_table_privilege`/table-count checks, `npm run dev` already serving `localhost:3000`) via `npm run screenshot:review -w @polytoken/web` — passed on the first attempt (36.2s), no fixes needed. Produced `.planning/ui-reviews/2026-07-11T04-32-30-989Z/` with `index.md` showing **`captured` for every surface** (login, inbox, chat, knowledge, studio ×2 packs, forwarding, emails — 16 total rows), zero `redirected to /login` rows. `emails-desktop.png` (48KB) and `emails-mobile.png` (38KB) both exist and, visually confirmed, show the real seeded subject ("Screenshot review fixture: Q3 renewal quote") and `parsed` status badge on the email-detail canvas — not a not-found/blank page. `inbox-desktop.png` visually confirms both this plan's fixture and 49-03's `LIVE-01 fixture: Invoice for Q3 shipment` row, each addressed `To: pedromaschio.shin@gmail.com`.
- **LIVE-06 marked Complete** — todo W-1 closed.

## Task Commits

1. **Task 1: Add /emails/[id] surface + seeded email fixture, wire the seeded session with a local-only guard** - `0d4da3a` (feat)
2. **Task 2: Run the harness live against the local stack, capture authenticated surfaces, verify the run** - no commit (harness passed clean on the first live run; no code changes required — see below)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/e2e/helpers/screenshot-fixtures.ts` - `seedEmailFixture(userId)`: DB fixture-seed helper for the `/emails/[id]` surface
- `apps/web/e2e/screenshot-review.spec.ts` - Added `isLocalTarget` guard, wired seeded session + fixture behind it, dynamic SURFACES, auth-aware `writeIndex` header

## Decisions Made
- `to_addresses` on the seeded fixture email uses the seed user's real `auth.users.email` (looked up inside `seedEmailFixture`), not the fixture sender's address — makes the rendered card's "To:" line read correctly without expanding the helper's public interface (still just `seedEmailFixture(userId)`).
- Skipped running `scripts/preflight-local.ps1` for Task 2 because it kills all python/uvicorn/node processes (would have torn down the 9h-uptime `npm run dev` for zero benefit) — instead verified DB-green state directly (`has_table_privilege('service_role','public.chat_conversations','SELECT') = t`, 25 tables in `public`, seed user present in `auth.users`), which is exactly the same DB-based check the script itself runs as its PASS/FAIL gate.
- Did not start the FastAPI listener (port 8000, not running this session) — none of the 8 captured surfaces route through it; all fixture data is DB-inserted directly, matching how `live-loop-green.spec.ts` also only needs the listener for its own out-of-scope inbound-pipeline assertions (not exercised here).

## Deviations from Plan

None - plan executed exactly as written. No auto-fixes were needed; the harness passed on the first live run (contrast with 49-03, which needed two Rule-1 fixes on its first live runs).

## Issues Encountered
- The `e2e/**` directory is excluded from `apps/web/tsconfig.json`'s program (same pre-existing gap 49-03 documented), so the plan's literal Task 1 verify command is a no-op by design. Used the same scratch-tsconfig workaround 49-03 established: a temporary `tsconfig.e2e-check.json` (extends the real config, includes only `e2e/**/*.ts`) ran clean with zero errors on both changed files, then was deleted before committing — never part of the deliverable set.
- `.planning/ui-reviews/<timestamp>/` directories (this run's and the pre-existing `2026-07-10T18-39-30-080Z`/others) are left untracked, matching the repo's established convention: `.planning/ui-reviews/.gitignore` excludes all image formats, and historically only curated `docs(NN-MM): before/after visual evidence` artifacts under `.planning/phases/**` have been committed (e.g. `7229c60`, `d709176`) — not raw timestamped harness-run directories. No action taken; this plan's produced run directory is recorded below for 50-04 to reference directly from the working tree.

## User Setup Required

None - this plan reads only already-present local env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POSTGRES_URL_NON_POOLING`, all already in root `.env.local` per 49-01/49-03), and required no new secrets or external service configuration.

## Next Phase Readiness
- LIVE-06 is CLOSED — the screenshot harness now covers all 7 named surfaces (8 counting the `emails` addition) with authenticated capture on any local target, and remains provably local-only (T-50-01, fail-closed).
- **Evidence baseline for 50-04 and Phase 51:** `.planning/ui-reviews/2026-07-11T04-32-30-989Z/` is this plan's produced run — `index.md` plus 16 PNGs (all `captured`, none redirected). This is the freshest full-surface authenticated capture set in the repo and should be the reference point for both the UAT burn-down (50-04) and the re-skin phase's before/after comparisons (Phase 51).
- The harness is re-runnable any time the local stack is up (`npm run screenshot:review -w @polytoken/web`), producing a fresh timestamped run each time — no manual seeding step required, both `seedAuthenticatedContext` and `seedEmailFixture` are fully idempotent.
- Minor known side effect (shared with 49-03): each run's `seedAuthenticatedContext` call is idempotent (`createUser` "already exists" → success), and `seedEmailFixture`'s upserts never grow duplicate rows — but this plan's fixture email now permanently exists in the local inbox alongside 49-03's, visible in every future inbox/chat capture. Harmless for local dev; not addressed (no cleanup step was specified).

---
*Phase: 50-live-loop-gate-uat-burn-down-screenshot-coverage*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/web/e2e/helpers/screenshot-fixtures.ts
- FOUND: apps/web/e2e/screenshot-review.spec.ts
- FOUND: .planning/ui-reviews/2026-07-11T04-32-30-989Z/index.md
- FOUND: .planning/ui-reviews/2026-07-11T04-32-30-989Z/emails-desktop.png
- FOUND: 0d4da3a (Task 1 commit)
