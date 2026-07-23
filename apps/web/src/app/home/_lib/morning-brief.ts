/**
 * morning-brief.ts — HM-02: the pure data-shaping core of the morning-brief
 * home panel.
 *
 * The brief is synthesised from THREE existing, already-merged queries — no new
 * backend (FEATURE-CATALOG HM-02, "rendered from existing queries"):
 *   - `emails.listThreads` → the new-email digest (threads whose latest member
 *     arrived within `sinceHours`).
 *   - `entities.reviewQueue` (EN-02) → proposed merges awaiting review.
 *   - `documents.list` → documents generated recently (within `sinceHours`).
 *
 * This module is PURE + DB-free so it unit-tests without a live server and so
 * the panel component stays a thin render over its output. The panel calls
 * these three tRPC queries live TODAY; when the CH-03 scheduled synthesis turn
 * lands, it can persist a pre-computed brief and this same shape renders it —
 * the scheduling is a HANDOFF, the shape is stable.
 *
 * NOTE (by-entity digest): HM-02 asks for the new-email digest "by entity".
 * There is no by-entity email query in the router today, so the email digest is
 * grouped by THREAD (the closest existing projection) and the entity dimension
 * is carried by the merge section (which IS entity-keyed). A true per-entity
 * email rollup is a follow-up once such a query exists — see the handoff.
 */

import type { RouterOutputs } from "@polytoken/api-client";

type ThreadsOutput = RouterOutputs["emails"]["listThreads"];
type ReviewOutput = RouterOutputs["entities"]["reviewQueue"];
type DocumentsOutput = RouterOutputs["documents"]["list"];

export interface MorningBriefNewEmail {
  readonly key: string;
  readonly subject: string;
  readonly messageCount: number;
  readonly latestReceivedAt: Date;
}

export interface MorningBriefMerge {
  readonly pairKey: string;
  readonly subjectName: string;
  readonly candidateName: string;
  readonly entityTypeLabel: string | null;
  readonly maxSimilarity: number | null;
}

export interface MorningBriefDocument {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
}

export interface MorningBrief {
  readonly generatedAt: Date;
  readonly newEmails: ReadonlyArray<MorningBriefNewEmail>;
  readonly pendingMerges: ReadonlyArray<MorningBriefMerge>;
  readonly recentDocuments: ReadonlyArray<MorningBriefDocument>;
  readonly counts: {
    readonly newEmails: number;
    readonly pendingMerges: number;
    readonly recentDocuments: number;
  };
  /** True when all three sections are empty — the panel shows a calm
   * "nothing new" state instead of three empty lists. */
  readonly isEmpty: boolean;
}

export interface ShapeMorningBriefInputs {
  readonly threads?: ThreadsOutput | undefined;
  readonly reviews?: ReviewOutput | undefined;
  readonly documents?: DocumentsOutput | undefined;
  /** "Now" — injected so the digest window is deterministic in tests. */
  readonly now?: Date;
  /** How far back counts as "new"/"recent". Default 24h (a morning brief). */
  readonly sinceHours?: number;
  /** Max rows per section (the brief is a glance, not a full list). */
  readonly limit?: number;
}

const DEFAULT_SINCE_HOURS = 24;
const DEFAULT_LIMIT = 5;

function cutoffMs(now: Date, sinceHours: number): number {
  return now.getTime() - sinceHours * 60 * 60 * 1000;
}

/** Coerce a Date | string (tRPC superjson may hand back either) to a Date. */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * shapeMorningBrief — folds the three query outputs into the render-ready
 * brief. Pure; tolerant of `undefined` (any query still loading) and of an
 * out-of-order / oversized upstream list (it re-sorts newest-first and caps).
 */
export function shapeMorningBrief(
  inputs: ShapeMorningBriefInputs,
): MorningBrief {
  const now = inputs.now ?? new Date();
  const sinceHours = inputs.sinceHours ?? DEFAULT_SINCE_HOURS;
  const limit = inputs.limit ?? DEFAULT_LIMIT;
  const cutoff = cutoffMs(now, sinceHours);

  const newEmails: MorningBriefNewEmail[] = (inputs.threads?.items ?? [])
    .map((t) => ({
      key: t.key,
      subject: t.subject ?? "(no subject)",
      messageCount: t.messageCount,
      latestReceivedAt: toDate(t.latestReceivedAt),
    }))
    .filter((t) => t.latestReceivedAt.getTime() >= cutoff)
    .sort((a, b) => b.latestReceivedAt.getTime() - a.latestReceivedAt.getTime())
    .slice(0, limit);

  const pendingMerges: MorningBriefMerge[] = (inputs.reviews?.items ?? [])
    .slice(0, limit)
    .map((p) => ({
      pairKey: p.pairKey,
      subjectName: p.subject.displayName,
      candidateName: p.candidate.displayName,
      entityTypeLabel: p.subject.entityTypeLabel,
      maxSimilarity: p.maxSimilarity,
    }));

  const recentDocuments: MorningBriefDocument[] = (inputs.documents?.items ?? [])
    .map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: toDate(d.createdAt),
    }))
    .filter((d) => d.createdAt.getTime() >= cutoff)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  const counts = {
    newEmails: newEmails.length,
    pendingMerges: pendingMerges.length,
    recentDocuments: recentDocuments.length,
  };

  return {
    generatedAt: now,
    newEmails,
    pendingMerges,
    recentDocuments,
    counts,
    isEmpty:
      counts.newEmails === 0 &&
      counts.pendingMerges === 0 &&
      counts.recentDocuments === 0,
  };
}
