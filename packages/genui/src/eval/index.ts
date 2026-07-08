/**
 * eval/index.ts — Public re-exports for @nauta/genui/eval subpath.
 *
 * Exports the shared Zod schema + inferred type, plus typed JSON constants
 * for the two committed eval assets:
 *   - PAGE_IDEAS: all 76 real corpus prompts (superset, D-19/IDEA-01)
 *   - GOLDEN_SET: curated ~36-entry subset for the eval runner (EVAL-04)
 *
 * Both assets share ONE schema (D-02: page-ideas-schema.ts).
 * No AI-invented prompts — provenance is preserved verbatim (D-19).
 *
 * CR-02: Both exports are parsed through PageIdeaSetSchema.parse() at module
 * load so the .strict() Zod schema actually validates the JSON files.
 * Any schema drift (extra/renamed/missing fields) will throw at startup
 * rather than silently producing wrong data at runtime.
 */

export { PageIdeaSchema, PageIdeaSetSchema } from "./page-ideas-schema";
export type { PageIdea } from "./page-ideas-schema";

import pageIdeasJson from "./page-ideas.json";
import goldenSetJson from "./golden-set.json";
import type { PageIdea } from "./page-ideas-schema";
import { PageIdeaSetSchema } from "./page-ideas-schema";

/**
 * All 76 real corpus prompts with verbatim provenance.
 * Parsed through PageIdeaSetSchema at module load — throws if JSON drifts
 * from the schema (D-02 / CR-02). Object.freeze prevents runtime mutation.
 */
export const PAGE_IDEAS: readonly PageIdea[] = Object.freeze(
  PageIdeaSetSchema.parse(pageIdeasJson),
);

/**
 * Curated ~36-entry subset of PAGE_IDEAS, satisfying D-03 coverage quotas:
 *   >= 10 Tier-A, >= 20 Tier-B, all 8 curveballs, >= 1 per category,
 *   balanced across simple/medium/complex.
 * Parsed through PageIdeaSetSchema at module load (D-02 / CR-02).
 */
export const GOLDEN_SET: readonly PageIdea[] = Object.freeze(
  PageIdeaSetSchema.parse(goldenSetJson),
);

/**
 * Phase 35 (EVAL-06/EVAL-07) — retrieval-quality, injection-resistance, and
 * citation-faithfulness eval dimensions. Registered into this SAME harness
 * (FOUND-7: never a parallel mechanism). See EVAL-DIMENSIONS.README.md for
 * the full scoring contracts and the Python<->TS bridge path contract.
 */

export {
  RetrievalExpectedIdSchema,
  RetrievalGoldenEntrySchema,
  RetrievalGoldenSetSchema,
  InjectionFixtureSchema,
  InjectionFixtureSetSchema,
  CitationSchema,
} from "./eval-dimensions-schema";
export type {
  RetrievalExpectedId,
  RetrievalGoldenEntry,
  InjectionFixture,
  Citation,
} from "./eval-dimensions-schema";

import retrievalGoldenSetJson from "./retrieval-golden-set.json";
import injectionFixturesJson from "./injection-fixtures.json";
import type {
  RetrievalGoldenEntry,
  InjectionFixture,
} from "./eval-dimensions-schema";
import {
  RetrievalGoldenSetSchema,
  InjectionFixtureSetSchema,
} from "./eval-dimensions-schema";

/**
 * 5-10 seed retrieval golden-set entries (EVAL-06). SEED/fixture-shaped —
 * real-data entries land with Phases 36/37 (see EVAL-DIMENSIONS.README.md).
 * Parsed through RetrievalGoldenSetSchema at module load (schema drift
 * throws at import time, mirrors PAGE_IDEAS/GOLDEN_SET's CR-02 pattern).
 */
export const RETRIEVAL_GOLDEN_SET: readonly RetrievalGoldenEntry[] = Object.freeze(
  RetrievalGoldenSetSchema.parse(retrievalGoldenSetJson),
);

/**
 * 3-5 seed injection-resistance canary fixtures (EVAL-07). Full adversarial
 * suite + live-model harness is Phase 38 (QUAR-02) — this seeds the scorer
 * mechanics only. Parsed through InjectionFixtureSetSchema at module load.
 */
export const INJECTION_FIXTURES: readonly InjectionFixture[] = Object.freeze(
  InjectionFixtureSetSchema.parse(injectionFixturesJson),
);

/**
 * Pure scorer functions for the three Phase 35 eval dimensions — retrieval
 * recall/precision (EVAL-06), citation structural validity (EVAL-07), and
 * injection-resistance canary leakage (EVAL-07). See
 * EVAL-DIMENSIONS.README.md for the full scoring contracts.
 */

export { scoreRetrievalAtK } from "./retrieval-scorer";
export type { RetrievalScore } from "./retrieval-scorer";

export {
  validateCitationEnvelope,
  citationRouteMatchesTemplate,
  CITATION_FAITHFULNESS_RUBRIC,
} from "./citation-scorer";
export type { CitationValidationResult } from "./citation-scorer";

export { extractCanary, scoreInjectionResistance } from "./injection-scorer";
export type { InjectionScore } from "./injection-scorer";
