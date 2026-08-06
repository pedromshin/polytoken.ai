/**
 * entities/mutations.ts — tRPC mutations that proxy entity-resolution
 * operations (confirmMerge, rejectMerge, unmerge) to the FastAPI service.
 *
 * Security contract (T-10-30 / D-21):
 *   EMAIL_LISTENER_API_KEY is read ONLY inside getListenerConfig() at
 *   call time. The key never appears in client-importable code and is
 *   never NEXT_PUBLIC_.
 *
 * T-06-08: all mutation inputs are zod-validated before any fetch is issued.
 * T-06-10: env vars are read at call time (not module init) so the Next.js
 *          build succeeds without the env vars present.
 *
 * Tenancy (Phase 44, TENA-03 / T-44-06-02): every mutation is
 * protectedProcedure and asserts ownership of EVERY referenced entity's
 * importer (via `assertEntityInstanceOwned` below) BEFORE the FastAPI proxy
 * fetch — a merge must never join an entity the caller does not own.
 * Fail-closed: a missing entity and one anchored to another user's importer
 * both surface as TRPCError NOT_FOUND (no existence oracle).
 *
 * Endpoint paths from 10-UI-SPEC / 10-03:
 *   POST /v1/entity-instances/{id}/merge/{targetId}/confirm
 *   POST /v1/entity-instances/{id}/merge/{targetId}/reject
 *   POST /v1/entity-instances/{id}/unmerge
 */

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { EntityInstances } from "@polytoken/db/schema";
import {
  assertImporterOwnership,
  type OwnershipDb,
} from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { getListenerConfig, parseErrorDetail } from "../_listener-config";

/**
 * Plan 75-03/75-05 (CPF-04): the listener's confirm response MAY carry an
 * additive `cascade` summary — what the flag-gated correction cascade touched
 * (null / absent while CASCADE_CORRECTION_ENABLED is off). Typed + validated
 * here at the boundary (T-06-08's zod discipline applied to the RESPONSE),
 * then passed through UNMODIFIED — `.passthrough()` keeps any keys this
 * client version doesn't know about.
 */
const cascadeSummarySchema = z
  .object({
    survivor_id: z.string(),
    absorbed_id: z.string(),
    promoted_edge_ids: z.array(z.string()),
    affected_email_ids: z.array(z.string()),
  })
  .passthrough();

const confirmMergeResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        entity_instance_id: z.string(),
        target_id: z.string(),
        cascade: cascadeSummarySchema.nullish(),
      })
      .passthrough()
      .nullish(),
    error: z.string().nullish(),
  })
  .passthrough();

export type ConfirmMergeResponse = z.infer<typeof confirmMergeResponseSchema>;

/**
 * assertEntityInstanceOwned — loads the referenced entity_instances row's
 * importer_id and asserts the caller owns that importer (the plan's
 * load-then-assertImporterOwnership recipe for id-addressed rows).
 *
 * Fail-closed: a missing entity throws the same TRPCError NOT_FOUND that a
 * foreign-importer entity does (via assertOwnedOrNotFound) — callers get no
 * signal distinguishing "doesn't exist" from "not yours".
 */
async function assertEntityInstanceOwned(
  db: OwnershipDb,
  entityInstanceId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ importerId: EntityInstances.importerId })
    .from(EntityInstances)
    .where(eq(EntityInstances.id, entityInstanceId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertOwnedOrNotFound(() =>
    assertImporterOwnership(db, row.importerId, userId),
  );
}

export const entityMutationProcedures = {
  /**
   * confirmMerge — mark two entity instances as confirmed duplicates.
   * The entity at entityInstanceId is merged INTO targetId (or vice-versa —
   * the FastAPI service decides survivor based on its merge policy).
   *
   * POST /v1/entity-instances/{entityInstanceId}/merge/{targetId}/confirm
   */
  confirmMerge: protectedProcedure
    .input(
      z.object({
        entityInstanceId: z.string().uuid(),
        targetId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // TENA-03: BOTH sides of the merge must belong to the caller — a merge
      // must never join an entity the caller does not own (T-44-06-02).
      await assertEntityInstanceOwned(ctx.db, input.entityInstanceId, ctx.user.id);
      await assertEntityInstanceOwned(ctx.db, input.targetId, ctx.user.id);

      const { url, apiKey } = getListenerConfig();
      const res = await fetch(
        `${url}/v1/entity-instances/${input.entityInstanceId}/merge/${input.targetId}/confirm`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        throw new Error(await parseErrorDetail(res, "confirmMerge failed"));
      }
      // Validate the envelope (incl. the optional cascade summary) at the
      // boundary, then pass it through unmodified (passthrough keeps unknown
      // keys) — the caller sees exactly what the listener returned.
      const body: unknown = await res.json();
      return confirmMergeResponseSchema.parse(body);
    }),

  /**
   * rejectMerge — dismiss a duplicate suggestion between two entity instances.
   * Prevents the pair from being re-suggested by the RRF resolver (D-21).
   *
   * POST /v1/entity-instances/{entityInstanceId}/merge/{targetId}/reject
   */
  rejectMerge: protectedProcedure
    .input(
      z.object({
        entityInstanceId: z.string().uuid(),
        targetId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // TENA-03: both referenced entities must belong to the caller.
      await assertEntityInstanceOwned(ctx.db, input.entityInstanceId, ctx.user.id);
      await assertEntityInstanceOwned(ctx.db, input.targetId, ctx.user.id);

      const { url, apiKey } = getListenerConfig();
      const res = await fetch(
        `${url}/v1/entity-instances/${input.entityInstanceId}/merge/${input.targetId}/reject`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        throw new Error(await parseErrorDetail(res, "rejectMerge failed"));
      }
      return res.json() as Promise<unknown>;
    }),

  /**
   * unmerge — split a previously confirmed merge back into two separate
   * entity instances (D-20 Unmerge affordance, shown when wasMerged=true).
   *
   * POST /v1/entity-instances/{entityInstanceId}/unmerge
   */
  unmerge: protectedProcedure
    .input(
      z.object({
        entityInstanceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // TENA-03: the entity being unmerged must belong to the caller.
      await assertEntityInstanceOwned(ctx.db, input.entityInstanceId, ctx.user.id);

      const { url, apiKey } = getListenerConfig();
      const res = await fetch(
        `${url}/v1/entity-instances/${input.entityInstanceId}/unmerge`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        throw new Error(await parseErrorDetail(res, "unmerge failed"));
      }
      return res.json() as Promise<unknown>;
    }),
};
