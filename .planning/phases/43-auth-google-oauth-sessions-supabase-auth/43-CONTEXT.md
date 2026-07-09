# Phase 43: Auth — Google OAuth + Sessions (Supabase Auth) - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — 4 grey areas proposed, all recommendations auto-accepted per autonomous contract

**Rename note:** This phase executes AFTER Phase 42's atomic rename. Package scopes cited here are post-rename (`@polytoken/*`); file paths are unaffected by the rename.

<domain>
## Phase Boundary

Real user identity for the web app: Google sign-in via Supabase Auth (PKCE, `@supabase/ssr` — the milestone's ONE new npm dependency), persistent sessions, sign-out, route protection, and session-derived identity in every server context (tRPC + FastAPI proxy routes). NOT in this phase: tenant scoping of data (Phase 44), any FastAPI-side enforcement of the forwarded identity (Phase 44), design polish (v1.8).

</domain>

<decisions>
## Implementation Decisions

### Sign-in UX & routing
- Dedicated `/login` route: minimal card, single "Continue with Google" button — Google-only (AUTH-01); no email/password, no magic links; taste-heavy design deferred to v1.8
- Route protection via Next.js middleware using the canonical `@supabase/ssr` pattern (middleware refreshes the token AND guards app surfaces; signed-out visitors redirect to `/login`)
- Post-sign-in redirect: return-to originally requested URL (`redirectTo` param), fallback to app home
- Sign-out: minimal affordance in existing chrome (header/sidebar user menu) — no new settings surface

### Session & identity plumbing
- tRPC: `createContext` resolves the Supabase session server-side (cookie-based via `@supabase/ssr` server client) into `ctx.user`; add `protectedProcedure` middleware that rejects unauthenticated calls — this fills the documented "no-auth" seam in `packages/api-client/src/trpc.ts`
- ALWAYS `supabase.auth.getUser()` in server contexts (server-verified), NEVER `getSession()` alone (unverified cookie parse) — known Supabase security pitfall
- Identity forwarding to FastAPI: server-derived `X-User-Id` header added by the BFF proxy routes, alongside the UNCHANGED `X-API-Key` service header; documented trust model: FastAPI is only reachable server-to-server through the authenticated BFF; FastAPI ENFORCEMENT of that identity is Phase 44 scope
- JWT signing-key mode (research flag from SUMMARY.md): confirm the project's mode (legacy HS256 vs new asymmetric keys) during planning; preferring `getUser()` round-trips avoids local JWT verification entirely in the web tier

### Env & configuration
- Extend the existing env validation with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ any server-only vars); missing vars fail startup with a clear message (AUTH-05); schema-based (Zod) per repo guardrails
- Google Cloud OAuth client creation + redirect-URI configuration (local, staging, prod) is a USER RUNBOOK — code only reads config; autonomous execution never creates external OAuth clients
- Dev/staging auth host: the linked staging Supabase project; prod configuration joins the user's existing deploy queue
- Sign-up policy: open Google sign-in in v1.7 (no allowlist code — single-user reality); runbook notes the Supabase dashboard restriction option

### Testing & guarantees
- Identity-injection test (success criterion 3): vitest integration test proving procedures ignore client-supplied user/identity fields and `protectedProcedure` rejects sessionless calls
- FastAPI `X-API-Key` middleware unchanged except optional `X-User-Id` passthrough; existing service tests must stay green (success criterion 4)
- E2E: Playwright smoke for signed-out → `/login` redirect; the full Google OAuth loop is a manual UAT item (no real Google creds in CI) — expect `human_needed` verification for that item
- Startup-validation test: missing auth env vars fail with the clear message

### Claude's Discretion
- Exact middleware matcher config, cookie names, file layout for the Supabase client helpers (browser/server/middleware variants), login page styling within the v1.4 token system

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@supabase/supabase-js` already installed in web; `supabase-py` + `PyJWT` already installed in the FastAPI service; Supabase Auth (GoTrue) already enabled in `supabase/config.toml` — only `@supabase/ssr` is new
- Existing env validation patterns at both app boundaries (Zod web-side, startup checks service-side)

### Established Patterns
- BFF topology: browser NEVER calls FastAPI directly; all traffic flows through Next.js server routes/tRPC with `X-API-Key` service-to-service — user auth lives ONLY in apps/web
- tRPC context at `packages/api-client/src/trpc.ts` is documented "no-auth… add auth here later" — this phase is that "later"

### Integration Points
- Next.js middleware (new) for session refresh + route guard
- tRPC `createContext` for `ctx.user` + `protectedProcedure`
- Server-side FastAPI proxy routes (attachments, promote, emails) gain `X-User-Id` forwarding
- Supabase project config: Google provider enablement is part of the user runbook

</code_context>

<specifics>
## Specific Ideas

- The login page should feel intentionally minimal — a placeholder for v1.8's re-skin, not a design statement
- Runbook lives with the phase artifacts and must cover: Google Cloud console client creation, authorized redirect URIs (local + Supabase callback + prod), Supabase dashboard Google provider config, env var list per environment

</specifics>

<deferred>
## Deferred Ideas

- Email allowlist / invite gating — revisit if the product opens beyond single-user
- FastAPI-side enforcement of forwarded identity — Phase 44 (tenancy) scope by design
- Org/team collaboration — explicitly out of scope for the milestone

</deferred>
