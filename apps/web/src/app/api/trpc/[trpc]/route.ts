import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter, createTRPCContext } from "@polytoken/api-client";

import { createClient } from "~/lib/supabase/server";

/**
 * Give procedures a real budget. Defense-in-depth for the checkout hang: the
 * cause was `createCheckoutSession` holding a DB transaction across two Stripe
 * round trips (fixed in @polytoken/billing), but the reason it surfaced as a
 * silent hang rather than an error is this route. The clients use
 * `httpBatchStreamLink`, which commits HTTP 200 BEFORE procedures resolve, so an
 * invocation killed at the platform default cuts the stream with no error frame —
 * `onError` never fires and the caller's promise never settles. 60s is the
 * ceiling on Hobby and well within Pro.
 */
export const maxDuration = 60;

const createContext = async (req: NextRequest) => {
  const supabase = await createClient();
  // Server-verified identity ONLY (T-43-P3-03) — see server.ts's contract.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return createTRPCContext({
    headers: req.headers,
    user: user ? { id: user.id, email: user.email } : null,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createContext(req),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });

export { handler as GET, handler as POST };
