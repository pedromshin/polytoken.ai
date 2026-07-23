/**
 * entities/detail.ts — the `entities.byId` tRPC procedure.
 *
 * D-18: returns four regions (occurrences, fields, knowledge nodes, pending
 * duplicate suggestions) + wasMerged flag.
 * D-19: conflicting field values are flagged with ALL distinct values +
 * provenance; NO auto-canonical value is chosen (human decides).
 * T-10-31: byId is scoped to source='email_extracted'.
 * T-10-32: all filters use parameterized Drizzle builders.
 *
 * wasMerged: true when any sibling entity_instance points its merged_into
 * column at this entity's id — i.e. this entity is the SURVIVOR of a merge.
 * The `merged_into` column is not in the Drizzle schema (added by Python's
 * set_merge_state via Supabase SQL) so we use a raw `sql` fragment scoped
 * to a sub-select. This is read-only and safe.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  ComponentEntityCandidateLinks,
  EmailComponents,
  Emails,
  EntityInstances,
  EntityTypes,
  ExtractionRecords,
  KnowledgeNodes,
} from "@polytoken/db/schema";
import { assertImporterOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

// ---------------------------------------------------------------------------
// Types — raw row shapes for the pure helper
// ---------------------------------------------------------------------------

/**
 * A single field occurrence across a source email (fed into aggregateEntityFields).
 */
export interface FieldOccurrenceRow {
  readonly emailId: string;
  readonly emailSubject: string | null;
  readonly receivedAt: Date | null;
  readonly fieldSlug: string;
  readonly fieldLabel: string | null;
  readonly value: string;
  readonly extractionStatus: string;
}

/** A single provenance entry for a field value (distinct value + its source). */
export interface FieldValueProvenance {
  readonly value: string;
  readonly emailId: string;
  readonly emailSubject: string | null;
  readonly receivedAt: Date | null;
  readonly extractionStatus: string;
}

/** Aggregated field across all occurrences. */
export interface AggregatedField {
  readonly fieldSlug: string;
  readonly fieldLabel: string | null;
  /** true when >1 distinct value found across occurrences (D-19). */
  readonly conflicting: boolean;
  /** ALL distinct values with provenance — human picks canonical (D-19). */
  readonly values: ReadonlyArray<FieldValueProvenance>;
}

// ---------------------------------------------------------------------------
// Pure aggregation helper — exported for DB-free testing (D-19 / T-10-34)
// ---------------------------------------------------------------------------

/**
 * aggregateEntityFields — collapse flat field-occurrence rows into per-field
 * aggregates with conflict detection.
 *
 * - One output row per (fieldSlug) found in the input rows.
 * - ALL provenance entries are retained (even for non-conflicting fields) so
 *   the UI can show "1 email(s)" counts.
 * - A field is `conflicting: true` when it has >1 DISTINCT value string.
 * - NO canonical value is computed or returned — the human decides (D-19).
 * - Returns new immutable objects; never mutates the input rows.
 */
export function aggregateEntityFields(
  rows: ReadonlyArray<FieldOccurrenceRow>,
): ReadonlyArray<AggregatedField> {
  // Ordered set of fieldSlugs (first-seen order)
  const slugOrder: string[] = [];

  // fieldSlug -> { label, distinctValues (Set), allProvenance }
  const bySlug = new Map<
    string,
    {
      label: string | null;
      distinctValues: Set<string>;
      provenance: FieldValueProvenance[];
    }
  >();

  for (const row of rows) {
    let entry = bySlug.get(row.fieldSlug);
    if (entry === undefined) {
      slugOrder.push(row.fieldSlug);
      entry = {
        label: row.fieldLabel,
        distinctValues: new Set<string>(),
        provenance: [],
      };
      bySlug.set(row.fieldSlug, entry);
    }

    entry.distinctValues.add(row.value);
    entry.provenance.push({
      value: row.value,
      emailId: row.emailId,
      emailSubject: row.emailSubject,
      receivedAt: row.receivedAt,
      extractionStatus: row.extractionStatus,
    });
  }

  return slugOrder.map((fieldSlug) => {
    const entry = bySlug.get(fieldSlug)!;
    return {
      fieldSlug,
      fieldLabel: entry.label,
      conflicting: entry.distinctValues.size > 1,
      values: [...entry.provenance],
    };
  });
}

// ---------------------------------------------------------------------------
// Pending-suggestion grouping helper — exported for DB-free testing
// ---------------------------------------------------------------------------

/**
 * A raw pending-suggestion candidate-link row (region (d) input shape).
 * Mirrors the columns selected by the byId pendingSuggestions query below.
 */
export interface PendingSuggestionRow {
  readonly linkedEntityId: string | null;
  readonly linkedDisplayName: string;
  readonly linkedEntityTypeId: string;
  readonly linkedEntityTypeLabel: string | null;
  readonly linkedIdentifiers: unknown;
  readonly matchType: string | null;
  /** RES-1 (D-20): true when a human rejected this suggestion. */
  readonly wasDismissed: boolean;
  /** false when the candidate was merged away (merged_into set, deactivated). */
  readonly linkedIsActive: boolean;
}

/** One grouped pending duplicate suggestion (region (d) output shape). */
export interface PendingSuggestion {
  readonly entityInstanceId: string;
  readonly displayName: string;
  readonly entityTypeId: string;
  readonly entityTypeLabel: string | null;
  readonly keyIdentifiers: Record<string, unknown>;
  readonly matchTypes: ReadonlyArray<string>;
  readonly occurrenceCount: number;
}

/**
 * groupPendingSuggestions — collapse flat candidate-link rows into one
 * suggestion per target entity instance.
 *
 * RES-1 read-path guarantee (D-20 "never re-surface a dismissed link"):
 * rows flagged wasDismissed=true — a human clicked REJECT — and rows whose
 * candidate entity is no longer active (merged away via merged_into) are
 * excluded HERE as well as in the SQL query that feeds this helper. The
 * in-helper filter is deliberate defense-in-depth: the user-visible contract
 * ("a rejected suggestion never comes back") must hold even if a future
 * query edit drops a WHERE clause.
 */
export function groupPendingSuggestions(
  rows: ReadonlyArray<PendingSuggestionRow>,
): ReadonlyArray<PendingSuggestion> {
  const suggestionMap = new Map<
    string,
    {
      displayName: string;
      entityTypeId: string;
      entityTypeLabel: string | null;
      keyIdentifiers: Record<string, unknown>;
      matchTypes: Set<string>;
      occurrenceCount: number;
    }
  >();

  for (const row of rows) {
    const eid = row.linkedEntityId;
    if (!eid) continue;
    // D-20: dismissed suggestions and merged-away candidates never surface.
    if (row.wasDismissed) continue;
    if (!row.linkedIsActive) continue;
    let suggestion = suggestionMap.get(eid);
    if (suggestion === undefined) {
      suggestion = {
        displayName: row.linkedDisplayName,
        entityTypeId: row.linkedEntityTypeId,
        entityTypeLabel: row.linkedEntityTypeLabel ?? null,
        keyIdentifiers:
          (row.linkedIdentifiers as Record<string, unknown> | null) ?? {},
        matchTypes: new Set(),
        occurrenceCount: 0,
      };
      suggestionMap.set(eid, suggestion);
    }
    if (row.matchType) {
      suggestion.matchTypes.add(row.matchType);
    }
    suggestion.occurrenceCount += 1;
  }

  return [...suggestionMap.entries()].map(([entityInstanceId, s]) => ({
    entityInstanceId,
    displayName: s.displayName,
    entityTypeId: s.entityTypeId,
    entityTypeLabel: s.entityTypeLabel,
    keyIdentifiers: { ...s.keyIdentifiers },
    matchTypes: [...s.matchTypes],
    occurrenceCount: s.occurrenceCount,
  }));
}

// ---------------------------------------------------------------------------
// Detail procedure
// ---------------------------------------------------------------------------

export const entityDetailProcedures = {
  /**
   * byId — fetch a single entity instance with its four D-18 related regions.
   *
   * Returns null when the entity does not exist or is not email_extracted.
   *
   * T-10-31: source='email_extracted' scoped (byId only exposes email data).
   *
   * Tenancy (Phase 44, TENA-03): protectedProcedure requires a session; once
   * the entity is loaded, its importer is asserted owned via
   * `assertImporterOwnership` — a row owned by another user surfaces as
   * NOT_FOUND (fail-closed, no existence oracle), same as a missing row.
   */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // ------------------------------------------------------------------
      // 1. Fetch the entity instance (source='email_extracted' scoped — T-10-31)
      // ------------------------------------------------------------------
      const entityRows = await ctx.db
        .select({
          id: EntityInstances.id,
          displayName: EntityInstances.displayName,
          entityTypeId: EntityInstances.entityTypeId,
          entityTypeLabel: EntityTypes.label,
          identifiers: EntityInstances.identifiers,
          aliases: EntityInstances.aliases,
          isActive: EntityInstances.isActive,
          nautaId: EntityInstances.nautaId,
          createdAt: EntityInstances.createdAt,
          importerId: EntityInstances.importerId,
        })
        .from(EntityInstances)
        .leftJoin(
          EntityTypes,
          eq(EntityTypes.id, EntityInstances.entityTypeId),
        )
        .where(
          and(
            eq(EntityInstances.id, input.id),
            // T-10-31: always scope to email_extracted rows
            eq(EntityInstances.source, "email_extracted"),
          ),
        )
        .limit(1);

      if (!entityRows[0]) return null;

      const entity = entityRows[0];

      // TENA-03: assert the entity's importer is owned before returning any
      // related region. A row owned by another user surfaces as NOT_FOUND —
      // identical to the missing-row branch above (fail-closed).
      await assertOwnedOrNotFound(() =>
        assertImporterOwnership(ctx.db, entity.importerId, ctx.user.id),
      );

      // ------------------------------------------------------------------
      // 2. Region (a) — Occurrences
      //    Join candidate links -> components -> emails + extraction records
      //    to build the deep-link list of emails where this entity appears.
      //    Dedupe by emailId, preferring confirmed extraction status.
      // ------------------------------------------------------------------
      const occurrenceRows = await ctx.db
        .select({
          emailId: Emails.id,
          emailSubject: Emails.subject,
          receivedAt: Emails.receivedAt,
          componentId: EmailComponents.id,
          componentRole: EmailComponents.role,
          location: EmailComponents.location,
          extractionStatus: ExtractionRecords.status,
          matchType: ComponentEntityCandidateLinks.matchType,
        })
        .from(ComponentEntityCandidateLinks)
        .innerJoin(
          EmailComponents,
          eq(EmailComponents.id, ComponentEntityCandidateLinks.componentId),
        )
        .innerJoin(Emails, eq(Emails.id, EmailComponents.emailId))
        .leftJoin(
          ExtractionRecords,
          and(
            eq(ExtractionRecords.componentId, EmailComponents.id),
            ne(ExtractionRecords.status, "superseded"),
          ),
        )
        .where(
          eq(ComponentEntityCandidateLinks.entityInstanceId, input.id),
        );

      // Dedupe to one row per email (prefer confirmed over candidate)
      const byEmailId = new Map<string, (typeof occurrenceRows)[number]>();
      for (const row of occurrenceRows) {
        if (!row.emailId) continue;
        const existing = byEmailId.get(row.emailId);
        if (
          existing === undefined ||
          (row.extractionStatus === "confirmed" &&
            existing.extractionStatus !== "confirmed")
        ) {
          byEmailId.set(row.emailId, row);
        }
      }

      const occurrences = [...byEmailId.values()].map((row) => ({
        emailId: row.emailId,
        emailSubject: row.emailSubject,
        receivedAt: row.receivedAt,
        componentId: row.componentId,
        componentRole: row.componentRole,
        location: row.location,
        extractionStatus: row.extractionStatus ?? "candidate",
        matchType: row.matchType,
      }));

      // ------------------------------------------------------------------
      // 3. Region (b) — Field Values (aggregated + conflict detection)
      //    Fetch extracted/corrected fields from ExtractionRecords for
      //    components linked to this entity. Expand JSON fields into rows.
      // ------------------------------------------------------------------
      const extractionRows = await ctx.db
        .select({
          emailId: Emails.id,
          emailSubject: Emails.subject,
          receivedAt: Emails.receivedAt,
          extractedFields: ExtractionRecords.extractedFields,
          correctedFields: ExtractionRecords.correctedFields,
          extractionStatus: ExtractionRecords.status,
        })
        .from(ComponentEntityCandidateLinks)
        .innerJoin(
          EmailComponents,
          eq(EmailComponents.id, ComponentEntityCandidateLinks.componentId),
        )
        .innerJoin(Emails, eq(Emails.id, EmailComponents.emailId))
        .innerJoin(
          ExtractionRecords,
          and(
            eq(ExtractionRecords.componentId, EmailComponents.id),
            ne(ExtractionRecords.status, "superseded"),
          ),
        )
        .where(
          eq(ComponentEntityCandidateLinks.entityInstanceId, input.id),
        );

      // Flatten JSON fields into FieldOccurrenceRow entries
      const fieldOccurrenceRows: FieldOccurrenceRow[] = [];
      for (const row of extractionRows) {
        if (!row.emailId) continue;
        // Merge correctedFields over extractedFields (corrected wins)
        const extracted =
          (row.extractedFields as Record<string, unknown> | null) ?? {};
        const corrected =
          (row.correctedFields as Record<string, unknown> | null) ?? {};
        const merged: Record<string, unknown> = { ...extracted, ...corrected };

        for (const [slug, val] of Object.entries(merged)) {
          if (val === null || val === undefined) continue;
          fieldOccurrenceRows.push({
            emailId: row.emailId,
            emailSubject: row.emailSubject,
            receivedAt: row.receivedAt,
            fieldSlug: slug,
            fieldLabel: slug, // label fallback to slug; entity-type fields not joined here
            value: String(val),
            extractionStatus: row.extractionStatus,
          });
        }
      }

      const fields = aggregateEntityFields(fieldOccurrenceRows);

      // ------------------------------------------------------------------
      // 4. Region (c) — Knowledge Nodes
      //    scope='entity_instance' AND scopeRefId = this entity's id (D-18c).
      //    Empty list when none — Bedrock-404 safe (D-12).
      // ------------------------------------------------------------------
      const knowledgeNodes = await ctx.db
        .select({
          id: KnowledgeNodes.id,
          title: KnowledgeNodes.title,
          content: KnowledgeNodes.content,
          source: KnowledgeNodes.source,
          confidence: KnowledgeNodes.confidence,
          createdAt: KnowledgeNodes.createdAt,
        })
        .from(KnowledgeNodes)
        .where(
          and(
            eq(KnowledgeNodes.scope, "entity_instance"),
            eq(KnowledgeNodes.scopeRefId, input.id),
            eq(KnowledgeNodes.isActive, true),
          ),
        );

      // ------------------------------------------------------------------
      // 5. Region (d) — Pending Duplicate Suggestions (D-18d)
      //    Unselected candidate links for this entity, grouped by their
      //    target entity instance (the suggested duplicate).
      //
      //    RES-1 (D-20): wasDismissed=false excludes human-REJECTED
      //    suggestions — since the W0 fix, RejectMerge durably flags the
      //    correctly-keyed rows (component_id ∈ subject's email components),
      //    and this read path is where the dismissal becomes user-visible.
      //    isActive=true on the candidate join excludes merged-away entities
      //    (ConfirmMerge deactivates the absorbed duplicate) so a confirmed
      //    merge cannot keep re-offering its buried target.
      // ------------------------------------------------------------------
      const pendingLinkRows = await ctx.db
        .select({
          entityInstanceId: ComponentEntityCandidateLinks.entityInstanceId,
          similarityScore: ComponentEntityCandidateLinks.similarityScore,
          matchType: ComponentEntityCandidateLinks.matchType,
          wasDismissed: ComponentEntityCandidateLinks.wasDismissed,
          linkedEntityId: EntityInstances.id,
          linkedDisplayName: EntityInstances.displayName,
          linkedEntityTypeId: EntityInstances.entityTypeId,
          linkedEntityTypeLabel: EntityTypes.label,
          linkedIdentifiers: EntityInstances.identifiers,
          linkedIsActive: EntityInstances.isActive,
        })
        .from(ComponentEntityCandidateLinks)
        .innerJoin(
          EmailComponents,
          eq(EmailComponents.id, ComponentEntityCandidateLinks.componentId),
        )
        // Join the CANDIDATE entity (not the base entity) to find suggestions
        .innerJoin(
          EntityInstances,
          and(
            eq(EntityInstances.id, ComponentEntityCandidateLinks.entityInstanceId),
            ne(EntityInstances.id, input.id),
            // Merged-away candidates (is_active=false) are not offerable
            eq(EntityInstances.isActive, true),
          ),
        )
        .leftJoin(EntityTypes, eq(EntityTypes.id, EntityInstances.entityTypeId))
        .where(
          and(
            // Components belong to emails where the main entity appears
            eq(EmailComponents.emailId,
              sql`(SELECT email_id FROM ${EmailComponents} c2
                   INNER JOIN ${ComponentEntityCandidateLinks} cl2
                   ON cl2.component_id = c2.id
                   WHERE cl2.entity_instance_id = ${input.id}
                   LIMIT 1)`,
            ),
            eq(ComponentEntityCandidateLinks.wasSelected, false),
            // D-20: a human-rejected suggestion never re-surfaces
            eq(ComponentEntityCandidateLinks.wasDismissed, false),
          ),
        );

      // Group by target entity instance; the helper re-applies the
      // dismissed/inactive exclusions (defense-in-depth, unit-testable).
      const pendingSuggestions = groupPendingSuggestions(pendingLinkRows);

      // ------------------------------------------------------------------
      // 6. wasMerged — true when this entity is the SURVIVOR of a merge
      //    (another entity's merged_into = this entity's id).
      //    The `merged_into` column exists in the live DB but not in the
      //    Drizzle schema — safe read-only raw SQL fragment.
      // ------------------------------------------------------------------
      // ctx.db.execute() with postgres-js returns RowList which is array-like
      // (not { rows: [] }). Cast to unknown first to safely narrow.
      const mergedCheckResult = await ctx.db.execute(
        sql`SELECT EXISTS (
          SELECT 1 FROM entity_instances
          WHERE merged_into = ${input.id}
            AND source = 'email_extracted'
        ) AS "wasMerged"`,
      );

      const mergedCheckRows = mergedCheckResult as unknown as Array<
        Record<string, unknown>
      >;

      const wasMergedRaw = mergedCheckRows[0]?.["wasMerged"];
      const wasMerged = wasMergedRaw === true || wasMergedRaw === "true";

      // ------------------------------------------------------------------
      // Return the five-region detail object
      // ------------------------------------------------------------------
      return {
        entity: {
          id: entity.id,
          displayName: entity.displayName,
          entityTypeId: entity.entityTypeId,
          entityTypeLabel: entity.entityTypeLabel ?? null,
          identifiers: (entity.identifiers as Record<string, unknown>) ?? {},
          aliases: entity.aliases ?? [],
          isActive: entity.isActive,
          nautaId: entity.nautaId,
          createdAt: entity.createdAt,
          importerId: entity.importerId,
        },
        occurrences,
        fields,
        knowledgeNodes,
        pendingSuggestions,
        wasMerged,
      };
    }),
};
