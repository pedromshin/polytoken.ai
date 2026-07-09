---
phase: 43-auth-google-oauth-sessions-supabase-auth
plan: 02
subsystem: web-auth
tags: [nextjs, middleware, supabase, oauth, google, route-protection, open-redirect]

# Dependency graph
requires:
  - phase: 43-01
    provides: "@supabase/ssr client helpers (client.ts/server.ts/middleware.ts's updateSession) + Zod env validation"
provides:
  - "apps/web/src/middleware.ts — session-refresh + route-guard middleware wired to resolveAuthRedirect"
  - "apps/web/src/lib/auth/redirect.ts — pure, unit-tested safeNextPath + resolveAuthRedirect (the sole open-redirect defense, reused by both middleware and the callback route)"
  - "/login — minimal Google-only sign-in card"
  - "/auth/callback — PKCE code exchange with validated return-to redirect"
  - "/auth/signout — server-side signOut clearing httpOnly cookies"
  - "Sidebar sign-out affordance (SidebarFooter, beneath ThemeToggle)"
affects: [43-03-trpc-context-identity, 43-04-fastapi-identity-forwarding, 43-05-user-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure redirect-decision module (safeNextPath/resolveAuthRedirect) as the single open-redirect defense, imported by both middleware.ts and auth/callback/route.ts — decided once, used twice"
    - "Server-side-only sign-out (form POST to a route handler) instead of a client signOut() call, so httpOnly cookies are guaranteed cleared"

key-files:
  created:
    - apps/web/src/lib/auth/redirect.ts
    - apps/web/src/lib/auth/redirect.test.ts
    - apps/web/src/middleware.ts
    - apps/web/src/app/login/page.tsx
    - apps/web/src/app/login/_components/google-signin-button.tsx
    - apps/web/src/app/auth/callback/route.ts
    - apps/web/src/app/auth/signout/route.ts
    - apps/web/src/components/sign-out-button.tsx
  modified:
    - apps/web/src/components/app-sidebar.tsx

key-decisions:
  - "middleware.ts placed at apps/web/src/middleware.ts, NOT apps/web/middleware.ts as the plan's frontmatter stated — verified against this repo's installed Next 15.3.3 source (next/dist/build/index.js and next/dist/server/lib/router-utils/setup-dev-bundler.js both resolve the middleware file at path.join(pagesDir || appDir, '..'), which is src/ here since app router lives at src/app). A root-level file would have been silently never loaded, making the entire route-guard inert."
  - "safeNextPath also rejects a backslash-disguised authority (/\\host, which some browsers normalize to //host for special schemes) beyond the plan's literal // and absolute-URL cases — defense-in-depth on the same T-43-P2-01 mitigation, verified not to break any of the 8 required behavior-block cases"
  - "Sign-out is form-POST-only (no client-side supabase.auth.signOut() call) — the server route is the single place the session is cleared, avoiding any risk of a client-only sign-out leaving httpOnly cookies intact"

patterns-established:
  - "Route-guard + open-redirect decisions live in a pure, dependency-free module unit-tested without a request object — any future redirect-target validation in this app should extend safeNextPath rather than duplicate the check"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: ~12min
completed: 2026-07-09
---

# Phase 43 Plan 02: Google OAuth Sign-In, Session Middleware & Sign-Out Summary

**Next.js middleware refreshes and guards every app route via a pure, unit-tested `resolveAuthRedirect`/`safeNextPath` pair; a Google-only `/login` card and `/auth/callback` complete the PKCE sign-in loop; a form-POST `/auth/signout` route and sidebar button close it.**

## Performance

- **Duration:** ~12 min (git history spans 2026-07-09T20:27:46 to 20:38:33; continuation of a prior interrupted run whose Task 2/3 files existed on disk but uncommitted, and whose Task 1 middleware placement had a load-bearing bug this run found and fixed)
- **Started:** 2026-07-09T20:27:46-03:00
- **Completed:** 2026-07-09T20:38:33-03:00
- **Tasks:** 3 completed
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- `apps/web/src/lib/auth/redirect.ts` — two pure functions, `safeNextPath` and `resolveAuthRedirect`, covering all 8 behavior-block cases from the plan (open-redirect refusal for `//host`, absolute URLs, and missing values; route-guard pass-through for authenticated users and `/login`/`/auth/*` paths). 8/8 unit tests green via `npx vitest run src/lib/auth/redirect.test.ts`.
- `apps/web/src/middleware.ts` — calls Plan 01's `updateSession(request)` to refresh cookies and get the server-verified `user`, then `resolveAuthRedirect` to decide whether to bounce a signed-out visitor to `/login?redirectTo=<path>`; carries forward any refreshed session cookies onto the redirect response so a token rotation isn't lost on the very request that redirects. `config.matcher` excludes `_next/static`, `_next/image`, `favicon.ico`, static file extensions, and `/api` via a single negative-lookahead pattern.
- **Deviation found and fixed:** the plan's stated file path (`apps/web/middleware.ts`, package root) does not match this app's `src/` layout. Verified directly against the installed Next 15.3.3 source that the middleware file is resolved relative to the app/pages directory's parent (`src/`, not the package root) — a root-level file is silently never loaded by dev or build. Relocated to `apps/web/src/middleware.ts` with no logic changes; all 8 unit tests and the acceptance-criteria greps (`getSession(` absence, `updateSession`/`resolveAuthRedirect` presence, matcher exclusions) re-verified after the move.
- `/login` (`apps/web/src/app/login/page.tsx`) — a minimal centered `Card` with exactly one primary action, the `GoogleSigninButton`, wrapped in `<Suspense>` (required for its `useSearchParams` read).
- `google-signin-button.tsx` — reads the inbound `redirectTo` query param, validates it through `safeNextPath`, and calls the browser `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: <origin>/auth/callback?next=<validated path> } })`. No password/email/magic-link input anywhere on the page.
- `apps/web/src/app/auth/callback/route.ts` — `GET` handler exchanges `code` via `supabase.auth.exchangeCodeForSession(code)`; on success redirects through `safeNextPath(next)` (second consumer of the same validation, T-43-P2-01); on missing/failed code redirects to `/login?error=auth` without echoing the upstream Supabase/provider error (T-43-P2-06).
- `apps/web/src/app/auth/signout/route.ts` — `POST` handler calls `supabase.auth.signOut()` server-side (clears httpOnly cookies, T-43-P2-05) and 303-redirects to `/login`.
- `apps/web/src/components/sign-out-button.tsx` + `app-sidebar.tsx` — a `<form action="/auth/signout" method="post">` wrapping a ghost-variant button (sized/styled to match the existing `ThemeToggle`), rendered inside `<SidebarFooter>` beneath `ThemeToggle`. Nav items list (`LIVE_NAV_ITEMS`) unchanged; no new settings surface introduced.
- `npx tsc --noEmit` in `apps/web`: 53 errors total, all confined to the pre-existing `src/app/dev/design/` baseline (backlog 999.14) — zero new errors introduced by any of the 9 files this plan touched, verified both via the plan's scoped greps (login/auth, sign-out-button/app-sidebar/auth-signout) and a full unfiltered error count comparison.

## Task Commits

Each task was committed atomically:

1. **Task 1: Route-guard middleware + pure resolveAuthRedirect/safeNextPath with unit tests** — `7ab388b` (test, RED) + `20593c4` (feat, GREEN) + `1c39ed0` (fix — middleware.ts relocation deviation, see below)
2. **Task 2: /login page + Continue-with-Google button + /auth/callback code exchange** — `363fbbc` (feat)
3. **Task 3: Server-side sign-out route + sidebar sign-out affordance** — `02af62a` (feat)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `apps/web/src/lib/auth/redirect.ts` - Pure `safeNextPath` + `resolveAuthRedirect` (open-redirect + route-guard decisions)
- `apps/web/src/lib/auth/redirect.test.ts` - 8 unit tests covering every behavior-block case
- `apps/web/src/middleware.ts` - Session-refresh + route-guard middleware (relocated from the plan's stated `apps/web/middleware.ts` — see deviation)
- `apps/web/src/app/login/page.tsx` - Minimal Google-only sign-in card
- `apps/web/src/app/login/_components/google-signin-button.tsx` - `"use client"` button calling `signInWithOAuth`
- `apps/web/src/app/auth/callback/route.ts` - PKCE code exchange + validated return-to redirect
- `apps/web/src/app/auth/signout/route.ts` - Server-side `signOut()` + 303 redirect to `/login`
- `apps/web/src/components/sign-out-button.tsx` - Form-POST sign-out affordance (ghost button, `LogOut` icon)
- `apps/web/src/components/app-sidebar.tsx` - Renders `<SignOutButton />` in `<SidebarFooter>`

## Decisions Made

- Relocated `middleware.ts` under `src/` after verifying Next.js's actual file-resolution logic in the installed package — the plan's stated path would have shipped an inert route-guard with all tests green (since the unit tests only exercise the pure `redirect.ts` module, not middleware wiring itself).
- Kept the backslash-authority (`/\host`) rejection already present in `safeNextPath` from the prior interrupted session's implementation — it's strictly more defensive than the plan's literal spec and doesn't change any of the 8 required test outcomes.
- Sign-out stays exclusively server-side (form POST, no client `signOut()` call) so there is exactly one code path that clears the session cookie.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `middleware.ts` relocated from `apps/web/middleware.ts` to `apps/web/src/middleware.ts`**
- **Found during:** Task 1 (continuing/verifying a prior interrupted run's already-committed middleware code)
- **Issue:** The plan's frontmatter and task text both specify `apps/web/middleware.ts` (package root). This repo's Next.js app lives under `src/app`, and Next.js's middleware file resolution (verified directly in `node_modules/next/dist/build/index.js`'s `rootDir = path.join(pagesDir || appDir, '..')` and the equivalent check in `next/dist/server/lib/router-utils/setup-dev-bundler.js`) looks for the middleware file in the directory that is the *parent* of the app/pages directory — `src/`, not the package root. A `middleware.ts` at the package root is silently never discovered by either `next dev` or `next build`, meaning the entire Task 1 route-guard (redirect-to-login for signed-out visitors) would never actually run in the real app despite all unit tests passing (the tests only exercise the pure `redirect.ts` functions, not the wiring).
- **Fix:** `git mv apps/web/middleware.ts apps/web/src/middleware.ts`, updated the file's header comment to reflect the new path and document the verified resolution logic (with source references) so a future reader doesn't "fix" it back.
- **Files modified:** `apps/web/src/middleware.ts` (moved + comment update)
- **Verification:** Re-ran `npx vitest run src/lib/auth/redirect.test.ts` (8/8 green, path-independent pure functions), re-ran the Task 1 acceptance-criteria greps (`getSession(` absent, `updateSession`/`resolveAuthRedirect` present, matcher excludes `_next`/`api` via negative lookahead) — all still pass after the move. `npx tsc --noEmit` shows no middleware-related errors.
- **Committed in:** `1c39ed0`

Or otherwise: Tasks 2 and 3 executed exactly as specified in the plan (their on-disk files, created by a prior interrupted session, were reviewed line-by-line against the plan's action/acceptance-criteria text and found correct — no further changes needed beyond committing them).

---

**Total deviations:** 1 auto-fixed (1 blocking/correctness bug).
**Impact on plan:** The fix was necessary for the plan's core AUTH-02 guarantee (signed-out visitors redirected to `/login`) to actually hold at runtime. No scope creep — no other files touched.

## Issues Encountered

- This plan's working tree already contained fully-formed, uncommitted implementations for all three tasks when this execution run started (a prior session's work that was interrupted before committing, per the ongoing autonomous run noted in project memory). Each file was read and verified line-by-line against the plan's `<action>`/`<acceptance_criteria>` text before being committed — no blind trust of pre-existing uncommitted state. Task 1's middleware placement bug (above) was caught during this verification pass.

## User Setup Required

None for this plan. The full Google OAuth round-trip (Google Cloud console client creation, Supabase dashboard provider config, redirect URIs) remains the documented user runbook (43-05) — no real Google credentials exist in this autonomous run, so the end-to-end sign-in flow is `human_needed` UAT per the plan's own `<human-check>` block:

1. With auth env vars + a configured Google provider, visit `/chat` while signed out → confirm redirect to `/login?redirectTo=%2Fchat`.
2. Click "Continue with Google", complete the Google consent → confirm return to `/chat` and an authenticated session.
3. Refresh the browser → session persists (AUTH-01).
4. Click "Sign out" in the sidebar → confirm landing on `/login` and that revisiting `/chat` redirects back to `/login` (AUTH-02).

## Next Phase Readiness

- AUTH-01 (Google sign-in + persistent session) and AUTH-02 (sign-out + route protection) are code-complete and unit/typecheck-verified; only the live OAuth round-trip needs human UAT once 43-05's runbook is followed.
- `resolveAuthRedirect`/`safeNextPath` are the reusable, unit-tested primitives Plan 03 (tRPC `createContext`/`protectedProcedure`) and Plan 04 (FastAPI identity forwarding) build identity-derivation on top of — no blockers.
- Plan 03 can now read the same server-verified `getUser()` pattern this plan established in `middleware.ts`/`server.ts` for `ctx.user` resolution.

---
*Phase: 43-auth-google-oauth-sessions-supabase-auth*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: apps/web/src/lib/auth/redirect.ts
- FOUND: apps/web/src/lib/auth/redirect.test.ts
- FOUND: apps/web/src/middleware.ts
- FOUND: apps/web/src/app/login/page.tsx
- FOUND: apps/web/src/app/login/_components/google-signin-button.tsx
- FOUND: apps/web/src/app/auth/callback/route.ts
- FOUND: apps/web/src/app/auth/signout/route.ts
- FOUND: apps/web/src/components/sign-out-button.tsx
- FOUND: apps/web/src/components/app-sidebar.tsx (modified)
- FOUND: commit 7ab388b (test(43-02): add failing test for resolveAuthRedirect/safeNextPath)
- FOUND: commit 20593c4 (feat(43-02): add route-guard middleware + resolveAuthRedirect/safeNextPath)
- FOUND: commit 1c39ed0 (fix(43-02): move middleware.ts under src/ so Next.js actually loads it)
- FOUND: commit 363fbbc (feat(43-02): add /login page, Google sign-in button, and /auth/callback)
- FOUND: commit 02af62a (feat(43-02): add server-side sign-out route + sidebar sign-out button)
- FOUND: `npx vitest run src/lib/auth/redirect.test.ts` — 8/8 passed
- FOUND: `npx tsc --noEmit` — 53 errors, all in src/app/dev/design baseline, 0 new
