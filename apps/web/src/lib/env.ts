/**
 * apps/web/src/lib/env.ts — Zod-validated env schema with fail-fast startup
 * validation (AUTH-05 env half, Phase 43 Plan 01).
 *
 * Public (`NEXT_PUBLIC_*`) and server-only var sets are disjoint by
 * construction — `SUPABASE_SERVICE_ROLE_KEY` (and any other secret) must
 * NEVER be added under a `NEXT_PUBLIC_` key, since those values are inlined
 * into the client bundle at build time and shipped to every browser.
 *
 * `parseEnv` throws a single Error whose message begins
 * "Missing/invalid auth environment variables:" followed by the flattened
 * field names, so a missing var names itself clearly at startup rather than
 * failing with an opaque downstream error the first time it's read.
 *
 * `SKIP_ENV_VALIDATION` bypasses the module-level fail-fast — this mirrors
 * the existing repo convention in packages/api-client/vitest.config.ts,
 * which sets it for test runs so unit tests never need real Supabase/email-
 * listener credentials just to import a module.
 */

import { z } from "zod";

export const envSchema = z.object({
  // Server-only vars — never exposed to the browser bundle.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EMAIL_LISTENER_URL: z.string().url(),
  EMAIL_LISTENER_API_KEY: z.string().min(1),

  // Public vars — inlined into the client bundle by design (anon key is
  // public by design; it is subject to RLS, not a secret).
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fieldNames = Object.keys(result.error.flatten().fieldErrors).join(
      ", ",
    );
    throw new Error(
      `Missing/invalid auth environment variables: ${fieldNames}`,
    );
  }
  return result.data;
}

// Module-level fail-fast: importing this module with a required auth var
// missing throws immediately (AUTH-05). SKIP_ENV_VALIDATION bypasses this
// only in test runs (see packages/api-client/vitest.config.ts convention).
export const env = process.env.SKIP_ENV_VALIDATION
  ? (process.env as unknown as Env)
  : parseEnv(process.env);
