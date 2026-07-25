# Requirements: polytoken — v1.11 Research Core & the Capability Spine

**Defined:** 2026-07-20
**Core Value:** Leave Claude web for research — in-chat deep research that cites, exports, and
composes — with every capability declared once in a registry the LLM, genui, the canvas, and the
daemon all read.

**Sources (user's own words):** DIRECTIVES-2026-07-17.md D2 ("a self building product … the product
emanated from this project, which is its infrastructure … we piece it together using our genui
engine") + D1 (taste is permanent) + D4 (AI-engineering depth); NIGHT-RUN-2026-07-16.md
authorization ("do as much as possible from the whole thing … up to 2.2"); derived draft
`night-run/reports/negative-space.md` §3 (feeds this milestone, does not bypass it).

**THE SPINE (D2, this milestone's defining move):** every feature the user named — deep research,
PDF export, mail rules, files, sessions, the OSS ontology, the daemon — is a *composition* problem,
not a *construction* problem. So the registry (`packages/capabilities`) is built first, and the
named features fall out of it. The registry is deliberately kept CHEAP: a zod declaration + a
lookup, landed inside this milestone (Phase 68), never a milestone-sized platform.

**INV-2 (time-sensitive):** the daemon (Phase 65, shipped 2026-07-17) already carries a tool
abstraction with the frozen registry field names. Phase 68 reconciles it to the shared package
BEFORE the two diverge under load — an import change, not a rewrite (registry.ts is pre-seamed).

**Carried from v1.10 (pixel-gated on the user, not blocking v1.11):** SURF-03/05/06 (Phase 62) and
RCNV-02/03/05 (Phase 63) remain open; both phases need the user's on-screen review per the taste
gate. v1.11 opens in parallel as an authorized advance ("up to 2.2").

## v1.11 v1 Requirements

### Capability Registry (REG — the D2 spine; INV-1..7)

- [ ] **REG-01**: One capability registry — every tool/query/mutation/data-source declares itself once with zod input/output + metadata (`describe`, `cost`, `risk`, `source`, `trust`); readable by the LLM (as a tool), genui (as a composable block), the daemon (as an executable), and the canvas (as a node type)
- [ ] **REG-02**: The chat tool loop enumerates its tools FROM the registry; the prior hand-maintained tool list no longer exists (grep-provable, not merely unused)
- [ ] **REG-03**: The daemon's ToolExecutor + permission model resolve by registry id; the allowlist keys on registry ids; the permission prompt renders from the entry's `risk` field — one store, not two (INV-2, INV-4)
- [ ] **REG-04**: A genui spec can BIND a registry capability — a generated panel performs a real query and a real mutation, bounded by the registry; an unregistered capability fails closed (INV-5 — D2's minimum viable proof)

### In-Chat Deep Research (RSRCH)

- [ ] **RSRCH-01**: A research request in chat runs a real multi-step agentic loop (plan → search rounds → fetch/read → adversarial verify → synthesize), streaming progress as tool rounds
- [ ] **RSRCH-02**: Every claim in a report resolves to its source via 3-tier disclosure on the existing `pmark` (mark → hover popover → sources panel); no footnote-number system, no new citation component (taste §3)
- [ ] **RSRCH-03**: Sources used auto-land in the RCNV-01 ledger and appear as canvas nodes (reusing Phase 63's RCNV-02 work) — zero capture ceremony
- [ ] **RSRCH-04**: A running research job accepts mid-stream refinement without restart; its trace collapses to one line when done, one click to re-expand
- [ ] **RSRCH-05**: Research quality is measured — a fixed question set + scored rubric, re-runnable, so a regression is detectable rather than felt

### Documents (DOCS)

- [ ] **DOCS-01**: Any report/message exports to a typeset PDF on the locked identity (serif evidence, 45–75ch measure, provenance marks preserved)
- [ ] **DOCS-02**: Documents are first-class objects — stored, listed, re-openable, linkable as canvas nodes — not one-shot downloads
- [ ] **DOCS-03**: A document is regenerable from its spec + ledger; provenance survives regeneration (INV-7)

### Mail Rules (MAIL — frozen at the fixture slice; real-mail switch escrowed to v1.12)

- [ ] **MAIL-01**: The rules matcher runs over the fixture corpus, suggest-only, reviewed in-context near the inbox (HEY Screener model, never a `/settings` Rules page — taste §3)
- [ ] **MAIL-02**: Rules execute as registry capabilities, not a bespoke engine — the generality proof that REG isn't a one-consumer abstraction

## v1.10 Requirements (prior milestone — carried items still open)

**Defined:** 2026-07-14
**Core Value:** Reliably receive every inbound email and make it observable — now as a *designed*
product the user actually lives in: a research canvas that collects sources without ceremony, lets
the user select a personal canon, and treats canvas edges as context.

Sources: backlog 999.18 (production UI/UX rebuild — user verdict 2026-07-12), 999.19 (frictionless
research canvas — user's target workflow in their own words, 2026-07-12), 999.12 (Tailwind v4 /
React 19 migration, unparked 2026-07-14), 999.17 (editable-panel chrome on mobile). Sequenced ahead
of ENDGAME-PLAN.md's v2.0 by user decision 2026-07-14 (999.18/999.19 postdate the endgame lock and
argue design-before-more-surfaces).

**STANDING RULE (carried from v1.8, overridden once at v1.9 close — back in force):**
deploy/OAuth/live-UAT gates are first-class phase work, never deferrable-by-default; a milestone
isn't done until the user has touched the capability live.

**TASTE GATE (this milestone's defining constraint):** the visual identity is chosen by the USER
from sketched directions on real screens (IDNT-01/02), not derived autonomously. 999.18(d):
v1.9's autonomous-overnight approach cannot make taste decisions — that is what produced "the
whole UI is still ugly." No surface redesign (SURF-*) or canvas-visual work cascades before
IDNT-02 is locked.

## v1 Requirements

### Platform Migration (STCK — Band 1; palette-independent, runs first)

- [x] **STCK-01**: `apps/web` + `packages/ui` build and run on Tailwind v4 — the HSL tokens in `globals.css` are ported to `@theme`/oklch, and every existing WCAG-AA contrast + token-family-registration regression gate stays green on the new engine
- [x] **STCK-02**: `apps/web` + `packages/ui` build and run on React 19 — every vendored `packages/ui` component is revalidated and renders correctly (no runtime regressions in the 16-surface screenshot harness)
- [x] **STCK-03**: The Radix-vs-Base-UI primitive stance is decided and documented (upstream shadcn moved its default primitives to Base UI, 2026-07); the design-system skill is updated to match
- [x] **STCK-04**: A direct shadcn registry install (`shadcn add @kibo-ui/…`) works in place of the vendor-and-adapt workflow — verified on at least one real component (the payoff that justifies the migration)

### Visual Identity (IDNT — Band 2; BLOCKING HUMAN GATE)

- [x] **IDNT-01**: 2–3 distinct visual directions are sketched on real polytoken screens (throwaway HTML, real content — inbox, chat, one canvas surface) so the user can compare actual looks, not swatches
- [x] **IDNT-02**: The user selects one direction; the choice is recorded as the locked visual identity. **This is the gate — no SURF-* or canvas-visual work begins before it.**
- [x] **IDNT-03**: The locked direction is realized as a designed token set — palette (oklch), type scale, spacing/density system, and a signature element — that *replaces* the stock-shadcn defaults rather than recoloring them
- [x] **IDNT-04**: The brand guide gains a visual-identity section (today it defines only voice/tone) documenting the designed palette/type/spacing/signature with usage rules

### Surface Redesign (SURF — Band 3; depends on IDNT-02)

- [x] **SURF-01**: The inbox (three-pane, thread groups, mobile feed) is redesigned on the new identity — layout, hierarchy, information density, interactions — not merely re-tokened
- [x] **SURF-02**: `/chat` + its canvas is redesigned on the new identity (composer, message stream, tool-round rows, panels, canvas chrome)
- [ ] **SURF-03**: The `/knowledge` canvas is redesigned on the new identity
- [x] **SURF-04**: The email-detail view (`/emails/[id]`, region overlays) is redesigned on the new identity
- [ ] **SURF-05**: `/studio`, `/settings/*`, and `/login` are redesigned on the new identity
- [ ] **SURF-06**: Every redesigned surface has production-grade empty, loading, and error states (not first-draft placeholders)
- [x] **SURF-07**: Editable-panel chrome is reachable on mobile and the docked/mobile transcript honors panel overlays (closes 999.17)

### Research Canvas (RCNV — Band 4; backend palette-independent, visuals depend on IDNT-02)

- [x] **RCNV-01**: Sources the agent uses in a conversation (web_search results and other tool outputs) are auto-collected into a per-conversation source ledger — no per-turn capture-confirm ceremony (today's CLUS-04 widget is the explicit anti-goal)
- [ ] **RCNV-02**: Auto-collected sources appear as nodes on the canvas, visibly related to the research, without the user asking
- [ ] **RCNV-03**: The user can select auto-collected sources into a personal canon through a canvas-level curation UX built over the existing suggest-only promotion gate (INFERRED → EXTRACTED), never per-turn chat widgets
- [x] **RCNV-04**: Connecting a source / generated-table / panel node to a chat node on the canvas injects that node's content as context for that chat — semantic edges, not visual-only (canvas sharedState was explicitly NOT the linkage store per D-54; this needs its own design)
- [ ] **RCNV-05**: The user can generate presentation-grade UI panels grounded in the selected canon/sources (source-grounded genui)

### Email Learning Loop (LEARN — Band 5; palette-independent, runs early)

- [x] **LEARN-01**: The user can correct what an email or extracted entity *is* (classification/extraction), and the correction is captured as structured, addressable signal
- [x] **LEARN-02**: Accumulated corrections improve subsequent classification/extraction for the same or similar entities — extending the suggest-only entity-resolution stance, **never auto-deciding**

## v2 Requirements

### Local Agent Platform (deferred to v2.0 — ENDGAME-PLAN.md §3)

- **DMON-**: daemon + ONE permission model + generalized ToolExecutor; watched folders → directory panels with Claude-Code-class attached chats (fs/terminal/git); browser panel CDP-first; tool registry as per-user allowlist; embedded editor + agent self-repository as stretch

### Deep nauta purge in live state (999.20 — next, needs DB access + user-driven infra)

- **PURG-**: migration 0037 for `entity_instances.nauta_id` (lockstep drizzle + Python domain/repo + tests); AWS `nauta-services-*` resource renames (re-parked Hazard A/B/C — S3 bucket holds real inbound email); local directory rename

## Out of Scope

| Feature | Reason |
|---------|--------|
| The three v1.9 live legs — LIVE-03 (§A OAuth), LIVE-04 (§B.3–6 real email), CLUS-07 (§H) | Owed as v1.9 debt (user declined to fold in, 2026-07-14, second ask); user-only console actions, no dev work — MORNING-CHECKLIST.md. Consequence: inbox/canvas redesigned against seeded fixtures, LEARN loop built without a real inbound message |
| v2.0 Local Agent Platform | The next epoch; lands on the finished UI this milestone produces |
| Perception/vision browser stack (pixelrag/ui-tars/etc.) | v2.0 E5 research fork, deliberately not locked now |
| Native mobile apps | Web-first, mobile-responsive only (VISION E2) |
| DSGN-02 visual-compare repair loop / DSGN-04 screenshot→token extraction | Not "cheap"; v2+ (999.4) |
| A promptable design system beyond the shipped NL re-theme (PANL-04) | Generation-side design engine is v2+ (999.4) |

## Traceability

Which phases cover which requirements. Filled by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STCK-01 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-02 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-03 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| STCK-04 | Phase 55 — Platform Migration: Tailwind v4 + React 19 | Complete |
| RCNV-01 | Phase 56 — Research Canvas: Backend & Semantic Context Model | Complete |
| RCNV-04 | Phase 56 — Research Canvas: Backend & Semantic Context Model | Complete |
| LEARN-01 | Phase 57 — Email Learning Loop | Complete |
| LEARN-02 | Phase 57 — Email Learning Loop | Complete |
| IDNT-01 | Phase 58 — Visual Identity: Sketch & Pick (HUMAN GATE) | Complete |
| IDNT-02 | Phase 58 — Visual Identity: Sketch & Pick (HUMAN GATE) | Complete |
| IDNT-03 | Phase 59 — Visual Identity: Designed Token Set & Brand Guide | Complete |
| IDNT-04 | Phase 59 — Visual Identity: Designed Token Set & Brand Guide | Complete |
| SURF-01 | Phase 60 — Surface Redesign: Inbox & Email Detail | Complete |
| SURF-04 | Phase 60 — Surface Redesign: Inbox & Email Detail | Complete |
| SURF-02 | Phase 61 — Surface Redesign: Chat, Canvas & Mobile Panel Chrome | Complete |
| SURF-07 | Phase 61 — Surface Redesign: Chat, Canvas & Mobile Panel Chrome | Complete |
| SURF-03 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| SURF-05 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| SURF-06 | Phase 62 — Surface Redesign: Knowledge, Studio & Production States | Pending |
| RCNV-02 | Phase 63 — Research Canvas: Visual Surfaces | Pending |
| RCNV-03 | Phase 63 — Research Canvas: Visual Surfaces | Pending |
| RCNV-05 | Phase 63 — Research Canvas: Visual Surfaces | Pending |

**Coverage:**
- v1 requirements: 22 total (STCK 4 + IDNT 4 + SURF 7 + RCNV 5 + LEARN 2)
- Mapped to phases: 22/22 ✓
- Unmapped: 0

**Note on RCNV-03:** RCNV-03 ("user can select auto-collected sources into a personal canon
through a canvas-level curation UX") is owned by Phase 63 because the requirement is only
user-observably TRUE once the canvas curation UX exists. Phase 56 lays the palette-independent
promotion-gate-reuse groundwork it depends on, but does not claim the requirement.

---
*Requirements defined: 2026-07-14 (from the v1.10 opening Q&A; yolo mode, user asleep — scoping taken from the recorded decisions rather than an interactive pass)*
*Last updated: 2026-07-15 — ROADMAP.md created (Phases 55–63); traceability filled, 22/22 requirements mapped, coverage complete*


---

## vNEXT — The Living Canvas Requirements

**Defined:** 2026-07-25
**Core Value:** The canvas becomes a living, agent-authored substrate over the compounding personal
graph — the agent draws, wires, recomputes, schedules, grounds, and exposes running instruments; the
payoff of the v1.11 capability spine pointed OUTWARD.

**Union of the 41 REQ ids the five specs coined (LCAN 9 + MORN 7 + CPF 6 + BTAP 10 + MCPX 9):**

### Living-Canvas Agent Dataflow (LCAN — Phase 73, the foundation)

- [ ] **LCAN-01**: A `canvas_connect` message part materializes exactly one `data-edge` between the two named node keys; re-materializing the same part (post-turn refetch) is an idempotent no-op
- [ ] **LCAN-02**: `emit_canvas_connect` is registered in the listener capability registry ONLY when `CANVAS_EMIT_TOOL_ENABLED` is set; fails closed / absent otherwise
- [ ] **LCAN-03**: A source-capable node publishes a bounded projection (size-capped, no spec content, prototype-pollution-guarded) to `shared.published.{nodeKey}` through the bounded 5-mutation enum
- [ ] **LCAN-04**: With a wired edge `published.{src}.total → input`, changing the source's published value re-renders the target's overlaid value within one store tick (no manual refresh)
- [ ] **LCAN-05**: A wired recipe round-trips reload — edge + `sharedState` published value restore exactly, asserted against the DB row
- [ ] **LCAN-06**: The data edge stays neutral — no tier hue is introduced by wiring (Law 1)
- [ ] **LCAN-07**: A `canvas_recipes` row persists name + node/edge key-set; a recipe badge/name renders on the canvas grouping its member nodes
- [ ] **LCAN-08**: Tenancy — every new procedure is `protectedProcedure` with ownership asserted FIRST; a non-owned conversation surfaces NOT_FOUND before any read/write
- [ ] **LCAN-09 (LIVE)**: Durable after-close recompute — the Task-7 graphile-worker re-polls the recipe's `sourceRef`, recomputes, and bumps the published value server-side while the tab is closed

### Self-Assembling Morning Board (MORN — Phase 74)

- [ ] **MORN-01**: A new `assemble_morning_board` identifier is accepted by the `enqueue_job` allowlist (new forward migration) and present in the worker `taskList`; an unknown-identifier enqueue still raises
- [ ] **MORN-02**: The worker `crontab` enqueues `assemble_morning_board` on schedule AND fans out one job per active user with an idempotent `job_key` (N users → N jobs, re-run replaces)
- [ ] **MORN-03**: `/v1/home/assemble-job` raises (→ 5xx) on any failure (never swallow-to-200) and is api-key-guarded
- [ ] **MORN-04**: The service-role home writer persists a snapshot keyed on the job's `user_id` (NOT a session), stamps `scope='home'`, and is tenancy-safe — a write for user A can never land on user B's home row
- [ ] **MORN-05**: The composed snapshot validates against `CanvasSnapshotSchema` and every node type resolves in `node-types.ts` (or degrades to the placeholder — no blank canvas)
- [ ] **MORN-06**: `MORNING_BOARD_ENABLED=False` fully darkens the path (no cron enqueue, no assembly)
- [ ] **MORN-07 (LIVE)**: After a real scheduled run against the seed user's real inbox, loading `/home` in a fresh browser shows the pre-assembled board with correct counts + a generation timestamp — a `screenshot:review` capture

### Correction-Propagation Flywheel (CPF — Phase 75)

- [ ] **CPF-01**: A `CascadeCorrectionUseCase` promotes exactly the active `AMBIGUOUS`/`INFERRED` sender→entity suggestion edges touching the merge's survivor/absorbed (reusing existing promote guards); importer_id derived from the loaded survivor row (D-21), never a caller arg
- [ ] **CPF-02**: The cascade is idempotent — re-running for the same (S,T)/`job_key` promotes nothing already promoted and writes no duplicate `correction_propagations` row
- [ ] **CPF-03**: A `correction_propagations` migration + repository test — one importer-scoped ledger row records survivor, absorbed id, promoted edge ids, enqueued affected `email_ids`; a cross-importer read returns nothing (TENA-03 / D-21)
- [ ] **CPF-04**: `entities.confirmMerge` (tRPC) returns a cascade summary `{ promotedEdgeIds, affectedEmailIds, survivorId, absorbedId }`; both-side ownership still asserted before any listener call
- [ ] **CPF-05**: On a merge success the propagation reconcile invalidates `api.entities.byId` for BOTH survivor and absorbed ids (in addition to `reviewQueue` + `list`), marking placed `EntityNode`s stale
- [ ] **CPF-06 (LIVE-ish, real browser)**: After a merge on a `ReviewQueueNode`, a co-placed survivor `EntityNode` visibly gains the absorbed alias + updated counts and the absorbed node shows its "merged into another" state — captured via `screenshot:review`
- [ ] **(named live leg)** The re-label fan-out actually re-points the absorbed target's past-email links onto the survivor in a real Postgres (needs migrations 0038/0039 + the new migration applied live + worker running)

### Bespoke Task Apps / Code-Islands over Your Data (BTAP — Phase 76)

- [ ] **BTAP-01**: `buildIslandSrcdoc({ code, data })` injects `data` as a frozen `window.__ISLAND_DATA__` via `JSON.stringify` (a string, never executed), BEFORE the user script; over-cap/pollution-keyed data rejected; `ISLAND_CSP_POLICY` + `ISLAND_SANDBOX` byte-for-byte unchanged (`connect-src 'none'` preserved)
- [ ] **BTAP-02**: A `code-island` node type exists in `CANVAS_NODE_DATA_SCHEMAS` AND `NODE_TYPE_REGISTRY` with ref-only `node.data = { islandId, label? }`; the apps/web ⇄ capabilities node-id drift test stays green
- [ ] **BTAP-03**: With two data-edges wired in, the node collects both overlaid inputs from `usePanelData` and passes `{ [targetKey]: projection }` into the sandbox; changing a source's published value re-renders the island within one store tick (code prop stable, injected data changes)
- [ ] **BTAP-04**: `code_islands` round-trips — `create` then `byId` returns `{ intent, code, inputBindings }` for the owner; a non-owner `byId` surfaces NOT_FOUND before any read (asserted against the DB row)
- [ ] **BTAP-05**: `codeIslandGenerate` accepts a bounded `inputs` manifest (columns ≤ 64, sample rows ≤ small N, no full dataset), forwards it to FastAPI; omitting `inputs` preserves today's intent-only behaviour exactly
- [ ] **BTAP-06**: The "Build a tool from these" flow, given ≥2 selected data nodes, produces exactly ONE `code-island` node and one `data-edge` per source, idempotent on re-run of the same selection
- [ ] **BTAP-07 (LIVE)**: Agent-authored — "build me a reconciler from these two nodes" in chat → the listener `emit_code_island` tool (behind `CANVAS_EMIT_TOOL_ENABLED`, fails closed) emits a part that runs the grounding flow and materializes the wired node live in one turn
- [ ] **BTAP-08**: The generated island is still gated by the shipped safety stack — `validateIslandCode` runs before execution and a fetch/XHR/eval/parent-access attempt is BLOCKED even with data present; the frame remains opaque-origin with `connect-src 'none'`
- [ ] **BTAP-09**: Tenancy — every new `codeIslands.*` procedure is `protectedProcedure` with ownership asserted FIRST; the generation cache posture unchanged (auth-gate only)
- [ ] **BTAP-10**: Disposability — deleting the `code-island` node removes only the placement; the `code_islands` row survives unless explicitly removed via `codeIslands.remove`

### Life-as-MCP-Tool-Surface (MCPX — Phase 77, expose-only)

- [ ] **MCPX-01**: `tools/list` returns exactly the expose-allowlisted tools; every listed id exists in `BUILTIN_CAPABILITY_MANIFEST` with `risk:"read"`, and each tool's `description` equals the manifest `describe` verbatim (drift test)
- [ ] **MCPX-02**: Each tool's `inputSchema` is the JSON-Schema conversion of the procedure's exported Zod input schema; a tool with no valid Zod source is refused at registration
- [ ] **MCPX-03**: `tools/call polytoken.searchMyKnowledge` dispatches to `caller.knowledge.search` and returns the SAME items an equivalent direct `appRouter.createCaller(ctx)` call returns
- [ ] **MCPX-04**: Tenancy — a principal owning NO importers gets an empty result and zero unscoped queries; tool input can NEVER name the acting identity (`user.id` comes only from the server principal)
- [ ] **MCPX-05**: Principal resolution fails closed — missing `POLYTOKEN_MCP_USER_ID` or `POLYTOKEN_MCP_TOKEN` makes the server refuse to start, never boot with a null user
- [ ] **MCPX-06**: A thrown `TRPCError` (e.g. `UNAUTHORIZED`, or a bad-arg Zod failure) maps to a structured MCP tool error — the server process never crashes on a bad call
- [ ] **MCPX-07**: Args are re-parsed against the procedure's Zod schema at the dispatch boundary before the caller runs (defense in depth)
- [ ] **MCPX-08**: Expose-only guardrail — a test asserts the package imports NO MCP *client*/external-server transport and declares no `mcpServers` (the "never consume external MCP" mandate is machine-checked)
- [ ] **MCPX-09 (LIVE)**: End-to-end from Pedro's real Claude Code — the `mcpServers` entry connects, `tools/list` shows the polytoken tools, and `polytoken.searchMyKnowledge` returns grounded cited results from his live graph

**Coverage:** 41 requirements across 5 phases (73→LCAN, 74→MORN, 75→CPF, 76→BTAP, 77→MCPX);
each phase's `depends_on` and requirement set are declared in its `SPEC.md` frontmatter.
