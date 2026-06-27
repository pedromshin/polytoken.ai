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

- [ ] **Phase 12: Catalog, Spec Schema, and Trusted Interpreter** — The vocabulary contract plus a hardcoded end-to-end render — the first demoable artifact before generation exists
- [ ] **Phase 13: Generation Layer and Guardrails** — Bedrock Haiku 4.5 generation pipeline with dual-LLM quarantine, three allowlists, repair loop, and cost controls wired together
- [ ] **Phase 14: Exact Cache and Template Store** — SHA-256 exact-match cache backed by Drizzle/Postgres, with auto-invalidation on registry version change
- [ ] **Phase 15: Studio Surface** — `/studio` route: catalog browser, generation sandbox, spec inspector, and generation-state indicators

## Phase Details

### Phase 12: Catalog, Spec Schema, and Trusted Interpreter

**Goal:** The vocabulary contract is established and a hardcoded spec renders live `@nauta/ui` components in `/studio` with zero eval — the first observable, demoable artifact before the generation layer is wired.
**Depends on:** Phase 11 (existing monorepo shell and `packages/` layout)
**Requirements:** CTLG-01, CTLG-02, CTLG-03, CTLG-04, CTLG-05, SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, SPEC-06, SEAM-01, SEAM-03, COST-02, COST-03
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. A developer can read the `packages/genui` catalog manifest and see every whitelisted `@nauta/ui` component with its Zod prop schema, slot rules, LLM-settable vs locked props, and an a11y-required prop marker — and every example in the manifest passes CI validation against its own schema.
  2. A hardcoded sample spec (manually authored JSON with `v: 1` envelope) renders as real `@nauta/ui` components in `/studio/preview` via `createElement` with no `eval`, `Function`, or `dangerouslySetInnerHTML` anywhere in the renderer path.
  3. One malformed node in a spec does not crash the surface — the error boundary isolates it and sibling nodes continue rendering.
  4. Declared state primitives in the spec (name / type / initial / actions) are materialized into a store by the interpreter, and dotted-path data references resolve via safe lookup against the provided scope — no executable code in the spec.
  5. The registry exposes a version identifier, and the spec envelope carries a `v` field and a per-catalog-id capability so downstream cache keys and future tenant catalogs slot in without schema changes.
**Plans:** TBD
**UI hint**: yes

---

### Phase 13: Generation Layer and Guardrails

**Goal:** A tRPC procedure accepts an intent and returns a validated, safety-checked spec via Bedrock Haiku 4.5 — with dual-LLM quarantine ensuring raw untrusted content never reaches the generator, three allowlists enforcing the component/procedure/action surface, a bounded repair loop on invalid output, and cost controls active from the first call.
**Depends on:** Phase 12 (catalog, spec schema, and registry must exist before generation can target them)
**Requirements:** GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, COST-01, SEAM-02
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. Submitting an intent via the tRPC procedure triggers a Bedrock Haiku 4.5 call constrained to the registry schema via `Output.object`; if output is invalid Zod `safeParse` triggers a repair loop (max 3 attempts feeding the error back), and on persistent failure the procedure returns a safe fallback spec — never raw model output.
  2. Untrusted content (e.g. email body) passes through a separate quarantine Bedrock call with an enum-constrained extraction schema before any structured data reaches the generator; the generator never sees raw prose.
  3. A spec referencing an unregistered component type, a non-allowlisted tRPC procedure, or a non-relative action href fails Zod validation and is rejected before reaching the renderer.
  4. Every Bedrock call carries an explicit `max_tokens` limit and an `AbortController` timeout; every generation event (intent, model, tokens, outcome) is written to the audit log; spec tree depth and node count are bounded by the schema.
  5. The system prompt (catalog + examples) is cached via Bedrock `cachePoint` so per-request input carries only intent + data-shape; the binding/action layer schema has both query and mutation paths defined (v1.1 wires queries only; the mutation path exists but is empty).
**Plans:** TBD

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
**Plans:** TBD

---

### Phase 15: Studio Surface

**Goal:** A developer can open `/studio`, browse the full component catalog, enter a natural-language intent, see the generated UI rendered live in a preview sandbox alongside the underlying spec JSON, and observe generation states (streaming, validation failure + fallback, cache-hit vs cold) — all in one surface.
**Depends on:** Phase 14 (full spine must be wired: catalog → generation → cache → render)
**Requirements:** STDO-01, STDO-02, STDO-03, STDO-04
**Status:** Not started
**Success Criteria** (what must be TRUE):
  1. A developer navigating to `/studio` sees a browseable catalog of all whitelisted `@nauta/ui` components, each with its prop schema, slot rules, and rendered example.
  2. Entering an intent in the studio's generation sandbox produces a live rendered UI preview backed by the same `packages/genui` `SpecRenderer` and `COMPONENT_REGISTRY` used in production — not a separate or stub renderer.
  3. The spec JSON that produced the rendered output is visible alongside the preview for inspection, so a developer can confirm the interpreter is rendering what the model emitted.
  4. The studio surface visibly distinguishes four generation states: in-progress streaming, validation-failure + fallback, cache-hit (zero LLM cost), and cold generation — so a developer can observe the full engine behavior without external tooling.
**Plans:** TBD
**UI hint**: yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 12. Catalog, Spec Schema, and Trusted Interpreter | 0/TBD | Not started | - |
| 13. Generation Layer and Guardrails | 0/TBD | Not started | - |
| 14. Exact Cache and Template Store | 0/TBD | Not started | - |
| 15. Studio Surface | 0/TBD | Not started | - |
