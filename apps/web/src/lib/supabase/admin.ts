/**
 * apps/web/src/lib/supabase/admin.ts — the service-role ADMIN Supabase client
 * (account-deletion lane).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SERVER-ONLY. NEVER IMPORT FROM CLIENT CODE.
 * ────────────────────────────────────────────────────────────────────────────
 * This client holds SERVICE-ROLE credentials: it bypasses RLS, can address
 * EVERY user's rows and storage objects, and — uniquely — can call
 * `auth.admin.deleteUser`, which triggers the full Postgres cascade that
 * account deletion depends on. A single import of this module from a file that
 * ends up in the browser bundle would inline `SUPABASE_SERVICE_ROLE_KEY` into
 * client JavaScript shipped to every visitor. So it is reachable ONLY from
 * Node route handlers (`apps/web/src/app/api/account/**`), never from a
 * component, a hook, or anything a client bundle can pull.
 *
 * Same posture as the two existing service-role constructions this mirrors:
 *   - `apps/web/src/app/api/attachments/[id]/route.ts` (signed-URL proxy), and
 *   - `packages/api-client/src/router/files/service-client.ts` (vault client).
 * THE ENV IS READ INSIDE THE FUNCTION, NEVER AT MODULE TOP LEVEL — a top-level
 * read would make merely IMPORTING this module a hard dependency on the secret,
 * which breaks the test run and the build at import time for reasons that look
 * nothing like the actual cause (service-client.ts settled this exact point).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The vault bucket account deletion sweeps. Mirrors `files/service-client.ts`'s VAULT_BUCKET. */
export const VAULT_BUCKET = "user-files";

/**
 * Mint a service-role admin Supabase client.
 *
 * Exposes `auth.admin.deleteUser` (the cascade trigger) and the service-role
 * `storage` surface (the vault sweep). Constructed per call, server-side,
 * authenticating with the service-role key alone — no session to persist and
 * none to refresh.
 *
 * @throws Error when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. The
 *   caller maps this to a 500 BEFORE deleting anything (missing-secret guard,
 *   T-05-09) — the message names neither secret to the client.
 */
export function createServiceRoleAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[supabase/admin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
    throw new Error("Admin client is not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
