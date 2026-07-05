---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: "Conversational GenUI: Chat, Canvas & Dual-Channel"
status: executing
last_updated: "2026-07-05T15:42:43.407Z"
last_activity: 2026-07-05 -- 24-01 executed (widget-interaction persistence + safety-primitive spine)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 21
  completed_plans: 18
  percent: 50
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-27)

**Core value:** Reliably receive every inbound email and make it observable.
**Current focus:** Phase 24 — Dual-Channel GenUI

## Current Position

Phase: 24 (Dual-Channel GenUI) — EXECUTING
Plan: 2 of 4
Status: Executing Phase 24
Last activity: 2026-07-05 -- 24-01 executed (widget-interaction persistence + safety-primitive spine)

Progress: [█████████░] 86%

## v1.3 Roadmap Summary (2026-07-02)

Phase numbering continues from v1.2 (ended at Phase 20, informal Phase 21 quality-verification effort). v1.3 = Phases 22–25, derived from research/SUMMARY.md's confirmed 4-phase dependency chain (chat spine → canvas → dual-channel → anticipatory SPIKE). Full detail: .planning/ROADMAP.md § Phase Details.

| Phase | Goal | Requirements |
|-------|------|--------------|
| 22 — Chat Spine + Streaming | Persistent, streamed `/chat` with progressive genui rendering, cost-capped | CHAT-01..07, STREAM-01..03, SEAM-03, SEAM-04 |
| 23 — 2D Canvas + Shared State | genui panels-as-nodes on an infinite canvas, cross-panel state + data edges | CANVAS-01..04, STATE-01..02 |
| 24 — Dual-Channel GenUI | Agent↔user widget round-trips (proposal cards → clarify-widgets), safely re-validated | DCUI-01..04 |
| 25 — Anticipatory Prompting (SPIKE) | Eval-gated, frequency-capped proactive prompt triggers | ANTIC-01, ANTIC-02 |

Coverage: 24/24 v1.3 requirements mapped, no orphans. Next: `/gsd:plan-phase 22`.

## Deferred Items

Acknowledged and deferred at the v1.2 milestone close (2026-07-03) — all are connected-env / browser
verifications (no code gaps), consistent with this project's long-standing pattern:

| Category | Phase | Item | Status |
|----------|-------|------|--------|
| verification_gap | 05 | 05-VERIFICATION.md | human_needed |
| verification_gap | 06 | 06-VERIFICATION.md | human_needed |
| verification_gap | 07 | 07-VERIFICATION.md | human_needed |
| verification_gap | 09 | 09-VERIFICATION.md | human_needed |
| verification_gap | 12 | 12-VERIFICATION.md | human_needed |
| verification_gap | 15 | 15-VERIFICATION.md | human_needed |
| verification_gap | 16 | 16-VERIFICATION.md | human_needed |
| verification_gap | 17 | 17-VERIFICATION.md | human_needed |
| verification_gap | 18 | 18-VERIFICATION.md | human_needed |
| verification_gap | 19 | 19-VERIFICATION.md | human_needed |
| verification_gap | 20 | 20-VERIFICATION.md | human_needed |
| uat_gap | 04 | 04-UAT.md | diagnosed (0 open) |
| uat_gap | 09 | 09-HUMAN-UAT.md | partial (3 open) |
| uat_gap | 16 | 16-HUMAN-UAT.md | partial (3 open) |
| uat_gap | 17 | 17-HUMAN-UAT.md | partial (0 open) |

**v1.2-specific deferrals (→ v1.3 / DEF-*):** eval-lift-vs-baseline on the v1.2 corpus (DEF-17-05-01/
18-03-01/19-01/20-01), Playwright code-island isolation run, live-progress studio streaming. All need
live Bedrock / a browser.

## Phase 23 — 2D Canvas + Panels-as-Nodes + Shared State (executing 2026-07-04)

- **23-01 EXECUTED:** `chat_canvas_layouts` Drizzle table (migration 0024, RLS deny-all) + `chat.getCanvasLayout`/`chat.saveCanvasLayout` tRPC procedures gated by `CanvasSnapshotSchema` (prototype-pollution guard, no-spec-content D-05 refine, payload caps). CANVAS-02 marked complete at the spine level (schema + procedures only — the UI never called them until 23-04).
- **23-02 EXECUTED:** `NODE_TYPE_REGISTRY`/`NODE_REGISTRY_VERSION` (browser-safe FNV-1a content-hash) + `resolveNodeType` allowlist (never throws) + `GenuiPanelNode` (memoized, renders via the unmodified `SpecRenderer`) + `CanvasSpecProvider`/`useCanvasSpec` — the CANVAS-04 seam keeping streaming content out of `node.data` from day one.
- **23-03 EXECUTED:** `useConversationController` (lifted streaming/turn state shared by the docked Chat view and the canvas `ChatNode` — one instance, D-02) + `ChatNode`/module-level `nodeTypes` map + `layoutCanvasNodes`/`offsetCascadePosition` (dagre) + the mounted `ChatCanvas` surface/island/view-toggle. Persistence/restore and live materialization were explicitly deferred to 23-04 (this plan's own stated seam).
- **23-04 EXECUTED:** Closed the persistence loop — `useCanvasPersistence` (exact restore, unknown-type degrade via `reconcileNodesFromHistory`, live `historyRows` reconciliation, ~800ms debounced coalesced `chat.saveCanvasLayout` save, `SaveStatusIndicator` in the toolbar) — and the CANVAS-04 streaming-responsiveness contract (`buildStreamingByProvenance` overlays a live regenerate's partial content onto an existing genui-panel node; a brand-new turn's live progress is watched via the `ChatNode`'s own embedded MessageList, since the backend has no stable messageId until a turn finalizes). Both CANVAS-02 and CANVAS-04 now marked complete in REQUIREMENTS.md. **Deviation:** split `packages/api-client`'s `chat/canvas.ts` into a new client-safe `canvas-schema.ts` (zero imports beyond zod) + a `"./chat-canvas"` package export, since the original file's `../../trpc` → `@nauta/db` import chain crashed any client-side import with a server-env-var error (found live via a failing test).
- **23-05 EXECUTED — Store + edges plumbing:** `createCanvasStore`/`CANVAS_STORE_MUTATIONS` (per-conversation `zustand/vanilla` store, superset of v1.1's declared-state 5-mutation grammar, `panels.*`/`shared.*` namespaces, FORBIDDEN_KEYS-guarded `resolveCanvasPath`) wired `GenuiPanelNode` -> `usePanelData` -> a new `data` prop on `GenuiPartBoundary` -> the UNMODIFIED `SpecRenderer`. `EdgePayloadSchema`/`DataEdge`/`EdgeCreationPicker` deliver data-carrying edges: drag-to-connect NEVER auto-wires (only the picker's explicit "Connect fields" creates an edge), a live Zustand subscription re-resolves the target panel's `data[targetKey]` on every source change, and `buildSnapshot` now persists real `sharedState` (optional 4th param, backward-compatible) alongside the `edges` array 23-04 already round-tripped. **Autonomous decision:** Task 1's blocking package-legitimacy checkpoint (zustand, absent from the repo) was resolved without stopping, per this run's explicit auto-mode directive — verified live at `registry.npmjs.org/zustand` (pmndrs/zustand, maintainers daishi/drcmda/jeremyrh, MIT) before installing via `npm install --workspace=@nauta/web` (npm-workspaces canonical, not the plan's literal pnpm command). See 23-05-SUMMARY.md for full detail.
- **23-VERIFICATION.md found a gap (2026-07-05):** 4/5 ROADMAP success criteria verified, but SC #5 (STATE-01/02) was PARTIAL/FAILED — the store's WRITE path (`usePanelData().dispatch`) had ZERO production call sites anywhere outside its own test file. No genui-spec button/action ever reached it, so `panels.*`/`shared.*` stayed `{}` forever in a real session, and `EdgeCreationPicker`'s source-field list was permanently empty. Two `missing:` items: (1) a real trigger calling `.dispatch(...)`; (2) an end-to-end test/proof of interaction -> store write -> field discovery -> live edge resolution.
- **23-06 EXECUTED (this session) — GAP CLOSED, PHASE 23 NOW GENUINELY COMPLETE:** Task 1 wired `ButtonComponent` (packages/genui catalog) to consume `ActionRegistryContext` — clicks now fire `registry[onClick.type]?.(onClick)` (or the legacy string `action` key), mirroring `FormComponent`'s exact contract, with zero `spec-renderer.tsx` changes. Task 2 built `panel-action-bridge.ts` (`buildPanelActionRegistry`/`usePanelActionRegistry`) — a per-panel `setState`-only `ActionRegistry` routing through `usePanelData().dispatch` (panels.*) or the raw store's `mutate` (shared.* prefix), always the literal `"set"` mutation — and threaded it through a new additive `actions` prop on `GenuiPartBoundary` into `GenuiPanelNodeBody`. Task 3 proved the full chain end-to-end with zero mocks (`panel-data-flow.test.tsx`): click -> store write -> `EdgeCreationPicker`'s own `panelFieldOptions` lists the field -> a live-subscribed target panel resolves the value and re-resolves on a second write. **Found + fixed 2 pre-existing bugs in 23-05's `canvas-store-context.tsx`** while writing that test (both were latent defects that only a live React mount could expose): a missing `React` import (JSX crashes outside Next's SWC auto-runtime) and an unstable `useSyncExternalStore` snapshot in `usePanelData`'s incoming-edges branch (infinite-loops ANY target panel with a live edge in production, not just tests) — fixed with zustand v5's `useShallow` + a stable empty-object constant. Both 23-VERIFICATION.md `missing:` items now closed. All 6 Phase 23 requirements (CANVAS-01..04, STATE-01/02) genuinely observable, not just plumbed. See 23-06-SUMMARY.md for full detail. **Next: Phase 24** (Dual-Channel GenUI, DCUI-01..04).

## Phase 24 — Dual-Channel GenUI (executing 2026-07-05)

- **24-01 EXECUTED:** The persistence + safety-primitive spine for agent<->user widget round-trips. `chat_widget_interactions` Drizzle table + migration 0025 (state machine pending/submitted/superseded/stale, stored `declared_response_schema` D-01/D-10, staleness columns, unique `(message_id, part_index)` lock index, RESTRICTIVE RLS deny-all) — live-verified against local Supabase (all columns, both CHECK constraints, both RLS policies, both indexes confirmed via direct `pg` query). `ChatWidgetInteractionRepository` port + `SupabaseChatWidgetInteractionRepository` adapter: `try_submit` is a DB-level CAS (`eq("id",...)` + `eq("state","pending")`, D-11 double-submit lock — a second submit matches zero rows); `is_stale` checks the emitting message's `is_active` flag + any strictly-newer `turn_index` in the conversation (D-12). `validate_result_against_schema` — a pure, fail-closed `jsonschema.Draft7Validator` re-validation service (D-10): empty/malformed declared schema is deliberately rejected (not delegated to jsonschema's technically-permissive `{}` reading), and the returned `reason` is always a generic string — the real jsonschema error is logged server-side only via structlog, never returned to the caller. Zero UI/tool/endpoint code (by design — persistence + safety primitives only). 15/15 pytest green (RED->GREEN for both TDD tasks), ruff/mypy/lint-imports clean, `packages/db` tsc clean. See 24-01-SUMMARY.md. **Next: 24-02** (the `emit_interactive_widget` tool + registry wiring).

## Phase 21 — Generation Quality Verification (in progress 2026-07-01)

**Why:** live testing showed the code-island `Generation fell back` on real prompts ("complex full twitter clone") — NOT a design-taste issue, a hard failure. Root cause: the code-island reused the declarative generator's tiny budget (Haiku, max_tokens=3000, 15s) → arbitrary UI code truncates mid tool-call → invalid → 3 retries fail → SAFE_FALLBACK_CODE (which the studio then rendered as a misleading "Rendered ✓").

**OFFLINE levers DONE (need backend restart to take effect):**

- Code-island `exports is not defined` crash fixed: srcdoc shims window.module/exports + autofix strips `export {}` (commit edc89fc).
- Strong design-quality generator prompt + forbid module/JSX (edc89fc).
- **Dedicated code-island tier**: Sonnet primary, GENUI_CODE_MAX_TOKENS=16000, GENUI_CODE_TIMEOUT_SECONDS=60 (declarative stays Haiku/3000) — settings + DI (commit 3f8d160). **This is the fix for the fallback.**
- Honest fallback UX: outcome=fallback no longer renders placeholder as "Rendered ✓" (3f8d160).

**LIVE / connected-env (USER must run — no Bedrock in the headless session):**

1. **Restart FastAPI + `npm run dev`** (stale process still has old settings/prompt/model).
2. Code-Island tab → generate a real prompt → confirm it now returns real code (Sonnet, 16k budget), not fallback. If it still falls back, capture FastAPI logs (the `genui_code_generator_*` structlog events).
3. Run the Phase-16 eval harness against live Bedrock to MEASURE quality vs baseline (DEF-17-05-01/18-03-01/19-01/20-01 — never run).

**✅ RESOLVED 2026-07-02 — code-island generation VERIFIED WORKING (live Bedrock, user-confirmed "all good").** Root-cause chain fixed: (1) `exports is not defined` — CJS boilerplate crashed the jail → srcdoc shims module/exports + autofix strips `export{}` (edc89fc); (2) generic output → Sonnet tier + design-quality prompt (edc89fc, 3f8d160); (3) every real design fell back — Bedrock InvokeModel is NON-STREAMING (buffers whole completion) so a total-time timeout always fired → switched adapter to `messages.stream` with an INACTIVITY timeout via `asyncio.timeout.reschedule` (b86647d); (4) still 60s — STALE `@lru_cache` settings under `uvicorn reload=DEBUG`/zombie processes → fixed by a COLD restart (`uv run uvicorn app.main:app`, single worker, no --reload). Commits: edc89fc, 3f8d160, 0e37307, b86647d, dc7e4f5.

**Phase 21 progress:**

- ✅ **Multi-candidate + judge generation** (dda8937): quarantine once → fan out N concurrent code gens (varied temp 0.4-1.0) → LLM judge picks best. Cost-conservative defaults: GENUI_CODE_CANDIDATES=2, judge=Haiku. New GenuiCodeJudgeAdapter. 51 code-island pytest green. Degrades gracefully (all-fallback→fallback, 1-good→skip judge, judge-fail→first). **Requires backend restart to activate.**
- ✅ **Cost guard** (4b28ec6): $30/month AWS budget + email alerts (80%/100% actual + forecast) in `infrastructure/aws/budget.tf` — user must `terraform apply`. Generation is manual-click only (idle=$0); ~$0.10-0.25/click at N=2 Haiku-judge.

**Remaining Phase 21:**

1. **Live-progress streaming to the studio** (the one UX wart left — silent 1-4min spinner; stream code/preview live like Lovable). Recommended next build.
2. **Eval harness vs baseline** (DEF-17-05-01/18-03-01/19-01/20-01) — never run; measures quality lift.
3. **Then:** audit → complete → cleanup v1.2 with honest numbers.

## 🔀 PIVOT / DECISION 2026-07-01 (during `/gsd:autonomous --from 19`)

**North-star restated by user:** *"Let the user create absolutely any design they want — not locked to any pattern — from raw pure empty HTML to making their page look like anything. Better than WordPress / Lovable, where it's hard to break out of the tool's natural design. I want this from day 0."*

**Decisions:**

1. **Phase 20 (sandboxed code-island) USER SIGN-OFF = GRANTED.** The no-eval → jailed-eval safety-model change is accepted. Begins as a SPIKE.
2. **REORDER: Phase 20 runs BEFORE Phase 19.** The code-island is the only architecture piece that escapes the fixed catalog "natural design"; it becomes the primary day-0 path. Target architecture = HYBRID (reliable declarative core as fast-path + arbitrary sandboxed code-island for the long tail) — matches the v0/Bolt + Google A2UI + sandboxed-MCP-App research already in this doc.
3. **Phase 19 form engine DEFERRED to after Phase 20.** Form-engine library (JSONForms / custom+AJV / RJSF) left OPEN — forms may end up expressed inside code-islands rather than a separate declarative engine. Revisit post-spike.
4. **SPIKE scope:** prove (a) isolated sandbox that cannot touch host DOM/creds, (b) v0-style AST-validate→autofix→run→self-heal repair loop with safe-placeholder fallback, (c) adversarial-injection + a11y (axe-core) fixtures, (d) one "curveball" corpus prompt renders a working interactive widget the declarative tiers cannot express. Then formalize Phase 20 as a full phase.

### ✅ SPIKE EXECUTED + PASSED 2026-07-01

New `@nauta/genui/sandbox` core (framework-free): `validate-island-code` (@babel/parser AST allowlist — blocks import/require/eval/Function/fetch/XHR/WebSocket/EventSource/sendBeacon/parent/top/opener/cookie/localStorage), `build-island-srcdoc` (`sandbox="allow-scripts"` NO same-origin + inline `<meta>` CSP `default-src 'none'; connect-src 'none'` + error harness + inlined axe), `island-message` (Zod postMessage + source-identity/null-origin/nonce auth), `repair-loop` (pure state machine: validate→autofix→run→heal≤2→fallback; re-validates healed code, rejects malicious heals), `autofix`, `safe-placeholder`, `axe-source`, fixtures (curveball soundscape mixer / broken→heals / unrepairable→fallback / 18 adversarial). Studio: new **Code-Island tab** (`code-island-frame.tsx` jailed iframe + repair driver; `code-sandbox-island.tsx` preset demo). Playwright cross-browser isolation spec authored (`apps/web/e2e/`, run deferred to connected-env). **Gates: genui tsc clean, genui vitest 416/416 (+49), web tsc clean, next build green (/studio 114kB), host no-eval clean.** Docs: 20-RESEARCH / 20-SPIKE-PLAN / 20-SPIKE-SUMMARY / 20-VERIFICATION (status human_needed: browser run + live Bedrock gen deferred, non-blocking). Declarative core UNTOUCHED (additive: 1 pkg subpath + 1 opt-in tab). **Seams for full phase:** live Bedrock intent→code (recon Option A+B), live healer, Playwright run, React/npm islands (Sandpack).

### ✅ FULL PHASE COMPLETE 2026-07-01 (promoted from spike)

Wired live intent→code end-to-end: **Python** `GenuiCodeGeneratorAdapter` (Bedrock `emit_code_island` forced tool-use, Haiku→Sonnet, temp=0, timeout, SAFE_FALLBACK_CODE, no eval) + `GenerateCodeIslandUseCase` (quarantine→generate→best-effort audit reusing GenerationEvent, `registry_version="code-island-v1"`, no migration) + `POST /v1/genui/code-island/generate` (X-API-Key, always-200 envelope) + Dishka DI; declarative path untouched. **TS/web** tRPC `genui.codeIslandGenerate` (proxy+fallback) + `/studio` Code-Island tab live "generate from intent" + live re-generate healer. **Adversarial review (ultracode):** 5 dims, 37 findings, 31 confirmed, 5 high/crit — **0 unmitigated by the runtime jail**; hardened the AST-allowlist bypass class (computed/template/alias/destructure/reflection/constructor-chain, fail-closed dynamic) + pinned postMessage targetOrigin + CSP-drift guard. **Gates:** genui tsc + 438 vitest; api-client 44; web tsc + build green (/studio 115kB); Python 27 new + 92 regression pytest, ruff/mypy/lint-imports clean; host no-eval clean. Commits: f8ab67c (tRPC/web), 2411900 (Python), 2aa0a07 (hardening). Docs: 20-SUMMARY / 20-VERIFICATION (status human_needed). **DEFERRED (connected-env, non-blocking, DEF-20-01):** live Bedrock smoke, Playwright cross-browser isolation run, Phase-16 eval-harness lift-vs-baseline (EVAL-01/02). **Next: Phase 19** (declarative form engine) — last v1.2 phase; engine fork (JSONForms / custom+AJV / RJSF / forms-inside-islands) still OPEN, revisit informed by the island. Milestone v1.2 = 4/5 phases complete.

## Milestone v1.1 — Generative UI Engine — 🎉 COMPLETE 2026-06-27 (4 phases, 15 plans; autonomous run)

> **Milestone audit: PASSED** (.planning/v1.1-MILESTONE-AUDIT.md) — full spine connects E2E across all 6 cross-phase seams (catalog→generation→cache→render→studio), 0 orphaned/missing/broken, 3 E2E flows (cold/cache-hit/fallback) complete. 36/37 in-scope v1.1 requirements delivered (GEN-04 progressive streaming deferred to v1.2). Each phase executed → code-reviewed → fixed → verified. **9 CRITICAL bugs were caught by the code-review pass that the verifiers missed** (3 in Phase 12 schema↔manifest mismatch, 3 in Phase 13 dead tRPC↔FastAPI integration, 3 in Phase 14 cache correctness) — all fixed with regression tests added. Roadmap archived → .planning/milestones/v1.1-ROADMAP.md.
> **DEFERRED (require user / a connected environment):** (1) browser visual verification of /studio + /studio/preview (Phases 12 + 15) — **DONE by user; surfaced 2 live integration bugs, both FIXED, see below**; (2) **PENDING DEPLOY** — migrations 0021 (genui_generation_events) + 0022 (ui_spec_templates) to staging+prod (live Bedrock generation now verified working); (3) `/gsd:cleanup` (file deletion) was intentionally NOT run — left for review.
> **LIVE-VERIFICATION FIXES (2026-06-27, post-completion — found by the user running /studio against a real backend; both were offline-test blind spots):** (A) **catalog examples all rendered `[!] prop validation failed`** — `catalog-browser-island.tsx` `buildWrappedExample` nested props as `{ type, props: example, children: [] }` but spec nodes are FLAT `{ type, ...props }`; fixed by extracting a shared `packages/genui/src/studio/build-catalog-example-spec.ts` helper (flat `{ v:1, root:{ type, ...example } }`, injects `children:[]` only for acceptsChildren layout nodes) imported by both the island and a new regression test that renders every NAUTA_CATALOG entry and asserts zero fallbacks (proven RED→GREEN). Commit 422f52a. (B) **every live Bedrock generation 400'd** (`tools.0.custom.input_schema.type: Field required`) — the emitted `spec.schema.json` root was a `{ $ref:"#/definitions/SpecRoot", definitions }` wrapper with no top-level `type`, invalid as a Bedrock tool input_schema; fixed by an `inlineNamedRoot()` in the artifact emit (root now `type:"object"`, required `[v,root]`, no root `$ref`, definitions retained), a regenerated committed artifact (drift gate green), and a Python `_assert_bedrock_input_schema()` load-time guard + tests. Commits cbdd1e1, db7e718. **Verified (independent agent + my spot-check): genui 204, api-client 118, Python genui 93 tests green; web build green; artifact root type:object; catalog renders clean; no-eval + drift gates clean.** The two new regression tests close both seams (the mocked Bedrock call never hit a real API; the catalog example→node→renderNode path was never exercised end-to-end — CTLG-04 only checked raw example vs propsSchema).
> **✅ LIVE E2E CONFIRMED by user 2026-06-27 (after the 3 fixes + the SUPABASE_URL host-config fix):** the /studio Sandbox generates live via Bedrock Haiku 4.5 (cold generation) and renders real `@nauta/ui` components beside the spec JSON for multiple intents ("a news website homepage" → 6-card grid, "a simple twitter clone" → card/stack/alert/key-value-list/separator, "a simple twitter replicate" → feed + nav buttons). The catalog browser, generation sandbox, spec-JSON inspector, and the four generation-state chrome all work in the browser — the Phase 12 + Phase 15 deferred human-visual verification is now SATISFIED. Dev config: running the listener on the HOST requires `SUPABASE_URL=http://localhost:54321` in apps/email-listener/.env (host.docker.internal:54321 only routes from inside a container); the committed docker-compose overrides SUPABASE_URL back to host.docker.internal for the `npm run dev` containerized path (commit 85b2647). Remaining before ship: deploy migrations 0021/0022 to staging+prod (the Dockerfile now packages the genui artifacts so ECS will load the schema), and optionally shorten the Supabase client connect timeout so the cache path fails fast on outage.
> **(C) DEPLOY-PACKAGING BUG found while tracing the live 400 (commit 6248d06):** the email-listener `Dockerfile` never copied `packages/genui/artifacts/` (a Phase-13 runtime dependency) and the loader's `parents[5]` walk-up `IndexError`s inside the container — so genui generation only ever worked when the listener runs on the HOST via `uv` (where the artifact path resolves); a `docker compose up --build` or ECS deploy would crash/404 at the tool schema. Fixed: Dockerfile now `COPY packages/genui/artifacts ./genui-artifacts` + `ENV GENUI_ARTIFACTS_DIR=/app/genui-artifacts`, and `_get_artifacts_dir()` resolves the env override first / bounds the host walk-up (clear RuntimeError instead of IndexError). **Verified by BUILDING the image and loading the schema in-container: root type=object, both artifacts present.** +3 packaging regression tests (102 genui-py tests green). **The user's live 17:42 failure was a STALE host process** (`@lru_cache` pinned the old `$ref` schema + pre-guard code) — a fresh host load now returns type:object; restarting the host listener fixes the local re-test.

Runtime, spec-first generative-UI engine (Catalog → Spec → Registry → Renderer, no eval) in a new
`packages/genui` consumed by a `/studio` route. v1.1 scope = spine + exact cache (components 1–5 + 7);
semantic retrieval/promotion + evals + code-emit deferred to v1.2. Research in `.planning/research/`
(SUMMARY.md + 6 docs, verified 2026-06-27). Phases continue at 12+. Decisions: spec-first over code-emit;
Haiku 4.5 runtime / Sonnet 4.6 escalation via Bedrock IAM; reuse pgvector + Titan V1 (1536) + RRF.

> **Note (milestone v1.0):** complete — Phases 1–11 shipped. The v1.0 completion/cleanup lifecycle was
> never formally run, so Phase directories `02–11` remain under `.planning/phases/` (not archived). The
> Phase-11 and prior notes below are retained as history.

## GenUI v-next (post-v1.1) — PLANNING / research done 2026-06-27 (local+sandbox only)

> **FORMALIZED 2026-06-27:** roadmap authored as **Milestone v1.2 — "Generative UI: Realism & Interactivity"** (Phases 16–20, status: planning) in `.planning/ROADMAP.md`; requirements (EVAL/STDO/IDEA/STYLE/RAG/CTLG/FORM/CODE, 24 mapped) in `.planning/REQUIREMENTS.md`. Frontmatter flipped milestone→v1.2 / status→planning. Phase 20 (sandboxed code-island, jailed-eval) is BLOCKED on explicit user sign-off. The notes below are the source synthesis this roadmap was built from.

User direction after v1.1: keep LOCAL + `/studio` sandbox (no deploy/convergence). **Tier A** = more authentic/custom-styled layouts (escape generic shadcn), richer catalog, assembly intelligence. **Tier B** (harder) = real interactive apps — state, API calls, business rules, calendars/tables/forms with customizable form business logic; wants a brutally-rigorous research-driven process for Opus 4.8. Generator prompt already tuned (build-concrete/no-placeholders + catalog payload injected, commit 57028cb).

- **Deep research done (partial — account rate-limit, resets ~18:50 America/Sao_Paulo).** `wqh16m5tl` = architecture+process (9 claims 3-0 verified; synthesis authored in-context). `wme3xqszz` = real-prompt corpus + history/ideas UX → **stalled at 0 bytes (rate-limited), still PENDING**. Full synthesis: `.planning/research/GENUI-VNEXT-RESEARCH.md`.
- **ARCHITECTURE DECIDED = HYBRID** (matches Google A2UI + sandboxed MCP-App islands; v0/Bolt = code-emit + AST-repair + sandbox + self-heal): keep declarative spec for layout; **forms/business-logic via a declarative JSON-Schema form engine** (RJSF/JSONForms/Formily — no eval); **sandboxed code-islands** (iframe/Sandpack/WebContainer) only for truly custom/interactive widgets (safety no-eval→jailed-eval; that phase needs user sign-off).
- **Tier A method:** ground generation in an explicit design-system + design tokens (W3C DTCG JSON), varied per gen ("style packs") + assembly RAG — v0's "registry" approach.
- **Process:** eval-driven development (Anthropic/OpenAI) — build the eval harness FIRST (golden prompt set from the real corpus + LLM-as-judge UI-quality rubric, UI-Bench-style), gate every GSD phase on it.
- **Proposed v1.2 phases:** (1) eval harness, (2) Tier-A token/theme + style packs + assembly RAG, (3) catalog expansion (avatar/feed-item/nav/tabs/inputs), (4) declarative form engine, (5) sandboxed code-island [SPIKE→phase, user sign-off]. History + page-ideas tabs = small early phase (data already in ui_spec_templates / genui_generation_events; ideas seeded from the pending real corpus).
- **PROGRESS (rate limit recovered):** real-prompt corpus gathered (`.planning/research/REAL-PROMPT-CORPUS.md`, 76 real prompts w/ provenance); v1.2 milestone formalized (roadmap phases 16-20 + requirements, commit cc6ab1a); **Phase 16 CONTEXT authored** (21 decisions, commit 7fd8dc1) and **PLANNED — 5 plans / 3 waves (commit 5600181)**: 16-01 eval+page-ideas assets, 16-02 eval runner/rubric/judge/baseline, 16-03 History backend+tRPC, 16-04 Page-Ideas tab, 16-05 History UI.
- **CURRENT POSITION / NEXT:** Phase 16 plans 16-01..16-05 ALL EXECUTED (autonomous run 2026-06-27/28). 16-03 (history spine), 16-02 (eval harness), 16-04 (page-ideas tab + controlled tabs lift), 16-05 (history tab UI) committed. Deferred to connected env: 16-02 Task 4 live Bedrock baseline; 16-05 Task 3 browser-verify; any plans for 16-01 (eval+page-ideas assets). **Phase 17 17-01 EXECUTED 2026-06-28**: 6 WCAG-AA DTCG packs + fourth TOKEN allowlist (Zod enum) + style_pack_id on spec envelope + regenerated drift-gate-green Bedrock artifacts; 289/289 tests green. **Phase 17 17-02 EXECUTED 2026-06-28**: RetrievalProvider port + LexicalRetrievalProvider + 5 hand-authored exemplar specs; 42/42 tests green (TDD RED→GREEN all 3 tasks). **Phase 17 17-04 EXECUTED 2026-06-28**: pack-aware Python generation pipeline — 5-dimension cache key (style_pack_id as D-08 dimension), retrieval-before-generation RAG-01 ordering, token table + exemplar injection into DYNAMIC generator user turn (COST-01 preserved), retrieved_ids + overlap logged per generation (RAG-02 proof), T-17-04 spoofing guard at route boundary; 73 tests green (TDD RED→GREEN all 3 tasks). **Phase 17 17-03 EXECUTED 2026-06-28**: ThemedRoot CSS-variable wrapper (`packages/genui/src/theme/themed-wrapper.tsx`) — sets 21 W3C-DTCG CSS custom properties via inline style object on `.nauta-themed` div; SpecRenderer conditionally wraps with ThemedRoot when `spec.style_pack_id` is set (outermost, ActionRegistryContext.Provider inside); tRPC `genui.generate` adds `stylePackId` Zod-validated input field forwarded to FastAPI as `style_pack_id`; studio sandbox adds 6-pack Select dropdown with "Auto / Surprise" sentinel resolved by `pickSurprisePack()` before tRPC call (D-08 compliant); pack provenance badge shown post-generation. 5 commits (2 TDD RED+GREEN + 1 auto), tsc clean; visual verification checkpoint deferred (autonomous). **Phase 17 17-05 EXECUTED 2026-06-28**: style_metrics.py (WCAG-AA contrast, distinctiveness, RAG-02 retrieval overlap), rubric.py a11y() WCAG-AA gate (D-09 HARD), score_brand() brand judge at temp=0 static prompt (D-17, T-17-31), additive style fields on PromptReport+EvalReport (D-15), a11y HARD-regression flag in compare_reports (D-18), aggregate_all_packs()+--all-packs/--style-pack CLI (D-19); 40/40 tests green (TDD RED 56c4207 → GREEN b5afb33). Deferred: connected-env live --all-packs eval (DEF-17-05-01). **Phase 18 — Tier A Catalog Expansion — ✓ EXECUTED + VERIFIED (human_needed 3/4) 2026-07-01 (autonomous run, 3 plans / 3 waves, sequential on main).** 18-01 (vocabulary contract): SpecNodeType→18 literals, 6 wire *NodeSchema added to the discriminated union (`.strict()`, GOTCHAs handled: `inputType` not `type`, FeedItemNodeSchema NO `.refine()` in wire union, `z.lazy` section children, relative-href guard on nav), grid `colSpan` (bounded int → `grid-column: span N` in renderPositionalChildren, no eval) + house-built `section` primitive (11 entries). 18-02 (domain leaves): 5 real entries — avatar/input (wrap @nauta/ui), nav/feed-item (house-built), tabs (presentational, @nauta/ui) — manifest 11→16, `.strict()` propsSchemas in lockstep with wire, a11y-required non-optional in BOTH, CSS-var-only theming (CTLG-09), 7 D-04 a11y negative tests, Bedrock artifacts re-emitted (drift gate green). 18-03 (CI closure): standing wire/render PARITY test (all 16 entries safeParse against the wire schema — the Phase-17 onClick-drift guard), Phase-14 cache-invalidation proof (6 new keys present + REGISTRY_VERSION 64-hex SHA-256 bumped), artifact drift gate green. **Gates: genui tsc clean, 367/367 genui tests green (15 files), api-client 141/141 (schema additive, no regression), schema-drift false.** Code review SKIPPED (workflow.code_review=false per updated config). **DEFERRED (connected-env, non-blocking): DEF-18-03-01** — live Phase-16 eval lift-vs-baseline on profile/feed/nav corpus (needs Bedrock creds + seeded DB), same posture as DEF-17-05-01. Commits 6d7fc98,2f95147,3531937 (18-01); 559b511,e9b15ff (18-02); 6fc7a2f,ed185c3 (18-03). **Next: 19** (declarative JSON-Schema form engine) → 20 (sandboxed code-island, USER SIGN-OFF GATE — blocked). Keep local/sandbox; eval-gate later phases on Phase-16 baseline.

## Phase 12 — Catalog, Spec Schema, and Trusted Interpreter — ✓ EXECUTED 2026-06-27 (4 plans, 4 waves; human visual verify deferred)

- **✓ EXECUTED 2026-06-27 (autonomous run):** all 4 plans shipped sequentially on the main tree (W1 scaffold+schema → W2 catalog+registry+CTLG-04 → W3 trusted interpreter → W4 demo+/studio/preview). 27 files, ~2,400 LOC source + ~1,150 LOC tests. genui + web typecheck clean; Next.js prod build green (`/studio/preview` static 3.92 kB); **no-eval grep gate clean** (zero real eval/Function/dangerouslySetInnerHTML on the renderer path — GR-01/SPEC-02). Commits e65a23c..20c0d2d.
- **Code review (gsd-code-reviewer) found 3 CRITICAL schema-mismatch bugs the tests+verifier missed** — spec node schemas vs manifest propsSchemas disagreed on required fields, so button (missing `aria-label`), separator (missing `aria-hidden`), and key-value-list (`valueRef`/no-`label` vs `value`/`label`) each rendered as `NodeErrorFallback` instead of a real component (broke success criterion 2 for 3/10 types). **All fixed** (gsd-code-fixer, commits ca9020a..452f74a): aligned spec schemas to the manifest contract, removed `valueRef`, plus WR-01 (React import), WR-02 (componentDidCatch logging), IN-01 (countNodes/specDepth depth guards). **Added the missing spec→render round-trip regression test** (Block 7: all 10 catalog types render a real component, no error card) so this class of bug can't recur. Final: **96/96 genui tests green**, typecheck clean, web build green, security gate clean. See 12-REVIEW.md / 12-REVIEW-FIX.md.
- **Verification (gsd-verifier): `human_needed`** — 5/5 ROADMAP success criteria + all 15 requirement IDs machine-verified; ONLY the live browser visual eyeball at `/studio/preview` is outstanding (showcase renders every node type, Toggle-Section state flip is visible, malformed-node isolation). **Deferred per the overnight autonomous directive** (user asleep) — not a real gap. To confirm: `pnpm dev` in apps/web → visit http://localhost:3000/studio/preview. See 12-VERIFICATION.md.

- **Planned:** 4 plans authored (gsd-planner, opus) + verified (gsd-plan-checker **PASSED**, 0 blockers, iter 1).
  Inputs: 12-CONTEXT.md (D-01..D-24) + 12-UI-SPEC.md + generated 12-PATTERNS.md (column-defs.ts north-star).
  Research skipped (config research:false; `.planning/research/SPEC-RENDERER.md` is the primary doc the planner
  read directly). Requirements coverage 15/15. Decision coverage 20/20 trackable (D-NN ids cited into plan
  must_haves after the gate flagged prose-only references). Security gate ON: every plan carries a STRIDE
  `<threat_model>`; Plan 03 makes the GR-01/SPEC-02 no-eval guarantee a grep-able acceptance criterion. Ready to execute.

- **Goal:** vocabulary contract established + a hardcoded spec renders live `@nauta/ui` components in `/studio/preview`
  via `createElement` with **zero eval** — first observable, demoable artifact before the generation layer (Phase 13).
  New package `packages/genui` (catalog + schema + registry + renderer) consumed by a thin `/studio` route in `apps/web`.

- **Plan waves (strict sequential chain — no false parallelism):**
  W1 `12-01` `@nauta/genui` scaffold + `catalog/types.ts` (`SpecNodeType`/`ManifestEntry`) + full Zod discriminated-union
  `spec-schema.ts` (v:z.literal(1) root, `.strict()` everywhere, z.lazy recursion w/ ZodType annotation, MAX_SPEC_NODES=200/
  MAX_SPEC_DEPTH=8 bounds, leading `_plan` field — Bedrock-compatible per D-22) [SPEC-01/04/05, SEAM-01, COST-02] →
  W2 `12-02` ~10 fully-real hand-authored catalog entries + `COMPONENT_REGISTRY` + SHA-256 `{catalogId,version}` content-hash +
  **CTLG-04** manifest-example CI test [CTLG-01..05, COST-03, SEAM-03] →
  W3 `12-03` recursive `renderNode`→`createElement` (zero eval) + per-node `NodeErrorBoundary` class + `useDeclaredState`
  (useReducer, 5-mutation enum) + safe `resolveDataRef` dotted-path [SPEC-02/03/04/05] →
  W4 `12-04` `SHOWCASE_SPEC` + `MALFORMED_SPEC` fixtures + `/studio/preview` render/JSON split (dynamic ssr:false island) +
  live Studio sidebar nav (**autonomous:false** browser human-verify) [SPEC-06].

- **Deferred (honored, no leakage):** LLM/Bedrock generation → Phase 13; exact cache + `ui_spec_templates` store → Phase 14;
  full `/studio` browser/sandbox + Nauta-flavored real demo → Phase 15. This phase's demo is a generic showcase (D-17).

- **12-01 ✓ EXECUTED 2026-06-27:** @nauta/genui workspace package scaffold + catalog/types.ts (SpecNodeType 12-key union, ManifestEntry<TProps> readonly interface, ComponentRegistry) + schema/spec-schema.ts (full 12-node ZodDiscriminatedUnion, z.lazy proxy recursion, ChildrenSchema:z.ZodType<SpecNode[]> explicit annotation, StateDeclarationSchema 5-mutation restricted enum, SpecRootSchema v:z.literal(1) + _plan + .strict() + MAX_SPEC_NODES=200/MAX_SPEC_DEPTH=8 bound refinements, countNodes/specDepth walkers). Zod v3 only (Bedrock-compatible, D-09). All z.object() .strict() (D-22/COST-02). tsc clean. Commits e65a23c, 1d84766, bef6dbc. See 12-01-SUMMARY.md.

- **12-02 ✓ EXECUTED 2026-06-27:** 10-entry depth-first NAUTA_CATALOG manifest (manifest.ts) with fully-real React components using React.createElement; a11y props enforced as non-optional (button/aria-label, alert/title, table/caption, key-value-list/label, separator/aria-hidden:literal(true)); all propsSchemas .strict(); COMPONENT_REGISTRY + UnknownComponentPlaceholder (role=alert fallback); computeRegistryHash SHA-256 content-hash + REGISTRY_VERSION {catalogId:"global",version:<64-hex>}; compactEntry/toCompactCatalog SEAM for COST-03 subsetting; vitest jsdom config + 30-test CTLG-04 CI gate (10 example tests + 6 a11y negative + 7 allowlist + 7 hash determinism). tsc clean, 30/30 tests green. Commits 91ab872, 87abd55, df7fecd. See 12-02-SUMMARY.md.

- **12-03 ✓ EXECUTED 2026-06-27:** Recursive `renderNode`→`createElement` (zero eval, GR-01/SPEC-02 grep gate: 0 functional matches) + per-node `NodeErrorBoundary` class component (`getDerivedStateFromError`, D-14) + `useDeclaredState` useReducer (5-mutation enum: toggle/set/reset/increment/decrement, all branches return new objects via spread, D-11) + `resolveDataRef` dotted-path resolver (FORBIDDEN_KEYS: __proto__/constructor/prototype, D-12) + `SpecRenderer` entry component (`"use client"` line 1, D-20) + empty `ActionRegistryContext` seam (`React.createContext<ActionRegistry>({})`, SEAM-02) + `src/index.ts` package root barrel. safeParse-only render path (SPEC-03). Structural-position keys (D-15). Named slots + positional children (D-16). Control-flow nodes (conditional/list) handled before registry dispatch. 30 new tests, 60/60 green; tsc clean. Security grep gate: 0 functional matches. Commits 27a10d7, 76f13bd. See 12-03-SUMMARY.md.

- **12-04 ✓ EXECUTED 2026-06-27:** SHOWCASE_SPEC (all 12 node types + state/action/dataRef, D-17) + MALFORMED_SPEC (one broken node among valid siblings, D-18) exported from @nauta/genui/demo; 25 TDD tests (RED 859da3a, GREEN 350632e) validate schema conformance, node-type coverage, state/action presence, and dataRef usage. /studio/preview server component (page.tsx) + dynamic(ssr:false) SpecRendererIsland (spec-renderer-island.tsx) — 55/45 ResizablePanelGroup render+JSON split (D-19/D-20). REGISTRY_VERSION server-side only (T-12-15). Studio live sidebar nav item (FlaskConical, /studio/preview, LIVE_NAV_ITEMS — UI-SPEC §7). Auto-fixed: (1) removed aria-label/aria-hidden/label from strict Zod schemas; (2) removed COMPONENT_REGISTRY from server→client prop (Next.js serialization boundary). 85/85 tests green; tsc clean; web:build green (/studio/preview static 3.92 kB). Browser visual verification deferred (autonomous overnight run, user asleep — see 12-04-SUMMARY.md). Commits 859da3a, 350632e, a06f124, 450e092. See 12-04-SUMMARY.md.

- **Phase 12 ✓ ALL 4 PLANS EXECUTED 2026-06-27.** Pending: phase-level verification + browser visual check (12-04 Task 4). Next phase: 13 (LLM generation layer).

## Phase 13 — Generation Layer and Guardrails — ✓ EXECUTED + REVIEWED 2026-06-27 (4 plans, 3 waves)

- **✓ VERIFIED (gsd-verifier: passed, 5/5 success criteria) + REVIEWED+FIXED 2026-06-27 (autonomous run).** All 4 plans executed sequentially on the main tree. **Code review (gsd-code-reviewer) caught 3 CRITICAL integration bugs the verifier missed** — the verifier checked each component in isolation and passed, but the tRPC↔FastAPI seam was broken: (CR-01) tRPC sent only `{intent}` while FastAPI required `raw_content`+`registry_version` → every call 422'd → always returned the fallback; (CR-02) response-envelope parsing read top-level `spec` but FastAPI returns `{success,data:{spec}}` → safeParse always failed → always fallback (together: a real spec was NEVER returned in production); (CR-03) the href scheme-rejection refine didn't translate to the emitted JSON-Schema grammar/Python validator (`//evil.com` passed the grammar; mitigated downstream by the tRPC Zod safeParse + D-15 runtime check). **All fixed** (gsd-code-fixer, commits 768ce8d..b0bb3ad): reconciled the contract (Option A — `raw_content` optional/default-"" enabling intent-only generation, quarantine runs empty), fixed envelope parsing, strengthened the emitted href grammar, capped intent_summary at 500, and fixed 3 audit-accuracy bugs (real attempts/escalated/model_id) + the event-loop-blocking audit write (asyncio.to_thread). **Added the missing tRPC↔FastAPI CONTRACT test** (Contract-01/02: request carries the required fields; a real `{success,data:{spec}}` envelope returns the REAL spec, NOT the fallback) — the seam test whose absence let CR-01/02 ship. Then fixed ~16 stale tests from the GeneratorResult/optional-raw_content refactor (commit 40a01e8, test-only). **Final: genui 153/153, api-client 113/113 (incl. contract tests), Python genui 48/48, api-client+web builds green, no-eval gate clean.** See 13-REVIEW.md / 13-REVIEW-FIX.md / 13-VERIFICATION.md.
- **PENDING DEPLOY:** migration 0021 (`genui_generation_events`) to staging+prod before Phase 14 W1. Live Bedrock generate is offline-tested only (mocked) — live-IAM smoke is a deploy-time check.

- **Planned:** 4 plans (gsd-planner, 13-CONTEXT.md). Inputs: 13-CONTEXT.md (D-01..D-24) + generated 13-PATTERNS.md. Research: .planning/research/SUMMARY.md + 6 research docs (BEDROCK-GENERATION, BEDROCK-PROMPT-CACHING, etc.). Security gate ON: every plan carries a STRIDE threat_model. Requirements: 14/14 reqs (GEN-01..06, SAFE-01..06, COST-01, SEAM-02). Decisions: 26/26 tracked. Ready to execute Waves 2+3.

- **Plan waves:** W1 `13-01` TS contract layer (parallel with 13-02) → W2 `13-03` Python quarantine+generator+repair (depends on 13-01+13-02) → W3 `13-04` web proxy+ActionRegistry (depends on 13-01+13-03). W1 also has `13-02` audit table running in parallel.

- **13-01 ✓ EXECUTED 2026-06-27:** @nauta/genui TypeScript contract layer. Three allowlists at Zod schema level: RegisteredTypeSchema (D-12, component-type enum), AllowedProcedureSchema (D-13, 9 tRPC queries), ActionSchema (D-14, navigate/setState/mutate discriminated-union with relative-href enforcement + no-UUID params). ALLOWED_MUTATIONS=[]=const seam (SEAM-02, z.never() mutate branch). DataBindingSchema (D-13a UUID rejection via RFC-4122 regex .refine()), SAFE_FALLBACK_SPEC (D-07, Object.freeze alert spec, GEN-03). ButtonNodeSchema extended with onClick:ActionSchema.optional(); SpecRootSchema extended with bindings:z.record(DataBindingSchema).optional(). Bedrock artifact emit: spec.schema.json (22x additionalProperties:false, no external $ref) + genui-prompt.json (compact catalog + 9 allowedProcedures + REGISTRY_VERSION + actionRules). CI drift gate (TDD): 12 artifact freshness tests + 40 allowlist unit tests; 148/148 tests green; tsc clean (genui). Commits 56fedca (Task 1), b511caa (Task 2 RED), 37da20a (Task 2 GREEN). See 13-01-SUMMARY.md.

- **13-02 ✓ EXECUTED 2026-06-27:** Audit-log foundation. Drizzle `genui_generation_events` table (D-19 column set: intent_hash, model_id, tokens, attempts, outcome, spec_validation, node/depth count, registry_version, latency_ms, importer_id) + migration 0021 with outcome CHECK constraint (ok|fallback|escalated, T-13-11) + IF NOT EXISTS guards. Applied to local Postgres (14 columns verified via information_schema); staging+prod PENDING DEPLOY. Python `GenerationAuditRepository` Protocol port + frozen `GenerationEvent` dataclass (D-19 privacy, CLAUDE.md immutability) + `SupabaseGenerationAuditRepository` best-effort adapter (swallows insert exceptions, logs `generation_audit_record_failed` via structlog, T-13-10). TDD: 4/4 tests green; ruff/mypy/bandit/lint-imports clean. Commits 11afb5d (task 1), 2ee7cb4 (RED), ad0ed0a (GREEN). See 13-02-SUMMARY.md.

- **13-03 ✓ EXECUTED 2026-06-27:** Dual-LLM generation pipeline (Call A quarantine + Call B generator + audit). Python adapters: `GenuiQuarantineAdapter` (Call A — Bedrock forced-tool-use, extracts enum-constrained `QuarantineExtraction`; raw prose never crosses to generator, SAFE-01/D-09) + `GenuiGeneratorAdapter` (Call B — `emit_ui_spec` forced-tool-use, up to 3-attempt JSON-schema repair loop, Haiku-4.5 → Sonnet-4.6 escalation on repair failure; schema loaded from genui artifacts via `ArtifactLoader`; returns SAFE_FALLBACK_SPEC hardcoded constant on total failure, D-07/SAFE-02). `GenerateUiSpecUseCase` (domain-pure, zero infra imports — adapters typed `Any` via lint-imports contract; SHA-256 intent hash, best-effort audit, T-13-10/D-19). FastAPI endpoint `POST /v1/genui/generate` (X-API-Key auth, `ApiResponse[GenerateUiSpecView]` envelope; omits `from __future__ import annotations` to avoid Pydantic ForwardRef at route registration). Dishka DI (Scope.APP providers for all 4 components; wired in container.py + main.py). Security gates: D-24 (no eval/exec/compile on generation path), D-19 (SHA-256 hash only), SAFE-01/02 (dual-LLM quarantine), T-13-10 (audit failure swallowed+logged). Quality: 19 tests green (13 use-case TDD + 6 endpoint); ruff/bandit/lint-imports clean; mypy 2 pre-existing errors in genui_generator_adapter.py (jsonschema `Any` typing — deferred). Commits 454ea6e, e19505d, 707a731. See 13-03-SUMMARY.md.

- **13-04 ✓ EXECUTED 2026-06-27:** genui.generate tRPC procedure (D-08 SpecRootSchema re-validation + SAFE_FALLBACK_SPEC fallback on any failure, T-13-19 no detail leak) + buildActionRegistry (navigate/setState/query-refresh wired; mutate absent, SEAM-02; D-15 runtime href re-check; D-24 no-eval gate clean). 12 new tests; api-client 109/109 + genui 153/153 green; tsc clean both packages. Commits 3109eae, 01c5bb3, c0d8e90, ef334d2. See 13-04-SUMMARY.md.

- **Decisions:** COMPONENT_REGISTRY must never cross Next.js server→client boundary (Zod classes unserializable); dynamic(ssr:false) island imports it directly via default prop. REGISTRY_VERSION consumed server-side only (Node.js crypto module, T-12-15). Migration 0021 staging+prod deploy is DEFERRED — apply before Phase 14 W1 executes (ui_spec_templates table depends on same migration chain). Repair loop is adapter-owned (not use-case-owned) — GenuiGeneratorAdapter handles Bedrock-specific retry logic; use case stays domain-pure and calls generate() once. Web boundary re-validation: SpecRootSchema.safeParse at tRPC layer (D-08); SAFE_FALLBACK_SPEC on any failure. mutate intentionally absent from ActionRegistry (SEAM-02); ALLOWED_MUTATIONS=[] keeps the branch inert in v1.1. api-client tsconfig needs jsx:preserve + dom.iterable because workspace symlink to genui pulls React/JSX transitively.

## Phase 14 — Exact Cache and Template Store — ✓ EXECUTED + REVIEWED 2026-06-27 (3 plans, 2 waves)

- **✓ VERIFIED (gsd-verifier: passed, 3/3 success criteria) + REVIEWED+FIXED 2026-06-27 (autonomous run).** All 3 plans executed (ui_spec_templates table + migration 0022 RLS deny-all ∥ pure cache_key module → repository + step-0 cache integration). The cache check is step 0 of GenerateUiSpecUseCase — a hit returns before quarantine/generate/audit (zero Bedrock + no new genui_generation_events row); validated specs persist via ON CONFLICT(cache_key) upsert (never the fallback); registry_version is in the SHA-256 key so a version bump auto-invalidates (lazy). **Code review (gsd-code-reviewer) caught 3 correctness bugs the verifier passed over:** CR-02 fallback detection was content-sniffing (`root.type=="alert"` + title prefix) → a legit alert spec would be misclassified as fallback (never cached → re-hits Bedrock every call) and a corrupted non-dict root would be persisted (poisoning); CR-03 `canonicalize_intent` used `.lower()` not `.casefold()` (multilingual keys diverge); CR-01 `increment_use_count` only touched updated_at (use_count stuck at 0). **All fixed** (gsd-code-fixer, commits 33985fb/02ffa51/c4f348b/f638363): added a structural `is_fallback` flag to GeneratorResult (set at both fallback sites; drives the outcome + persist gate — no more content-sniffing), casefold, real read-modify-write use_count, defensive spec_json str→dict, and populated spec_node_count/spec_depth. Added the regression test (a legit "Unable to generate…" alert spec IS cached). **Final: 87/87 genui+cache Python tests green; ruff/mypy/bandit/lint-imports clean; packages/db tsc clean.** See 14-REVIEW.md / 14-REVIEW-FIX.md / 14-VERIFICATION.md.
- **PENDING DEPLOY:** migration 0022 (`ui_spec_templates`) to staging+prod (with 0021) before any deploy of the cache adapter.

- **14-01 ✓ EXECUTED 2026-06-27:** Drizzle `ui_spec_templates` table (exact-match cache/template store, CACHE-01). 14 D-10 v1.1 columns: id, cache_key (UNIQUE), intent_text, data_shape_hash, registry_version, catalog_id, spec_json, validation_status (CHECK IN ('validated')), spec_node_count, spec_depth, use_count, importer_id, created_at, updated_at. No deferred v1.2 columns (embedding, binding_slots, promotion columns — scope fence enforced). Migration 0022_right_firedrake.sql: IF NOT EXISTS guards (T-14-04 idempotency), inline CHECK constraint (T-14-03 cache-poisoning second line), RESTRICTIVE RLS deny-all for anon + authenticated (T-14-01/T-14-02). Applied to LOCAL Supabase (port 54322) — staging+prod PENDING DEPLOY. Verified: 14 columns, CHECK rejection live, UNIQUE+btree indexes, RLS enabled, 2 deny-all policies. UNIQUE declared as uniqueIndex() (named idx_ui_spec_templates_cache_key) for explicit ON CONFLICT target in Plan 14-03. tsc clean. Commits b1886a8 (schema + barrel), ea9c335 (migration). See 14-01-SUMMARY.md.
- **PENDING DEPLOY (from 14-01):** `npm run migrate:staging` / `migrate:prod` to apply 0022_right_firedrake to staging+prod before Plan 14-03 Supabase adapter code deploys.
- **14-02 ✓ EXECUTED 2026-06-27:** Pure, deterministic cache-key module (CACHE-02/CACHE-04). `app/application/use_cases/cache_key.py`: three stdlib-only (hashlib/json/re/unicodedata) named exports — `canonicalize_intent` (NFC+strip+lower+collapse whitespace, D-05), `compute_data_shape_hash` (SHA-256 over value-free recursive shape: sorted keys+type-names, depth-cap=8, "text"/"∅" sentinels, D-06), `compute_cache_key` (SHA-256 over 0x1f-delimited canonical_intent‖data_shape_hash‖registry_version‖context_descriptor, D-04/D-08). Keyword-only signature, context_descriptor=f"{importer_id or '__system__'}|{catalog_id}". TDD: 15/15 tests green (RED 733dcc8 → GREEN 8571fd5). Mitigates T-14-05 (cross-tenant isolation), T-14-06 (delimiter anti-collision), T-14-07 (value-free hash), T-14-08 (registry_version invalidation). ruff+mypy clean; 0 infra imports. See 14-02-SUMMARY.md.
- **14-03 ✓ EXECUTED 2026-06-27:** Exact-match cache integration (CACHE-01, D-02/D-03/D-08/D-11/D-12/D-15/D-17). `UiSpecTemplateRepository` Protocol port + two frozen DTOs (`CachedTemplate`, `TemplateToPersist`). `SupabaseUiSpecTemplateRepository` adapter: `asyncio.to_thread` wrapping (WR-06), `upsert(on_conflict="cache_key")` (D-12), direct `.update()` for use_count increment (soft metric, D-17). `GenerateUiSpecUseCase` rewritten: step 0 cache CHECK (D-02, zero-Bedrock-on-hit), `catalog_id="global"` param (D-08), persist only on `outcome != "fallback"` (D-11), `GenerateUiSpecResult.cache_hit: bool = False`. DI: `_provide_ui_spec_template_repository` factory + `UiSpecTemplateRepository` registered in `_build_provider()`; `templates` wired into use-case factory. `GenerateUiSpecView.cache_hit` field added to endpoint response. TDD: 11 adapter tests + 6 new use-case cache tests (25 total in Phase 14-03). Full regression: 624 passed, 8 skipped, 0 failures. ruff clean. Commits 6ed05f4, 6a40117, 1107771. See 14-03-SUMMARY.md.

## Phase 15 — Studio Surface — ✓ EXECUTED + REVIEWED 2026-06-27 (3 plans, 3 waves; human visual verify deferred)

- **✓ VERIFIED (gsd-verifier: human_needed — 4/4 machine-verified) + REVIEWED+FIXED 2026-06-27 (autonomous run).** All 3 plans executed: (15-01) additive `outcome` signal threaded through FastAPI GenerateUiSpecView → GenerateUiSpecResult → tRPC GenerateOutputSchema {outcome,cacheHit,reason} + 2 pure genui/studio helpers (deriveGenerationState, describePropsSchema, TDD); (15-02) `/studio` server shell + StudioTabs (Catalog | Sandbox | Showcase-link) + CatalogBrowserIsland (all 10 NAUTA_CATALOG entries, 4 facets each, live examples via the shared island) + sidebar href→/studio + the LIFTED single shared SpecRendererIsland; (15-03) GenerationSandboxIsland (intent→genui.generate enabled:false+refetch, 55/45 render/JSON split, buildActionRegistry empty-mutate seam) + the four-state GenerationStateChrome. **Code review: 0 CRITICAL/HIGH — the BEST review of the milestone.** All core guarantees verified clean: STDO-02 anti-stub (exactly ONE dynamic(ssr:false) SpecRenderer island in apps/web, no 2nd COMPONENT_REGISTRY — both /studio + /studio/preview reuse the production renderer), no-eval, four-state precedence (in-progress→fallback→cache-hit→cold+escalated), D-05 additive-only, no auto-fire query, no secret leak (EMAIL_LISTENER_API_KEY server-side), SEAM-02 mutate empty. 3 warnings + INFO **fixed** (gsd-code-fixer, commits bfe2ca3/e3ad282/936c634/88daa37): WR-01 surfaced generation transport errors (role=alert, was silently swallowed), WR-02 removed an `any` cast (typed spec as SpecRoot), WR-03 structured stderr logging in generate.ts, IN-03 nested ZodOptional/ZodDefault unwrap in describePropsSchema, IN-01 case-insensitive catalog filter. **Final: genui 182/182, api-client 118/118 tests green; typecheck (web+api-client+genui) clean; web build green (/studio 14.6 kB).** Also: removed a stray pnpm-lock.yaml a subagent created (this is an npm-workspaces project — package-lock.json is canonical). See 15-REVIEW.md / 15-REVIEW-FIX.md / 15-VERIFICATION.md.
- **Deferred — human visual verification (8 items, per overnight directive):** at `/studio` confirm the catalog renders all entries with live examples; the sandbox intent→render+JSON split; the four states are visually distinct (cache-hit teal chip, fallback red banner, cold/escalated badge, "Generating…" spinner); Showcase link; dark mode. The live cache-hit/cold/fallback states need a running FastAPI+Bedrock backend (offline, the sandbox exercises the in-progress→error path; the four-state derivation is fully unit-tested). To verify: `npm run dev` in apps/web → http://localhost:3000/studio (+ the FastAPI service for live generation).

- **Goal:** Wire the outcome/cacheHit/reason signals from the generation layer through to the studio surface (D-05), and ship two pure studio helpers (`deriveGenerationState`, `describePropsSchema`) that drive studio UI state without coupling to the renderer.

- **Plan waves:** W1 `15-01` D-05 outcome signal thread-through + studio helpers (DONE) → W2 `15-02` studio shell + generation panel → W3 `15-03` prop inspector + live preview wiring.

- **15-01 ✓ EXECUTED 2026-06-27:** D-05 outcome signal thread-through and studio helpers (TDD). Added `outcome: Literal["ok", "fallback", "escalated"] = "ok"` to `GenerateUiSpecResult` frozen dataclass and `GenerateUiSpecView` Pydantic model; cache-hit path hardcodes `outcome="ok"` (D-14), cold path reuses already-computed `_determine_outcome()` variable. Replaced tRPC `GenerateOutputSchema` discriminatedUnion with flat `z.object({outcome, spec, cacheHit, reason?})`; `SpecRootSchema.safeParse` failure overrides to `outcome="fallback"` (D-08/D-15 authoritative). Shipped two pure framework-free TypeScript helpers in `packages/genui/src/studio/`: `deriveGenerationState` (§9 state transitions: in_progress/fallback/cache_hit/cold + escalated sub-flavor, D-03d) + `describePropsSchema` (§12 prop introspection via Zod _def.typeName string comparison). `./studio` subpath export added to `packages/genui/package.json`. Additive only — no new gen/cache/renderer logic (D-05). No new packages. TDD: 6 Python tests + 5 api-client tests + 27 studio tests; all green. Typecheck + no-eval gate clean. Commits c7200f0, 0864f3e, be831d8. See 15-01-SUMMARY.md.

- **15-02 ✓ EXECUTED 2026-06-27:** /studio landing route — server shell + StudioTabs client + CatalogBrowserIsland. (1) Lifted `SpecRendererIsland` to shared `studio/_components/` (STDO-02: exactly one `dynamic(ssr:false)` wrapper); preview re-exports; sidebar Studio nav href repointed from `/studio/preview` to `/studio` (D-14). (2) `/studio/page.tsx` server component — h-12 header with static `v1` Badge + `Registry {REGISTRY_VERSION.version.slice(0,8)}` Badge (T-12-15: REGISTRY_VERSION server-only); delegates to `<StudioTabs />`. `studio-tabs.tsx` — `"use client"` Tabs with Catalog + Sandbox TabsTriggers + `next/link` Showcase affordance (aria-label="Open Component Showcase"); catalog TabsContent renders `CatalogBrowserIsland`; sandbox TabsContent placeholder "coming in 15-03". (3) `CatalogBrowserIsland` — `"use client"` island imports `NAUTA_CATALOG` directly (D-10: Zod schemas/React refs not serializable); filter input (aria-label="Filter catalog components"); card grid (aria-live="polite"); four facets per card: type chip + description, live `SpecRendererIsland` example (role=region aria-label="Live example: {type}"), `describePropsSchema` prop table (role=region aria-label="Props for {type}"), slot chips. Typecheck clean. STDO-02 + T-12-15 + D-15 gates all passing. Commits d500614, 43a4010, a441861. See 15-02-SUMMARY.md.

- **15-03 ✓ EXECUTED 2026-06-27:** GenerationStateChrome (four-state chrome driven by `deriveGenerationState` — in_progress/fallback/cache_hit/cold+escalated, UI-SPEC §9, aria-live/role=alert, D-02/D-04/D-13) + SpecRendererIsland extended with `readonly actions?: ActionRegistry` (additive, D-08) + GenerationSandboxIsland (`enabled:false` tRPC query + `await refetch()` manual trigger, `buildActionRegistry` with minimal declaredState seam D-08/SEAM-02, 55/45 ResizablePanelGroup mirroring /studio/preview D-09, spec JSON panel STDO-03) wired into studio-tabs.tsx (sandbox tab replaces placeholder). Auto-fix: wrong tRPC alias `@/trpc/react` → `~/trpc/react`. Automated verification: tsc PASS, genui 180/180 tests PASS, api-client 118/118 PASS, Next.js build PASS, security gates (no-eval, SEAM-02, D-02, T-12-15, NEXT_PUBLIC_) all CLEAN. Browser visual verification deferred per plan directive (DO NOT BLOCK). Commits adad843, d034c1b, c3c23d7. See 15-03-SUMMARY.md.

- **MILESTONE v1.1 COMPLETE:** All 4 phases (12-15) executed 2026-06-27. All 15 plans committed. Full generative-UI engine (Catalog → Spec → Registry → Renderer → Generation → Cache → Studio) operational. Pending: deploy migrations 0021+0022 to staging+prod; human browser visual check of /studio Sandbox tab.

## Phase 11 — Knowledge-node graph view (4e knowledge graph) — ✓ COMPLETE 2026-06-15 (3 plans, 3 waves)

- **✓ EXECUTED + VERIFIED + REVIEWED 2026-06-15:** all 3 plans shipped (11-01 backend, 11-02 React Flow
  foundation, 11-03 graph surface). gsd-verifier: **passed 17/17** must-haves (11-VERIFICATION.md). Adversarial
  review (11-REVIEW.md, 9 agents): 1 CRITICAL + 3 HIGH + warnings — all confirmed HIGH/CRITICAL **fixed**:
  edges-not-rendering (c936ea1 setEdges sync), inbox infinite render loop (5e13862 memoized seedItems),
  inbox entitySummary >max(100) crash (9eb6c5e cap), graph system-default taxonomy exclusion + detail-pane
  empty sections + dup edge ids + jsonb label (4ab7953), selection re-runs dagre layout (530cb5e overlay),
  knowledge_node_edges missing RLS (92134fb migration 0020 + applied local). api-client 102/102, web build green.

- **✓ DEPLOYED 2026-06-15 (staging + prod):** migrate:staging + migrate:prod applied all pending drizzle
  migrations through **0020** (caught the remotes up incl. prior-pending 0013-0018); `knowledge_node_edges` +
  deny-all RLS (2 policies) verified live on **both** envs. Code: pushed dev→staging + main→prod; ECS deploys
  **green** both envs (smoke tests passed). Web `/knowledge` deploys via Vercel git integration on the main push
  (verify at the Vercel prod domain — not checkable from CLI here). origin/main == origin/dev == a5a1fb9.

- **Deferred review items (non-blocking, backlog candidates):** WR-03 app-wide `publicProcedure`/no-auth posture
  (returns all importers' data — architectural, not a phase regression); WR-05 inert `nodeTypes` input; WR-06
  toolbar layout-toggle placeholder; knowledge-node `content`/`createdAt` + component matched-status detail fields
  (off-by-default toggles / 0 rows today); IN-01..05 cosmetic nits.

- **Planned:** 3 plans authored (gsd-planner, opus) + verified (gsd-plan-checker PASSED iter 2, 0 blockers
  after 1 revision). Inputs: existing 11-CONTEXT.md (D-01..D-13) + 11-UI-SPEC.md + generated 11-PATTERNS.md.
  Research skipped (config research:false). Decision coverage 8/8 trackable. Ready to execute.

- **Scope (D-01):** ship the SIMPLE read-only graph from existing FKs NOW; seam the real "4e knowledge
  synthesis" moat for later with no rework. `knowledge_node_edges` table ships EMPTY as the 4e write-seam
  (D-05/D-10). Strictly read-only — no synthesis/LLM write path, no node CRUD (D-09).

- **Plan waves:** W1 `11-01` backend — empty `knowledge_node_edges` table + **[BLOCKING]** migration 0019
  (generate + apply + assert table exists via information_schema) + `knowledge` tRPC router (graph/list/byId)
  behind the source-agnostic edge-provider seam (D-11) + tenant-by-data importer scope (D-12) +
  documented-only Python synthesis-trigger injection point (D-13) → W2 `11-02` frontend foundation —
  `@xyflow/react` + `@dagrejs/dagre` install (blocking package-legitimacy gate) + `/knowledge` route
  (dynamic ssr:false island) + dagre TB layout + 6 custom node types + edge styling + sidebar nav flip
  (D-07/D-08) → W3 `11-03` frontend surface — three-zone shell (filter rail / canvas / detail pane) +
  toolbar + taxonomy banner + per-type detail deep-links (/entities, /emails) + all states + a11y +
  browser verify (**autonomous:false** human-verify) (D-02/D-03/D-08).

- **PENDING DEPLOY (from 11-01):** `npm run migrate:staging` / `migrate:prod` (packages/db) to apply
  migration 0019 (`knowledge_node_edges`) to staging+prod Supabase before the next web+listener deploy.

- **Edge-source note:** the component↔entity_instance edge derives from
  `component_entity_candidate_links.entity_instance_id` (CONTEXT D-04) — NOT
  `email_components.entity_instance_id` (UI-SPEC Note #3 was wrong; that column does not exist). Resolved
  in plans + 11-PATTERNS.md "Schema Discrepancy".

- **11-01 ✓ EXECUTED 2026-06-15:** knowledge_node_edges schema + migration 0019 + tRPC router (graph/list/byId) with D-11 edge-provider seam + D-13 comment. 22 DB-free tests green (102 total), tsc+ruff clean. Commits 2e2a6e9, aa685f7, 92ce4a5. See 11-01-SUMMARY.md.

- **11-02 ✓ EXECUTED 2026-06-15:** @xyflow/react + @dagrejs/dagre installed; /knowledge route (server page + ssr:false island via "use client" wrapper — Next.js 15 constraint); dagre TB layout util; six custom node components per UI-SPEC; Knowledge sidebar nav promoted to live. ReactFlow JSX cast workaround (moduleResolution:bundler named re-export issue). api-client dist rebuilt. tsc + web:build green. Commits aa533f0, ca4e0df, 2de84e1. See 11-02-SUMMARY.md.

- **11-03 ✓ EXECUTED 2026-06-15:** Three-zone ResizablePanelGroup chrome (filter rail 18% / canvas 57% / detail pane 25%) + h-11 toolbar; six per-type node detail sections with /entities + /emails deep-links; dismissible taxonomy banner (localStorage); GraphErrorState + GraphNoSchemaState; Escape/canvas-click deselect; auto-show <50 instances threshold. D-09 read-only invariant + T-11-05 dangerouslySetInnerHTML grep gate both confirmed green. Browser human-verify: approved. tsc + web:build green. Commits e88addf, 6c88196, f2464ea. See 11-03-SUMMARY.md.

- **Next:** Phase 11 implementation complete (all 3 plans executed + browser-verified). Pending: phase-level verification by orchestrator; PENDING DEPLOY — npm run migrate:staging / migrate:prod to apply migration 0019 (knowledge_node_edges) to staging+prod before next deploy.

## Phase 10 — Extracted-entity identity, gallery & detail (4c) — PLANNED 2026-06-14 (6 plans, 5 waves)

- **Planned:** 6 plans authored (gsd-planner, opus) + verified (gsd-plan-checker PASSED iter 2, 0 blockers)
  + UI-SPEC + PATTERNS generated. Decision coverage 21/21 (D-01..D-21). Commits: 1444bce (UI-SPEC+PATTERNS),
  b59e929 (plans), 521f767 + ffe968f (review fixes). Ready to execute.

- **Resume file:** .planning/phases/24-dual-channel-genui/24-02-PLAN.md
- **Architecture locked:** identity = **repurpose `entity_instances`** (nauta_id nullable + `source`
  col); resolution = **suggest-only, never auto** → **parallel BlendedRAG (dense HNSW + lexical
  pg_trgm exact/fuzzy) fused by RRF(k=60)**, on-confirm + re-runnable backfill, confirm writes back
  aliases (flywheel), reranker deferred, degrades to lexical-only without Bedrock. Gallery = table
  default (+mosaic), full ops rows, "needs review" triage filter. Detail = full relations,
  conflicting values shown+flagged (human picks), confirm/reject + unmerge.

- **Plan waves:** W1 `10-01` schema reshape (nullable nauta_id + `source` + gallery index) + resolution
  RPCs + **[BLOCKING]** drizzle generate/apply/types (migrations 0016/0017) → W2 `10-02` BlendedRAG+RRF
  resolution backend (deterministic 4-type match_type, lexical-only degradation, backfill) → W3 `10-03`
  curation backend (confirm/reject/unmerge + alias write-back) → W4 `10-04` `entityInstances` tRPC
  (`list`+`byId` + mutations) → W5 `10-05` gallery `/entities` (table/mosaic, triage filter) ∥ `10-06`
  detail `/entities/[id]` (4 regions, conflict flagging, entity-chip deep-link; **autonomous:false** human-verify).

- **PENDING DEPLOY (from 10-01):** `npm run migrate:staging` / `migrate:prod` (packages/db) to apply
  migrations 0016/0017 to staging+prod Supabase before the next web+listener deploy.

- **10-01 ✓ EXECUTED 2026-06-14:** entity_instances schema reshape + resolution RPCs. nauta_id nullable;
  source='email_extracted' column; partial unique WHERE nauta_id IS NOT NULL; gallery index; migration 0016
  (DDL) + 0017 (RPCs + trgm GIN indexes incl. immutable_array_to_text wrapper) applied to local Postgres.
  tsc clean. Commits e7e1f17, 4cb0c6f, d95bc11. See 10-01-SUMMARY.md.

- **10-02 ✓ EXECUTED 2026-06-14:** BlendedRAG+RRF resolution backend. PromoteEntityOnConfirmUseCase (D-02/D-09/D-11), BackfillEntityIdentitiesUseCase (D-10), /v1/entity-instances router (GET /candidates + POST /backfill), DI wiring (container + main). 36 tests green, ruff+mypy clean. Commits d661234, aa25781, 023e1d9. See 10-02-SUMMARY.md.

- **10-03 ✓ EXECUTED 2026-06-14:** Human curation loop (D-20). ConfirmMergeUseCase (D-09 audit + D-11 alias flywheel), RejectMergeUseCase (durable dismiss), UnmergeEntityUseCase (supersede-never-mutate). Port extended with select/dismiss/set_merge_state. Three POST endpoints on /v1/entity-instances. 26 tests green, ruff+mypy clean. Commits cff77df, cd3b311, 1dcbd7f. See 10-03-SUMMARY.md.

- **10-04 ✓ EXECUTED 2026-06-14:** entities tRPC router. gallery.ts (list with pg_trgm search, limit+1, status/sort filters), detail.ts (byId with four D-18 regions + D-19 conflict detection via aggregateEntityFields), mutations.ts (confirmMerge/rejectMerge/unmerge FastAPI proxy, key server-side), entitiesRouter composed into appRouter. 26 tests green, tsc+build clean. Commits f8b54e9, 9dc9f93, 27baf04, 630c27f, ff1aef4, 393b983. See 10-04-SUMMARY.md.

- **10-05 ✓ EXECUTED 2026-06-14:** Entities gallery at /entities. Server-component page wrapper + "use client" gallery shell (view toggle, debounced search, entity-type + status + sort filters, load-more pagination limit+1). 7-column table view (D-15: sortable headers, violet dot accent, amber candidate rows, orange pending-duplicates badge) + responsive mosaic grid (D-14: 4-col xl, card-per-entity). Sidebar Entities item promoted from SOON_NAV_ITEMS → LIVE_NAV_ITEMS (D-21). tsc clean; Next.js build: /entities static 6.96 kB. Commits c860395, cc5f57c. See 10-05-SUMMARY.md.

- **Next:** 10-06 detail page /entities/[id] (4 regions, conflict flagging, entity-chip deep-link; autonomous:false human-verify).

## Status

- Phase 1 (service + scaffold): ✓ Complete — verified in Docker, all quality gates green
- Phase 2 (infra + CI/CD): ✓ Complete — ECS Fargate live, both pipelines green, /health 200 on staging (:8080) and production (:80)
- Phase 3 (email connection): ✓ Complete — end-to-end verified live: forward from pedromaschio.shin@gmail.com → agent@magnitudetech.com.br → `email_received` in CloudWatch (2026-06-11T17:14:26Z)

## Phase 4 — Email Intelligence — EXECUTION COMPLETE + LIVE GAP CLOSURE 2026-06-12

- All 14 plans (04-01..04-14) executed with SUMMARYs; gates green (89.95% cov).
- Verifier: 6/6 success criteria materially met (04-VERIFICATION.md). Status human_needed
  for ONE item only: live Textract OCR + live Claude segmentation end-to-end (offline tests
  are credential-gated; text-layer ingest already UAT-confirmed live on prod+staging).

- Code review: 0 CRITICAL; 4 HIGH — 3 fixed (cb5a522), HIGH-4 (trgm key_terms) is a
  documented follow-up. Retrieval is vector-only until a key_terms extractor lands.

- Open follow-ups: (a) ✓ RESOLVED 2026-06-13 (Phase 08): key_terms extractor activates trgm arm;
  (b) ✓ RESOLVED 2026-06-13 (Phase 08): confirm-fallback FK fix — skip-and-warn instead of entity_type_id="";
  (c) Textract analyze_document for table/KV geometry (04-14 deferral) — still open.

### Live gap closure (2026-06-12, verified against real local Supabase)

Running Phase 4 against real Postgres exposed bugs the fake-repo suite hid; all fixed:

- 98cb882: NUL strip (components), enum +pending+error (migration 0010), pdfminer log pin.
- cf5dd24: NUL strip extended to extraction_records via shared supabase/sanitize.py (22P05).
- e42ca00: D-18 tenancy — reads/act surfaces no longer hardcode DEFAULT_IMPORTER_ID
  (real ingested emails were invisible/404; Phase 5 inbox would have been empty).

- 8f9057b: default Bedrock model id -> us.anthropic.claude-sonnet-4-6 (active profile).
- 5149f12: real-Postgres integration test (env-gated, -m integration) for
  parse->persist->read-back; first run caught a 4th live bug — extraction_records
  lacked confidence_breakdown + routing_reason (every live autofill save failed
  PGRST204) — fixed by migration 0011 (applied local; staging/prod pending migrate).

- pdfminer hang timeout: already present at HEAD (56baa5b) — asyncio.wait_for 60s
  around _extract_text_layers with pypdf+OCR fallback; briefing claim was stale.

### DEPLOY — DONE 2026-06-13 (staging + production live on current code)

- Migrations 0010/0011/0012 applied to **staging + prod** Supabase (idempotent
  ADD VALUE/COLUMN IF NOT EXISTS; "12 tables" verified each).

- Pushed `dev` (→ staging deploy) and `main` (→ prod deploy); both GitHub Actions
  deploys **succeeded**; `/health` 200 on staging (:8080) and prod (:80). CI green
  after a ruff-format fix (56811c4). Service = email-listener (FastAPI) only — the
  Next.js web app has no CI/CD pipeline (runs local; deploy separately if needed).

- IAM: NO change needed — ECS task role already wildcards
  `foundation-model/amazon.titan-embed-*` (covers titan-v1) + `anthropic.claude-*`

  + inference-profile (covers segmentation/autofill). Confirm/embedding works live.
- Auth verified enforced (401 without the real key; deployed key lives in AWS
  Secrets Manager, not local .env — correct). For a full authenticated smoke test
  use the real Secrets Manager API_KEY.

### HUMAN ACTIONS REQUIRED (deploy) — ✓ RESOLVED 2026-06-13 (see DEPLOY above)

1. ~~AWS Bedrock Anthropic use-case form~~ **RESOLVED 2026-06-12**: live Claude
   segmentation VERIFIED in browser — real token-grounded region overlays rendering
   over an ingested JUUL commercial invoice on /emails/[id] (user screenshot;
   importer = gmail-resolved bbef1760…, D-05+D-18 confirmed live). Use-case form
   submitted + IAM region wildcard fix (5d59b57). This also closes Phase 4's last
   human_needed verification item (live Claude segmentation end-to-end).

2. **Push + deploy**: main is ~80 commits ahead of origin, unpushed. staging+prod ECS
   still run pre-04-07 (ingest-only) images; prod deploys on push to main. Push when ready.

3. **Apply migrations 0010+0011+0012 to staging/prod** (npm run migrate:staging /
   migrate:prod in packages/db) before/with the next deploy — live autofill writes
   fail without 0011; region source_type fails without 0012.

4. **IAM: permit bedrock:InvokeModel for amazon.titan-embed-text-v1** on the ECS
   task role (embeddings switched v2→v1 to match the halfvec(1536) schema —
   facd71d). Local dev uses developer creds; staging/prod policy must allow v1.

5. **apps/web/.env.local needs EMAIL_LISTENER_URL + EMAIL_LISTENER_API_KEY** for
   the tRPC write-proxy (added locally during UAT; gitignored). Any deployed web
   app needs both set server-side (never NEXT_PUBLIC_).

### Live UAT fixes (2026-06-13, found by running the review UI end-to-end)

Real bugs the fake-repo suite could not catch — all fixed + tested + gates green:

- 739ea1d: entity_type_fields mapping — repo read data_type/is_identifier but the
  schema has field_type + config.is_identifier jsonb; every live autofill 500'd
  (KeyError) until fixed. Autofill now runs end-to-end (cold-start LLM verified).

- facd71d: embedding dim — Titan V2 emits 1024, column is halfvec(1536); confirm
  500'd (22000) + retrieval arm silently failed. Switched to Titan V1 (1536).
  Confirm + few-shot retrieval verified live.

- 7c3b017: reprocess replace-not-stack — was duplicating page/region components
  every run (2-4x in live data); now supersedes prior non-confirmed regions.

- 8627747: overlay/draw z-index — react-pdf .textLayer (z-index:2) covered the
  boxes; clicking/hovering a box and click-drag draw all silently failed.

- 73696b6: feat — "Classify Page" button (autofill a whole page as one entity).
- .env.local: missing EMAIL_LISTENER_* made every write-proxy mutation throw.

Note: confirmed-region components are now created via createRegion (candidate) +
confirm; the autofill→confirm→embed→index flywheel is verified working live.

## Phase 5 — Review UI — EXECUTED 2026-06-12 (pending 3 visual browser checks)

- 4/4 plans executed: emails.detail tRPC + polygonToRect (05-01), signed-URL attachment
  route (05-02), /emails/[id] detail page with DOMPurify body tabs + entities sidebar
  (05-03), react-pdf preview + region overlay layer with hover/page sync (05-04).

- Verification: 11/11 machine criteria pass; human_needed = view detail page, PDF
  preview, inbox navigation in browser (user live-testing during the run).

- Code review: 4 CRITICAL + 5 WARNING — ALL fixed (6928599..d568e6b): DOMPurify
  useEffect pattern, polygonToRect empty/clamp guards, superseded-record join filter,
  clear missing-DB-URL error, signed-URL TTL cache, friendly error copy, controlled
  page navigation.

- Live-UAT bugs fixed during the run: client bundle pulled postgres via api-client
  barrel (geometry subpath export, 4b364b3 + .next cache clear), pdfjs API/worker
  version mismatch (pin pdfjs-dist 4.8.69, 8659a7d).

- Overlay empty state is the intended default until the Bedrock use-case form is
  submitted (see HUMAN ACTIONS above).

## Phase 6 — Region Edit Operations — EXECUTED 2026-06-12 (pending 5 visual browser checks)

- Verification (792e268): 5/5 machine criteria; human_needed = 5 visual checks
  (add-region draw at zero proposals, accept transition, reject→history, merge,
  nest round-trip).

- Code review: 5 CRITICAL + 8 WARNING — ALL fixed (60d4271..980bb8c): nest cycle
  detection, save-before-supersede ordering (no data loss on partial failure),
  empty-update ValueError→404, UUID-leak in 404 details, persist-failure masking,
  TOCTOU status guards, UUID path params, aria contracts, readonly fields.

- Gates after fixes: pytest 321 passed 90% cov, ruff/mypy/lint-imports/bandit 0;
  api-client vitest 14/14 + tsc 0; web tsc 0 + next build green.

- 06-01 ✓ EXECUTED: FastAPI write side complete. Seven use cases
  (accept/reject/redraw/split/merge/nest/create-region) in edit_region.py;
  ComponentRepository +update_status/+update_parent/+find_by_page_component_id;
  seven endpoints in components.py (9 @router.post total) behind X-API-Key with
  Pydantic polygon validation (4 [x,y] pairs, [0,1], page_index>=0 → 422);
  seven class-form DI registrations; env-gated real-Postgres accept+redraw
  round-trip. Gates: pytest 90.54% cov, ruff/mypy/lint-imports/bandit all 0.
  Commits dbf2dc7, 8b9f15b, 7ecf12c, fa1b3a8, a96199c. See 06-01-SUMMARY.md.

- 06-02 ✓ EXECUTED: TS geometry helpers + server-side tRPC mutation proxy.
  clientXYToNormalized + normalizedRectToPolygon (pure, immutable, TDD); seven
  tRPC mutations (accept/reject/redraw/split/merge/nest/createRegion) with zod
  input validation and server-side env guard; EMAIL_LISTENER_API_KEY never
  NEXT_PUBLIC_; .env.example created. tsconfig "dom" lib added (auto-fix).
  Commits 19441d6, 30cf3eb, f644b1f. See 06-02-SUMMARY.md.

- 06-03 ✓ EXECUTED: interactive write surface on the PDF preview. useRegionEdit
  hook (selection/draw state + accept/reject/redraw/split/createRegion with
  optimistic setData + snapshot revert + sonner toasts + mutatingIds for
  aria-busy); DrawOverlay (pointer-capture, min 0.01, live dashed preview);
  DrawModeBar (exact §6.2 copy); ActionToolbar (six §3.2 buttons, Merge/Nest
  disabled until 06-04); status-styled clickable overlay boxes
  (pointer-events-auto fix); showHistory filter + toggle; + Add region works
  with zero proposals via resolved attachment_page component; Esc/Delete/A
  shortcuts; Toaster in layout. tsc + next build green.
  Commits 569e8e0, 0cdfebd, 4dfcb62. See 06-03-SUMMARY.md.

- 06-04 ✓ EXECUTED: AlertDialog reject confirmation, Popover nest picker with eligible-region
  filter (same page, not rejected/superseded, not selected), checkbox merge multi-select (1
  selected enters mode, ≥2 fires mutation), §6.6 history badges (rejected=outline+line-through,
  superseded=secondary+opacity-60), showHistory filter on EntitiesList, "+ Add region" in card
  header with disabled tooltip. All three 06-03 stubs resolved. Gates: tsc+next build clean,
  vitest 14/14, pytest 315 passed 90.54% cov, ruff/mypy/lint-imports/bandit clean.
  Commits 6bc3ddb, 082d076, ba18bd4. See 06-04-SUMMARY.md.

## Phase 7 — Click-to-Autofill UI — COMPLETE 2026-06-13

- 07-01 ✓ EXECUTED: API client data layer complete. Three proxy mutations
  (autofillComponent/confirmComponent/reprocessEmail) with UUID validation + server-side
  env guard; entityTypesRouter (Drizzle leftJoin active entity types + fields, grouped by
  pure helper); emails.detail extended with correctedFields/confidenceBreakdown/extractionRecordStatus.
  TDD: 8 mutation tests + 5 entity-type tests; 27 total vitest pass; tsc 0.
  Commits 6e80b51, 96710e8, dd966ee. See 07-01-SUMMARY.md.

- 07-02 ✓ EXECUTED: Autofill panel UI complete. useAutofill hook (7-state machine:
  idle→picking→extracting→reviewing→confirming→confirmed/failed) wiring autofillComponent +
  confirmComponent tRPC mutations; EntityTypePicker Popover (api.entityTypes.list, w-72,
  role=listbox/option, Skeleton loading, empty state); ActionToolbar extended with
  allDisabled gate + autofill button per UI-SPEC §3.1 (candidate/pending/terminal/confirmed
  states). api-client dist rebuilt (Phase 7 procedures not in prior dist). tsc + next build green.
  Commits 7df413a, 4da300d, 47a36d9. See 07-02-SUMMARY.md.

- 07-03 ✓ EXECUTED: FieldsPanel (reviewing editable inputs + per-field confidence,
  confirmed read-only + badge), ReprocessDialog ("Keep current data" cancel, default
  variant per D-16), EntitiesList inline panel slot, email-detail full wiring
  (useAutofill + entityTypeFieldsMap + reprocess). Gates green both stacks.
  Commits d1d6b14, 4691f9a, 94bb527. See 07-03-SUMMARY.md.

- Verification: 9/9 must-haves; human_needed = 3 live flows (autofill round-trip,
  confirm-with-corrections, reprocess dialog) — NOW LIVE-TESTABLE: Bedrock unblocked.

- Code review: 4 CRITICAL + 5 WARNING + 3 INFO — all fixed except IN-01 audit note
  (1ba5836..afc6817): picker race guards, stale-closure closePicker, confirm
  double-fire guard, corrected-fields diff from extractedFields keys with error
  toast on lost state, shared status-badge module, immutable grouping.

## Phase 8 — trgm key_terms extractor — COMPLETE 2026-06-13

- 08-01 ✓ EXECUTED: Pure stdlib domain service extract_key_terms (ISO 6346 check-digit validation,
  BL/BOOKING/PO/INVOICE label-anchored patterns, ReDoS mitigated by bounded regexes + _MAX_SCAN_CHARS

  + _MAX_TERMS cap); wired into AutofillUseCase replacing key_terms=() stub; confirm-fallback FK fix
  (skip-and-warn, D-15 flywheel preserved). Extended real-Postgres integration test covers no-save +
  embedding-persisted path. Quality gates: pytest 90.27% cov, ruff/mypy/lint-imports/bandit all clean.
  Commits 17e548c, d12a3ef, eca4358, f277891. See 08-01-SUMMARY.md.

- Closes: HIGH-4 from Phase 4 code review (trgm arm inert), live FK crash on confirm-fallback path.

## Phase 9 — Entity/Field Region-Relationship Model + Canvas — IN PROGRESS 2026-06-13

- 09-01 ✓ EXECUTED: relationship-model migration (the blocking data-layer foundation, D-01..D-05).
  enums.ts: new componentRoleEnum pgEnum (component_role = entity|field|unrelated; NULL=unclassified).
  components.ts: 3 nullable columns on email_components — role (component_role), entity_type_id
  (FK→entity_types.id), entity_type_field_id (FK→entity_type_fields.id), both ON DELETE SET NULL —

  + indexes idx_email_components_role / idx_email_components_entity_type_id. tsc clean.
  Migration 0013_fixed_jamie_braddock generated under packages/db/migrations/ (NOT src/migrations/
  — drizzle.config out=./migrations) AND applied to local Postgres; verified live: 3 columns +
  component_role enum (3 labels) + 2 indexes + 2 FKs with confdeltype=n (SET NULL).
  Drift fix: scoped 0013 to the Phase-9 change only — removed drizzle-kit's re-emitted region/pending/
  error enum values + extraction_records cols (already live via custom 0010/0011/0012, un-snapshotted);
  added IF NOT EXISTS guards for idempotency. Commits e1c5cc5, c8a1463. See 09-01-SUMMARY.md.

- PENDING DEPLOY FOLLOW-UP (09-01): npm run migrate:staging / migrate:prod (packages/db) to apply
  0013 to staging+prod Supabase before/with the next web+listener deploy that reads these columns.

- 09-02a ✓ EXECUTED: relationship-write backend (D-10/D-11/D-18), Wave 2, depends on 09-01.
  Component entity + ComponentRepository gained role/entity_type_id/entity_type_field_id (3 defaulted frozen
  fields) + four writers (update_role / update_entity_type / update_field_relationship[parent+field in one
  update] / clear_candidate_fields), each mirroring update_status (ValueError on no-match). Three domain-pure
  setter use cases (SetComponentRole/EntityType/FieldRelationship) + origin-aware DenyFieldUseCase:
  auto-detected box → update_status('rejected') + append denied polygon to PARENT content_raw.denied_field_polygons
  (D-19 memo 09-02b reads); user-drawn box → clear_candidate_fields + supersede_active (keep geometry, D-18).
  Four endpoints on /v1/components (PATCH /role /entity-type /field-relationship, POST /deny) behind router
  X-API-Key, ValueError→404, UUID path params, Pydantic Literal role allow-list; tenant-from-row on every path.
  DI: 4 simple provider.provide registrations. 19 per-use-case AsyncMock tests (-k traceable). Gates: pytest
  89.84% cov, ruff/mypy(85)/lint-imports(3 kept)/bandit all 0. Commits cef5775, eb6e4a3, dd28be5, 4158003.
  See 09-02a-SUMMARY.md. NOTE: autofill-fields endpoint deferred to 09-02b (which stamps origin='auto_detected').

- 09-02b ✓ EXECUTED: sub-field autofill backend (D-13/14/15/19), Wave 3, depends on 09-02a. TDD.
  AutofillFieldsUseCase (domain-pure) — given an ENTITY component: guards role=='entity'+entity_type_id+tenant
  (D-18), resolves EntityType via new EntityTypeRepository.find_by_id (port+Supabase impl; 09-03 had NOT landed an
  equivalent), reads the entity's page tokens (_page_tokens), filters to tokens whose bbox-center is inside the
  entity polygon, segments only those, grounds each proposal via _union_polygon of real token bboxes (never
  invented), EXCLUDES proposals overlapping the parent content_raw.denied_field_polygons memo (D-19 — positive-area
  box overlap, not exact match), creates candidate FIELD children stamped content_raw origin='auto_detected'
  (closes the 09-02a deny forward-dependency), incorporates existing user-drawn field children, and autofills each
  child as a CANDIDATE (one autofiller.autofill per child — reuses autofill.py cold-start+few-shot verbatim; KB =
  entity-type description) mapping best-confidence slug -> entity_type_field_id + value + confidence, persisting
  ExtractionRecord(status=candidate) + update_field_relationship. POST /v1/components/{id}/autofill-fields
  (@inject FromDishka, ValueError->404, UUID path, router X-API-Key) returns the per-field list;
  _provide_autofill_fields_use_case factory mirrors _provide_autofill_use_case (explicit embedder/retrieval +
  segmenter). 12 AsyncMock/fake-repo tests (RED confirmed via ModuleNotFoundError, then GREEN). Gates: pytest
  401 passed 89.06% cov, ruff/format/mypy(86)/lint-imports(3 kept)/bandit all 0. Commits ccff306, a74742f.
  See 09-02b-SUMMARY.md.

- 09-05 ✓ EXECUTED: app-shell primitives (D-21), Wave 1, pure presentation, no backend.
  packages/ui/src/sidebar.tsx — canonical shadcn sidebar block hand-vendored (resizable.tsx
  precedent; no shadcn CLI init, NO new npm dependency — T-09-40/T-09-SC satisfied), cn from the
  @nauta/ui barrel + sibling primitives via relative imports, inline useIsMobile hook, full sidebar
  family exported (SidebarProvider/Sidebar/SidebarInset/SidebarTrigger/Content/Header/Footer/Menu/
  MenuItem/MenuButton/useSidebar + …). Reuses the existing --sidebar-* HSL tokens (already mapped to
  the sidebar.* color family in packages/ui/tailwind.config.ts) — ZERO new design tokens.
  apps/web/src/components/theme-provider.tsx — typed next-themes wrapper (ThemeProvider as
  NextThemesProvider, forwards ComponentProps), layout.tsx untouched (09-06 wires it). Consumed via
  the @nauta/ui/* subpath wildcard (@nauta/ui/sidebar) — barrel index.ts keeps exporting only cn
  (Rule-3 alignment: no component is ever re-exported from the barrel, contrary to the plan's literal
  "add to index.ts" wording). Gates: packages/ui tsc 0, apps/web tsc 0, api-client build 0.
  Commits 4311d42, f97371b. See 09-05-SUMMARY.md.

- 09-03 ✓ EXECUTED: entity-type/field management backend (D-26/D-27), Wave 4, depends on 09-01/09-02b. TDD (Task 2).
  EntityTypeRepository made write-capable (EXTENDED 09-02b's find_by_id, not duplicated): create/update entity types;
  create/update/delete/reorder fields; deactivate_field; count_confirmed_references (exact count on email_components
  filtered to entity_type_field_id + extraction_status='confirmed' — the D-27 delete-guard). Postgres unique-violation
  (23505 off postgrest APIError.code) -> 'slug exists' ValueError marker -> 409. is_identifier kept in config jsonb.
  manage_entity_types.py (domain-pure) — 6 use cases with ALLOWED_FIELD_TYPES={string,number,date,array,object}
  allowlist + per-type slug pre-check + delete-guard (CHOSE soft-deactivate on confirmed refs > 0, never orphans the
  D-04 FK; zero -> hard delete; outcome via DeleteFieldResult). NEW /v1/entity-types router (X-API-Key at router level):
  POST / PATCH /{id} POST /{id}/fields PATCH /fields/{id} DELETE /fields/{id} POST /{id}/fields/reorder; field_type
  Pydantic field_validator (defense in depth); ValueError->409(slug)/404 via NoReturn helper. Mounted in main.py;
  6 use cases registered in container.py (auto-inject EntityTypeRepository). 14 use-case tests (TDD RED->GREEN) +
  9 router integration tests (mock-DI test client, lifts entity_types.py 68%->90%). Gates: pytest 424 passed/8 skipped
  87.06% cov, ruff/format/mypy(88)/lint-imports(3 kept)/bandit all 0. Commits f2216cd, cde58b6, 0cf9217, 4d1496f,
  5f9ea79. See 09-03-SUMMARY.md.

- 09-04 ✓ EXECUTED: TypeScript/tRPC data layer over the 09-01/02/03 backends (D-15/D-23/D-26), Wave 5,
  depends on 09-01/02a/02b/03. Extracted getListenerConfig + parseErrorDetail out of emails/mutations.ts
  into a shared router/_listener-config.ts (the "extract to shared" PATTERNS option) — both the new
  component mutations and the entity-type write mutations import the single definition; EMAIL_LISTENER_API_KEY
  now lives in exactly one source file (never NEXT_PUBLIC_, T-09-30). emails/detail.ts now surfaces
  role/entityTypeId/entityTypeFieldId per component (direct column reads, no join change). Six component
  mutations added (setRole PATCH /role, setEntityType PATCH /entity-type, setFieldRelationship PATCH
  /field-relationship, autofillFields POST /autofill-fields, denyField POST /deny, confirmField = Phase-9
  alias over the existing /confirm proxy) — each X-API-Key server-side, ids z.string().uuid()-validated
  (T-09-31), role/fieldType z.enum allowlists (T-09-32), snake_cased bodies. New emails/entity-summary.ts:
  entitySummary batch query (input {emailIds}.max(100), T-09-33) using a single parameterized inArray on
  role='entity' non-rejected/superseded components left-joined to entity_types, aggregated by the pure
  DB-free aggregateEntitySummary helper to {emailId, entities:[{entityTypeId,label,count}]}[] one-per-id
  (D-23). New entity-types-write.ts: create/update type + createField/updateField/deleteField/reorderFields
  proxying /v1/entity-types, spread into entityTypesRouter (list preserved). TDD Task 4: 3 new vitest files
  (component-relationship-mutations 12, entity-summary 6, entity-types-write 10) — 55/55 api-client tests
  green. Gates: api-client build 0 (dist rebuilt + new procedures verified present), api-client tsc 0,
  apps/web tsc 0. Commits 6ae641b, 27e9255, be22a71, 0ca1302. See 09-04-SUMMARY.md.

- 09-06 ✓ EXECUTED: app shell + glassy Gmail inbox (D-20/21/22/23/24), Wave 6, depends on 09-04/09-05. Pure
  presentation, no backend. layout.tsx rewritten as the app shell — TRPCReactProvider > ThemeProvider(attribute=class
  defaultTheme=system enableSystem) > SidebarProvider > AppSidebar + SidebarInset({children}); Toaster preserved as a
  sibling, suppressHydrationWarning on <html> (original provider ordering kept). app-sidebar.tsx: frosted left rail
  (bg-background/70 backdrop-blur-md border-r border-border/50), Inbox + Entity Types live next/link nav with
  usePathname active state (bg-primary/10 text-primary + aria-current), Entities + Knowledge disabled "Soon"
  (secondary Badge, text-muted-foreground/50 cursor-not-allowed), Sun/Moon next-themes toggle gated on a mounted
  check (no SSR throw). entity-chips.tsx: <=4 violet-family translucent Badge chips (label + ·count) + N overflow,
  each a next/link deep-link to /emails/{id} (D-24, stopPropagation so chips don't toggle row selection), empty ->
  null (anti-bloat D-23). inbox-row.tsx: >=64px Gmail row (semibold sender + date, truncated subject, EntityChips),
  selected bg-primary/10. inbox-three-pane.tsx: ResizablePanelGroup filters(18/min14)·list(42/min28)·preview(40),
  frosted surfaces, All/Unread/With-entities filter, default-select first item, reading preview =
  sender/subject/body-snippet + "Open editor →" (attachments live only on emails.detail — preview is data-honest, no
  stub), single batched emails.entitySummary keyed by the visible page (enabled-guarded, Map-indexed onto rows, never
  per-row), Load-more appends pages via a second enabled:false emails.list refetch (hasMore/nextOffset preserved).
  page.tsx keeps the emails.list query + isError useEffect, drops the centered max-w-3xl wrapper, renders
  <InboxThreePane> in an h-svh slot. Gates: apps/web tsc 0 (x3); npm run web:build (api-client tsc + next build) EXIT
  0 — / static, all 4 routes compiled. Commits 4f66e64, d7a9820, 7ee0cad. See 09-06-SUMMARY.md.

- 09-07 ✓ EXECUTED: entity-type & property management surface at /entity-types (D-25/26/27), Wave 6, depends on
  09-04/09-05. Pure UI consuming the existing Phase-9 write mutations — no new backend, no new npm packages.
  EXTENDED entityTypes.list (the plan's preferred id-exposure fix over a new byId query): additively returns type
  id/isActive + per-field id/sortOrder/isIdentifier (is_identifier read from config jsonb via COALESCE(... ->>
  'is_identifier')::boolean), grouping switched slug->id (slug not unique with inactive rows), + an includeInactive
  flag (default false keeps the Phase-7 pickers active-only; the page passes true). The two list consumers
  (entity-type-picker, email-detail) read only preserved keys -> compile untouched. use-entity-type-admin hook wraps
  the six write mutations (create/update type + create/update/delete/reorder field) with use-region-edit optimistic
  snapshot/revert against the {includeInactive:true} cache + sonner toasts; deleteField AWAITS mutateAsync and
  resolves the FastAPI DeleteFieldView {hard_deleted, soft_deactivated} outcome, toasting the honest D-27 result
  (never mis-reports a soft-deactivate as a hard delete). field-row-dialog: controlled create/edit Dialog, field_type
  Select constrained to exactly string|number|date|array|object + Zod z.enum re-check (T-09-60), is_required/
  is_identifier checkboxes, Zod slug regex; Delete behind an AlertDialog whose copy + confirm variant are
  reference-aware (referenced -> "Deactivate this field?" + variant=secondary, never destructive; D-27). page.tsx
  master list (w-72 border-r, frosted +New type header, active/inactive Badges, Skeleton/error/empty, default-select
  first) + create-type dialog; entity-type-detail: name/description save-on-blur -> updateType, active Switch
  (non-destructive deactivate), Fields table (Label/Slug/Type/Required/Identifier/order/edit) with add/edit via the
  dialog + up/down reorder -> reorderFields. No fetch/X-API-Key/NEXT_PUBLIC under entity-types (T-09-61). Gates:
  api-client build 0 + vitest 56/56 (updated groupEntityTypeRows fixtures), apps/web tsc 0 (x3), npm run web:build
  EXIT 0 (/entity-types 27.9 kB static, all 6 routes). Commits bbda632, 9863d72, 03085e6. See 09-07-SUMMARY.md.

- 09-08 ✓ EXECUTED: canvas editor STRUCTURAL layer (D-06/07/08/09/10/12), Wave 6, depends on 09-04 + Phase 6 redraw.
  Pure UI, additive/back-compat — the existing /emails/[id] editor still typechecks + builds (critical-no-break honored).
  EXTENDED 3 primitives: region-overlay-box gained optional role/isActiveParent/showConfirmDeny props + 4 palette maps
  (ROLE_BORDER/HOVER/SELECTED_RING/CHIP; entity=violet, field=amber, unrelated=slate, unclassified=primary) — roleClass
  replaces statusClasses only when classified+non-terminal, active-parent ring-4 ring-violet-400/40, inline ✓/✗ slot at
  -top-3 right-0 z-30; overlay-layer gained roleFilter/activeParentId/showUnrelated + a pure isRoleVisible D-12 rule
  (entity/unclassified always, field only when parentComponentId===activeParentId, unrelated hidden unless toggled, history
  bypasses); pdf-preview-pane zoom 0.25-4.0 (was 0.5-3.0) + {N}% reset + Fit width/Fit page + Cmd/Ctrl+scroll zoom-to-cursor
  (rAF re-anchor) + Space-drag pan (pointer capture, cursor-grab/grabbing) + zoom keybindings, page-sync/display:none overlay
  intact. NEW canvas-toolbar (h-11 role=toolbar: Select/Draw armed bg-primary/10 text-primary border border-primary/30,
  aria-pressed+aria-keyshortcuts v s/d + V/S/D window keybinding skipping form fields; nav aria-live; zoom group;
  Regions/History/Unrelated switches, Unrelated default off D-12; X close). NEW canvas-shell (four-zone: h-11 toolbar /
  w-64 LAYERS / flex-1 min-w-0 CANVAS / w-72 INSPECTOR, panels as ReactNode slots — 09-09 plugs them). NEW use-canvas-state
  (mode select/draw + selectedIds single/shift + activeParentId; onBoxGeometryChange routes move/resize to the EXISTING
  Phase-6 edit.redraw = D-09 supersede, NO new geometry mutation; onDrawComplete -> createRegion; immutable as const). NEW
  use-role-mutations (setRole/setEntityType/setFieldRelationship/confirmField/denyField OPTIMISTIC snapshot-patch-revert +
  6000ms toast via the use-region-edit literal-in-map idiom; autofillFields NON-optimistic phase machine + invalidate + exact
  'AI autofill is unavailable — model access is pending.' 6000ms toast; mutatingComponentIds). canvas-shell + the two hooks
  are intentionally UNWIRED (09-09 composes + rewires the page). Gates: apps/web tsc 0 (x4), npm run web:build EXIT 0
  (/emails/[id] still 141 kB, all 6 routes). Commits 21eb350, 1f55670, 3430a1d. See 09-08-SUMMARY.md.

- 09-09 ✓ EXECUTED (code-complete; Task 4 human-verify pending): canvas editor COMPOSITION (D-06/10/11/12/13/14/15/16/17/18),
  Wave 7, depends on 09-08. Pure UI. NEW layers-panel + layers-tree-row = the entities-first LAYERS tree
  (role=navigation > role=tree; D-12 visibility: entity/unclassified always, field rows only under an expanded/selected
  parent, unrelated behind the toggle, populated/related fields only via isPopulatedField; 36px role=treeitem rows, role
  chips violet/amber/slate, inline h-4 ✓/✗ on candidate field rows, exact "No regions yet" empty state; Square icon used —
  lucide SquareDashed not exported). NEW role-picker (static segmented entity|field|unrelated + Clear role, no fetch), NEW
  field-relationship-picker (parent-entity + field-property Popovers, property disabled until parent chosen, lazy
  entityTypes.list, exact empty copy → setFieldRelationship), NEW confirm-deny-controls (canonical inline floating ✓/✗
  z-30, origin-aware ✗: auto-detected → deny + toast.info "Field value cleared." Undo 3000ms; user-drawn → deny only),
  NEW active-parent-banner (violet role=status aria-live, exact D-10 copy "Active entity: {label} — next drawn boxes become
  fields" + Clear). NEW inspector-panel (role=complementary; no-selection "Select a region"; single-selection Region
  Identity + RolePicker + EntityTypePicker (role=entity|field) + FieldRelationshipPicker (role=field) + Autofill Fields
  Sparkles/Loader2 gated on entity+entityTypeId + Confirm All Fields + Candidate Value <0.5 destructive). NEW
  use-autofill-fields (per-entity phase machine idle/extracting/reviewing/confirmed/failed; non-optimistic
  autofillFields invalidate-on-success; exact 6000ms degrade toast; confirmAllFields delegates to role-mutations
  confirmField). REWIRED email-detail.tsx to render <CanvasShell> (LAYERS=LayersPanel, INSPECTOR=InspectorPanel,
  canvas=PdfPreviewPane composed verbatim, banner=ActiveParentBanner) driven by use-canvas-state + use-role-mutations +
  use-autofill-fields; parentOptions 06-04 same-page-entity pattern; slug→id entity-type resolution; D-10 active-parent
  draw routes a drawn box through a dedicated createRegion → setRole=field → setFieldRelationship(activeParentId) (reads
  new component_id off the ApiResponse envelope) vs standalone unclassified region; Bedrock degradation + reprocess +
  signed-URL TTL preserved. Auto-fixes (Rule 3/Rule 1): SquareDashed→Square (not exported), readonly Polygon→mutable copy
  at createRegion boundary, EntityTypePicker open-state controlled (was permanently closed). No new npm packages; no
  dangerouslySetInnerHTML (T-09-80); no client X-API-Key (T-09-82). Gates: apps/web tsc 0 (x6), npm run web:build EXIT 0
  (/emails/[id] 135 kB / 310 kB first load, all 5 routes). Commits e1391d2, 65ac814, 8062fe9. See 09-09-SUMMARY.md.
  Task 4 (browser human-verify of the 3 surfaces + canvas review loop) is AWAITING and NOT fabricated.

- 09-GAP BUNDLE A ✓ FIXED 2026-06-14 (adversarial-review correctness defects, backend + tRPC data shape).
  See 09-REVIEW-FIX.md "Bundle A". Four orchestrator-verified defects closed:

  - CRIT-1: EntityTypeField now carries its uuid id (frozen-dataclass field); _field_from_row populates it
    and AutofillFieldsUseCase._best_field_mapping returns the field uuid (not the slug), so
    update_field_relationship writes a valid uuid into the email_components.entity_type_field_id FK — the
    slug write would have failed every property mapping against real Postgres (the mock-repo suite missed it).

  - CRIT-2: _field_is_active filters config.is_active=False fields out of the active read paths
    (find_by_id/find_by_slug/list_active) in _from_row, so soft-deactivated fields no longer leak into
    EntityType.fields, the autofill system prompt, or the management UI (row kept for the D-04 FK + ref count).

  - HIGH-3: FieldView gains id + _to_field_view surfaces it, so /v1/entity-types reads return the field uuid;
    the tRPC entityTypes.list already exposes it (bbda632) → field id obtainable end-to-end (FastAPI→tRPC→UI).

  - WR-03: UpdateFieldUseCase now mirrors CreateFieldUseCase's per-type slug-uniqueness pre-check (excluding
    self) via a new find_entity_type_by_field_id port method → clean 409 instead of a raw DB-constraint 500.
  Commits 1e2d4c6 (CRIT-1+CRIT-2), e7bf27b (HIGH-3), 6f1ecbc (WR-03). Gates green: pytest 432 passed/8 skipped
  86.87% cov, ruff/format/mypy(88)/lint-imports(3 kept)/bandit all 0; api-client build 0 + vitest 56/56,
  apps/web tsc 0. OUT OF BUNDLE A: HIGH-1 (canvas OverlayLayer props inert on PDF), HIGH-2 (drag-to-draw not
  wired), WR-01/02/04/05 (UI warnings) — separate bundle(s). Migration 0013 staging/prod push must land WITH
  the CRIT-1 fix (column already uuid; these were code-only fixes).

- 09-GAP BUNDLE B FIXED 2026-06-14 (adversarial-review canvas defects, frontend). See 09-REVIEW-FIX.md
  "Bundle B". Five defects closed - the Phase-9 canvas review loop now works ON THE PDF:

  - HIGH-1: PdfPreviewPane.Component gains role; PdfPreviewPaneProps gains the Phase-9 props
    (activeParentId/showUnrelated/confirmDenyComponentIds/autoDetectedComponentIds + onConfirm/onDeny/
    onRestoreField), all threaded from email-detail THROUGH PdfPreviewPane INTO OverlayLayer (which 09-08
    already forwards to RegionOverlayBox). Role colors + D-10 active-parent ring + D-12 anti-bloat hiding +
    D-16 inline confirm/deny now render on the document, not only the LAYERS tree. email-detail computes
    confirmDenyComponentIds (candidate FIELD boxes w/ a resolved value) + autoDetectedComponentIds (origin marker).

  - HIGH-2: PdfPreviewPane takes canvasMode; drawArmed = legacy drawMode OR canvas.mode==='draw' now mounts
    the DrawOverlay, so the shell Draw toggle actually arms drag-to-draw (was decorative). Legacy redraw/split/add
    still wins (DrawModeBar exclusive to it); the D-10 active-parent drawn-box -> FIELD child chain is preserved.

  - WR-01: region-overlay-box renders the canonical ConfirmDenyControls (duplicate inline confirm/deny block
    deleted - converged); overlay-layer threads isAutoDetected + onRestore; use-role-mutations adds restoreField
    (optimistic un-reject + re-invalidate) wired into the undo toast. (LAYERS-tree inline confirm/deny is a
    separate UI-SPEC surface, kept.) Full server-side restore (un-reject + drop D-19 memo) is a follow-up endpoint.

  - WR-02: getCandidateValue(extractedFields, fieldKey) selects the value by the mapped property's slug
    (entity_type_field_id uuid -> entity_type_fields.slug via new fieldIdToKey/fieldKeyFor), never
    Object.entries(...)[0]; unmapped boxes fall back only to a single-entry blob.

  - WR-05: emails.detail now exposes content_raw; denyField.onMutate is origin-aware - auto-detected box
    soft-rejects (leaves view), user-drawn box keeps geometry + status and only clears entity_type_field_id +
    extractedFields ("your boxes never disappear"). isAutoDetectedOrigin mirrors the server's DenyFieldUseCase check.
  Commits 07c0921 (WR-05 + restoreField), 035d877 (WR-02), e15eae0 (WR-01), 35819e2 (HIGH-1), e805c03 (HIGH-2).
  Gates green: apps/web tsc 0 (after each fix), npm run web:build EXIT 0 (/emails/[id] renders the wired canvas),
  api-client build 0 + vitest 56/56 (detail.ts content_raw exposure). OUT OF BUNDLE B: INFO-1..4 + dual-toolbar
  deferral remain documented non-blocking follow-ups; the 09-09 Task 4 browser human-verify is now unblocked.

- 09-GAP BUNDLE C ✓ FIXED 2026-06-14 (the 2 non-blocking residuals from the gap-fix re-verification CLEARED
  verdict). See 09-REVIEW-FIX.md "Bundle C". Two defects closed:

  - MED (dead toolbar + broken Show-regions, D-06): the CanvasShell CanvasToolbar was rendered with
    numPages=null / scale=1 / no-op zoom·fit·page-nav handlers (perpetual "Loading…", permanently-disabled Next,
    dead zoom/Fit) — a non-functional duplicate of PdfPreviewPane's OWN working PDF toolbar. Removed the
    page-nav/zoom/Fit groups from canvas-toolbar (+ their props + unused ChevronLeft/Right/ZoomIn/Out icons),
    keeping only the controls that genuinely work at the shell level: the Select/Draw tool toggle and the
    Regions/History/Unrelated view toggles. Single source of truth for overlay visibility: lifted to the shell's
    showRegions state, passed down to PdfPreviewPane as the controlled read-only showOverlays prop; deleted the
    pane-local showOverlays useState AND the pane's duplicate "Show regions" toggle — the shell Regions switch now
    actually hides the on-PDF overlays. Unrelated toggle still drives OverlayLayer showUnrelated (Bundle B),
    unchanged; the working pane zoom/draw/page-sync + the Bundle-B canvas overlay were not regressed (net −210/+31).

  - LOW (UUID boundary, D-04): FieldRelationshipRequest.entity_type_field_id + parent_component_id retyped
    str|None → UUID|None so a malformed value → 422 at the Pydantic boundary instead of reaching the
    email_components uuid FK columns in Postgres; the route coerces UUID→str for the (still str-typed) use case,
    null clears (D-11) unchanged. TDD: malformed field_id/parent_id → 422 (use case not called); valid pair → 200
    str-coerced; null pair clears.
  Commits 548ef41 (LOW UUID boundary), a139aaf (MED dead toolbar). Gates green: apps/web tsc 0 + npm run web:build
  EXIT 0 (/emails/[id] renders); pytest 436 passed/8 skipped 86.97% cov, ruff/format/mypy(88)/lint-imports(3 kept)/
  bandit all 0. ZERO dead/no-op controls remain in the editor toolbars. OUT OF BUNDLE C: INFO-1..4 + the
  pre-existing unused CanvasShell emailId prop remain documented non-blocking follow-ups.

- 09-GAP BUNDLE D1 ✓ FIXED 2026-06-14 (the 2 confirmed HIGH + genuine MEDIUM/LOW backend defects + test-debt from
  the FULL final review, 09-FINAL-REVIEW.md). See 09-REVIEW-FIX.md "Bundle D1". Six items closed:

  - HIGH-1 (autofill double-processes auto-detected children, autofill_fields.py): dedupe all_children by child.id
    (order-preserving) before the autofill loop + exclude just-persisted ids AND origin=='auto_detected' rows from
    _existing_field_children — so a REFLECTING find_by_page_component_id never autofills a box twice (was 2x LLM
    cost + duplicate ExtractionRecords/relationship writes; the static mock masked it). Regression test with a
    reflecting mock asserts exactly one autofill/save/relationship-write per child (FAILS on pre-fix code).

  - HIGH-2 (CreateEntityTypeUseCase system-slug uniqueness inoperative): app-level find_by_slug(None, slug) pre-check
    → 409 + partial unique index uniq_entity_types_system_slug ON entity_types (slug) WHERE importer_id IS NULL
    (migration 0014, the real backstop since DB UNIQUE(importer_id,slug) never collides on NULL); stale
    entity-types.ts NULLS-NOT-DISTINCT comment corrected. Test: duplicate-system-slug pre-check fires (no insert).

  - MEDIUM-3 (field slug no DB constraint, TOCTOU): UNIQUE(entity_type_id, slug) on entity_type_fields (migration
    0014, same file); app-level pre-checks kept for the friendly 409.

  - MEDIUM-4 (denial-memo full-row read-modify-upsert lost-update): new ComponentRepository.append_denied_polygon
    atomic server-side jsonb append RPC (migration 0015 append_denied_polygon) replaces the read-modify-save_many;
    DenyFieldUseCase no longer re-reads the parent. Verified 2 parallel appends both survive (count=2).

  - LOW-5 (_coerce_page_index float 2.0 → 0): coerce numerically (int(float)) before the digit check.
  - TEST-DEBT: real-row-shape tests for the new ComponentRepository write methods (assert exact payload column
    keys / RPC params, the CRIT-1 fake-repo-hides-a-real-row class) + thin-integration tests for the 4 new FastAPI
    routes (/role, /entity-type, /deny, /autofill-fields: 200 + ValueError→404 + malformed-uuid→422).
  Commits 7373d53 (HIGH-1+LOW-5), 74d3a9e (HIGH-2+MEDIUM-3, migration 0014), 618c399 (MEDIUM-4, migration 0015),
  6016e7c (route test-debt). Gates green: pytest 458 passed/8 skipped 87.96% cov, ruff/format/mypy(88)/
  lint-imports(3 kept)/bandit all 0; packages/db tsc 0. Migrations 0014/0015 LOCAL-ONLY — push WITH 0013 to
  staging/prod before deploy (verify no duplicate system/field slugs first). OUT OF BUNDLE D1: frontend HIGH-3
  (apps/web has zero tests) remains the top documented follow-up; no AWS touched.

- 09-GAP BUNDLE D2 ✓ FIXED 2026-06-14 (the genuine frontend MEDIUM + LOW defects from the FULL final review,
  09-FINAL-REVIEW.md). See 09-REVIEW-FIX.md "Bundle D2". Six items closed, 6 atomic fix(09-gap) commits:

  - MEDIUM-A (nested interactive, inbox-row.tsx): InboxRow was a <button> wrapping the EntityChips <a>
    deep-links (invalid HTML + nested-interactive a11y dev-console error). Converted to <div role="button"
    tabIndex={0}> with Enter/Space keyboard activation (target-guarded so chip keystrokes pass through);
    chips stay a sibling with stopPropagation. Commit 4be8c62.

  - MEDIUM-B (silent draw no-op, email-detail.tsx handleRectDrawn): a draw on a page with no resolvable
    attachment_page component was silently dropped (Draw looked dead). Added the else branch — cancel the
    draw + toast.warning explaining the page has no recognized document page to attach to (the preferred
    toast option; Draw NOT gated). Redraw/split/active-parent/standalone routing unchanged. Commit 4eac97e.

  - MEDIUM-C (dead deactivate-vs-delete copy, field-row-dialog.tsx): referenceCount was never passed, so the
    pre-delete AlertDialog always showed destructive "permanently removed" copy even when the server
    soft-deactivates (D-27). Made referenceCount tri-state — undefined (count not known pre-delete, the live
    path) → NEUTRAL "Remove this field?" + secondary variant + copy that never promises permanent deletion
    (server may deactivate; honest post-action toast reports which). count>0 deactivate; count===0 hard delete.
    No backend count query added (out of surgical scope). Commit c868596.

  - MEDIUM-D (emails.list over-fetch, api-client emails/index.ts): SELECT * pulled bodyHtml + raw storage key
    for every inbox row that renders neither. Explicit column projection — inbox-needed columns only + a
    bodyText snippet truncated server-side via left(body_text, 2000) (the reading-preview slice length).
    api-client build 0 + vitest 56/56; apps/web consumes the narrowed shape (tsc 0). Commit 0ef8662.

  - MEDIUM-E (confirm-all N×N invalidations, use-role-mutations + use-autofill-fields): confirmAllFields
    looped confirmField(id) and each onSuccess invalidated emails.detail (N refetches for one action). Added
    roleMutations.confirmFields(ids) = one optimistic patch + N confirms via a no-onSuccess bulk mutation,
    awaited together, then ONE trailing invalidate; use-autofill-fields delegates to it. Commit 0f62c8f.

  - LOW (dead-code cleanup, divergence traps): removed the dead duplicate autofill machine from
    use-role-mutations (AutofillFieldsPhase/autofillPhases/autofillFieldsMutation/autofillFields + unused
    useState; canonical path is use-autofill-fields, 09-09); deleted the dead use-canvas-state API (liveRect/
    onDrawComplete/onBoxGeometryChange + the now-unused resolvePageComponentId param/NormalizedRect/Polygon/
    normalizedRectToPolygon — email-detail drives draw/redraw through canvas.edit); removed the unused
    CanvasShell emailId prop + its call site. Commits 0f62c8f, 4577282.
  Gates green: apps/web tsc 0 (after each fix), npm run web:build EXIT 0 (/, /entity-types, /emails/[id] all
  render, 5/5 static pages); api-client build 0 + vitest 56/56 (MEDIUM-D touched it). DEFERRED: the OPTIONAL
  layers-tree inline-deny undo-toast (would require threading isAutoDetected/onRestore + the origin marker
  through LayersTreeRow→LayersPanel→email-detail — scope creep, left a documented follow-up). OUT OF BUNDLE D2
  (DEFER, per objective): canvas hover-rerender/OverlayLayer memoization; email-detail god-component split; the
  apps/web test harness (frontend HIGH-3 — top separate follow-up). No git push; no AWS touched.

## Phase 4 (original CONTEXT) — gathered 2026-06-11

- **Reshaped during discussion** from "Supabase schema + ingestion" into a
  region-selection + AI-autofill **backend** (UI is a later phase).

- Robust **PDF** processing (only format this phase): text-layer + OCR fallback
  + LLM segmentation. Parser registry + Protocol seam for future formats.
- Region child model: normalized polygon + text-anchor + content + halfvec embedding
  (Textract/Document AI standard). Supabase + pgvector + pg_trgm.

- Auto-segment proposes / human overrides; cold-start autofill from entity-type
  defaults; confirmed regions → S4–S6 few-shot retrieval (learning flywheel).

- Versioned/supersedable reprocessing; multi-tenant by importer (forwarding-sender
  → importer, no auth yet); layered test corpus as a deliverable.

- One phase, many plans. ROADMAP.md still lacks a Phase 4 entry — record it at plan time.
- See `.planning/phases/04-email-intelligence/04-CONTEXT.md` + `04-RESEARCH.md`.

## Accumulated Context

### Roadmap Evolution

- Phase 5 added (2026-06-12): Review UI — inbox email detail with document preview and entity-region overlays. Frontend slice consuming Phase 4's data model read-only (research §8 EmailView shape); preview is the core user surface. Degrades gracefully until 04-11 segmentation dispatch writes region Components.
- Phase 6 added (2026-06-12): Region edit ops on the preview (accept/redraw/split/merge/nest/reject) wired to email_components — versioned, supersede-safe (D-16), human regions are source of truth (D-09).
- Phase 7 added (2026-06-12): Click-to-autofill UI — region click → POST /v1/components/{id}/autofill → candidate fields + confidence → human confirm (POST /confirm) with corrections; process/reprocess controls. Closes the flywheel loop from the browser.
- Phase 8 added (2026-06-12): trgm key_terms extractor (PO/BL/booking/container identifiers) activating the dormant pg_trgm retrieval arm; includes the confirm-fallback entity_type_id="" NOT NULL FK fix.

## Decisions Log

- 2026-06-10: ECS Fargate (user-confirmed) over App Runner; generic webhook over SES-shaped; full 4-layer skeleton; shared ALB with staging on :8080
- 2026-06-12 (04-07): D-14 structural: region in user turn only, system prompt never contains document content
- 2026-06-12 (04-07): Cold-start: entity_type.description as KB, examples=() always (Plan 04-08 adds retrieval)
- 2026-06-12 (04-07): T-04-25: AutofillUseCase inserts status=candidate only, nothing auto-confirms
- 2026-06-12 (04-07): T-04-26: find_by_slug falls back importer_id -> None for system-default entity types
- 2026-06-12 (04-09): D-17 corpus PDFs generated via raw PDF bytes without reportlab/fpdf external dependency
- 2026-06-12 (04-09): asyncio.run() + nested _inner() coroutine used in _run_propose to fix Python 3.13 event loop removal
- 2026-06-12 (04-09): forwarding_harness wraps IngestInboundEmailUseCase (live production entry point) not DecomposeEmailUseCase
- 2026-06-12 (04-08): learning flywheel closed — confirm→embed(Titan v2, dim 1536, Bedrock)→index; autofill few-shot via hybrid RRF k=60; cold-start (D-13) preserved on empty retrieval
- 2026-06-12 (04-08): retrieval RPCs (match_components_by_embedding/_trgm) were missing — authored migration 0009 (user: fix-now); applied local+staging+prod, migrator back in sync (10)
- 2026-06-12 (04-08): trigram retrieval arm inert (key_terms=()) — vector-only hybrid until a PO/BL/container key_terms extractor lands; RPC+GIN index already live
- 2026-06-12 (04-08): reconciled email_attachments push-drift — made 0008 idempotent (ADD COLUMN IF NOT EXISTS) + committed attachments.ts file_ext/parent_attachment_id columns
- 2026-06-12 (04-13): PDF parser retains per-token geometry in content_raw (text-layer pdfminer bbox Y-flipped + OCR per-word); text-layer page polygon = union of element bboxes (non-breaking, no migration)
- 2026-06-12 (04-14): segmenter seam takes coordinate-bearing tokens; ProposedRegion carries token_indices (not invented polygon); use case grounds region polygon = union of selected token bboxes; D-14/retry/cost-guard preserved
- 2026-06-12 (04-14): Textract analyze_document evaluated, DEFERRED — 04-13 per-word geometry suffices to ground polygons; revisit for table/KV extraction
- 2026-06-12 (gap closure): D-18 tenancy — X-API-Key is an installation-wide principal; importer_id is data partitioning (D-05 sender resolution), NOT an auth boundary until real auth lands. Reads list across importers (optional ?importer_id= filter); detail/download/reprocess resolve by id; autofill/confirm derive tenant from the component row (explicit mismatch 404s = future auth seam)
- 2026-06-12 (05-01): Three-query pattern for emails.detail — no cartesian join; leftJoin for optional extraction records (candidate components have none); polygonToRect collapses any polygon to min/max bounding box
- 2026-06-12 (05-03): DOMPurify client-only guard (typeof window check) — prevents SSR crash; plain-text is always default tab; detected-regions empty state is non-alarming by design (Bedrock-blocked is the normal Phase 5 state)
- 2026-06-12 (05-04): polygonToRect imported from @nauta/api-client/geometry subpath (not barrel) to prevent postgres from entering the client bundle
- 2026-06-12 (05-04): Overlay layer hidden via CSS display:none (not unmounted) to preserve bidirectional sync state per §7.3
- 2026-06-12 (05-04): NEXT_PHASE=phase-production-build added to skipValidation in db/client.ts for build-time env-less builds
- 2026-06-12 (06-01): supersede-not-mutate implemented as dataclasses.replace + _merge_lineage immutable helper; lineage (origin/supersedes/superseded_by) lives in content_raw JSON — no schema migration
- 2026-06-12 (06-01): merge IDOR guard (T-06-03) — MergeRegionsUseCase requires identical email_id AND attachment_id across all inputs; violation → ValueError → generic 404 (T-06-04)
- 2026-06-12 (06-01): geometry validated once at the Pydantic boundary (4 [x,y] pairs, coords [0,1], page_index>=0); use cases degrade to empty text capture rather than failing on token-less pages
- 2026-06-12 (06-01): pre-existing mime_parser B101 typing assert annotated nosec (settings.py precedent) so the bandit-exit-0 gate stays meaningful
- 2026-06-12 (06-02): getListenerConfig reads process.env at call time (not module scope) so Next.js build succeeds without env vars — mirrors attachments/[id]/route.ts pattern
- 2026-06-12 (06-02): polygonSchema defined once and shared across all 4 polygon-bearing mutations; parseErrorDetail helper extracts FastAPI {detail} uniformly
- 2026-06-12 (06-02): added "dom" to api-client tsconfig lib — DOMRect not in es2022-only lib (auto-fix, Rule 3)
- 2026-06-12 (06-03): region-edit state machine owned by one useRegionEdit hook; components stay presentational — handlers injected via props
- 2026-06-12 (06-03): RegionOverlayBox needs pointer-events-auto — children inherit OverlayLayer's pointer-events-none, clicks never reached boxes (Rule 1)
- 2026-06-12 (06-03): mutatingIds derived from mutation.isPending + variables (no extra state) to satisfy spec §7 aria-busy on in-flight mutations (Rule 2)
- 2026-06-12 (06-03): Reject fires directly (no dialog) and Merge/Nest stay disabled per plan — 06-04 swaps in AlertDialog + handlers
- 2026-06-12 (06-03): bg-primary/[0.08] arbitrary value — Tailwind v3.4 opacity modifiers only support steps of 5, pattern map's /8 would not generate
- 2026-06-12 (06-04): AlertDialog opened via controlled state (rejectDialogOpen in useRegionEdit) — satisfies T-06-17 (Repudiation mitigation); Delete key also routes through dialog not direct reject
- 2026-06-12 (06-04): eligibleRegions computed in email-detail (not the hook) so hook stays data-agnostic; filtered to same page_index, not selected id, not rejected/superseded
- 2026-06-12 (06-04): NestPicker trigger kept inside the component for Popover focus management; onNest/onUnNest injected from email-detail via entitiesList.shiftToggle pattern
- 2026-06-12 (06-04): shiftToggle passed as onToggleSelect to EntitiesList so merge multi-select unifies with overlay shift-click selection
- 2026-06-12 (07-01): EMAIL_LISTENER_API_KEY read only in getListenerConfig() at call time — never NEXT_PUBLIC_ (T-07-01; mirrors 06-02 pattern)
- 2026-06-12 (07-01): z.string().uuid() validates componentId/emailId before URL path interpolation — prevents path-segment injection (T-07-02)
- 2026-06-12 (07-01): groupEntityTypeRows exported as pure function enabling unit testing without DB; immutable spread on every output object (CLAUDE.md immutability requirement)
- 2026-06-12 (07-01): SKIP_ENV_VALIDATION=true in vitest.config.ts prevents db/client.ts createEnv() from throwing on POSTGRES_URL during tests — same guard already used in CI/lint
- 2026-06-12 (07-02): allDisabled = disabled || autofillExtracting gates all ActionToolbar buttons during AI extraction (07-UI-SPEC §3.4); existing disabled props replaced
- 2026-06-12 (07-02): EntityTypePicker receives trigger as ReactNode for flexible popover anchor — same pattern as NestPicker but with api.entityTypes.list internal query
- 2026-06-12 (07-02): correctedFields diff sends null (not empty object) when no user edits; discardFields clears local state only — no API call (D-16)
- 2026-06-13 (07-03): D-16: ReprocessDialog uses buttonVariants({variant:"default"}) not "destructive" — reprocess supersedes, never deletes confirmed data
- 2026-06-13 (07-03): Component.extractedFields/correctedFields/confidenceScore/confidenceBreakdown typed as unknown in entities-list; narrowed at FieldsPanel callsite
- 2026-06-13 (07-03): getStatusBadge copied from entities-list into fields-panel to maintain consistency without shared util (avoids premature abstraction)
- 2026-06-13 (08-01): ISO 6346 letter-value map uses A=10, B=12 (skipping 11, 22, 33 per standard); Wikipedia CSQU3054187 example appears to have a typo (algorithm gives 8); verified correct via MSCU1234566 + TCNU1234565
- 2026-06-13 (08-01): Precision over recall — bare container validates check digit; label-anchored (BL/BOOKING/PO/INVOICE) accepts any alphanumeric (no check digit required for reference numbers)
- 2026-06-13 (08-01): D-15 flywheel preserved in confirm-fallback: embed + update_embedding always runs regardless of ExtractionRecord save; skip-and-warn with confirm_region_no_candidate_record_skipped log event
- 2026-06-13 (09-01): D-01/D-02 role column is nullable (NULL = unclassified/standalone); "unclassified" intentionally NOT an enum value — manual override always wins
- 2026-06-13 (09-01): D-03/D-04 entity_type_id / entity_type_field_id are declared FKs with onDelete: set null — deleting a referenced entity-type/field nulls the component link, never cascade-deletes components (hard deletes guarded in 09-03 per D-27)
- 2026-06-13 (09-01): migration path is packages/db/migrations/ (drizzle.config out=./migrations + migrate.ts migrationsFolder="migrations"), NOT src/migrations/ — latest 0012 → new 0013
- 2026-06-13 (09-01): 0013 scoped to the Phase-9 change only — drizzle-kit re-emitted drift (region/pending/error enum values + extraction_records.confidence_breakdown/routing_reason) from the un-snapshotted custom migrations 0010/0011/0012; removed those statements + added IF NOT EXISTS guards (mirrors the prior custom-migration idempotency pattern)
- 2026-06-13 (09-05): D-21 sidebar block hand-vendored from canonical shadcn (resizable.tsx precedent), NOT via shadcn CLI init — no new npm dependency added (T-09-40/T-09-SC); reuses existing --sidebar-* HSL tokens (already mapped to sidebar.* in packages/ui/tailwind.config.ts), zero new design tokens
- 2026-06-13 (09-05): @nauta/ui components are consumed via the per-file subpath wildcard ("./*" export → @nauta/ui/sidebar); the barrel index.ts exports ONLY cn, so sidebar is NOT re-exported from index.ts despite the plan's literal wording (Rule-3 alignment; avoids pulling a client component into the cn-only barrel)
- 2026-06-13 (09-05): next-themes resolves from apps/web via workspace hoisting (declared dep of @nauta/ui; also used by packages/ui/src/theme.tsx) — apps/web theme-provider imports it directly without adding it to apps/web/package.json
- 2026-06-13 (09-02a): D-19 memo mechanism (Claude's Discretion) — denied_field_polygons stored as a list under the PARENT entity component.content_raw (Phase-6 lineage convention; content_raw is the metadata sidecar), re-persisted via save_many mutating content_raw only (supersede-never-mutate); 09-02b's AutofillFieldsUseCase reads it to exclude overlapping re-proposals
- 2026-06-13 (09-02a): D-18 origin-aware deny — auto-detected box (content_raw lineage origin=='auto_detected', read at both nested content_raw.lineage.origin and flat content_raw.origin) → update_status('rejected') + parent memo; absent/other lineage → user-drawn: clear_candidate_fields + ExtractionRepository.supersede_active (the existing D-16 primitive), geometry untouched, never rejected ("your boxes never disappear")
- 2026-06-13 (09-02a): FieldRelationshipRequest uses parent_component_id + entity_type_field_id (PLAN.md Task 3 spec, set in one update_field_relationship write), NOT the 09-PATTERNS draft's entity_type_id field
- 2026-06-13 (09-02a): new Component relationship fields are defaulted (= None) so existing constructors (propose_regions/classify_document/edit_region) keep working untouched; setter use cases follow the NestRegionUseCase single-writer shape (load→tenant-guard→one repo writer→refreshed entity)
- 2026-06-13 (09-02a): use-case tests placed under tests/application/ (new subpackage + __init__.py, mirroring tests/corpus/) per PLAN.md; AsyncMock repos used (project convention over the plan's "fake repo" wording); autofill-fields endpoint intentionally NOT added (09-02b owns it + stamps the auto_detected origin)
- 2026-06-13 (09-02b): EntityTypeRepository.find_by_id added (port + Supabase impl) — 09-03 had not landed find_entity_type_by_id; lookup is global (not importer-scoped) because tenant isolation lives on the entity component row carrying entity_type_id (D-18)
- 2026-06-13 (09-02b): LLM-call structure (Claude's Discretion, D-CONTEXT) = one autofiller.autofill call PER field child, reusing AutofillUseCase's per-component cold-start+few-shot contract verbatim (no new prompt surface); constraint satisfied (token-grounded boxes + property mapping + per-field confidence)
- 2026-06-13 (09-02b): property identity = the extracted field SLUG (EntityType.fields exposes slug, not a per-row id) — the same identity the FieldRelationship setter persists; entity_type_field_id carries the highest per-field-confidence slug; token containment = bbox-center-in-polygon-bounds (matches geometry.ts polygonToRect bounding-box semantics)
- 2026-06-13 (09-02b): D-19 exclusion = positive-area axis-aligned overlap of the proposal's grounded bounds vs each denied_field_polygons bounds (real geometry test, not exact match), per the plan's explicit constraint; segmenter constructor param typed `object` (Protocol-introspection accommodation), DI factory passes the SegmenterProtocol-resolved instance
- 2026-06-13 (09-03): D-27 delete-guard policy (Claude's Discretion) = SOFT-DEACTIVATE (config.is_active=False) when count_confirmed_references > 0, never hard-delete a field a confirmed component still points at (preserves the D-04 entity_type_field_id FK); zero refs -> hard delete; outcome surfaced via DeleteFieldResult/DeleteFieldView so the UI explains the guard
- 2026-06-13 (09-03): slug-conflict signalling = Postgres unique-violation SQLSTATE 23505 read off postgrest APIError.code -> ValueError carrying a 'slug exists' marker -> 409 at the endpoint (T-09-22); the CreateFieldUseCase ALSO pre-checks per-entity-type field-slug uniqueness against the loaded entity type's fields for a clean 409 before the insert (DB UNIQUE(importer_id, slug) is the entity-type-slug backstop)
- 2026-06-13 (09-03): EXTENDED 09-02b's EntityTypeRepository.find_by_id (kept) rather than duplicating it; added find_entity_type_by_id as a delegating alias (09-03 plan naming) so the management use cases load the field schema before a write; is_identifier kept in entity_type_fields.config jsonb (D-27 Claude's Discretion, not promoted to a column)
- 2026-06-13 (09-03): field_type allowlist enforced twice (defense in depth, T-09-21) — Pydantic field_validator at the /v1/entity-types boundary + ALLOWED_FIELD_TYPES re-check in CreateField/UpdateField use cases; manage_entity_types.py stays domain-pure (imports only app.domain.*, lint-imports clean)
- 2026-06-13 (09-04): getListenerConfig + parseErrorDetail extracted from emails/mutations.ts into router/_listener-config.ts (the "extract to shared" PATTERNS option) — both the emails component mutations and entity-types-write import the single definition; EMAIL_LISTENER_API_KEY now read in exactly one source file, never NEXT_PUBLIC_ (T-09-30); _listener-config is underscore-prefixed and is NOT a router (exports only the two server-side helpers, pulled in transitively by the mutation modules only)
- 2026-06-13 (09-04): confirmField reuses the existing Phase-7 /confirm proxy — confirmComponent already POSTs /v1/components/{id}/confirm with {corrected_fields}, so confirmField is a thin Phase-9-named alias (correctedFields optional/nullable) for review-loop symmetry with denyField, NOT a second divergent proxy (plan's "reuse rather than duplicate" guidance)
- 2026-06-13 (09-04): emails.entitySummary uses the role/entityTypeId DIRECT path (cheaper, preferred now 09-01 added the columns) — role='entity' + entity_type_id components left-joined to entity_types for the label, rejected/superseded excluded so denied/redrawn boxes never produce chips; single parameterized inArray batch keyed by the visible page of email ids (.max(100), T-09-33), no per-row fetch
- 2026-06-13 (09-04): aggregateEntitySummary is a pure DB-free exported helper (mirrors groupEntityTypeRows testability) returning one row per REQUESTED email id in request order (empty entities for entity-less emails) so the inbox can zip the rollup onto its visible page without a second lookup; immutable outputs throughout
- 2026-06-13 (09-04): rebuilt packages/api-client/dist (gitignored artifact) before web tsc — Phase 6/7 hit stale-dist gaps; verified entitySummary/setFieldRelationship/reorderFields + _listener-config present in dist so apps/web typechecks against the new surface
- 2026-06-13 (09-06): D-20/D-21 app shell preserves the original provider ordering — TRPCReactProvider outermost, Toaster a body sibling; ThemeProvider + SidebarProvider wrap children; suppressHydrationWarning on <html> + a mounted-gate on the theme toggle prevent the next-themes SSR/hydration mismatch (toggle never reads resolvedTheme before mount)
- 2026-06-13 (09-06): D-22 Load-more keeps page.tsx as the emails.list query owner (acceptance criterion) — the three-pane appends further pages via a SECOND api.emails.list query (enabled:false, refetch on click) accumulated into local extraItems with nextOffset tracked; hasMore/nextOffset preserved verbatim (chose this over lifting the seed query or a useInfiniteQuery rewrite)
- 2026-06-13 (09-06): D-22 reading preview is data-honest — emails.list returns only the Emails row (attachments live on emails.detail), so the preview shows sender/subject/body-snippet + "Open editor →" deep-link rather than a stubbed empty attachment summary; no second per-row fetch (would break the D-23 single-batch invariant); aligns with the project's depth-first/no-stubs preference
- 2026-06-13 (09-06): D-23/D-24 entity chips stopPropagation on click so a chip's /emails/{id} deep-link never also toggles the row's reading-preview selection; entitySummary fetched ONCE for the visible page (Map-indexed onto rows), never per row
- 2026-06-13 (09-07): id-exposure fix = EXTEND entityTypes.list (plan's preferred option over a new byId query) — additively returns type id/isActive + per-field id/sortOrder/isIdentifier; is_identifier read from config jsonb via COALESCE((config ->> 'is_identifier')::boolean, false); grouping switched slug->id (slug not unique once inactive rows are included); an includeInactive flag (default false) keeps the Phase-7 pickers active-only while the management page passes true. entity-type-picker + email-detail (the only list consumers) read only preserved keys and compile untouched (additive)
- 2026-06-13 (09-07): D-27 delete-guard surfaced honestly — deleteField AWAITS mutateAsync and resolves the FastAPI DeleteFieldView {hard_deleted, soft_deactivated}, then toasts the actual outcome; the dialog's referenceCount prop drives PRE-emptive copy (referenced -> "Deactivate this field?" + variant=secondary, never destructive) but the SERVER response is the authority, so a soft-deactivate is never mis-presented as a hard delete even when the count is unknown
- 2026-06-13 (09-07): field_type allowlist enforced twice client-side (T-09-60) — a Select limited to the 5 values + a Zod z.enum re-check before the mutation (defense-in-depth with the api-client z.enum and the 09-03 Pydantic validator); reorder = up/down buttons (plan discretion over drag) with optimistic sort_order reindex; deactivate = active Switch via updateType isActive, never a destructive control (mirrors D-16)
- 2026-06-13 (09-08): back-compat strategy = OPTIONAL new props with safe defaults (role?/isActiveParent?/showConfirmDeny? on region-overlay-box; roleFilter?/activeParentId?/showUnrelated? on overlay-layer) — the existing email-detail→PdfPreviewPane→OverlayLayer caller passes none, so Phase 6/7 boxes keep the primary statusClasses and the whole app still typechecks+builds (09-08 = structural layer; rewire onto canvas-shell is 09-09)
- 2026-06-13 (09-08): ComponentRole ('entity'|'field'|'unrelated'|null) exported from region-overlay-box as the single role-union source reused by overlay-layer + both hooks; null = unclassified (matches D-01, no enum value). Role-color override applies only when role!=null AND status not rejected/superseded (terminal boxes keep the muted ghost); active-parent adds ring-4 ring-violet-400/40 (D-10)
- 2026-06-13 (09-08): D-12 field visibility = reveal-on-select (field renders only when activeParentId!=null && parentComponentId===activeParentId) in a pure isRoleVisible helper layered after the Phase-6 filters; explicit roleFilter overrides to show ONLY that role; unrelated hidden unless showUnrelated (toolbar toggle default off, D-05); history view bypasses role-hiding so nothing is lost
- 2026-06-13 (09-08): D-09 move/resize REUSES the existing Phase-6 redraw — use-canvas-state.onBoxGeometryChange normalizes the rect → edit.redraw (supersede-never-mutate); NO new geometry mutation authored (hook calls only edit.redraw / edit.createRegion)
- 2026-06-13 (09-08): use-role-mutations patches emails.detail with LITERAL statuses ('confirmed'/'rejected' as const) in the setData map (exactly use-region-edit's idiom) — a generic Partial patch widened extractionStatus/role to string and broke the inferred tRPC union; autofillFields is the only NON-optimistic mutation (inserts candidate field children server-side → phase machine + invalidate + exact 6000ms 'model access is pending' toast); denyField optimistically marks 'rejected' then lets the origin-aware server (D-18) reconcile via invalidate
- 2026-06-13 (09-08): zoom-to-cursor re-anchors scrollLeft/Top by the zoom factor inside requestAnimationFrame (after re-layout); Space-drag pan via pointer capture on the scroll viewport; zoom range ZOOM_MIN/MAX/STEP=0.25/4.0/0.25; canvas-shell owns no PDF state (renders CanvasToolbar wired to use-canvas-state, LAYERS/INSPECTOR/canvas/banner as ReactNode slots) — panels + page wiring deferred to 09-09
- 2026-06-13 (09-09): PdfPreviewPane is COMPOSED (not decomposed) into the CanvasShell canvas slot — it is a self-contained Phase 5/6 component with its own working toolbar (page/zoom/draw/overlay) + intricate zoom-to-cursor/Space-pan; making it fully controlled by the shell's separate toolbar is a large high-risk change under the no-break constraint, so both toolbars currently render (shell drives view toggles + tool mode + LAYERS; the pane's toolbar is the functional PDF surface). Documented as a Task-4 follow-up
- 2026-06-13 (09-09): candidate FIELD value = the FIRST entry of the field component's extractedFields (autofill writes one value per field child), rendered as an auto-escaped React text node — NO dangerouslySetInnerHTML anywhere in the panels (T-09-80 mitigated)
- 2026-06-13 (09-09): isAutoDetected on confirm-deny-controls is a CLIENT affordance only (drives the Undo toast); the server is authoritative for the origin-aware soft-reject vs clear-value outcome (09-02a/09-08 design) — the detail query exposes no content_raw/origin, so the LAYERS-row + inspector deny paths route through roleMutations.denyField and let the server decide; the standalone control exposes the prop + Undo for callers (canvas overlay) that know the origin
- 2026-06-13 (09-09): D-10 active-parent drawing uses a DEDICATED createRegion mutation in email-detail that reads the new component_id from the ApiResponse envelope on success, then chains setRole=field + setFieldRelationship(activeParentId) — the existing useRegionEdit.createRegion (which discards the returned id) is left untouched (no-break); a draw with no active parent creates a standalone unclassified region
- 2026-06-13 (09-09): EntityTypePicker emits a SLUG but setEntityType takes an entityTypeId — email-detail resolves slug→id via a memoized slugToId map; entity-type LABELS in the tree/inspector are resolved from the component's OWN entityTypeId via idToLabel (the detail entityTypeLabel join is off the extraction record's entity type, a different column)
- 2026-06-13 (09-09): use-autofill-fields (the plan's dedicated per-entity hook + Confirm All Fields) is what email-detail consumes for the inspector autofill state; the 09-08 inline autofillFields machine in use-role-mutations is left in place but unused by the new composition (avoids touching the 09-08 hook); confirmAllFields delegates to roleMutations.confirmField (single optimistic path)
- 2026-06-13 (09-09): auto-fixes — SquareDashed not exported by the installed lucide-react → Square (in the UI-SPEC lucide allowlist) with reduced opacity for the muted UNCLASSIFIED row; readonly Polygon copied into fresh mutable tuples at the createRegion zod boundary (immutable source preserved); EntityTypePicker open-state made controlled via local inspector state (initial open={false} left it permanently closed)
- 2026-06-14 (09-gap CRIT-1): entity_type_field_id is a uuid FK, so the autofill property mapping persists the field's uuid id (added to the frozen EntityTypeField + _field_from_row), NOT the slug — this REVERSES the 09-02b "property identity = slug" decision (the slug-as-identity assumption silently failed against real Postgres; the mock-repo suite could not catch a uuid-column type mismatch). The slug remains the LLM schema/value-lookup key; only the persisted FK identity changed
- 2026-06-14 (09-gap CRIT-2): soft-deactivated fields (config.is_active=False) are dropped from EntityType.fields in _from_row via a _field_is_active filter — a single chokepoint hides them from ALL active read paths at once (find_by_id/find_by_slug/list_active) and therefore from the autofill system prompt (autofill_adapter enumerates entity_type.fields) and the management UI; the row is preserved so count_confirmed_references + the D-04 FK still work (deactivate_field's own return is not an active read path)
- 2026-06-14 (09-gap HIGH-3): field uuid surfaced through FieldView + _to_field_view; pairs with the CRIT-1 EntityTypeField.id. The tRPC entityTypes.list shape already exposed the field id (bbda632), so this backend fix completes the end-to-end path (Postgres → FastAPI FieldView → tRPC list → admin UI/field-relationship picker), making the write router's existing fieldId z.string().uuid() validation addressable
- 2026-06-14 (09-gap WR-03): UpdateFieldUseCase per-type slug-uniqueness pre-check mirrors CreateFieldUseCase, excluding the field being updated by id (self-rename is a no-op, never a false 409); added find_entity_type_by_field_id to the EntityTypeRepository port (reads the field row's entity_type_id → find_by_id) so the use case stays domain-pure; when the owning type cannot be resolved, the DB UNIQUE constraint remains the backstop (no false positive)
- 2026-06-14 (09-gap C MED): RESOLVED the 09-09 dual-toolbar deferral via the minimal remove-dead-controls path (not full single-toolbar consolidation) — PdfPreviewPane keeps its own working page/zoom/Fit toolbar as the single PDF control surface; the shell CanvasToolbar drops the page-nav/zoom/Fit controls that were dead (numPages=null/scale=1/no-op handlers) and keeps only the shell-level Select/Draw + Regions/History/Unrelated controls. This reverses the 09-09 "both toolbars render" decision (the shell copy was non-functional, not a deliberate split). Lower-risk than lifting page/zoom state up under the no-break constraint; gates stayed green
- 2026-06-14 (09-gap C MED): overlay visibility (Show regions) made a SINGLE source of truth — the shell owns showRegions and passes it DOWN to PdfPreviewPane as a controlled read-only showOverlays prop; the pane's own showOverlays useState + its duplicate toggle are deleted. No onShowOverlaysChange setter is threaded (would be a dead prop — the shell toolbar owns the only toggle), so the pane is purely controlled. Unrelated stays a single source of truth via the existing showUnrelated path (Bundle B)
- 2026-06-14 (09-gap C LOW): FieldRelationshipRequest ids typed UUID|None at the Pydantic boundary (422 on malformed) while SetComponentFieldRelationshipUseCase keeps str|None ids — the route coerces UUID→str (and passes None through for the D-11 clear). Tightened only this request (the one D-04 uuid-FK boundary the residual flagged); EntityTypeRequest.entity_type_id left as str|None (out of the stated scope, not a confirmed defect)
- 2026-06-27 (15-01): D-05 additive signal contract — `outcome` field added to `GenerateUiSpecResult` frozen dataclass + `GenerateUiSpecView`; cache-hit path hardcodes `outcome="ok"` (D-14 fallbacks never cached); cold path reuses already-computed `_determine_outcome()` variable, never recomputes; no `from __future__ import annotations` added (Pydantic ForwardRef constraint)
- 2026-06-27 (15-01): `GenerateOutputSchema` flat `z.object` (not discriminatedUnion) — carries `outcome`, `spec`, `cacheHit`, `reason?`; `SpecRootSchema.safeParse` web-boundary re-validation overrides to `outcome="fallback"` on failure regardless of server-reported value (D-08/D-15 authority preserved)
- 2026-06-27 (15-01): `escalated` outcome maps to `kind:"cold" + escalated:true` in `deriveGenerationState` — D-03d: escalated is a sub-flavor of cold, not a fourth kind; `isPending=true` always wins as highest-priority signal
- 2026-06-27 (15-01): `describePropsSchema` uses `_def.typeName` string comparison (not instanceof) — avoids Zod version bundling ambiguity in monorepo; `ZodObjectDef.shape` is a function called as `shapeAccessor()`, not a plain object property
- 2026-06-28 (16-03): D-14 honored — `list_recent` selects summary cols (no spec_json); `find_by_id` selects all cols including spec_json; HistoryRowView (no spec_json) vs HistoryDetailView (with spec_json) separate Pydantic models; same split at tRPC boundary (HistoryRow vs HistoryDetail)
- 2026-06-28 (16-03): D-15 best-effort enforced at all 3 layers — repository returns []/None on any error; FastAPI returns []/404 when repo returns None; tRPC returns []/null on any network/non-2xx/validation error; no exceptions propagated
- 2026-06-28 (16-03): D-17 re-validation at web boundary — tRPC uses FastApiHistoryRowSchema/FastApiHistoryDetailSchema Zod schemas; malformed rows are silently dropped (historyList) or return null (historyById) with structured stderr logging
- 2026-06-28 (16-03): D-17 deviation — historyById does NOT re-run SpecRootSchema.safeParse on spec_json (deviates from plan); uses z.record(z.unknown()) instead; rationale: history is read-display only, strict SpecRoot rejection would hide older valid specs from history; SpecRootSchema gate is appropriate at render time (genui.generate), not at history retrieval
- 2026-07-03 (22-01): chat_cost_ledger.run_id kept as a plain uuid with NO FK (mirrors the genui_generation_events/ui_spec_templates importer_id no-FK idiom) — a chat_runs row cascade-deletes with its conversation while its ledger row must survive (D-14), so constraining run_id would require its own SET NULL FK with no added integrity value over the established idiom; chat_conversations.importer_id and chat_cost_ledger.importer_id follow the same plain-uuid-no-FK pattern
- 2026-07-03 (22-01): text + SQL CHECK used for chat_runs.status / chat_messages.role+status / chat_run_events.type / chat_cost_ledger.execution_locus (NOT pgEnum) — matches the plan's explicit instruction and the existing outcome-CHECK precedent (genui_generation_events, ui_spec_templates) rather than introducing a new enum style
- 2026-07-03 (22-01): Docker Desktop + local Supabase stack were not running at plan start (migrate:local failed ECONNREFUSED 127.0.0.1:54322); started both (Rule 3 blocking-issue auto-fix) to reach the [BLOCKING] Task 2 migration-apply requirement; migration 0023 applied cleanly and idempotently re-verified
- 2026-07-03 (22-02): test files placed per the codebase's ESTABLISHED test-layout convention (flat tests/test_*.py for domain services, tests/infrastructure/test_*.py for infra adapters) instead of the plan's literal tests/unit/ path — that directory does not exist anywhere in this repo
- 2026-07-03 (22-02): Bedrock model ids in CHAT_MODEL_REGISTRY are literal strings mirroring DEFAULT_BEDROCK_MODEL_ID/DEFAULT_GENUI_MODEL_ID in settings.py, NOT imported from app.settings — keeps the domain layer free of app.settings coupling (no existing domain module imports settings either)
- 2026-07-03 (22-02): all 4 curated OpenRouter registry entries are capabilities.genui=False (conservative default; only the 2 Bedrock entries are genui=True) — also scopes OpenRouterChatAdapter's message translation to text-only for Phase 22 (no tool_use/tool_result block plumbing needed until a future plan promotes an entry and needs the Phase 24 round-trip)
- 2026-07-03 (22-02): OpenRouterChatAdapter is fail-closed on a missing OPENROUTER_API_KEY — raises RuntimeError immediately rather than attempting a request that would degrade into a generic HTTP error (D-07); a genuine non-2xx OpenRouter response instead yields StreamEnd(stop_reason='error'), matching BedrockChatAdapter's never-raise-past-this-boundary contract
- 2026-07-03 (22-02): GET /v1/chat/models returns {registry_version, models:[...]} as one object (ChatModelsView), not a bare list, so registry_version is a first-class always-present field for client cache-busting (mirrors the {catalogId, version} spirit of registry-version.ts)
- 2026-07-03 (22-03): highlight.js added as an explicit direct devDependency (not left transitive via rehype-highlight->lowlight) so `import "highlight.js/styles/github-dark.css"` resolves reliably under npm workspace hoisting
- 2026-07-03 (22-03): fixed github-dark syntax theme for code blocks regardless of app light/dark mode (common chat-product convention: code chrome stays dark independent of site theme); outer <pre> still uses token-bound bg-muted per 22-UI-SPEC.md
- 2026-07-03 (22-03): apps/web had no vitest/jsdom test infra before this plan — added vitest.config.ts + devDeps mirroring packages/genui's existing convention exactly, rather than inventing a new one
- 2026-07-03 (22-03): rehypePlugins=[rehypeSanitize, rehypeHighlight] order is deliberate — sanitize runs on the raw hast tree before rehype-highlight injects its own trusted hljs/hljs-* classNames, so the default sanitize schema never strips the highlighter's output (T-22-10)
- 2026-07-03 (22-04): CostCircuitBreaker caps are config-only (D-21) — no public method accepts a per-call cap parameter (verified structurally, not just by grep); a ledger sum-query failure fail-closed BLOCKs rather than allows (T-22-14)
- 2026-07-03 (22-04): sum_for_run/sum_for_conversation/sum_for_importer_day sum chat_cost_ledger rows client-side in Python (Decimal) rather than a Postgres-side SUM aggregate — matches every other supabase-py query in this codebase (no existing call does server-side aggregation)
- 2026-07-03 (22-04): D-22 fix widened beyond the plan's literal files_modified list to the calling use cases (generate_ui_spec.py, generate_code_island.py) — the adapters alone exposing real usage does not close the gap; the use cases were still discarding it before GenerationEvent
- 2026-07-03 (22-04): GenuiCodeJudgeAdapter.rank() return type changed int -> JudgeResult(best_index, input_tokens, output_tokens) to have a result object to attach usage to; all call sites/tests updated in the same commit, all prior test assertions preserved 1:1
- 2026-07-03 (22-04): test files placed at the flat tests/ level (repeating the 22-02 precedent) instead of the plan's literal tests/unit/ path — that directory does not exist anywhere in this repo
- 2026-07-03 (22-05): DEFAULT_CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6" mirrors chat_model_registry.py's Bedrock default (22-02) — keeps the web-side D-10 remember-last-used fallback in sync with the Python registry's first entry (hand-sync note in both files)
- 2026-07-03 (22-05): D-10 remember-last-used logic extracted into a pure resolveDefaultModelId helper (mirrors entities/gallery.ts's shapeGalleryItem pattern) — DB-free-testable without mocking a Drizzle query chain, which has no precedent anywhere in this codebase
- 2026-07-03 (22-05): rename/delete mutations + the single DeleteConversationDialog instance live inside ConversationRail (not lifted to page.tsx) — keeps the rail self-contained and avoids nesting an AlertDialog inside a DropdownMenu (known Radix portal/focus conflict)
- 2026-07-03 (22-05): rail-collapse toggle placed in a page-level top bar, outside the rail's own 0px-collapsed width container — the UI-SPEC's literal 0px-collapsed rail would otherwise have no way to reopen once collapsed; localStorage read/write still lives inside conversation-rail.tsx per the plan's acceptance criteria
- 2026-07-03 (22-06): added ChatConversationRepository (touch()) beyond the plan's literal Task 1 file list — required to make D-10/D-12 (conversation title + remembered model updates) true from the Python turn loop; 22-05's chat CRUD is a separate web-owned tRPC/Drizzle surface
- 2026-07-03 (22-06): supabase_chat_run_repository.py's finish_run uses .upsert(on_conflict="id") instead of .update() so the whole adapter file carries zero literal ".update(" calls, not just append_event
- 2026-07-03 (22-06): every assistant message insert (fresh turn AND regenerate) always gets a freshly-generated sibling_group_id rather than leaving it null until a first regenerate — removes a backfill special-case
- 2026-07-03 (22-06): regenerate() runs the pre-turn cost gate BEFORE set_sibling_inactive — a BLOCKed regenerate must never retire the only active assistant reply for a turn
- 2026-07-03 (22-06): test files placed at tests/test_chat_provider_router.py (flat) + tests/application/test_run_chat_turn.py — repeats the 22-02/22-04 precedent (no tests/unit/ directory exists anywhere in this repo)
- 2026-07-03 (22-09): extended use-chat-stream.ts's applyRunEvent to accumulate tool_call partial_json into a new genui_spec_streaming MessagePart (mirrors the Python _TurnState.pending_tool_json accumulator) — the plan's own progressive-genui must-have is unreachable otherwise, since tool_call deltas were previously dropped entirely
- 2026-07-03 (22-09): chat.getHistory's ConversationView consumer now folds ALL sibling rows per turn instead of isActive-only — SiblingNav needs every version to navigate; 22-08 explicitly flagged that filter as deferred to 22-09
- 2026-07-03 (22-09): regenerate and InlineErrorCard's Retry unified into one onRegenerate(assistantMessageId) operation — no two diverging retry mechanisms; withheld on a "completed" live turn's transient sentinel id specifically, to avoid a resend-instead-of-regenerate misfire in the brief window before chat.getHistory catches up
- 2026-07-03 (22-09): fixed a latent duplicate-turn bug (Rule 1) — the live streaming pseudo-turn was kept visible by a parts.length>0 check that never turns false once a turn settles, so every completed/failed/stopped turn rendered twice; replaced with a chat.getHistory row-count snapshot that correctly detects when the persisted row has landed
- 2026-07-03 (22-09): buildPartialNode's recursion depth capped at MAX_SPEC_DEPTH (Rule 2, T-22-35) — the partial-tree walk touches untrusted model-authored structure BEFORE the finalized SpecRootSchema's own depth refinement ever runs
- 2026-07-03 (22-11, Rule 1 cross-file fix): repointed chat_model_registry.py's browser entry from "webllm-gemma-3-4b"/"Gemma 3 4B (in-browser)" to "webllm-qwen3-4b"/"Qwen3 4B (in-browser)" — @mlc-ai/web-llm 0.2.84's prebuiltAppConfig ships no Gemma-3-4B build (only Gemma3-1B); D-08 named Qwen3 4B as an equally acceptable curated option, so this stays within the decision's own sanctioned alternatives rather than requiring a new one
- 2026-07-03 (22-11): recordBrowserTurn also touches chat_conversations.model_id/title/updated_at on the first turn (mirrors the server agent's touch() behavior) so browser-only conversations get correct rail titles/ordering — same-shape-as-server-turns truth
- 2026-07-03 (22-11): added minimal browser-locus Stop support (engine.interruptGenerate() + a ref-tracked terminal-status label) even though the plan's action text only covered send — CHAT-03 Stop is an already-shipped, phase-wide contract; leaving it a silent no-op for the browser locus would be a regression
- 2026-07-04 (23-02): computeNodeRegistryHash hashes a Zod public-API structural schema-shape summary (not .toString()/raw object) — browser-safe FNV-1a, flips on any real schema change (field add/remove/retype, check add, nullability change)
- 2026-07-04 (23-02): GenuiPanelNode Handles left visible (not hidden via opacity-0) since canvas edges are user-created via interactive drag-to-connect, unlike /knowledge's decorative-only handles
- 2026-07-04 (23-03): ChatNode reads conversation title from a live api.chat.listConversations query (cached, same as the rail) rather than node.data — node.data stays provenance-only (conversationId) per 23-02's fixed Zod boundary
- 2026-07-04 (23-03): genui-panel nodes materialize only from ACTIVE (isActive) history rows — a regenerated turn's retired sibling never also renders a panel, keeping canvas panel count in lockstep with what the docked view currently displays
- 2026-07-04 (23-03): persistence/restore intentionally NOT wired this plan (23-04's seam) — ChatCanvas rebuilds nodes + a fresh dagre layout from chat.getHistory on every mount; dragged positions aren't preserved across a Chat<->Canvas toggle yet
- 2026-07-04 (23-03, Rule 3 fix): vitest had no "~/*" path alias (only tsconfig.json's `paths` had it) — any test reaching "~/trpc/react" failed to resolve under vite; added `resolve.alias` to vitest.config.ts mirroring tsconfig
- 2026-07-05 (23-06): ButtonComponent's onClick (Phase-13 ActionSchema object) takes precedence over the legacy string `action` ActionRegistry key when both are present on a button node
- 2026-07-05 (23-06): panel-action-bridge registers ONLY setState in its ActionRegistry — navigate/mutate/query-refresh intentionally absent (a memoized canvas node body shouldn't carry router/tRPC deps; mutate is unreachable anyway since ALLOWED_MUTATIONS=[])
- 2026-07-05 (23-06, Rule 1/3 fix): found + fixed 2 pre-existing bugs in 23-05's canvas-store-context.tsx while writing the first-ever live React-mount test of CanvasStoreProvider/usePanelData: (1) missing `React` import (JSX only worked under Next's SWC auto-runtime, crashed under vitest's plain esbuild transform); (2) usePanelData's incoming-edges overlay selector allocated a new object every call, breaking useSyncExternalStore's snapshot-stability contract and infinite-looping ANY target panel with a live edge in the real running app — fixed with zustand v5's useShallow + a stable EMPTY_PANEL_DATA constant

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 03 P02 | 3h | 5 tasks | 2 files |
| Phase 04 P10 | 15m | 1 task | 1 file |
| Phase 04 P07 | 45m | 2 tasks | 9 files |
| Phase 04 P09 | 90m | 2 tasks | 16 files |
| Phase 05 P01 | 35m | 2 tasks | 7 files |
| Phase 04 P08 | resumed | 4 tasks | retrieval schema + flywheel + RPCs; applied 3 envs |
| Phase 04 P13 | ~30m | 2 tasks | retain token bbox geometry (text+OCR) |
| Phase 04 P14 | ~40m | 2 tasks | ground region polygons in token coords |
| Phase 05 P03 | ~30m | 3 tasks | email detail route + DOMPurify body tabs + entities list |
| Phase 05 P04 | ~35m | 3 tasks | react-pdf PdfPreviewPane + RegionOverlayBox + OverlayLayer |
| Phase 06 P01 | resumed | 3 tasks | 9 files — 7 use cases + 7 endpoints + DI + 45 new tests |
| Phase 06 P02 | 6m | 2 tasks | 6 files — geometry helpers (TDD) + 7 tRPC mutations + .env.example |
| Phase 06 P03 | ~25m | 3 tasks | 9 files — useRegionEdit + draw surface + action toolbar wired end-to-end |
| Phase 06 P04 | ~35m | 3 tasks | 8 files — reject dialog + nest picker + merge multi-select + history badges |
| Phase 07 P01 | ~20m | 3 tasks | 7 files — 3 mutations + entityTypesRouter + groupEntityTypeRows + detail extension |
| Phase 07 P02 | ~25m | 3 tasks | 3 files — useAutofill hook + EntityTypePicker + ActionToolbar autofill integration |
| Phase 07 P03 | ~45m | 3 tasks | 5 files — FieldsPanel + ReprocessDialog + EntitiesList inline panel + email-detail wiring |
| Phase 08 P01 | ~45m | 3 tasks | 7 files — extract_key_terms domain service (TDD) + autofill wiring + confirm-fallback FK fix + integration test |
| Phase 09 P01 | ~4m | 2 tasks | 5 files — component_role enum + 3 relationship columns/2 indexes + migration 0013 generated & applied local |
| Phase 09 P05 | ~3m | 2 tasks | 2 files — @nauta/ui shadcn sidebar block (no new dep) + next-themes ThemeProvider wrapper (D-21) |
| Phase 09 P02a | ~10m | 4 tasks | 10 files — Component+repo relationship writers + 3 setters + origin-aware DenyField + 4 endpoints/DI + 19 tests |
| Phase 09 P02b | ~25m | 3 tasks | 6 files — AutofillFieldsUseCase (TDD, token-grounded sub-field detect + D-19 exclusion) + EntityTypeRepository.find_by_id + /autofill-fields endpoint/DI + 12 tests |
| Phase 09 P03 | ~14m | 4 tasks | 8 files — EntityTypeRepository write methods + manage_entity_types use cases (TDD) + /v1/entity-types router/mount/DI + 23 tests (14 unit + 9 router) |
| Phase 09 P04 | ~7m | 4 tasks | 10 files — shared _listener-config + 6 component relationship mutations + detail.role/entityTypeId/entityTypeFieldId + emails.entitySummary (D-23) + entity-types write mutations (D-26) + 28 new vitest (55/55 green) |
| Phase 09 P06 | ~12m | 3 tasks | 6 files — app-shell layout + frosted AppSidebar (D-20/21) + entity-chips/inbox-row (D-23/24) + resizable glassy three-pane inbox (D-22); tsc 0 + web:build EXIT 0 |
| Phase 09 P07 | ~16m | 3 tasks | 6 files — entityTypes.list id exposure + use-entity-type-admin optimistic CRUD hook (D-26) + field-row-dialog (field_type allowlist + D-27 delete-guard) + /entity-types master/detail page+fields table (D-25); api-client 56/56, tsc 0, web:build EXIT 0 |
| Phase 09 P08 | ~30m | 3 tasks | 7 files — role-color overlay box + D-12 role-filtering overlay-layer + pdf zoom 0.25-4.0/zoom-to-cursor/Space-pan/fit + canvas-toolbar + canvas-shell (4-zone) + use-canvas-state (D-09 redraw reuse) + use-role-mutations (optimistic + autofill); additive/back-compat, tsc 0 (x4), web:build EXIT 0 |
| Phase 09 P09 | ~12m | 3 tasks | 9 files — LAYERS tree (panel+row, D-12) + role/field-relationship pickers + inline confirm/deny + active-parent banner + INSPECTOR (D-11) + use-autofill-fields (D-13/14/15) + email-detail CanvasShell composition (D-10 active-parent draw); tsc 0 (x6), web:build EXIT 0 (Task 4 human-verify pending) |
| Phase 09 GAP-A | ~35m | 4 defects | 16 files — CRIT-1 EntityTypeField.id + autofill writes field uuid into FK; CRIT-2 hide soft-deactivated fields from active reads + autofill prompt; HIGH-3 FieldView id end-to-end; WR-03 update-field per-type slug uniqueness; 3 commits, full Python+api-client+web gates green |
| Phase 09 GAP-C | ~25m | 2 defects | 6 files — MED remove dead canvas-shell toolbar controls (page-nav/zoom/Fit) + unify Show-regions to one source of truth (shell→pane controlled showOverlays); LOW field-relationship ids UUID|None at the Pydantic boundary (422 on malformed) + TDD; 2 commits, apps/web tsc 0 + web:build EXIT 0, pytest 436 passed 86.97% cov, full Python gate green |
| Phase 09 GAP-D2 | ~30m | 6 defects | 8 files — MEDIUM-A InboxRow no nested interactive (div role=button + keys); MEDIUM-B toast.warning on unanchorable drag-to-draw; MEDIUM-C neutral deactivate-vs-delete pre-delete copy; MEDIUM-D emails.list explicit projection (drop bodyHtml/raw + truncated bodyText); MEDIUM-E Confirm All Fields = N confirms + ONE invalidate; LOW dead autofill machine + dead use-canvas-state API + CanvasShell emailId removed; 6 commits, apps/web tsc 0 + web:build EXIT 0, api-client build 0 + vitest 56/56 |
| Phase 12 (all) | ~4h | 4 plans | 27 files — @nauta/genui scaffold + spec-schema + catalog/registry + renderer + studio/preview; 96/96 genui tests green; tsc + web:build green; no-eval gate clean; see 12-01..12-04 SUMMARYs |
| Phase 13 (all) | ~4h | 4 plans | quarantine+generator+repair adapters + audit table + tRPC genui.generate + buildActionRegistry; 153/153 genui tests + 113/113 api-client; no-eval gate clean; see 13-01..13-04 SUMMARYs |
| Phase 14 (all) | ~2h | 3 plans | exact-match cache (ui_spec_templates migration 0022) + cache-key module (TDD) + GenerateUiSpecUseCase cache integration; 87/87 Python tests green; see 14-01..14-03 SUMMARYs |
| Phase 15 P01 | ~120m | 3 tasks | 13 files — outcome signal thread-through (Python use-case + FastAPI view + tRPC schema, D-05) + deriveGenerationState + describePropsSchema studio helpers + @nauta/genui/studio subpath; 38 new tests (6 Python + 5 api-client + 27 studio); typecheck + no-eval gate clean |
| Phase 16-03 | ~45m | 3 tasks | 8 files — read-only history spine: UiSpecTemplateRepository list_recent+find_by_id + GET /v1/genui/history + GET /v1/genui/history/{id} FastAPI endpoints + tRPC historyList+historyById procedures; TDD RED/GREEN per task (6 commits); D-14/D-15/D-16/D-17/WR-06/WR-02 all honored; 42 new tests; tsc+ruff clean |
| Phase 16-02 | ~60m | 3 tasks | 9 files — pure deterministic rubric (valid-spec/composed/a11y, weights 0.30/0.30/0.25/0.15) + LLM-as-judge adapter (escalation model, forced tool-use) + eval runner (create_container(), golden-set, Semaphore(3)) + report writer (JSON+MD) + compare helper; 21 tests (20 unit + 1 integration smoke, gated RUN_GENUI_EVAL=1); 87% coverage gate holds; ruff clean; Task 4 (live Bedrock baseline) deferred to connected env |
| Phase 16-05 | ~10m | 2 tasks | 2 files — history-island.tsx (474 lines: HistoryMasterList + HistoryDetailView + 7 sub-components + offset pager + parseSpecSafe safe-fallback) + studio-tabs.tsx slot swap (HistoryPlaceholder → HistoryIsland); STDO-02 reuse contract intact (one dynamic SpecRenderer); D-18 read-only; tsc+next build green; Task 3 browser-verify deferred (autonomous, no backend) |
| Phase 17-01 | ~45m | 3 tasks | 11 files — 6 WCAG-AA DTCG packs (nauta-teal baseline + 5 distinct personalities; HSL triplet colors, no raw hex) + TOKEN_ALIASES (21-alias closed set) + TokenAliasSchema/StylePackIdSchema/TokenPropsSchema (fourth Zod allowlist) + style_pack_id on SpecRootSchema + re-emitted drift-gate-green Bedrock artifacts; TDD RED/GREEN per task (5 commits); 289/289 tests green; tsc clean |
| Phase 22 P01 | 20min | 2 tasks | 8 files — 5 chat Drizzle table modules (conversations/runs/messages typed-parts+siblings/run_events append-only/cost_ledger) + barrel export + migration 0023 (CHECK constraints + RLS deny-all) generated & applied to local Postgres |
| Phase 22 P02 | 75min | 3 tasks | 11 files |
| Phase 22 P03 | ~25min | 1 tasks | 3 files |
| Phase 22 P04 | 25min | 3 tasks | 13 files |
| Phase 22 P05 | 25min | 3 tasks | 13 files |
| Phase 22 P06 | 70min | 3 tasks | 10 files |
| Phase 22 P07 | 30min | 2 tasks | 8 files |
| Phase 22 P08 | 35min | 3 tasks | 9 files |
| Phase 22 P10 | 25min | 2 tasks | 7 files |
| Phase 22 P09 | 40min | 3 tasks | 12 files |
| Phase 22 P11 | ~65min | 2 tasks | 12 files — @mlc-ai/web-llm engine hook + picker activation + browser-locus send branch + chat.recordBrowserTurn persistence; phase 22 all 11 plans complete |
| Phase 23 P01 | 35min | 3 tasks | 8 files |
| Phase 23 P02 | 25min | 2 tasks | 7 files |
| Phase 23 P03 | ~35min | 3 tasks | 13 files |
| Phase 23 P04 | 55min | 3 tasks | 12 files |
| Phase 23 P05 | ~50min | 3 tasks | 14 files |
| Phase 23 P06 | 55min | 3 tasks | 9 files |
| Phase 24 P01 | 35min | 3 tasks | 9 files |
