import { createEnv } from "@t3-oss/env-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema";

export const env = createEnv({
  server: {
    POSTGRES_URL: z.string().url(),
    POSTGRES_URL_NON_POOLING: z.string().url(),
    // Phase 44 (tenancy): override for the 0032 backfill migration when the
    // local auth.users table has 0 or >1 rows (fail-loud otherwise). Never
    // required for normal operation — migrate.ts only reads it.
    BACKFILL_USER_ID: z.string().uuid().optional(),
  },
  // eslint-disable-next-line no-restricted-properties
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    // eslint-disable-next-line no-restricted-properties
    !!process.env.CI ||
    // eslint-disable-next-line no-restricted-properties
    !!process.env.SKIP_ENV_VALIDATION ||
    // eslint-disable-next-line no-restricted-properties
    process.env.npm_lifecycle_event === "lint" ||
    // Skip during Next.js production build — DB is a runtime dependency only
    // eslint-disable-next-line no-restricted-properties
    process.env.NEXT_PHASE === "phase-production-build",
});

/**
 * Connection selection — serverless-aware (prod-500 fix, 2026-07-21).
 *
 * `POSTGRES_URL_NON_POOLING` is the session-mode/direct connection. On Supabase
 * the direct host (`db.<ref>.supabase.co`) is **IPv6-only**, and Vercel's
 * serverless functions egress over **IPv4 only** — so on Vercel that URL is
 * physically unreachable and every DB query fails to connect (frontend + auth
 * still work because those hit Supabase's HTTP APIs, not Postgres). The symptom
 * is: signed-in tRPC calls 500 while the app shell renders. See the runbook.
 *
 * The fix: on Vercel prefer `POSTGRES_URL` (the IPv4 **transaction pooler**,
 * port 6543). The original worry that the transaction pooler blocks RLS does
 * NOT apply here: these tables are OWNED by the `postgres` role and use
 * `ENABLE` (not `FORCE`) RLS, so the owner bypasses RLS on either pooler
 * (verified 2026-07-21); tenant isolation is enforced by the explicit
 * `where user_id = ctx.user.id` filters in every procedure, not by RLS. The
 * pooler also requires `prepare: false`, which is already set below.
 *
 * Off Vercel (local dev, `db:migrate:prod` from a workstation with IPv6, CI)
 * we keep the session-mode connection so migrations run with a stable session.
 */
// eslint-disable-next-line no-restricted-properties
const onVercel = !!process.env.VERCEL;
const connectionUrl = onVercel
  ? (env.POSTGRES_URL ?? env.POSTGRES_URL_NON_POOLING)
  : (env.POSTGRES_URL_NON_POOLING ?? env.POSTGRES_URL);

// Fail fast with a diagnostic error when the env var is absent at runtime (CR-04).
// During known build/CI phases the env vars are legitimately absent — silently
// skip and export an undefined-cast placeholder instead (the DB is never called
// during a build step).
if (!connectionUrl) {
  const isBuildTimeSkip =
    // eslint-disable-next-line no-restricted-properties
    !!process.env.CI ||
    // eslint-disable-next-line no-restricted-properties
    !!process.env.SKIP_ENV_VALIDATION ||
    // eslint-disable-next-line no-restricted-properties
    process.env.npm_lifecycle_event === "lint" ||
    // eslint-disable-next-line no-restricted-properties
    process.env.NEXT_PHASE === "phase-production-build" ||
    // eslint-disable-next-line no-restricted-properties
    process.env.NEXT_PHASE === "phase-export";

  if (!isBuildTimeSkip) {
    throw new Error(
      "[packages/db] POSTGRES_URL_NON_POOLING and POSTGRES_URL are both unset. " +
        "Copy .env.example to .env.local and fill in your database credentials.",
    );
  }
}

/**
 * Parse the connection URL into DISCRETE params instead of handing the URL
 * string to postgres-js (prod-500 fix #2, 2026-07-21). Supabase's pooler
 * requires the tenant username `postgres.<ref>`, but postgres-js's own URL
 * parser mangles that dotted username and authenticates as bare `postgres`,
 * which the pooler rejects ("password authentication failed for user
 * postgres") — even when the password is correct. Passing host/port/user/pass
 * discretely (verified live via /api/dbcheck: discrete OK, url-string FAILS)
 * sends the tenant username intact. decodeURIComponent handles %-encoded chars.
 */
function connectionOptions(url: string): postgres.Options<Record<string, never>> {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

// `prepare: false` is required by the Supabase transaction pooler. On Vercel we
// also cap the per-instance pool (frozen serverless instances otherwise hold
// idle connections until the DB's connection ceiling is hit) and expire idle
// connections quickly.
const client = connectionUrl
  ? postgres({
      ...connectionOptions(connectionUrl),
      prepare: false,
      ...(onVercel ? { max: 1, idle_timeout: 20, connect_timeout: 15 } : {}),
    })
  : (undefined as unknown as postgres.Sql);

export const db = client
  ? drizzle(client, { schema, logger: true })
  : (undefined as unknown as ReturnType<typeof drizzle<typeof schema>>);
