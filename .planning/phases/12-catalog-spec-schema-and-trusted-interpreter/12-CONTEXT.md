# Phase 12: Catalog, Spec Schema, and Trusted Interpreter - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the **vocabulary contract** (catalog manifest + Zod spec schema + static registry) and a
**trusted interpreter** that renders a hardcoded sample spec as real `@nauta/ui` components in
`/studio/preview` — with **zero eval/Function/dangerouslySetInnerHTML**, per-node error boundaries,
declared state materialized into a store, and dotted-path data references resolved by safe lookup.

This is the first observable, demoable artifact **before** the generation layer exists. Built in a new
`packages/genui` package, consumed by a thin `/studio` route in `apps/web`.

In scope: CTLG-01..05, SPEC-01..06, SEAM-01, SEAM-03, COST-02, COST-03.
Out of scope (later phases): LLM generation + guardrails (Phase 13), exact cache + template store
(Phase 14), full studio browser/sandbox (Phase 15).
</domain>

<decisions>
## Implementation Decisions

### Catalog scope (CTLG-01..04)
- **D-01:** Ship a **lean, fully-real catalog of ~10 entries** — not a broad-but-shallow set. Depth-first:
  each entry is authored for production (strict Zod schema, description, example, slot rules, a11y marks),
  no stubs.
- **D-02:** Catalog set = **2 layout primitives** (`stack`, `grid` — house-built layout nodes, render to
  fl/grid containers, not `@nauta/ui` exports) + **~8 leaf components** mapping to `@nauta/ui`:
  `text`, `badge`, `button`, `card`, `key-value-list`, `separator`, `alert`, `table`. (Final exact list is
  builder's discretion within this ~10 envelope; this set is endorsed.)
- **D-03:** Each manifest entry uses the `ManifestEntry<TProps>` shape from SPEC-RENDERER.md §4.1:
  `type`, `description`, `example`, `propsSchema` (Zod, **`.strict()`**), `lockedProps`, `slots`,
  `acceptsChildren`, `component`. Manifest is **hand-authored** — do NOT use react-docgen-typescript as
  source of truth.
- **D-04:** **a11y-required props** (label / caption / alt as applicable per component) are **required** in
  each `propsSchema`, so a spec omitting them **fails validation** (CTLG-02). Hard-fail, not warn.
- **D-05:** A **CI test validates every manifest entry's `example` against its own `propsSchema`**
  (CTLG-04) — catches stale manifests immediately.

### Registry (CTLG-03, CTLG-05)
- **D-06:** A **static `COMPONENT_REGISTRY`** maps each spec `type` key → its real React component. Only
  registered components can be rendered; unknown types hit a safe `UnknownComponentPlaceholder` fallback
  (never throw). The component type allowlist is derived from registry keys (`z.enum(Object.keys(registry))`).
- **D-07:** **Registry version identifier = content-hash** — SHA-256 over the catalog entries (type keys +
  serialized prop schemas + slot rules). Any catalog change auto-bumps the version, so Phase 14's cache
  auto-invalidates with **no manual flush** (directly serves CACHE-04). Exposed as a stable string consumed
  downstream.

### Spec schema (SPEC-01, SPEC-04, SPEC-05, SEAM-01)
- **D-08:** Spec is a **nested discriminated-union tree** (not a flat ID-reference map), keyed on `type`,
  per SPEC-RENDERER.md §3. Node kinds for v1.1: `text`, `badge`, `button`, `card`, `stack`, `grid`,
  `key-value-list`, plus **`list`** (iteration) and **`conditional`** (SPEC-01 requires lists + conditionals).
- **D-09:** Recursion via **`z.lazy()` with explicit `z.ZodType<SpecNode[]>` annotation** on children
  (known Zod v3 discriminated-union limitation). **Zod v3 only** — Zod v4 is incompatible with Bedrock
  structured output (CURRENCY-2026.md).
- **D-10:** **Spec root carries `v: z.literal(1)`** (SEAM-01) — version at the root, not per node. Forces
  exact-version emission so stale specs are detectable; future grammar growth bumps to `v: 2` + a migration
  function.
- **D-11:** **Declared state primitives** (`name` / `type` / `initial` / `actions`) live in `spec.state[]`
  and are materialized into a store by the interpreter via **`useReducer`** (`useDeclaredState`) — the spec
  contains **no executable code** (SPEC-04). Mutations restricted to an enum (`toggle`/`set`/`reset`/
  `increment`/`decrement`).
- **D-12:** **Data/state references resolve via a safe dotted-path resolver** (`resolveDataRef`, e.g.
  `"state.isExpanded"`, `"data.email.subject"`) against a provided scope — **no eval** (SPEC-05). Unknown
  refs return `undefined`; conditional/list interpreters handle `undefined` gracefully.

### Trusted interpreter (SPEC-02, SPEC-03)
- **D-13:** **Recursive `renderNode()` interpreter** mirrors the local `column-defs.ts` precedent
  (`SchemaFieldType → getRendererAndEditor` switch), generalized to a tree: registry lookup → per-node
  `propsSchema.safeParse` → recurse children/slots → **`React.createElement`**. No eval/Function/
  dangerouslySetInnerHTML anywhere on the renderer path (SPEC-02).
- **D-14:** **Per-node `ErrorBoundary`** (React class component) wraps every registry dispatch, with a
  `NodeErrorFallback`. One malformed node is isolated; siblings keep rendering (SPEC-03).
- **D-15:** **Structural-position keys** (`root-0-1-2`), never LLM/random IDs — deterministic, preserves
  React reconciliation across spec regenerations.
- **D-16:** Both **named slots** (e.g. `card.header`/`footer`) and **positional `children[]`** supported
  (SPEC-RENDERER.md §3.2, §5.1).

### Hardcoded demo + studio preview (SPEC-06, STDO-03 pulled forward)
- **D-17:** The hardcoded sample spec is a **generic component showcase** (not a Nauta-flavored artifact this
  phase) that exercises every catalog node type. It **must still prove the hard success criteria**: it
  includes **≥1 declared state primitive + action** (e.g. an expandable section) and **≥1 dotted-path
  `dataRef`** resolution.
- **D-18:** A **separate fixture spec with one deliberately malformed node** proves error-boundary isolation
  (success criterion 3) — sibling nodes continue rendering.
- **D-19:** **`/studio/preview` shows the live render AND the spec JSON side-by-side** (read-only inspector).
  This pulls STDO-03 forward from Phase 15 — trivial cost (`<pre>{JSON}</pre>`), makes the demo
  self-explanatory and aids debugging in Phases 13-14. Full studio (catalog browser, generation sandbox)
  stays in Phase 15.
- **D-20:** `SpecRenderer` mounts as a **client island** — `dynamic(() => import(...), { ssr: false })`,
  same pattern Phase 11 used for `/knowledge`. Required because declared state + the class `ErrorBoundary`
  need the client (SPEC-RENDERER.md §5.7).

### Forward-compatibility seams (build/design, don't fully wire)
- **D-21 (SEAM-03):** Catalog + (future) cache key are **per-catalog-id capable** — one global catalog in
  v1.1, but the registry version + key shape leave room for tenant/importer-scoped catalogs later. Design
  the version/key as `{ catalogId, version }`-shaped even though only the global id is used now.
- **D-22 (COST-02):** Spec JSON schema is kept **stable and non-recursive at the JSON-Schema level**
  (`.strict()` / `additionalProperties:false` everywhere, no external `$ref`) so Phase 13's Bedrock reuses
  its compiled grammar across requests. Schema authored **Bedrock-structured-output-compatible from day one**
  (one stable module-level schema; reserve a leading `_plan: z.string()` reasoning field, stripped before
  render) so Phase 13 needs no schema rework.
- **D-23 (COST-03):** The catalog exposes a **compact encoding** for the model plus a hook for
  **candidate-component subsetting** once the catalog exceeds a size threshold (send relevant components,
  not all). v1.1 has ~10 components so subsetting is a documented seam, not active logic.
- **D-24 (SAFE-06 design seam):** Spec **depth + node-count bounds are designed into the schema**
  (`MAX_SPEC_NODES=200`, `MAX_SPEC_DEPTH=8` via `.refine()`/`countNodes`). Enforcement is Phase 13's
  guardrail concern, but the schema is authored bound-ready now.

### Claude's Discretion
- Exact final 8 leaf components within the ~10 envelope (D-02 set is endorsed).
- Internal `packages/genui` module layout (catalog / schema / registry / renderer file split).
- Subpath vs barrel imports from `@nauta/ui` (`@nauta/ui/badge` subpath exports exist).
- Exact `/studio/preview` layout/styling of the render+JSON split.
- Shape of the (empty-this-phase) `ActionRegistry` context — only needs to exist as a seam; real handlers
  arrive with generation.
- Whether bounds (D-24) are `.refine()` on the schema now or a separate validator helper.
</decisions>

<specifics>
## Specific Ideas

- The **`packages/ui/src/spreadsheet-grid/column-defs.ts`** pattern is the explicit north star — the
  generative interpreter is that exact `type-keyed registry → switch → renderer` shape generalized from a
  flat column list to a recursive tree. Substitute `SchemaFieldType` → `SpecNodeType` and `ColDef` →
  `React.ReactElement`.
- Demo intentionally generic this phase (showcase), but the renderer and registry built here are the SAME
  ones Phases 13-15 use in production — no separate/stub renderer (STDO-02 constraint honored early).
- Depth-first house rule: the ~10 catalog entries must be real (a11y-marked, CI-verified), not placeholders.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec schema, registry & interpreter (primary for this phase)
- `.planning/research/SPEC-RENDERER.md` — **primary doc.** Full spec shape (nested discriminated union),
  `ManifestEntry` shape (§4.1), registry construction for `@nauta/ui` (§4.2), recursive `renderNode`
  interpreter (§5), `useDeclaredState` (§6), `ActionRegistry` (§6.3), and 8 phase-specific pitfalls (§9).
- `.planning/research/SUMMARY.md` §1, §4 (Phase 1 + Phase 2), §5 (GR-01/02/06/07/15), §6 (open decisions) —
  convergent architecture, build order, guardrails relevant to the renderer, OD-2/OD-3.
- `packages/ui/src/spreadsheet-grid/column-defs.ts` — local precedent: type-keyed registry + switch-based
  renderer dispatch (the pattern to generalize).
- `packages/ui/src/spreadsheet-grid/types.ts` — `SchemaFieldType` discriminated union + readonly house style.

### Schema compatibility & versions (constrains schema authored now)
- `.planning/research/CURRENCY-2026.md` — **Zod v3 mandatory** (v4 incompatible), Bedrock structured-output
  constraints (`.strict()`, no recursion at JSON-schema level, stable schema, `_plan` first field).
- `.planning/research/GENERATION-AGENT.md` — Phase 13's generation contract; informs why the Phase 12 schema
  must be Bedrock-structured-output-compatible (D-22).

### Safety & downstream seams
- `.planning/research/SAFETY-PITFALLS.md` — GR-01 (no eval) is a Phase 12 property of the renderer; allowlist
  + bound guardrails (GR-02/06/07) shape the schema even though enforcement is Phase 13.
- `.planning/research/TEMPLATE-FLYWHEEL.md` — Phase 14 cache; informs registry-version content-hash (D-07,
  CACHE-04) and per-catalog-id key shape (D-21, SEAM-03).

### Requirements & scope
- `.planning/REQUIREMENTS.md` — CTLG-01..05, SPEC-01..06, SEAM-01/03, COST-02/03 (the phase's mapped reqs).
- `.planning/ROADMAP.md` (Phase 12 section) — the 5 success criteria this phase must make TRUE.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/ui` (`@nauta/ui`): ~35 shadcn/Radix components (badge, button, card, table, alert, separator,
  tabs, input, …). Barrel `src/index.ts` + subpath exports (`"./*": ["./src/*.tsx", "./src/*.ts"]`) — both
  `@nauta/ui` and `@nauta/ui/badge` work.
- `packages/ui/src/spreadsheet-grid/column-defs.ts` + `types.ts`: the proven Catalog→Registry→Renderer
  dispatch pattern to generalize.
- `apps/web`: Next.js App Router + tRPC (`src/app/api/trpc`) + TanStack Query already wired; existing routes
  `/emails`, `/entities`, `/entity-types`, `/knowledge` are the siblings `/studio` joins.
- Phase 11 `/knowledge` established the `dynamic(ssr:false)` client-island pattern reused by D-20.

### Established Patterns
- Discriminated-union → keyed dispatch (column-defs); `readonly`/immutable house style (CLAUDE.md: immutable
  only, named exports, explicit types, Zod validation at boundaries).
- Bedrock via IAM role (no API key) is the project transport — relevant to Phase 13, not wired here.

### Integration Points
- **New package `packages/genui`** holds catalog + spec schema + registry + renderer (consumed by
  `apps/web`). No package exists yet — created this phase.
- **New route `apps/web/src/app/studio/preview`** mounts the client-island `SpecRenderer` on the hardcoded
  spec + JSON inspector.
- **Seam for Phase 13:** an (empty) `ActionRegistry` context + a place a genui tRPC router will attach; the
  registry version string is the value Phase 14's cache key will consume.
</code_context>

<deferred>
## Deferred Ideas

- **LLM generation + repair loop + dual-LLM quarantine + allowlists** — Phase 13 (GEN/SAFE). Schema is
  authored compatible (D-22) but no Bedrock call this phase.
- **Exact (hash) cache + `ui_spec_templates` store** — Phase 14 (CACHE). Registry version content-hash
  (D-07) is the seam it consumes.
- **Full `/studio` surface** (catalog browser, intent → generate → preview sandbox, generation-state
  indicators) — Phase 15 (STDO-01/02/04). Only `/studio/preview` (render + JSON) exists this phase.
- **Nauta-flavored real demo** (email/entity-bound spec) — deferred; this phase's demo is a generic showcase
  by decision (D-17). The real product wiring is explicitly v1.2 convergence, not v1.1.
- **Candidate-component subsetting logic** (COST-03) — documented seam only at ~10 components (D-23).
- **Per-node persistent state via Jotai `atomFamily`, progressive/streamed partial specs, semantic template
  retrieval, code-emit** — v1.2 / out of milestone.

### Reviewed Todos (not folded)
None — `todo.match-phase 12` returned 0 matches.
</deferred>

---

*Phase: 12-catalog-spec-schema-and-trusted-interpreter*
*Context gathered: 2026-06-27*
