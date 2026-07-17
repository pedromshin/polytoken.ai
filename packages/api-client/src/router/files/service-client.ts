/**
 * service-client.ts — the ONE place in `@polytoken/api-client` that imports
 * `@supabase/supabase-js` (Phase 66 Plan 02, D-66-02).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ON `trpc.ts`'s "dependency-free of Supabase" NOTE (T-43-P3-04) — SETTLED
 * HERE, ONCE, BECAUSE THE NEXT READER WILL ASK.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `trpc.ts` says this package "stays framework-agnostic — it does NOT import
 * `next/headers` or `@supabase/ssr`", and defines its own minimal `SessionUser`
 * rather than importing `User` from supabase-js. That rule governs the CONTEXT
 * SHAPE: identity must be resolved by the CALLER (the Next.js route handler,
 * via a verified `supabase.auth.getUser()`) and handed in as a plain value, so
 * that no procedure can reach for a request-scoped auth primitive and no
 * framework leaks into the router layer.
 *
 * An ISOMORPHIC STORAGE client, constructed inside one router directory, from
 * two env vars, at call time, is a different thing entirely: it reads no
 * cookies, touches no request context, and resolves no identity — identity
 * still arrives only as `ctx.user`. It is the same posture
 * `apps/web/src/app/api/attachments/[id]/route.ts` already ships. The letter
 * and the spirit of T-43-P3-04 both survive.
 *
 * SECURITY: this client holds SERVICE-ROLE credentials. It can address EVERY
 * user's objects. The only things standing between an input and that reach are
 * `ctx.user.id` and `vaultKey` — which is why Plan 01 made key construction a
 * chokepoint rather than a convention.
 */

import { createClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

import type { VaultStorageClient } from "./vault-types";

/** The vault's bucket. Created by the orchestrator per SCHEMA-REQUEST.md. */
export const VAULT_BUCKET = "user-files";

/**
 * Mint a service-role storage client scoped to the vault bucket.
 *
 * THE ENV IS READ INSIDE THIS FUNCTION, NEVER AT MODULE TOP LEVEL. A top-level
 * read would make merely IMPORTING the files router a hard dependency on
 * secrets — which breaks the test run and the build, in both cases at import
 * time and for reasons that look nothing like the actual cause.
 *
 * @throws TRPCError INTERNAL_SERVER_ERROR when either secret is missing.
 */
export function createServiceRoleVaultClient(): VaultStorageClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Missing-secret guard (T-05-09), copied in spirit from the attachments
  // route: the real state goes to the server log; the client is told only that
  // storage is not configured. It learns nothing about WHICH secret is absent
  // — an error that names the missing variable is a free configuration probe.
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[files/service-client] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Storage is not configured",
    });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // No session to persist and none to refresh: this client is minted per
      // call, server-side, and authenticates with the service-role key alone.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Narrowed to Plan 01's structural seam. The adapter is typed against the
  // five methods it uses and cannot reach the rest of the Supabase surface —
  // which is the point: a client that can do anything, handed to code that
  // needs five methods, is a client that will eventually do anything.
  return client.storage.from(VAULT_BUCKET) as unknown as VaultStorageClient;
}
