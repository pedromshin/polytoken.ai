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
