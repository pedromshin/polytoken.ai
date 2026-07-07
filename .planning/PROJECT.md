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

## Current State (v1.4 shipped 2026-07-07)

**Shipped:** **v1.4 — Chat & Studio Design Uplift** (Phases 26–28, 15 plans, 23/23 requirements).
`/chat` + `/studio`'s hand-built chrome now fully honors the app's own design contracts — zero new
npm dependencies: token-styled React Flow chrome, differentiated canvas nodes (teal ChatNode stripe),
assistant role rail, composer dock, one scrollbar aesthetic, shared JsonPane/EmptyState/FileTree/
GeneratingRing primitives, `font-medium` purged at the design-system source (incl. tabs/sidebar
primitive leaks caught at milestone audit), 3 hand-authored reveal transitions (transitions.dev copy
was license-blocked — clean-room reimplementation from locked timing values), hue-164 neutral +
teal-anchored chart/sidebar token rebase, elevation shadow scale, xl/2xl radius steps, mount/stagger
entrances, and `docs/design/` (impeccable-derived product-register + bans appendix, 3 ux reference
docs). Two committed regression gates replace the old token-count check (WCAG-AA contrast; token
family registration). Backlog 999.8(a)+999.9 folded and fixed (generator dataRef prompt; dagre
nodesep). Live-testing fixes shipped same-day: chat output cap 4096→12000 (truncated emit_ui_spec
tool calls silently dropped — salvage/surface todo filed), globals.css comment self-termination
build break. Audit `tech_debt`: deferred items are browser/OS visual checks only.

**Next:** run `/gsd:new-milestone`. Candidates: **999.4 Design Engine** (DSGN-01..04), **999.5
Orchestration Visualizer** (ORCH-01), **999.7 editable genui panels / studio-on-canvas**, the
anticipatory-prompting go/no-go follow-through, and **999.3 connected-env verification** (live
Bedrock + browser).

<details>
<summary>v1.4 original milestone goal (opened 2026-07-06)</summary>

**Goal:** A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome
(backlog 999.6, UPLIFT-01..03) — zero new npm dependencies, executing the pre-baked 3-phase punch
list in `.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md` (zero-dep contract fixes → narrowly
adopted external picks → design-system token upgrades).

**Target features:**
- Zero-dependency contract fixes: style React Flow's stock chrome with app tokens, purge
  `font-medium` at the source (`buttonVariants`) + 11 studio call-sites, replace Studio's 3
  hardcoded amber/red color systems with tokens (dark-mode safe), differentiate ChatNode vs
  GenuiPanelNode chrome, consolidate the 3 raw-JSON panes, restyle the catalog prop table, add
  hover/transition affordances, assistant-role chrome + composer dock, scrollbar normalization,
  differentiated empty states
- Adopted external picks (near-zero footprint): impeccable.style product-register rules + 13-item
  absolute-bans list into UI-SPEC as an appendix, Magic UI `file-tree` port (zero new deps),
  hand-ported teal-only `<GeneratingRing>` CSS technique, 3 `ux-designer-skill` reference files,
  3-4 retokenized `transitions.dev` CSS snippets
- Design-system token upgrades: tonally differentiate `secondary`/`muted`/`accent`, rebase
  `chart-1..5` + `sidebar-*` off the teal primary, real shadow scale, `xl`/`2xl` radius steps
  (fix card.tsx hardcode), put installed `tailwindcss-animate` to work (entrance/stagger)
- Folded backlog polish: 999.8(a) generator-prompt fix for declared-state display binding
  (emit `dataRef`-bound nodes, not `{{mustache}}` text), 999.9 canvas auto-layout default
  direction (avoid cramped vertical stacking)

**Key context:** Selected autonomously per the user's standing directive — backlog 999.6 was
explicitly queued to start "only once v1.3 fully ships" (shipped 2026-07-06). Research is
pre-baked and locked (`CHAT-STUDIO-DESIGN-UPLIFT.md`, 2026-07-05): 5 external-resource verdicts,
code-level audit, phase ordering A→B→C. Hard constraints: teal `primary` only, 2-weight
typography, 4-role type scale, 8-pt spacing, 60/30/10 color discipline, **zero new npm
dependencies**. 999.8(b) (renderer affordance for declared-state text) is explicitly out of
scope — it touches the locked renderer.

</details>

## Prior State (v1.3 shipped 2026-07-06)

**Shipped:** **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25). The genui
engine now has a conversational surface: a persistent, streamed `/chat` (typed message parts, cost
circuit breaker, regenerate-as-siblings, progressive partial-tree spec rendering, multi-provider
registry incl. a WebGPU in-browser model) laid out on a **2D infinite canvas** of genui
panels-as-nodes (React Flow, versioned node registry, per-chat shared-state store + data-carrying
edges, exact layout persistence) with a **dual-channel** agent↔user widget round-trip (proposal
cards + clarify-widgets, server-re-validated + DB-CAS double-submit-locked + staleness-signaled,
persisted in history and canvas). Phase 25 was a scoped **anticipatory-prompting SPIKE** — a real
but flag-OFF trigger→appropriateness-eval→frequency-cap→explicit-accept pipeline concluding
**ship-with-conditions** (`25-SPIKE-FINDINGS.md`, 7 named seams). `SpecRenderer` stayed UNMODIFIED
through all four phases. Local/sandbox only. Audit `tech_debt`, 24/24 requirements satisfied +
cross-phase integration verified WIRED; 6 connected-env/browser verifications deferred
(STATE.md → Deferred Items).

*(v1.3's "Next" candidates resolved: 999.6 became v1.4, shipped 2026-07-07 — see Current State.
Remaining candidates carried forward: 999.4 Design Engine, 999.5 Orchestration Visualizer,
anticipatory-prompting go/no-go. Research base: `.planning/research/v1.3/V1.3-RESEARCH-SYNTHESIS.md`.)*

## Prior State (v1.2 shipped 2026-07-03)

**Shipped:** **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) archived. The genui engine
is now a **hybrid**: the reliable spec-first declarative core (v1.1) + design-token **style packs**, an
expanded catalog, a **zero-eval declarative form engine**, and a **jailed-eval sandboxed code-island**
(iframe opaque-origin jail + AST allowlist + v0 repair loop) that generates *any* design from a prompt —
verified working live on Bedrock, with parallel multi-candidate + LLM-judge for quality. Cost-guarded
($30 AWS budget alert; conservative defaults; manual-only generation). Local/`/studio`-only.

**Deferred to v1.3 (connected-env):** run the eval harness vs baseline to *measure* quality lift, the
Playwright code-island isolation run, and live-progress studio streaming. A v1.3 proposal
("conversational genui on a 2D canvas") exists in `.planning/research/v1.3/`.

**Prior milestones:** v1.0 MVP (email ingest→parse→extract→entities/knowledge, Phases 1–11); v1.1
Generative UI Engine (Catalog→Spec→Registry→Renderer→Generation→Cache→Studio, Phases 12–15).

---

## Milestone history: v1.1 Generative UI Engine (historical)

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
- ✓ Generative-UI engine spine: Catalog → Spec → Registry → Renderer → Generation → Cache → `/studio` (spec-first, no eval) — v1.1, Phases 12–15
- ✓ GenUI realism + interactivity: eval harness + LLM-judge, 6 DTCG style packs + assembly RAG, expanded catalog (16 entries), zero-eval form engine, jailed-eval sandboxed code-island (verified live on Bedrock, multi-candidate + judge, $30 cost guard) — v1.2, Phases 16–20
- ✓ Conversational GenUI: persistent streamed `/chat` (cost breaker, regenerate-siblings, progressive spec render, multi-provider + WebGPU registry) + 2D infinite canvas of genui panels (React Flow, versioned node registry, shared per-chat state + data edges, exact persistence) + dual-channel widgets (proposal cards + clarify-widgets, server-re-validated + double-submit-locked round-trip, persisted in history+canvas) + anticipatory-prompting SPIKE (ship-with-conditions) — v1.3, Phases 22–25 (24/24 reqs; 6 connected-env verifications deferred)
- ✓ Chat & Studio design uplift: zero-dep contract fixes (FIX-01..11 — React Flow chrome, app-wide font-medium purge incl. primitive leaks, token discipline, node differentiation, shared JsonPane/EmptyState, hover/dock/scrollbar/role chrome) + narrowly-adopted external picks (ADOPT-01..05 — impeccable bans appendix, FileTree port, GeneratingRing, ux refs, hand-authored reveal transitions after license block) + token upgrades (TOKEN-01..05 — hue-164 neutral split, teal chart/sidebar rebase, elevation scale, radius steps, entrances; WCAG + registration regression gates) + POLISH-01/02 backlog folds — v1.4, Phases 26–28 (23/23 reqs; browser/OS visual checks deferred)

### Active

<!-- No active milestone. Run /gsd:new-milestone to open the next one. Candidates in "Current State → Next". -->

_(none — v1.4 shipped; next milestone not yet opened)_

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
| **v1.3 FOUND-1**: Canonical typed message parts | Messages persist as typed content parts (text \| genui-spec \| tool-call \| tool-result \| widget-interaction) with Anthropic content blocks stored verbatim — regenerate/replay/evals/canvas/cross-chat all read ONE shape; flat-text + side blobs would force migrations forever | ✓ Good — shipped v1.3; interactive_widget/interaction_result parts round-trip verbatim across history+canvas |
| **v1.3 FOUND-2**: One registry contract, many instances | Component catalog, canvas node-type registry, dual-channel widget/tool registry (and future agent/tool registries) all instantiate one pattern: id + content-hash version + Zod schema + allowlist semantics (the proven REGISTRY_VERSION shape) | ✓ Good — NODE_TYPE_REGISTRY + model registry + widget tools all instantiate it |
| **v1.3 FOUND-3**: Cost ledger as domain concept | STREAM-03 is a general budget ledger (per-turn/per-session/per-feature caps) drawn on by studio, chat, proactive prompting, and future agents — not a chat-shaped guard bolted beside the AWS alert | ✓ Good — CostCircuitBreaker ledger gates every chat turn (fail-closed) |
| **v1.3 FOUND-4**: Shared state extends declared-state | STATE-01/02 cross-panel store is a superset of the v1.1 declared-state model (same bounded mutation enum, same binding grammar) — one state system, never two | ✓ Good — canvas store reuses the bounded 5-mutation grammar + binding grammar |
| **v1.3 FOUND-5**: Provenance + addressability | Every spec/panel/widget records the run/event that produced it and carries stable IDs addressable across conversations — prerequisite for cross-chat context, promotion flywheel, and eval attribution | ✓ Good — panels/widgets render by provenance from run-event-backed message parts |
| **v1.3 FOUND-6**: One untrusted-input boundary pattern | Raw email (quarantine), LLM output (safeParse + allowlists), and widget submissions (Phase-24 re-validation) are instances of one rule: ALL untrusted input crosses a schema gate at the tRPC/FastAPI boundary | ✓ Good — widget submit re-validates against the STORED schema server-side (D-10) |
| **v1.3 FOUND-7**: Eval dimensions, not eval harnesses | Each phase registers new dimensions into the Phase-16 harness (streaming correctness, round-trip integrity, anticipatory appropriateness) — never parallel eval mechanisms | ⚠️ Revisit — Phase-25 spike built a standalone fixture harness (dark/spike-scoped); fold its appropriateness dimension into the Phase-16 harness when anticipatory prompting graduates from spike |
| **v1.3**: Convergence stays behind the procedure allowlist | Dual-channel widgets reach Nauta product data (entities/inbox/knowledge) only via the existing allowed-tRPC-procedures gate — product convergence becomes a config change, not a rearchitecture | — Pending — v1.3 widgets are self-contained (DCUI D-14); live product-data binding left an explicit seam |
| **v1.3**: Thread style_pack_id through chat + canvas | Chat-generated specs and canvas panels carry style_pack_id (already on the spec envelope) so a future promptable-design-system conditioning layer lands cleanly | — Pending — envelope carries it; the Design Engine milestone (999.4) consumes it |
| **v1.4**: Fix typography contract at the design-system SOURCE (buttonVariants etc.), not per call-site | One primitive edit corrects every consumer; per-site sweeps always miss shared-primitive leaks | ✓ Good — audit proved the corollary: contract greps must trace packages/ui primitives too (tabs/sidebar leaks found only at milestone audit) |
| **v1.4**: Clean-room hand-authoring over unlicensed external copy (ADOPT-05) | transitions.dev had no license grant; numeric timing values are unprotectable facts, so original CSS implementing the locked values is license-safe and preserves the requirement's substance | ✓ Good — shipped with full vetting evidence trail |
| **v1.4**: Committed regression gates over one-off checks (WCAG contrast test + token-family registration test) | Point-in-time verifications rot; the "var exists but utility never registered" bug class and contrast regressions now fail CI-style on every run | ✓ Good — registration test would have caught the sidebar-ring blue-fallback bug this milestone found |
| **v1.4**: CHAT_MAX_OUTPUT_TOKENS 4096→12000 (interim) | Large emit_ui_spec tool calls truncated at the cap and were silently dropped — user-facing "prompt not working" | — Pending — real fix is salvage/surface of truncated tool calls (todo filed 2026-07-06) |

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
*Last updated: 2026-07-07 after v1.4 milestone — Chat & Studio Design Uplift shipped (Phases 26–28, 23/23 requirements moved to Validated); Key Decisions updated with 4 v1.4 entries; Active reset pending next milestone*
