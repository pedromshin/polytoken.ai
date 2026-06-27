# nauta.services.email-listener

## What This Is

A monorepo (mirroring acme-os-dev conventions) hosting Nauta services. The first service,
`apps/email-listener`, is a FastAPI server that receives and logs raw inbound emails — the
real-world entry point for the Nauta "Data-Entry Brain" design case (context/0). Deployed
to AWS ECS Fargate with staging (dev branch) and production (main branch) environments.

## Core Value

Reliably receive every inbound email destined for agent@magnitudetech.com.br and make it
observable — nothing lost, everything logged — as the foundation for later parsing,
persistence, and the agentic pipeline.

## Current Milestone: v1.1 Generative UI Engine

**Goal:** A runtime, spec-first generative-UI engine that, on the fly, generates web-page UI
(components, props, declared state, data bindings) from a constrained catalog of existing
`@nauta/ui` components, renders it through a trusted interpreter (Catalog → Spec → Registry →
Renderer, **no eval**), and caches good outputs. Built standalone in a new `packages/genui`
package consumed by a `/studio` route — separate from the Nauta product surfaces for now, but
integration-seamed so the two converge later.

**Target features (v1.1 = spine + exact cache; components 1–5 + 7 of the 8-component spine):**
- Component **catalog + registry**: machine-readable manifest of `@nauta/ui` (Zod prop schemas, slot rules, LLM-settable vs locked props, a11y-required props).
- **Spec schema + trusted interpreter**: typed discriminated-union JSON tree → real components via recursive `createElement`, error-boundaried, zero code execution.
- **Generation on Bedrock**: Haiku 4.5 via `streamText` + `Output.object` (Zod), repair loop, audit log.
- **Quarantine + guardrails**: dual-LLM quarantine (raw email never reaches the generator), three allowlists (components / tRPC procedures / actions), Zod `safeParse` on every output.
- **Exact (hash) cache + template store**: SHA-256 cache key incl. registry version; all generated specs persisted as the flywheel foundation.
- **`/studio` surface**: catalog browser + intent → generate → preview sandbox.

**Deferred to v1.2:** semantic template retrieval (BlendedRAG + RRF over promoted templates),
promotion/"what is good" loop, evals/regression harness, and the raw-TSX code-emit experiment
(sandboxed). Spec-first is the v1.1 spine; code-emit is a later, isolated experiment.

**Key context:** Reuses existing muscle — pgvector + Titan V1 (1536) + RRF(k=60) retrieval,
Bedrock IAM transport, tRPC + TanStack Query, and the [spreadsheet-grid](packages/ui/src/spreadsheet-grid/column-defs.ts)
`column-defs → type-keyed renderers` pattern, which is the Catalog→Registry→Renderer shape
already proven locally. Research: `.planning/research/` (SUMMARY.md + 6 deep docs, verified 2026-06-27).

## Requirements

### Validated

- ✓ FastAPI service + Clean Architecture, /v1/emails/inbound, Docker dev, quality gates — Phase 1
- ✓ AWS ECS Fargate (prod + staging) + shared ALB + GitHub OIDC CI/CD live; /health 200 both envs — Phase 2
- ✓ Live inbound email connection (forward → agent@magnitudetech.com.br → logged) — Phase 3
- ✓ Email intelligence: PDF parse (text+OCR) + LLM segmentation + region model + autofill + retrieval flywheel (Bedrock) — Phase 4
- ✓ Review UI: inbox + /emails/[id] document preview with entity-region overlays — Phase 5
- ✓ Region edit ops (accept/redraw/split/merge/nest/reject), versioned + supersede-safe — Phase 6
- ✓ Click-to-autofill UI: region → candidate fields + confidence → human confirm — Phase 7
- ✓ Trigram key_terms extractor activating the pg_trgm retrieval arm — Phase 8
- ✓ Entity/field region-relationship model + canvas review surface + app shell + glassy inbox + entity-type CRUD — Phase 9
- ✓ Extracted-entity identity, gallery (`/entities`) + detail (`/entities/[id]`) — Phase 10 (request-6 R3/R4)
- ✓ Knowledge-graph visualization (`/knowledge`) — Phase 11 (request-6 R6)

### Active

<!-- Milestone v1.1 — Generative UI Engine. See "Current Milestone" section + REQUIREMENTS.md. -->

- [ ] Component catalog + registry manifest for `@nauta/ui` (`packages/genui`)
- [ ] Spec schema + trusted interpreter (Catalog → Spec → Registry → Renderer, no eval)
- [ ] Bedrock generation layer (Haiku 4.5, `Output.object`, repair loop)
- [ ] Dual-LLM quarantine + three allowlists + Zod `safeParse` guardrails
- [ ] Exact (hash) cache + template store (flywheel foundation)
- [ ] `/studio` surface (catalog browser + generation sandbox)

### Out of Scope

- Per-importer entity-type overrides (system-default types only, Phase 9)
- Server-side deny-restore endpoint (optimistic-only undo today — Phase 9 follow-up)
- Real auth boundary (X-API-Key is installation-wide; importer_id is data partitioning, not auth)

## Context

- Conventions copied from examples/acme-os-dev (apps/api FastAPI server, infrastructure
  Terraform, monorepo layout). Tooling: uv, ruff (120 cols), mypy, pytest, import-linter.
- Walkthrough: context/5 - walkthrough.md. Design case: context/0 - nauta_design_case.pdf.
- Webhook is provider-agnostic by decision; SES→S3→SQS is the expected eventual edge.

## Constraints

- **Tech stack**: Python 3.11 FastAPI, Docker, Terraform, GitHub Actions — mirrors acme-os
- **Deploy**: AWS ECS Fargate (user-confirmed pattern); dev→staging, main→production
- **Security**: secrets via AWS Secrets Manager; API key auth fails closed outside development

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ECS Fargate over App Runner/Lambda | User-confirmed production pattern; natural substrate for future queue/worker topology | — Pending |
| Generic webhook (not SES-shaped) | Provider-agnostic now; SES wiring is a stage-3 concern | — Pending |
| Full 4-layer Clean Architecture skeleton | User preference; matches apps/api for consistency | — Pending |
| Monorepo layout with placeholder apps/packages | Repo must mirror acme-os-dev broader structure | — Pending |
| Shared ALB, staging on :8080 | Cheapest two-env setup pre-domain; move to 443 host routing later | — Pending |
| **v1.1**: Spec-first (no eval) over raw-TSX code-emit at runtime | Catalog→Spec→Registry→Renderer is the ecosystem-convergent, attacker-safe path; code-emit deferred to a sandboxed experiment | — Pending |
| **v1.1**: Engine as `packages/genui` + thin `/studio` route | Reusable boundary for the "separate now, same product later" convergence; reuses tRPC + @nauta/ui | — Pending |
| **v1.1**: Haiku 4.5 runtime / Sonnet 4.6 escalation via Bedrock | Cheapest/fastest model adequate for constrained spec generation; Bedrock IAM transport (no API key) | — Pending |
| **v1.1**: Reuse pgvector + Titan V1 (1536) + RRF for the flywheel | Existing entity-resolution retrieval muscle; exact-cache in v1.1, semantic retrieval/promotion in v1.2 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-27 — started milestone v1.1 (Generative UI Engine); Phases 10–11 moved to Validated*
