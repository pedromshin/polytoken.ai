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

## Future Requirements (v1.2 — deferred this milestone)

### Template Flywheel (FLY)

- **FLY-01**: Semantic retrieval of promoted templates (Bedrock embeddings + BlendedRAG + RRF over pgvector)
- **FLY-02**: Promotion loop — generated specs become reusable templates based on validation + acceptance signals
- **FLY-03**: Parameterized templates with binding slots re-bound to live data on reuse

### Evaluation (EVAL)

- **EVAL-01**: Adversarial-injection regression fixtures for the quarantine/guardrails
- **EVAL-02**: Automated a11y checks (axe-core) on generated UI
- **EVAL-03**: Eval rubric + drift detection for generation quality

### Code-Emit Experiment (CODE)

- **CODE-01**: Sandboxed raw-TSX generation path (isolated iframe/worker) compared against the spec-first spine

### Cost (v1.2 — deferred)

- **COST-04**: Spec edits emit JSON-Patch (RFC-6902) deltas instead of full regeneration; offline batch pre-warming of templates (Bedrock batch, 50% off)

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

**Coverage:** v1: 11 total + v2 EMAIL: 2 = 13 mapped (Complete) + v1.1: 36 mapped Complete + GEN-04 streaming deferred to v1.2 = 50 total, unmapped: 0 ✓
**Note:** Phases 4–8 (Email Intelligence backend, Review UI, region edit ops,
click-to-autofill UI, key_terms extractor) are **decision-driven** — scoped via
each phase's CONTEXT.md D-IDs, no REQ-IDs mapped (per ROADMAP). Verified via
per-phase VERIFICATION.md (4 + 8 passed; 5/6/7 human_needed — visual UAT only).

---
*Requirements defined: 2026-06-10*
*Last updated: 2026-06-27 — added milestone v1.1 (Generative UI Engine): CTLG/SPEC/GEN/SAFE/CACHE/STDO/COST (32 reqs) + SEAM-01..03 future-proofing constraints; v1.2 deferrals FLY/EVAL/CODE/COST-04. Traceability for v1.1 filled by roadmap (Phases 12–15).*
