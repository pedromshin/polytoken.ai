/**
 * Phase 14 — Exact Cache and Template Store: ui_spec_templates (CACHE-01, D-09/D-10).
 *
 * Persists every successfully-validated generated spec as a reusable template.
 * Serves as the Tier-1 exact-match cache store and the flywheel foundation for
 * v1.2 semantic retrieval (Tier-2) and promotion (FLY-01..03 — deferred).
 *
 * Key design choices (Phase 14 context, 14-CONTEXT.md):
 * - cache_key: SHA-256 hex of (canonical_intent ǁ data_shape_hash ǁ registry_version ǁ context)
 *   — UNIQUE index for O(1) exact-match lookup and the ON CONFLICT upsert target (D-10/D-12).
 * - intent_text: canonical (normalized) intent in plaintext — deliberate divergence from the
 *   genui_generation_events audit table which stores only a hash (D-10 judgment call; needed
 *   for v1.2 studio inspection and semantic retrieval).
 * - validation_status: 'validated' only in v1.1 — enforced by DB CHECK (D-11, T-14-03).
 *   Column + CHECK leave room for 'candidate'/'promoted'/'invalidated' in v1.2 without a type change.
 * - RLS deny-all: in migration 0022 (D-20, T-14-01/T-14-02) — FastAPI connects as service-role,
 *   which bypasses RLS; anon/authenticated are denied.
 * - Deferred (v1.2): embedding halfvec, binding_slots, confirm_count, regenerate_count,
 *   feedback_score, promotion_score — see 14-CONTEXT.md <deferred>.
 *
 * Phase 44 (tenancy): this table is deliberately unscoped by `user_id` —
 * exact-match cache reuse is shared cross-tenant by design (D-05/Phase-44 PROJECT.md
 * Key Decisions). Do not "fix" this by adding a user_id column.
 */

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// ui_spec_templates
// ---------------------------------------------------------------------------
export const UiSpecTemplates = pgTable(
  "ui_spec_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // D-04/D-10: SHA-256 hex cache key — UNIQUE (exact-match index + ON CONFLICT target).
    // Composed of: canonical_intent || data_shape_hash || registry_version || context_descriptor.
    cacheKey: text("cache_key").notNull(),

    // D-05/D-10: Canonical (NFC + trim + lowercase + collapse-whitespace) intent text.
    // Stored as plaintext so v1.2 semantic retrieval and studio inspection can use it.
    intentText: text("intent_text").notNull(),

    // D-06/D-10: SHA-256 over the structural shape (keys + types, never values) of bound data.
    dataShapeHash: text("data_shape_hash").notNull(),

    // D-07/D-10: registry_version content hash — the invalidation lever (D-13, CACHE-04).
    // Indexed (btree) so the deploy-hook invalidation query and observability are O(log n).
    registryVersion: text("registry_version").notNull(),

    // D-08/D-10: Per-catalog-id seam (SEAM-03). Defaults to 'global' for v1.1.
    // Combined with importer_id in the (importer_id, catalog_id) btree index for scope queries.
    catalogId: text("catalog_id").notNull().default("global"),

    // D-10: The full validated SpecRoot JSON — exactly as it will re-render.
    // 'validated' status (D-11) guarantees this is always a good spec.
    specJson: jsonb("spec_json").notNull(),

    // D-10/D-11: Only 'validated' specs are persisted in v1.1.
    // DB-level CHECK constraint in 0022_ui_spec_templates.sql enforces this boundary (T-14-03).
    // v1.2 will extend the CHECK to allow 'candidate'/'promoted'/'invalidated'.
    validationStatus: text("validation_status").notNull().default("validated"),

    // D-10: Metadata columns — nullable (not always computable, e.g. escalated path).
    // Reuse the generator's _count_nodes walker; feeds success-criterion-1 "metadata" clause.
    specNodeCount: integer("spec_node_count"),
    specDepth: integer("spec_depth"),

    // D-03/D-10/D-12: Incremented on each cache hit (best-effort). The only promotion-adjacent
    // signal kept in v1.1 — free on the hit path, feeds v1.2 promotion ranking.
    useCount: integer("use_count").notNull().default(0),

    // D-10: Tenant scope — nullable for system-level generations.
    // NO FK (mirrors genui_generation_events importer_id — plain uuid).
    importerId: uuid("importer_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // D-10/D-12: UNIQUE on cache_key — O(1) Tier-1 exact-match lookup + ON CONFLICT target.
    uiSpecTemplatesCacheKeyIdx: uniqueIndex(
      "idx_ui_spec_templates_cache_key",
    ).on(t.cacheKey),

    // D-08/D-10: (importer_id, catalog_id) scope queries — per-tenant / per-catalog filtering.
    uiSpecTemplatesImporterCatalogIdx: index(
      "idx_ui_spec_templates_importer_catalog",
    ).on(t.importerId, t.catalogId),

    // D-10/D-13/D-14: registry_version — deploy-hook invalidation query + observability are O(log n).
    uiSpecTemplatesRegistryVersionIdx: index(
      "idx_ui_spec_templates_registry_version",
    ).on(t.registryVersion),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type UiSpecTemplateRow = typeof UiSpecTemplates.$inferSelect;
export type InsertUiSpecTemplate = typeof UiSpecTemplates.$inferInsert;
