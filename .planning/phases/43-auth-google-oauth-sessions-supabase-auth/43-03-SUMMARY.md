---
phase: 43-auth-google-oauth-sessions-supabase-auth
plan: 03
subsystem: auth
tags: [trpc, supabase, auth, zod, session, protected-procedure]

# Dependency graph
requires:
  - phase: 43-01
    provides: "@supabase/ssr server client helper (createClient().auth.getUser())"
provides:
  - "packages/api-client/src/trpc.ts — ctx.user (SessionUser | null) in context + protectedProcedure middleware"
  - "apps/web/src/app/api/trpc/[trpc]/route.ts — session user resolved via getUser() and injected into the tRPC context"
  - "identity-injection acceptance test proving ctx.user always wins over client-supplied input"
affects: [43-04-fastapi-identity-forwarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "protectedProcedure via t.procedure.use(): throws TRPCError UNAUTHORIZED when ctx.user is null, otherwise narrows ctx.user to non-null for every downstream resolver"
    - "Framework-agnostic api-client boundary: the Next.js caller resolves identity (getUser()) and passes a plain SessionUser value into createTRPCContext — trpc.ts never imports next/headers or @supabase/ssr"

key-files:
  created:
    - packages/api-client/src/trpc.test.ts
  modified:
    - packages/api-client/src/trpc.ts
    - apps/web/src/app/api/trpc/[trpc]/route.ts
    - packages/api-client/src/router/__tests__/mutations.test.ts
    - packages/api-client/src/router/__tests__/entity-types-write.test.ts
    - packages/api-client/src/router/__tests__/component-relationship-mutations.test.ts
    - packages/api-client/src/router/genui/__tests__/generate.test.ts
    - packages/api-client/src/router/genui/__tests__/code-island.test.ts
    - packages/api-client/src/router/genui/__tests__/history.test.ts

key-decisions:
  - "SessionUser is a local minimal type ({ id, email? }) in trpc.ts, not imported from @supabase/supabase-js — keeps @polytoken/api-client dependency-free of Supabase (T-43-P3-04)"
  - "protectedProcedure implemented as t.procedure.use() middleware (not a wrapper function) so TypeScript's own control-flow narrowing enforces non-null ctx.user for every consumer at compile time"

patterns-established:
  - "Identity-injection acceptance test shape: build a throwaway router with a protectedProcedure whose input includes an attacker-controlled field with the same semantic meaning as ctx.user.id, drive it through createCallerFactory, and assert the resolver returns the CONTEXT value — reusable for any future procedure that must resist input-based identity spoofing"

requirements-completed: [AUTH-03]

# Metrics
duration: ~10min
completed: 2026-07-09
---

# Phase 43 Plan 03: tRPC Identity Boundary — ctx.user + protectedProcedure Summary

**Filled the documented "no-auth" seam in `packages/api-client/src/trpc.ts`: `ctx.user` is now session-derived, `protectedProcedure` rejects sessionless calls with `UNAUTHORIZED`, and a dedicated identity-injection test proves a client-supplied `input.userId` can never override the server-verified `ctx.user.id`.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-10T00:01:28Z
- **Tasks:** 2 completed (Task 1 via RED → GREEN TDD cycle; Task 2 standard)
- **Files modified:** 8 (1 created, 7 modified — 2 core + 1 test file authored, 6 pre-existing test call sites fixed as a Rule 1 deviation)

## Accomplishments

- `packages/api-client/src/trpc.ts`: `createTRPCContext` now accepts `{ headers: Headers; user: SessionUser | null }` and returns `{ headers, db, user }` — `db`, the superjson transformer, and the Zod `errorFormatter` are untouched. Added `export const protectedProcedure = t.procedure.use(...)`, which throws `TRPCError({ code: "UNAUTHORIZED" })` when `ctx.user` is null and otherwise narrows `ctx.user` to non-null downstream. `publicProcedure` stays exported for genuinely public/system routes. `SessionUser` is a local, dependency-free type (`{ id: string; email?: string | null }`), not imported from `@supabase/supabase-js`.
- `packages/api-client/src/trpc.test.ts` (new): 5 tests. Two assert `createTRPCContext` carries a provided user (or `null`) into `ctx.user`. Three exercise a throwaway `protectedProcedure` router via `createCallerFactory`: (1) a null-user call rejects with `TRPCError`/`UNAUTHORIZED`; (2) a session-user call resolves with `ctx.user.id`; (3) **the identity-injection acceptance gate** — a procedure whose input schema includes an attacker-supplied `userId` field returns `ctx.user.id`, not `input.userId`, proving the two can differ and context always wins.
- `apps/web/src/app/api/trpc/[trpc]/route.ts`: `createContext` is now async — it awaits the server Supabase client (`~/lib/supabase/server`'s `createClient()`), calls `await supabase.auth.getUser()` (server-verified; grep-confirmed no `getSession(` call anywhere in the file), and passes the resolved `{ id, email }` (or `null`) into `createTRPCContext`. `fetchRequestHandler`'s `createContext` returns the async function's promise. `onError` logging and the `GET`/`POST` exports are unchanged.
- Ran the full RED → GREEN TDD cycle for Task 1: confirmed the test failed for the right reason (`protectedProcedure` undefined) before any implementation existed, then implemented until all 5 assertions passed.
- Verified all plan-level `<verification>` commands: `npx vitest run src/trpc.test.ts` (5/5 green), `npx tsc --noEmit` in `apps/web` (zero new errors outside the `src/app/dev/design` baseline), and a grep confirming `packages/api-client` has zero `next/headers`/`@supabase/ssr`/`@supabase/supabase-js` imports (only doc-comment mentions, and zero occurrences in `package.json` dependencies).
- Ran the full `packages/api-client` vitest suite (not just the new file) to catch regressions from the context-shape change: 22 test files, 216 tests, all green.

## Task Commits

Each task was committed atomically:

1. **Task 1 — RED:** `82c9d12` (test) — failing test for `ctx.user` + `protectedProcedure` identity gate
2. **Task 1 — GREEN:** `aa4ebdd` (feat) — `ctx.user` + `protectedProcedure` implementation, plus the 6 fixed pre-existing test call sites (Rule 1 deviation, see below)
3. **Task 2:** `19f7fb4` (feat) — wired the tRPC route handler to resolve the session user server-side via `getUser()`

**Plan metadata:** (this SUMMARY.md commit, following)

_Note: Task 1 used the full TDD RED → GREEN cycle per its `tdd="true"` attribute. No REFACTOR commit — the GREEN implementation was already clean; the only follow-up changes were the deviation fix bundled into the GREEN commit._

## Files Created/Modified

- `packages/api-client/src/trpc.test.ts` - New: identity-injection + `protectedProcedure` rejection test suite (5 tests)
- `packages/api-client/src/trpc.ts` - `createTRPCContext` accepts/exposes `ctx.user`; new `protectedProcedure` export; new local `SessionUser` type
- `apps/web/src/app/api/trpc/[trpc]/route.ts` - Async `createContext` resolving `supabase.auth.getUser()` and injecting the result into `createTRPCContext`
- `packages/api-client/src/router/__tests__/mutations.test.ts` - Added `user: null` to the stub `appRouter.createCaller()` context (deviation fix)
- `packages/api-client/src/router/__tests__/entity-types-write.test.ts` - Same deviation fix
- `packages/api-client/src/router/__tests__/component-relationship-mutations.test.ts` - Same deviation fix
- `packages/api-client/src/router/genui/__tests__/generate.test.ts` - Same deviation fix
- `packages/api-client/src/router/genui/__tests__/code-island.test.ts` - Same deviation fix
- `packages/api-client/src/router/genui/__tests__/history.test.ts` - Same deviation fix

## Decisions Made

- `SessionUser` defined locally in `trpc.ts` rather than importing `User` from `@supabase/supabase-js`, keeping `@polytoken/api-client` free of any Supabase dependency (per the plan's own `<interfaces>` guidance).
- `protectedProcedure` implemented as `t.procedure.use()` middleware (not a wrapper function around resolvers) so TypeScript's control-flow narrowing statically enforces `ctx.user` is non-null for every consumer, rather than relying on a runtime-only guarantee.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 6 pre-existing test call sites broken by the now-required `user` field on tRPC context**
- **Found during:** Task 1 (GREEN phase), running `npx tsc --noEmit` in `packages/api-client`
- **Issue:** Six pre-existing test files construct a raw context directly via `appRouter.createCaller({ db: {} as never, headers: new Headers() })`, bypassing `createTRPCContext`. Widening `createTRPCContext`'s (and therefore `TRPCContext`'s) required shape to include `user: SessionUser | null` made these six object literals fail `tsc` with "Property 'user' is missing".
- **Fix:** Added `user: null` to each of the six `createCaller()` call sites. All six routers under test exercise `publicProcedure` only, so this is a type-shape fix with zero behavioral change — none of the affected resolvers read `ctx.user`.
- **Files modified:** `packages/api-client/src/router/__tests__/mutations.test.ts`, `entity-types-write.test.ts`, `component-relationship-mutations.test.ts`, `packages/api-client/src/router/genui/__tests__/generate.test.ts`, `code-island.test.ts`, `history.test.ts`
- **Verification:** `npx tsc --noEmit` in `packages/api-client` returns zero errors; full `npx vitest run` (22 files / 216 tests) all green.
- **Committed in:** `aa4ebdd` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking issue] Rebuilt a stale, gitignored `packages/api-client/dist/` build artifact**
- **Found during:** Task 2, running `npx tsc --noEmit` in `apps/web`
- **Issue:** `apps/web`'s `tsc` (moduleResolution: `bundler`) resolved `@polytoken/api-client`'s types via its `package.json` `exports["."].types` condition, which points at `./dist/index.d.ts` — a stale, gitignored local build artifact left over from before the repo-wide `@nauta/*` → `@polytoken/*` rename (the stale `.d.ts` still referenced `@nauta/db/schema` and the pre-Task-1 `createTRPCContext({ headers })` signature). This shadowed the live `src/trpc.ts` signature from Task 1 and produced a false `tsc` error the moment `route.ts` started passing `user` into `createTRPCContext`.
- **Fix:** Ran `npm run build` in `packages/api-client` (its own `tsc` build script) to regenerate `dist/` from current source. `dist/` is gitignored (`.gitignore:47`), so this produced no trackable git change — confirmed via `git status --short packages/api-client/dist` (empty output).
- **Files modified:** none (gitignored build output only, not committed)
- **Verification:** Re-ran `npx tsc --noEmit` in `apps/web` — zero errors for `api/trpc`, zero new errors overall (all remaining errors confined to the pre-existing `src/app/dev/design` baseline).
- **Committed in:** N/A (untracked/ignored artifact; documented in the Task 2 commit message `19f7fb4` for traceability)

---

**Total deviations:** 2 auto-fixed (1 bug fix to pre-existing test call sites, 1 blocking-issue fix to a stale local build artifact).
**Impact on plan:** Both fixes were necessary side effects of widening the tRPC context shape — no scope creep, no files touched outside the direct blast radius of this plan's own signature change.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None for this plan. The route handler now calls `supabase.auth.getUser()`, which depends on the same env vars and Google OAuth provider configuration documented as the 43-05 user runbook (already noted as pending in Plan 01/02's summaries) — no new setup surface introduced by this plan itself.

## Next Phase Readiness

- AUTH-03 is code-complete: `ctx.user` is session-derived, `protectedProcedure` is available for any router that needs to require authentication, and the identity-injection acceptance test proves the trust boundary holds.
- No existing router currently uses `protectedProcedure` — all current routers (`emails`, `entities`, `entityTypes`, `knowledge`, `genui`, `chat`) still use `publicProcedure`, unchanged by this plan. Migrating specific procedures to `protectedProcedure` (tenancy enforcement) is out of this plan's scope and is expected to land with Phase 43's tenancy/RLS work or a later plan.
- Plan 04 (FastAPI identity forwarding) can now rely on `ctx.user` being present in any tRPC procedure that opts into `protectedProcedure`, and on the `getUser()`-server-verified pattern established here and in Plan 01/02.
- No blockers.

---
*Phase: 43-auth-google-oauth-sessions-supabase-auth*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: packages/api-client/src/trpc.ts
- FOUND: packages/api-client/src/trpc.test.ts
- FOUND: apps/web/src/app/api/trpc/[trpc]/route.ts
- FOUND: commit 82c9d12 (test(43-03): add failing test for ctx.user + protectedProcedure identity gate)
- FOUND: commit aa4ebdd (feat(43-03): add ctx.user + protectedProcedure to trpc.ts)
- FOUND: commit 19f7fb4 (feat(43-03): resolve session user server-side in tRPC route handler)
- FOUND: `npx vitest run src/trpc.test.ts` — 5/5 passed
- FOUND: `npx vitest run` (full packages/api-client suite) — 22 files / 216 tests passed
- FOUND: `npx tsc --noEmit` (apps/web) — zero new errors outside src/app/dev/design baseline
