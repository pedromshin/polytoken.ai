/**
 * entities/review.ts — the `entities.reviewQueue` tRPC procedure (EN-02).
 *
 * The merge-review queue: pending AI-proposed duplicate pairs ACROSS ALL of
 * the caller's entities (detail.ts is per-entity; this is the global human
 * gate that keeps auto-resolution trustworthy).
 *
 * Pair semantics mirror migration 0043's corrected keying: a pending pair
 * (subject S, candidate C) exists when a was_selected=false suggestion link
 * points at C on a component whose email also carries a was_selected=true
 * OCCURRENCE link for S. was_selected=true rows are promote-written identity
 * assignments; was_selected=false rows are mere resemblance suggestions and
 * never anchor the pair.
 *
 * Filter discipline (copied from detail.ts pendingSuggestions + gallery.ts
 * pending-count exclusions, RES-1/D-20):
 *   - suggestion link: wasSelected=false AND wasDismissed=false (a human
 *     REJECT never re-surfaces);
 *   - candidate entity: isActive=true (a confirmed merge deactivates the
 *     absorbed duplicate — it is no longer offerable);
 *   - subject entity: isActive=true (ConfirmMerge rejects an inactive
 *     survivor, so offering one would only produce a guaranteed 422);
 *   - both entities source='email_extracted' (T-10-31) and same importer
 *     (T-10-20 — the write path rejects cross-importer merges).
 *
 * Tenancy (TENA-03): owned-importer scoped via userOwnedImporterIds — BOTH
 * sides of every pair must belong to the caller. No client-supplied scope is
 * trusted.
 *
 * Writes: NONE here, deliberately. Accept/Reject in the review UI call the
 * EXISTING curation write paths — entities.confirmMerge / entities.rejectMerge
 * (mutations.ts), the same procedures the detail page's confirm/dismiss uses.
 * No parallel write path is introduced by this file.
 */

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
// Input schema — exported for DB-free testing
// ---------------------------------------------------------------------------

export const reviewQueueInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  offset: z.number().int().min(0).default(0),
});

export type ReviewQueueInput = z.infer<typeof reviewQueueInputSchema>;

/**
 * Hard cap on raw link rows scanned per request. The queue groups pairs in
 * process (a pair spans many link rows), so the SQL LIMIT cannot be the page
 * limit; this cap bounds work instead. A queue past this cap still pages —
 * totalPending is then a floor, not an exact count.
 */
export const REVIEW_SCAN_CAP = 500;

// ---------------------------------------------------------------------------
// Raw row + output shapes — exported for DB-free testing
// ---------------------------------------------------------------------------

/** One raw suggestion-link row joined to both entities of the pair. */
export interface ReviewPairRawRow {
  readonly subjectId: string;
  readonly subjectDisplayName: string;
  readonly subjectEntityTypeId: string;
  readonly subjectEntityTypeLabel: string | null;
  readonly subjectAliases: ReadonlyArray<string> | null;
  readonly subjectIdentifiers: unknown;
  readonly subjectIsActive: boolean;
  readonly candidateId: string;
  readonly candidateDisplayName: string;
  readonly candidateEntityTypeId: string;
  readonly candidateEntityTypeLabel: string | null;
  readonly candidateAliases: ReadonlyArray<string> | null;
  readonly candidateIdentifiers: unknown;
  readonly candidateIsActive: boolean;
  readonly similarityScore: number | null;
  readonly matchType: string | null;
  /** D-20: true when a human already rejected this suggestion. */
  readonly wasDismissed: boolean;
}

/** One side of a review pair. */
export interface ReviewPairEntity {
  readonly id: string;
  readonly displayName: string;
  readonly entityTypeId: string;
  readonly entityTypeLabel: string | null;
  readonly aliases: ReadonlyArray<string>;
  readonly identifiers: Record<string, unknown>;
  /** Distinct emails where this entity has a confirmed occurrence link. */
  readonly occurrenceCount: number;
}

/** One grouped, deduplicated pending merge pair. */
export interface ReviewPair {
  readonly pairKey: string;
  readonly subject: ReviewPairEntity;
  readonly candidate: ReviewPairEntity;
  readonly matchTypes: ReadonlyArray<string>;
  readonly maxSimilarity: number | null;
  /** Number of raw suggestion-link rows backing this pair. */
  readonly linkCount: number;
  /** Case-insensitive name/alias overlap between the two entities. */
  readonly sharedAliases: ReadonlyArray<string>;
  /** Identifier keys whose values match on both sides (e.g. sender email). */
  readonly sharedIdentifierKeys: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for DB-free testing
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function nameSet(displayName: string, aliases: ReadonlyArray<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of [displayName, ...aliases]) {
    const key = raw.trim().toLowerCase();
    if (key.length > 0 && !out.has(key)) out.set(key, raw.trim());
  }
  return out;
}

/**
 * computeSharedEvidence — name/alias overlap + matching identifier keys
 * between the two sides of a pair. Case-insensitive, trims whitespace,
 * preserves the subject side's original casing in the output.
 */
export function computeSharedEvidence(
  subject: Pick<ReviewPairEntity, "displayName" | "aliases" | "identifiers">,
  candidate: Pick<ReviewPairEntity, "displayName" | "aliases" | "identifiers">,
): {
  sharedAliases: ReadonlyArray<string>;
  sharedIdentifierKeys: ReadonlyArray<string>;
} {
  const subjectNames = nameSet(subject.displayName, subject.aliases);
  const candidateNames = nameSet(candidate.displayName, candidate.aliases);

  const sharedAliases: string[] = [];
  for (const [key, original] of subjectNames) {
    if (candidateNames.has(key)) sharedAliases.push(original);
  }

  const sharedIdentifierKeys: string[] = [];
  for (const [key, subjectValue] of Object.entries(subject.identifiers)) {
    if (subjectValue === null || subjectValue === undefined) continue;
    const candidateValue = candidate.identifiers[key];
    if (candidateValue === null || candidateValue === undefined) continue;
    const a = String(subjectValue).trim().toLowerCase();
    const b = String(candidateValue).trim().toLowerCase();
    if (a.length > 0 && a === b) sharedIdentifierKeys.push(key);
  }

  return { sharedAliases, sharedIdentifierKeys };
}

/**
 * groupReviewPairs — collapse raw suggestion-link rows into deduplicated
 * review pairs.
 *
 * - Dismissed rows, inactive entities on EITHER side, and self-pairs are
 *   excluded HERE as well as in the SQL that feeds this helper — the same
 *   defense-in-depth discipline as detail.ts's groupPendingSuggestions
 *   (D-20: "a rejected suggestion never comes back" must survive a future
 *   query edit dropping a WHERE clause).
 * - A pair is UNORDERED for dedupe (A→B and B→A collapse into one queue
 *   entry); the surfaced direction is taken from the highest-similarity row
 *   so the subject is the resolver's strongest anchor.
 * - Sorted by maxSimilarity descending (nulls last), then pairKey for
 *   determinism.
 * - Returns new immutable objects; never mutates input rows.
 *
 * occurrenceCount is filled with 0 here — the procedure decorates the paged
 * items with real counts afterwards (a second, page-bounded query).
 */
export function groupReviewPairs(
  rows: ReadonlyArray<ReviewPairRawRow>,
): ReadonlyArray<ReviewPair> {
  interface Bucket {
    bestRow: ReviewPairRawRow;
    bestSimilarity: number;
    matchTypes: Set<string>;
    maxSimilarity: number | null;
    linkCount: number;
  }

  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    // Defense-in-depth (D-20 / RES-1): never surface a dismissed suggestion,
    // a merged-away (inactive) entity, or a self-pair.
    if (row.wasDismissed) continue;
    if (!row.subjectIsActive || !row.candidateIsActive) continue;
    if (row.subjectId === row.candidateId) continue;

    const unorderedKey = [row.subjectId, row.candidateId].sort().join("::");
    const similarity = row.similarityScore ?? Number.NEGATIVE_INFINITY;

    let bucket = buckets.get(unorderedKey);
    if (bucket === undefined) {
      bucket = {
        bestRow: row,
        bestSimilarity: similarity,
        matchTypes: new Set<string>(),
        maxSimilarity: row.similarityScore,
        linkCount: 0,
      };
      buckets.set(unorderedKey, bucket);
    } else if (similarity > bucket.bestSimilarity) {
      bucket.bestRow = row;
      bucket.bestSimilarity = similarity;
    }

    if (row.matchType) bucket.matchTypes.add(row.matchType);
    if (
      row.similarityScore !== null &&
      (bucket.maxSimilarity === null || row.similarityScore > bucket.maxSimilarity)
    ) {
      bucket.maxSimilarity = row.similarityScore;
    }
    bucket.linkCount += 1;
  }

  const pairs = [...buckets.values()].map((bucket) => {
    const row = bucket.bestRow;
    const subject: ReviewPairEntity = {
      id: row.subjectId,
      displayName: row.subjectDisplayName,
      entityTypeId: row.subjectEntityTypeId,
      entityTypeLabel: row.subjectEntityTypeLabel ?? null,
      aliases: [...(row.subjectAliases ?? [])],
      identifiers: asRecord(row.subjectIdentifiers),
      occurrenceCount: 0,
    };
    const candidate: ReviewPairEntity = {
      id: row.candidateId,
      displayName: row.candidateDisplayName,
      entityTypeId: row.candidateEntityTypeId,
      entityTypeLabel: row.candidateEntityTypeLabel ?? null,
      aliases: [...(row.candidateAliases ?? [])],
      identifiers: asRecord(row.candidateIdentifiers),
      occurrenceCount: 0,
    };
    const evidence = computeSharedEvidence(subject, candidate);
    return {
      pairKey: `${subject.id}::${candidate.id}`,
      subject,
      candidate,
      matchTypes: [...bucket.matchTypes],
      maxSimilarity: bucket.maxSimilarity,
      linkCount: bucket.linkCount,
      sharedAliases: evidence.sharedAliases,
      sharedIdentifierKeys: evidence.sharedIdentifierKeys,
    };
  });

  pairs.sort((a, b) => {
    const simA = a.maxSimilarity ?? Number.NEGATIVE_INFINITY;
    const simB = b.maxSimilarity ?? Number.NEGATIVE_INFINITY;
    if (simA !== simB) return simB - simA;
    return a.pairKey < b.pairKey ? -1 : a.pairKey > b.pairKey ? 1 : 0;
  });

  return pairs;
}

// ---------------------------------------------------------------------------
// Review procedure
// ---------------------------------------------------------------------------

export const entityReviewProcedures = {
  /**
   * reviewQueue — paginated pending merge pairs across ALL owned entities.
   *
   * Returns { items, hasMore, nextOffset, totalPending }. Pagination is over
   * GROUPED pairs (offset/limit slice after dedupe), with the raw scan
   * bounded by REVIEW_SCAN_CAP.
   */
  reviewQueue: protectedProcedure
    .input(reviewQueueInputSchema)
    .query(async ({ ctx, input }) => {
      // TENA-03: scope everything to the caller's owned importers.
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      if (owned.length === 0) {
        return {
          items: [] as ReviewPair[],
          hasMore: false,
          nextOffset: input.offset,
          totalPending: 0,
        };
      }

      // ------------------------------------------------------------------
      // 1. Raw pending suggestion rows, joined to both pair entities.
      //    Keying per migration 0043: the suggestion link's component lives
      //    in an email where the subject has a was_selected=true occurrence.
      // ------------------------------------------------------------------
      const suggestionComponent = alias(EmailComponents, "suggestion_component");
      const occurrenceComponent = alias(EmailComponents, "occurrence_component");
      const occurrenceLink = alias(
        ComponentEntityCandidateLinks,
        "occurrence_link",
      );
      const subjectEntity = alias(EntityInstances, "subject_entity");
      const candidateEntity = alias(EntityInstances, "candidate_entity");
      const subjectType = alias(EntityTypes, "subject_type");
      const candidateType = alias(EntityTypes, "candidate_type");

      const rawRows = await ctx.db
        .select({
          subjectId: subjectEntity.id,
          subjectDisplayName: subjectEntity.displayName,
          subjectEntityTypeId: subjectEntity.entityTypeId,
          subjectEntityTypeLabel: subjectType.label,
          subjectAliases: subjectEntity.aliases,
          subjectIdentifiers: subjectEntity.identifiers,
          subjectIsActive: subjectEntity.isActive,
          candidateId: candidateEntity.id,
          candidateDisplayName: candidateEntity.displayName,
          candidateEntityTypeId: candidateEntity.entityTypeId,
          candidateEntityTypeLabel: candidateType.label,
          candidateAliases: candidateEntity.aliases,
          candidateIdentifiers: candidateEntity.identifiers,
          candidateIsActive: candidateEntity.isActive,
          similarityScore: ComponentEntityCandidateLinks.similarityScore,
          matchType: ComponentEntityCandidateLinks.matchType,
          wasDismissed: ComponentEntityCandidateLinks.wasDismissed,
        })
        .from(ComponentEntityCandidateLinks)
        .innerJoin(
          suggestionComponent,
          eq(suggestionComponent.id, ComponentEntityCandidateLinks.componentId),
        )
        // Every component in the SAME email as the suggestion's component…
        .innerJoin(
          occurrenceComponent,
          eq(occurrenceComponent.emailId, suggestionComponent.emailId),
        )
        // …that carries a promote-written OCCURRENCE (was_selected=true) —
        // that occurrence's entity is the pair's subject.
        .innerJoin(
          occurrenceLink,
          and(
            eq(occurrenceLink.componentId, occurrenceComponent.id),
            eq(occurrenceLink.wasSelected, true),
          ),
        )
        // The proposed duplicate: active, email_extracted (T-10-31).
        .innerJoin(
          candidateEntity,
          and(
            eq(candidateEntity.id, ComponentEntityCandidateLinks.entityInstanceId),
            eq(candidateEntity.isActive, true),
            eq(candidateEntity.source, "email_extracted"),
          ),
        )
        // The subject: active, email_extracted, distinct from the candidate,
        // and SAME importer (T-10-20 — the write path rejects cross-importer
        // merges, so a cross-importer pair is never actionable).
        .innerJoin(
          subjectEntity,
          and(
            eq(subjectEntity.id, occurrenceLink.entityInstanceId),
            ne(subjectEntity.id, candidateEntity.id),
            eq(subjectEntity.isActive, true),
            eq(subjectEntity.source, "email_extracted"),
            eq(subjectEntity.importerId, candidateEntity.importerId),
          ),
        )
        .leftJoin(subjectType, eq(subjectType.id, subjectEntity.entityTypeId))
        .leftJoin(
          candidateType,
          eq(candidateType.id, candidateEntity.entityTypeId),
        )
        .where(
          and(
            // Pending = unselected suggestion…
            eq(ComponentEntityCandidateLinks.wasSelected, false),
            // …that no human rejected (D-20: never re-surface a dismissal).
            eq(ComponentEntityCandidateLinks.wasDismissed, false),
            // TENA-03: BOTH sides owned by the caller.
            inArray(subjectEntity.importerId, owned),
            inArray(candidateEntity.importerId, owned),
          ),
        )
        // Deterministic scan order: without it, LIMIT under the cap makes the
        // scanned subset nondeterministic per request — Next/Previous could
        // duplicate or drop pairs and totalPending could fluctuate (skeptic
        // finding, 2026-07-23). Link id is stable and insertion-ordered enough.
        .orderBy(asc(ComponentEntityCandidateLinks.id))
        .limit(REVIEW_SCAN_CAP);

      // ------------------------------------------------------------------
      // 2. Group + dedupe + sort, then page over grouped pairs.
      // ------------------------------------------------------------------
      const allPairs = groupReviewPairs(rawRows as ReviewPairRawRow[]);
      const paged = allPairs.slice(input.offset, input.offset + input.limit);
      const hasMore = allPairs.length > input.offset + paged.length;

      // ------------------------------------------------------------------
      // 3. Decorate the PAGE's entities with occurrence counts (distinct
      //    emails with a was_selected=true link) — bounded to ≤ 2×limit ids.
      // ------------------------------------------------------------------
      const pageEntityIds = [
        ...new Set(paged.flatMap((p) => [p.subject.id, p.candidate.id])),
      ];

      const counts = new Map<string, number>();
      if (pageEntityIds.length > 0) {
        const countRows = await ctx.db
          .select({
            entityInstanceId: ComponentEntityCandidateLinks.entityInstanceId,
            emailCount:
              sql<number>`COUNT(DISTINCT ${EmailComponents.emailId})`.mapWith(
                Number,
              ),
          })
          .from(ComponentEntityCandidateLinks)
          .innerJoin(
            EmailComponents,
            eq(EmailComponents.id, ComponentEntityCandidateLinks.componentId),
          )
          .where(
            and(
              inArray(
                ComponentEntityCandidateLinks.entityInstanceId,
                pageEntityIds,
              ),
              eq(ComponentEntityCandidateLinks.wasSelected, true),
            ),
          )
          .groupBy(ComponentEntityCandidateLinks.entityInstanceId);

        for (const row of countRows) {
          if (typeof row.entityInstanceId === "string") {
            counts.set(row.entityInstanceId, row.emailCount ?? 0);
          }
        }
      }

      const items = paged.map((pair) => ({
        ...pair,
        subject: {
          ...pair.subject,
          occurrenceCount: counts.get(pair.subject.id) ?? 0,
        },
        candidate: {
          ...pair.candidate,
          occurrenceCount: counts.get(pair.candidate.id) ?? 0,
        },
      }));

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
        totalPending: allPairs.length,
      };
    }),
};
