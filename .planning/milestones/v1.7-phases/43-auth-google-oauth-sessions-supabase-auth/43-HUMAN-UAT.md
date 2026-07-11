---
status: complete
phase: 43-auth-google-oauth-sessions-supabase-auth
source: [43-VERIFICATION.md, 50-03-PLAN.md]
started: 2026-07-10T01:15:00Z
updated: 2026-07-11T07:30:00Z
---

## Current Test

[all scenarios dispositioned]

## Tests

### 1. Live Google OAuth round-trip
expected: After completing GOOGLE-OAUTH-RUNBOOK.md (create Google Cloud OAuth client, set SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET, restart local Supabase), clicking "Continue with Google" on /login completes the PKCE flow via /auth/callback and lands signed-in on the app.
result: moved-to-morning-checklist — real Google + a deployed app; not runnable locally. See `49-HUMAN-UAT.md` §1 (LIVE-03).

### 2. Session persistence across refresh
expected: After signing in, a full browser refresh (and a new tab) keeps the session — no redirect to /login; middleware refreshes the token transparently.
result: passed — `apps/web/e2e/uat-43-auth.spec.ts` ("UAT 43.2"), seeded session via `seed-session.ts`, run against the local live stack. Asserted `/` loads signed-in (Inbox nav link visible), survives a full `page.reload()`, and a SECOND page opened in the same browser context (`context.newPage()`) also loads signed-in without a fresh sign-in. 2/2 consecutive chromium runs green.

### 3. Sign-out loop end-to-end
expected: Sidebar sign-out button POSTs to /auth/signout, clears the session, and lands on /login; visiting any protected route afterward redirects back to /login.
result: passed — `apps/web/e2e/uat-43-auth.spec.ts` ("UAT 43.3"). Clicked the real sidebar "Sign out" button (a form POST to `/auth/signout`), asserted landing on `/login`, then re-visited `/` in the SAME context and asserted the redirect back to `/login` — proving the session was actually cleared server-side, not just a cosmetic `/login` landing. 2/2 consecutive chromium runs green.

### 4. Playwright auth-redirect smoke spec
expected: Once Playwright is installed (deferred — milestone's one-new-dependency budget spent on @supabase/ssr), `apps/web/e2e/auth-redirect.spec.ts` passes: signed-out visit to / redirects to /login.
result: passed — `apps/web/e2e/auth-redirect.spec.ts`, run unmodified alongside `uat-43-auth.spec.ts` (`npm run test:e2e -- uat-43-auth.spec.ts auth-redirect.spec.ts --project=chromium`). Signed-out visit to `/chat` redirects to `/login?redirectTo=%2Fchat`.

## Summary

total: 4
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0
moved-to-morning-checklist: 1

## Gaps

None locally provable — the one remaining scenario (live Google OAuth) requires a real Google account and the deployed app, tracked at `49-HUMAN-UAT.md` §1 (LIVE-03).
