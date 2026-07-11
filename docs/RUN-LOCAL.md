# Running the Local Stack (polytoken)

Canonical, single source of truth for bringing the full local stack — Supabase, the FastAPI
email-listener, and the Next.js web app — up **green from cold**, with no manual zombie-process
hunting. If any other doc (README.md quickstart, old notes, tribal knowledge) disagrees with this
file, this file wins; update it in place rather than creating a second doc.

Companion script: [`scripts/preflight-local.ps1`](../scripts/preflight-local.ps1) automates
sections 3 and 6 below. Read this doc once, then just run the script on every cold start.

## 1. Prerequisites

- **Docker Desktop** running (Supabase's local stack is a set of Docker containers).
- **uv** (Python package/venv manager) — `apps/email-listener` uses it, not pip/poetry.
- **Node 20+** (see `engines.node` in root `package.json`).
- **npm workspaces — NOT pnpm.** This repo overrides the global "use pnpm" convention: it is an
  npm-workspaces monorepo (`workspaces: ["packages/*", "apps/web"]` in root `package.json`).
  Running `pnpm install` here pollutes the tree and does not resolve the workspace protocol the
  same way. Always use `npm`.

## 2. The env-file split (the #1 footgun)

This repo has **two separate env files** feeding two separate parts of the stack. Mixing them up
is the single most common cause of "works for one service, silently broken for another":

| File | Feeds | How it's loaded |
|------|-------|------------------|
| `apps/email-listener/.env` | The FastAPI listener (`SUPABASE_URL=http://127.0.0.1:54321`, AWS/Bedrock creds, `OPENROUTER_API_KEY`) | Read directly by the Python app on startup |
| repo-root `.env.local` | **Both** the web app AND `packages/db` migrations | Web: `apps/web`'s `dev` script runs `dotenv -e ../../.env.local -- next dev`. DB: `npm run db:migrate` (`packages/db/src/migrate.ts`) reads `POSTGRES_URL_NON_POOLING` from the same root `.env.local`. |

There is no `apps/web/.env` in normal use — do not create one and expect it to be read; the web
app's dev script explicitly points at the root file.

**Google OAuth is a further wrinkle.** `supabase/config.toml`'s `[auth.external.google]` block
resolves `client_id`/`secret` via `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` /
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)`. Those `env()` refs resolve from the **process
environment that runs `supabase start`**, NOT from `.env.local` — `.env.local` is only read by
`dotenv-cli`/drizzle at their own invocation points. If you start Supabase from a fresh shell
without those two vars exported, GoTrue silently gets empty client id/secret and Google sign-in
fails with no obvious error. Load them into the shell (e.g. from `.env.local`) **before** running
`sb:start`. `scripts/preflight-local.ps1` warns (non-fatal) if they're missing from the process
environment.

## 3. One-command cold start

Run the preflight script first — it brings Supabase up under `project_id=polytoken`, seeds the
single auth user, migrates, grants, and reloads PostgREST, all idempotently:

```powershell
./scripts/preflight-local.ps1
```

It prints a PASS/FAIL summary and exits nonzero on failure — see section 7 for what "green" means.
Once it reports PASS, start the other two processes **in this order** (each in its own terminal):

```powershell
# 1. Listener (NO --reload — see section 4)
cd apps/email-listener
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Web app
cd apps/web
npm run dev
```

Supabase itself serves the DB on `54322` and the API/GoTrue/PostgREST on `54321` (Studio on
`54323`, Inbucket/mail testing on `54324`).

## 4. Zombie-process rule — servers run WITHOUT `--reload`

On Windows, `--reload` spawns a child worker process whose stdout can detach from the parent
terminal. When that child is later killed (or the parent terminal is closed), the child can be
left listening on the port as an orphaned **zombie** that still answers requests — but its logs go
nowhere, because its terminal is gone. Symptom: you forward an email or hit an endpoint, get a
`200 OK`, and the visible uvicorn terminal prints nothing after `Application startup complete.`
The fresh server you're staring at never received the request; a zombie from an earlier run did.

**Rule: always run the listener WITHOUT `--reload`.** The preflight script's kill step is the
scripted fix for existing zombies:

```powershell
Get-Process python,uvicorn,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

followed by a port-free check (`Get-NetTCPConnection -LocalPort 8000 -State Listen`). When in
doubt about whether a request was actually handled by the server you're watching: **trust the DB,
not the terminal.** Query the row directly (Supabase Studio at `http://127.0.0.1:54323`, or
`psql`/`docker exec -i`) rather than waiting for terminal output that may never come from the
zombie that actually served the request.

## 5. Project-id rename note (LIVE-07)

The local Supabase stack was renamed `nauta` → `polytoken` in `supabase/config.toml`
(`project_id = "polytoken"`). This is a **local-only, already-actualized** rename:

- Local Docker containers and volumes are now named `supabase_*_polytoken` (e.g.
  `supabase_db_polytoken`, `supabase_auth_polytoken`), not `supabase_*_nauta`.
- If an old `nauta`-named stack is still up (leftover from before the rename), stop it explicitly:
  `npx supabase stop --project-id nauta`. The preflight script detects and does this automatically.
- The old `nauta` Docker volumes hold stale pre-rename data that was **not** migrated to the new
  `polytoken` volumes — this was a deliberate decision (local data is disposable; the new DB was
  rebuilt fresh with `db:migrate` rather than attempting a volume clone).
- Staging (`fyfwkjvbcrmjqjysdyqw`) and production (`dazyccjijdahxyciptkp`) hosted Supabase projects
  are **unaffected** by this local rename — they're addressed by project ref, not `project_id`.

## 6. Fresh-DB recovery — seed-before-migrate + grant/NOTIFY

Rebuilding the local DB from scratch (new Docker volume, or after `supabase db reset`) requires an
exact order of operations, both of which `scripts/preflight-local.ps1` automates:

1. **Seed exactly ONE `auth.users` row BEFORE migrating.** The Phase-44 tenancy backfill migration
   (`0032`) refuses to run unless `auth.users` has exactly one row at migration time — it needs an
   unambiguous target to backfill `user_id` onto. Seed it via the GoTrue admin API:
   ```
   POST http://127.0.0.1:54321/auth/v1/admin/users
   Headers: apikey / Authorization: Bearer <service_role key from `npm run sb:status`>
   Body: {"email":"pedromaschio.shin@gmail.com","email_confirm":true}
   ```
   Treat "user already registered" as success (idempotent) — never create a second user. Google
   sign-in later auto-links to this seeded user by verified email.
2. **Then run migrations:** `npm run db:migrate` (applies `0000`–`0035` via Drizzle against
   `POSTGRES_URL_NON_POOLING` from root `.env.local`, i.e. `127.0.0.1:54322`).
3. **Then grant + reload PostgREST.** Drizzle creates tables owned by the `postgres` superuser
   without granting the Supabase API roles (`anon`, `authenticated`, `service_role`). Left
   ungranted, every app read/write returns PostgREST `42501 permission denied for table X` (or an
   HTTP 403 from the listener) even though GoTrue auth itself works fine (it lives in its own
   schema). Fix — pipe SQL into the DB container via `docker exec -i` (plain `docker exec` without
   `-i` drops stdin and silently does nothing):
   ```sql
   GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
   GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
   NOTIFY pgrst, 'reload schema';
   ```
   The `pgvector`/`pg_trgm` "no privileges were granted" warnings during this step are harmless
   (they're superuser-owned extension functions). This grant is **not durable** across
   `supabase db reset` — it drops and must be re-applied, which is exactly why it's scripted rather
   than a one-time manual fix.

## 7. Verification — trust the DB, not the terminal

Don't declare the stack green because a terminal looks quiet or a command exited 0 — verify
against the database directly, the same discipline as section 4:

- **Grant/permission check:** `has_table_privilege('service_role', 'public.chat_conversations', 'SELECT')`
  should return `t`. This is the exact assertion `scripts/preflight-local.ps1` runs as its final
  PASS/FAIL gate.
- **Table count sanity check:** query `pg_tables` in `schemaname = 'public'` and confirm a
  non-trivial count (Drizzle's own migrate script prints this too:
  `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`).
- **Row-level checks:** for any specific flow (e.g. "did the email land"), query the relevant table
  directly (Studio at `http://127.0.0.1:54323`, or `docker exec -i` + `psql`) rather than trusting
  application logs.

This doc covers *bringing the stack up green*. The DB-verified end-to-end path (login → inbox →
thread → email detail → chat with tool rounds → genui panel → `/knowledge`, each step backed by a
DB assertion, Playwright-core driven) is specified separately in plan `49-03`.
