/**
 * _ownership.ts — tiny local wrapper mapping the central ownership helper's
 * OwnershipError to a transport-level TRPCError NOT_FOUND.
 *
 * Every id-addressed emails-router read/mutation (Phase 44 Plan 05, TENA-03)
 * calls one of the central `@polytoken/db/ownership` assert* functions at the
 * TOP of its resolver (before any read/write) and routes it through this
 * wrapper. Fail-closed: a missing row and a row owned by another user both
 * throw the identical OwnershipError from ownership.ts — this wrapper gives
 * callers no signal distinguishing the two beyond mapping both to NOT_FOUND.
 *
 * Extracted here (mirroring the `_listener-config.ts` shared-helper idiom) so
 * ~20 call sites across index.ts/detail.ts/mutations.ts share one mapping
 * instead of duplicating the try/catch.
 */

import { TRPCError } from "@trpc/server";

import { OwnershipError } from "@polytoken/db/ownership";

/**
 * assertOwnedOrNotFound — runs an ownership assert function (e.g.
 * `() => assertComponentOwnership(ctx.db, input.componentId, ctx.user.id)`),
 * converting a thrown OwnershipError into `TRPCError({ code: "NOT_FOUND" })`.
 * Any other error (e.g. a genuine DB connectivity failure) propagates
 * unchanged.
 */
export async function assertOwnedOrNotFound(
  assertFn: () => Promise<void>,
): Promise<void> {
  try {
    await assertFn();
  } catch (error) {
    if (error instanceof OwnershipError) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    throw error;
  }
}
