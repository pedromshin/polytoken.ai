/**
 * apps/web/src/lib/env.public.ts — browser-safe public env (Phase 43 fix).
 *
 * `~/lib/env` validates the FULL schema (including server-only vars) and can
 * therefore never succeed in the browser: client bundles have no real
 * `process.env` object — Next.js only inlines LITERAL
 * `process.env.NEXT_PUBLIC_*` property accesses at build time, so a dynamic
 * `parseEnv(process.env)` sees nothing client-side. Any client component that
 * imported `~/lib/env` crashed on module load (login page regression).
 *
 * This module is the client-safe counterpart: it reads ONLY the two public
 * vars via literal property access (inlined by the bundler) and validates
 * just those. Never add a server-only var here.
 */

import { z } from "zod";

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(
  source: Record<string, string | undefined>,
): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
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

// LITERAL property access is load-bearing — do not refactor into a loop or
// dynamic lookup, or the values vanish from the client bundle.
export const publicEnv: PublicEnv = process.env.SKIP_ENV_VALIDATION
  ? ({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    } as PublicEnv)
  : parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
