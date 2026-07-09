import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  createTRPCContext,
  createTRPCRouter,
  createCallerFactory,
  protectedProcedure,
} from "./trpc";

describe("createTRPCContext", () => {
  it("carries the provided user through to ctx.user", () => {
    const ctx = createTRPCContext({
      headers: new Headers(),
      user: { id: "u1" },
    });
    expect(ctx.user?.id).toBe("u1");
  });

  it("carries a null user through to ctx.user when sessionless", () => {
    const ctx = createTRPCContext({ headers: new Headers(), user: null });
    expect(ctx.user).toBeNull();
  });
});

describe("protectedProcedure", () => {
  const testRouter = createTRPCRouter({
    whoAmI: protectedProcedure.query(({ ctx }) => ctx.user.id),
    whoAmIWithInput: protectedProcedure
      .input(z.object({ userId: z.string() }))
      // Identity-injection acceptance gate (AUTH-03): the resolver must
      // return ctx.user.id — the server-verified session identity — and
      // must NEVER trust input.userId, even though the caller supplies a
      // different attacker-controlled value.
      .query(({ ctx }) => ctx.user.id),
  });

  const createCaller = createCallerFactory(testRouter);

  it("throws UNAUTHORIZED when ctx.user is null", async () => {
    const caller = createCaller(
      createTRPCContext({ headers: new Headers(), user: null }),
    );

    await expect(caller.whoAmI()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.whoAmI()).rejects.toBeInstanceOf(TRPCError);
  });

  it("runs the resolver and exposes ctx.user.id when a session user is present", async () => {
    const caller = createCaller(
      createTRPCContext({ headers: new Headers(), user: { id: "u1" } }),
    );

    await expect(caller.whoAmI()).resolves.toBe("u1");
  });

  it("derives identity from ctx.user, never from client-supplied input (identity-injection gate)", async () => {
    const caller = createCaller(
      createTRPCContext({ headers: new Headers(), user: { id: "u1" } }),
    );

    // Attacker supplies a different userId in the input payload.
    const result = await caller.whoAmIWithInput({ userId: "attacker-u2" });

    expect(result).toBe("u1");
    expect(result).not.toBe("attacker-u2");
  });
});
