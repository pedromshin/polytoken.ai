# Roadmap: nauta.services.email-listener

## Milestones

- ✅ **v1.0 — MVP** (Phases 1–11) — inbound email → parse → extract → entities/knowledge (shipped; phase dirs retained under `.planning/phases/`, lifecycle not formally run).
- ✅ **v1.1 — Generative UI Engine** (Phases 12–15) — spec-first Catalog→Spec→Registry→Renderer→Generation→Cache→Studio. Archived: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
- ✅ **v1.2 — Generative UI: Realism & Interactivity** (Phases 16–20) — SHIPPED 2026-07-03. Eval harness + style packs + catalog expansion + declarative form engine + jailed-eval code-island (multi-candidate + judge). Archived: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Audit: [milestones/v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md).
- ✅ **v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel** (Phases 22–25) — SHIPPED 2026-07-06. Persistent streamed `/chat` on a 2D infinite canvas of genui panels with bidirectional (agent↔user) interactive widgets, plus an anticipatory-prompting spike. Local/sandbox only. Archived: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) · Audit: [milestones/v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md).
- ✅ **v1.4 — Chat & Studio Design Uplift** (Phases 26–28) — SHIPPED 2026-07-07. A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s own hand-built chrome — zero new npm dependencies — executing the locked 3-phase punch list (zero-dep contract fixes → adopted external picks → design-system token upgrades). Archived: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) · Audit: [milestones/v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md).
- ✅ **v1.5 — Knowledge-Graph Uplift** (Phases 29–32) — SHIPPED 2026-07-08. Activated the dormant knowledge-graph substrate: confirms materialize confidence-tiered edges (OCR token provenance) through a suggest-only promotion gate; cheap alias/identifier recall + a measurable retrieval-miss-rate gate for stage 3; `/knowledge` tiered exploration canvas (encoding, bounded expand, filter, promote). Archived: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md) · Audit: [milestones/v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md).
- ✅ **v1.6 — Chat × Knowledge Convergence** (Phases 33–41) — SHIPPED 2026-07-09. The chat agent reads its own extracted data: bounded mid-turn tool loop + 3 tiered knowledge tools with structural injection quarantine, per-round cost ceilings, visible tool rounds with citation chips, live data-bound panels, chat-confirmable promotions, and a knowledge-preview canvas node. Archived: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md) · Audit: [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md).
- ◆ **v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy** (Phases 42–46) — IN PROGRESS (opened 2026-07-09). VISION.md E2's autonomously-verifiable half: atomic internal rename, Google OAuth + sessions (Supabase Auth), per-user tenancy with enforced isolation, email thread model + forwarding seam, kickoff hygiene + the v1.8 brand/design dossier. Research: [research/v1.7-polytoken-foundation/SUMMARY.md](research/v1.7-polytoken-foundation/SUMMARY.md).

## Phases

**Phase Numbering:**
- Phase numbering continues across milestones (never restarts). v1.2 formally ended at Phase 20 (an
  informal Phase 21 quality-verification effort is recorded in STATE.md history but was never a
  numbered roadmap phase). v1.3 ran Phases 22–25. v1.4 ran Phases 26–28. v1.5 ran Phases 29–32.
  v1.6 ran Phases 33–41. **v1.7 starts at Phase 42 (Phases 42–46).**
- Integer phases (42–46): planned v1.7 milestone work.
- Decimal phases (e.g. 33.1): urgent insertions via `/gsd:phase insert`, executed between the
  surrounding integers.

<details>
<summary>✅ v1.2 — Generative UI: Realism & Interactivity (Phases 16–20) — SHIPPED 2026-07-03</summary>

- [x] Phase 16 — Studio Foundation: Eval Harness + History/Page-Ideas Tabs
- [x] Phase 17 — Tier A: Design-Token/Theme Layer + Style Packs + Assembly RAG
- [x] Phase 18 — Tier A: Catalog Expansion
- [x] Phase 19 — Tier B-1: Declarative (zero-eval) Form Engine
- [x] Phase 20 — Tier B-2: Sandboxed Code-Island (jailed-eval; SPIKE→phase; +Phase-21 multi-candidate/judge, cost guard)

Full detail: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Audit `tech_debt`, 0 gaps;
15 connected-env/browser verifications deferred (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.1 — Generative UI Engine (Phases 12–15) — SHIPPED 2026-06-27</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).

</details>

<details>
<summary>✅ v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel (Phases 22–25) — SHIPPED 2026-07-06</summary>

- [x] Phase 22 — Chat Spine + Persistence + Streaming (11/11 plans) — completed 2026-07-04
- [x] Phase 23 — 2D Canvas + Panels-as-Nodes + Shared State (6/6 plans) — completed 2026-07-05
- [x] Phase 24 — Dual-Channel GenUI (4/4 plans) — completed 2026-07-06
- [x] Phase 25 — Anticipatory Prompting (SPIKE) (3/3 plans) — completed 2026-07-06

Full detail: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md). Audit `tech_debt`, 0 gaps,
24/24 requirements satisfied + cross-phase integration verified; 6 connected-env/browser
verifications deferred (STATE.md → Deferred Items). SPIKE verdict: ship-with-conditions
(25-SPIKE-FINDINGS.md).

</details>

<details>
<summary>✅ v1.4 — Chat & Studio Design Uplift (Phases 26–28) — SHIPPED 2026-07-07</summary>

- [x] Phase 26 — Zero-Dependency Contract Fixes + Backlog Polish (7/7 plans) — completed 2026-07-06
- [x] Phase 27 — Adopted External Design Picks (5/5 plans) — completed 2026-07-07
- [x] Phase 28 — Design-System Token Upgrades (3/3 plans) — completed 2026-07-07

Full detail: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md). Audit `tech_debt`, 0 gaps:
23/23 requirements + 18/18 integration seams (one FIX-02 primitive leak closed at audit e9faa55);
deferred: browser/OS visual checks + 1 pending todo (STATE.md → Deferred Items).

</details>

<details>
<summary>✅ v1.5 — Knowledge-Graph Uplift (Phases 29–32) — SHIPPED 2026-07-08</summary>

- [x] Phase 29 — Tier Ladder + Edge Materialization (4/4 plans) — completed 2026-07-07
- [x] Phase 30 — Suggest-Only Promotion Gate (2/2 plans) — completed 2026-07-07
- [x] Phase 31 — Recall & Measurement (2/2 plans) — completed 2026-07-07
- [x] Phase 32 — Knowledge Canvas: Tiered Graph Exploration (3/3 plans) — completed 2026-07-08

Full detail: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md). Audit `tech_debt`, 0 gaps:
11/11 requirements + 6/6 integration seams WIRED. Deferred: 2 human_needed live-env verification
gaps (Phases 29/32) + 2 pending todos (STATE.md → Deferred Items). Stage-3 graph work (KGX-01..03)
stays gated behind the retrieval-miss-rate artifact (`packages/db/scripts/retrieval-miss-rate.ts`).

</details>

<details>
<summary>✅ v1.6 — Chat × Knowledge Convergence (Phases 33–41) — SHIPPED 2026-07-09</summary>

- [x] **Phase 33: Live Bindings Plumbing** - Genui canvas panels render live product data via `spec.bindings`, resolved through a compile-time allowlist switch, staying fresh via staleTime tiers + event-driven invalidation — zero renderer edits (completed 2026-07-08)
- [x] **Phase 34: Tool-Loop Mechanics (stub/echo executor)** - Chat agent runs a bounded (≤4-round) mid-turn tool loop against a stub/echo `ToolExecutor`, proving the round mechanics and fixing 2 latent bugs, before any real tool exists (completed 2026-07-08)
- [x] **Phase 35: Cost + Eval Scaffolding** - A per-round cost ceiling with fail-closed abort semantics is enforced on the FOUND-3 ledger, and retrieval-quality/citation-faithfulness/injection-resistance become measurable Phase-16 harness dimensions — both built against Phase 34's stub (completed 2026-07-08)
- [x] **Phase 36: Thin-Wrapper Tools** - User can ask about a known entity or find related emails from chat via `lookup_entity`/`search_emails`, thin wrappers over existing repos with zero new backend (completed 2026-07-08)
- [x] **Phase 37: Knowledge Search + Python Read-Side** - User can search or expand the knowledge graph from chat via `search_knowledge`, backed by a NEW Python `KnowledgeGraphRepository` + a DB-level `extracted_only` view — built but not yet exposed to users (completed 2026-07-09)
- [x] **Phase 38: Quarantine + Adversarial Eval** - Every wired `ToolExecutor` structurally enforces tier-filtered envelopes, proven against an adversarial fixture suite + live-model harness; `search_knowledge` becomes safely user-facing (completed 2026-07-09)
- [x] **Phase 39: Tool-Round UI + Citation Chips** - `/chat` visibly surfaces in-progress tool rounds and renders citation chips through one shared `<ProvenanceLink>` primitive (completed 2026-07-09)
- [x] **Phase 40: Confirm-Action Widgets** - Agent can end a turn with a confirm-action widget letting a human promote/reject a knowledge suggestion, over the existing Phase-24 CAS spine, with an edge-tier staleness re-check (completed 2026-07-09)
- [x] **Phase 41: Knowledge-Preview Canvas Node** - User can place a bounded, non-interactive knowledge-graph preview on the `/chat` canvas that deep-links out to `/knowledge` (completed 2026-07-09)

Full phase details: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md) · 20 plans, 45 tasks · 19/19 requirements · audit tech_debt (0 blockers).

</details>

## v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy (Phases 42–46) — CURRENT

19 requirements mapped (see REQUIREMENTS.md traceability). Dependency chain: 42 → 43 → 44 → 45;
Phase 46 is independent/parallelizable. Research base:
[research/v1.7-polytoken-foundation/SUMMARY.md](research/v1.7-polytoken-foundation/SUMMARY.md).

- [x] **Phase 42: Atomic Rename nauta → polytoken** (completed 2026-07-09)
- [ ] **Phase 43: Auth — Google OAuth + Sessions (Supabase Auth)**
- [ ] **Phase 44: Tenancy — user_id Scoping + Enforced Isolation**
- [ ] **Phase 45: Email Threads + Forwarding Seam**
- [ ] **Phase 46: Kickoff Hygiene + v1.8 Brand & Design Dossier**

### Phase 42: Atomic Rename nauta → polytoken

**Goal:** The codebase is polytoken everywhere internally — one atomic pass, no hybrid states — with external renames runbook'd for the user.
**Requirements:** RENM-01, RENM-02
**Success criteria:**
1. Zero `@nauta/` references remain in code/config (package names, workspace `-w` selectors, vercel.json, CI YAML); user-visible chrome says polytoken
2. Workspace symlinks regenerated (`npm install`); typecheck + web tests + Python tests green post-rename
3. External-rename runbook exists (GitHub repo, AWS/Terraform incl. ECR `force_delete`/tfstate warnings, Vercel, domain); `terraform plan` proves live AWS resource names untouched
**Plans:** 2/2 plans complete

Plans:
- [x] 42-01-PLAN.md — Atomic internal rename (`@nauta/*` → `@polytoken/*`, UI chrome, `nauta-teal`, skill dir) + workspace regeneration + full verification matrix
- [x] 42-02-PLAN.md — External-rename runbook (GitHub repo, AWS/Terraform, Vercel, domain) — documented, not executed

### Phase 43: Auth — Google OAuth + Sessions (Supabase Auth)

**Goal:** The app has real user identity — Google sign-in via Supabase Auth (`@supabase/ssr`, the milestone's ONE new npm dependency), persistent sessions, session-derived identity in every server context.
**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success criteria:**
1. User signs in with Google and returns authenticated; session persists across browser refresh; sign-out works
2. Signed-out visitors to app surfaces are redirected to sign-in
3. tRPC context resolves the session user server-side; a test proves identity cannot be supplied from client input
4. Server-side FastAPI proxy routes forward the user's identity; `X-API-Key` service boundary unchanged (existing service tests green)
5. Missing auth env vars fail startup with a clear message; Google Cloud OAuth client runbook exists

### Phase 44: Tenancy — user_id Scoping + Enforced Isolation

**Goal:** Every row of user-owned data belongs to a user and is unreachable across users — enforced at the app boundary (primary), defended in depth by RLS.
**Requirements:** TENA-01, TENA-02, TENA-03, TENA-04
**Success criteria:**
1. `user_id` anchored on `importers` + direct `user_id` on chat tables, migrated + backfilled to the first real user (expand→backfill→contract, live-verified locally)
2. Adversarial cross-tenant test suite passes as the acceptance gate — a second user cannot read/write the first user's data via ANY route/procedure, including the attachments download route and the knowledge-promote proxy
3. No route/procedure accepts client-supplied importer/user IDs for scoping (sweep + regression tests)
4. RLS policies active on user-owned tables; the enforcement-architecture decision (app-boundary primary, given the Drizzle superuser-connection precedent) recorded in PROJECT.md Key Decisions
5. genui exact-match cache tables deliberately unscoped, documented

### Phase 45: Email Threads + Forwarding Seam

**Goal:** Emails group into threads at ingest — resilient to forwarded mail — and the personal-forwarding seam exists.
**Requirements:** THRD-01, THRD-02, THRD-03, THRD-04
**Success criteria:**
1. Ingesting a reply chain yields one thread (`ThreadResolver` port at ingest, Union-Find over RFC headers); existing emails backfilled into threads
2. Real Gmail-UI-forward `.eml` fixtures do not fragment threads (conservative fallback tier, proven in tests)
3. Inbox lists emails grouped by thread
4. Unique secret-token forwarding-address seam works (SES wildcard pattern) with an onboarding runbook covering Gmail's destination-verification handshake

### Phase 46: Kickoff Hygiene + v1.8 Brand & Design Dossier

**Goal:** The substrate is verified before v1.8 re-skins it, small debts fold in, and the v1.8 dossier is decision-ready.
**Requirements:** HYGN-01, HYGN-02, DSSR-01, DSSR-02
**Success criteria:**
1. Eval harness vs baseline executed on the v1.2 corpus and Playwright code-island isolation spec executed (both engines), with recorded evidence (999.3's locally-feasible set)
2. pytest event-loop cleanup + grid `colSpan` support landed with tests (999.2)
3. Brand-identity options document is decision-ready; design-pattern dossier maps Claude/ChatGPT/Perplexity-class flows onto the v1.4 token system

## Backlog

- **999.1 — GenUI history per-importer authorization** (from Phase 16 code review, CR-01): `GET /v1/genui/history` returns all importers' rows when `importer_id` is omitted. Accepted for the current single-shared-key local/sandbox posture (auth enforced via `X-API-Key`; mirrors `/v1/genui/generate`). Enforce per-importer scoping (require `importer_id` or derive from auth context) if real multi-tenancy is introduced. Source: `.planning/phases/16-.../16-REVIEW.md`.
- **999.2 — Grid `colSpan` for asymmetric layouts** (from Phase 17 visual UAT, layout robustness): the `grid` primitive renders equal columns only — no per-child column spanning, so the model cannot express main+sidebar / asymmetric layouts (e.g. a 3/9 split). Phase 17 shipped the high-confidence clamp (`cols`→child-count, commit `75ca1b4`) + generator guidance, which fixes the common collapse; full `colSpan` support (per-node layout hint in the spec schema + interpreter wrapping each grid child in `grid-column: span N`) remains open. Also fold in the cross-file pytest event-loop test-isolation cleanup (migrate `get_event_loop().run_until_complete()` → `asyncio.run`/`pytest-asyncio`).
- **999.3 — v1.3 connected-env verification + measurement:** run the Phase-16 eval harness vs baseline on the v1.2 corpus (DEF-17-05-01/18-03-01/19-01/20-01), execute the Playwright code-island isolation spec (both engines), and add live-progress streaming to the studio (remove the silent spinner). Needs live Bedrock. (STREAM-01/02 in Phase 22 subsumes the studio live-progress-streaming item as part of the chat spine's streaming transport.)
- **999.4 — Design Engine (deferred):** DSGN-01..04 (unify-vs-hybrid design-engine lock, rendered-visual-compare repair step, promptable design system, screenshot/URL→design-token extraction). See REQUIREMENTS.md → Future Requirements.
- **999.5 — Orchestration Visualizer (deferred):** ORCH-01 (live orchestration run-tree visualization on the canvas). Seams left open by v1.3 (SEAM-03/04, CANVAS-03). See REQUIREMENTS.md → Future Requirements.
- **999.6 — Chat & Studio Design Uplift — PROMOTED to v1.4 (2026-07-06), SHIPPED 2026-07-07.** UPLIFT-01..03 — see milestones/v1.4-ROADMAP.md for full detail (finer FIX/ADOPT/TOKEN requirement IDs superseded the coarse UPLIFT-01..03 IDs).
- **999.7 — Editable genui panels / studio-on-canvas (raised 2026-07-06, user):** each canvas genui-panel becomes a live editing surface — per-panel controls to change UI tokens / `style_pack_id`, tweak spec parameters, and run studio-related tools (re-theme, regenerate variant, inspect) in place, instead of the current read-only render. Foundations already deliberately open: the versioned node-type registry (CANVAS-03) admits a richer "editable/studio panel" node type; `style_pack_id` is already threaded through chat + canvas (v1.3 locked decision); the Phase-17 DTCG style-pack engine + `/studio` token machinery already exist; the per-chat shared-state store can hold live params. Overlaps **999.4 Design Engine** — a promptable design system is the generation-side of the same tokens. NOT yet a requirement/phase.
- **999.8 — Declarative display-binding gap (found live 2026-07-06):** the declarative renderer binds values via a `dataRef` dotted-path field (`resolveDataRef`, SPEC-05) — it does NOT interpolate `{{mustache}}` inside a text node's `content`. Two candidate fixes: (a) generator-prompt fix (cheap, high-value), and/or (b) a small renderer affordance to resolve declared-state into text (bigger, touches the locked renderer). **Option (a) shipped as v1.4 POLISH-01 (Phase 26), 2026-07-06. Option (b) remains backlogged** — it touches the locked `SpecRenderer`.
- **999.9 — Canvas auto-layout stacking (cosmetic) — folded into v1.4 as POLISH-02 (Phase 26), SHIPPED 2026-07-06.**
- **999.10 — Knowledge-graph uplift — PROMOTED to v1.5 (2026-07-07), SHIPPED 2026-07-08.** Adopt graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live Postgres store, per its own staged cost/benefit ordering — see full analysis in `.planning/phases/999.10-knowledge-graph-uplift-graphify-adoption/NOTE.md`. Executed as Phases 29–32 (see milestones/v1.5-ROADMAP.md). Stage-3 BFS-into-prompts, budget-aware tier-pruning, and snapshot/diff remain explicitly deferred (tracked as KGX-01..03 in REQUIREMENTS.md → Future Requirements) until RECALL-02 measures a real retrieval-miss rate.
- **999.11 — polytoken.ai product vision (raised 2026-07-07, user):** total rebrand (nauta → polytoken.ai) + UI refactor + branding/design/marketing research + auth/gauth/tenancy/RLS; email-thread cards on canvas with attached chats + web-research → knowledge nodes → promote-to-global (the "AI-powered ontology driven by user chats"); desktop app + daemon (remote filesystem, watched folders, directory panels with Claude-Code-class attached chats, embedded editor panels); browser-control canvas panel; user-controlled tool/skill registry + agent self-repository of reusable functions; distributed inference/compute-credit pooling (explicitly last/gated). Full dependency-ordered epoch ladder (E0–E7), backlog absorption map, and irreversibility guardrails: `.planning/research/polytoken-vision/VISION.md`. Draws from after v1.6; does NOT alter v1.6 sequencing.
- **999.12 — Tailwind v4 + React 19 migration (raised 2026-07-07, UI-ecosystem research):** migrate `apps/web` + `packages/ui` off Tailwind 3.4/React 18 to unlock direct shadcn registry installs (`shadcn add @kibo-ui/…`) in place of the vendor+adapt workflow documented in `.claude/skills/nauta-design-system/SKILL.md`. Ecosystem registries (`@magicui`, `@kibo-ui`, `@coss` ex-Origin UI) all emit Tailwind v4/oklch payloads now. Scope: port the HSL tokens in `apps/web/src/app/globals.css` to `@theme`/oklch, revalidate every vendored `packages/ui` component, and decide the Radix-vs-Base UI stance (upstream shadcn switched default primitives to Base UI, 2026-07). Registry wiring already in place: `packages/ui/components.json` (2026-07-07).
- **999.13 — genui catalog expansion: register vendored components as spec types (raised 2026-07-08, user):** the declarative genui catalog (`packages/genui/src/catalog/manifest.ts`, 17 frozen `SpecNodeType`s, `RegisteredTypeSchema` allowlist) cannot emit the 20 vendored Magic UI/Kibo UI components shipped in `59dbf3b` — they render `UnknownComponentPlaceholder`. Register the high-payoff simple-prop ones first (`number-ticker`, `spinner`, `avatar-stack`, `animated-list`, `marquee`): per component = SpecNodeType literal + ManifestEntry (LLM description, CI-gated example, `.strict()` Zod propsSchema, component ref) + catalog tests (CTLG-04). Touches the locked generation surface (Bedrock structured-output grammar D-22/COST-02, catalog prompts D-23) — run as a small phase, not a drive-by. Code-island channel is out of scope by design (AST allowlist blocks imports). Components already browser-verified via `/dev/components` showcase.
- **999.14 — untracked dev/design scratch pages break `@polytoken/web` typecheck (found by Phase 42 verification, 2026-07-09):** the untracked `apps/web/src/app/dev/design/` showcase still imports `@nauta/ui/*` (20 specifiers in `previews-vendored.tsx`); after the Phase-42 rename removed `node_modules/@nauta`, Next's regenerated `.next/types/validator.ts` transitively imports the page and `npm run typecheck -w @polytoken/web` fails with 22 `TS2307` errors — the Task-3 tsconfig `exclude` cannot stop transitive imports reached via `.next/types`, so local `next build` (`ignoreBuildErrors: false`) would fail identically. Git-based CI/Vercel builds are unaffected (the dir is untracked). Fix options: find/replace `@nauta/ui` → `@polytoken/ui` inside the user-owned scratch dir (hard-excluded from Phase 42 by decision), or commit/delete the scratch content. Evidence: `.planning/phases/42-atomic-rename-nauta-polytoken/42-VERIFICATION.md` (status gaps_found, 7/8; gap parked here — ship not blocked).
- **v1.6 deferred items (from this milestone's own research, tracked for a future pass):** entity-merge confirm-action's surrogate-key decision (Fork 2 allowlist #2 — `component_entity_candidate_links` is keyed by pair, not an addressable id); region-confirm confirm-action (Fork 2 allowlist #3 — has its own dedicated non-chat UI already); cheap-model sanitize pass for read-then-write tool chains (Fork 3 — staged until a write-capable tool exists); inline-interactive knowledge preview (Fork 1 — hand-rolled mini pan/zoom, gated on Phase 41's non-interactive preview proving insufficient); demote/undo path for promoted edges (Fork 2 — plain REST, supersede-never-mutate, lower urgency); `web_search` ToolExecutor + source-capture as INFERRED nodes (VISION.md E1 addition — not load-bearing for v1.6).
