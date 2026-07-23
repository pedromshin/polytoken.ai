/**
 * entities/gallery.ts — the `entities.list` tRPC procedure.
 *
 * D-16/D-17: importer-scoped, source='email_extracted', filters, pg_trgm
 * search, sort, limit+1 pagination. Candidates are hidden by default
 * (D-02/D-14 — status defaults to 'confirmed').
 *
 * Security:
 *   T-10-31: every query filters `source='email_extracted'`.
 *   T-10-32: search term is a bound parameter in a Drizzle `sql` fragment;
 *            never string-interpolated.
 *   T-10-33: limit capped at 100, search capped at 200 chars.
 *   T-10-34: status + sort are z.enum allow-lists; out-of-set values rejected.
 */

import { and, asc, count, desc, eq, gt, inArray, isNull, not, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ComponentEntityCandidateLinks,
  EmailComponents,
  EntityInstances,
  EntityTypes,
} from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { resolveListScope } from "../_scope";

// ---------------------------------------------------------------------------
// Input schema — exported for DB-free testing (T-10-34)
// ---------------------------------------------------------------------------

export const listInputSchema = z.object({
  importerId: z.string().uuid().optional(),
  entityTypeId: z.string().uuid().optional(),
  status: z
    .enum(["confirmed", "all", "candidate", "has-pending-duplicates"])
    .default("confirmed"),
  search: z.string().max(200).optional(),
  sort: z.enum(["last_seen", "name", "occurrences"]).default("last_seen"),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export type ListInput = z.infer<typeof listInputSchema>;

// ---------------------------------------------------------------------------
// Raw row shape — what the DB query returns before shaping
// ---------------------------------------------------------------------------

export interface GalleryRawRow {
  readonly id: string;
  readonly displayName: string;
  readonly entityTypeId: string;
  readonly entityTypeLabel: string | null;
  readonly identifiers: Record<string, unknown>;
  readonly lastSeen: Date | null;
  readonly isActive: boolean;
  readonly nautaId: string | null;
  readonly occurrenceCount: number;
  readonly pendingDuplicatesCount: number;
}

// ---------------------------------------------------------------------------
// Gallery item shape — what list returns per entity
// ---------------------------------------------------------------------------

export interface GalleryItem {
  readonly id: string;
  readonly displayName: string;
  readonly entityTypeId: string;
  readonly entityTypeLabel: string | null;
  readonly keyIdentifiers: Record<string, unknown>;
  readonly occurrenceCount: number;
  readonly pendingDuplicatesCount: number;
  readonly lastSeen: Date | null;
  readonly status: "confirmed" | "candidate";
}

// ---------------------------------------------------------------------------
// Pure shaping helper — exported for DB-free testing
// ---------------------------------------------------------------------------

/**
 * shapeGalleryItem — maps a raw DB row to the gallery item shape.
 *
 * Returns a new immutable object; never mutates the input.
 * status: 'confirmed' when isActive=true, 'candidate' when isActive=false.
 */
export function shapeGalleryItem(row: GalleryRawRow): GalleryItem {
  return {
    id: row.id,
    displayName: row.displayName,
    entityTypeId: row.entityTypeId,
    entityTypeLabel: row.entityTypeLabel ?? null,
    keyIdentifiers: { ...row.identifiers },
    occurrenceCount: row.occurrenceCount,
    pendingDuplicatesCount: row.pendingDuplicatesCount,
    lastSeen: row.lastSeen,
    status: row.isActive ? "confirmed" : "candidate",
  };
}

// ---------------------------------------------------------------------------
// Default page size constant (D-17, UI-SPEC)
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25;

// ---------------------------------------------------------------------------
// Gallery procedure
// ---------------------------------------------------------------------------

export const entityGalleryProcedures = {
  /**
   * list — paginated gallery of email-extracted entity instances.
   *
   * Filters: source='email_extracted' always (D-04/D-17), owned-importer
   * scope (TENA-03), entityTypeId, status, search (pg_trgm ILIKE), sort.
   * Returns { items, hasMore, nextOffset } with limit+1 detection (D-17).
   *
   * Tenancy (Phase 44, TENA-03): protectedProcedure requires a session; the
   * importer scope is derived from `userOwnedImporterIds(ctx.db,
   * ctx.user.id)` — a client-supplied `importerId` is only honored when it
   * is in the owned set (`resolveListScope`), never trusted on its own.
   */
  list: protectedProcedure
    .input(listInputSchema)
    .query(async ({ ctx, input }) => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);

      if (!scope.ok) {
        return {
          items: [],
          hasMore: false,
          nextOffset: input.offset,
        };
      }

      // ------------------------------------------------------------------
      // Build WHERE clauses
      // ------------------------------------------------------------------

      const whereClauses = [
        // T-10-31: always scope to email_extracted rows
        eq(EntityInstances.source, "email_extracted"),
        // TENA-03: scope to the caller's owned importers (never the raw
        // client-supplied importerId).
        inArray(EntityInstances.importerId, scope.importerIds),
      ];

      if (input.entityTypeId !== undefined) {
        whereClauses.push(
          eq(EntityInstances.entityTypeId, input.entityTypeId),
        );
      }

      // Status filter (D-02 — candidates hidden by default)
      if (input.status === "confirmed") {
        // isActive=true means confirmed (not merged/deactivated)
        whereClauses.push(eq(EntityInstances.isActive, true));
        whereClauses.push(isNull(EntityInstances.nautaId));
      } else if (input.status === "candidate") {
        // candidate: isActive=false (the deactivated/pending set)
        whereClauses.push(eq(EntityInstances.isActive, false));
      }
      // 'all' and 'has-pending-duplicates' do not add isActive filter here;
      // has-pending-duplicates is filtered via pendingDuplicatesCount > 0 after query

      // pg_trgm search — bound parameter, never interpolated (T-10-32)
      if (input.search !== undefined && input.search.length > 0) {
        const term = `%${input.search}%`;
        whereClauses.push(
          sql`(${EntityInstances.displayName} ILIKE ${term}
            OR ${EntityInstances.identifiers}::text ILIKE ${term}
            OR EXISTS (
              SELECT 1 FROM unnest(${EntityInstances.aliases}) AS alias
              WHERE alias ILIKE ${term}
            ))`,
        );
      }

      // ------------------------------------------------------------------
      // Build ORDER BY
      // ------------------------------------------------------------------
      let orderBy;
      if (input.sort === "name") {
        orderBy = [asc(EntityInstances.displayName)];
      } else if (input.sort === "occurrences") {
        // Sorted by occurrence count descending; handled via subquery sort below
        orderBy = [desc(EntityInstances.displayName)]; // placeholder; overridden below
      } else {
        // last_seen default — use createdAt as proxy (no dedicated lastSeen column)
        orderBy = [desc(EntityInstances.createdAt)];
      }

      // ------------------------------------------------------------------
      // Execute main query with limit+1 (D-17)
      // ------------------------------------------------------------------
      const rawRows = await ctx.db
        .select({
          id: EntityInstances.id,
          displayName: EntityInstances.displayName,
          entityTypeId: EntityInstances.entityTypeId,
          entityTypeLabel: EntityTypes.label,
          identifiers: EntityInstances.identifiers,
          lastSeen: EntityInstances.createdAt,
          isActive: EntityInstances.isActive,
          nautaId: EntityInstances.nautaId,
          // Count distinct emails via candidate links
          occurrenceCount:
            sql<number>`COUNT(DISTINCT ${EmailComponents.emailId})`.mapWith(
              Number,
            ),
          // Pending = unselected candidate links (was_selected = false) that
          // were not human-rejected (was_dismissed = false, D-20/RES-1 —
          // a rejected suggestion must stop counting as "pending" everywhere)
          pendingDuplicatesCount:
            sql<number>`COUNT(DISTINCT CASE WHEN ${ComponentEntityCandidateLinks.wasSelected} = false AND ${ComponentEntityCandidateLinks.wasDismissed} = false THEN ${ComponentEntityCandidateLinks.id} END)`.mapWith(
              Number,
            ),
        })
        .from(EntityInstances)
        .leftJoin(
          EntityTypes,
          eq(EntityTypes.id, EntityInstances.entityTypeId),
        )
        .leftJoin(
          ComponentEntityCandidateLinks,
          eq(
            ComponentEntityCandidateLinks.entityInstanceId,
            EntityInstances.id,
          ),
        )
        .leftJoin(
          EmailComponents,
          eq(
            EmailComponents.id,
            ComponentEntityCandidateLinks.componentId,
          ),
        )
        .where(and(...whereClauses))
        .groupBy(
          EntityInstances.id,
          EntityInstances.displayName,
          EntityInstances.entityTypeId,
          EntityTypes.label,
          EntityInstances.identifiers,
          EntityInstances.createdAt,
          EntityInstances.isActive,
          EntityInstances.nautaId,
        )
        .orderBy(
          ...(input.sort === "name"
            ? [asc(EntityInstances.displayName)]
            : input.sort === "occurrences"
              ? [
                  desc(
                    sql<number>`COUNT(DISTINCT ${EmailComponents.emailId})`,
                  ),
                ]
              : [desc(EntityInstances.createdAt)]),
        )
        .limit(input.limit + 1)
        .offset(input.offset);

      // ------------------------------------------------------------------
      // Post-filter for 'has-pending-duplicates'
      // ------------------------------------------------------------------
      const filtered =
        input.status === "has-pending-duplicates"
          ? rawRows.filter((r) => r.pendingDuplicatesCount > 0)
          : rawRows;

      // ------------------------------------------------------------------
      // limit+1 detection (D-17)
      // ------------------------------------------------------------------
      const hasMore = filtered.length > input.limit;
      const sliced = hasMore ? filtered.slice(0, input.limit) : filtered;

      const items = sliced.map((row) =>
        shapeGalleryItem({
          id: row.id,
          displayName: row.displayName,
          entityTypeId: row.entityTypeId,
          entityTypeLabel: row.entityTypeLabel ?? null,
          identifiers:
            (row.identifiers as Record<string, unknown> | null) ?? {},
          lastSeen: row.lastSeen,
          isActive: row.isActive,
          nautaId: row.nautaId,
          occurrenceCount: row.occurrenceCount,
          pendingDuplicatesCount: row.pendingDuplicatesCount,
        }),
      );

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
      };
    }),
};
