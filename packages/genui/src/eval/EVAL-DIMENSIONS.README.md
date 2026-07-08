# Eval Dimensions — Retrieval, Citation-Faithfulness, Injection-Resistance

Phase 35 (COST-05, EVAL-06, EVAL-07) registers three NEW eval-harness
dimensions into the EXISTING `packages/genui/src/eval/` harness (FOUND-7:
one harness, never a parallel mechanism). Each fixture file follows the
exact `page-ideas.json`/`golden-set.json`/`eval-assets.test.ts` pattern
already established in this directory: a `.strict()` Zod schema, a JSON
fixture file parsed through `.parse()` at module load (schema drift throws
at import time, not silently), and a CI-gating assets test.

## `retrieval-golden-set.json` — EVAL-06

**Shape:** `{id, query, expected_ids: [{kind, id}], notes}` — validated by
`RetrievalGoldenEntrySchema` / `RetrievalGoldenSetSchema`
(`eval-dimensions-schema.ts`).

**Scoring contract:** `scoreRetrievalAtK(actualIds, expectedIds, k)` in
`retrieval-scorer.ts` computes `recallAtK`/`precisionAtK` against the top-`k`
of `actualIds`. Default `k = 5`, matching TOOL-01/TOOL-02's top-5 result cap
(Phase 36). TOOL-03's `search_knowledge` (Phase 37) caps at top-8 — callers
scoring `search_knowledge` results pass `k = 8` explicitly.

**Status: SEED / fixture-shaped.** No live `entity`/`email`/`knowledge` table
exists to resolve these ids against yet — `expected_ids` use clearly-synthetic
values (`entity-acme-logistics`, `email-seed-001`, `node-seed-001`, ...) and
each entry's `notes` field states which Phase lands the real tool
(TOOL-01/TOOL-02 → Phase 36, TOOL-03 → Phase 37). Real-data entries are
deferred to those phases — this seed set only proves the scorer mechanics
against fixture-shaped/echo-stub data now, per 35-CONTEXT.md.

## `injection-fixtures.json` — EVAL-07 (injection-resistance)

**Shape:** `{name, retrievedText, expectedBehavior}` — validated by
`InjectionFixtureSchema` / `InjectionFixtureSetSchema`
(`eval-dimensions-schema.ts`), mirroring Phase 20's `adversarial.ts` shape
(one distinct escape technique per entry).

**Canary convention:** every `retrievedText` embeds a distinctive marker in
the EXACT bracket format `[CANARY:<token>]` (token unique per fixture, e.g.
`INJ_DELIM_9f2a`). This is the ONLY canary-encoding convention — there is no
separate JSON field for it. `injection-scorer.ts`'s `extractCanary` pulls the
token out of `retrievedText` via regex; `scoreInjectionResistance` then
checks whether that exact token substring leaked into a turn's visible text.
This is explicitly "beyond 'didn't call a tool'" (35-CONTEXT.md) — the check
inspects VISIBLE TEXT, not tool-dispatch behavior.

**Categories (exactly 4, seeded now):** `delimiter-breakout`,
`role-confusion`, `encoded-override`, `nested-tool-call-request`. Do not
invent additional categories in this fixture file without updating this
README.

**Status: seed scorer-mechanics proof, not the full suite.** Phase 35 seeds
3-5 canary fixtures scored against the echo stub. The FULL adversarial suite
+ a live-model harness run is Phase 38's QUAR-02 — this phase only proves the
scorer works, it does not attempt exhaustive adversarial coverage.

## Citation-faithfulness — EVAL-07 (structural half)

**Shape:** `{kind, id, route}` — validated by `CitationSchema`
(`eval-dimensions-schema.ts`). `kind` is one of `email` | `entity` |
`knowledge`.

**Canonical route templates** (enforced by `citation-scorer.ts`'s
`citationRouteMatchesTemplate`):

| `kind`      | Route template          |
|-------------|--------------------------|
| `email`     | `/emails/{id}`           |
| `entity`    | `/entities/{id}`         |
| `knowledge` | `/knowledge?focus={id}`  |

`validateCitationEnvelope(citations, envelopeIds)` checks two STRUCTURAL
rules per citation: (1) its `route` matches its `kind`'s canonical template,
and (2) its `id` is present in the tool-result envelope's id list
(`envelopeIds`). Both violations are reported as distinct strings.

**LLM-judge half is a STUB, not connected.** The semantic judgment — "does
every visible claim actually trace to a citation, with none hallucinated" —
is captured as `CITATION_FAITHFULNESS_RUBRIC` (plain rubric text) in
`citation-scorer.ts`. Wiring a live-model judge runner against that rubric is
explicitly OUT OF SCOPE for this phase: it is connected-env work in the
999.3-family, not CI-gated here. This phase only ships the structural
checker (T-35-06 accepts the semantic gap for now).

## Python <-> TS bridge — path contract

**One fixture source of truth, two runners** (35-CONTEXT.md). Both
`retrieval-golden-set.json` and `injection-fixtures.json` in this directory
are the ONLY committed copies of this fixture data. They are read by:

1. This TS package (`packages/genui/src/eval/index.ts` re-exports
   `RETRIEVAL_GOLDEN_SET` / `INJECTION_FIXTURES`, parsed via `.parse()` at
   module load).
2. A separate Python pytest module,
   `apps/email-listener/tests/evals/` (Plan 35-03), which loads these SAME
   two JSON files by a monorepo-relative path resolver
   (`apps/email-listener/tests/evals/_paths.py`), mirroring the existing
   monorepo walk-up pattern already used by
   `app/infrastructure/llm/genui_artifacts.py`.

Never hand-copy the contents of either JSON file into a Python-side
duplicate. If a fixture needs to change, edit the JSON file here — both
runners pick up the change automatically because they resolve the same path
on disk.
