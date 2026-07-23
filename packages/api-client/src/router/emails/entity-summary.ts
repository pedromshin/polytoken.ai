/**
 * emails.entitySummary — per-email, per-FACT provenance rollup powering the
 * inbox entity chip (D-58-01's signature element: "a provenance mark on
 * every extracted fact").
 *
 * 60-01-PLAN.md Task 2 rewrote this from a distinct-entity-TYPE rollup
 * ("supplier ·2") into a per-ENTITY list: each surviving component is its own
 * entry carrying the extracted VALUE and its confidence TIER ("Acme Freight
 * · supplier"), not just a type-count badge. Two suppliers in one email are
 * two chips, not one collapsed count — an information-architecture change a
 * restyle could not have made.
 *
 * Phase 9's first-class `role` / `entity_type_id` columns on email_components
 * make this cheap: we read components with role='entity' (the preferred path
 * now 09-01 added the column) and join entity_types for labels. No new table
 * (D-23).
 *
 * Performance / DoS (T-09-33, T-60-03): callers pass at most 100 email ids;
 * the query is a single parameterized inArray() — never a per-row fetch.
 * Entries per email are additionally capped at MAX_ENTITIES_PER_EMAIL so a
 * single email with hundreds of OCR entity regions cannot balloon the
 * response; `totalCount` reports the true pre-cap count so the client can
 * still render an honest overflow chip.
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
 * another user's entity rollup. T-60-01: the new `value` field is email BODY
 * content — strictly more sensitive than a type label — so this scoping is
 * left byte-identical; nothing about the select was widened beyond it.
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

/**
 * D-58-01 tier vocabulary derived from extractionStatus (the ONLY tier
 * source, per 58-IDENTITY.md law 1): "confirmed" means a human verified the
 * fact; everything else that survives the query's exclusion filters
 * ("candidate", "pending", "auto_confirmed", "review_pending", ...) means a
 * machine inferred it and nobody has confirmed it yet. This is the
 * conservative direction and it is deliberate — the product's stance is
 * suggest-only, never auto-decide, so the UI must never claim a human
 * confirmed something they did not.
 */
export type EntityTier = "confirmed" | "suggested";

export interface EntitySummaryEntry {
  /** The email_component id this fact was extracted from. Keys the entry. */
  readonly componentId: string;
  readonly entityTypeId: string;
  /** The entity TYPE's label (formerly `label`, renamed now that `value` exists). */
  readonly typeLabel: string;
  /**
   * A trimmed, length-capped snippet of the component's own detected text —
   * the extracted FACT itself (e.g. "Acme Freight", "R$ 4.820,00"). Null when
   * the component has no usable contentText; the chip then falls back to
   * `typeLabel` (an entity with no detected text still deserves a chip).
   */
  readonly value: string | null;
  readonly tier: EntityTier;
  /**
   * D-24: the entity_instance id for a wasSelected=true candidate link on
   * this component. Used by EntityChips to deep-link to the entity detail
   * page. Undefined when no selected link exists.
   */
  readonly entityInstanceId?: string;
}

export interface EmailEntitySummary {
  readonly emailId: string;
  /** Capped at MAX_ENTITIES_PER_EMAIL, first-appearance order (T-60-03). */
  readonly entities: ReadonlyArray<EntitySummaryEntry>;
  /** The true pre-cap fact count, so the client can render an honest "+N". */
  readonly totalCount: number;
}

/** Shape of a raw entity-component row feeding the aggregation helper. */
export interface EntitySummaryRow {
  readonly emailId: string;
  readonly componentId: string;
  readonly entityTypeId: string | null;
  readonly label: string | null;
  readonly contentText: string | null;
  readonly extractionStatus: string;
  /**
   * D-24: entity_instance id from a wasSelected=true candidate link.
   * Null/undefined when no selected link exists for this component.
   */
  readonly entityInstanceId?: string | null;
}

/**
 * T-60-03: hard cap on entries returned per email. Exported so the bound is
 * documented and reusable at call sites without a magic number.
 */
export const MAX_ENTITIES_PER_EMAIL = 8;

/**
 * Max length of a `value` snippet before it is ellipsis-truncated. Mirrors
 * region-label.ts's DEFAULT_SNIPPET_MAX (48) — the same "detected text ->
 * compact label" concept, kept local here since packages/api-client cannot
 * import from apps/web.
 */
const VALUE_SNIPPET_MAX = 48;

/**
 * Collapse whitespace/newlines to single spaces, trim, and ellipsis-truncate
 * a component's raw contentText into a compact chip value. Returns null for
 * null/blank input so the chip can fall back to the type label.
 */
function toValueSnippet(contentText: string | null): string | null {
  if (contentText === null) return null;
  const collapsed = contentText.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > VALUE_SNIPPET_MAX
    ? `${collapsed.slice(0, VALUE_SNIPPET_MAX - 1)}…`
    : collapsed;
}

// ---------------------------------------------------------------------------
// Pure aggregation helper — exported for DB-free unit testing
// (same testability pattern as groupEntityTypeRows in entity-types.ts)
// ---------------------------------------------------------------------------

/**
 * aggregateEntitySummary — expand flat entity-component rows into a
 * per-email, per-FACT list (D-58-01's signature element).
 *
 * - One output row per requested email id (in `requestedEmailIds` order);
 *   emails with no entity components yield `{ entities: [], totalCount: 0 }`.
 * - Rows whose entityTypeId or label is null are skipped (an entity region not
 *   yet typed contributes no chip).
 * - Each surviving row becomes its OWN entry, keyed by componentId — entries
 *   are NOT collapsed by type. Two suppliers in one email are two entries.
 * - Rows sharing a componentId are collapsed to ONE entry (D-24 fan-out
 *   guard): ConfirmMerge sets was_selected=true on every candidate link in
 *   the subject's email, so the leftJoin can multiply a component into
 *   several rows — one per selected link. A component is one FACT and must
 *   stay one chip. The first row wins; a later duplicate row may only fill
 *   in a missing entityInstanceId (never overwrite one), so a component
 *   whose own occurrence link resolved keeps deep-linking to ITS entity, not
 *   a merge-fanned second entity.
 * - Entries are capped at MAX_ENTITIES_PER_EMAIL, preserving first-appearance
 *   order; `totalCount` reports the true pre-cap count (of FACTS, post-dedupe).
 * - Returns new immutable objects; never mutates the input rows.
 */
export function aggregateEntitySummary(
  rows: ReadonlyArray<EntitySummaryRow>,
  requestedEmailIds: ReadonlyArray<string>,
): ReadonlyArray<EmailEntitySummary> {
  const byEmail = new Map<string, EntitySummaryEntry[]>();
  // (emailId, componentId) -> index into the email's entries, for the D-24
  // fan-out dedupe (a component joined against N selected links is 1 fact).
  const entryIndexByComponent = new Map<string, number>();

  const ensureEmail = (emailId: string): EntitySummaryEntry[] => {
    let entries = byEmail.get(emailId);
    if (entries === undefined) {
      entries = [];
      byEmail.set(emailId, entries);
    }
    return entries;
  };

  for (const sourceRow of rows) {
    if (sourceRow.entityTypeId === null || sourceRow.label === null) continue;

    const entry: EntitySummaryEntry = {
      componentId: sourceRow.componentId,
      entityTypeId: sourceRow.entityTypeId,
      typeLabel: sourceRow.label,
      value: toValueSnippet(sourceRow.contentText),
      tier: sourceRow.extractionStatus === "confirmed" ? "confirmed" : "suggested",
      entityInstanceId:
        sourceRow.entityInstanceId !== null && sourceRow.entityInstanceId !== undefined
          ? sourceRow.entityInstanceId
          : undefined,
    };

    const entries = ensureEmail(sourceRow.emailId);
    const dedupeKey = `${sourceRow.emailId} ${sourceRow.componentId}`;
    const existingIndex = entryIndexByComponent.get(dedupeKey);
    if (existingIndex === undefined) {
      entryIndexByComponent.set(dedupeKey, entries.length);
      entries.push(entry);
      continue;
    }

    // Duplicate row for a component already emitted (leftJoin multiplicity —
    // D-24 fan-out). Never emit a second chip; at most FILL a missing
    // entityInstanceId so the chip gains a deep-link it lacked. An already
    // resolved id is never overwritten by a later (merge-fanned) row.
    const existing = entries[existingIndex];
    if (
      existing !== undefined &&
      existing.entityInstanceId === undefined &&
      entry.entityInstanceId !== undefined
    ) {
      entries[existingIndex] = { ...existing, entityInstanceId: entry.entityInstanceId };
    }
  }

  // Emit one row per requested email id, preserving the requested order so the
  // caller can zip the result back onto its visible page of emails.
  return requestedEmailIds.map((emailId) => {
    const all = byEmail.get(emailId) ?? [];
    return {
      emailId,
      entities: all.slice(0, MAX_ENTITIES_PER_EMAIL),
      totalCount: all.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Procedures — spread into emailsRouter
// ---------------------------------------------------------------------------

export const emailEntitySummaryProcedures = {
  /**
   * entitySummary — batch per-email, per-FACT provenance rollup keyed by the
   * visible page of email ids. Returns one entry per requested id (empty
   * entities for emails with no typed entity regions).
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
        return input.emailIds.map((emailId) => ({
          emailId,
          entities: [],
          totalCount: 0,
        }));
      }

      // Direct path (D-23): components flagged role='entity' with an
      // entity_type_id, joined to entity_types for labels. Rejected/superseded
      // regions are excluded so denied/redrawn boxes never produce chips.
      // D-24: leftJoin ComponentEntityCandidateLinks (wasSelected=true) and
      // EntityInstances (source='email_extracted') to surface entityInstanceId
      // for deep-link navigation to /entities/[id].
      // 60-01 Task 2: `id`/contentText`/`extractionStatus` are ADDED to the
      // select (they already exist on EmailComponents) so the aggregation can
      // derive `value`/`tier`/`componentId` per fact. Every `where` clause
      // below, especially the importer-ownership scope (T-60-01, T-44-05-01),
      // is otherwise byte-identical to the pre-60 query — a foreign emailId
      // slipped into the batch still matches no owned-importer component and
      // therefore contributes nothing to the aggregation.
      const rows = await ctx.db
        .select({
          emailId: EmailComponents.emailId,
          componentId: EmailComponents.id,
          entityTypeId: EmailComponents.entityTypeId,
          label: EntityTypes.label,
          contentText: EmailComponents.contentText,
          extractionStatus: EmailComponents.extractionStatus,
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
            // D-24 fan-out guard: ConfirmMerge sets was_selected=true on the
            // subject's whole-email candidate links AND deactivates the
            // merged-away target. Requiring is_active=true means a chip can
            // never deep-link to a buried (merged-away) entity; the
            // aggregation's per-component dedupe below then keeps the
            // component's own surviving link as the single chip.
            eq(EntityInstances.isActive, true),
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
