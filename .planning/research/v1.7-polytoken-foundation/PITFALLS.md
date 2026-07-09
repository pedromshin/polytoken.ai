# Pitfalls Research — v1.7 polytoken.ai Foundation

**Domain:** Retrofitting auth (Google OAuth), per-user tenancy + Supabase RLS, email threading,
and a big-bang monorepo rename onto a LIVE single-tenant system (Supabase Postgres, Drizzle
migrations 0001–0030, dual backend: Next.js/tRPC on Vercel + FastAPI on ECS Fargate).
**Researched:** 2026-07-09
**Confidence:** HIGH for pitfalls grounded directly in this repo's code (cited file:line);
MEDIUM/LOW for general OAuth/email-threading domain knowledge, marked inline.

## Scope Note

Every pitfall below is evidence-anchored to this codebase unless explicitly marked "general
knowledge." This is a retrofit, not a greenfield build — the dangerous failure mode throughout
is **silent regression of an isolation boundary that currently doesn't need to exist** (single
shared tenant today → real per-user stakes tomorrow) and **big-bang operations on live
infrastructure** (rename, RLS flip). Read `.planning/research/v1.7-polytoken-foundation/
FEATURES.md` for the feature landscape this document assumes.

---

## Critical Pitfalls

### Pitfall 1: RLS Theater — the app already connects as a role that bypasses RLS by design

**What goes wrong:**
Every table gets `ENABLE ROW LEVEL SECURITY` + real per-user policies, migrations run clean,
`GET /knowledge` etc. look correctly scoped in the UI — and every single query still returns
every tenant's rows, because the connection making the query was never subject to RLS in the
first place. The policies are decorative.

**Why it happens:**
This is not hypothetical for this repo — it is the **current, documented, intentional**
architecture. `packages/db/src/client.ts:28-36` states outright:

> "Use session-mode connection (POSTGRES_URL_NON_POOLING) for Drizzle. The transaction-mode
> pooler (port 6543) strips superuser privileges, causing RLS policies to block all queries
> (auth.uid() returns NULL). The session-mode connection (port 5432) preserves the postgres
> role and bypasses RLS."

Drizzle connects directly via `postgres.js` as the Postgres **superuser role**, which — per
Supabase's own default posture — always bypasses RLS regardless of connection mode. Every RPC
added so far (`0009_retrieval_rpcs.sql`, `0017_entity_resolution_rpcs.sql`,
`0029_knowledge_search_extracted_only.sql`) is `SECURITY INVOKER` (the safe default) and
explicitly comments "so RLS still applies" — but that comment is only true if the invoking
role is subject to RLS, which the app's role never is. Migration `0029`'s own comment confirms
this is understood as acceptable *today*: "the Python backend connects via the
service-role/postgres role that already bypasses RLS, same posture as every other
knowledge_nodes read/write path." That posture is exactly what v1.7 must break.

**How to avoid:**
This is an architecture decision the roadmap must make explicit, not an implementation detail
to leave to a phase plan:
- **Option A (real RLS):** stop connecting as `postgres`/`service_role` for user-facing reads.
  Route tenant-scoped reads through a connection/role that Postgres actually applies RLS to —
  either (a) Supabase's PostgREST/Data API via `@supabase/ssr`'s server client (which already
  exists as a dependency — `apps/web/src/app/api/attachments/[id]/route.ts` uses
  `@supabase/supabase-js`), which correctly wires JWT → `authenticated` role → `auth.uid()` per
  request, or (b) a second, narrowly-privileged Postgres role for Drizzle that Drizzle
  authenticates as per-request (not the shared superuser pool), with `SET LOCAL request.jwt.claims`
  set inside an explicit transaction per request.
- **Option B (RLS as defense-in-depth only, not primary boundary):** keep the current
  superuser/Drizzle path, treat RLS policies as a second belt that only matters if someone
  connects with the anon/authenticated Supabase key directly (already the case for
  `0001_rls_deny_all.sql`'s threat model — T-04-01/T-04-02 cross-tenant *direct* access), and put
  the *actual* enforcement in application code (every repository method takes and filters by
  `userId`/`importerId`, reviewed exhaustively — see Pitfall 5).
- Whichever is chosen, write it down as a Key Decision in PROJECT.md — this is exactly the kind
  of decision that silently reverts if a future contributor "simplifies" the DB client back to
  the superuser connection because it's simpler and tests still pass (tests run as postgres too,
  see Pitfall 4).

**Warning signs:**
- A test suite that never asserts "user B's session, querying user A's data, gets zero rows" —
  every existing test in this repo queries via the `db` Drizzle handle directly (superuser), so
  passing tests currently prove nothing about RLS.
- `EXPLAIN` on a "scoped" query shows no `Filter` referencing the RLS policy predicate at all
  (because the planner never applied it — invisible unless you check).
- Grep for `postgres(connectionUrl` / `POSTGRES_URL_NON_POOLING` usage growing into new
  user-facing read paths without a parallel RLS-subject path ever being introduced.

**Phase to address:**
Tenancy/RLS phase — this is the load-bearing architectural decision the whole phase's design
must resolve *before* writing policies, not after.

---

### Pitfall 2: Pooler vs. `auth.uid()` — the exact failure this codebase already hit once

**What goes wrong:**
A new per-request, JWT-scoped connection path is built (per Pitfall 1's Option A) and pointed at
the transaction-mode pooler (port 6543, `POSTGRES_URL`) for throughput — and `auth.uid()`
intermittently or always returns `NULL`, so every RLS policy fails closed (or open, if written
carelessly as `auth.uid() IS NULL OR ...`).

**Why it happens:**
Already root-caused once in this codebase (`client.ts:28-36`, see Pitfall 1) — Supavisor's
transaction-mode pooler multiplexes a physical connection across many logical clients between
transactions, so session-scoped state (`SET LOCAL`, `set_config`, and the role Postgres sees)
does not reliably persist the way a raw `postgres.js` connection assumes. This is also documented
generally by Supabase: session-mode (or the Shared Pooler in session mode) is required when a
feature needs persistent session state; transaction mode is not designed for it. If v1.7 solves
Pitfall 1 by routing through Supabase's Data API (PostgREST), this is a non-issue (PostgREST
manages the JWT→role wiring per-request correctly through the pooler). If v1.7 solves it with a
custom Drizzle-based per-request role/claim path, this failure mode returns.

**How to avoid:**
- Prefer PostgREST/Data API (`@supabase/ssr` server client) for the RLS-subject path — it is
  purpose-built for this and already used once in this repo (attachments route). Don't reinvent
  per-request `SET LOCAL request.jwt.claims` over a pooled raw connection.
- If a raw-connection path is unavoidable, use the session-mode/non-pooling URL (already the
  precedent in this repo) for that specific role, and prove it with a live integration test
  against staging (not just unit tests against a local Postgres, which will not reproduce
  pooler behavior).
- Never assume `auth.uid() IS NULL` on a policy predicate is "fail closed and therefore safe" —
  check whether the write path underneath the RLS check has a permissive fallback that
  activates precisely when the claim is missing.

**Warning signs:**
- RLS behaves correctly locally (session-mode local Postgres, no pooler) and breaks only in
  staging/production (where Supavisor sits in front) — a classic "works on my machine" trap for
  this specific problem class.
- Intermittent (not 100%) `auth.uid()` NULLs — points at connection reuse/multiplexing, not a
  code bug, and will not repro reliably in manual testing.

**Phase to address:**
Tenancy/RLS phase, same design decision as Pitfall 1. Verify with a live-staging smoke test
(999.3 kickoff-hygiene precedent already exists for "connected-env verification" — apply the
same discipline here).

---

### Pitfall 3: Client-supplied tenant ID as the trust boundary (the real vulnerability, not RLS)

**What goes wrong:**
Even if RLS is airtight, an endpoint that accepts `importer_id`/`user_id` as a caller-supplied
parameter (query string, JSON body) rather than deriving it server-side from the verified
session lets any authenticated (or, today, any API-key-holding) caller read or act on another
tenant's data by simply passing a different ID. This is the single most common real-world
tenancy bug and it already exists in this codebase in multiple places, by explicit prior design
decision that v1.7 must now retire.

**Why it happens:**
`PROJECT.md`'s own "Out of Scope" section states the current stance plainly: *"Real auth
boundary (X-API-Key is installation-wide; importer_id is data partitioning, not auth)."*
Concretely:
- `apps/email-listener/app/presentation/api/v1/emails.py:113-116` — `list_by_importer` accepts
  `importer_id: str | None = Query(...)` directly from the caller; the file's own docstring
  (line 4-5) says `X-API-Key` is an "installation-wide principal; importer_id is data
  partitioning from D-05 sender resolution, NOT an auth boundary."
- `apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts:21` — `PROMOTE_BODY_SCHEMA =
  z.object({ importerId: z.string().uuid() })` — the **client's JSON body** supplies the
  `importerId` that gets forwarded upstream; nothing derives it from a session because no
  session exists yet.
- FastAPI has no CORS middleware configured anywhere (confirmed by search) — it is only ever
  called server-to-server from Next.js API routes using a shared `EMAIL_LISTENER_API_KEY`. That
  key proves "this call came from our Next.js server," never "this call is on behalf of user X."
  Once real users exist behind Next.js, that gap becomes exploitable if Next.js ever forwards a
  client-asserted user/importer ID instead of a session-derived one.

**How to avoid:**
- Full sweep, not spot-fixes: grep every FastAPI route and every tRPC procedure for
  `importer_id`/`importerId` accepted as a query param, body field, or header, and change each
  one to be derived server-side from the authenticated session (Next.js resolves
  `session → userId → importerId` once, server-side, and either (a) does the query itself via a
  now-`protectedProcedure` tRPC context, or (b) if still proxying to FastAPI, sends the
  session-derived ID as a value FastAPI trusts *because it came from the trusted Next.js server
  process*, not because the browser supplied it).
- Distinguish read/action endpoints (client-facing, need this fix) from the ingestion path —
  `ingest_inbound_email` resolves `importer_id` server-side from the sender's domain via
  `importer_resolver.py`, which is already correct and does not need to change.
- Add a lint/review checklist item: "does this endpoint accept a tenant ID from the caller, and
  if so, is it re-validated against the session before use?" — this is the single highest-value
  code-review question for the whole milestone.

**Warning signs:**
- Any Zod/Pydantic schema with a `*Id` field named after the tenant concept (`importerId`,
  `userId`) sitting in a request body or query params schema for a client-facing route.
- A route that forwards a body field straight into a proxied FastAPI call without first
  re-deriving it from `ctx.session` (`promote/route.ts` is the existing example to fix and use
  as the template case).

**Phase to address:**
Tenancy/RLS phase, as the primary line item (not RLS policies — this is the higher-value fix).
Should be verified with an actual adversarial test: authenticate as user B, attempt to read/act
on user A's known resource ID, assert 403/404.

---

### Pitfall 4: Forgotten tables/routes leak cross-user data — confirmed example already in the codebase

**What goes wrong:**
Tenancy is retrofitted onto the "obvious" tables (emails, entities, knowledge nodes) and the
UI looks correctly scoped — but a route that reads by primary key alone, with no tenant filter
at all, keeps working for any authenticated user against any other user's row, because nobody
re-audited it once real stakes existed.

**Why it happens:**
Confirmed today: `apps/web/src/app/api/attachments/[id]/route.ts:44-49` looks up
`EmailAttachments` **by `id` alone** — no `importerId`/tenant filter anywhere in the query —
then mints a signed Supabase Storage URL for whatever it finds. Under the current single-tenant
posture this is harmless (there is only one tenant). Under per-user tenancy it becomes: any
signed-in user who knows or enumerates an attachment UUID can download another user's email
attachment. This is exactly the "forgotten route" failure mode the milestone brief calls out,
and it is not hypothetical — it exists today and must be swept, not assumed away because "the
tables all have importer_id."

**How to avoid:**
- Do not audit by table — audit by **route/procedure**. Every FastAPI endpoint and every tRPC
  procedure that reads or writes a row by ID needs an explicit tenant-ownership check, even (
  especially) ones that look like simple "get by primary key" lookups, because those are the
  ones most likely to have been written before tenancy existed and never revisited.
  Cross-reference `research/v1.7-polytoken-foundation/FEATURES.md`'s note that BlendedRAG/
  pgvector retrieval RPCs are "non-obvious leak surfaces" — the same applies to any
  storage-signed-URL, file-download, or export endpoint.
- Build a mechanical check, not just a manual review pass: a test that iterates every tRPC
  procedure and every FastAPI route accepting an `id`-shaped param, creates two tenants' worth
  of fixture data, and asserts cross-tenant access is denied. This is worth the up-front cost
  because "I reviewed all the routes" does not scale as new routes are added later (v1.8+).
- Treat Supabase Storage paths the same as DB rows — signed URLs generated via the
  `SUPABASE_SERVICE_ROLE_KEY` (as in the attachments route) bypass Storage-level RLS entirely
  by design; the ownership check has to happen in application code before the signed URL is
  minted, not by relying on Storage policies.

**Warning signs:**
- Any route using `.service_role`/`SUPABASE_SERVICE_ROLE_KEY` credentials to fetch a resource by
  ID with no preceding ownership check in the same function.
- A resource type that has exactly one read path today (so it "hasn't come up") — those are
  statistically the most likely to be missed, precisely because there's no existing pattern to
  copy correctly or incorrectly from.

**Phase to address:**
Tenancy/RLS phase — should be the phase's own acceptance gate ("full route/procedure sweep,
verified by adversarial cross-tenant test"), not left as an implicit side effect of adding RLS
policies to tables.

---

### Pitfall 5: SECURITY DEFINER functions silently reintroducing an RLS bypass

**What goes wrong:**
A new SQL function needs elevated privilege to do something a newly-restricted `authenticated`
role legitimately can't (e.g., provisioning a new `importers`/tenant row on first login, when
the calling role has no INSERT grant on that table by design). It gets marked
`SECURITY DEFINER` to solve that — and because Postgres does not automatically apply the
*caller's* RLS policies inside a `SECURITY DEFINER` function (it runs with the *definer's*
privileges), the function becomes a new, unaudited RLS bypass unless it manually re-checks
`auth.uid()`/ownership inside its own body.

**Why it happens:**
Confirmed: **zero** `SECURITY DEFINER` functions exist anywhere in migrations 0001–0030 today
(grep across `packages/db/migrations/*.sql` — no matches). Every existing RPC
(`0009_retrieval_rpcs.sql`, `0015_denied_polygon_append_rpc.sql`, `0017_entity_resolution_rpcs.sql`)
is explicitly `SECURITY INVOKER` with a comment stating so. This is good hygiene today — but it
means there is **no existing pattern in this codebase to copy** for the one case v1.7 plausibly
needs it (first-login tenant provisioning, or any function that must write across the
soon-to-be-restricted `authenticated` role's grants). Whoever writes that first `SECURITY
DEFINER` function is working from general internet examples, not house convention, which is
exactly how an unaudited bypass gets introduced.

**How to avoid:**
- If a `SECURITY DEFINER` function is genuinely needed (e.g., "create my importer row on first
  Google sign-in"), scope it as narrowly as possible: it should do exactly one privileged thing,
  take `auth.uid()` (never a caller-supplied user ID param) as its only identity input, and
  contain an explicit guard (e.g., "insert exactly one row owned by `auth.uid()`, error if one
  already exists") rather than accepting arbitrary parameters.
- Add a repo-level guard (grep in CI, or a code-review checklist item) that flags any new
  `SECURITY DEFINER` in a migration diff for mandatory extra review — cheap insurance given the
  function type doesn't exist in the codebase yet.
- Remember `CREATE OR REPLACE FUNCTION` on an *existing* `SECURITY INVOKER` function preserves
  its security property unless explicitly redeclared — but a future edit that copy-pastes from
  an unrelated example online could add `SECURITY DEFINER` without anyone noticing it's a
  privilege change, not just a logic change.

**Warning signs:**
- Any new migration containing `SECURITY DEFINER` — should always trigger a "why does this need
  elevated privilege, and what stops it being called on someone else's behalf" review question.
- A `SECURITY DEFINER` function that accepts a `user_id`/`importer_id` parameter instead of
  reading `auth.uid()` internally — the parameter is exactly the shape of Pitfall 3's
  client-supplied-tenant-ID bug, just inside SQL instead of an API route.

**Phase to address:**
Tenancy/RLS phase, specifically wherever first-login tenant provisioning is designed.

---

### Pitfall 6: RLS-owned policies vs. Drizzle-owned schema — the drift Drizzle can't see

**What goes wrong:**
RLS policies live in hand-written custom SQL migrations (every existing RLS migration in this
repo — `0001_rls_deny_all.sql`, `0020_knowledge_node_edges_rls.sql` — is exactly that: raw
`CREATE POLICY` statements, not something `drizzle-kit generate` emits from the Drizzle schema
files). If anyone edits a policy directly in the Supabase Studio SQL editor (common during
live debugging — e.g. "let me just temporarily loosen this policy to unblock myself"), Drizzle
has no way to detect the drift: `drizzle-kit generate` diffs against the Drizzle *table* schema,
not against policy definitions, so the next migration won't reconcile a manually-changed policy,
and the repo's migration history silently stops being the source of truth.

**Why it happens:**
This is a structural limitation of the tool split already visible in how this repo's RLS
migrations are authored (custom SQL blocks, `--> statement-breakpoint` markers, `DROP POLICY IF
EXISTS` idempotency guards — `0020`'s comment literally says "Idempotent so it is safe to re-run
against an environment where it was applied manually," which is itself an admission that
manual application has happened before). v1.7 will add many more, higher-stakes policies
(`auth.uid() = user_id`-shaped, not just deny-all), raising the cost of drift substantially.

**How to avoid:**
- Every RLS policy change goes through a migration file, full stop — never through the Supabase
  Studio SQL editor, even "temporarily," even in staging. If a live fix is genuinely urgent,
  write the migration first and apply it the normal way.
- Add a periodic (or CI) check that diffs live `pg_policies` in staging/prod against what the
  migration history would produce from a clean apply — cheap to script, catches drift before it
  compounds silently for months.
- Keep policies co-located with the table's own migration file where possible (as `0001` already
  does per-table) rather than one giant catch-all RLS migration — makes it obvious which policy
  belongs to which table when reviewing a diff.

**Warning signs:**
- `SELECT * FROM pg_policies WHERE schemaname = 'public'` in staging/prod returns a policy whose
  `USING`/`WITH CHECK` text doesn't match any migration file in the repo.
- A bug that "only happens in production" for an RLS-gated query, that can't be reproduced by
  replaying migrations locally — points directly at drift.

**Phase to address:**
Tenancy/RLS phase — establish the discipline in the first policy-authoring PR of the phase, not
after drift has already happened once.

---

### Pitfall 7: Backfilling the existing single tenant into "user 1" — the migration that can't be re-run

**What goes wrong:**
Every table already carries `importer_id`, and there is exactly one seeded importer today —
`DEFAULT_IMPORTER_ID = 00000000-0000-0000-0000-000000000001`
(`packages/db/migrations/0005_seed_default_importer.sql`). Adding real per-user tenancy means
deciding what happens to every row currently owned by that default importer. Get the backfill
direction or idempotency wrong and either (a) all existing emails/entities/knowledge graph data
becomes permanently orphaned/inaccessible the moment RLS goes live, or (b) the backfill migration
can't be safely re-run against staging vs. production (which have different histories — staging
ref `fyfwkjvbcrmjqjysdyqw`, production ref `dazyccjijdahxyciptkp`, per project memory) without
double-mapping or silently no-op'ing.

**Why it happens:**
The default importer is a hardcoded, well-known fixed UUID baked into a migration, referenced
throughout the ingestion pipeline (`apps/email-listener/app/domain/ports/importer_resolver.py`
falls back to it "for malformed senders"). It is not a placeholder that gets deleted — it is
live, real data (the actual emails ingested during v1.0–v1.6 development and any live-forwarded
test mail). A naive "add `user_id` NOT NULL" migration will fail outright on existing rows; a
naive "add `user_id` nullable, backfill to whoever signs up first" migration is a race if more
than one person can complete OAuth before the backfill runs once.

**How to avoid:**
- Standard expand → backfill → contract shape (already the plan in `FEATURES.md`'s Feature 2
  table stakes): add the new column nullable first, ship the OAuth flow, run an explicit,
  idempotent backfill step tying `DEFAULT_IMPORTER_ID`'s existing rows to the first real
  authenticated user (guard: refuse to run, or make a no-op, if the default importer already has
  a non-null owner), then tighten to `NOT NULL` in a later migration once verified.
- Decide *now*, not during incident response, whether "first user to sign in claims the legacy
  data" is actually the intended product behavior (it matches this being a personal,
  single-user-first product per VISION.md) or whether it needs an explicit
  claim/confirmation step so a stray second sign-in (e.g. testing with a second Google account)
  doesn't silently NOT get the legacy data and think something broke.
- Test the backfill against a staging copy with real row counts before running it against
  production — this is exactly the kind of one-shot migration where "it worked in a fresh local
  DB with 3 seed rows" proves nothing.

**Warning signs:**
- A migration that assumes exactly zero or exactly one existing importer row — verify against
  actual staging/prod row counts in the `importers` table before writing the backfill, don't
  assume `0005`'s seed is the only row that ever got created.
- No idempotency guard on the backfill UPDATE — re-running it (e.g., because a deploy retried)
  should be a safe no-op, not a second mutation.

**Phase to address:**
Tenancy/RLS phase, as an explicit, reviewed, staging-rehearsed migration step — not folded
silently into the same migration that adds the RLS policies.

---

### Pitfall 8: Unique constraints that were correctly global becoming a per-signup collision surface (and the inverse mistake)

**What goes wrong:**
Two distinct failure directions exist here, and it's easy to fix one while introducing the
other:
1. `Importers.slug` is `text("slug").notNull().unique()` **globally**
   (`packages/db/src/schema/importers.ts:16`) — fine when there is exactly one row ("default"),
   untested the moment tenant-provisioning happens automatically on every Google sign-in. If the
   provisioning logic derives a slug from the user's name/email local-part (a natural choice),
   two users with colliding derived slugs (common first names, or two people with the same
   email local-part at different domains) will hit a unique-constraint violation at signup —
   and if that error isn't handled gracefully, "sign in with Google" simply fails for the second
   colliding user with a raw DB error.
2. The inverse mistake: `entity_types_importer_id_slug_unique`
   (`packages/db/src/schema/entity-types.ts:67`) already correctly scopes slug uniqueness to
   `(importer_id, slug)` — this is the *right* pattern to copy for new per-user-owned resources.
   The risk is copying this pattern reflexively onto a column that should stay globally unique
   (e.g., a future `users.email` — that one must remain globally unique; scoping it "per tenant"
   the way `entity_types` scopes slugs would allow the same email to sign up twice under two
   different tenants, breaking OAuth identity assumptions).

**Why it happens:**
Every existing per-importer unique constraint in this codebase was written for a
system that only ever had one real importer — none of them has been exercised under real
concurrent multi-tenant writes yet. The `entity_types` nullable-`importer_id` interaction is also
non-obvious: Postgres treats `NULL <> NULL` in unique indexes, so multiple system-default rows
with `importer_id = NULL` and identical slugs would **not** collide (silently allowed) — a subtle
behavior worth knowing before assuming "it's a unique index, it'll catch problems."

**How to avoid:**
- For every new or changed table in this milestone, explicitly decide per-column whether
  uniqueness is (a) global (identity-shaped: email, OAuth subject ID) or (b) per-tenant
  (`entity_types`-shaped: user-chosen names/slugs) — don't default to copying whichever pattern
  is closest in the file.
  the pattern is closest in the file.
- If tenant slugs are auto-derived from user identity, either don't rely on a raw derived slug
  being collision-free (append a short random suffix / use the OAuth subject ID as the row's
  natural key instead of a human-readable slug) or catch the unique-violation and retry with a
  suffix — but handle it, don't let it surface as an unhandled 500 on the second real user's
  first sign-in.

**Warning signs:**
- A provisioning path that inserts a derived slug without a collision-retry loop or a uniqueness
  strategy that doesn't depend on human names being unique.
- Any new unique index copied from `entity_types`'s `(importer_id, slug)` shape onto a column
  that's actually meant to identify a *person*, not a tenant-owned resource.

**Phase to address:**
Tenancy/RLS phase, specifically the tenant-provisioning-on-signup design.

---

### Pitfall 9: Dual-backend OAuth — FastAPI never sees the session, and the shared API key doesn't carry identity

**What goes wrong:**
Google OAuth ships, sessions work correctly in Next.js, and the UI looks fully gated — but the
FastAPI service (ECS, reached only via server-side proxy routes today, e.g.
`apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts`) still has no concept of "which
user is this." Its only auth primitive remains `require_api_key`
(`apps/email-listener/app/settings.py:83`, `API_KEY_HEADER = "X-API-Key"`), a single
installation-wide shared secret. Every proxy route that forwards a request to FastAPI must
therefore invent, ad hoc, how "this request is on behalf of user X" gets communicated and
trusted — and if even one route does it by re-trusting a client-suppliable field instead of a
session-derived one, that route is Pitfall 3 all over again, just at the service boundary
instead of the tenant-ID-field level.

**Why it happens:**
Confirmed structurally: no CORS middleware exists anywhere in the FastAPI app (grep across
`apps/email-listener/app` found none) — meaning FastAPI has never needed to think about
browser-origin session cookies at all, because the browser has never called it directly; only
Next.js server code does, using the shared API key. That's a clean boundary today *because there
is nothing user-specific to get wrong yet*. OAuth changes that: Next.js now holds a real,
verified user identity (via `@supabase/ssr` cookies, scoped to the Vercel domain) that FastAPI
has no independent way to verify, and the existing shared-secret model was never designed to
carry per-request identity.

**How to avoid:**
- Design one new, narrow primitive for "Next.js asserts this request is on behalf of user/
  importer X" — e.g., a short-lived signed token (HMAC'd with a server-only secret, or a
  Supabase-issued JWT re-validated by FastAPI) carrying the session-derived `importer_id`, sent
  alongside `X-API-Key` on every proxied call. Do **not** just add an `importer_id` field to the
  existing JSON body/query params and call it done — that's indistinguishable from the
  client-supplied pattern in Pitfall 3 unless FastAPI can prove the value came from a trusted
  Next.js assertion, not a replayed/forged client body.
  - The simplest correct version, given FastAPI already trusts the shared `X-API-Key` as "this
    call is from our own Next.js server process": have Next.js *itself* verify the session
    server-side (already required for every proxy route) and treat the value it forwards as
    trustworthy *because Next.js's server-only code computed it from `ctx.session`*, never
    because it echoed a client-body field back out. The fix is procedural (audit every proxy
    route for this), not a new crypto primitive, as long as that discipline is enforced.
- Never let a browser call the FastAPI ECS endpoint directly, even with a real session cookie —
  cookies are scoped to the Vercel domain and won't be sent cross-origin to the ECS ALB anyway
  without explicit CORS configuration, which should stay absent. Keep the "server-to-server only"
  boundary; it's the one part of this architecture that's already correctly shaped.

**Warning signs:**
- Any FastAPI endpoint added or modified during this milestone that accepts an
  `importer_id`/`user_id` in the request body/query without a comment explaining exactly why the
  Next.js caller can be trusted to have supplied the correct one.
- Reintroducing CORS on FastAPI "to make local dev easier" — a strong signal the server-to-server
  boundary is about to be broken.

**Phase to address:**
Auth phase (design the Next.js↔FastAPI trust primitive) with enforcement verified in the
Tenancy/RLS phase's route/procedure sweep (Pitfall 4).

---

### Pitfall 10: OAuth redirect URI / provider-config drift across two live Supabase projects and multiple Vercel environments

**What goes wrong:**
Google sign-in works perfectly in local dev and staging, then fails (or worse, silently uses the
wrong provider config) in production — or works in production and staging but breaks on the next
Vercel preview deployment used for review.

**Why it happens (general OAuth/Supabase knowledge, MEDIUM confidence — not repo-specific):**
This project already runs **two separate live Supabase projects** — staging (`fyfwkjvbcrmjqjysdyqw`)
and production (`dazyccjijdahxyciptkp`), confirmed in `infrastructure/aws/main.tf:22,35`. If
Google OAuth is wired through Supabase Auth (the natural fit given `@supabase/supabase-js` is
already a dependency and RLS's `auth.uid()` is Supabase's own JWT claim), each Supabase project
needs its **own** Google OAuth Client ID/Secret configured in its own Auth provider settings, and
each project's callback host (`https://<project-ref>.supabase.co/auth/v1/callback`) must be
registered as an authorized redirect URI in the Google Cloud Console — for *both* projects, on
the *same* Google OAuth client (or two separate clients). Add Vercel's preview-deployment domains
(dynamic, per-branch) into the mix and the "allowed redirect URLs" list in Supabase Auth needs a
wildcard or an explicit production-domain-only policy, decided deliberately rather than
discovered when a PR preview's login silently redirects to the wrong place.

**How to avoid:**
- Treat OAuth client configuration as an environment-parameterized deploy artifact, not a
  one-time manual setup: document (in the external-rename/setup runbook this milestone already
  plans to produce per PROJECT.md's "external renames... delivered as a user runbook") exactly
  which redirect URIs must be registered in Google Cloud Console and exactly which Supabase Auth
  settings must be set, per environment (local, staging, production), so re-running setup after
  the rename (new domain) is a checklist, not tribal knowledge.
- Restrict Vercel preview-deployment OAuth to either (a) not supporting login at all on
  previews (test against staging instead), or (b) explicit wildcard support if Supabase Auth's
  redirect-URL allowlist supports it in the version in use — verify against current Supabase docs
  at implementation time rather than assuming.
- Since PROJECT.md already scopes "live OAuth client creation in Google Cloud" as
  user-runbook'd (not autonomously executed) — make sure the runbook explicitly calls out doing
  this **twice** (once per Supabase project) as a named step, not implied.

**Warning signs:**
- OAuth works in one environment and fails with a generic "redirect_uri_mismatch" in another —
  always an environment-config sync issue, not a code bug; don't debug the code first.
- A login regression that appears only after the rename phase changes the production domain —
  confirms redirect URIs weren't part of the rename's checklist.

**Phase to address:**
Auth phase — bake the per-environment redirect-URI list into the setup runbook from the start,
and re-verify it explicitly as a checklist item in the rename phase (domain change = redirect
URIs change).

---

### Pitfall 11: Broken References/In-Reply-To chains — this app already receives mail that will break naive threading

**What goes wrong:**
A thread model is built keyed on `In-Reply-To`/`References` header chaining (the RFC-correct
approach), and it works for normal back-and-forth email — but every message that arrived via
Gmail's "Forward" feature (not "Redirect") shows up as an unrelated, brand-new thread, because
the forwarded message carries none of the original thread's identifying headers.

**Why it happens:**
Structurally confirmed in this codebase's own parser:
`apps/email-listener/app/domain/services/mime_parser.py:100-111` extracts `message_id`,
`in_reply_to`, and `references_ids` **only from RFC 5322 headers** (`Message-ID`, `In-Reply-To`,
`References`). This is correct for normal mail, but Gmail's UI "Forward" action generates a
**brand-new** `Message-ID` for the forwarded message and does **not** carry forward the original
thread's `In-Reply-To`/`References` headers — the original thread context exists only as
human-readable plain text pasted into the message body (a
`---------- Forwarded message ---------` block with `From:`/`Date:`/`Subject:`/`To:` as text,
not headers). `mime_parser.py` has no logic reading that block at all today. This matters
specifically for this milestone because PROJECT.md's own target features explicitly plan
"own-email forwarding seam for real personal use" — the app is *designed* to receive exactly the
kind of forwarded mail that breaks header-chain threading.

**How to avoid:**
- Don't assume `In-Reply-To`/`References` alone is sufficient; the thread model needs an explicit
  fallback tier for forwarded mail, and the fallback needs to be honest about its confidence
  (mirrors this codebase's own existing `knowledge_trust_tier` philosophy — "fail toward least
  trust" — apply the same discipline to thread-membership confidence rather than silently
  guessing).
- If body-text forwarded-header parsing is in scope, treat it as best-effort, not authoritative —
  Gmail/Outlook/Apple Mail all format the "Forwarded message" block differently and inconsistently,
  and localized (non-English) mail clients change the literal marker text (e.g., not always
  "---------- Forwarded message ---------"). A regex-based extractor here will have real false
  negatives; don't let a miss silently create an orphaned "thread of one" when a human could tell
  at a glance it belongs to an existing thread — surface it as an unmatched/needs-review case
  instead of failing silently.
- Distinguish "Forward" from "Redirect/Bounce" mail handling upfront: some MTAs/clients technically
  preserve original headers on redirect-style resends but not UI-forward — verify which mode is
  actually used for the "own-email forwarding seam" this milestone ships, since that changes
  which failure mode actually matters in production.

**Warning signs:**
- A thread view that shows the user's own forwarded copy of an email as a singleton thread,
  disconnected from the original conversation it was forwarded from.
- Any threading logic whose only signal is header-chain matching, with zero test fixtures built
  from real Gmail-forwarded `.eml` samples (as opposed to synthetic headers that already look
  RFC-correct).

**Phase to address:**
Email-threading phase — the fallback-tier design is a first-class requirement of that phase, not
a follow-up bug fix; write it into the phase's acceptance criteria before implementation starts.

---

### Pitfall 12: Subject-only fallback threading produces false-positive merges

**What goes wrong (general email-threading domain knowledge, MEDIUM confidence):**
When header-chain matching fails (Pitfall 11) and the thread model falls back to subject-line
matching (a common, reasonable second tier), unrelated messages that happen to share a normalized
subject get merged into the same thread — a new, unrelated email titled "Invoice" replying to
nothing gets silently attached to an old "Invoice" thread from a different sender/context, or a
"Re:"/"Fwd:" prefix-stripping bug leaves prefixes uncollapsed (`RE: RE: Fwd: Invoice` never
matching `Invoice`) producing the opposite failure — needless thread fragmentation.

**Why it happens:**
Subject lines are not unique identifiers and were never meant to be; the common failure is
treating "same normalized subject" as sufficient evidence on its own, without also requiring a
secondary signal (same sender/recipient pair, a time-window bound, or at minimum a check against
an already-broken header chain rather than using subject matching as the *first* tier).

**How to avoid:**
- Use subject matching only as a fallback tier, gated behind header-chain matching failing, and
  combine it with at least one more signal (participant overlap, time proximity) before merging
  into an existing thread — never merge on normalized-subject alone.
- Normalize subjects consistently (strip `Re:`/`Fwd:`/`Fw:`/locale variants, collapse whitespace,
  case-fold) so the fragmentation failure mode doesn't dominate — but keep the bar for a
  *positive* match higher than for normalization itself.
- Make the merge decision auditable/reversible in the data model (a thread assignment that can be
  corrected later) rather than an unrecoverable single write, since this heuristic will be wrong
  sometimes by design.

**Warning signs:**
- Two clearly-unrelated emails (different sender, different topic) sharing a thread because both
  happened to be titled something generic.
- A thread that never accumulates more than one message even though the user can see (by reading
  the emails) that they're obviously a conversation — usually a normalization bug, not a matching
  bug.

**Phase to address:**
Email-threading phase, as the explicit second tier of the threading algorithm's design.

---

### Pitfall 13: `references_ids` parsing is already fragile — malformed/truncated headers produce garbage thread links

**What goes wrong:**
`references_ids.split()` on the raw `References` header text produces silently wrong results for
headers that don't look like the clean, whitespace-separated `<id1> <id2> <id3>` textbook case.

**Why it happens:**
Confirmed: `apps/email-listener/app/domain/services/mime_parser.py:103-108` does
`references_ids=tuple(references.split()) if references else ()` — a naive whitespace split with
no validation that each token is a well-formed Message-ID (`<local@domain>` shape), no dedup, and
no bound on length. Real-world `References` headers accumulate one entry per hop in a long thread
and some MTAs truncate them at a length limit (dropping the *oldest* entries, which is exactly the
ones needed to reconnect a very long thread); other malformed senders separate entries with
commas instead of whitespace, or duplicate an entry. None of that is handled today, and none of
it needed to be handled before threading existed as a feature — it was captured-and-stored data
with no consumer.

**How to avoid:**
- Add validation/normalization at the parsing boundary (Zod/Pydantic-shaped, per this repo's own
  "validate inputs at system boundaries" convention) before this data becomes load-bearing for
  threading: strip malformed tokens rather than trusting them, dedupe, and — critically — don't
  assume the *first* or *last* entry in the array is the "root" message without checking, since
  truncation direction varies by sender.
  system.
- Since this column has been populated since Phase 4 with the old naive parser, a threading
  migration/backfill needs to re-derive thread membership from potentially-truncated historical
  data — treat historical rows as lower-confidence than newly-ingested ones with the improved
  parser, rather than assuming uniform data quality across the whole table.

**Warning signs:**
- A thread-reconstruction query that occasionally links two emails that share a References token
  neither party would recognize as related (garbage token collision).
- Extremely long `references_ids` arrays on old rows relative to new ones — signals inconsistent
  truncation behavior across senders/MTAs that any backfill must account for.

**Phase to address:**
Email-threading phase, in the parsing/normalization step that must run before thread-assignment
logic, and explicitly in the historical-data backfill sub-task.

---

### Pitfall 14: Big-bang rename — two independent, unsynced sources of truth for infrastructure names

**What goes wrong:**
The code-level rename (`@nauta/*` → `@polytoken/*` across ~243 files, confirmed by grep) goes
smoothly, `npm install`/`npm run check` pass locally — and the next deploy either fails outright
or, worse, silently pushes a production image to the wrong (or a newly-created, empty) ECR
repository while the running ECS service keeps serving the old image forever.

**Why it happens:**
Confirmed: this repo has **two disconnected sources of truth** for AWS resource naming:
1. Terraform: `infrastructure/aws/variables.tf:16` — `var.project` defaults to `"nauta-services"`,
   which flows into `infrastructure/aws/locals.tf:2` (`service_name =
   "${var.project}-email-listener"`) and from there into the ECS cluster/service name
   (`ecs.tf`), the CloudWatch log group name (`/ecs/${each.value.name}`), the ALB target group
   prefix (`locals.tf:4`, `tg_prefix = "nauta-el"`), and the ECR repository name
   (`ecr.tf:5`, `name = local.service_name`).
2. GitHub Actions: `.github/workflows/deploy-email-listener.yml:13-15` hardcodes
   `ECR_REPOSITORY: nauta-services-email-listener`, `ECS_CLUSTER: nauta-services-email-listener`,
   `ECS_SERVICE: nauta-services-email-listener` as **literal strings in the workflow YAML**,
   completely independent of Terraform's `var.project`.

Changing one without the other is not just inconsistent — it's a hard failure or a silent
mis-deploy: if Terraform's `var.project` changes but the workflow YAML doesn't, the workflow will
try to push to/deploy an ECR repo and ECS cluster/service that Terraform just renamed out from
under it (`Repository does not exist` or, if the old resources happen to still exist because
`terraform apply` failed partway, a successful-looking deploy that updates the **wrong**,
soon-to-be-decommissioned service while the real one goes stale).

Compounding this: `infrastructure/aws/ecr.tf:7` sets `force_delete = false` on the ECR repo. A
Terraform-level rename of `var.project` is a **name change on an existing resource**, which most
AWS providers implement as destroy+recreate for immutable-name resources (ECR repo names,
CloudWatch log group names are not renamable in place). With `force_delete = false` and existing
images in the repo, `terraform apply` will **fail outright** trying to destroy the ECR repo
non-empty, not silently succeed — annoying but at least loud. The ECS cluster/service and ALB
target group renames carry more silent risk (brief downtime / target group re-registration) if
not planned as a deliberate maintenance-window operation.

Also confirmed: Terraform state is **local-only** — `infrastructure/aws/main.tf:11-13` has the S3
backend block commented out, and `terraform.tfstate*` is gitignored. A rename-triggered
`terraform apply` run from a different machine/CI runner than whichever one holds the current
local state file risks "resource already exists" errors or, worse, Terraform concluding the real
resources don't exist and trying to create duplicates.

**How to avoid:**
- Treat the rename's infra step as its own reviewed plan, not a side effect of "find and replace
  nauta→polytoken": update `var.project`'s default (or set it explicitly in `.tfvars`) **and**
  the workflow YAML env vars **in the same commit/PR**, and run `terraform plan` (not `apply`)
  first to see the full list of resources it intends to destroy/recreate before touching
  anything live.
- For the ECR repo specifically: either temporarily set `force_delete = true` for the rename
  operation (accepting image-history loss, acceptable since staging/prod both build fresh images
  on every deploy per the existing `:latest`/`:staging` tag convention) or, better, use
  `terraform state mv` to re-point the *existing* ECR repo resource at a new Terraform address
  without an actual AWS-level rename — verify whether `aws_ecr_repository.name` can be updated
  in-place first (check the current AWS provider's behavior — some providers do support
  ECR-repo-name updates in place; don't assume destroy/recreate without checking the provider
  docs at implementation time).
- Since PROJECT.md already correctly scopes AWS resource renames as a **user runbook**, not
  autonomous execution — make sure that runbook explicitly documents this two-source-of-truth
  problem and the ECR `force_delete` gotcha, so whoever executes it doesn't discover it live.
- Locate and migrate the Terraform state to a real backend (S3, per the already-present commented
  block) as a prerequisite, or at minimum confirm the exact machine/runner holding current state
  before running any rename-triggered `apply`.

**Warning signs:**
- A `terraform plan` after a naming variable change that shows `# forces replacement` on the ECR
  repo, ECS cluster, ECS service, ALB target group, or CloudWatch log group — any of these should
  stop the operation for a deliberate decision, not be applied reflexively.
- A GitHub Actions deploy that succeeds (green checkmark) but the running service's image digest
  doesn't change — signals the workflow deployed to a resource Terraform already moved away from.

**Phase to address:**
Rename phase — this is infrastructure-only work within that phase; sequence it so Terraform
`plan` is reviewed by a human before `apply`, and the GitHub Actions YAML changes land in the
same PR as the Terraform variable change, never split across separate merges.

---

### Pitfall 15: Big-bang rename — npm workspace mechanics, lockfile, and stale caches

**What goes wrong:**
Package `name` fields get updated (`@nauta/db` → `@polytoken/db` etc.) and imports get
find-and-replaced, but the rename still breaks builds in ways that look unrelated to the rename
itself — `npm ci` fails in CI, `-w @nauta/db`-shaped scripts silently no-op or error with
"workspace not found," or local dev shows `Cannot find module '@polytoken/db'` even though the
code is correct.

**Why it happens:**
Confirmed: this is npm workspaces (not pnpm — already flagged as a repo-specific override of the
user's global pnpm default, see project memory), and the **root `package.json`'s own npm scripts
reference workspace names directly by string**, e.g. `"db:generate": "npm run migration:generate
-w @nauta/db"` (`package.json:30`) and similarly for `web:dev`, `db:migrate:staging`, etc. — every
one of these `-w @nauta/X` selectors is a separate rename site beyond the package.json `name`
fields and import statements. `vercel.json:3` similarly hardcodes
`"buildCommand": "npm run build -w @nauta/web"`. npm workspaces resolve `@nauta/db` to
`node_modules/@nauta/db` as a **symlink** into `packages/db` — after renaming, stale symlinks
(and any `.next`/build caches keyed by the old module names) can make module resolution fail even
after `package.json` and imports are all correctly updated, unless `node_modules` is fully
reinstalled. `package-lock.json` (npm, not pnpm's lockfile) also encodes the old package names and
must be regenerated, not hand-edited — a stale lockfile is exactly what makes `npm ci` (used in
CI, which fails hard on lockfile/package.json mismatch rather than silently updating like
`npm install`) break in CI specifically, even when local `npm install` "just works" by silently
rewriting the lockfile.

**How to avoid:**
- Grep-verify every `-w @nauta/` occurrence across `package.json` (root and all workspace
  packages), `vercel.json`, and any CI workflow YAML — not just import statements. A single
  `sed`/find-and-replace pass across `*.ts`/`*.tsx` files will miss shell-string occurrences in
  JSON/YAML that don't look like TypeScript imports.
- After the rename, do a full clean reinstall (`rm -rf node_modules **/node_modules
  package-lock.json .next && npm install`) locally and verify `npm run check` (the repo's
  existing combined lint+format+typecheck+architecture+test gate,
  `package.json:24`) passes before considering the rename done — don't trust a build that reused
  an existing `node_modules` tree.
- Ensure CI doesn't restore a cache keyed by the old `package-lock.json` hash across the rename
  commit — a cache-hit on stale, pre-rename `node_modules` would mask exactly the failure this
  pitfall describes until a cold cache run (e.g., a scheduled job) breaks unexpectedly later.
- Do the rename as an isolated commit (or tightly-scoped sequence) with no unrelated logic
  changes mixed in — this keeps `git log --follow`/rename-detection (`-M`) useful afterward, and
  makes it possible to `git bisect` around the rename cleanly if something downstream breaks.

**Warning signs:**
- `npm ci` failing in CI with a lockfile-mismatch error immediately after the rename PR merges —
  the single most common tell that the lockfile wasn't regenerated (or was hand-edited) rather
  than freshly produced by `npm install`.
- A workspace script (`npm run db:generate`, `npm run web:dev`, etc.) failing with "no workspaces
  found" or similar after the package.json `name` fields change but before every `-w @nauta/X`
  reference is updated to match.

**Phase to address:**
Rename phase — sequence this phase to run **before** the auth/tenancy/threading phases begin, so
new code in those phases is authored once, under the final `@polytoken/*` namespace, rather than
needing a second pass. This is also the ordering PROJECT.md's "rename once" guardrail implies but
doesn't state explicitly as a phase-sequencing rule — worth making explicit in the roadmap.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Keep Drizzle connected as the Postgres superuser and treat RLS as decorative/defense-in-depth only, enforcing tenancy purely in application code (Pitfall 1, Option B) | Avoids a real architecture fork (PostgREST/per-request-role) mid-milestone; ships faster | RLS provides zero actual protection against an app-code bug that forgets a filter (Pitfall 3/4) — the exact bug class this milestone exists to close | Only acceptable if paired with the full route/procedure sweep of Pitfall 3/4 being genuinely exhaustive and continuously tested — otherwise it's the theater Pitfall 1 warns about, just documented as intentional |
| Derive tenant slugs from user email/name without a collision-retry strategy (Pitfall 8) | Simple, human-readable slugs at signup | Second real user with a colliding derived slug gets an unhandled signup failure | Acceptable only pre-launch with a known single user; must be fixed before any second real signup is expected |
| Ship subject-only fallback threading without a secondary signal (Pitfall 12) | Simpler first version, unblocks the thread UI faster | False-positive merges corrupt a data model (thread membership) that's hard to un-merge later once users have organized around it | Acceptable as an explicitly-flagged low-confidence tier, never as the primary/only matching strategy |
| Leave Terraform state as local-only rather than migrating to S3 backend before the rename (Pitfall 14) | No extra setup work this milestone | Any rename-triggered `apply` run from a different machine than whichever holds current state risks duplicate/orphaned resources | Never acceptable once a destructive, multi-resource-touching operation (the rename) is imminent — fix before that `apply`, not after |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| Supabase Auth (Google OAuth) across 2 projects | Configuring the Google OAuth client/redirect URIs for production only, forgetting staging needs its own callback URL registered | Document and configure both `fyfwkjvbcrmjqjysdyqw` (staging) and `dazyccjijdahxyciptkp` (production) Supabase Auth provider settings and both callback hosts in Google Cloud Console, as an explicit runbook checklist item |
| Supavisor transaction-mode pooler (port 6543) | Assuming any Postgres connection through the pooler behaves like a direct session-mode connection for RLS/session-state purposes | Use session-mode (already this repo's precedent, `client.ts:28-36`) or route through PostgREST/Data API for any RLS-subject connection; never assume transaction-mode pooling is a drop-in swap |
| FastAPI ↔ Next.js shared `X-API-Key` | Treating the shared key as sufficient identity proof for a user-scoped action once real users exist behind it (Pitfall 9) | Add a session-derived, Next.js-computed identity assertion on top of the existing shared-secret transport layer; never let a proxied request's tenant ID trace back to an unvalidated client field |
| Vercel preview deployments + OAuth | Assuming preview-deployment domains automatically work with a redirect-URI allowlist configured only for production/staging | Explicitly decide (and document) whether OAuth is supported on previews at all; if yes, verify Supabase Auth's current wildcard-redirect support before relying on it |
| Terraform + GitHub Actions naming (this repo, confirmed) | Changing `var.project` in Terraform without updating the hardcoded `ECR_REPOSITORY`/`ECS_CLUSTER`/`ECS_SERVICE` strings in `deploy-email-listener.yml` (and the staging variant) | Update both in the same PR; consider deriving the workflow's env vars from a Terraform output instead of hand-duplicating the string, to remove the second source of truth permanently |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| RLS policy calling `auth.uid()` (or any function) directly in `USING`/`WITH CHECK` instead of wrapped in `(select auth.uid())` | Queries against `knowledge_nodes`/`entity_instances`/etc. get measurably slower once RLS is enforced for real, even though the query plan "looks fine" at a glance | Wrap auth/JWT helper calls as `(select auth.uid())` so Postgres caches the value via an initPlan instead of re-evaluating per row — official Supabase guidance, `auth_rls_initplan` advisor warning exists specifically for this | Noticeable on `knowledge_nodes` (already has HNSW + pg_trgm indexes for scale, per `0029_knowledge_search_extracted_only.sql`) and `emails`/`entity_instances` well before "big" scale — this is a per-row-function-call cost, not a data-volume one, so it can appear even at hundreds of rows once combined with a vector/trgm scan |
| RLS predicate added on top of the existing HNSW/pg_trgm search RPCs without re-verifying the query plan | Vector/trgm similarity search silently falls back to a much slower plan once a per-row RLS filter is layered on top of an index scan that assumed no additional per-row predicate | Re-run `EXPLAIN ANALYZE` on `match_knowledge_nodes_by_embedding`/`match_knowledge_nodes_by_trgm`-shaped queries after RLS lands, not just functionally test them | Same tables as above — this is specifically a risk because this repo already has non-trivial vector/trgm indexes in production use, not a hypothetical future-scale concern |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Treating `importer_id`/`user_id` as a caller-supplied data-partitioning param (today's explicit, documented design — PROJECT.md "Out of Scope") past the point where real user data exists behind it | Full cross-tenant read/write once auth ships, via any endpoint that wasn't part of the tenancy sweep | Full route/procedure audit (Pitfall 3/4) as an explicit phase gate, verified by adversarial cross-tenant tests, not just "the obvious CRUD screens" |
| Minting Supabase Storage signed URLs via the service-role key with no ownership check (confirmed today, `attachments/[id]/route.ts`) | Any signed-in user can download any other user's email attachments by ID | Add an explicit ownership check (join through `email_attachments` → `emails` → tenant) before minting the signed URL, not just validate the UUID shape |
| Returning raw upstream error `detail` text to the client from a proxy route | Information disclosure about internal state/other tenants' resource existence via error message differences (404 vs 403 vs 500 timing/content) | This repo already does this correctly in one place (`promote/route.ts`'s `REJECTION_MESSAGES` map, server-log-only raw detail) — use that as the template pattern for every new proxy route added this milestone, don't regress to passing `upstream.text()` straight through |
| `SECURITY DEFINER` functions added for tenant-provisioning that accept an identity parameter instead of reading `auth.uid()` internally | A DEFINER function callable on behalf of an arbitrary user ID, bypassing the RLS the rest of the schema relies on | Any DEFINER function's only identity input should be `auth.uid()`, never a parameter — flag any exception for mandatory extra review |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Signup fails with a raw DB unique-constraint error on a second real user (Pitfall 8) | Confusing, unrecoverable-looking failure on literally the first multi-user moment the product has ever had | Catch the collision case explicitly and retry with a disambiguated slug, or don't use human-derived slugs as a uniqueness key at all |
| Forwarded emails silently appear as disconnected singleton threads (Pitfall 11) | Undermines the core "emails become cards on the canvas, threaded" value prop from VISION.md on exactly the use case (own-email forwarding) this milestone is built around | Surface low-confidence/unmatched thread assignments distinctly in the UI rather than presenting them as confidently-correct standalone threads |
| OAuth failure states (consent denied, revoked grant, redirect-URI misconfiguration) shown as a raw provider error page | Breaks trust immediately on the very first interaction with the product | Catch and present a friendly, actionable message; this is already flagged as a table-stakes item in `FEATURES.md` — cross-reference and don't drop it under time pressure |

## "Looks Done But Isn't" Checklist

- [ ] **RLS policies exist on every table:** Often missing — verification that the *connection
  actually enforcing them* is subject to RLS at all (Pitfall 1). Check: run a query as the
  `authenticated` role via the real auth path (not the Drizzle superuser handle) and confirm a
  cross-tenant row is actually denied, not just that a policy exists in the migration file.
- [ ] **"Auth added to every tRPC procedure":** Often missing — a proxy route (`app/api/**`) that
  forwards to FastAPI, which is easy to forget isn't automatically covered by a tRPC-level
  `protectedProcedure` change (Pitfall 3/9). Check: grep `app/api/**/route.ts` separately from
  `packages/api-client/src/router/**`, both need the sweep.
- [ ] **"Backfill migration ran successfully":** Often missing — idempotency verification
  (Pitfall 7). Check: re-run the backfill migration a second time against the same
  already-migrated data and confirm it's a safe no-op, not a second mutation or an error that
  masks a partial first run.
- [ ] **"Email threading works":** Often missing — coverage of forwarded mail, not just normal
  reply chains (Pitfall 11). Check: test fixtures include at least one real Gmail-"Forward"-style
  `.eml` sample with a fresh Message-ID and no original thread headers, not only synthetic
  RFC-correct header chains.
- [ ] **"Rename complete, build passes":** Often missing — infrastructure and CI naming
  (Pitfall 14), which won't surface in `npm run check` at all. Check: `terraform plan` shows no
  unreviewed destroy/recreate, and the GitHub Actions workflow YAML's hardcoded names were
  updated in the same PR as the Terraform variable.
- [ ] **"OAuth works":** Often missing — staging-environment redirect URI/provider config
  (Pitfall 10), since local dev and production are the two environments most likely to get tested
  directly. Check: sign in on staging specifically, not just local + production.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| RLS theater discovered post-launch (Pitfall 1) | HIGH | Audit every read/write path for the actual enforcing connection/role; likely requires the architecture fork (PostgREST/per-request role) to be done properly, not patched — budget this as a dedicated remediation phase, not a hotfix |
| Cross-tenant leak via a forgotten route (Pitfall 4) | MEDIUM–HIGH depending on data sensitivity | Patch the specific route immediately (add the ownership check), then run the full route/procedure sweep that should have caught it, then audit whether any real cross-tenant access occurred (check FastAPI/Vercel access logs for the affected window) |
| Terraform rename `apply` partially failed (e.g., ECR destroy blocked by `force_delete=false`, Pitfall 14) | MEDIUM | Do not force through with `-force`/manual AWS console deletion under pressure; re-run `terraform plan` to see current actual state, fix `force_delete` or use `terraform state mv`, and re-plan before re-applying — a partially-applied multi-resource plan can leave the ECS service pointing at a now-orphaned target group |
| npm workspace rename breaks `npm ci` in CI only (Pitfall 15) | LOW | Regenerate `package-lock.json` from a clean `npm install` (never hand-edit), commit it explicitly, re-run CI |
| Thread false-positive merge corrupts thread membership (Pitfall 12) | LOW–MEDIUM if caught early, HIGH if users have already organized around the incorrect grouping | Keep thread assignment as a correctable/re-computable derived field (not a destructive one-way write) from day one specifically so this recovery stays cheap |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1. RLS theater (superuser bypass) | Tenancy/RLS phase | Query as the real `authenticated` path, not the Drizzle handle; confirm cross-tenant denial live |
| 2. Pooler breaks `auth.uid()` | Tenancy/RLS phase | Live staging smoke test through Supavisor, not just local Postgres |
| 3. Client-supplied tenant ID trust boundary | Tenancy/RLS phase | Adversarial test: authenticated user B against user A's known resource ID → 403/404 |
| 4. Forgotten routes (attachments example) | Tenancy/RLS phase | Full route/procedure inventory with a pass/fail tenant-check column, not sampling |
| 5. SECURITY DEFINER bypass | Tenancy/RLS phase | Mandatory extra review on any migration diff containing `SECURITY DEFINER` |
| 6. RLS/Drizzle policy drift | Tenancy/RLS phase | `pg_policies` vs. migration-history diff check, staging + prod |
| 7. Default-importer backfill | Tenancy/RLS phase | Idempotency test (re-run backfill twice); staging rehearsal before prod |
| 8. Unique-constraint direction (global vs. per-tenant) | Tenancy/RLS phase | Explicit per-column uniqueness-scope decision recorded per new/changed table |
| 9. Dual-backend identity assertion | Auth phase (design) + Tenancy/RLS phase (enforcement) | Every FastAPI-bound proxy route reviewed for session-derived (not client-echoed) tenant ID |
| 10. OAuth redirect URI drift | Auth phase | Explicit per-environment (local/staging/prod) redirect-URI checklist in the setup runbook |
| 11. Forwarded-mail thread breakage | Email-threading phase | Test fixtures include real Gmail-forward `.eml` samples, not just synthetic header chains |
| 12. Subject-fallback false positives | Email-threading phase | Fallback tier requires a secondary signal; never subject-alone |
| 13. `references_ids` parsing fragility | Email-threading phase | Validation/normalization added before thread-assignment logic consumes the column |
| 14. Rename: infra naming drift | Rename phase | `terraform plan` reviewed by a human; workflow YAML + Terraform variable changed in one PR |
| 15. Rename: npm workspace/lockfile/cache | Rename phase (sequenced FIRST, before auth/tenancy/threading phases) | Clean reinstall + `npm run check` green; CI cold-cache run verified |

## Sources

- Direct repository evidence (HIGH confidence, cited inline by file:line):
  `packages/db/src/client.ts`, `packages/db/migrations/0001_rls_deny_all.sql`,
  `packages/db/migrations/0020_knowledge_node_edges_rls.sql`,
  `packages/db/migrations/0029_knowledge_search_extracted_only.sql`,
  `packages/db/migrations/0009_retrieval_rpcs.sql`,
  `packages/db/migrations/0005_seed_default_importer.sql`,
  `packages/db/src/schema/{importers,emails,sender-profiles,entity-types}.ts`,
  `packages/api-client/src/trpc.ts`, `apps/web/src/app/api/trpc/[trpc]/route.ts`,
  `apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts`,
  `apps/web/src/app/api/attachments/[id]/route.ts`,
  `apps/email-listener/app/presentation/api/v1/emails.py`,
  `apps/email-listener/app/domain/services/mime_parser.py`,
  `apps/email-listener/app/domain/ports/importer_resolver.py`,
  `apps/email-listener/app/settings.py`,
  `infrastructure/aws/{main,locals,ecr,variables}.tf`,
  `.github/workflows/deploy-email-listener.yml`, `package.json`, `vercel.json`,
  `supabase/config.toml`, `.planning/PROJECT.md`,
  `.planning/research/polytoken-vision/VISION.md`,
  `.planning/research/v1.7-polytoken-foundation/FEATURES.md`.
- Supabase official docs (HIGH confidence): [RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
  (the `(select auth.uid())` initPlan pattern, `auth_rls_initplan` advisor),
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
  [Supavisor and Connection Terminology Explained](https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO)
  (transaction-mode vs. session-mode pooling and session-state persistence).
- General OAuth/email-threading domain knowledge (MEDIUM/LOW confidence, flagged inline where
  used): redirect-URI/provider-config drift across environments; subject-line threading
  false-positive/fragmentation failure modes; Gmail "Forward" vs. "Redirect" header behavior.

---
*Pitfalls research for: v1.7 polytoken.ai Foundation (auth, tenancy/RLS, email threading, rename)*
*Researched: 2026-07-09*
