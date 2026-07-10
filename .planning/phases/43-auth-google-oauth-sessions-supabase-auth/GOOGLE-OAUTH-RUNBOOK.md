# Google OAuth Setup Runbook (AUTH-05)

**Audience:** the human operator. Everything in this document is a manual action —
autonomous execution never creates Google OAuth clients, never touches the Google Cloud
Console, and never changes a Supabase Dashboard setting. Code only *reads* the config
these steps produce (`supabase/config.toml` locally; environment variables everywhere).

**Scope:** Google sign-in for `polytoken.ai`, backed by Supabase Auth (GoTrue). Three
environments exist and each needs this done **once each**: local, staging
(`fyfwkjvbcrmjqjysdyqw`), and production (`dazyccjijdahxyciptkp`).

---

## 1. Google Cloud Console — OAuth consent screen + client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select (or create) the
   project that will own this app's OAuth client.
2. **APIs & Services → OAuth consent screen**:
   - User type: External (unless the Google Workspace org restricts to Internal).
   - App name / support email / branding: whatever is appropriate for now — v1.8 owns the
     real branding pass. This is not a taste decision worth blocking on.
   - Scopes: add exactly these three —
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - No other scopes are needed for sign-in-only.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: anything identifiable (e.g. "polytoken web").
   - Leave "Authorized redirect URIs" empty for now — fill it in Section 2 below, which
     lists the exact values to paste.
4. Save the generated **Client ID** and **Client secret** — you'll paste them into the
   Supabase Dashboard (Section 3) and, for local dev only, into `config.toml`'s `env(...)`
   source (Section 4). **Never paste the real secret into any file in this repository.**

You may use **one client with multiple redirect URIs** (simplest) or **one client per
environment** (more isolation, more to maintain). Either is fine; the redirect URIs in
Section 2 are what actually matters.

---

## 2. Authorized redirect URIs — per environment, do this for BOTH hosted projects

This step must be done **twice** for the two live Supabase projects (Pitfall 10 —
per-environment provider config drifts silently if you only do it once and assume it
covers both). Register these exact values as **Authorized redirect URIs** on the Google
OAuth client from Section 1:

| Environment | Redirect URI to register in Google Cloud Console |
|---|---|
| Local (Supabase CLI) | `http://127.0.0.1:54321/auth/v1/callback` |
| Staging (`fyfwkjvbcrmjqjysdyqw`) | `https://fyfwkjvbcrmjqjysdyqw.supabase.co/auth/v1/callback` |
| Production (`dazyccjijdahxyciptkp`) | `https://dazyccjijdahxyciptkp.supabase.co/auth/v1/callback` |

**Why these values and not the app's own URL:** Supabase Auth (GoTrue) is the OAuth
client's actual redirect target — Google redirects to Supabase's fixed
`/auth/v1/callback` endpoint, and Supabase Auth then redirects a second time to this
app's own callback (`/auth/callback`, shipped in Plan 02) with a `code` param. The app's
`/auth/callback` route is **not** registered in Google Cloud Console at all — only the
Supabase-hosted callback is, for each project.

Add all three rows above to the **same** Google OAuth client's redirect-URI list (or
split across two clients if you chose that path in Section 1) — do not skip local if you
plan to test the flow before it reaches staging.

---

## 3. Supabase provider configuration — per environment

### Local (`supabase/config.toml`, already checked in by this plan)

The repo's `supabase/config.toml` already declares:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
```

You only need to put the two real values in your local env (`.env` used by
`npm run sb:start`, or your shell environment) as:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<paste-client-id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<paste-client-secret>
```

Restart the local Supabase stack (`npm run sb:stop && npm run sb:start`, or however the
project's script names it) so the CLI re-reads `config.toml` and picks up the env values.

### Staging + Production (Supabase Dashboard — no config.toml equivalent for hosted)

For **each** hosted project separately:

1. Open the Supabase Dashboard for that project (staging: `fyfwkjvbcrmjqjysdyqw`;
   production: `dazyccjijdahxyciptkp`).
2. **Authentication → Providers → Google**.
3. Toggle it **enabled**.
4. Paste the same **Client ID** and **Client secret** from Section 1 (reuse the one
   client across environments, or use per-environment clients if you created them
   separately in Section 1 — either is fine as long as the redirect URI registered in
   Google Cloud Console for that environment matches the client you paste here).
5. Save.
6. Repeat for the other hosted project. **Do not assume staging config carries over to
   production** — they are two entirely separate Supabase projects with independent
   Dashboard settings.

---

## 4. Environment variables — per environment

| Variable | Public/Secret | Local value source | Staging/Prod value source |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `http://127.0.0.1:54321` | Supabase Dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | `npm run sb:status` → `ANON_KEY` | Supabase Dashboard → Project Settings → API → `anon`/`publishable` key |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | Secret-adjacent (not `NEXT_PUBLIC_*`, but not sensitive if leaked — it's a public OAuth client ID) | Google Cloud Console → Credentials → the OAuth client from Section 1 | Same Google Cloud Console client, reused or per-env — same value pasted into that environment's Supabase Dashboard provider page (Section 3) |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` | **Secret — never commit, never log, never prefix `NEXT_PUBLIC_`** | Google Cloud Console → same OAuth client's client secret | Same source; paste directly into the Supabase Dashboard provider page (Section 3), and/or your local secrets manager for `config.toml`'s `env()` resolution — never into a file tracked by git |

Existing vars this phase does **not** change: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
(already documented in `.env.example` — server-only, unrelated to the browser-facing
public vars above).

`.env.example` in this repo documents all four new vars as placeholders (see Task 2 of
this plan) — copy that file's structure into your real `.env.local` / `.env.staging` /
`.env.production` files and fill in real values from the sources above. Never commit a
real value.

---

## 5. Sign-up policy

Google sign-in is **open** in v1.7 (`enable_signup = true` in `[auth]`, unchanged by this
plan) — this matches the product's current single-user reality (per `PROJECT.md`/
`43-CONTEXT.md`): anyone with a Google account can create a session.

**To restrict this later** (e.g. before inviting other people, or if you want to lock the
app down to a specific set of emails), use the Supabase Dashboard's built-in restriction
options rather than writing allowlist code:

- **Auth Hooks → "Before User Created"**: a Postgres function hook that can reject
  sign-ups by email domain/allowlist before the user row is created. This is the
  supported, no-new-infrastructure way to gate sign-up without touching application code.
- Alternatively, disable `enable_signup` entirely once the known set of users has already
  signed up once (existing sessions/refresh tokens keep working; only *new* sign-ups are
  blocked).

No allowlist code exists in this app today, by design (`43-CONTEXT.md` "Deferred Ideas" —
revisit only if the product opens beyond single-user).

---

## 6. Phase-44 prerequisite: determine the JWT signing-key mode

Before Phase 44 adds FastAPI-side JWT verification (this phase, 43, deliberately avoids
that by using `getUser()` server round-trips + `X-User-Id` header forwarding instead —
see `43-04-SUMMARY.md`), **check which JWT signing mode each Supabase project is on**:

**Supabase Dashboard → Settings → API → JWT Keys** (check for BOTH staging and
production projects — they can be on different modes independently):

- **Legacy / symmetric (HS256):** a single shared `JWT Secret` value. FastAPI would
  verify locally with that static secret (`PyJWT`, already resolved transitively per
  `STACK.md`).
- **New / asymmetric (ES256):** rotating public/private key pairs. FastAPI would fetch
  and cache the project's JWKS endpoint
  (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`) via
  `jwt.PyJWKClient` and verify against the public key — no shared secret needed at all.

Record which mode each environment (staging, production — local Supabase CLI defaults to
legacy HS256 as of this writing, verify at implementation time) is actually on **before**
Phase 44 planning starts, so that phase can pick the correct verification code path
without re-discovering this at implementation time. This is not blocking for Phase 43 —
`getUser()` round-trips avoid needing to know this at all — but it is real, unresolved
groundwork Phase 44 needs on day one.

---

## Summary checklist

- [ ] Google Cloud Console: OAuth consent screen configured (scopes: openid,
      userinfo.email, userinfo.profile) + Web application OAuth client created
- [ ] Redirect URIs registered for local + staging (`fyfwkjvbcrmjqjysdyqw`) + production
      (`dazyccjijdahxyciptkp`) — all three, on the Google Cloud client
- [ ] Local: `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` set in local env,
      Supabase stack restarted
- [ ] Staging Supabase Dashboard: Google provider enabled + client id/secret pasted
- [ ] Production Supabase Dashboard: Google provider enabled + client id/secret pasted
      (done **separately** from staging — do not assume it carries over)
- [ ] `.env.local` / `.env.staging` / `.env.production` populated with all four new vars
      per the table in Section 4 (never committed)
- [ ] Sign-up policy reviewed (open by default; allowlist option documented for later)
- [ ] JWT signing-key mode recorded for staging + production, ahead of Phase 44

---
*Phase: 43-auth-google-oauth-sessions-supabase-auth*
*Runbook authored: 2026-07-09 (Plan 05)*
