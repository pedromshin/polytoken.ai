/**
 * Phase 31-02 — autofill_retrieval_events: recall/measurement instrumentation (RECALL-02).
 *
 * One best-effort row per AutofillUseCase.execute run. Written from the Python
 * application layer (SupabaseAutofillRetrievalEventRepository) — this Drizzle
 * table is the schema source of truth (types), not the write path itself.
 *
 * RLS deny-all baseline applied via custom SQL migration 0028 (see
 * migrations/0028_autofill_retrieval_events.sql) — service_role bypasses by
 * design (T-31-05). Correction linkage (miss-rate computation) is derived at
 * QUERY TIME by joining extraction_records.corrected_fields on component_id —
 * this table is never mutated for that purpose (packages/db/scripts/
 * retrieval-miss-rate.ts).
 */

import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const AutofillRetrievalEvents = pgTable(
  "autofill_retrieval_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    componentId: uuid("component_id").notNull(),
    importerId: uuid("importer_id"),
    entityTypeId: uuid("entity_type_id"),

    // Per-example {id, score} entries from the retrieved few-shot set.
    seedHits: jsonb("seed_hits"),
    seedHitCount: integer("seed_hit_count").notNull().default(0),

    // Resolved entity injected as <known_entity_context> (RECALL-01), if any.
    injectedEntityInstanceId: uuid("injected_entity_instance_id"),
    injectedAliasCount: integer("injected_alias_count").notNull().default(0),
    injectedIdentifierCount: integer("injected_identifier_count").notNull().default(0),

    // "few_shot_autofill" | "cold_start_autofill" — mirrors extraction_records.routing_reason.
    routingReason: text("routing_reason").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    autofillRetrievalEventsComponentIdx: index("idx_autofill_retrieval_events_component_id").on(t.componentId),
    autofillRetrievalEventsImporterIdx: index("idx_autofill_retrieval_events_importer_id").on(t.importerId),
    autofillRetrievalEventsCreatedAtIdx: index("idx_autofill_retrieval_events_created_at").on(t.createdAt),
  }),
);

export type AutofillRetrievalEventRow = typeof AutofillRetrievalEvents.$inferSelect;
export type InsertAutofillRetrievalEvent = typeof AutofillRetrievalEvents.$inferInsert;
