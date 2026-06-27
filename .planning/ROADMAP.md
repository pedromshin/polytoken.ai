### Phase 11: Knowledge-node graph view (4e knowledge graph)

**Goal:** A graph/relationship visualization (`/knowledge`) of knowledge nodes and what they relate to (entity types, fields, instances, other nodes). Realizes Phase 9 request-6 **R6** and the deferred "4e Knowledge Graph" moat. Ships the SIMPLE, demoable-today version from existing FKs (D-01), with documented seams (empty `knowledge_node_edges` table, source-agnostic edge provider, tenant-by-data, documented synthesis trigger) so the real 4e synthesis backend drops in with no rework.
**Requirements**: Decision-driven (11-CONTEXT.md D-01..D-13; seams D-05/D-10..D-13 mandatory); no REQ-IDs mapped
**Status:** Planned (3 plans, 3 waves — 2026-06-15; backend Wave 1 → frontend foundation Wave 2 → frontend surface + human-verify Wave 3; READ-ONLY surface, D-09; knowledge_node_edges stays EMPTY, D-05)
**Depends on:** Phase 9 (shell) + Phase 10 (so the graph relates to real entity instances)
**Prerequisites (hard):** a NEW empty `knowledge_node_edges` table (the 4e write-seam, D-05); a knowledge tRPC router (`graph` + `list` + `byId`); a graph-viz dependency (`@xyflow/react` + `@dagrejs/dagre`). NOTE: knowledge-node SYNTHESIS/write path is explicitly DEFERRED to the future 4e phase (D-09) — this phase reads existing data + documents the injection point only (D-13).
**Plans:** 3/3 plans complete

Plans:
**Wave 1**
- [x] 11-01-PLAN.md — Backend: empty knowledge_node_edges table + [BLOCKING] migration 0019 + knowledge tRPC router (graph/list/byId) behind the inferred edge-provider seam + D-13 synthesis-trigger doc (D-02/04/05/06/09/10/11/12/13)
**Wave 2** *(depends on 11-01)*
- [x] 11-02-PLAN.md — Frontend foundation: @xyflow/react + @dagrejs/dagre install + /knowledge route (dynamic ssr:false client island) + dagre TB layout + 6 custom node types + edge styling + sidebar nav flip (D-02/04/07/08/11)
**Wave 3** *(depends on 11-02)*
- [x] 11-03-PLAN.md — Frontend surface: three-zone shell (filter rail / canvas / detail pane) + toolbar + taxonomy banner + per-type detail with /entities + /emails deep-links + all states + a11y + browser human-verify (D-02/03/08/09)

---

# Milestone v1.1 — Generative UI Engine

**Goal:** A runtime, spec-first generative-UI engine that generates web-page UI from a constrained
catalog of existing `@nauta/ui` components, renders it through a trusted interpreter (Catalog → Spec
→ Registry → Renderer, no eval), and caches good outputs. Built standalone in `packages/genui`
consumed by a `/studio` route — integration-seamed for later convergence with Nauta product surfaces.

**Scope:** Spine components 1–5 + 7 of the 8-component research spine. v1.2 deferrals (semantic
template retrieval/promotion FLY, evals/regression EVAL, code-emit experiment CODE, batch pre-warming
COST-04) are explicitly out of this milestone.

**Phases:** 12–15 (continuing from v1.0's Phase 11)
**Coverage:** 37/37 v1.1 requirements mapped (CTLG-01..05, SPEC-01..06, GEN-01..06, SAFE-01..06, CACHE-01..04, STDO-01..04, COST-01..03, SEAM-01..03)

## Phases

- [x] **Phase 12: Catalog, Spec Schema, and Trusted Interpreter** — The vocabulary contract plus a hardcoded end-to-end render — the first demoable artifact before generation exists (completed 2026-06-27)
- [x] **Phase 13: Generation Layer and Guardrails** — Bedrock Haiku 4.5 generation pipeline with dual-LLM quarantine, three allowlists, repair loop, and cost controls wired together
 (completed 2026-06-27)
- [x] **Phase 14: Exact Cache and Template Store** — SHA-256 exact-match cache backed by Drizzle/Postgres, with auto-invalidation on registry version change
 (completed 2026-06-27)
- [x] **Phase 15: Studio Surface** — `/studio` route: catalog browser, generation sandbox, spec inspector, and generation-state indicators (completed 2026-06-27)

## Phase Details

### Phase 12: Catalog, Spec Schema, and Trusted Interpreter

**Goal:** The vocabulary contract is established and a hardcoded spec renders live `@nauta/ui` components in `/studio` with zero eval — the first observable, demoable artifact before the generation layer is wired.
**Depends on:** Phase 11 (existing monorepo shell and `packages/` layout)
**Requirements:** CTLG-01, CTLG-02, CTLG-03, CTLG-04, CTLG-05, SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, SPEC-06, SEAM-01, SEAM-03, COST-02, COST-03
**Status:** Planned (4 plans, 4 waves — 2026-06-27; foundation+schema W1 → catalog+registry+CTLG-04 test W2 → trusted interpreter W3 → demo specs + /studio/preview + sidebar + human-verify W4; zero-eval renderer per SPEC-02/GR-01)
**Success Criteria** (what must be TRUE):
  1. A developer can read the `packages/genui` catalog manifest and see every whitelisted `@nauta/ui` component with its Zod prop schema, slot rules, LLM-settable vs locked props, and an a11y-required prop marker — and every example in the manifest passes CI validation against its own schema.
  2. A hardcoded sample spec (manually authored JSON with `v: 1` envelope) renders as real `@nauta/ui` components in `/studio/preview` via `createElement` with no `eval`, `Function`, or `dangerouslySetInnerHTML` anywhere in the renderer path.
  3. One malformed node in a spec does not crash the surface — the error boundary isolates it and sibling nodes continue rendering.
  4. Declared state primitives in the spec (name / type / initial / actions) are materialized into a store by the interpreter, and dotted-path data references resolve via safe lookup against the provided scope — no executable code in the spec.
  5. The registry exposes a version identifier, and the spec envelope carries a `v` field and a per-catalog-id capability so downstream cache keys and future tenant catalogs slot in without schema changes.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 12-01-PLAN.md — Foundation: @nauta/genui package scaffold + catalog/types.ts (SpecNodeType, ManifestEntry) + schema/spec-schema.ts (v:1 discriminated-union tree, state primitives, dataRef strings, .strict() + MAX_SPEC_NODES/DEPTH bounds) (SPEC-01/04/05, SEAM-01, COST-02; D-08..12/22/24)
**Wave 2** *(depends on 12-01)*
- [x] 12-02-PLAN.md — Catalog + registry: NAUTA_CATALOG ~10 real entries (strict propsSchema, a11y-required, locked props) + COMPONENT_REGISTRY + UnknownComponentPlaceholder + SHA-256 {catalogId,version} REGISTRY_VERSION + [CTLG-04] manifest-example CI test (CTLG-01..05, COST-03, SEAM-03; D-01..07/21/23)
**Wave 3** *(depends on 12-01, 12-02)*
- [x] 12-03-PLAN.md — Trusted interpreter: recursive renderNode → createElement (zero eval) + per-node NodeErrorBoundary + useDeclaredState (useReducer, 5-mutation enum) + resolveDataRef + conditional/list control-flow + SpecRenderer + empty ActionRegistry seam (SPEC-02/03/04/05; D-13..16)
**Wave 4** *(depends on 12-01, 12-02, 12-03; autonomous:false — human-verify)*
- [x] 12-04-PLAN.md — Demo + surface: SHOWCASE_SPEC (every node type + state/action + dataRef) + MALFORMED_SPEC + /studio/preview route (render + JSON side-by-side island, ssr:false) + live Studio sidebar nav + browser human-verify (SPEC-06; D-17..20)
**UI hint**: yes

---

### Phase 13: Generation Layer and Guardrails

**Goal:** A tRPC procedure accepts an intent and returns a validated, safety-checked spec via Bedrock Haiku 4.5 — with dual-LLM quarantine ensuring raw untrusted content never reaches the generator, three allowlists enforcing the component/procedure/action surface, a bounded repair loop on invalid output, and cost controls active from the first call.
**Depends on:** Phase 12 (catalog, spec schema, and registry must exist before generation can target them)
**Requirements:** GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, COST-01, SEAM-02
**Status:** Planned (4 plans, 3 waves -- 2026-06-27; D-01 honored: Bedrock generation lives in the FastAPI Python service, web genui tRPC router proxies. W1 TS contract/allowlists/artifacts + audit table (parallel) -> W2 Python quarantine+generator+repair+fallback+audit+endpoint -> W3 web proxy + Zod re-validation + ActionRegistry binding (mutate empty seam). Security gate ON: every plan carries a STRIDE <threat_model>; dual-LLM quarantine, three allowlists, repair-loop+fallback, cost controls, audit log each a verifiable acceptance criterion. 14/14 reqs + 26/26 decisions covered.)
**Success Criteria** (what must be TRUE):
  1. Submitting an intent via the tRPC procedure triggers a Bedrock Haiku 4.5 call constrained to the registry schema via `Output.object`; if output is invalid Zod `safeParse` triggers a repair loop (max 3 attempts feeding the error back), and on persistent failure the procedure returns a safe fallback spec — never raw model output.
  2. Untrusted content (e.g. email body) passes through a separate quarantine Bedrock call with an enum-constrained extraction schema before any structured data reaches the generator; the generator never sees raw prose.
  3. A spec referencing an unregistered component type, a non-allowlisted tRPC procedure, or a non-relative action href fails Zod validation and is rejected before reaching the renderer.
  4. Every Bedrock call carries an explicit `max_tokens` limit and an `AbortController` timeout; every generation event (intent, model, tokens, outcome) is written to the audit log; spec tree depth and node count are bounded by the schema.
  5. The system prompt (catalog + examples) is cached via Bedrock `cachePoint` so per-request input carries only intent + data-shape; the binding/action layer schema has both query and mutation paths defined (v1.1 wires queries only; the mutation path exists but is empty).
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 13-01-PLAN.md -- TS contract layer: three allowlists at the Zod schema level (component-type/D-12, procedure-enum+no-UUID/D-13/13a, action discriminated-union relative-href + empty-mutate seam/D-14) + SAFE_FALLBACK_SPEC (D-07) + Bedrock artifact emit (spec.schema.json + compact-catalog/procedures, D-03/D-22) with CI drift gate (SAFE-02/03/04/06, SEAM-02, GEN-03, COST-01/03) [EXECUTED 2026-06-27]
- [x] 13-02-PLAN.md -- Audit foundation: genui_generation_events Drizzle table + migration 0021 (D-19) + GenerationAuditRepository port + best-effort Supabase adapter (GEN-05)
**Wave 2** *(depends on 13-01, 13-02)*
- [x] 13-03-PLAN.md -- Python generation service: dual-LLM quarantine (Call A enum-extraction) + generator adapter (emit_ui_spec forced tool-use, cache_control, max_tokens/timeout/temp0, Haiku->Sonnet 4.6 escalation) + GenerateUiSpecUseCase (repair <=3 -> SAFE_FALLBACK -> audit) + POST /v1/genui/generate (X-API-Key) + DI + settings (GEN-01/02/03/06, SAFE-01/05, COST-01)
**Wave 3** *(depends on 13-01, 13-03)*
- [x] 13-04-PLAN.md -- Web wiring: genui tRPC router proxy + SpecRootSchema.safeParse at the web boundary -> SAFE_FALLBACK (D-08) + ActionRegistry binding layer (query/setState/navigate wired with runtime relative-href re-check; mutate left unregistered = SEAM-02) + vitest (GEN-03/04, SAFE-02/03/04, SEAM-02)
**UI hint**: yes

---

### Phase 14: Exact Cache and Template Store

**Goal:** Every generated spec is persisted to a Drizzle/Postgres template store, and repeat intents with identical context hit a SHA-256 exact-match cache that returns a re-bound spec with no Bedrock call — and a registry version bump automatically invalidates affected cache entries.
**Depends on:** Phase 13 (there must be generated specs to cache and a registry version to key against)
**Requirements:** CACHE-01, CACHE-02, CACHE-03, CACHE-04
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. A generated spec is persisted to the `ui_spec_templates` table (via Drizzle/Postgres) with its intent, registry version, validation status, and metadata immediately after a successful generation — forming the flywheel foundation for v1.2 semantic retrieval.
  2. A second identical intent (same canonical intent + data shape + registry version + context) returns the cached spec with live data re-bound and triggers zero Bedrock calls — observable via the audit log showing no new generation entry.
  3. When the registry version increments (e.g. on deploy), cache keys derived from the old version are automatically invalidated so stale specs are never served without re-generation.
**Plans:** 3/3 plans complete
Plans:
- [x] 14-01-PLAN.md — ui_spec_templates Drizzle table + migration 0022 (unique cache_key, validation_status CHECK, RLS deny-all) [CACHE-01]
- [x] 14-02-PLAN.md — pure deterministic cache_key module (canonicalize_intent, value-free data_shape_hash, SHA-256 key) [CACHE-02, CACHE-04]
- [x] 14-03-PLAN.md — UiSpecTemplateRepository port+adapter + step-0 cache check / validated-only persist in GenerateUiSpecUseCase + DI + cache_hit signal [CACHE-01..04]

---

### Phase 15: Studio Surface

**Goal:** A developer can open `/studio`, browse the full component catalog, enter a natural-language intent, see the generated UI rendered live in a preview sandbox alongside the underlying spec JSON, and observe generation states (streaming, validation failure + fallback, cache-hit vs cold) — all in one surface.
**Depends on:** Phase 14 (full spine must be wired: catalog → generation → cache → render)
**Requirements:** STDO-01, STDO-02, STDO-03, STDO-04
**Status:** Complete (3 plans, 3 waves — 2026-06-27; W1 additive signal contract [D-05] + pure studio helpers → W2 /studio shell + catalog browser + shared renderer island → W3 generation sandbox + four-state chrome. Reuse-only demo surface: no new generation/cache/renderer logic; same production SpecRenderer + COMPONENT_REGISTRY + NAUTA_CATALOG; Phase 12 design system verbatim, no new tokens. Security gates all CLEAN. 4/4 STDO reqs met.)
**Success Criteria** (what must be TRUE):
  1. [x] A developer navigating to `/studio` sees a browseable catalog of all whitelisted `@nauta/ui` components, each with its prop schema, slot rules, and rendered example. (CatalogBrowserIsland, 15-02)
  2. [x] Entering an intent in the studio's generation sandbox produces a live rendered UI preview backed by the same `packages/genui` `SpecRenderer` and `COMPONENT_REGISTRY` used in production — not a separate or stub renderer. (GenerationSandboxIsland + SpecRendererIsland, 15-03)
  3. [x] The spec JSON that produced the rendered output is visible alongside the preview for inspection, so a developer can confirm the interpreter is rendering what the model emitted. (45-panel Spec JSON, 15-03)
  4. [x] The studio surface visibly distinguishes four generation states: in-progress streaming, validation-failure + fallback, cache-hit (zero LLM cost), and cold generation — so a developer can observe the full engine behavior without external tooling. (GenerationStateChrome, 15-03)
**Plans:** 3/3 plans complete

Plans:
**Wave 1**
- [x] 15-01-PLAN.md — Additive signal contract (D-05): outcome on GenerateUiSpecResult + GenerateUiSpecView + tRPC GenerateOutputSchema {outcome,spec,cacheHit,reason?} (safeParse stays authoritative) + pure unit-tested deriveGenerationState + describePropsSchema helpers in @nauta/genui/studio (STDO-04, STDO-01; D-04/D-05/D-11/D-15)
**Wave 2** *(depends on 15-01)*
- [x] 15-02-PLAN.md — /studio server shell + Tabs[Catalog,Sandbox]+Showcase link + shared SpecRendererIsland lift + CatalogBrowserIsland (direct NAUTA_CATALOG import, four facets per entry, live examples via the production renderer) + sidebar repoint (STDO-01, STDO-02; D-01/D-07/D-10/D-11/D-12/D-13/D-14)
**Wave 3** *(depends on 15-01, 15-02)*
- [x] 15-03-PLAN.md — GenerationStateChrome (four-state chrome: in-progress/fallback/cache-hit/cold+escalated, deriveGenerationState, aria-live/role=alert) + SpecRendererIsland extended with optional actions prop + GenerationSandboxIsland (intent → enabled:false tRPC query + refetch() + buildActionRegistry + 55/45 ResizablePanelGroup render/JSON split) wired into studio-tabs.tsx (STDO-02, STDO-03, STDO-04; D-02/D-03/D-06/D-08/D-09). Browser visual verify: deferred per plan directive (DO NOT BLOCK).
**UI hint**: yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 12. Catalog, Spec Schema, and Trusted Interpreter | 4/4 | Complete   | 2026-06-27 |
| 13. Generation Layer and Guardrails | 4/4 | Complete   | 2026-06-27 |
| 14. Exact Cache and Template Store | 3/3 | Complete   | 2026-06-27 |
| 15. Studio Surface | 3/3 | Complete   | 2026-06-27 |

---

# Milestone v1.2 — Generative UI: Realism & Interactivity

**Goal:** Break the v1.1 ceiling — make `/studio` generations read as *real, custom-styled, interactive*
apps instead of generic shadcn card-stacks — without abandoning v1.1's zero-eval safety where it belongs.
Architecture = **HYBRID** (decided, see `.planning/research/GENUI-VNEXT-RESEARCH.md`): keep the declarative
spec for layout/static content, add a **declarative JSON-Schema form engine** for forms + business logic
(still no eval), and gate a **sandboxed code-island** behind explicit user sign-off for the genuinely-custom
interactive widgets. Every generation-quality change is measured against an **eval harness built first**
(eval-driven development), not vibes.

**Scope:** LOCAL + `/studio` sandbox only. **No deploy, no product convergence** (per user direction —
[[genui-vnext-direction]]). The eval harness is a first-class deliverable and the gate for every Tier-A
change; Tier B-2 (jailed-eval) is the one new high-risk subsystem and is fenced behind a SPIKE + sign-off.

**Phases:** 16–20 (continuing from v1.1's Phase 15)
**Coverage:** 24/24 v1.2 requirements mapped (EVAL-01..05, STDO-05..07, IDEA-01, STYLE-01..04, RAG-01..02, CTLG-06..09, FORM-01..05, CODE-01)

## Phases

- [ ] **Phase 16: Studio Foundation — Eval Harness + History & Page-Ideas Tabs** — Eval-driven dev: golden prompt set (from the real corpus) + LLM-as-judge UI-quality rubric + a `studio` eval runner that baselines generations, plus History and Page-Ideas tabs over already-persisted data
- [ ] **Phase 17: Tier A — Design-Token/Theme Layer + Style Packs + Assembly RAG** — Ground generation in an explicit design system + W3C-DTCG design tokens varied per generation + retrieved exemplars (v0's "registry" method), measured as a lift on the golden set
- [ ] **Phase 18: Tier A — Catalog Expansion** — Real domain components (avatar, list/feed-item, nav, tabs, input primitives) so composition stops reading as generic cards; depth-first, a11y-marked, CI-validated
- [ ] **Phase 19: Tier B-1 — Declarative JSON-Schema Form Engine** — A `form` node backed by a schema-driven engine (RJSF/JSONForms/Formily-style) for fields, conditional logic, and customizable validation/business rules — fully declarative, no eval
- [ ] **Phase 20: Tier B-2 — Sandboxed Code-Island (SPIKE → phase, USER SIGN-OFF GATE)** — Emit real code into an isolated sandbox (iframe/Sandpack/WebContainer) with a v0-style AST-validate/autofix/self-heal harness, for truly custom interactive widgets only; CHANGES the safety model from no-eval to jailed-eval — MUST NOT start without explicit user sign-off

## Phase Details

### Phase 16: Studio Foundation — Eval Harness + History & Page-Ideas Tabs

**Goal:** The eval harness exists FIRST (eval-driven development): a golden prompt set built from the real
user-prompt corpus, an LLM-as-judge UI-quality rubric, and a `studio` eval runner that scores generations
and records a baseline — so no Tier-A change ships without a measured before/after. Alongside it, two
near-term Studio tabs land over already-persisted data: a **History tab** (browse previous generations +
an individual detail view from `ui_spec_templates` + `genui_generation_events`, re-rendered through the
shared `SpecRenderer` in the 55/45 split) and a **Page-Ideas tab** (realistic curveball prompts seeded
from the REAL corpus — not AI-invented — to drive exploration).
**Depends on:** Phase 15 (the `/studio` surface, shared `SpecRenderer`, generation pipeline, and the
`ui_spec_templates` / `genui_generation_events` tables must already exist)
**Requirements:** EVAL-03, EVAL-04, EVAL-05, STDO-05, STDO-06, STDO-07, IDEA-01
**Status:** Planned (5 plans, 3 waves — 2026-06-27; W1 shared eval assets [16-01] + History backend/tRPC [16-03] in parallel -> W2 eval runner/rubric/judge/baseline [16-02] + Page-Ideas sampler/tab + studio-tabs lift [16-04] in parallel -> W3 History UI tab [16-05]. Eval-driven: this phase RECORDS the baseline, no hard CI gate this phase [D-13]. LOCAL/sandbox only, no deploy. Security gate ON: every plan carries a STRIDE <threat_model>; the no-AI-invented-prompts CI gate, the shared-renderer reuse [STDO-02], and importer-scoped read-only History each are verifiable acceptance criteria. 7/7 reqs covered.)
**Success Criteria** (what must be TRUE):
  1. A developer can run a single `studio` eval command that replays a golden prompt set (curated from `.planning/research/REAL-PROMPT-CORPUS.md`, with provenance preserved) through the live generation pipeline and produces a per-prompt + aggregate score.
  2. The eval grades each generation with an LLM-as-judge rubric covering at minimum: does it render (no fallback), is it composed-not-placeholder, is it on-intent, and does it pass a11y expectations — emitting a 0.0–1.0 score plus a pass/fail per criterion.
  3. The runner records a baseline score for the current engine and can be re-run to detect drift, so any later phase can show its lift/regression against that baseline.
  4. The History tab lists previous generations (intent, outcome, cache-hit, timestamp) from the persisted tables and opens an individual generation in a detail view that re-renders the stored spec via the shared production `SpecRenderer` beside its spec JSON.
  5. The Page-Ideas tab surfaces realistic curveball prompts seeded from the real corpus (e.g. the soundscape mixer, Bloomberg-terminal, 3D configurator, bill-splitter) and lets a developer send one straight into the generation sandbox.
**Plans:** 1/5 plans executed

Plans:
**Wave 1**
- [x] 16-01-PLAN.md — Shared eval assets: golden-set.json (~36 curated subset) + page-ideas.json (all 76 real corpus prompts, provenance) + one Zod schema + CI provenance/coverage gate + ./eval export (EVAL-04, STDO-07, IDEA-01; D-01/02/03/19)
- [x] 16-03-PLAN.md — History backend: list_recent/find_by_id on UiSpecTemplateRepository + GET /v1/genui/history(+/{id}) + genui.historyList/historyById tRPC (proxy + SpecRootSchema.safeParse degrade) (STDO-05/06; D-14/15/16/17)
**Wave 2** *(depends on 16-01)*
- [ ] 16-02-PLAN.md — Eval harness: pure rubric.py (valid-spec/composed/a11y + weights 0.30/0.30/0.25/0.15) + judge_adapter (escalation model, single structured call) + run_eval.py (drives real GenerateUiSpecUseCase via create_container over the golden set) + report/compare + recorded baseline (autonomous:false — live-Bedrock baseline checkpoint) (EVAL-03/05; D-04..13)
- [ ] 16-04-PLAN.md — Page-Ideas tab: pure seedable pick-page-idea.ts (curveball 3x/Tier-B 2x/Tier-A 1x) + page-ideas-island (browse/filter + Surprise me) + studio-tabs lift (controlled Tabs + pendingIntent + History/Page-Ideas triggers) + sandbox initialIntent (autonomous:false — browser verify) (STDO-07, IDEA-01; D-20/21/06)
**Wave 3** *(depends on 16-03, 16-04)*
- [ ] 16-05-PLAN.md — History UI tab: history-island (newest-first paginated list + read-only detail via the SHARED SpecRendererIsland in the 55/45 split, STDO-02 reuse) wired into the studio-tabs History slot (autonomous:false — browser verify) (STDO-05/06; D-18)
**UI hint**: yes

### Phase 17: Tier A — Design-Token/Theme Layer + Style Packs + Assembly RAG

**Goal:** Generation is grounded in an explicit, machine-readable design system + **W3C-DTCG design tokens**
that vary per generation ("style packs"), plus retrieved exemplars injected before generation — v0's
"registry" method — so output stops always reading as default shadcn and instead varies by brand/style.
The win is measured: a demonstrable lift on the golden set versus the Phase-16 baseline.
**Depends on:** Phase 16 (the eval harness + baseline must exist to measure the lift; this phase is gated on it)
**Requirements:** STYLE-01, STYLE-02, STYLE-03, STYLE-04, RAG-01, RAG-02
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. The generator is conditioned on an explicit, machine-readable design-system + a W3C-DTCG-shaped token set (semantic color/type/spacing tokens, not free-form "navy blue") that the renderer consumes so the output reflects the chosen tokens.
  2. A small library of distinct "style packs" (token sets) exists and the engine can be told which to use (or pick one) so two generations of the same intent visibly differ in look-and-feel rather than both reading as generic shadcn.
  3. Before generation, relevant exemplars/components are retrieved and injected into the prompt (assembly RAG over the catalog + promoted templates), and the spec the model emits references the retrieved structure.
  4. Re-running the Phase-16 eval shows a measurable lift in the rubric's "composed-not-placeholder" / on-intent / style-distinctiveness scores versus the recorded baseline, with no a11y regression.
**Plans:** TBD
**UI hint**: yes

### Phase 18: Tier A — Catalog Expansion

**Goal:** The catalog gains real domain components — avatar, list/feed-item, nav, tabs, input primitives,
and similar — so generated compositions stop reading as a stack of generic cards and start resembling real
app surfaces. Built depth-first to the Phase-12 catalog rigor: each new entry is fully real, a11y-marked,
with a strict Zod prop schema, a CI-validated example, and registry registration.
**Depends on:** Phase 16 (eval gate) and Phase 17 (new components should honor the token/theme layer so they style with the active style pack)
**Requirements:** CTLG-06, CTLG-07, CTLG-08, CTLG-09
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. The catalog manifest gains real domain components (at minimum avatar, list/feed-item, nav, tabs, and input primitives), each a fully-real `@nauta/ui` component with a strict Zod prop schema and locked vs LLM-settable props — matching the Phase-12 manifest contract.
  2. Every new entry marks its accessibility props as required and ships a CI-verified example that parses against its own prop schema and renders a real component (not a fallback) through the shared renderer.
  3. Each new component is registered in `COMPONENT_REGISTRY`, the registry version bumps accordingly, and the existing cache-invalidation-on-version-change behavior continues to hold.
  4. Re-running the Phase-16 eval on prompts that previously degraded to generic cards (e.g. profile, feed, navigation prompts from the corpus) shows the new components being composed, with a measurable rubric lift over the Phase-17 score.
**Plans:** TBD
**UI hint**: yes

### Phase 19: Tier B-1 — Declarative JSON-Schema Form Engine

**Goal:** A new `form` node, backed by a schema-driven engine (react-jsonschema-form / JSONForms / Formily
style), expresses fields, conditional logic, and customizable validation/business rules **fully
declaratively — no eval**. This covers forms and complex form controls (the bulk of the corpus's Tier-B
interactivity: lead-capture, onboarding, invoice, leave-tracker, multi-step) inside the safe model, without
reaching for code-emit.
**Depends on:** Phase 16 (eval gate); composes with Phases 17–18 (the form should adopt the active style pack + new input primitives)
**Requirements:** FORM-01, FORM-02, FORM-03, FORM-04, FORM-05
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. A `form` spec node carries a JSON Schema (fields + types) and a UI schema (layout/widgets), and the interpreter renders it as a working form through a schema-driven engine — with no `eval`/`Function`/`dangerouslySetInnerHTML` on model output, preserving the zero-eval guarantee.
  2. The form supports conditional logic (show/hide/require fields based on other field values) expressed declaratively as data, not code.
  3. Validation and business rules (required, formats, ranges, cross-field constraints) are declarative and enforced at submit/change, surfacing inline field-level errors.
  4. Form submit binds only to the existing allowlisted action/mutation seam (SEAM-02) — no arbitrary endpoints — and a corpus form prompt (e.g. the client-onboarding or lead-capture prompt) generates and renders end-to-end in the sandbox.
  5. Re-running the Phase-16 eval on form-heavy corpus prompts shows them now rendering real interactive forms (pass) where they previously degraded, with a measurable rubric lift.
**Plans:** TBD
**UI hint**: yes

### Phase 20: Tier B-2 — Sandboxed Code-Island (SPIKE → phase, USER SIGN-OFF GATE)

**Goal:** For truly custom / arbitrarily-interactive widgets only (bespoke charts, novel interactions,
the corpus's curveballs — soundscape mixer, 3D configurator, real-time whiteboard), emit real code into an
**isolated sandbox** (iframe / Sandpack / WebContainer) running a v0-style harness (AST validate → autofix →
run → self-heal). The code-island runs jailed; it cannot regress the trusted declarative core.
**⚠️ SAFETY-MODEL CHANGE:** this phase changes the model from **no-eval to jailed-eval** and is the one
genuinely new high-risk subsystem. It **MUST NOT start without explicit user sign-off**, and should begin
as a **SPIKE** (prove the sandbox + repair loop in isolation) before being committed to as a full phase.
**Depends on:** Phase 16 (eval gate, incl. the adversarial-injection + a11y fixtures) and explicit USER SIGN-OFF; the declarative tiers (17–19) should be exhausted first so the island is reserved for what they genuinely cannot express
**Requirements:** CODE-01, EVAL-01, EVAL-02
**Status:** Not started (BLOCKED — requires user sign-off before planning)
**Success Criteria** (what must be TRUE):
  1. A spec can reference a code-island node whose generated code runs inside an isolated sandbox (iframe/Sandpack/WebContainer) that cannot touch the host page, the parent DOM, or app credentials — the trusted declarative core is provably unaffected if the island misbehaves.
  2. Generated island code passes through a v0-style harness — AST/parse validation → autofix → run → self-heal on runtime error — before it is shown, and code that cannot be repaired falls back to a safe placeholder rather than rendering broken or unsafe output.
  3. Adversarial-injection regression fixtures (EVAL-01) confirm that prompt/data injection cannot escape the sandbox or reach the trusted core, and these fixtures run as part of the eval harness.
  4. Automated a11y checks (axe-core, EVAL-02) run against generated UI — including island output — and surface violations in the eval rubric.
  5. A curveball corpus prompt that the declarative tiers cannot express (e.g. the soundscape mixer or 3D configurator) generates a working interactive widget in the sandbox, scored by the eval harness against the baseline.
**Plans:** TBD
**UI hint**: yes

## Progress Table (v1.2)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 16. Studio Foundation — Eval Harness + History & Page-Ideas Tabs | 2/5 | In Progress|  |
| 17. Tier A — Design-Token/Theme Layer + Style Packs + Assembly RAG | 0/0 | Not started | - |
| 18. Tier A — Catalog Expansion | 0/0 | Not started | - |
| 19. Tier B-1 — Declarative JSON-Schema Form Engine | 0/0 | Not started | - |
| 20. Tier B-2 — Sandboxed Code-Island (SPIKE → phase, USER SIGN-OFF GATE) | 0/0 | Not started (blocked: user sign-off) | - |
