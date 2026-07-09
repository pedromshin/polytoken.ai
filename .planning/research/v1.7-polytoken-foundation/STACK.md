# Stack Research: v1.7 polytoken.ai Foundation

**Domain:** Adding auth + tenancy + email threading + atomic rename to an existing Next.js
(App Router, tRPC) + FastAPI (Clean Architecture) app sharing one Supabase Postgres.
**Researched:** 2026-07-09
**Confidence:** HIGH (auth architecture, RLS mechanism, threading) / MEDIUM (exact JWT signing-key
mode currently active on this Supabase project, rename tooling specifics)

This is a **subsequent-milestone** stack doc. It does not re-litigate the validated substrate
(Next.js 15 App Router, tRPC 11, Drizzle 0.44, FastAPI 0.115, Supabase Postgres, npm workspaces).
It covers only what v1.7 adds.

---

## Codebase reconnaissance (grounds every recommendation below)

| Finding | Evidence | Why it matters |
|---|---|---|
| `@supabase/supabase-js@2.108.1` already installed in `apps/web` | `apps/web/package.json` | Zero new dep for the JS Supabase client itself |
| `supabase-py 2.31.0` (+ `postgrest-py 2.31.0`, `supabase-auth 2.31.0`) already resolved in `apps/email-listener/uv.lock` | `uv.lock` | Zero new dep for the Python Supabase client |
| `PyJWT 2.13.0` already resolved transitively (via `supabase-auth`) | `uv.lock:1677` | FastAPI can verify JWTs with **zero new dependency**, only needs an explicit `pyjwt` line for it to stop being an implicit transitive-only dep |
| Local Supabase `[auth] enabled = true` already in `supabase/config.toml`, GoTrue already runs on `npm run sb:start` | `supabase/config.toml:155-156` | Supabase Auth is already part of the dev stack; adding Google as a provider is a config diff, not new infrastructure |
| `next-auth` / `@auth/core` **absent** from `apps/web/package.json` | grep | No existing commitment to Auth.js — clean slate |
| Drizzle client (`packages/db/src/client.ts`) explicitly uses `POSTGRES_URL_NON_POOLING` (session mode, port 5432) **"because the transaction-mode pooler strips superuser privileges... RLS policies block all queries"** | `client.ts:28-36` | Today's Drizzle path runs as Postgres superuser and **fully bypasses RLS by design**. RLS enforcement for v1.7 needs a genuinely new runtime path, not a policy tweak. |
| `packages/db/migrations/0001_rls_deny_all.sql` (and 0020) already do RESTRICTIVE deny-all for `anon`/`authenticated`, written as **raw SQL migrations**, not Drizzle's declarative `pgPolicy` schema API | migration files | House convention for RLS DDL is raw SQL migrations. Keep it — don't introduce the declarative API as a second pattern. |
| `apps/email-listener/app/infrastructure/supabase/client.py` — `get_supabase_client()` is `@lru_cache`'d, uses `SUPABASE_SECRET_KEY` (service_role-equivalent) | `client.py` | FastAPI's Supabase access is **also** a full RLS bypass today, via PostgREST as service_role. This client **must stay** the trusted/system client — a new, request-scoped client is needed for user-scoped RLS calls. |
| `emails` table already has `message_id` (NOT NULL, unique w/ importer), `in_reply_to`, `references_ids text[]` columns, **already populated** by `mime_parser.py` (`_header(msg, "In-Reply-To")`, `references.split()`) since Phase 1–4 | `packages/db/src/schema/emails.ts:32-35`, `app/domain/services/mime_parser.py:103-108` | Threading is a **pure grouping problem over already-collected data** — no new header parsing needed. Strongly favors hand-rolling over adopting a library. |
| Next.js never lets the browser call FastAPI directly — every `/api/chat/*` route handler is a **server-side proxy** injecting `X-API-Key` from `EMAIL_LISTENER_API_KEY` at request time | `apps/web/src/app/api/chat/{stream,regenerate,widget/submit}/route.ts` | This is the exact seam to extend: these same route handlers can additionally forward the user's Supabase access token. FastAPI never needs to be publicly reachable with a user bearer token — CORS/direct-origin auth is a non-issue. |
| tRPC context is explicitly documented as **"simplified, no-auth... Add auth here later if needed"** | `packages/api-client/src/trpc.ts:1-6` | This file is the intended v1.7 auth insertion point on the Next.js/tRPC side. |
| DI is `dishka >=1.4.0` (already supports `Scope.REQUEST`) | `apps/email-listener/app/container.py` | No new DI library needed for a request-scoped, user-JWT-bound Supabase client — dishka already has the primitive. |
| Postgres pooler is Supabase's Supavisor: `POSTGRES_URL` = port 6543 (transaction mode), `POSTGRES_URL_NON_POOLING` = port 5432 (session mode) | `.env.example` | Confirms which URL is which for the RLS transaction pattern below. |
| `postgres` npm driver is already invoked with `{ prepare: false }` | `client.ts:65` | Already transaction-pooler-safe (prepared statements disabled) — no change needed there. |
| Python package is named `email-listener`, not `nauta-email-listener`; "nauta" appears ~30x in that app, mostly docstrings/comments | `pyproject.toml:2`, grep | Python-side rename blast radius is small (text only, no package-name break). |
| `@nauta/*` scope appears in ~210 TS/TSX files; "nauta" (case-insensitive) appears in 765 non-code files (md/json/toml/tf/yaml) | grep counts | TS-side rename blast radius is the real one — package.json `name` fields + import specifiers + workspace `-w @nauta/x` script flags. |
| Two PDFs at repo root (`0 - nauta_design_case.pdf`, `Nauta - Guia de Arquitetura (PT-BR).pdf`) name the **fictional client** from the original design case, not the product's own old brand | file listing + PROJECT.md context | These are binary historical artifacts — a text codemod can't touch them anyway, and per PROJECT.md's own framing they document the design case the product still cites as its origin story. Flag for the rename phase: leave as-is, don't try to "modernize" their content. |

---

## Architecture Decision 1 — Auth: Supabase Auth (GoTrue), not Auth.js v5, not custom

### Comparison

| Criterion | **Supabase Auth (recommended)** | Auth.js v5 (NextAuth) | Custom OAuth + sessions |
|---|---|---|---|
| Maturity | GA, used by the Postgres provider you already run | **Still in beta as of July 2026** — `next-auth@5.x` has never dropped the beta tag despite years of RC; `next-auth@4.x` (stable) is pre-App-Router-native | N/A — you own it |
| New infra | None — GoTrue already runs locally (`[auth] enabled = true`) and on hosted Supabase | Needs its own Postgres adapter tables OR JWT-only mode | You build session storage |
| RLS integration | **Native.** Supabase issues the JWT Postgres RLS policies already expect (`auth.uid()`, `request.jwt.claims`) — this is the same auth system the RLS policies in `0001_rls_deny_all.sql` were written against | **None.** You'd have to mint a Supabase-shaped JWT yourself from the Auth.js `jwt` callback (signed with the project's JWT secret) to make `auth.uid()` resolve at all — reinvents Supabase Auth's core job | You design the claims shape from scratch; same problem as Auth.js, worse, since you also own OAuth code exchange, CSRF/PKCE, refresh rotation |
| FastAPI validates the same session | **Verify the Supabase-issued JWT directly** (PyJWT, already resolved transitively) — no second protocol | Needs a third-party bridge (`fastapi-nextauth-jwt` on PyPI, small/niche, decrypts Auth.js's own encrypted-JWE session cookie format) or a custom shared-secret scheme | You define and implement verification yourself on both sides |
| New npm deps | **`@supabase/ssr`** only (official, ~1 package, wraps the already-installed `@supabase/supabase-js`) | `next-auth@beta` + provider adapter | 0 core, but you re-implement PKCE/CSRF/refresh — real engineering cost, not a real "0 deps" win |
| New Python deps | **0** (`supabase-auth`/`postgrest`/`pyjwt` already resolved) | `fastapi-nextauth-jwt` (new, small maintainer surface) | Your own JWT/session code |
| Fits "prefer zero-or-minimal new deps consistent with this repo's history" | **Best fit** | Worst fit (new frontend framework-within-a-framework + bridge lib) | Worst fit (most net-new code) |

**Decision: Supabase Auth (GoTrue) with the Google provider, `@supabase/ssr` on the Next.js side, PyJWT on the FastAPI side.**

Rationale: this app is Supabase-Postgres-first already — RLS policies, `auth.uid()`, and the whole
tenancy model this milestone wants are designed around the JWT shape Supabase Auth issues natively.
Auth.js v5 would add an unrelated session system on top and then require hand-bridging it back into
the one that Postgres RLS actually understands — strictly more work and more moving parts for the
same outcome. Custom is even more work for the same outcome. Supabase Auth is also the only option
with **zero new backend dependencies** and exactly **one** new frontend dependency.

### How the two backends share one session

```
Browser → Next.js (App Router)
  1. supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } })
  2. Google Cloud OAuth client redirects to the Supabase project's FIXED callback:
     https://<project-ref>.supabase.co/auth/v1/callback   (registered once in Google Cloud Console —
     NOT the Next.js app URL; this is Supabase-hosted, not app-hosted)
  3. Supabase Auth redirects back to your app's redirectTo with a `code` param
  4. app/auth/callback/route.ts calls supabase.auth.exchangeCodeForSession(code)
     → session (access_token JWT + refresh_token) stored in httpOnly cookies via @supabase/ssr
  5. middleware.ts refreshes the session every request (supabase.auth.getUser() — NOT getSession()
     for authorization decisions; getUser() revalidates against the Auth server / local JWKS,
     getSession() does not)

Next.js server code → FastAPI (apps/email-listener)
  - The browser NEVER calls FastAPI directly today (verified: every apps/web/src/app/api/chat/*
    route.ts is a server-side proxy injecting X-API-Key at request time). Extend this exact seam:
    read the Supabase session server-side (cookies are httpOnly, only readable server-side) and
    forward the access_token as a new header (e.g. `Authorization: Bearer <token>`) ALONGSIDE the
    existing X-API-Key — X-API-Key keeps meaning "this call came from our trusted Next.js server",
    the new header means "acting on behalf of this user."

FastAPI validation
  - A new dependency (sibling to require_api_key in app/presentation/middleware/auth.py) verifies
    the Supabase JWT locally with PyJWT — no round trip to the Auth server needed:
      • If the project uses legacy symmetric signing (SUPABASE_JWT_SECRET, HS256): verify with that
        static secret directly.
      • If the project has migrated to the new asymmetric signing keys (ES256, rolled out 2025):
        fetch+cache https://<project>.supabase.co/auth/v1/.well-known/jwks.json via
        jwt.PyJWKClient and verify against the public key.
    MEDIUM confidence which mode this specific Supabase project is currently on — check
    Dashboard → Settings → API → JWT Keys before implementing; both paths are equally "local,
    zero-round-trip" verification, just symmetric vs asymmetric key material.
  - The verified `sub` claim is the user_id used for tenancy scoping (Architecture Decision 2).
```

### Google Cloud setup (user-runbook, not autonomous — per this milestone's own scope)
1. Google Cloud Console → OAuth consent screen (scopes: `openid`, `.../userinfo.email`, `.../userinfo.profile`).
2. Create an OAuth 2.0 **Web application** client. Authorized redirect URI = the Supabase project's
   fixed `/auth/v1/callback` (one per environment: local, staging, prod each have their own
   Supabase project ref per `.env.example`, so this is **3 Google OAuth clients or 3 redirect URIs
   on one client** — decide at implementation time).
3. Local dev: `supabase/config.toml` → `[auth.external.google]` with `enabled = true`,
   `client_id = "..."`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"`. Hosted
   (staging/prod): same fields via the Supabase Dashboard's Google provider page, not config.toml.

---

## Architecture Decision 2 — RLS enforcement mechanism with Drizzle + the Supabase pooler

The existing `packages/db/src/client.ts` comment is the whole problem statement: it deliberately
uses the **non-pooling, session-mode** URL so Drizzle runs as the Postgres superuser and RLS never
applies. That was the correct call for a single-shared-API-key, no-tenancy app. It is not what
"RLS actually enforced" (this milestone's stated goal) can mean going forward for user-owned data.

### The mechanism (verified pattern, used by Drizzle's own RLS docs and the community
`drizzle-supabase-rls` reference implementation)

Per-request, wrap the query in a transaction against the **pooled, transaction-mode** URL
(`POSTGRES_URL`, port 6543) and set the RLS context **inside** that transaction with `set_config(...,
true)` (the `true` = "is_local", i.e. transaction-scoped) and `SET LOCAL ROLE`:

```typescript
// packages/db/src/client.ts — NEW export alongside the existing trusted `db`
export async function withRls<T>(
  jwtClaims: { sub: string; role?: string; [k: string]: unknown },
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  return rlsClient.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(jwtClaims)}, true)`);
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${jwtClaims.sub}, true)`);
    await tx.execute(sql`set local role ${sql.raw(jwtClaims.role ?? "authenticated")}`);
    return fn(tx);
  });
}
```

Why this is safe under Supavisor transaction-mode pooling specifically: `SET LOCAL` and
`set_config(..., true)` are **transaction-scoped by Postgres itself**, not by the pooler — they are
automatically reset when the transaction ends, before the underlying connection is ever returned to
the pool. This is what prevents the classic "session variable leaks to the next tenant's request"
pooling bug. `prepare: false` is already set on the `postgres` driver instance in this codebase,
which is the other prerequisite for transaction-mode pooling (already correct, no change needed).

**Keep the existing trusted `db` export** (`POSTGRES_URL_NON_POOLING`, superuser, RLS-bypassing) for
genuinely trusted server-side operations (migrations, background jobs, admin tooling) — that pattern
is fine and matches Supabase's own guidance that service-role bypass is expected for trusted server
code. Add `withRls` as a **second, new** export for anything that should be scoped to a signed-in
user. Wire it into `packages/api-client/src/trpc.ts`'s `createTRPCContext` (currently "no-auth" by
its own docstring) as the natural v1.7 insertion point: extract the Supabase session server-side,
call `withRls` for user-owned-table procedures, keep `db` for system/shared-data procedures.

### The FastAPI side is a different — and simpler — mechanism

FastAPI doesn't talk to Postgres directly; it goes through **PostgREST via `supabase-py`**
(`app/infrastructure/supabase/client.py`, `create_client(url, SUPABASE_SECRET_KEY)`). PostgREST
already has native, zero-SQL RLS integration: when a request carries `Authorization: Bearer
<user-jwt>`, PostgREST verifies it and runs the query as the `authenticated` Postgres role with
`auth.uid()` populated automatically — no `set_config` dance needed on this side at all.

Verified (`postgrest-py/postgrest/base_client.py`): the client exposes
`client.postgrest.auth(token: str)`, which sets the `Authorization: Bearer <token>` header on that
client instance and returns `self`.

**Critical pitfall to flag for the roadmap:** `get_supabase_client()` in `client.py` is
`@lru_cache`'d — a **process-wide singleton** built with the service_role key. Calling `.auth(token)`
on that shared singleton would leak one request's user identity into every concurrent request. Do
**not** reuse it. Add a **new**, `dishka`-`Scope.REQUEST`-provided factory that builds a **fresh**
`Client` per request (still constructed with the public **anon** key, not the secret key) and calls
`.postgrest.auth(user_jwt)` on that fresh instance. `dishka >=1.4.0` (already a dependency) supports
`Scope.REQUEST` natively — no new DI library needed. Keep `get_supabase_client()` exactly as-is for
trusted/system repository operations.

### Net effect
Two independent, already-idiomatic-for-their-stack enforcement paths, both driven by the same
Supabase-issued JWT: Drizzle/Next.js needs the transaction+`set_config` wrapper (new code, zero new
deps); FastAPI/Python needs a request-scoped anon-key client + `.auth(token)` (new code, zero new
deps, uses a client method that already exists in the already-resolved `postgrest-py`).

### Open question for the roadmap (explicitly not resolved here)
Which existing tables move from "trusted service-role + app-level `importer_id`/`user_id` filter"
to "actually RLS-enforced via the mechanism above" in v1.7 vs later? The migration guardrail from
`VISION.md` §3.1 ("keep user_id/tenant scoping columns on new tables from E2 onward") suggests new
v1.7 tables (e.g. anything backing email threads) get real RLS from day one, while retrofitting RLS
onto the ~20 existing Phase-4-era tables is a bigger, separable migration decision — flag as a
phase-planning question, not a stack question.

---

## Architecture Decision 3 — Email threading: hand-roll, don't adopt a library

`jwzthreading` (PyPI, BSD license) is the only real off-the-shelf Python implementation of the JWZ
algorithm. **Do not adopt it**: last released 2010, unmaintained 15+ years, `setup.py`-only
packaging with no `python_requires` metadata (real risk on Python 3.11+/modern pip), and — more
importantly — it solves a bigger problem than this milestone has.

The full JWZ algorithm (tree construction + **subject-based grouping for clients with missing
References headers** + **empty-container pruning** + chronological re-sort for a reply-tree UI) is
built for mail-client-grade robustness against garbage/absent headers across the open email
ecosystem. This app already has clean, reliably-populated `message_id` / `in_reply_to` /
`references_ids[]` on every row (verified: `mime_parser.py` populates all three from RFC 5322
headers on ingestion, has since Phase 4). What v1.7 needs — per `VISION.md`'s "email threads"
requirement — is a **flat grouping** ("which emails belong to the same conversation"), not a
reply-hierarchy renderer.

**Recommendation:** hand-roll a small, pure-Python, stdlib-only connected-components grouper:
- Build an undirected graph: edge between a message and everything in its `in_reply_to` +
  `references_ids`.
- Union-Find (disjoint-set) over `message_id` strings, one pass over all rows for a given importer/
  user — O(n α(n)).
- Persist the result as a `thread_id` (or a `thread_id` FK on a new `email_threads` table, per the
  house convention of a first-class table over a denormalized column — matches how `importers`,
  `entity_types` etc. are modeled elsewhere in this schema).
- Deterministic, trivially unit-testable (TDD-friendly per this repo's workflow rules): feed a list
  of `(message_id, in_reply_to, references_ids)` tuples, assert grouping — no fixtures needed beyond
  plain dicts, no network, no parsing.

This also naturally handles the one case References/In-Reply-To headers alone can't: a `Message-ID`
that's referenced by a later email but whose own row hasn't been ingested yet (forwarded threads,
partial imports) — Union-Find handles "connect these two IDs" even when one side is a placeholder
never resolved to a real row, which is exactly the same edge case JWZ's "container" concept exists
for, minus the pruning/rendering machinery this product doesn't need yet.

**If a future epoch needs a real reply-tree UI** (nested reply visualization, not just flat
grouping — not asked for in v1.7 per `VISION.md` E3 "email/thread cards," which is flat), revisit
JWZ's tree-construction phase specifically at that point — still recommend hand-rolling it directly
from the JWZ algorithm description (jwz.org/doc/threading.html) rather than reviving the abandoned
package, since only the tree-build phase (not the client-compat subject-grouping heuristics) would
likely be relevant to a single, reliable-header pipeline like this one.

---

## Architecture Decision 4 — Atomic rename tooling: zero-dependency script, not a codemod framework

This is a **literal string substitution** problem, not a symbol-aware refactor problem:
`@nauta/foo` → `@polytoken/foo`, `Nauta` → `Polytoken`, `nauta` → `polytoken`, `NAUTA` → `POLYTOKEN`
across `package.json` `name`/`dependencies` fields, `.ts`/`.tsx` import specifiers, root
`package.json` script `-w @nauta/x` flags, Markdown/docs, and UI copy. It is not a rename of a
JS/TS *symbol* that requires type-aware, scope-aware refactoring (which is what `ts-morph`/
`jscodeshift`/`ast-grep` exist for) — the token `@nauta/` is distinctive enough that plain
substring replacement across source files is safe.

**Recommendation: a one-off, throwaway Node script using only `node:fs`/`node:path`/`node:url`
(zero new dependencies)**, consistent with this repo's demonstrated preference (v1.4: "zero new npm
dependencies"; v1.6: 2 of 3 tools shipped with zero new backend deps). Shape:
1. `git grep -ril nauta -- . ':!node_modules' ':!*.pdf'` first, as an audit/allowlist pass — review
   the file list before touching anything (catches surprises: infra `.tf`, `.github/workflows`,
   `graphify-out/` generated artifacts that probably should be regenerated instead of
   hand-rewritten).
2. Script walks the reviewed file list (not a blind glob — explicit list from step 1), applies
   ordered case-sensitive replacements (`@nauta/` before bare `nauta`, to avoid double-mangling),
   writes back only files that actually changed.
3. Explicit exclusions, decided at the phase-planning stage, not by the script: binary files (the
   two design-case PDFs — can't be text-replaced anyway, and per PROJECT.md's own framing they
   document the *fictional client* the original design case was about, not the product's own old
   brand — leave as historical record), already-applied migration SQL files under
   `packages/db/migrations/*.sql` (append-only historical record — this repo's own convention per
   `emails` table being "append-only... nothing here is ever mutated after insert," the same
   discipline should extend to shipped migrations), and `.git/` history (out of scope by
   definition — rewriting git history is a separate, far riskier operation not implied by "atomic
   rename").
4. **After** renaming every `package.json` `"name"` field, `rm -rf node_modules && npm install` is
   mandatory — npm workspaces resolves `node_modules/@scope/pkg` symlinks from the `name` field at
   install time; stale `node_modules/@nauta/*` symlinks will silently keep resolving to the old
   scope until reinstalled. Flag this explicitly as a post-rename verification step (a build that
   still passes with stale symlinks present would be a false-positive gate).

**What NOT to introduce:** `ast-grep`/`jscodeshift`/`ts-morph` as new devDependencies. They're the
right tool when a rename needs to distinguish "this identifier" from "this substring that happens to
match" (e.g., renaming a function called `parse` without touching the word "parse" in comments) —
that's not this problem. Adding an AST-refactor framework for a prefix-swap is exactly the kind of
new-dependency-for-a-one-time-task this repo's history avoids.

**Scope boundary already set by `PROJECT.md`, not re-litigated here:** external renames (GitHub
repo, AWS resource names, Vercel project, domain) are explicitly out of this milestone's autonomous
scope and go to a user runbook — Terraform *source* variable/module names can be renamed freely as
code, but literal resource-name strings that map to **already-provisioned** live AWS resources
(ECS cluster/service names, etc.) should NOT be changed by the same codemod pass unless a live
infra migration is separately planned; changing the HCL string without a migration plan risks
Terraform wanting to recreate (not rename) those resources on next `apply`.

---

## Installation

```bash
# Next.js side — the ONE new npm dependency for the entire auth epic
npm install @supabase/ssr -w @nauta/web   # (rename -w flag alongside the package rename, see above)

# FastAPI side — make an already-transitive dependency explicit (zero net-new install)
cd apps/email-listener && uv add pyjwt      # resolves to the already-locked 2.13.x
# If the project turns out to be on the new asymmetric signing keys (verify in Supabase
# Dashboard → Settings → API → JWT Keys before deciding):
uv add "pyjwt[crypto]"                      # adds the `cryptography` backend for ES256 verification
```

No new dependency is needed for: RLS enforcement (pure `drizzle-orm`/`postgres` + `postgrest-py`
code using APIs already present), email threading (pure stdlib), or the rename (pure `node:fs`).

---

## Alternatives Considered

| Recommended | Alternative | When the alternative would actually be better |
|---|---|---|
| Supabase Auth (GoTrue) + `@supabase/ssr` | Auth.js v5 (`next-auth@beta`) | If this app were multi-database or wanted auth fully decoupled from Postgres/Supabase (portability) — not the case here; the app is Supabase-Postgres-first and RLS-dependent by design |
| Supabase Auth | Custom OAuth (e.g. `arctic` + hand-rolled sessions) | If Google were one of many providers with heavily custom consent/claims logic Supabase Auth's provider config can't express — not the case for a single Google-only sign-in |
| `withRls` transaction-wrapper on the pooled URL | Drizzle's declarative `pgPolicy`/`crudPolicy` (`drizzle-orm/pg-core`, or `drizzle-orm/neon`'s convenience wrapper) | If the team wanted RLS policy *definitions* to live in TS schema files instead of raw SQL migrations — a bigger, separate convention change; this repo's migrations (`0001_rls_deny_all.sql`, `0020_...rls.sql`) already establish raw-SQL-migration as the house pattern for policy DDL, only the runtime *enforcement* wrapper is new |
| Hand-rolled Union-Find threading | `jwzthreading` (PyPI) | Only if a mail-client-grade reply-tree UI with subject-based grouping for missing-header emails becomes a real requirement — not v1.7's flat "email threads" scope |
| Zero-dep Node rename script | `ast-grep`/`jscodeshift`/`ts-morph` | If renames needed identifier-vs-substring disambiguation (not the case for a distinctive `@nauta/` prefix) or if this were going to be a recurring/ongoing codemod need rather than a one-time atomic rename |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `next-auth@5.x` for this milestone | Still beta after years of RC (verified July 2026); has no native path to the `auth.uid()`/RLS JWT shape this app's Postgres policies already expect | Supabase Auth |
| `jwzthreading` (PyPI) | Unmaintained since 2010, `setup.py`-only packaging, solves subject-grouping/pruning problems this app's clean header data doesn't have | Hand-rolled Union-Find over `message_id`/`in_reply_to`/`references_ids` |
| Reusing `get_supabase_client()` (the `@lru_cache` singleton, service_role key) for user-scoped RLS calls | It's process-wide — calling `.auth(token)` on it leaks one request's identity into concurrent requests | A new `Scope.REQUEST`-provided fresh `Client` (anon key) per request |
| `POSTGRES_URL_NON_POOLING` (session mode / superuser) for any query that should be RLS-scoped to a user | That's precisely the connection this codebase's own client.ts comment documents as RLS-bypassing by design | `POSTGRES_URL` (pooled, transaction mode) wrapped in the `withRls` transaction pattern |
| A blind `sed -i 's/nauta/polytoken/g'` glob over the whole repo | Windows/Git-Bash `sed` portability issues, no chance to review the file list first, will happily mangle `.git/`, `node_modules/`, PDFs, and historical migration files if not excluded | The `git grep`-audited, explicit-file-list Node script described above |

## Stack Patterns by Variant

**If a v1.7 table is net-new and user-owned (e.g. anything backing email threads):**
- Give it a real `user_id uuid not null references auth.users(id)` (or your own `users`
  mirror table — decide at phase-planning time whether to read `auth.users` directly or
  maintain a synced `public.users` row) from day one, with a real (not deny-all) RLS policy
  scoped to `auth.uid() = user_id`, exercised through `withRls`/`.postgrest.auth()`.
- Because: `VISION.md`'s own guardrail #1 says keep tenant-scoping columns on all new tables
  from E2 onward — cheapest to do at table-creation time, not retrofitted later.

**If a v1.7 change touches an existing Phase-4-era shared/system table (e.g. `entity_types`
system defaults):**
- Leave it on the trusted `db`/`get_supabase_client()` path with the existing deny-all RLS +
  app-level `importer_id` filtering, unless the roadmap explicitly schedules that table's
  tenancy migration.
- Because: retrofitting real per-user RLS onto ~20 existing tables is a separable, larger
  migration than this milestone's stated scope ("user_id scoping on user-owned tables" —
  not "every table").

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `@supabase/supabase-js` | 2.108.1 (installed) | `@supabase/ssr` requires `@supabase/supabase-js ^2` | Already satisfied, no bump needed |
| `@supabase/ssr` | ^0.12.0 (verify exact patch at install time — actively released, ~monthly cadence) | Next.js 13+ App Router | Works with the installed Next.js 15.3.3 / React 18.3 (no React 19 requirement) |
| `drizzle-orm` | ^0.44.2 (installed) | `postgres` ^3.4.7 (installed) | `prepare: false` already set — no change needed for transaction-pooler compat |
| `supabase-py` / `postgrest` / `supabase-auth` | 2.31.0 (all three, resolved lockstep) | Python 3.11 (project floor) | `postgrest-py`'s `Client.postgrest.auth(token)` verified present in this resolved version's source |
| `pyjwt` | 2.13.0 (already resolved transitively) | Add `[crypto]` extra only if the project uses ES256 asymmetric signing keys | Verify signing-key mode in Supabase Dashboard before choosing symmetric vs `[crypto]` |

## Sources

- `orm.drizzle.team/docs/rls` — Drizzle's own RLS docs: `pgPolicy`, expected Supabase roles
  (`authenticated`/`anon`/`service_role`), `set_config`-in-transaction pattern (HIGH confidence)
- `github.com/rphlmr/drizzle-supabase-rls` — reference implementation of the transaction+
  `set_config`+`SET LOCAL ROLE` wrapper for Drizzle+Supabase (MEDIUM-HIGH, community pattern
  but structurally matches Drizzle's own docs)
- `orm.drizzle.team/docs/connect-supabase` — confirms no Supabase-specific Drizzle RLS helper
  exists (generic `pgPolicy` from `drizzle-orm/pg-core` is the only declarative option); pooling
  guidance (`prepare: false` for transaction mode) (HIGH)
- `github.com/supabase/postgrest-py` (`postgrest/base_client.py`, fetched directly) — verified
  `Client.postgrest.auth(token)` method signature in the currently-resolved 2.31.0 (HIGH)
- `supabase.com/docs/guides/auth/jwts` — symmetric (legacy) vs asymmetric (current) JWT signing
  keys, JWKS endpoint pattern (`/auth/v1/.well-known/jwks.json`), local verification guidance
  (MEDIUM — exact signing-key mode of *this* project not directly verified)
- `supabase.com/docs/guides/auth/social-login/auth-google` — Google OAuth setup, fixed
  `/auth/v1/callback` redirect URI, `config.toml [auth.external.google]` fields (HIGH)
- `supabase.com/docs/guides/auth/server-side/nextjs` — `@supabase/ssr` middleware pattern,
  `getUser()` vs `getSession()` guidance for App Router (HIGH)
- `authjs.dev/getting-started/migrating-to-v5`, `github.com/nextauthjs/next-auth/discussions/13382`
  — confirms Auth.js v5 beta status as of July 2026 (MEDIUM — community discussion, not a
  version-number-verified release page, but corroborated across multiple independent sources)
- `pypi.org/project/jwzthreading/` — confirms last release 2010, BSD license, no listed deps (HIGH)
- `jwz.org/doc/threading.html` — original JWZ algorithm description, referenced for the "if you
  need a real reply-tree later" fallback (HIGH — primary source)
- Direct codebase reads: `packages/db/src/client.ts`, `packages/db/migrations/0001_rls_deny_all.sql`,
  `packages/db/src/schema/{emails,importers}.ts`, `packages/api-client/src/trpc.ts`,
  `apps/email-listener/app/infrastructure/supabase/client.py`,
  `apps/email-listener/app/presentation/middleware/auth.py`,
  `apps/email-listener/app/domain/{entities/email.py,services/mime_parser.py}`,
  `apps/web/src/app/api/chat/{stream,regenerate,widget/submit}/route.ts`,
  `apps/email-listener/app/container.py`, `supabase/config.toml`, `.env.example`,
  `apps/email-listener/uv.lock`, `apps/email-listener/pyproject.toml` (all HIGH — primary source,
  this repo)

---
*Stack research for: v1.7 polytoken.ai Foundation (auth, tenancy/RLS, email threading, atomic
rename)*
*Researched: 2026-07-09*
