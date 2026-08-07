/**
 * learning/index.ts — learningRouter (vLAUNCH WEDG-03: first learning-loop
 * metric).
 *
 * ONE owner-scoped read (`learning.summary`) over the two correction ledgers:
 *
 *   - `entity_type_corrections` (Phase 57 / LEARN-01) — one row per genuine
 *     entity-type reclassification a human made on a component.
 *   - `correction_propagations` (Phase 75 / CPF-03) — one row per confirmed
 *     merge cascade (survivor absorbs target), carrying the re-label fan-out
 *     payload (`affected_email_ids`) that measures propagation leverage.
 *
 * ## Metric definitions (the router's contract — documented here, tested in
 * ## __tests__/learning-summary.test.ts)
 *
 *   - `typeCorrections` / `mergeCascades`: plain row counts of each ledger.
 *   - `correctionsMade` = typeCorrections + mergeCascades.
 *   - `emailsRelabeled` = Σ |affected_email_ids| over the caller's cascades —
 *     how many past emails one click re-pointed.
 *   - `relabelsPerCorrection` = emailsRelabeled / mergeCascades (propagation
 *     leverage per cascade), `null` until any cascade exists (0/0 is not 0 —
 *     an honest "no reading yet").
 *   - `stickRate` — the % of corrections that STICK. Neither ledger records an
 *     explicit undo event, so the defensible schema-derived definition is
 *     SUPERSESSION: a correction sticks iff no STRICTLY-LATER correction
 *     re-corrects the same subject.
 *       * a type correction sticks iff no later `entity_type_corrections` row
 *         targets the same `component_id` (the type was set again — the earlier
 *         call did not hold);
 *       * a merge cascade sticks iff no later `correction_propagations` row
 *         ABSORBS this cascade's survivor (`absorbed_entity_instance_id =
 *         survivor_entity_instance_id`) — the surviving identity being merged
 *         away later means the earlier merge decision was overridden.
 *     `stickRate` = sticking / correctionsMade, `null` when correctionsMade
 *     is 0. (The proposal's "not re-corrected within N days" window would
 *     require an arbitrary N; unwindowed supersession is stricter and needs
 *     no such constant. Ties on created_at do not supersede.)
 *
 * ## Tenancy (mirrors billing.usage EXACTLY)
 * Every read joins the ledger's `importer_id` to `importers` and filters
 * `importers.user_id = ctx.user.id` — both tables are importer-descendant
 * (TENA-03 / D-21: hard-FK to importers, never a bare user_id), so the join
 * IS the tenant boundary. The acting identity is ALWAYS `ctx.user.id`, never
 * a client field.
 *
 * ## Graceful zero (WEDG-03 reads zero until WEDG-01 flips the cascade flag)
 * Row volumes are human-scale (hand corrections), so the router fetches the
 * caller's rows and derives the metrics in process — and, like billing.usage,
 * each query degrades to an empty read on failure (e.g. a table absent before
 * its migration) rather than 500ing. All-zeros is the honest pre-flip state.
 */

import { eq } from "drizzle-orm";

import {
  CorrectionPropagations,
  EntityTypeCorrections,
  Importers,
} from "@polytoken/db/schema";

import { createTRPCRouter, protectedProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The `learning.summary` payload — see the metric definitions above. */
export interface LearningSummary {
  /** typeCorrections + mergeCascades. */
  readonly correctionsMade: number;
  /** entity_type_corrections rows owned by the caller. */
  readonly typeCorrections: number;
  /** correction_propagations rows owned by the caller. */
  readonly mergeCascades: number;
  /** Σ |affected_email_ids| across the caller's cascades. */
  readonly emailsRelabeled: number;
  /** emailsRelabeled / mergeCascades; null until any cascade exists. */
  readonly relabelsPerCorrection: number | null;
  /** Sticking corrections / correctionsMade in [0, 1]; null until any correction exists. */
  readonly stickRate: number | null;
}

/** The columns `summary` reads from entity_type_corrections. */
export interface TypeCorrectionSample {
  readonly componentId: string;
  readonly createdAt: Date;
}

/** The columns `summary` reads from correction_propagations. */
export interface PropagationSample {
  readonly survivorEntityInstanceId: string;
  readonly absorbedEntityInstanceId: string;
  /** jsonb payload — defensively re-checked at runtime (Array.isArray). */
  readonly affectedEmailIds: ReadonlyArray<string> | null;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Pure derivation — exported for direct unit testing
// ---------------------------------------------------------------------------

/** |affected_email_ids| with a runtime guard — a jsonb column is a boundary. */
function relabelCount(ids: PropagationSample["affectedEmailIds"]): number {
  return Array.isArray(ids) ? ids.length : 0;
}

/**
 * deriveLearningSummary — the pure metric derivation (definitions in the
 * module header). Never mutates its inputs; O(n) over the caller's rows.
 */
export function deriveLearningSummary(
  typeCorrections: ReadonlyArray<TypeCorrectionSample>,
  propagations: ReadonlyArray<PropagationSample>,
): LearningSummary {
  const typeCount = typeCorrections.length;
  const cascadeCount = propagations.length;
  const correctionsMade = typeCount + cascadeCount;

  const emailsRelabeled = propagations.reduce(
    (sum, row) => sum + relabelCount(row.affectedEmailIds),
    0,
  );

  // Latest correction per component — a type correction sticks iff nothing
  // strictly later re-corrected the same component.
  const latestByComponent = new Map<string, number>();
  for (const row of typeCorrections) {
    const at = row.createdAt.getTime();
    const prev = latestByComponent.get(row.componentId);
    latestByComponent.set(row.componentId, prev === undefined ? at : Math.max(prev, at));
  }
  const stickingTypeCorrections = typeCorrections.filter((row) => {
    const latest = latestByComponent.get(row.componentId);
    return latest === undefined || row.createdAt.getTime() >= latest;
  }).length;

  // Latest absorption per absorbed entity — a cascade sticks iff its survivor
  // was never itself absorbed by a strictly later cascade.
  const latestAbsorbedAt = new Map<string, number>();
  for (const row of propagations) {
    const at = row.createdAt.getTime();
    const prev = latestAbsorbedAt.get(row.absorbedEntityInstanceId);
    latestAbsorbedAt.set(
      row.absorbedEntityInstanceId,
      prev === undefined ? at : Math.max(prev, at),
    );
  }
  const stickingCascades = propagations.filter((row) => {
    const absorbedAt = latestAbsorbedAt.get(row.survivorEntityInstanceId);
    return absorbedAt === undefined || absorbedAt <= row.createdAt.getTime();
  }).length;

  return {
    correctionsMade,
    typeCorrections: typeCount,
    mergeCascades: cascadeCount,
    emailsRelabeled,
    relabelsPerCorrection:
      cascadeCount === 0 ? null : emailsRelabeled / cascadeCount,
    stickRate:
      correctionsMade === 0
        ? null
        : (stickingTypeCorrections + stickingCascades) / correctionsMade,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const learningRouter = createTRPCRouter({
  /**
   * summary — the caller's learning-loop metrics (definitions in the module
   * header). STRICTLY caller-scoped: both reads join importer_id → importers
   * and filter importers.user_id = ctx.user.id. Graceful: each read degrades
   * to empty on failure, so the procedure never 500s pre-migration and reads
   * an honest all-zeros before the cascade flag flips.
   */
  summary: protectedProcedure.query(async ({ ctx }): Promise<LearningSummary> => {
    let typeCorrections: ReadonlyArray<TypeCorrectionSample> = [];
    let propagations: ReadonlyArray<PropagationSample> = [];

    try {
      typeCorrections = await ctx.db
        .select({
          componentId: EntityTypeCorrections.componentId,
          createdAt: EntityTypeCorrections.createdAt,
        })
        .from(EntityTypeCorrections)
        .innerJoin(Importers, eq(EntityTypeCorrections.importerId, Importers.id))
        .where(eq(Importers.userId, ctx.user.id));
    } catch (error) {
      // Graceful default — a missing table / unapplied migration reads as 0.
      // Logged so a genuine post-migration failure is distinguishable from the
      // honest pre-flip zero state on the server side.
      console.error("[learning.summary] entity_type_corrections read failed — rendering zeros:", error);
      typeCorrections = [];
    }

    try {
      propagations = await ctx.db
        .select({
          survivorEntityInstanceId: CorrectionPropagations.survivorEntityInstanceId,
          absorbedEntityInstanceId: CorrectionPropagations.absorbedEntityInstanceId,
          affectedEmailIds: CorrectionPropagations.affectedEmailIds,
          createdAt: CorrectionPropagations.createdAt,
        })
        .from(CorrectionPropagations)
        .innerJoin(Importers, eq(CorrectionPropagations.importerId, Importers.id))
        .where(eq(Importers.userId, ctx.user.id));
    } catch (error) {
      console.error("[learning.summary] correction_propagations read failed — rendering zeros:", error);
      propagations = [];
    }

    return deriveLearningSummary(typeCorrections, propagations);
  }),
});
