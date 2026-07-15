# nauta.services.email-listener

## What This Is

**polytoken** — a personal knowledge workspace grown out of the user's own email. Mail forwarded
to a personal `u-{token}@` address is ingested, parsed (PDF text + OCR), extracted into
entities/regions, and grouped into threads; from there the user works it on a 2D canvas: `/chat`
with an agent that reads its own extracted data through a bounded mid-turn tool loop (entity
lookup, email search, knowledge search, web search), generates live data-bound UI panels they can
re-theme and edit in place, and clusters chats around real email threads whose captured sources
promote into a confidence-tiered knowledge graph.

A monorepo (conventions mirroring acme-os-dev): `apps/web` (Next.js) + `apps/email-listener`
(FastAPI, Clean Architecture) + `packages/{db,api-client,ui,genui}`. Deployed to AWS ECS Fargate
(staging on `dev`, production on `main`) behind a shared ALB, with Vercel for the web app,
Supabase (Postgres + Auth + Storage), and AWS Bedrock for all LLM/embedding transport.
Repo: `pedromshin/polytoken.ai`.

## Core Value

Reliably receive every inbound email and make it observable — now as a product the user actually
lives in: their real email flowing, every shipped capability touched live, and the email-cluster
workflow working end-to-end on their real inbox.

*Still the right ONE thing after v1.9 — but v1.9 shipped without proving the "lives in" half of
it. The capability is built and verified at code level; the user has not yet signed in on the
deployed app, and no real email has flowed. See Current State.*

## Current State (v1.9 shipped 2026-07-14 — next milestone not yet opened)

**Shipped: v1.9 — Cloud Workspace** (Phases 49–54, 37 plans, 205 commits, 260 code files
+33,485/−8,171, 2026-07-10 → 2026-07-13, largely autonomous overnight runs). 24/27 requirements.
Audit verdict `gaps_found`.

The E3 email-cluster workflow is real: email-thread cards are a first-class canvas node type,
chats bind to threads (migration 0036, applied local + staging + prod) and draw on that thread's
content plus accumulated cluster artifacts, a 4th `web_search` ToolExecutor ships behind a
double pre/post-DNS SSRF guard and a 10-fixture adversarial injection suite, and captured sources
become INFERRED knowledge nodes that promote to EXTRACTED through the completely unmodified
`PromoteEdgeUseCase`. Around it: every major surface re-skinned onto the extended token system
with a committed palette-ban gate; genui panels became editable in place (pack switch, bounded
schema-validated param edits, regenerate with version history, one-shot NL re-theme via Bedrock);
and the product degrades to an inline feed on mobile (canvas islands never mount below `md`).
Deploys are green end-to-end — CI, prod ECS on a new image, ALB /health 200, Vercel 200.

**⚠ The caveat that defines this milestone.** v1.9 shipped with its three live-acceptance legs
unexecuted:

| REQ | Gap | Runsheet |
|-----|-----|----------|
| LIVE-03 | Google OAuth never exercised on the deployed app | MORNING-CHECKLIST.md §A |
| LIVE-04 | No real email has ever flowed in | §B.3–6 |
| CLUS-07 | The six-leg cluster scenario on the real inbox — **the declared acceptance bar** | §H |

The audit said complete-milestone must not run until these were done. The user chose "proceed
anyway — accept as tech debt" at the gate on 2026-07-14, knowingly overriding the STANDING RULE
this very milestone established. **None is missing work** — all three are user-only external
actions with code, infrastructure, and runsheets complete and waiting. Run §A → §B.3–6 → §H in
that order. Until then, "polytoken is a *used* product" remains a claim, not a fact.

**A second honest finding, straight from the user:** *"the whole UI is still ugly/experimental,
not a production UI — not just tokens and colors."* Phase 51 "Total UI Re-skin" was scoped and
executed as token-hygiene (its own UI-SPEC said "refinement, not redesign"); no phase in this
project's history has ever done actual visual/UX design. Base palette is still stock-shadcn; the
brand guide defines the polytoken register only as voice/tone. Filed as backlog **999.18 (HIGH
PRIORITY)** — a full production UI/UX rebuild, top candidate for the next milestone, with v1.9's
16-surface screenshot harness + committed token gates as the regression rails. Companion **999.19**
captures the user's own description of the target product (auto-collected sources without capture
ceremony, user-selected canon, canvas edges-as-context) — prime shaping input for E4/E5.

**Next milestone goals (not yet opened — `/gsd:new-milestone`):** two live candidates —
**999.18** (production UI/UX rebuild; the felt-value gap) and **v2.0 Local Agent Platform**
(E4+E5+E6 merged: daemon + one permission model + generalized ToolExecutor, watched folders →
directory panels with Claude-Code-class attached chats, browser panel CDP-first, tool registry).
Plan of record: `.planning/research/two-epoch-endgame/ENDGAME-PLAN.md`. Whatever opens, the v1.9
live legs (§A/§B/§H) should close first — they cost no development time.

<details>
<summary>v1.8 Milestone Detail (shipped 2026-07-10, scope cut at Phase 48)</summary>

**Shipped: v1.8 — Polytoken Re-skin: Brand & Design-System Foundation** (Phases 47–48, 10 plans,
25 tasks, 12/12 in-scope requirements, 8/8 integration seams WIRED, 127/127 regression tests
re-run live at audit, audit `tech_debt` with 0 blockers). Opened as Phases 47–51 under the "DO
EVERYTHING" mandate; the user cut scope the same day after the honest verdict that three
milestones of foundation/paint had out-sequenced felt value — RSKN/MOBL/PANL (11 requirements)
moved to v1.9, and ALL remaining vision was compressed into two epochs (v1.9 Cloud Workspace +
v2.0 Local Agent Platform; E7 parked). Plan of record:
`.planning/research/two-epoch-endgame/ENDGAME-PLAN.md`. **Standing rule from this close onward:
deploy/OAuth/live-UAT gates are first-class phase work, never deferrable-by-default.**

**Next milestone goals (v1.9 Cloud Workspace):** Band 1 Live-Loop Gate FIRST (local stack green,
staging/prod migrations 0026–0035, OAuth + SES forwarding runbooks → the user's real email
flowing, ~20 deferred UAT scenarios burned down) → Band 2 re-skin/mobile/editable-panels (seed
specs preserved in milestones/v1.8-ROADMAP.md §49–51, +999.16) → Band 3 E3 Email-Cluster
Workflow depth-first around ONE fully-working scenario on the user's real inbox.

**v1.8 delivery detail:** Phase 47 (brand foundation + screenshot harness) and Phase 48 (token-system
extensions) are complete. Phase 48 extended the v1.4 DTCG token system additively (35 aliases, zero
renames/removals, git-diff-proven): `radius.pill` / `color.success(+Foreground)` /
`typography.code.family` utility aliases, the novel `color.tier.*` INFERRED/EXTRACTED ladder and
closed `color.graph.*` node-type palette (all 6 packs, computational WCAG-AA gate + per-alias
CSS-var registration gate in `packs.test.ts`), consumed at the citation chip, chat markdown/studio
JSON code surfaces, confirmed-good visuals, and the `/knowledge` canvas (node chrome, filter rail,
detail badges, tier edges/legend/filter — zero raw hex). Conventions recorded:
`docs/design/hover-active-convention.md` + `docs/design/breakpoint-decision.md` (+ `.touch-target`
mechanism, md-breakpoint convention) — the breakpoint decision Phase 50 builds on. Verification
passed 13/14 with one recorded override (no pill-shaped tab exists to convert; studio tabs
underline-by-design — see 48-VERIFICATION.md). Live-browser confirmation of the re-tokened surfaces
is parked in 48-HUMAN-UAT.md pending the OAuth runbook (now a v1.9 Band-1 checkpoint task, not an
open-ended deferral); off-token chip/badge stragglers (entity-chips, entity-detail StatusBadge)
parked as backlog 999.16 for the v1.9 re-skin band.

</details>

<details>
<summary>v1.7 Milestone Detail (shipped 2026-07-10)</summary>

**Shipped:** **v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy** (Phases 42–46, 25 plans,
61 tasks, 19/19 requirements, 9/9 integration seams WIRED, 3/3 E2E flows, audit `tech_debt` with
0 blockers). The product is now polytoken everywhere internally (one atomic 242-file rename pass;
external renames runbook'd), has real identity (Google OAuth via `@supabase/ssr` — the milestone's
ONE new dependency — with sessions refreshed by middleware, `ctx.user` + `protectedProcedure` in
tRPC, server-derived `X-User-Id` to FastAPI), and enforces per-user tenancy for real: migrations
0031–0034 anchor `user_id` (expand→backfill→contract, live-verified), a central
`@polytoken/db/ownership` chokepoint + full router/endpoint sweep, RLS defense-in-depth on 13
tables, all proven by two-user adversarial suites — including a chat-SSE hole the acceptance gate
itself discovered and a same-run gap-closure plan (44-09) closed. Emails now group into threads at
ingest (Union-Find over RFC headers + forwarded-mail fallbacks, idempotent backfill: 16 emails → 9
threads locally) behind a thread-grouped inbox, and the personal-forwarding seam exists end-to-end
(CSPRNG `u-{token}@` addresses, ingest-side resolution, user-anchored importers, runbook'd SES/Gmail
setup). v1.8's kickoff is decision-ready: brand-identity options (recommendation: Cortex, with a
sourced polytoken naming-collision flag) + a design-pattern dossier mapped onto the real v1.4 DTCG
tokens. Deferred: 8 items at close (3 todos, 11 UAT scenarios across 2 files, user runbooks,
staging/prod migrations) — STATE.md → Deferred Items. Executed autonomously across an
account-switch cutoff, one mid-plan connection-drop recovery, and two API-error recoveries.

*(Post-close user actions that unblock the deferred surface: run `GOOGLE-OAUTH-RUNBOOK.md` (login
works end-to-end after it), then the 43/45 HUMAN-UAT files; decide the local Supabase nauta→polytoken
project-id migration; apply migrations 0031–0035 to staging/prod per the deploy playbook.)*

*(All of the above landed in v1.9 Phase 49 except the OAuth sign-in itself — see the caveat in
Current State.)*

</details>

## Prior State (v1.6 shipped 2026-07-09)

**Shipped:** **v1.6 — Chat × Knowledge Convergence** (Phases 33–41, 20 plans, 45 tasks, 19/19
requirements, 9/9 integration seams WIRED, audit `tech_debt` with 0 blockers). The chat agent now
reads its own extracted data: a bounded mid-turn tool loop (≤4 rounds, one ChatRun per turn, 2
Bedrock Claude models via `max_tool_rounds`) executes `lookup_entity`, `search_emails`, and
`search_knowledge` (search|expand over an extended Python `KnowledgeGraphRepository`; migration
0029's `knowledge_nodes_extracted_only` view + BlendedRAG RPCs). Non-EXTRACTED text is structurally
unreachable through three belts (SQL view, envelope field-omission, FOUND-6 `tool_envelope_gate`);
`search_knowledge` went user-facing only after a 26-fixture adversarial suite + live Bedrock Haiku
harness (7/7, zero canary leaks) passed in the same run. Tool rounds are visible in `/chat`
(`server_tool_call`/`server_tool_result` SSE mirror frames → activity rows + collapsed result rows
with citation chips via ONE shared `<ProvenanceLink>`); genui panels resolve `spec.bindings` live
over the 5 allowlisted procedures (zero renderer edits — locked files stayed byte-identical);
knowledge suggestions are chat-confirmable via `emit_confirm_action` over the Phase-24 CAS spine
with an edge-tier staleness re-check (409 on out-of-band promotion; migration 0030); and a
`knowledge-preview` canvas node (3rd registry entry, static two-ring ego mini-graph, cap 25,
real-link deep-links) closes the loop. Two latent production bugs fixed (UsageDelta overwrite,
silent tool-parse-failure drop) plus one live client bug (persisted tool_call mis-folding).
Migrations 0029–0030 applied + live-verified locally. Deferred: 7 items (2 visual verification
gaps w/ persisted UAT files, 3 todos — STATE.md → Deferred Items). Executed fully autonomously
(`/gsd:autonomous parallelize what possible`), surviving 3 session-limit interruptions.

*(v1.6's "Next" resolved: 999.11 polytoken.ai E2 selected → v1.7 opened 2026-07-09 — see Current
Milestone below. Remaining candidates carried per VISION.md's absorption map: 999.4 Design Engine →
v1.8, 999.3 connected-env verification → folded into v1.7 kickoff hygiene, 999.13 genui catalog
expansion + 999.12 Tailwind v4/React 19 stay backlog.)*

<details>
<summary>v1.6 original milestone goal (opened 2026-07-08)</summary>

**Goal:** The v1.3 chat agent gains knowledge tools (a bounded mid-turn tool loop reading its own
extracted data), genui panels gain live product-data bindings, and dual-channel widgets act on
knowledge — suggest-only, human-confirm — cashing in the v1.3 promise that product convergence is
"a config change, not a rearchitecture" (the seams already exist: dead-but-validated
`spec.bindings`, the tRPC procedure allowlist, the Phase-24 widget spine, v1.5's tier ladder).

**Target features:**
- **Live data-bound panels (Fork 1):** a `use-data-bindings` hook *above* the renderer resolves
  `spec.bindings` via a compile-time switch over the 5 already-allowlisted procedures
  (`entities.byId/list`, `emails.detail`, `knowledge.byId/graph`), params injected from render
  context (never model-authored), TanStack staleTime tiers + promotion-invalidation refresh —
  zero edits to the locked renderer files
- **Bounded mid-turn tool loop (Fork 4):** in-stream round loop (≤4 rounds, one ChatRun per turn)
  behind a `max_tool_rounds` capability gate (2 Bedrock Claude models only), new `ToolExecutor`
  domain port + `tool_invocation`/`tool_invocation_result` part types; fixes 2 latent bugs found
  by research (UsageDelta overwrite → cost under-reporting; silent tool parse-failure drop)
- **3 knowledge tools (Fork 5):** `lookup_entity` + `search_emails` (thin wrappers over existing
  repos, zero new backend) + `search_knowledge(query, mode search|expand)` over a NEW Python
  `KnowledgeGraphRepository` + DB-level `extracted_only` view (migrations 0029+); EXTRACTED-only
  enforced by field omission, `citations[]` in every envelope
- **Structural quarantine (Fork 3):** tier-split typed envelopes (Tier-1 knowledge: only EXTRACTED
  text enters context; Tier-2 email: quarantine output, never raw body) as a ToolExecutor
  interface obligation; adversarial fixture suite + live-model harness
- **Cost + eval scaffolding (critic gaps a+b):** per-round ledger ceiling distinct from per-turn +
  mid-round abort semantics; retrieval-quality / citation-faithfulness / injection-resistance
  dimensions registered into the Phase-16 harness (FOUND-7)
- **Tool-round UI + citations (critic gap c):** "searching knowledge…" run surface + citation
  chips via ONE shared `<ProvenanceLink>` primitive (consumed by chips AND the preview node)
- **Confirm-action widgets (Fork 2):** `emit_confirm_action` carrying only a `suggestion_ref`
  (never raw mutation params) over the Phase-24 CAS spine, + the NEW edge-tier staleness re-check;
  `widget_kind` CHECK migration
- **Knowledge-preview canvas node (Fork 1 C):** 3rd `NODE_TYPE_REGISTRY` entry rendering a
  bounded non-interactive ≤2-hop subgraph, deep-linking `/knowledge?focus={id}` — nested React
  Flow REJECTED

**Key context:** Opened autonomously (`/gsd:new-milestone /gsd:autonomous`): v1.6 was the
pre-agreed next milestone — research locked 2026-07-07 in
`.planning/research/v1.6-chat-knowledge/SYNTHESIS.md` (5 forks + completeness critic, file:line
evidence), its hard gate (v1.5 fully shipped) satisfied 2026-07-08, and this document's own
"Next" listed it first. Kickoff verifications the synthesis mandates, both done: migration head
is `0028` → **v1.6 migrations number 0029+** (synthesis's "0027+" guess superseded); **no
DB-level `extracted_only` view exists anywhere** (verified by grep over migrations + Python app)
→ v1.6 builds it itself alongside the Python `KnowledgeGraphRepository` instead of importing it
from v1.5. Build order locked by the synthesis: 9 phases P1–P9, gates G1–G3 (v1.5 — all now
satisfied) + G4 (v1.6's own tool-loop mechanics). Standing exclusions: OpenRouter excluded from
tool rounds (adapter drops tool blocks); `continue_after_widget` NOT unified with the machine
loop; `spec-renderer.tsx`/`render-node.tsx`/`genui-part-boundary.tsx` stay byte-identical.

</details>

## Current Milestone: v1.10 Product Design & Research Canvas

**Goal:** polytoken stops looking experimental and starts working the way the user described it —
a *designed* product whose research canvas collects sources without ceremony, lets the user select
a personal canon, and treats canvas edges as context.

**Why now (and why not v2.0):** ENDGAME-PLAN.md §5 sequenced v2.0 Local Agent Platform next, but
that plan locked 2026-07-10 and two user findings postdate it — 999.18 (2026-07-12: *"the whole UI
is still ugly/experimental, not a production UI — not just tokens and colors"*) and 999.19
(2026-07-12: the target workflow in the user's own words, which states outright that the UI rebuild
should **design** these surfaces, not retrofit them). Building v2.0's directory/browser panels onto
an unfinished register would repeat the mistake one epoch later. v2.0 keeps its number and follows
this milestone.

**Target features (five dependency-ordered bands):**
- **Band 1 — Platform (999.12, unparked):** Tailwind 3.4 → v4 (`@theme`/oklch), React 18 → 19,
  revalidate every vendored `packages/ui` component, settle the Radix-vs-Base-UI stance. Unparked
  deliberately: a real palette rebuild on HSL would have to be redone at the v4 migration, and v4
  unlocks direct `shadcn add @kibo-ui/…` installs in place of vendor-and-adapt.
- **Band 2 — Visual identity (BLOCKING HUMAN GATE):** sketch distinct visual directions on real
  polytoken screens → **the user picks one** → palette/type/spacing/signature designed, not
  defaulted. Nothing cascades before the pick.
- **Band 3 — Surfaces:** per-surface UX redesign (inbox, chat+canvas, knowledge, email detail,
  studio, settings, login) — layout, hierarchy, information density, interactions — plus
  production-grade empty/loading/error states everywhere, plus 999.17 (panel chrome unreachable
  on mobile).
- **Band 4 — Research canvas (999.19, built not just designed):** per-conversation source ledger,
  auto-collected source nodes on canvas (no capture ceremony — today's CLUS-04 per-turn confirm
  widget is the explicit anti-goal), canon-selection UX over the existing promotion gate, and
  **edges-as-context** (connecting source/table/panel nodes to a chat node injects them as that
  chat's context — architecturally significant; canvas sharedState was explicitly NOT the linkage
  store per D-54), plus source-grounded presentation panels.
- **Band 5 — Email learning loop (999.19 step 1):** the user corrects what each email is; the
  system learns from those corrections over time. Extends the suggest-only entity-resolution
  stance — **never auto-decide**.

**Key context:**
- **The taste gate is the point.** 999.18 scope item (d) requires a design-review loop with the
  user on real screens BEFORE cascading, because v1.9's autonomous-overnight approach cannot make
  taste decisions. Band 2 is a hard human gate; every later band cascades from the locked choice.
  Nine milestones of capability, zero of design — measurement enforced hygiene (WCAG gates, palette
  bans) and hygiene passed every time while the product looked unfinished.
- **v1.9's live legs stay owed.** LIVE-03 (§A OAuth), LIVE-04 (§B.3–6 real email), CLUS-07 (§H)
  were explicitly left as v1.9 debt at this milestone's opening (user decision 2026-07-14, second
  time asked). Consequence carried knowingly: the inbox and canvas get redesigned against seeded
  fixtures, and the Band-5 email loop is built without a real inbound message ever having landed.
  Runsheet remains `phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md`.
- **Regression rails already exist** from v1.9: the 16-surface screenshot harness
  (`npm run screenshot:review`), the committed `palette-ban.test.ts` gate, WCAG-AA contrast +
  token-registration gates, and a 32/32 E2E suite. The rebuild runs against these.
- Phase numbering continues at **55**.

## v1.9 Milestone Detail (SHIPPED 2026-07-14 — archived: milestones/v1.9-ROADMAP.md)

**Goal (as written at open):** polytoken becomes a *used* product — the live loop closes on the
user's real email FIRST, then the total re-skin/mobile/editable-panels land, then the E3
email-cluster workflow ships depth-first as ONE fully-working scenario on the user's real inbox.
Plan of record: `.planning/research/two-epoch-endgame/ENDGAME-PLAN.md` §2 (Epoch A).

**Goal vs outcome:** Bands 2 and 3 delivered in full at code level. Band 1 — the gate the whole
milestone was ordered around — closed LIVE-01/02/05/06/07 but never closed LIVE-03 (OAuth live)
or LIVE-04 (real email flowing), so Bands 2 and 3 shipped on top of a gate that was never fully
green, and CLUS-07 (the acceptance bar) went unproven. The hard ordering constraint held on paper
but not in the sense the standing rule was written to protect. Accepted as tech debt by explicit
user decision at the close.

**Target features (three dependency-ordered bands):**
- **Band 1 — Live-Loop Gate (FIRST; nothing else starts until green):** local stack green
  end-to-end; migrations 0026–0035 on staging+prod; Google OAuth runbook executed (user
  checkpoint tasks in-phase, never parked); SES/Gmail forwarding wired → real email flowing;
  ~20 deferred UAT scenarios burned down; W-1 screenshot-surface fix; external-rename/
  Supabase-project-id decisions surfaced as checkpoints.
- **Band 2 — Folded v1.8 remainder:** total UI re-skin on extended tokens (RSKN + 999.16 +
  /knowledge UI debt), mobile-responsive answer (MOBL), editable genui panels (PANL —
  style-pack switch, spec tweak, regenerate, promptable re-theme).
- **Band 3 — E3 Email-Cluster Workflow (depth-first):** email/thread cards as canvas nodes,
  chats bound to thread context, `web_search` ToolExecutor (same port + quarantine discipline),
  source-capture → INFERRED knowledge nodes, promote-to-global via the existing gate, cluster
  context for subsequent chats — acceptance bar is the user running the whole scenario live.

**Key context:** Opened under the two-epoch endgame restructure (all remaining vision =
v1.9 + v2.0; E7 parked). STANDING RULE: deploy/OAuth/live-UAT gates are first-class phase
work, never deferrable-by-default. Ex-Phase-49/50/51 seed specs: milestones/v1.8-ROADMAP.md;
ex-49 discuss context: .planning/phases/51-total-ui-re-skin/51-CONTEXT.md. Band 2 ∥ Band 3
interleaving allowed after Band 1; mobile last. Phase numbering continues at 49.

## v1.8 Milestone Detail (SHIPPED 2026-07-10, scope cut at Phase 48 — archived: milestones/v1.8-ROADMAP.md)

**Scope cut (user-directed, 2026-07-10):** v1.8 ends at Phase 48 with brand foundation +
verification tooling + token-system extensions shipped (12/12 in-scope requirements). The
re-skin, mobile, and editable-panels remainder (RSKN/MOBL/PANL, 11 requirements) moves to
v1.9 "Cloud Workspace" under the two-epoch endgame restructure — everything left in the product
vision now lands in v1.9 (live-loop gate + re-skin/mobile/panels + E3 email-cluster workflow)
and v2.0 (E4+E5+E6 local agent platform); E7 parked. Plan of record:
`.planning/research/two-epoch-endgame/ENDGAME-PLAN.md`.

**Original goal (pre-cut):** The product looks and feels like polytoken — a warm second-brain companion — everywhere:
brand identity applied, total UI re-skin executed on an EXTENDED (never discarded) v1.4 token
system, a market-validated mobile answer for the canvas, and genui panels upgraded from read-only
renders to live editing surfaces.

**Target features:**
- **Brand application (polytoken — USER-LOCKED):** name polytoken, domain polytoken.ai
  ("everything else is purged" — user, 2026-07-10); voice/copy register stays warm/companion
  (VISION-grounded), logo mark (rounded node/brain hybrid; existing teal `color.primary` kept),
  login/marketing-facing chrome, favicon/titles; the CLI-tool name collision was explicitly
  ACCEPTED by the user (no purchases/registrations — still user-gated)
- **Token-system extensions (DSSR-02 punch list):** `radius.pill`; `color.success`/
  `color.successForeground`; `typography.code.family`; purpose-built tier-ladder tokens
  (INFERRED/EXTRACTED — novel, no competitor precedent); closed graph node/edge-type palette for
  the xyflow canvas; hover/active-state convention; breakpoint-awareness scoped as its own design
  conversation before the mobile answer implements
- **Total UI re-skin on extended tokens:** chat, thread inbox, knowledge canvas, studio,
  settings/login — polytoken register throughout, zero raw hex (D-03/STYLE-03), token-driven
- **Mobile-responsive answer:** list/feed view on small screens, canvas on desktop; inline-first
  posture market-validated (ChatGPT removed Canvas 2026-05-28 over cross-surface inconsistency;
  Claude Artifacts render inline on mobile)
- **Editable genui panels / studio-on-canvas (absorbs backlog 999.7):** per-panel controls to
  switch `style_pack_id`, tweak spec parameters, and regenerate variants in place — the versioned
  node-type registry (CANVAS-03), threaded style_pack_id, and DTCG pack engine were left open for
  exactly this
- **Design Engine cheap slice (from backlog 999.4):** promptable design system as the
  generation-side of panel re-theming (DSGN-03 flavor); DSGN-02 visual-compare repair and DSGN-04
  screenshot/URL→token extraction stay deferred — not "cheap"
- **Visual verification unblocked:** the v1.7 one-new-dependency freeze lifts — install
  `@playwright/test` (+ firefox), execute the parked code-island isolation + auth-redirect specs,
  and use screenshot-driven review for the re-skin

**Key context:** Opened autonomously under the user's explicit "DO EVERYTHING" mandate
(2026-07-10). Brand: USER-LOCKED 2026-07-10: the product is named **polytoken**, domain **polytoken.ai** — "everything else is purged". The name collision with the existing polytoken CLI tool was explicitly ACCEPTED by the user (recorded as accepted risk, not a mitigation target). The dossier's Cortex recommendation was initially adopted as the
autonomous default and then OVERRIDDEN by this user decision; only the warm/companion copy TONE
(grounded in VISION's own north star) carries over, speaking as polytoken. Both dossier docs at `.planning/research/v1.8-design/` are the milestone's research
base (fresh, web-researched 2026-07-10). User-gated leftovers from v1.7 remain open in STATE.md
Deferred Items (OAuth runbook, deploys, external renames) — auth-gated visual UAT items become
naturally verifiable once the user completes the OAuth runbook. Phase numbering continues from 46.

## v1.7 Milestone Detail (SHIPPED 2026-07-10 — archived: milestones/v1.7-ROADMAP.md)

**Goal:** Turn the validated substrate into a product foundation — VISION.md E2's
autonomously-verifiable half: atomic internal rename nauta → polytoken, real auth (Google OAuth +
sessions) and per-user tenancy (Supabase RLS actually enforced), an email thread model over the
message-oriented pipeline, and the v1.8 brand/design dossier prepared in parallel.

**Target features:**
- **Atomic internal rename** nauta → polytoken across repo code, packages (`@nauta/*` →
  `@polytoken/*`), imports, docs, and UI strings — one phase, no hybrid states ("rename once"
  guardrail); external renames (GitHub repo, AWS resources, Vercel project, domain purchase/DNS)
  delivered as a user runbook, not executed autonomously
- **Auth:** Google OAuth sign-in + server sessions — machinery, session storage, and env-var
  config shipped and tested; live OAuth client creation in Google Cloud documented for the user
- **Tenancy:** `user_id` scoping on user-owned tables + Supabase RLS enforced for real (today:
  RESTRICTIVE deny-all + a single shared API key); absorbs backlog 999.1 per-importer
  authorization as per-USER scoping; tenant-scoping columns on all new tables per VISION
  guardrail #1
- **Email threads:** thread model (grouping/threading over today's message-oriented ingestion)
  + own-email forwarding seam for real personal use (live forwarding config user-runbook'd)
- **Kickoff hygiene:** 999.3 connected-env verifications where locally feasible (live Bedrock
  works locally via IAM, Playwright runs locally) + 999.2 folds (pytest event-loop cleanup,
  grid colSpan)
- **v1.8 Brand & Design dossier:** research track producing brand-identity options +
  Claude/ChatGPT/Perplexity-class design-pattern research for the v1.8 re-skin — run during
  v1.7 the way v1.6's research ran during v1.5

**Milestone progress:** Phase 42 (atomic rename) complete 2026-07-09; Phase 43 (Auth — Google
OAuth + sessions via Supabase Auth, AUTH-01..05) complete 2026-07-10 — code-verified 5/5
must-haves, 4 live-OAuth UAT items deferred to `43-HUMAN-UAT.md` pending user's
`GOOGLE-OAUTH-RUNBOOK.md` setup. Phase 44 (Tenancy, TENA-01..04) complete 2026-07-10 —
verification PASSED 5/5 after a same-run gap-closure cycle (44-09 closed the chat-SSE
cross-tenant hole the adversarial gate discovered); migrations 0031-0034 applied locally
(user_id anchoring + backfill + RLS on 13 tables); backlog 999.1 absorbed; attachments IDOR
closed. Phase 45 (Email Threads + Forwarding Seam, THRD-01..04) complete 2026-07-10 —
verification human_needed with zero code blockers (10/13 code-verified; 7 UAT items in
`45-HUMAN-UAT.md`, mostly OAuth-gated visual checks + the live forwarding round-trip);
migration 0035, Union-Find grouping at ingest, idempotent backfill live-run (16 emails → 9
threads), thread-grouped inbox, u-{token}@ forwarding seam + FORWARDING-RUNBOOK.md. Phase 46
(Kickoff Hygiene + v1.8 Dossier, HYGN-01/02 + DSSR-01/02) complete 2026-07-10 — verification
passed with 1 accepted override (real-browser Playwright run parked as todo; AST-allowlist
substitute green); v1.8 dossier decision-ready at `.planning/research/v1.8-design/`
(brand recommendation: Cortex — NOTE the sourced polytoken naming collision finding). ALL 5
v1.7 PHASES COMPLETE — lifecycle (audit → complete → cleanup) in progress.

**Key context:** Opened autonomously (`/gsd:new-milestone /gsd:autonomous /strategic-compact
/gsd:graphify`): E2 selected because VISION.md (freshest user-captured intent, 2026-07-07) names
it the next epoch and its gate — E1/v1.6 shipped — opened at the v1.6 close. E2 split per its own
"each epoch becomes 1–3 milestones" rule: v1.7 = the backend-testable foundation (autonomous-fit
precedent from the v1.5 selection); **v1.8 = the taste-heavy remainder** (total UI re-skin on the
v1.4 token system, mobile-responsive canvas answer, 999.4 Design Engine absorption, 999.7 panel
editing) which needs both the brand dossier and user reaction. `/gsd:graphify` directive honored:
repo knowledge graph refreshed (`graphify --update`) and used as the architecture-question tool
during planning. Phase numbering continues from 41.

## Prior State (v1.5 shipped 2026-07-08)

**Shipped:** **v1.5 — Knowledge-Graph Uplift** (Phases 29–32, 11 plans, 11/11 requirements,
6/6 integration seams WIRED, audit `tech_debt` with 0 blockers). The dormant Phase-11 knowledge-graph
substrate is ACTIVE: confirming a region materializes `knowledge_nodes` + EXTRACTED-tier
`knowledge_node_edges` with OCR token-polygon provenance (best-effort D-13 hook, confirm never fails
on synthesis errors); every node/edge carries the `knowledge_trust_tier` ladder (EXTRACTED | INFERRED
| AMBIGUOUS, default AMBIGUOUS — fail toward least trust) with `confidence real` as intra-tier score;
the same synthesizer emits deterministic INFERRED/AMBIGUOUS *suggestions* that a human promotes via
`POST /v1/knowledge/edges/{id}/promote` (fail-closed CAS, promotion provenance distinct from
synthesis provenance); `list_injectable_edges` is the single EXTRACTED-only sanctioned injection read
path (shipped ahead of its stage-3 consumer, by design). The Bedrock autofill adapter's never-built
few-shot rendering seam is closed and the resolved entity's `aliases[]`/`identifiers` now reach the
prompt; every autofill run is instrumented (`autofill_retrieval_events`, migration 0028) and
`packages/db/scripts/retrieval-miss-rate.ts` computes the stage-3 (KGX-01..03) go/no-go number.
`/knowledge` is a tiered exploration canvas: solid/dashed/faint tier encoding + legend, cumulative
tier filter, bounded (≤2-hop, ~50-node) `expandNode` click-to-expand, and a suggestion-edge popover
whose "Promote to confirmed" round-trips through a server-keyed Next proxy. Migrations 0026–0028
applied + live-verified locally. Deferred: 2 human_needed live-env verification gaps (29/32) + 2
pending todos (STATE.md → Deferred Items). Selected + executed fully autonomously
(`/gsd:new-milestone /gsd:autonomous`).

*(v1.5's "Next" resolved: v1.6 Chat × Knowledge Convergence opened 2026-07-08 — see Current
Milestone above. Remaining candidates carried: 999.4 Design Engine, 999.5 Orchestration
Visualizer, 999.7 editable genui panels, 999.3 connected-env verification, 999.11 polytoken.ai
vision ladder (post-v1.6).)*

<details>
<summary>v1.5 original milestone goal (opened 2026-07-07)</summary>

**Goal:** Activate the dormant knowledge-graph substrate — human confirms materialize
confidence-tiered edges (with OCR token provenance) through a suggest-only promotion gate — adopting
graphify's *algorithms* (tier ladder, bounded neighbour-expand, tier-pruned detail) onto the live
Postgres store, per backlog 999.10's staged plan (stages 1–2 + the cheap recall win; stage-3
BFS-into-prompts explicitly deferred until a retrieval miss is *measured*).

**Target features:**
- **Edge materialization (do regardless):** wire the scaffolded synthesis hook
  (`confirm_region.py:169`) so confirming a region materializes `knowledge_nodes` +
  `knowledge_node_edges` rows (Phase-11 table, currently empty/read-only), tagged EXTRACTED and
  carrying OCR token-polygon provenance — without this every graphify borrow is a no-op
- **Tier ladder + promotion gate (cheap + defensible):** ordinal trust tier
  (EXTRACTED | INFERRED | AMBIGUOUS) on nodes/edges with the float kept as intra-tier score;
  synthesis emits INFERRED/AMBIGUOUS as display-only *suggestions*; a human confirm promotes to
  EXTRACTED; only EXTRACTED is ever trusted for prompt auto-injection ("being wrong is expensive"
  becomes a property of the tier — the design-case defense narrative)
- **Cheap recall win + measurement:** inject the resolved entity's `aliases[]`/`identifiers` into
  the autofill few-shot prompt (no BFS, no migration needed for this part), and instrument
  retrieval outcomes so a retrieval-miss rate becomes measurable — the go/no-go gate for stage 3
- **`/knowledge` canvas fit:** tier → edge visual encoding (EXTRACTED solid / INFERRED dashed /
  AMBIGUOUS faint), click-a-node-expand-neighbours via a bounded (≤2-hop) server graph query, and
  a tier "detail" filter (the budget-prune analog)

**Key context:** Selected autonomously (this run was invoked as `/gsd:new-milestone /gsd:autonomous`
with all confirmation gates off). Rationale: 999.10 is the freshest user-captured intent (committed
2026-07-07, the day of this run, alongside the design-case PDFs and graphify artifacts), it directly
arms the in-person design-case defense, and its scope is backend-testable — a better autonomous fit
than 999.3 (needs live browser/Bedrock), 999.4 Design Engine, or 999.7 (both heavy visual
verification). Explicitly **out of scope** (from 999.10's own honest analysis): seed-then-expand BFS
into autofill prompts, budget-aware tier-pruning of prompts, snapshot/diff + staleness (defer until a
retrieval miss is measured); graphify's static `graph.json` build model and LLM-from-prose extractor
(never borrow); hyperedges (premature).

</details>

## Prior State (v1.4 shipped 2026-07-07)

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

*(v1.4's "Next" resolved: 999.10 became v1.5, shipped 2026-07-08 — see Current State above.)*

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
- ✓ Knowledge-graph uplift: tier ladder (knowledge_trust_tier enum, migrations 0026–0028) + live D-13 synthesis hook (confirm → EXTRACTED edges with OCR token-polygon provenance, supersede-safe) + suggest-only promotion gate (deterministic INFERRED/AMBIGUOUS suggestions, fail-closed promote endpoint, EXTRACTED-only injection read path) + cheap recall win (few-shot rendering seam closed, aliases/identifiers injected) + retrieval-miss-rate instrumentation (the stage-3 go/no-go artifact) + `/knowledge` tiered exploration canvas (tier encoding, cumulative filter, bounded expandNode, promote popover) — v1.5, Phases 29–32 (11/11 reqs; 2 live-env verification gaps deferred)
- ✓ Chat × knowledge convergence: bounded mid-turn tool loop (ToolExecutor port, tool_invocation parts, capability gate, 2 latent bug fixes) + 3 tiered knowledge tools (lookup_entity/search_emails thin wrappers; search_knowledge over extended Python KnowledgeGraphRepository + extracted_only view, migrations 0029–0030) + structural injection quarantine (typed envelopes, FOUND-6 gate, 26-fixture adversarial suite + live Haiku harness, code-gated exposure flip) + per-round cost ceiling + eval dimensions (retrieval/citation/injection in the Phase-16 harness, one fixture source two runners) + tool-round UI with ProvenanceLink citation chips + live data-bound panels (spec.bindings, zero renderer edits) + chat-confirmable promotions (emit_confirm_action, CAS + edge-tier staleness 409) + knowledge-preview canvas node — v1.6, Phases 33–41 (19/19 reqs; 7 deferred items incl. visual UAT)

- ✓ polytoken.ai foundation: atomic internal rename (242 files) + Google OAuth/sessions (@supabase/ssr, protectedProcedure, server-derived X-User-Id) + enforced per-user tenancy (migrations 0031–0034, ownership chokepoint, RLS on 13 tables, adversarially gated incl. same-run 44-09 chat-SSE closure) + email threads at ingest + personal-forwarding seam + kickoff hygiene/dossier — v1.7, Phases 42–46 (19/19 reqs; runbooks + deploys deferred)
- ✓ Polytoken brand & design-system foundation: brand identity (voice/logo/guide, USER-LOCKED naming) + Playwright toolchain + screenshot harness + token-system extensions (pill/success/code + tier-ladder + graph palette + hover-active/breakpoint conventions, WCAG + registration gates) — v1.8, Phases 47–48 (12/12 in-scope reqs; scope cut, RSKN/MOBL/PANL → v1.9)
- ✓ Cloud Workspace: live-loop gate (local stack green e2e w/ DB-verified seeded-session Playwright; migrations 0021–0035 applied+verified staging AND prod; ECS+Vercel deploys green end-to-end after fixing a requirements.txt drift that crashed every prod task; 21-scenario UAT burn-down w/ zero silent parking; screenshot harness extended to /emails/[id] + authenticated surfaces) + total UI re-skin on extended tokens (all major surfaces, 999.16 closed, committed palette-ban gate, cache-invalidation gap closed) + editable genui panels (pack switch, bounded schema-validated param edit w/ server FOUND-6 re-validation, regenerate + version history, one-shot Bedrock NL re-theme) + mobile-responsive answer (canvas islands never mount below md, inline feed, pointer-coarse touch targets) + E3 email-cluster workflow (migration 0036 + feature-detected linkage, EmailThreadNode canvas type, web_search ToolExecutor w/ SSRF guard + 10-fixture adversarial suite + code-gated exposure, source-capture → INFERRED → promote via unmodified PromoteEdgeUseCase, bounded quarantined thread+cluster context injection) — **v1.9, Phases 49–54 (24/27 reqs; LIVE-03/LIVE-04/CLUS-07 shipped UNPROVEN-LIVE as accepted tech debt — see Active)**

### Active

**Carried debt from v1.9 — no development work required, user-only actions.** These are the
milestone's own unmet acceptance criteria, not new scope. Runsheet:
`phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md`. Order: §A → §B.3–6 → §H.

- [ ] **LIVE-03** — Google OAuth live on the deployed app (§A: Google Console + Supabase Dashboard config, then a real sign-in). Everything preppable is done.
- [ ] **LIVE-04** — the user's real email actually flowing in (§B.3–6: copy the `u-{token}@` address, Gmail forwarding handshake, real message w/ attachment, prod-DB verify). SES rule already applied.
- [ ] **CLUS-07** — the six-leg cluster scenario proven live on the real inbox (§H). *This was v1.9's declared acceptance bar.* Blocked only by the two above.

**v1.10 Product Design & Research Canvas — current scope** (REQ-IDs formalized in REQUIREMENTS.md):

- [ ] **Band 1 — Platform:** Tailwind v4 (`@theme`/oklch) + React 19 migration, vendored `packages/ui` revalidated, Radix-vs-Base-UI stance settled (999.12 unparked)
- [ ] **Band 2 — Visual identity (BLOCKING GATE):** distinct directions sketched on real screens, user picks one, palette/type/spacing/signature designed not defaulted (999.18a)
- [ ] **Band 3 — Surfaces:** per-surface UX redesign of inbox, chat+canvas, knowledge, email detail, studio, settings, login + production empty/loading/error states + 999.17 (999.18b/c)
- [ ] **Band 4 — Research canvas:** auto-collected source ledger + canvas source nodes (no capture ceremony), canon-selection UX, edges-as-context, source-grounded presentation panels (999.19 steps 2–5)
- [ ] **Band 5 — Email learning loop:** learn-from-corrections over the suggest-only stance, never auto-decide (999.19 step 1)

**Carried v1.9 debt — user-only actions, no development work, declined twice (2026-07-14):**

- [ ] **LIVE-03** — Google OAuth live on the deployed app (§A)
- [ ] **LIVE-04** — the user's real email actually flowing in (§B.3–6)
- [ ] **CLUS-07** — the six-leg cluster scenario on the real inbox (§H). *Was v1.9's declared acceptance bar.*

**Next epoch (after v1.10):**

- [ ] **v2.0 Local Agent Platform (E4+E5+E6 merged):** daemon + ONE permission model + generalized ToolExecutor; watched folders → directory panels with Claude-Code-class attached chats (fs/terminal/git); browser panel CDP-first; tool registry as per-user allowlist; `/gsd:secure-phase` on every daemon phase. Plan of record: ENDGAME-PLAN.md §3.
- [ ] **999.20 — deep nauta purge in live state:** migration 0037 for `entity_instances.nauta_id` (lockstep with drizzle + Python domain/repo + tests), the AWS `nauta-services-*` resources (re-parked Hazard A/B/C — the S3 bucket holds real inbound email), local directory rename.

### Out of Scope

- Per-importer entity-type overrides (system-default types only, Phase 9)
- Server-side deny-restore endpoint (optimistic-only undo today — Phase 9 follow-up)
- E7 distributed inference/compute pooling — parked venture decision (ENDGAME-PLAN.md §4); sole obligation: keep the v2.0 daemon protocol job-shaped
- DSGN-02 visual-compare repair loop + DSGN-04 screenshot→token extraction (not "cheap"; v2+)
- Native mobile apps (web-first, mobile-responsive only) · Tailwind v4/React 19 migration (999.12, orthogonal platform risk) · marketing site (post-launch)

## Context

- **Codebase after v1.9:** monorepo — `apps/web` (Next.js 15 / React 18 / Tailwind 3.4),
  `apps/email-listener` (FastAPI, Clean Architecture), `packages/{db,api-client,ui,genui}`.
  Migrations through 0036 (all applied local + staging + prod). Repo `pedromshin/polytoken.ai`
  (renamed 2026-07-13; IAM OIDC deploy trust re-pinned the same sitting).
- Conventions copied from examples/acme-os-dev. Tooling: uv, ruff (120 cols), mypy, pytest,
  import-linter; **npm workspaces, NOT pnpm** (pnpm pollutes the tree). Playwright for E2E +
  the 16-surface screenshot harness (`npm run screenshot:review`).
- **User feedback theme (v1.9 close, load-bearing):** the product's capability outran its craft.
  The user's verdict on the live app: *"the whole UI is still ugly/experimental, not a production
  UI — not just tokens and colors."* Three milestones of foundation/paint (v1.7/v1.8/v1.9's
  re-skin band) delivered token discipline but never visual design — the same "foundation
  out-sequenced felt value" complaint that triggered v1.8's scope cut, resurfacing. Backlog
  999.18. A second theme (999.19): capture ceremony is friction — sources should already be
  related to the research without the user confirming each one.
- **Known state gap:** the deployed app has never been signed into, and no real email has flowed.
  See Current State.
- Webhook is provider-agnostic by decision; SES→S3→SQS is the live edge (catch-all rule applied).
- Design case: `0 - nauta_design_case.pdf`. Walkthrough: context/5 - walkthrough.md.

## Constraints

- **Tech stack**: Python 3.11 FastAPI + Next.js/React 18 + Tailwind 3.4, Docker, Terraform,
  GitHub Actions. Tailwind v4 / React 19 migration deliberately parked (999.12, orthogonal risk).
- **Deploy**: AWS ECS Fargate (user-confirmed pattern); dev→staging, main→production; Vercel git
  auto-deploy for web. Migrations-first, always. The Deploy workflow has its own test gate — red
  tests block deploy.
- **Security**: secrets via AWS Secrets Manager / env vars only; API key auth fails closed outside
  development; per-user tenancy enforced at the app boundary (primary) + RLS (defense-in-depth);
  suggest-only for all knowledge mutations — never auto-decide.
- **LLM transport**: AWS Bedrock via IAM role for Claude + embeddings — NOT the Anthropic direct
  API. No `ANTHROPIC_API_KEY`.
- **Coverage gate**: `apps/email-listener` pytest ratcheted to 65 (user-approved 2026-07-12);
  step-up ladder 70@72% / 75@77% / 80@82%, never lower further.
- **Standing rule (established v1.8 close, overridden once at the v1.9 close):**
  deploy/OAuth/live-UAT gates are first-class phase work, never deferrable-by-default — a
  milestone isn't done until the user has touched the capability live.

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
| **v1.5**: Trust tier as independent ordinal enum, NOT NULL DEFAULT 'AMBIGUOUS' | Fail toward least trust; `source` stays mechanism-provenance, `confidence real` stays intra-tier score — graphify's ladder page with governance graphify never needed | ✓ Good — the suggest-only promotion gate is a property of the tier, defensible column-by-column |
| **v1.5**: Knowledge node 1:1 with confirmed region (scope_ref=email_component) | Makes deactivate_edges_for_node(node) supersede exactly that region's edges — no sibling-region collateral, clean deactivate-then-insert, resolves the promote-after-confirm pipeline-ordering hazard | ✓ Good — SYNTH-03 verified with no duplicates/orphans |
| **v1.5**: Injection gate ships before its consumer (`list_injectable_edges`, zero callers) | The EXTRACTED-only read path exists BEFORE stage-3 BFS can be built, so the consumer can never ship ungated; alias injection reads entity_instances directly and doesn't need it | — Pending — becomes load-bearing only if KGX-01 is ever justified by the miss-rate artifact |
| **v1.5**: Stage-3 graph-expand gated on a MEASURED retrieval miss (0028 events + miss-rate script) | 999.10's own honest discount: flat RRF is fine for similar documents; graph apparatus only pays off against a demonstrated miss rate — measurement-gated architecture evolution | — Pending — artifact live; needs correction volume to produce a meaningful number |
| **v1.6**: Server tools via a `ToolExecutor` domain port + bounded in-stream round loop (never recursion, one ChatRun per turn) | Preserves SEAM-04's invariant; additive-default seam mirrors `interactive_widget_tools`; capability gate doubles as the on/off switch (`max_tool_rounds=0`) | ✓ Good — 9/9 seams WIRED at audit; OpenRouter cleanly excluded |
| **v1.6**: EXTRACTED-only by structural unreachability, three belts (SQL view → field omission → FOUND-6 envelope gate) | A forgotten WHERE clause must not be able to leak non-EXTRACTED text; belts are independent failure domains | ✓ Good — adversarial fixture proved the view holds under crafted search |
| **v1.6**: Exposure flips are code-gated on the adversarial suite passing in the same run | "Being wrong is expensive" extended to tool exposure — never a speculative toggle | ✓ Good — flag flipped only after 26-fixture suite + live Haiku harness (7/7) green |
| **v1.6**: `emit_confirm_action` carries only a `suggestion_ref`; server re-reads the live edge and freezes the schema at emission; submit re-checks tier vs declaration snapshot | The LLM never touches mutation params (optionId-not-title precedent); out-of-band promotions surface as 409 stale before any mutation | ✓ Good — 409-stale no-double-mutation proven by test |
| **v1.6**: New SSE frame names (`server_tool_call`/`server_tool_result`) instead of reusing the persisted event names | The client's `applyRunEvent` already owned `tool_call` for genui streaming — reuse would mis-fold real tool rounds (live bug found + fixed) | ✓ Good — collision guard + regression test shipped |
| **v1.6**: ONE `<ProvenanceLink>`/`hrefFor` primitive for all provenance links; routes recomputed from kind+id, never trusted from data | Decided once, used twice (chips + preview node); server-supplied route strings are an injection surface | ✓ Good — grep-verified single source of route logic |
| **v1.7 Phase 44 (TENA-04)**: app-boundary enforcement is PRIMARY (session-derived `user_id`, never client-supplied); Supabase RLS policies are DEFENSE-IN-DEPTH only | Drizzle connects as the Postgres **superuser** via `POSTGRES_URL_NON_POOLING` (`packages/db/src/client.ts:28-36`) because the transaction-mode pooler strips superuser privileges and breaks `auth.uid()` — every app query issued through Drizzle already bypasses RLS. The app-boundary is therefore the real wall; RLS defends only PostgREST/future non-superuser paths. Recorded BEFORE any RLS policy work begins (Plan 04 ordering gate) | ✓ Good — adversarial gate (44-08/44-09) proved the app boundary holds on every surface; RLS live on 13 tables |
| **v1.7 Phase 44**: `genui_generation_events` and `ui_spec_templates` stay deliberately unscoped (no `user_id`) | These are exact-match cache tables — cross-tenant cache hits are the intended behavior, not a tenancy gap; documented in schema comments to stop a future reader from "fixing" it | ✓ Good — matches the pre-existing `importer_id`-nullable/no-FK idiom already used on these tables |
| **v1.7 Phase 43**: browser-safe public env split (`env.public.ts`, literal `NEXT_PUBLIC_*` access) after full-schema `env.ts` crashed every client component importing it | Client bundles have no real `process.env`; only literal property access is inlined — one Zod schema for both worlds is structurally impossible | ✓ Good — fix a2251e7; login page renders; integration checker verified 0/133 client files import full env |
| **v1.7 Phase 44**: gap-closure escalated (not parked) for the chat-SSE cross-tenant hole discovered by the acceptance gate | The milestone's literal bar was "unreachable across users via ANY route"; a live security hole in the tenancy milestone is the definition of a blocking gap | ✓ Good — 44-09 closed it same-run; pre-stream 404 fail-closed gating |
| **v1.7 Phase 45**: threads importer-anchored, chat direct-user_id; false-split beats false-merge in grouping | Threads inherit tenancy through importers (no second scoping system); conservative Tier-2 fallback avoids merging strangers' mail | — Pending (live forwarding round-trip UAT outstanding) |
| **v1.7 Phase 46**: accepted override for the real-browser Playwright run (AST-allowlist vitest substitute green) | Closing it required new npm deps, violating the milestone's one-new-dependency guardrail — a stronger locked constraint | — Pending (todo parked; unblocks in v1.8) |
| **v1.8 Phase 47 (BRND)**: Product name USER-LOCKED to 'polytoken', domain polytoken.ai; warm/companion voice register (tone) + node/brain logo mark adopted | User decided this on 2026-07-10 ("everything will be called polytoken and domain polytoken.ai. everything else is purged"), OVERRIDING the dossier's Direction-B rename recommendation; the exact-name collision with the `polytoken` CLI dev tool (docs.polytoken.dev) is EXPLICITLY ACCEPTED (not mitigated); domain purchase + trademark filing remain user-gated (not done) | ✓ Good — see `docs/design/brand-guide.md` for the repo-of-record |
| **v1.8 scope cut + two-epoch endgame (USER-DIRECTED 2026-07-10)**: v1.8 ends at Phase 48; RSKN/MOBL/PANL (11 reqs) → v1.9; ALL remaining vision compresses into TWO epochs — v1.9 "Cloud Workspace" (live-loop gate FIRST, then re-skin/mobile/panels + E3 email-cluster workflow depth-first on the user's real inbox) and v2.0 "Local Agent Platform" (E4+E5+E6 merged on one daemon/permission-model/ToolExecutor foundation; browser CDP-first, registry as allowlist panel; editor + self-repo stretch); E7 parked as a venture decision | User verdict after v1.5–v1.8: capability shipped but was never felt — deploys/OAuth/live-UAT were autonomously deferred at six consecutive closes, the user's real email never entered the system, and foundation/paint kept out-sequencing value (E3 stayed "one epoch away" for three milestones). Full diagnosis + plan: `.planning/research/two-epoch-endgame/ENDGAME-PLAN.md` | ⚠️ **Revisit** — the epoch restructure worked (E3 shipped in v1.9, one milestone later, not "one epoch away"). The STANDING RULE did not: v1.9 closed on 2026-07-14 with §A/§B/§H still unexecuted, by explicit user choice at the gate. Seven consecutive closes now without the user touching the live loop. The rule correctly *blocked* and correctly *surfaced* the conflict — it was overridden, not evaded |
| **v1.9 §E.2 — email-listener coverage gate ratcheted 80 → 65 (user-approved 2026-07-12)** | The gate blocked every ECS image deploy at 68.10% actual, with all tests passing. Ratcheted openly with a step-up ladder (70@72% / 75@77% / 80@82%, never lower further) tracked as a todo, rather than silently lowered or bypassed | ✓ Good, and it paid off unexpectedly: letting images deploy again immediately exposed a SECOND hidden blocker (requirements.txt drifted from pyproject → `ModuleNotFoundError: jsonschema` crashed every prod task, ECS circuit breaker rolling back each rollout). The coverage gate had been masking a total prod outage. Now guarded by `tests/test_requirements_sync.py` |
| **v1.9 — AWS/Terraform resource renames explicitly RE-PARKED; GitHub rename EXECUTED with its OIDC apply in the same sitting** | Re-park rationale: hazard A (two unsynced sources of truth — Terraform vars vs hardcoded GitHub Actions env), hazard B (ECR `force_delete=false` destroy+recreate risk), hazard C (local-only un-backed-up tfstate) — high blast radius, zero user-facing value. GitHub rename rationale: renaming the repo breaks the IAM trust policy pinned to the old path, so rename + `terraform apply` had to be one operation | ✓ Good — repo is `pedromshin/polytoken.ai`, trust re-pinned (`02fc71c`), no deploy downtime. Decisions recorded in `EXTERNAL-IDENTITY-DECISIONS.md`; the AWS re-park is a deliberate, documented park, not drift |
| **v1.9 — feature-detected schema columns (`tableColumnExists`)** | Migration 0036 shipped to code before it was applied anywhere; every read/write of a not-yet-migrated column is gated by a per-process-cached probe that fails closed to "not present", so the app degrades instead of 500ing | ✓ Good — the repo's single feature-detection point; thread-linkage degraded cleanly for the whole window 0036 was unapplied |
| **v1.9 — `web_search` shipped dark, then flipped** | Exposure code-gated behind `WEB_SEARCH_TOOL_ENABLED` until the 10-fixture adversarial prompt-injection suite passed — same discipline as the v1.6 tools | ✓ Good — and a live-network smoke test caught a real envelope-truncation bug that could cut mid-JSON before any user saw it |
| **v1.9 — mobile = don't mount, not just hide** | Below `md`, the React-Flow canvas islands on `/chat` and `/knowledge` are never mounted (not CSS-hidden), per the market-validated pattern (ChatGPT removed Canvas 2026-05-28 over cross-surface inconsistency; Claude Artifacts render inline) | ⚠️ Revisit — correct for performance and for the feed UX, but it produced backlog 999.17: Phase 52 wired panel editing only into the canvas node, so PANL-01..04 is desktop-canvas-only and canvas-side edits never surface in the docked/mobile view of the same conversation. A real cost of running Phases 52 and 53 in parallel |
| **v1.9 close — proceed despite `gaps_found` (USER-DIRECTED 2026-07-14)**: archive v1.9 with LIVE-03/LIVE-04/CLUS-07 unproven-live, recorded as accepted tech debt | The audit verdict said complete-milestone must not run until §A/§B.3–6/§H were executed; the user chose to proceed anyway at the gate, overriding the standing rule they themselves locked at the v1.8 close | — Pending. The bet: shipping the record now and closing the live legs later costs nothing but honesty in the docs. The risk it re-runs: this is the exact pattern ("capability shipped but never felt") the two-epoch restructure existed to break. Watch whether §A/§B/§H actually get executed before the next milestone's work begins |
| **v1.9 close — 999.18 raised: no phase has ever done visual design** | User's verdict on the live app: *"the whole UI is still ugly/experimental, not a production UI — not just tokens and colors."* Phase 51 "Total UI Re-skin" was scoped and executed as token-hygiene only — its own UI-SPEC said "refinement, not redesign". Base palette is still stock-shadcn; the brand guide defines the polytoken register only as voice/tone | — Pending — filed as backlog 999.18 (HIGH PRIORITY), top candidate for the next milestone. Lesson for scoping: "re-skin" read as design intent to the reader but as hygiene to the executor, and no one caught the gap until the user looked at real screens. A design-review loop on real screens must precede cascading — autonomous runs cannot make taste decisions |

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
*Last updated: 2026-07-14 after v1.9 Cloud Workspace milestone (24/27 reqs; LIVE-03/LIVE-04/CLUS-07 shipped unproven-live as user-accepted tech debt — §A/§B.3–6/§H in MORNING-CHECKLIST.md close them with zero development work. Next milestone not yet opened; 999.18 production UI/UX rebuild is the top candidate.)*
