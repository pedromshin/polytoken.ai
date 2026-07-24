# Repo Health & Agentic Decomposition — polytoken.ai

**Lane:** Recon (repo health, organization, agentic drivability)
**Date:** 2026-07-24 · **Branch:** `claude/polytoken-email-infra-cont-qi9q5g` · working tree clean
**Method:** direct file/line counts + knip; every claim cites `file_path:line`. Doc claims not trusted as ground truth.

---

## 1. The architecture as it ACTUALLY is

Two runtime brains behind one Postgres, plus a thin local daemon. Not a Next.js app with a Python helper — it is two peer applications that **mirror each other's capability registry by hand**.

```
                 SES → S3 (nauta-services bucket) → SNS
                                  │
                     apps/email-listener  (FastAPI, uv, Clean Arch)
                     app/{domain,application,infrastructure,presentation}
                                  │  writes
                          Supabase / Postgres  ──────────────┐
                                  │  reads                    │ Drizzle schema
                     packages/api-client  (tRPC, 15 routers)  │ packages/db
                                  │                            │
                     apps/web  (Next 15 / React 19)           │
                       ├─ app/* route tree (35 routes)        │
                       ├─ packages/genui  (generative UI catalog + renderer)
                       ├─ packages/ui     (shadcn-vendored kit)
                       └─ @xyflow canvas  (chat/_canvas)
                                  │
                     apps/daemon + packages/daemon-protocol  (local desktop bridge)
```

Key structural truths:
- **appRouter is a clean 15-child barrel** — `packages/api-client/src/root.ts:18-34`. Composition at the top is healthy; the rot is *inside* the heavy sub-routers, not in the assembly.
- **Capability registry is duplicated across languages by design** — `packages/capabilities/src/capability.ts` (TS) and `apps/email-listener/app/application/capabilities/registry.py`. CLAUDE.md calls the Python one a "mirror." Any capability change is a two-file, two-language edit with no compiler linking them — a standing drift hazard (belongs to the drift lane, flagged here as an architectural fact).
- **Listener follows Clean Architecture and it holds** — `app/domain`, `app/application`, `app/infrastructure`, `app/presentation` are real, enforced by `uv run lint-imports`. The layering discipline is genuine; the problem is a few god-files *inside* the layers (below).
- **Maritime domain purge is essentially DONE in application code.** A clean grep of real source (excluding node_modules/tests) for maritime/vessel/voyage/laytime/demurrage yields only *intentional* remnants: `packages/api-client/src/router/retired-entity-types.ts:2,15` (a deny-list of types deactivated by migration 0049) and two comments guarding against them resurfacing (`entity-types.ts:213`, `knowledge/graph.ts:353`). **Do not delete `retired-entity-types.ts`** — it is a live guard, not dead code. The maritime landmine is purely the `nauta-services` infra namespace, out of scope for this lane.

Test posture is healthy, not a liability: 136 web test files vs 336 web source files; 157 Python test files. Coverage is real. Co-located `__tests__` dirs do inflate directory listings (a phone-navigation cost, §4) but the tests themselves are an asset.

---

## 2. Worst offenders — biggest / worst-named / hardest to drive agentically

Ranked by drivability risk (size × edit-frequency × conflict surface), line counts exact.

| # | File | Lines | Why it's a problem |
|---|------|-------|--------------------|
| 1 | `apps/email-listener/app/application/use_cases/run_chat_turn.py` | **1755** | God-class `RunChatTurn` (`:331`) with ~25 methods: `run/regenerate/continue_after_widget` + private `_execute_turn` (`:708`), `_finalize_turn_completed/_finalize_confirm_action/_finalize_source_capture`, `_advance_round` (`:1412`), `_stream_round_deltas`, `_run_server_tool_round` (`:1574`), `_write_source_ledger_entries`. A `chat/` helper subdir already exists (§3) yet the orchestrator stayed monolithic. |
| 2 | `packages/genui/src/catalog/manifest.ts` | **1529** | The entire component catalog. `POLYTOKEN_CATALOG` frozen object spans `:903-1488`; inline size-class maps scattered above (`:559`, `:804`, `:818`). One file gates every GenUI component — adding a component = editing a 1.5k-line file. |
| 3 | `apps/web/src/app/chat/_canvas/chat-canvas.tsx` | **1486** | Mixes 7 exported *pure* helpers (`provenanceKey :235`, `buildSpecsByProvenance :241`, `buildPartsByProvenance :262`, `buildStreamingByProvenance :356`, `nodeToSendable :184`, `toPersistedShape :280`, `toFlowEdge :294`) with the giant `ChatCanvas` component (`:404`). Any canvas tweak reloads the whole file into context. |
| 4 | `apps/email-listener/app/container.py` | **1433** | Flat Dishka DI god-wiring: ~45 `_provide_*` factories (`_provide_ingest_use_case :611`, `_provide_autofill_use_case :333`, …) plus a ~200-line import block. **Highest merge-conflict surface in the repo** — every new use case touches both the imports and a provider here. |
| 5 | `packages/ui/src/spreadsheet-grid/SpreadsheetGrid.tsx` | 1004 | Single-component spreadsheet. Candidate for cell/row/selection extraction, but self-contained. |
| 6 | `apps/web/src/app/emails/[id]/_components/email-detail.tsx` | 843 | Largest single route component. |
| 7 | `packages/api-client/src/router/knowledge/graph.ts` | 833 | **Biggest single router file.** Mixes zod schema (`graphInputSchema :78`), 6 exported pure shapers (`shapeGraphResponse :123`, `dedupeShadowedSuggestionEdges :175`, `collectMissingEntityInstanceTargets :214`, `buildProvenanceSummary :248`, `shapeExplicitEdgeRow :267`) and the `knowledgeGraphProcedures` object (`:286`). |
| 8 | `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` | 837 | xyflow view component. |
| 9 | `apps/web/src/app/chat/_hooks/use-conversation-controller.ts` | 769 | 769-line hook — controller-in-a-hook, hard to reason about. |
| 10 | `apps/web/src/app/emails/[id]/_components/pdf-preview-pane.tsx` | 759 | |
| 11 | `packages/genui/src/schema/spec-schema.ts` | 747 | Zod schema for the whole GenUI spec. |
| 12 | `packages/api-client/src/router/emails/mutations.ts` | 711 | 9+ inline mutations (`accept :57`, `reject :86`, `redraw :115`, `split :153`, `merge :203`, …) in one file. |

**Explicitly NOT an offender (do not touch):** `packages/ui/src/sidebar.tsx` (778) is the vendored shadcn sidebar block — standard size, `SidebarProvider`/`useSidebar` etc. Leave it; decomposing vendored blocks fights the shadcn re-vendor workflow (`polytoken-design-system` skill).

### Naming / convention inconsistency (an agentic-navigation smell, not just cosmetics)
The api-client router mixes two conventions. Most domains are folders with an `index.ts` barrel (`chat/`, `entities/`, `knowledge/`, `emails/`, `files/`…), but **entity-types lives as three loose top-level files**: `router/entity-types.ts` (9.3 KB), `router/entity-types-write.ts` (12.9 KB), `router/retired-entity-types.ts`. From a phone, "open the entity-types router" is ambiguous — is it a file or a folder? Also loose at router root: `_column-detect.ts`, `_listener-config.ts`, `_ownership.ts`, `_scope.ts` (underscore-prefixed shared utils — a reasonable convention, but undocumented).

### Dead / stale code (named)
- **knip confirms exactly 2 unused files:** `apps/web/src/app/emails/[id]/_components/fields-panel.tsx` and `apps/web/src/app/emails/[id]/_components/use-autofill.ts`. Safe deletes. (Both sit in the emails route that also owns offenders #6/#10 — that route subtree is where cruft accumulates.)
- **8 unused deps / 6 unused devDeps** flagged by knip (e.g. `drizzle-zod` in `packages/db`, `vaul`/`tailwindcss-animate`/`@hookform/resolvers` in `packages/ui`, `jsdom`/`@types/ws` at root). Low-risk trim.
- knip's "176 unlisted dependencies" is mostly **false-positive from npm workspace hoisting** (`lucide-react`, `zod`, `sonner`, `pg`, `dotenv` resolve via the hoisted root). Real signal buried in it: e2e helpers import `pg`/`dotenv` without declaring them in `apps/web/package.json` — a genuine but low-priority gap.

---

## 3. The extraction that already half-happened (proof the pattern works)

`run_chat_turn.py` (#1) already spun off a `chat/` subdir — `app/application/use_cases/chat/`: `cluster_context.py` (272), `knowledge_memory.py` (300), `linked_context.py` (247), `prompt_assembly.py` (130), `source_capture_lookup.py` (93), `turn_state.py` (210), plus sibling files `run_chat_turn_confirm_action.py` (246), `run_chat_turn_tool_loop.py` (158), `run_chat_turn_widgets.py` (300). The context-assembly and widget/confirm concerns were pulled out cleanly. **What's left in the 1755-line file is the streaming orchestrator itself** — and it's still 3× the size of any of its extracted helpers. The decomposition template exists; it just wasn't finished for the hot path.

---

## 4. Why size is load-bearing here (not cosmetic)

Pedro drives this repo through Claude Code, often from a phone. That changes the cost function:
- **Single-shot edit safety.** A safe Edit needs the model to hold enough of the file to place a unique anchor and predict the blast radius. A 1755-line file routinely exceeds what fits a careful single-turn edit; the failure mode is a silently mis-placed patch. Files >800 lines are the danger zone; the four >1400 files are effectively un-editable from a phone without a read-then-narrow dance every time.
- **Parallel-agent conflict surface.** This repo runs fan-out development — there are live `claude/wf1-*` branches and `worktree-wf_*` worktrees. `container.py` (#4) is the single worst conflict magnet: *every* new use case edits its import block AND adds a provider, so two agents adding features collide there deterministically. Splitting it into per-domain provider modules turns those collisions into independent files.
- **Navigation from a small screen.** The folder-vs-loose-file inconsistency (§2) and `__tests__` dirs interleaved with source multiply the taps needed to reach the right file.

---

## 5. Proposed decomposition (concrete, scales, with cost stated)

Ordered by value/effort. Each is a mechanical, behavior-preserving split.

**A. `container.py` → `app/container/` package (HIGHEST value).**
Split the flat file into per-domain provider modules — `providers/ingest.py`, `providers/chat.py`, `providers/entities.py`, `providers/genui.py`, `providers/infra.py` (clients, S3, embedder) — each exporting a Dishka `Provider`; `container/__init__.py` composes them via `make_async_container`. 
*Cost:* import fan-out is the risk — every `_provide_*` currently shares the top import block; splitting means each module re-imports its own deps (some duplication). ~1 focused PR, near-zero behavior risk (DI wiring is declarative), and it **eliminates the repo's top merge-conflict hazard**. Do this first because it directly unblocks parallel agent work.

**B. `run_chat_turn.py` → finish the started extraction.**
Pull the streaming/round machinery into `chat/round_runner.py` (`_advance_round`, `_stream_round_deltas`, `_run_server_tool_round`) and the finalizers into `chat/finalizers.py` (`_finalize_turn_completed/_confirm_action/_source_capture`, `_write_source_ledger_entries`). `RunChatTurn` keeps `run/regenerate/continue_after_widget` + `_execute_turn` as a ~500-line coordinator. 
*Cost:* these methods share mutable `_TurnState` (`:256`, and `turn_state.py` already exists) — extraction means passing state explicitly, a real but contained refactor. Highest churn on the hottest path → **needs the tool-loop e2e tests green before/after** (`tests/application/test_run_chat_turn_tool_loop_e2e.py`, 1208 lines — the safety net exists). Medium review risk; do it in its own PR, not folded into a feature.

**C. `chat-canvas.tsx` → split pure helpers from the component.**
Move the 7 exported pure functions (`provenanceKey`…`toFlowEdge`) into `chat/_canvas/canvas-provenance.ts` + `canvas-shape.ts`. `ChatCanvas` imports them. 
*Cost:* trivial import fan-out (callers already import from this module — check `_canvas/__tests__/canvas-node-law.test.tsx` and `panel-nodes.test.tsx` re-point). Lowest-risk of the big four; pure functions have no runtime coupling. Leaves the component ~1050 lines — still large but no longer mixing concerns.

**D. `genui/catalog/manifest.ts` → one file per component group.**
Split `POLYTOKEN_CATALOG` into `catalog/entries/{layout,data,form,media}.ts`, each exporting its slice; `manifest.ts` merges and freezes them. 
*Cost:* the frozen single-object identity is relied on by the renderer and evals (`__tests__/render-node.test.tsx` 1379 lines) — keep the merged export shape byte-identical so consumers don't change. Medium churn, low risk if the composed object is unchanged.

**E. `knowledge/graph.ts` → `graph-shape.ts` (pure) + `graph.ts` (procedures).**
Move `shapeGraphResponse`/`dedupeShadowedSuggestionEdges`/`collectMissingEntityInstanceTargets`/`buildProvenanceSummary`/`shapeExplicitEdgeRow` out. Same pattern as C. Low risk.

**F. Naming cleanup (do LAST, or skip if churn-averse).**
Fold `entity-types.ts` / `entity-types-write.ts` / `retired-entity-types.ts` into a `router/entity-types/` folder to match every other domain. 
*Cost:* **pure churn with real blast radius** — these are imported across `entity-types` route components and tests; a rename touches many import paths for zero behavior gain. Only worth it as a batched sweep, and it competes with feature work. Recommend documenting the convention in CLAUDE.md instead of moving files if time is tight.

**Deletes (free):** remove `fields-panel.tsx` + `use-autofill.ts` (knip-confirmed unused); trim the 8 unused deps. No risk.

### What decomposition does NOT fix
None of this touches the cross-language capability-registry duplication (§1) — that's a structural drift risk the drift lane owns. And splitting files raises the *count* of files a phone must navigate; mitigate by keeping the folder-per-domain convention strict so the tree stays predictable. The net trade is favorable: more files, but each independently editable and conflict-isolated.
