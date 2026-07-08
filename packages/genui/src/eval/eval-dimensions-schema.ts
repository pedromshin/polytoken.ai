/**
 * eval/eval-dimensions-schema.ts — Shared Zod schemas for the Phase-35 eval dimensions.
 *
 * Registers THREE new eval-harness dimensions into the EXISTING Phase-16
 * `packages/genui/src/eval/` harness (FOUND-7: one harness, never a parallel
 * mechanism) — mirrors the "ONE schema per asset family" precedent set by
 * `page-ideas-schema.ts`, generalized to these new shapes:
 *
 *   - RetrievalGoldenEntrySchema  — retrieval-golden-set.json (EVAL-06)
 *   - InjectionFixtureSchema      — injection-fixtures.json (EVAL-07)
 *   - CitationSchema              — citations[] envelope entries (EVAL-07,
 *     structural half only; no dedicated JSON asset — consumed directly by
 *     `citation-scorer.ts` callers)
 *
 * Field names on RetrievalGoldenEntrySchema (`expected_ids`/`notes`) are
 * LOCKED verbatim from 35-CONTEXT.md and stay snake_case even though the
 * rest of this package uses camelCase.
 */

import { z } from "zod";

/** The three tool-result kinds citations/retrieval results can resolve to. */
const KIND_ENUM = z.enum(["email", "entity", "knowledge"]);

// ───────────── retrieval golden set (EVAL-06) ─────────────────────────────

/** One expected retrieval result — a `{kind, id}` pair. */
export const RetrievalExpectedIdSchema = z
  .object({
    kind: KIND_ENUM,
    id: z.string().min(1),
  })
  .strict();

export type RetrievalExpectedId = z.infer<typeof RetrievalExpectedIdSchema>;

/**
 * One golden-set entry: a query and the set of results it MUST retrieve.
 * `expected_ids`/`notes` field names are LOCKED from 35-CONTEXT.md.
 */
export const RetrievalGoldenEntrySchema = z
  .object({
    id: z.number().int().positive(),
    query: z.string().min(1),
    expected_ids: z.array(RetrievalExpectedIdSchema).min(1),
    notes: z.string(),
  })
  .strict();

export type RetrievalGoldenEntry = z.infer<typeof RetrievalGoldenEntrySchema>;

export const RetrievalGoldenSetSchema = z.array(RetrievalGoldenEntrySchema);

// ───────────── injection-resistance fixtures (EVAL-07) ────────────────────

/**
 * One injection-resistance canary fixture — mirrors Phase 20's
 * `AdversarialFixture` shape, but the payload field is `retrievedText`
 * (simulated quarantined tool output) and the expectation field is a
 * free-text `expectedBehavior`, per 35-CONTEXT.md's Fork-3 shape. Exactly 3
 * fields, `.strict()`.
 */
export const InjectionFixtureSchema = z
  .object({
    name: z.string().min(1),
    retrievedText: z.string().min(1),
    expectedBehavior: z.string().min(1),
  })
  .strict();

export type InjectionFixture = z.infer<typeof InjectionFixtureSchema>;

export const InjectionFixtureSetSchema = z.array(InjectionFixtureSchema);

// ───────────── citation-faithfulness envelope (EVAL-07, structural) ───────

/**
 * One `citations[]` entry. `route` must match the canonical template for
 * `kind` (`/emails/{id}`, `/entities/{id}`, `/knowledge?focus={id}`) —
 * enforced by `citation-scorer.ts`'s `citationRouteMatchesTemplate`, not by
 * this schema (the schema only validates shape, not cross-field structure).
 */
export const CitationSchema = z
  .object({
    kind: KIND_ENUM,
    id: z.string().min(1),
    route: z.string().min(1),
  })
  .strict();

export type Citation = z.infer<typeof CitationSchema>;
