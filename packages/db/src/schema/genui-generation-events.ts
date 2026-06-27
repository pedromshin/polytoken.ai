/**
 * Phase 13 — Generation Layer: genui_generation_events audit table (D-19, GEN-05).
 *
 * Every generation event (intent, model, tokens, attempts, outcome, validation,
 * node/depth count, registry version, latency, importer) is written here as a
 * single row after the validation gate.
 *
 * - intent stored as a canonical hash, never raw prose (D-19, T-13-09 privacy).
 * - outcome CHECK constraint restricts to ok|fallback|escalated (T-13-11 tamper guard).
 * - best-effort audit: the adapter swallows insert failures (T-13-10).
 * - This row is the Phase-14 CACHE-02 seam: cache hit → zero new generation entry.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// genui_generation_events
// ---------------------------------------------------------------------------
export const GenuiGenerationEvents = pgTable(
  "genui_generation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // D-19: intent stored as canonical hash, not raw prose (T-13-09)
    intentHash: text("intent_hash").notNull(),

    modelId: text("model_id").notNull(),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    attempts: integer("attempts").notNull().default(1),

    // Outcome values: ok | fallback | escalated (enforced by CHECK in SQL + writer Literal)
    outcome: text("outcome").notNull(),

    specValidationPassed: boolean("spec_validation_passed").notNull(),

    // Nullable — not always available (e.g. escalated before spec produced)
    specNodeCount: integer("spec_node_count"),
    specDepth: integer("spec_depth"),

    registryVersion: text("registry_version").notNull(),
    latencyMs: integer("latency_ms"),

    importerId: uuid("importer_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    genuiGenerationEventsCreatedAtIdx: index(
      "idx_genui_generation_events_created_at",
    ).on(t.createdAt),
    genuiGenerationEventsImporterIdx: index(
      "idx_genui_generation_events_importer_id",
    ).on(t.importerId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type GenuiGenerationEventRow =
  typeof GenuiGenerationEvents.$inferSelect;
export type InsertGenuiGenerationEvent =
  typeof GenuiGenerationEvents.$inferInsert;
