/**
 * desktop/index.ts — desktopRouter: the E5 Cloud Desktop lifecycle control plane (RFC §5 / §6).
 *
 * Five procedures over the owner-scoped `desktop_sessions` table, each the server side of one
 * `desktop.*` capability. Discipline:
 *
 *   - Every procedure is `protectedProcedure`; the acting identity is ALWAYS `ctx.user.id`, never a
 *     client field (INV-8). spawn sets the owner server-side; attach/hibernate/destroy assert
 *     ownership at the TOP via `assertDesktopSessionOwnership` — missing-or-not-yours both surface
 *     as NOT_FOUND (fail-closed, no existence oracle, INV-11: never parse the provider id for authz).
 *   - The VM operations run through the capability registry, resolved BY ID (INV-2:
 *     `registry.get("desktop.spawn")`), whose `execute` delegates to the injected `DesktopProvider`.
 *     That provider is `failClosedDesktopProvider` until the operator explicitly enables AWS
 *     (provider.ts) — so today every verb that touches a machine returns a clean
 *     "provisioning not enabled" error and NO orphan row is written.
 *   - spawn enforces the concurrent-desktop cap (RFC §5.3 layer 1) BEFORE spending money — the
 *     count of the caller's live (non-destroyed) desktops must be under the cap, fail-closed.
 *
 * risk/reversibility are DATA on the capability (INV-4) — this router does not re-implement a
 * confirm flow; the web confirm widget renders from `reversibility` and the user's approval is what
 * reaches `spawn`/`destroy`. The monthly-budget ledger (RFC §5.3 layer 3) and the idle reaper
 * (layer 2) are CD-4 seams recorded here, not built.
 */

import { desc, eq, inArray, and } from "drizzle-orm";
import { z } from "zod";

import {
  createCapabilityRegistry,
  DESKTOP_CAPABILITIES,
  type DesktopExecCtx,
  type DesktopScope,
} from "@polytoken/capabilities";
import { assertDesktopSessionOwnership } from "@polytoken/db/ownership";
import { DesktopSessions } from "@polytoken/db/schema";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { getDesktopProvider } from "./provider";

/** The lifecycle registry, resolved by id (INV-2). Built once at module load. */
const registry = createCapabilityRegistry<DesktopExecCtx, DesktopScope>(DESKTOP_CAPABILITIES);

/** RFC §5.3 layer 1: max simultaneously-live desktops per owner. Conservative default. */
const MAX_CONCURRENT_DESKTOPS = 1;

/** The live (money-or-storage-costing) states — everything but a destroyed VM. */
const LIVE_STATUSES = ["provisioning", "running", "hibernated"] as const;

/**
 * runDesktopCapability — resolve a lifecycle capability BY ID (INV-2), re-validate the input against
 * its own schema at the boundary (the registry erases descriptor input types to `never` for
 * heterogeneous storage; the substrate contract is that a consumer re-parses via `capability.input`
 * before `execute` ever runs — capability.ts's `createCapabilityRegistry` header), then execute
 * through the fails-closed provider. Returns the raw capability output.
 */
async function runDesktopCapability(id: string, rawInput: unknown): Promise<Record<string, unknown>> {
  const capability = registry.get(id);
  if (!capability) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${id} unregistered` });
  }
  // Re-parse at the boundary (INV-2 safety restore), then execute (input/output are `never`-typed
  // on the erased descriptor, so the values cross as `never` and are re-typed by the caller).
  const parsed = capability.input.parse(rawInput);
  const out = await capability.execute(parsed, { provider: getDesktopProvider() });
  return out as Record<string, unknown>;
}

/** Turn the fails-closed provider's rejection into a clean, honest tRPC error. */
function provisioningError(cause: unknown): TRPCError {
  const message =
    cause instanceof Error && /no provider configured/i.test(cause.message)
      ? "Cloud Desktop provisioning is not enabled yet — an AWS provider and budget must be configured first."
      : cause instanceof Error
        ? cause.message
        : "the desktop provider refused the request";
  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}

export const desktopRouter = createTRPCRouter({
  /**
   * spawn — provision a new cloud desktop. Enforces the concurrent cap BEFORE calling the provider
   * (never spend money past the cap), resolves `desktop.spawn` by id, and only writes a row once the
   * provider has actually provisioned. Fails closed with a clean error while provisioning is off.
   */
  spawn: protectedProcedure
    .input(
      z.object({
        region: z.string().trim().min(1).max(64),
        shape: z.string().trim().min(1).max(64),
        provider: z.string().trim().min(1).max(32).default("aws"),
        label: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Concurrent-desktop cap (RFC §5.3 layer 1) — count the caller's live desktops, fail-closed.
      const live = await ctx.db
        .select({ id: DesktopSessions.id })
        .from(DesktopSessions)
        .where(
          and(
            eq(DesktopSessions.userId, ctx.user.id),
            inArray(DesktopSessions.status, [...LIVE_STATUSES]),
          ),
        );
      if (live.length >= MAX_CONCURRENT_DESKTOPS) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `You already have ${live.length} live desktop${live.length === 1 ? "" : "s"} (limit ${MAX_CONCURRENT_DESKTOPS}). Hibernate or destroy one first.`,
        });
      }

      // The provider (fails-closed today) actually provisions the VM. Only on success do we persist.
      let result: { sessionId: string; status: "provisioning" | "running" };
      try {
        result = (await runDesktopCapability("desktop.spawn", {
          provider: input.provider,
          region: input.region,
          shape: input.shape,
        })) as { sessionId: string; status: "provisioning" | "running" };
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        throw provisioningError(cause);
      }

      const rows = await ctx.db
        .insert(DesktopSessions)
        .values({
          userId: ctx.user.id,
          provider: input.provider,
          region: input.region,
          shape: input.shape,
          label: input.label ?? null,
          status: result.status,
          providerInstanceId: result.sessionId,
        })
        .returning();
      return rows[0]!;
    }),

  /**
   * list — the caller's desktops, newest first. Scoped directly to ctx.user.id (INV-8). Includes
   * destroyed rows so the UI can show recent history; the node chrome reads `status`.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(DesktopSessions)
      .where(eq(DesktopSessions.userId, ctx.user.id))
      .orderBy(desc(DesktopSessions.createdAt))
      .limit(50);
  }),

  /**
   * attach — open an existing desktop and return the gateway origin its live stream loads from.
   * Ownership asserted first (NOT_FOUND on missing-or-not-yours). No billing effect.
   */
  attach: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertDesktopSessionOwnership(ctx.db, input.id, ctx.user.id),
      );
      try {
        const out = (await runDesktopCapability("desktop.attach", { sessionId: input.id })) as {
          sessionId: string;
          status: string;
          gatewayUrl: string;
        };
        const rows = await ctx.db
          .update(DesktopSessions)
          .set({ gatewayUrl: out.gatewayUrl, lastAttachedAt: new Date() })
          .where(eq(DesktopSessions.id, input.id))
          .returning();
        return rows[0]!;
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        throw provisioningError(cause);
      }
    }),

  /**
   * hibernate — snapshot + power off ("close the lid"). Reversible; ownership asserted first.
   */
  hibernate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertDesktopSessionOwnership(ctx.db, input.id, ctx.user.id),
      );
      try {
        await runDesktopCapability("desktop.hibernate", { sessionId: input.id });
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        throw provisioningError(cause);
      }
      const rows = await ctx.db
        .update(DesktopSessions)
        .set({ status: "hibernated", hibernatedAt: new Date() })
        .where(eq(DesktopSessions.id, input.id))
        .returning();
      return rows[0]!;
    }),

  /**
   * destroy — delete the VM and its disk permanently (irreversible; the confirm widget rendered
   * from `reversibility` gates the user's approval before this is called). Ownership asserted first.
   */
  destroy: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertDesktopSessionOwnership(ctx.db, input.id, ctx.user.id),
      );
      try {
        await runDesktopCapability("desktop.destroy", { sessionId: input.id });
      } catch (cause) {
        if (cause instanceof TRPCError) throw cause;
        throw provisioningError(cause);
      }
      const rows = await ctx.db
        .update(DesktopSessions)
        .set({ status: "destroyed", destroyedAt: new Date() })
        .where(eq(DesktopSessions.id, input.id))
        .returning();
      return rows[0]!;
    }),
});
