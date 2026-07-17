"use client";

/**
 * vault-api.tsx — a TEMPORARY, lane-scoped tRPC client for the /files surface
 * (Phase 66 Plan 02 Task 3, D-66-03).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS TEMPORARY. ITS LIFE ENDS AT MERGE.
 * ────────────────────────────────────────────────────────────────────────────
 * `root.ts` is orchestrator-reserved (LANE-CONTRACTS), so `files: filesRouter`
 * is not wired yet — which means `api.files.*` on the global client
 * (`~/trpc/react`) cannot typecheck in this worktree, and this lane's bar is a
 * clean in-worktree `tsc`. So the surface addresses the same `/api/trpc`
 * endpoint through its own `createTRPCReact` instance, typed against the same
 * router composition `root.ts` will produce.
 *
 * THE CLEANUP CONTRACT (post-merge, non-blocking): the moment `root.ts` gains
 * `files: filesRouter`, DELETE this file and find-replace `vaultApi` ->
 * `api` from `~/trpc/react`, dropping `VaultApiProvider` from `files/page.tsx`
 * (the app-wide `TRPCReactProvider` already covers it). Without this note the
 * seam becomes a permanent second client that nobody dares remove.
 *
 * WHY IT WORKS AT RUNTIME THE INSTANT root.ts IS WIRED: both clients address
 * procedure path `files.*` over the same transport with the same transformer.
 * The wire format is identical; only the local type binding differs.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY BOTH ROUTER IMPORTS BELOW ARE `import type` — LOAD-BEARING, NOT STYLE
 * ────────────────────────────────────────────────────────────────────────────
 * `packages/api-client/src/trpc.ts` imports `db` from `@polytoken/db/client`.
 * A VALUE import of `createTRPCRouter` from this "use client" module would
 * therefore drag the database client — and its connection string — into the
 * BROWSER bundle. `import type` is erased at compile, so the runtime import
 * graph of this file is exactly: @trpc/client, @trpc/react-query,
 * @tanstack/react-query, superjson. Nothing from the server package.
 *
 * If you ever need a value from `@polytoken/api-client` here, that is not a
 * missing import — it is a design error.
 */

import type { QueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import SuperJSON from "superjson";

// TYPE-ONLY — erased at compile. See the header before changing either line.
import type { createTRPCRouter } from "../../../../../../packages/api-client/src/trpc";
import type { filesRouter } from "../../../../../../packages/api-client/src/router/files";

import { createQueryClient } from "~/trpc/query-client";

/**
 * The router shape `root.ts` will have once wired — composed from the router
 * package's OWN `createTRPCRouter`, so it is a real type rather than a cast.
 * A cast here would defeat the whole seam: it would let a mismatched procedure
 * shape reach main and only fail at runtime, on the user's machine.
 */
type VaultAppRouter = ReturnType<
  typeof createTRPCRouter<{ files: typeof filesRouter }>
>;

export const vaultApi = createTRPCReact<VaultAppRouter>();

/**
 * Mirrors `~/trpc/react`'s own `getBaseUrl` exactly. Diverging on the endpoint
 * or the transformer produces a failure `tsc` cannot see — SuperJSON is what
 * carries a `Date` across the wire intact, and a mismatch only surfaces when a
 * real date is on it.
 */
const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
};

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") return createQueryClient();
  return (clientQueryClientSingleton ??= createQueryClient());
};

/**
 * The surface's provider. Reuses `~/trpc/query-client`'s `createQueryClient`
 * rather than minting a second config, so the vault's caching behaves like the
 * rest of the app and there is one fewer thing to reconcile at cleanup.
 *
 * Mounting this changes nothing in the app-wide tree: `files/page.tsx` wraps
 * only itself.
 */
export function VaultApiProvider(props: {
  children: React.ReactNode;
}): React.ReactElement {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    vaultApi.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers() {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <vaultApi.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </vaultApi.Provider>
    </QueryClientProvider>
  );
}
