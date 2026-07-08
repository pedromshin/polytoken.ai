/**
 * eval/retrieval-scorer.ts — recall@k / precision@k scorer for the
 * retrieval-quality eval dimension (EVAL-06).
 *
 * Pure function, no I/O. Mirrors the Python scorer in
 * `apps/email-listener/tests/evals/_scorers.py`'s `score_retrieval_at_k`
 * (Plan 35-03) exactly — same hit-counting logic, same k-truncation of
 * `actualIds`. Keep both sides in lockstep if this contract changes.
 */

import type { RetrievalExpectedId } from "./eval-dimensions-schema";

export interface RetrievalScore {
  readonly recallAtK: number;
  readonly precisionAtK: number;
}

function toKey(entry: RetrievalExpectedId): string {
  return `${entry.kind}:${entry.id}`;
}

/**
 * Scores a retrieval result set against a golden-set entry's expected ids.
 *
 * `recallAtK` = fraction of distinct expected ids found within the top-`k`
 * of `actualIds`. `precisionAtK` = fraction of the top-`k` actual ids that
 * were expected. Both are `0` (never `NaN`) when their denominator is empty.
 */
export function scoreRetrievalAtK(
  actualIds: readonly RetrievalExpectedId[],
  expectedIds: readonly RetrievalExpectedId[],
  k = 5,
): RetrievalScore {
  const topK = actualIds.slice(0, k);
  const expectedKeys = new Set(expectedIds.map(toKey));
  const actualKeys = new Set(topK.map(toKey));

  let hits = 0;
  for (const key of expectedKeys) {
    if (actualKeys.has(key)) {
      hits += 1;
    }
  }

  const recallAtK = expectedKeys.size === 0 ? 0 : hits / expectedKeys.size;
  const precisionAtK = topK.length === 0 ? 0 : hits / topK.length;

  return { recallAtK, precisionAtK };
}
