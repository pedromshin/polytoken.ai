/**
 * eval/citation-scorer.ts — structural citation-faithfulness checker
 * (EVAL-07, structural half).
 *
 * Validates that a `citations[]` envelope entry's `route` matches its
 * `kind`'s canonical template and that its `id` is actually present in the
 * tool-result envelope it accompanies. The semantic half — "does every
 * visible claim actually trace to a citation" — is captured as a plain-text
 * LLM-judge rubric stub (`CITATION_FAITHFULNESS_RUBRIC`); wiring a live
 * judge runner against it is out of scope for this phase (connected-env,
 * 999.3-family — see EVAL-DIMENSIONS.README.md).
 */

import type { Citation } from "./eval-dimensions-schema";

/**
 * Checks whether a citation's `route` matches its `kind`'s canonical
 * template: `/emails/{id}`, `/entities/{id}`, `/knowledge?focus={id}`.
 */
export function citationRouteMatchesTemplate(citation: Citation): boolean {
  switch (citation.kind) {
    case "email":
      return citation.route === `/emails/${citation.id}`;
    case "entity":
      return citation.route === `/entities/${citation.id}`;
    case "knowledge":
      return citation.route === `/knowledge?focus=${citation.id}`;
  }
}

export interface CitationValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

/**
 * Validates a set of citations against the tool-result envelope's id list.
 * Two STRUCTURAL rules per citation: (1) its route matches its kind's
 * canonical template, and (2) its id is present in `envelopeIds`. Each
 * broken rule produces exactly one violation string.
 */
export function validateCitationEnvelope(
  citations: readonly Citation[],
  envelopeIds: readonly string[],
): CitationValidationResult {
  const violations: string[] = [];

  for (const citation of citations) {
    if (!citationRouteMatchesTemplate(citation)) {
      violations.push(
        `citation "${citation.id}" (kind: ${citation.kind}) has route "${citation.route}" which does not match the canonical template for its kind`,
      );
    }
    if (!envelopeIds.includes(citation.id)) {
      violations.push(
        `citation "${citation.id}" is not present in the supplied tool-result envelope id list`,
      );
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * STUB — plain-text LLM-judge rubric for the semantic half of
 * citation-faithfulness. Given the assistant's visible text and its
 * `citations[]` array, a judge should determine whether EVERY factual claim
 * traces to at least one citation (score 1) or any claim is
 * unsupported/hallucinated (score 0).
 *
 * This rubric is NOT wired to a live-model judge runner in this phase —
 * that is connected-env work (999.3-family), not CI-gated here. Only the
 * structural checker above (`validateCitationEnvelope`) runs in CI.
 */
export const CITATION_FAITHFULNESS_RUBRIC: string = `
Given the assistant's visible response text and its accompanying citations[]
array, judge whether every factual claim in the visible text traces back to
at least one entry in citations[]:

- Score 1 (faithful): every claim that asserts a fact about an email,
  entity, or knowledge-graph node is directly supported by at least one
  citation in citations[]. No claim goes beyond what the cited sources
  state.
- Score 0 (unfaithful): at least one claim is unsupported by any citation,
  or a citation is present but does not actually substantiate the claim it
  is attached to (hallucinated support).

This rubric is a STUB: it defines the judgment contract for a future
live-model judge run but is not itself executed by CI. It is documented here
so the eval dimension exists and is measurable in principle (EVAL-07) ahead
of a connected-env judge runner (999.3-family).
`.trim();
