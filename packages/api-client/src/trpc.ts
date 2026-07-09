/**
 * tRPC server setup.
 *
 * Mirrors the acme-os-dev pattern. Identity is session-derived: the Next.js
 * route handler (`apps/web/src/app/api/trpc/[trpc]/route.ts`) resolves the
 * verified Supabase session user via `supabase.auth.getUser()` and passes it
 * into `createTRPCContext` as `user`. This module never reads identity from
 * procedure input, and it stays framework-agnostic — it does NOT import
 * `next/headers` or `@supabase/ssr` itself (T-43-P3-04); it only receives and
 * exposes a plain `user` value.
 *
 * @see https://trpc.io/docs/server/context
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { db } from "@polytoken/db/client";

/**
 * Minimal session-user shape. Defined locally (rather than importing
 * `User` from `@supabase/supabase-js`) so `@polytoken/api-client` stays
 * dependency-free of Supabase — the caller only needs to pass an
 * `{ id, email? }` shaped value.
 */
export type SessionUser = {
  readonly id: string;
  readonly email?: string | null;
};

/**
 * 1. CONTEXT
 *
 * Everything a procedure can reach while handling a request. `user` is the
 * server-verified session identity (or `null` when signed out) — it MUST be
 * resolved server-side by the caller (e.g. via `supabase.auth.getUser()`)
 * and is never derived from client-supplied input (T-43-P3-01).
 */
export const createTRPCContext = (opts: {
  headers: Headers;
  user: SessionUser | null;
}) => {
  return {
    headers: opts.headers,
    db,
    user: opts.user,
  };
};

export type TRPCContext = ReturnType<typeof createTRPCContext>;

/**
 * 2. INITIALIZATION
 *
 * Connect the context and the superjson transformer (needed so `Date` columns
 * like `receivedAt` survive the network boundary intact).
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
    },
  }),
});

/**
 * Create a server-side caller.
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthenticated) procedure — for genuinely public/system routes.
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure — rejects calls with no session user.
 *
 * Throws `TRPCError({ code: "UNAUTHORIZED" })` when `ctx.user` is null
 * (T-43-P3-02), and otherwise narrows `ctx.user` to non-null for every
 * downstream resolver (T-43-P3-01: the acting identity is always
 * `ctx.user`, never a client-supplied input field).
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});
