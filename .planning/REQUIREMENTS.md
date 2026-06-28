# Requirements: nauta.services.email-listener

**Defined:** 2026-06-10
**Core Value:** Reliably receive every inbound email and make it observable.

## v1 Requirements

### Service (SRVC)

- [x] **SRVC-01**: Service exposes GET /health (liveness) and /health/ready (readiness)
- [x] **SRVC-02**: POST /v1/emails/inbound accepts a raw email payload and returns 202
- [x] **SRVC-03**: Received emails are logged structurally (sender, recipients, subject, sizes, attachments metadata)
- [x] **SRVC-04**: Endpoint requires X-API-Key when API_KEY is configured; fails closed in staging/production
- [x] **SRVC-05**: Clean Architecture layers enforced by import-linter

### Developer Experience (DEVX)

- [x] **DEVX-01**: Fresh clone + Docker → `npm run dev` runs the server on localhost:8000
- [x] **DEVX-02**: Quality gates runnable locally and in CI (ruff, mypy, import-linter, bandit, pytest 80%)

### Infrastructure (INFRA)

- [x] **INFRA-01**: Terraform provisions ECR, ECS Fargate cluster + prod/staging services, ALB, IAM (OIDC)
- [x] **INFRA-02**: Push to dev deploys staging; push to main deploys production
- [x] **INFRA-03**: Deploys are gated by tests, Trivy image scan, and post-deploy /health smoke test
- [x] **INFRA-04**: GitHub repository created; AWS_DEPLOY_ROLE_ARN + health URL vars configured

## v2 Requirements

### Email Connection (EMAIL)

- [x] **EMAIL-01**: agent@magnitudetech.com.br forwards full inbound emails to the service (SES inbound or equivalent)
- [x] **EMAIL-02**: Durable receipt path (S3 + SQS) so no email is lost or double-processed

## Milestone v1.1 Requirements — Generative UI Engine

**Defined:** 2026-06-27 · **Scope:** spine + exact cache (8-component spine: 1–5 + 7).
**Core value (this milestone):** Generate and render a working UI on the fly from a constrained
catalog — safely (no eval, no injection) and reusably (cache good specs). Research: `.planning/research/SUMMARY.md`.

### Component Catalog & Registry (CTLG)

- [x] **CTLG-01**: A machine-readable manifest describes each whitelisted `@nauta/ui` component with a Zod prop schema, slot/children rules, and which props are LLM-settable vs locked
- [x] **CTLG-02**: Manifest entries mark accessibility props (label/caption/alt) as required so a spec omitting them fails validation
- [x] **CTLG-03**: A static registry maps each spec type-key to its real React component; only registered components can be rendered
- [x] **CTLG-04**: Each manifest entry carries an example that is CI-verified to parse against its own prop schema
- [x] **CTLG-05**: The registry exposes a version identifier consumed downstream for cache invalidation

### Spec Schema & Interpreter (SPEC)

- [x] **SPEC-01**: A typed (Zod) discriminated-union spec describes a UI tree (layout, leaf components, lists, conditionals) referencing only registry components
- [x] **SPEC-02**: A recursive interpreter renders a valid spec into live `@nauta/ui` components via `createElement` with no `eval`/`Function`/`dangerouslySetInnerHTML` on model output
- [x] **SPEC-03**: Each rendered node is wrapped in an error boundary so one malformed node cannot crash the surface
- [x] **SPEC-04**: Declared state primitives (name/type/initial/actions) are materialized into a store by the interpreter; the spec contains no executable code
- [x] **SPEC-05**: Data/state references resolve via safe dotted-path lookup against a provided scope (no `eval`)
- [x] **SPEC-06**: A hardcoded sample spec renders correctly end-to-end, proving the interpreter before generation is wired

### Generation Layer (GEN)

- [x] **GEN-01**: Given an intent, the engine calls Bedrock (Haiku 4.5) via `streamText` + `Output.object` to emit a spec constrained to the registry
- [x] **GEN-02**: Model output is validated with Zod `safeParse`; invalid output triggers a bounded repair loop (≤3 attempts) that feeds the validation error back
- [x] **GEN-03**: On repeated failure the engine returns a safe fallback spec — never raw model output
- [ ] **GEN-04**: Generation streams partial specs for progressive preview
- [x] **GEN-05**: Every generation (intent, model, tokens, outcome) is recorded to an audit log
- [x] **GEN-06**: Generation can escalate to Sonnet 4.6 when the runtime model cannot produce a valid spec

### Safety & Guardrails (SAFE)

- [x] **SAFE-01**: Untrusted content (e.g. email) is processed by a separate quarantine/extraction model with a constrained schema; raw prose never reaches the generator
- [x] **SAFE-02**: The spec schema enforces a component allowlist (only registry keys are valid)
- [x] **SAFE-03**: Data bindings are restricted to an allowlist of tRPC procedures; arbitrary data sources fail validation
- [x] **SAFE-04**: Actions are restricted to an allowlist (navigate-relative-only / allowlisted mutate / setState); `javascript:` and external URLs fail validation
- [x] **SAFE-05**: Every Bedrock call sets explicit `max_tokens` and an `AbortController` timeout (application-level circuit breaker)
- [x] **SAFE-06**: Spec tree depth and node count are bounded to prevent resource exhaustion

### Exact Cache & Template Store (CACHE)

- [x] **CACHE-01**: A persisted template store (Drizzle/Postgres) holds every generated spec with metadata (intent, registry version, validation status)
- [x] **CACHE-02**: A SHA-256 key over (canonical intent + data-shape + registry version + context) yields exact-match cache hits that skip the LLM
- [x] **CACHE-03**: A cache hit re-renders the stored spec with live data re-bound and no Bedrock call
- [x] **CACHE-04**: A registry-version change invalidates affected cache keys automatically (no manual flush)

### Studio Surface (STDO)

- [x] **STDO-01**: A `/studio` route (in `apps/web`, backed by `packages/genui`) lets a developer browse the component catalog
- [x] **STDO-02**: A developer can enter an intent and see the generated UI rendered live in a preview sandbox
- [x] **STDO-03**: The studio shows the underlying spec (JSON) alongside the rendered output for inspection
- [x] **STDO-04**: The studio surfaces generation states: streaming, validation-failure + fallback, and cache-hit vs cold-generation

### Cost & Token Efficiency (COST)

- [x] **COST-01**: The catalog/system prompt is cached via Bedrock prompt caching (`cachePoint`); per-request input carries only the intent + data-shape
- [x] **COST-02**: The spec JSON schema is kept stable (no recursion / external `$ref`) so Bedrock reuses its compiled grammar across requests, raising first-pass validity and cutting repair loops
- [x] **COST-03**: The catalog is encoded compactly for the model, with candidate-component subsetting once the catalog exceeds a size threshold (send relevant components, not all of them)

### Future-proofing seams (build empty, document — v1.1)

These are *design constraints* on the above, not extra build — they keep v1.2 (interactivity, API-write, tenant catalogs, the flywheel) a drop-in rather than a refactor:

- [x] **SEAM-01**: The spec envelope carries a `v` (version) field so the node grammar can grow without breaking cached specs
- [x] **SEAM-02**: The binding/action layer is shaped for both **queries and mutations** from day one (v1.1 wires queries only; the mutation allowlist path exists but is empty)
- [x] **SEAM-03**: The catalog + cache key are **per-catalog-id capable** (one global catalog in v1.1; tenant/importer-scoped catalogs later)

## Milestone v1.2 Requirements — Generative UI: Realism & Interactivity

**Defined:** 2026-06-27 · **Status:** planning · **Scope:** LOCAL + `/studio` sandbox only (no deploy, no
product convergence). **Architecture decided = HYBRID** (declarative spec + declarative JSON-Schema form
engine + sandboxed code-island). Source of truth: `.planning/research/GENUI-VNEXT-RESEARCH.md` +
`.planning/research/REAL-PROMPT-CORPUS.md`.
**Core value (this milestone):** Generations read as *real, custom-styled, interactive* apps — measured by
an eval harness built first (eval-driven development), not vibes.
**Process gate:** the eval harness (EVAL-03/04/05) lands first; every Tier-A change (Phases 17–18) and the
form engine (Phase 19) is measured against the recorded baseline. Tier B-2 (CODE-01) is fenced behind a
SPIKE + explicit user sign-off (it changes the safety model from no-eval to jailed-eval).

### Evaluation Harness (EVAL) — *eval-driven development; built first*

- **EVAL-03**: Eval rubric + drift detection for generation quality — an LLM-as-judge UI-quality rubric (renders / composed-not-placeholder / on-intent / a11y) emitting a 0.0–1.0 score + pass/fail per criterion *(promoted from v1.1 deferral)*
- **EVAL-04**: A golden prompt set curated from the real user-prompt corpus (`REAL-PROMPT-CORPUS.md`, provenance preserved) that the eval replays through the live generation pipeline
- **EVAL-05**: A `studio` eval runner scores generations against the golden set, records a baseline for the current engine, and is re-runnable so later phases can show measurable lift/regression
- **EVAL-01**: Adversarial-injection regression fixtures for the quarantine/guardrails — run as part of the eval harness; confirm injection cannot escape the sandbox or reach the trusted core *(promoted; folded into Phase 20)*
- **EVAL-02**: Automated a11y checks (axe-core) on generated UI — including code-island output — surfaced in the eval rubric *(promoted; folded into Phase 20)*

### Studio Surface — History & Page-Ideas (STDO, continued)

- **STDO-05**: A History tab lists previous generations (intent, outcome, cache-hit, timestamp) from the persisted `ui_spec_templates` + `genui_generation_events` data (FastAPI list → tRPC proxy)
- **STDO-06**: An individual generation detail view re-renders the stored spec via the shared production `SpecRenderer` beside its spec JSON (55/45 split), reusing the existing renderer — no second renderer
- **STDO-07**: A Page-Ideas tab surfaces realistic curveball prompts seeded from the real corpus (not AI-invented) and can send one straight into the generation sandbox

### Page Ideas (IDEA)

- **IDEA-01**: The page-ideas seed is sourced from `REAL-PROMPT-CORPUS.md` (real prompts with provenance), not synthetic/AI-invented prompts

### Design Tokens & Style Packs (STYLE) — *Tier A*

- **STYLE-01** ✓ (Phase 17-01): The generator is conditioned on an explicit, machine-readable design system + a W3C-DTCG-shaped token set (semantic color/type/spacing tokens, not free-form descriptions) that the renderer consumes
- **STYLE-02** ✓ (Phase 17-01): A library of distinct "style packs" (token sets) exists; the engine can be told which to use (or pick one) so two generations of the same intent visibly differ in look-and-feel
- **STYLE-03** ✓ (Phase 17-01): Token specificity is enforced (semantic hex/aliases over prose like "navy blue") so the model picks from existing aliases rather than substituting its own defaults
- **STYLE-04**: A measurable lift on the golden set (style-distinctiveness / composed-not-placeholder) versus the Phase-16 baseline, with no a11y regression

### Assembly RAG (RAG) — *Tier A*

- **RAG-01** ✓ (Phase 17-04): Before generation, relevant exemplars/components are retrieved and injected into the prompt (assembly RAG over the catalog + promoted templates) — v0's "registry" pattern
- **RAG-02** ✓ (Phase 17-04): The emitted spec references the retrieved structure (retrieval demonstrably influences generation, not inert context)

### Catalog Expansion (CTLG, continued) — *Tier A*

- **CTLG-06**: Real domain components added to the catalog (at minimum avatar, list/feed-item, nav, tabs, input primitives) as fully-real `@nauta/ui` components with strict Zod prop schemas + locked vs LLM-settable props (Phase-12 manifest rigor)
- **CTLG-07**: Every new entry marks a11y props as required and ships a CI-verified example that parses against its own schema AND renders a real component (not a fallback) through the shared renderer
- **CTLG-08**: Each new component is registered in `COMPONENT_REGISTRY`; the registry version bumps and existing cache-invalidation-on-version-change continues to hold
- **CTLG-09**: New components honor the Phase-17 token/theme layer (style with the active style pack)

### Declarative Form Engine (FORM) — *Tier B-1, no eval*

- **FORM-01**: A `form` spec node carries a JSON Schema (fields + types) + a UI schema (layout/widgets); the interpreter renders a working form via a schema-driven engine (RJSF/JSONForms/Formily-style) with NO eval/Function/dangerouslySetInnerHTML on model output
- **FORM-02**: Conditional logic (show/hide/require fields based on other fields) expressed declaratively as data, not code
- **FORM-03**: Validation + business rules (required, formats, ranges, cross-field constraints) are declarative and enforced at change/submit with inline field-level errors
- **FORM-04**: Form submit binds only to the existing allowlisted action/mutation seam (SEAM-02) — no arbitrary endpoints
- **FORM-05**: A corpus form prompt (e.g. client-onboarding / lead-capture) generates and renders a real interactive form end-to-end in the sandbox; measurable rubric lift on form-heavy corpus prompts

### Code-Emit / Sandboxed Island (CODE) — *Tier B-2, jailed-eval; USER SIGN-OFF GATE*

- **CODE-01**: Sandboxed code-island generation path — emit real code into an isolated sandbox (iframe/Sandpack/WebContainer) with a v0-style AST-validate → autofix → run → self-heal harness, jailed so it cannot regress the trusted declarative core; falls back to a safe placeholder when unrepairable *(promoted from v1.1 deferral; changes the safety model from no-eval to jailed-eval — MUST NOT start without explicit user sign-off; recommend a SPIKE first)*

## Future Requirements (still deferred beyond v1.2)

### Template Flywheel (FLY)

- **FLY-01**: Semantic retrieval of promoted templates (Bedrock embeddings + BlendedRAG + RRF over pgvector)
- **FLY-02**: Promotion loop — generated specs become reusable templates based on validation + acceptance signals
- **FLY-03**: Parameterized templates with binding slots re-bound to live data on reuse

> Note: v1.2 RAG-01/02 (assembly retrieval over the catalog + promoted templates) is the lightweight,
> local precursor to the full FLY flywheel; FLY-01..03 (embeddings/promotion/parameterization) remain
> deferred until real usage data + the deploy path exist.

### Generation (GEN, continued)

- **GEN-04**: Generation streams partial specs for progressive preview *(deferred from v1.1; not in v1.2 scope)*

### Cost (deferred)

- **COST-04**: Spec edits emit JSON-Patch (RFC-6902) deltas instead of full regeneration; offline batch pre-warming of templates (Bedrock batch, 50% off) *(needs the deploy path; out of the local-only v1.2 scope)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| Email parsing/classification | Walkthrough stage 3+; service is passive listener for now |
| Persistence/storage | Later stage |
| web app, packages content | Placeholders until needed |
| Runtime raw-TSX code execution (no sandbox) | Categorically unsafe with model output; spec-first (no eval) is the v1.1 spine, sandboxed code-emit is a v1.2 experiment (CODE-01) |
| Wiring the engine into Nauta's real review surfaces | v1.1 is standalone-in-`/studio` by decision; integration-seamed but not wired until convergence |
| Semantic template retrieval / promotion / evals | Deferred to v1.2 (FLY/EVAL) — needs the exact-cache foundation + real usage data first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRVC-01..05 | Phase 1 | Complete |
| DEVX-01..02 | Phase 1 | Complete |
| INFRA-01..04 | Phase 2 | Complete (ECS Fargate live; staging :8080 + prod :80 /health 200) |
| EMAIL-01..02 | Phase 3 | Complete (verified live end-to-end 2026-06-11) |
| CTLG-01..05 | Phase 12 | Complete |
| SPEC-01..06 | Phase 12 | Complete |
| SEAM-01 | Phase 12 | Complete |
| SEAM-03 | Phase 12 | Complete |
| COST-02 | Phase 12 | Complete |
| COST-03 | Phase 12 | Complete |
| GEN-03 | Phase 13 plan 01 | Complete (SAFE_FALLBACK_SPEC) |
| GEN-01,02,05,06 | Phase 13 plans 02-04 | Complete (GEN-04 streaming deferred to v1.2) |
| SAFE-02,03,04,06 | Phase 13 plan 01 | Complete (allowlists at Zod layer) |
| SAFE-01,05 | Phase 13 plans 02-04 | Complete |
| COST-01 | Phase 13 plan 01 | Complete (genui-prompt.json cache payload) |
| SEAM-02 | Phase 13 plan 01 | Complete (ALLOWED_MUTATIONS empty seam) |
| CACHE-01..04 | Phase 14 | Complete |
| STDO-01..04 | Phase 15 | Complete (browser visual verify deferred) |
| EVAL-03,04,05 | Phase 16 | Planned |
| STDO-05,06 | Phase 16 plan 03 | In Progress (data spine complete: list_recent+find_by_id repo, FastAPI GET /history+/{id}, tRPC historyList+historyById; UI tab rendering in plan 05) |
| STDO-07 | Phase 16 | Planned |
| IDEA-01 | Phase 16 | Planned |
| STYLE-01..04 | Phase 17 | Planned |
| RAG-01,02 | Phase 17 | Planned |
| CTLG-06..09 | Phase 18 | Planned |
| FORM-01..05 | Phase 19 | Planned |
| CODE-01 | Phase 20 | Planned (blocked: user sign-off) |
| EVAL-01,02 | Phase 20 | Planned |

**Coverage:** v1: 11 total + v2 EMAIL: 2 = 13 mapped (Complete) + v1.1: 36 mapped Complete + GEN-04 streaming deferred to v1.2; v1.2: 24 mapped (Planned: EVAL-01..05, STDO-05..07, IDEA-01, STYLE-01..04, RAG-01,02, CTLG-06..09, FORM-01..05, CODE-01) across Phases 16–20, unmapped: 0 ✓
**Note:** Phases 4–8 (Email Intelligence backend, Review UI, region edit ops,
click-to-autofill UI, key_terms extractor) are **decision-driven** — scoped via
each phase's CONTEXT.md D-IDs, no REQ-IDs mapped (per ROADMAP). Verified via
per-phase VERIFICATION.md (4 + 8 passed; 5/6/7 human_needed — visual UAT only).

---
*Requirements defined: 2026-06-10*
*Last updated: 2026-06-27 — added milestone v1.1 (Generative UI Engine): CTLG/SPEC/GEN/SAFE/CACHE/STDO/COST (32 reqs) + SEAM-01..03 future-proofing constraints; v1.2 deferrals FLY/EVAL/CODE/COST-04. Traceability for v1.1 filled by roadmap (Phases 12–15).*
*Last updated: 2026-06-27 — added milestone v1.2 (Generative UI: Realism & Interactivity, status: planning, local+sandbox only): EVAL-03/04/05 + STDO-05/06/07 + IDEA-01 + STYLE-01..04 + RAG-01/02 + CTLG-06..09 + FORM-01..05; promoted CODE-01 + EVAL-01/02 from v1.1 deferrals (CODE-01 gated on user sign-off). Traceability for v1.2 filled by roadmap (Phases 16–20). FLY/COST-04 + GEN-04 remain deferred.*
