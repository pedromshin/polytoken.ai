/**
 * Phase 75 (CPF-03) — Correction-propagation flywheel: correction_propagations.
 *
 * When a human confirms an entity merge (survivor S absorbs T), that one
 * correction is meant to CASCADE: the AMBIGUOUS sender→entity suggestion edges
 * get promoted to EXTRACTED canon, and the absorbed identity's past emails get
 * re-labeled onto the survivor (an async worker fan-out). This table is the
 * durable, importer-scoped LEDGER of what a given cascade touched — needed for
 * idempotency (one row per cascade `job_key`), audit, and the visible "here's
 * what your one click changed" affordance.
 *
 * ## Capture shape only (75-01 posture, mirrors entity_type_corrections / 57-01)
 * There is NO consumer of this table yet — the CascadeCorrectionUseCase that
 * writes it (Plan 75-02/03) is a separate, reviewed change. This file only
 * mirrors the table shape so `drizzle-kit check` stays green, and ships the
 * additive migration so the primitive is ready when the cascade lands.
 *
 * ## Tenancy (TENA-03 / D-21)
 * Importer-descendant, hard-FK to `importers` (never a bare user_id) — the same
 * anchor `entity_type_corrections` uses. Owner-scoping RLS (the importer-subquery
 * PERMISSIVE policy) ships in the SAME migration, mirroring 0038. survivor/absorbed
 * FK to `entity_instances` (cascade) so a deleted entity's ledger rows go with it.
 *
 * ## Idempotency (CPF-02)
 * `job_key` (`cascade:{survivor}:{target}`) is UNIQUE — the cascade inserts ON
 * CONFLICT DO NOTHING, so a redelivered/re-run cascade writes no duplicate row.
 *
 * ## JSONB id-set columns
 * `promoted_edge_ids` / `affected_email_ids` are `string[]` captured whole (never
 * per-element addressed), the same idiom code_islands.input_bindings uses.
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { EntityInstances } from "./entity-instances";
import { Importers } from "./importers";

// ---------------------------------------------------------------------------
// correction_propagations
// ---------------------------------------------------------------------------
export const CorrectionPropagations = pgTable(
  "correction_propagations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    importerId: uuid("importer_id")
      .notNull()
      .references(() => Importers.id, { onDelete: "cascade" }),

    // The identity that survived the merge (the correction's target of truth).
    survivorEntityInstanceId: uuid("survivor_entity_instance_id")
      .notNull()
      .references(() => EntityInstances.id, { onDelete: "cascade" }),

    // The identity that was merged away (absorbed into the survivor).
    absorbedEntityInstanceId: uuid("absorbed_entity_instance_id")
      .notNull()
      .references(() => EntityInstances.id, { onDelete: "cascade" }),

    // knowledge_node_edge ids the cascade promoted INFERRED/AMBIGUOUS → EXTRACTED.
    promotedEdgeIds: jsonb("promoted_edge_ids").$type<string[]>().notNull().default([]),

    // email ids enqueued for the async re-label fan-out (re-point onto survivor).
    affectedEmailIds: jsonb("affected_email_ids").$type<string[]>().notNull().default([]),

    // Idempotency key (`cascade:{survivor}:{target}`) — unique, insert ON CONFLICT
    // DO NOTHING so a re-run of the same cascade never double-writes (CPF-02).
    jobKey: text("job_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    correctionPropagationsImporterIdx: index(
      "idx_correction_propagations_importer_id",
    ).on(t.importerId),
    correctionPropagationsSurvivorIdx: index(
      "idx_correction_propagations_survivor_id",
    ).on(t.survivorEntityInstanceId),
    // One ledger row per cascade — the idempotency arbiter (CPF-02).
    correctionPropagationsJobKeyIdx: uniqueIndex(
      "uq_correction_propagations_job_key",
    ).on(t.jobKey),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CorrectionPropagationRow = typeof CorrectionPropagations.$inferSelect;
export type InsertCorrectionPropagation =
  typeof CorrectionPropagations.$inferInsert;
