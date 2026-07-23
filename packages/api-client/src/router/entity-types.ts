/**
 * entityTypesRouter — tRPC router for entity type enumeration.
 *
 * Provides a `list` query that reads active entity types joined with their
 * fields from Drizzle, then groups the flat join rows into a nested structure.
 *
 * Design notes:
 * - groupEntityTypeRows is exported as a pure helper to enable unit testing
 *   without a DB connection.
 * - All output objects are new (immutable) — input rows are never mutated.
 *
 * Tenancy (Phase 44, TENA-03 / T-44-06-01): `list` is protectedProcedure and
 * returns system-default types (importer_id IS NULL — the migration-seeded
 * taxonomy, visible to every authenticated user) OR-ed with the caller's
 * owned-importer overrides — never another user's overrides. The same
 * NULL-or-owned scope is applied to the joined entity_type_fields rows so a
 * foreign user's field override can never ride along on a system type.
 */

import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { EntityTypeFields, EntityTypes } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { RETIRED_SYSTEM_TYPE_SLUGS } from "./retired-entity-types";
import { entityTypesWriteProcedures } from "./entity-types-write";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityTypeField {
  /**
   * The entity_type_fields.id (uuid). Required by the Phase-9 management UI so
   * updateField / deleteField / reorderFields can address a specific field row.
   */
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly isRequired: boolean;
  /** Display order (entity_type_fields.sort_order). */
  readonly sortOrder: number;
  /** is_identifier lives in entity_type_fields.config jsonb (D-27). */
  readonly isIdentifier: boolean;
}

export interface EntityTypeItem {
  /** The entity_types.id (uuid) — needed for update / createField / reorder. */
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly description: string | null;
  /** entity_types.is_active — the management page surfaces + toggles this. */
  readonly isActive: boolean;
  readonly fields: ReadonlyArray<EntityTypeField>;
}

/** Shape of a raw row from the Drizzle join query. */
interface EntityTypeJoinRow {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly fieldId: string | null;
  readonly fieldKey: string | null;
  readonly fieldLabel: string | null;
  readonly fieldDataType: string | null;
  readonly fieldIsRequired: boolean | null;
  readonly fieldSortOrder: number | null;
  readonly fieldIsIdentifier: boolean | null;
}

// ---------------------------------------------------------------------------
// Pure row-grouping helper — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * groupEntityTypeRows — collapses flat left-join rows into nested entity types.
 *
 * - Preserves label order then sortOrder (DB query already orders by these).
 * - Drops null fieldKey rows (entity types with no fields yield fields: []).
 * - Returns new immutable objects; does not mutate input rows.
 */
export function groupEntityTypeRows(
  rows: ReadonlyArray<EntityTypeJoinRow>,
): ReadonlyArray<EntityTypeItem> {
  const order: string[] = [];
  const map = new Map<
    string,
    {
      id: string;
      slug: string;
      label: string;
      description: string | null;
      isActive: boolean;
      fields: EntityTypeField[];
    }
  >();

  for (const row of rows) {
    // Group by entity-type id (slug is not unique across active/inactive +
    // importer scopes; id is the stable key the write mutations address).
    if (!map.has(row.id)) {
      order.push(row.id);
      map.set(row.id, {
        id: row.id,
        slug: row.slug,
        label: row.label,
        description: row.description,
        isActive: row.isActive,
        fields: [],
      });
    }

    if (row.fieldId !== null && row.fieldKey !== null && row.fieldLabel !== null) {
      const entry = map.get(row.id);
      if (entry) {
        map.set(row.id, {
          ...entry,
          fields: [
            ...entry.fields,
            {
              id: row.fieldId,
              key: row.fieldKey,
              label: row.fieldLabel,
              dataType: row.fieldDataType ?? "string",
              isRequired: row.fieldIsRequired ?? false,
              sortOrder: row.fieldSortOrder ?? 0,
              isIdentifier: row.fieldIsIdentifier ?? false,
            },
          ],
        });
      }
    }
  }

  // Build immutable output array preserving insertion order
  return order.map((id) => {
    const entry = map.get(id)!;
    return {
      id: entry.id,
      slug: entry.slug,
      label: entry.label,
      description: entry.description,
      isActive: entry.isActive,
      fields: entry.fields.map((f) => ({ ...f })),
    };
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const entityTypesRouter = createTRPCRouter({
  // Phase 9 (D-26): create/update type + field CRUD/reorder write mutations,
  // proxying the new /v1/entity-types FastAPI endpoints (key server-side only).
  ...entityTypesWriteProcedures,
  /**
   * list — return entity types with their fields, ordered by label.
   *
   * By default only ACTIVE entity types are returned (the Phase-7 pickers want
   * the live set). The Phase-9 management page passes `includeInactive: true`
   * to also list deactivated types so they can be re-activated (D-25).
   *
   * Output: Array<{ id, slug, label, description, isActive, fields: Array<{
   *   id, key, label, dataType, isRequired, sortOrder, isIdentifier }> }>
   * The per-row `id`s are required by the Phase-9 write mutations (update /
   * createField / updateField / deleteField / reorderFields).
   *
   * Tenancy (TENA-03): system defaults (importer_id IS NULL) OR the caller's
   * owned-importer overrides — never another user's overrides. The joined
   * field rows get the same NULL-or-owned scope (a missing left-join field
   * row has a NULL importerId and passes via the isNull branch).
   */
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const includeInactive = input?.includeInactive ?? false;

      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);

      // System defaults are importer_id IS NULL; overrides must be owned.
      // Empty owned set -> system defaults only (inArray([]) is never built).
      const typeScope =
        owned.length > 0
          ? or(
              isNull(EntityTypes.importerId),
              inArray(EntityTypes.importerId, owned),
            )
          : isNull(EntityTypes.importerId);
      const fieldScope =
        owned.length > 0
          ? or(
              isNull(EntityTypeFields.importerId),
              inArray(EntityTypeFields.importerId, owned),
            )
          : isNull(EntityTypeFields.importerId);

      // Retired maritime SYSTEM types never surface — not even under
      // includeInactive (they are being purged, not awaiting re-activation).
      // De Morgan of NOT(system-row AND retired-slug): only importer-NULL
      // rows are targeted; a user's custom type reusing a slug is untouched.
      const notRetired = or(
        isNotNull(EntityTypes.importerId),
        notInArray(EntityTypes.slug, [...RETIRED_SYSTEM_TYPE_SLUGS]),
      );

      const whereClause = includeInactive
        ? and(notRetired, typeScope)
        : and(eq(EntityTypes.isActive, true), notRetired, typeScope);

      const rows = await ctx.db
        .select({
          id: EntityTypes.id,
          slug: EntityTypes.slug,
          label: EntityTypes.label,
          description: EntityTypes.description,
          isActive: EntityTypes.isActive,
          fieldId: EntityTypeFields.id,
          fieldKey: EntityTypeFields.slug,
          fieldLabel: EntityTypeFields.label,
          fieldDataType: EntityTypeFields.fieldType,
          fieldIsRequired: EntityTypeFields.isRequired,
          fieldSortOrder: EntityTypeFields.sortOrder,
          // is_identifier lives in the config jsonb (D-27) — coalesce to false.
          fieldIsIdentifier: sql<boolean>`COALESCE((${EntityTypeFields.config} ->> 'is_identifier')::boolean, false)`,
        })
        .from(EntityTypes)
        // fieldScope lives in the join ON clause (not WHERE) so a type whose
        // field rows are all filtered out still surfaces with fields: [].
        .leftJoin(
          EntityTypeFields,
          and(eq(EntityTypeFields.entityTypeId, EntityTypes.id), fieldScope),
        )
        .where(whereClause)
        .orderBy(EntityTypes.label, EntityTypeFields.sortOrder);

      return groupEntityTypeRows(rows);
    }),
});
