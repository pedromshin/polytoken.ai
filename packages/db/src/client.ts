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
 * Use session-mode connection (POSTGRES_URL_NON_POOLING) for Drizzle.
 *
 * The transaction-mode pooler (port 6543) strips superuser privileges,
 * causing RLS policies to block all queries (auth.uid() returns NULL).
 * The session-mode connection (port 5432) preserves the postgres role
 * and bypasses RLS.
 */
const connectionUrl = env.POSTGRES_URL_NON_POOLING ?? env.POSTGRES_URL;

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

// Create a new client instance (deferred during CI build when env vars are absent)
const client = connectionUrl
  ? postgres(connectionUrl, { prepare: false })
  : (undefined as unknown as postgres.Sql);

export const db = client
  ? drizzle(client, { schema, logger: true })
  : (undefined as unknown as ReturnType<typeof drizzle<typeof schema>>);
