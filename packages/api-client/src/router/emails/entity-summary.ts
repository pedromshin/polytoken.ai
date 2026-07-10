/**
 * emails.entitySummary — per-email entity-type rollup powering the glassy
 * Gmail inbox chips (D-23/D-24).
 *
 * Each inbox row surfaces the distinct entity-type labels (+ counts) extracted
 * from that email. Phase 9's first-class `role` / `entity_type_id` columns on
 * email_components make this cheap: we read components with role='entity' (the
 * preferred path now 09-01 added the column) and join entity_types for labels.
 * No new table (D-23).
 *
 * Performance / DoS (T-09-33): callers pass at most 100 email ids; the query is
 * a single parameterized inArray() — never a per-row fetch.
 *
 * T-05-01: input ids validated as UUIDs via z.string().uuid() before any SQL.
 * T-05-03: all filters use Drizzle parameterized builders — no interpolation.
 *
 * Tenancy (Phase 44, TENA-03): protectedProcedure requires a session. This
 * procedure is importerId-keyed (email_components carries importer_id
 * directly, per assertComponentOwnership's join pattern in
 * @polytoken/db/ownership) — the query additionally filters to the caller's
 * owned importer set via `userOwnedImporterIds`, so a foreign emailId slipped
 * into the batch simply yields an empty entities[] entry rather than leaking
 * another user's entity rollup.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import {
  ComponentEntityCandidateLinks,
  EmailComponents,
  EntityInstances,
  EntityTypes,
} from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntitySummaryEntry {
  readonly entityTypeId: string;
  readonly label: string;
  readonly count: number;
  /**
   * D-24: the entity_instance id for the first selected candidate link in this
   * email for this entityTypeId. Used by EntityChips to deep-link to the entity
   * detail page. Undefined when no selected link exists.
   */
  readonly entityInstanceId?: string;
}

export interface EmailEntitySummary {
  readonly emailId: string;
  readonly entities: ReadonlyArray<EntitySummaryEntry>;
}

/** Shape of a raw entity-component row feeding the aggregation helper. */
export interface EntitySummaryRow {
  readonly emailId: string;
  readonly entityTypeId: string | null;
  readonly label: string | null;
  /**
   * D-24: entity_instance id from a wasSelected=true candidate link.
   * Null/undefined when no selected link exists for this component.
   */
  readonly entityInstanceId?: string | null;
}

// ---------------------------------------------------------------------------
// Pure aggregation helper — exported for DB-free unit testing
// (same testability pattern as groupEntityTypeRows in entity-types.ts)
// ---------------------------------------------------------------------------

/**
 * aggregateEntitySummary — collapse flat entity-component rows into a
 * per-email rollup of distinct entity-type labels + counts.
 *
 * - One output row per requested email id (in `requestedEmailIds` order);
 *   emails with no entity components yield an empty `entities` array.
 * - Rows whose entityTypeId or label is null are skipped (an entity region not
 *   yet typed contributes no chip).
 * - Multiple entity components of the same type collapse into one
 *   `{ entityTypeId, label, count }`. Entries are ordered by first appearance.
 * - Returns new immutable objects; never mutates the input rows.
 */
export function aggregateEntitySummary(
  rows: ReadonlyArray<EntitySummaryRow>,
  requestedEmailIds: ReadonlyArray<string>,
): ReadonlyArray<EmailEntitySummary> {
  // emailId -> (entityTypeId -> { label, count, entityInstanceId, order })
  const byEmail = new Map<
    string,
    {
      order: string[];
      types: Map<
        string,
        { label: string; count: number; entityInstanceId: string | undefined }
      >;
    }
  >();

  const ensureEmail = (emailId: string) => {
    let entry = byEmail.get(emailId);
    if (entry === undefined) {
      entry = { order: [], types: new Map() };
      byEmail.set(emailId, entry);
    }
    return entry;
  };

  for (const row of rows) {
    if (row.entityTypeId === null || row.label === null) continue;
    const entry = ensureEmail(row.emailId);
    const existing = entry.types.get(row.entityTypeId);
    // D-24: keep the first non-null entityInstanceId seen for this group.
    const resolvedInstanceId =
      row.entityInstanceId !== null && row.entityInstanceId !== undefined
        ? row.entityInstanceId
        : undefined;
    if (existing === undefined) {
      entry.order.push(row.entityTypeId);
      entry.types.set(row.entityTypeId, {
        label: row.label,
        count: 1,
        entityInstanceId: resolvedInstanceId,
      });
    } else {
      entry.types.set(row.entityTypeId, {
        label: existing.label,
        count: existing.count + 1,
        // Only promote if the existing slot hasn't been resolved yet
        entityInstanceId: existing.entityInstanceId ?? resolvedInstanceId,
      });
    }
  }

  // Emit one row per requested email id, preserving the requested order so the
  // caller can zip the result back onto its visible page of emails.
  return requestedEmailIds.map((emailId) => {
    const entry = byEmail.get(emailId);
    if (entry === undefined) {
      return { emailId, entities: [] };
    }
    return {
      emailId,
      entities: entry.order.map((entityTypeId) => {
        const t = entry.types.get(entityTypeId)!;
        return {
          entityTypeId,
          label: t.label,
          count: t.count,
          entityInstanceId: t.entityInstanceId,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Procedures — spread into emailsRouter
// ---------------------------------------------------------------------------

export const emailEntitySummaryProcedures = {
  /**
   * entitySummary — batch per-email entity-type rollup keyed by the visible
   * page of email ids. Returns one entry per requested id (empty entities for
   * emails with no typed entity regions).
   */
  entitySummary: protectedProcedure
    .input(
      z.object({
        emailIds: z.array(z.string().uuid()).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.emailIds.length === 0) {
        return [] as ReadonlyArray<EmailEntitySummary>;
      }

      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      if (owned.length === 0) {
        return input.emailIds.map((emailId) => ({ emailId, entities: [] }));
      }

      // Direct path (D-23): components flagged role='entity' with an
      // entity_type_id, joined to entity_types for labels. Rejected/superseded
      // regions are excluded so denied/redrawn boxes never produce chips.
      // D-24: leftJoin ComponentEntityCandidateLinks (wasSelected=true) and
      // EntityInstances (source='email_extracted') to surface entityInstanceId
      // for deep-link navigation to /entities/[id].
      // T-44-05-01: importerId scoped to the caller's owned set — a foreign
      // emailId slipped into the batch matches no owned-importer component and
      // therefore contributes nothing to the aggregation.
      const rows = await ctx.db
        .select({
          emailId: EmailComponents.emailId,
          entityTypeId: EmailComponents.entityTypeId,
          label: EntityTypes.label,
          entityInstanceId: EntityInstances.id,
        })
        .from(EmailComponents)
        .leftJoin(
          EntityTypes,
          eq(EntityTypes.id, EmailComponents.entityTypeId),
        )
        .leftJoin(
          ComponentEntityCandidateLinks,
          and(
            eq(ComponentEntityCandidateLinks.componentId, EmailComponents.id),
            eq(ComponentEntityCandidateLinks.wasSelected, true),
          ),
        )
        .leftJoin(
          EntityInstances,
          and(
            eq(EntityInstances.id, ComponentEntityCandidateLinks.entityInstanceId),
            eq(EntityInstances.source, "email_extracted"),
          ),
        )
        .where(
          and(
            inArray(EmailComponents.emailId, input.emailIds),
            inArray(EmailComponents.importerId, owned),
            eq(EmailComponents.role, "entity"),
            ne(EmailComponents.extractionStatus, "rejected"),
            ne(EmailComponents.extractionStatus, "superseded"),
          ),
        );

      return aggregateEntitySummary(rows, input.emailIds);
    }),
};
