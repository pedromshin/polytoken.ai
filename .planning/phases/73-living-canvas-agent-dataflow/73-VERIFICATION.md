---
phase: 73-living-canvas-agent-dataflow
verified: 2026-08-06T22:30:00Z
status: human_needed
score: 7/9 criteria VERIFIED with file:line evidence; 2/9 HUMAN-GATED (named live seams, not failures); 0 GAP
overrides_applied: 0
provenance: orchestrator-run — no per-plan PLAN.md trail exists (phase dir holds SPEC.md only);
  build evidence is ORCHESTRATOR-STATE.md rounds + git SHAs, cited per-wave below
gaps: []
human_verification:
  - test: "LCAN-05 — wire a recipe live on a running :3000, reload, assert edge + published value against the chat_canvas_layouts DB row (not terminal output)"
    expected: "Edge, wiring, and last published value restore exactly (D-06/D-10)"
    why_human: "Needs an already-running dev server + live DB. Client-live round-trip IS proven in vitest (canvas-publish-flow.test.tsx, zero-mock publish→edge→live-target), and edges reconstruct from history — but the DB-row/real-browser assertion is the standing rendered-geometry lesson (four layout bugs shipped through green suites 2026-07-15) and cannot be closed from jsdom. Additionally the prod web DB is DOWN right now (Supabase auto-pause incident, passwords rotated, Vercel env stale) — pending Pedro's password reset+paste."
  - test: "LCAN-09-live — provision the worker container, apply migration 0061 (and verify 0058-0060), flip RECIPE_RECOMPUTE_ENABLED, close the tab, wait a cron tick, reopen"
    expected: "The tile shows a newer value bumped server-side while the tab was closed"
    why_human: "The entire code path ships DARK and verified (below), but the live loop needs: worker ECS container not yet wired in ecs.tf (Terraform blocked on the remote-state import runbook — an apply without it recreates live SES rules = mail outage), prod migration 0061 via the migrate pipeline (needs the 3 absent PROD_* secrets), and the flag flip. All Pedro-gated infra, named in PEDRO-CHECKLIST."
  - test: "Flip CANVAS_EMIT_TOOL_ENABLED and speak the MVP sentence ('add my rent sheet, add a total tile, keep them in sync') in a live chat"
    expected: "Nodes materialize, a labeled data-edge draws, the tile renders the published total, and a named recipe badge encloses the group"
    why_human: "Every leg is unit/flow-tested, but the flag is default-OFF everywhere and no live turn has ever exercised the full loop. This is the phase's banger claim; only a human turn proves it."
---

# Phase 73: Agent-authored Live Dataflow Recipes — Verification Report

**Phase Goal:** One sentence makes the agent assemble a running dataflow on the canvas — drop nodes, wire data-edges, publish live values through them, name the graph as a persisted recipe, and keep it recomputing after the tab closes.
**Verified:** 2026-08-06 (retroactive, goal-backward against SPEC.md success criteria)
**Status:** human_needed — all code seams verified; the two live seams the SPEC itself named as live-only remain.

## Headline

The codebase delivers what the phase promised, and every gate-able criterion is backed by code I read rather than claims I accepted. The agent has all four emit verbs (`emit_canvas_node` / `emit_canvas_connect` / `emit_code_island` / `emit_canvas_recipe`), all behind one fail-closed flag; the web reconcile materializes nodes, edges, and now named recipes idempotently; the publish port feeds 12 source-node types into the unchanged `resolveCanvasPath` engine; `canvas_recipes` is a real RLS'd table with ownership-first CRUD and a neutral on-canvas badge; and the durable recompute worker (task + cron dispatcher + allowlist migration) is fully built and registered — dark behind `RECIPE_RECOMPUTE_ENABLED`.

What is **not** proven is exactly what the SPEC predicted would not be provable in CI: the DB-row/real-browser round-trip (LCAN-05) and the after-close recompute against a running worker (LCAN-09-live). Both are named live seams, both Pedro-gated on infra (worker container, prod migrations, flag flips), neither is a code gap. **Nothing failed. Nothing is stubbed.**

## Provenance — how this phase was actually built

This phase ran through orchestrator sessions, not the per-plan GSD flow — there are **no 73-0N-PLAN.md files** (`.planning/phases/73-living-canvas-agent-dataflow/` contains SPEC.md only). The build trail is `ORCHESTRATOR-STATE.md` + git, and I verified every SHA exists on main:

| Wave | ORCHESTRATOR-STATE.md round | Commits (verified in git) |
|---|---|---|
| A — connect wedge | "PRE-COMPACT CHECKPOINT — 2026-07-25" (session_016dmeeGLzwLPZfRwGpByHmn, branch `claude/polytoken-email-infra-cont-qi9q5g`) | web `a2393f2b` (MessagePart + `collectAgentEdges` + reconcile, 13 tests), listener `203a8b5a` (both emit tools, flag-gated) |
| B — publish port | same round | core `c2139f79` (`projectForPublish` + `useCanvasPublish` + sourcePath rewrite), fan-out `00f19dbe` (10 more source nodes) |
| C — named recipes | "ULTRACODE ROUND 3 — 2026-07-27" (session_01NhVUcfpAuwy4YBkvme7dUp, branch `claude/phase-76-summon-loop-al5emg`; merged to main via PR #10 `c3f339a`) | backend `e1da9071` (table + CRUD; 2 CONFIRMED verify findings fixed: missing RLS hand-appended into 0058, jsonb typing), web badge `de8137ec` (recipe legend) |
| C — creation seam + worker | 2026-08-06 wrap-up session (this sitting, all local on main) | `f0510ee5` (`emit_canvas_recipe` + web reconcile), `a19aba67` (verifier findings: ALL-OR-NOTHING recipe planning, sourceRef sanitize, esbuild pin), `1d1391a2` (worker `recompute_canvas_recipe` + `dispatch_recipe_recomputes` + migration 0061) |

Every stream in the 2026-08-06 batch was adversarially verified in-session and CONFIRMED findings were fixed same-session (`a19aba67` is that fix commit for this phase's stream). Gates at integration: worker 34 · mcp-server 32/32 · web 461 targeted + typecheck · drizzle-kit check · api-client 59 (entities) · listener targeted suites + mypy 318 + lint-imports. The FULL listener pytest + full TS matrix were still running at write time — this report assumes green per the orchestrator's ledger; if the ledger notes a failure, re-open the affected criterion.

## Goal Achievement — SPEC Success Criteria

| # | Criterion | Status | Evidence (verified, not recited) |
|---|-----------|--------|----------------------------------|
| LCAN-01 | `canvas_connect` part → exactly one data-edge, idempotent on the connect dedup key | ✓ **VERIFIED** | `use-canvas-persistence.ts:328` `collectAgentEdges` (keyed on the server dedup tuple, `:124`); MessagePart arm `use-chat-stream.ts:163`; transcript skip `message-turn.tsx:530`; wired at `chat-canvas.tsx:601`; `agent-canvas-reconcile.test.ts:191` ("collectAgentEdges — canvas_connect parts (LCAN-01/06)") |
| LCAN-02 | `emit_canvas_connect` registered ONLY when `CANVAS_EMIT_TOOL_ENABLED`; fails closed | ✓ **VERIFIED** | `settings.py:202` `CANVAS_EMIT_TOOL_ENABLED: bool = False`; `chat_turn_providers.py:317-326` structural omission (empty tuple when off, never mutation); `chat_tools.py:444` `build_emit_canvas_connect_tool`; `test_container.py:380` `TestCanvasEmitExposureGate` (`:422` on / `:446` off) |
| LCAN-03 | Bounded, pollution-guarded projection to `shared.published.{nodeKey}` via the bounded enum | ✓ **VERIFIED** | `canvas-publish.ts:25` FORBIDDEN_KEYS, `:41-45` caps (depth 4 / 20 items / 30 keys / 2000 chars / 8192 bytes), `:56` `projectForPublish` rejects-wholesale on oversize (`:71`); `useCanvasPublish` wired into **12** source-node files (usage + 10 fan-out at Wave B, + `spreadsheet-node.tsx` added by the Phase-76 prereq); `__tests__/canvas-publish.test.ts` |
| LCAN-04 | Wired edge re-renders target within one store tick, no manual refresh | ✓ **VERIFIED** | `__tests__/canvas-publish-flow.test.tsx` (zero-mock publish→edge→live-target re-resolution through the unchanged `usePanelData`/`resolveCanvasPath` engine); friendly→physical sourcePath rewrite `use-canvas-persistence.ts:307-313` (`publishedNodePath` prefix, `:350-352`) |
| LCAN-05 | Recipe round-trips reload; edge + published value asserted **against the DB row** | ◐ **HUMAN-GATED** | Client-live round-trip proven in vitest; edges/wiring reconstruct from history. The DB-row/real-browser leg needs a running :3000 + live DB — and the prod web DB is currently down (Supabase pause incident). Named live seam, per the SPEC's own `[~]`. |
| LCAN-06 | Data edge stays neutral — no tier hue at the wiring seam | ✓ **VERIFIED** | `data-edge.tsx:13-27` "THE WIRE IS NEUTRAL" invariant intact (`CANVAS_EDGE_TIER.neutral`, no hue); agent edges reuse `toFlowEdge` verbatim (`chat-canvas.tsx:589-601` — no styling introduced); the recipe badge carries the SAME law: `recipe-overlay.tsx:14-24` ("THE BADGE IS NEUTRAL CHROME", border-rule/bg-bright/text-ink, zero shadow, sans not serif) |
| LCAN-07 | `canvas_recipes` row persists name + key-set; badge renders grouping members | ✓ **VERIFIED** (code) | Migration `0058_secret_mesmero.sql:1-16` (table + FKs + indexes) with hand-appended RLS `:21-27` (anon deny + owner policy — the e1da907 CONFIRMED-finding fix, disclosed in the migration's own comment); schema `packages/db/src/schema/canvas-recipes.ts`; CRUD `canvas-recipes/index.ts:58` (create/list/byId/rename/remove); badge `recipe-overlay.tsx:4-12` (ViewportPortal fieldset legend, pointer-events none, additive read-only); `__tests__/recipe-overlay.test.tsx`. **Plus the creation seam the SPEC didn't originally scope**: `emit_canvas_recipe` (`chat_tools.py:644`, part builder `run_chat_turn_tool_loop.py:362` `_build_canvas_recipe_part`, dispatch `:407`) → web `agent-recipe-reconcile.ts:118` `collectAgentRecipePlans` → runner `chat-canvas.tsx:1367-1390` (`canvasRecipes.create` + list invalidate). *Prod table creation (migration 0058 apply) is in the live remainder below.* |
| LCAN-08 | Tenancy: every new procedure `protectedProcedure`, ownership asserted FIRST, NOT_FOUND before any read/write | ✓ **VERIFIED** | `canvas-recipes/index.ts:64-77` create asserts `assertConversationOwnership` at the top via `assertOwnedOrNotFound`, `userId` stamped from `ctx.user.id` never a client field (`:82`); `:106-111` list same; byId/rename/remove gate on `assertCanvasRecipeOwnership` (`packages/db/src/ownership.ts`) per the header contract `:16-19` (fail-closed, no existence oracle); `canvas-recipes.test.ts` covers it. Worker side re-derives tenancy IN SQL from the recipe row's `user_id` (`tasks.ts:388-389, :426`) — never trusts the payload. |
| LCAN-09 | Durable after-close recompute: worker re-polls `sourceRef`, bumps published value server-side | ◐ **HUMAN-GATED** (code half ✓ verified, dark) | Built end-to-end: `tasks.ts:391` `recomputeCanvasRecipe` (fail-loud posture — deleted/unbound recipe = clean no-op `:400-405`, malformed/un-owned/refused-write = THROW → graphile retry/dead-letter `:386-387`); `PUBLISH_PROJECTION_SQL` `:331-360` writes `shared.published.{nodeId}` in-place with the sharedState size gate re-enforced in SQL (`:358`); task `:464`, cron dispatcher `:516` (`index.ts:45` `*/15` crontab), both registered `:542-543`; flag `index.ts:76` `RECIPE_RECOMPUTE_ENABLED` default OFF; migration `0061:41-51` widens the SECURITY-DEFINER `enqueue_job` allowlist with both identifiers + keeps the graphile-schema ordering guard `:24-29`; `tasks.test.ts:254-294` covers dispatcher + job keys (worker suite 34). The LIVE half — running worker + applied 0061 + flag on + tab-closed observation — is the SPEC's own named live-verification seam. |

**Score: 7/9 VERIFIED · 2/9 HUMAN-GATED (LCAN-05 DB-row round-trip, LCAN-09-live) · 0 GAP.**

## Things I checked adversarially (not just recited)

1. **Fail-closed is structural, not conditional-in-the-tool.** The flag gate is the *composition root* omitting the tuple (`chat_turn_providers.py:317-326`), mirroring `INGEST_ENQUEUE_ENABLED`'s convention — the tools are absent from the model's offer, not present-but-refusing. `TestCanvasEmitExposureGate` pins both directions. Merging into the live mail receiver was therefore a behavioral no-op, which is exactly what the 2026-07-27 listener prod deploy (run 30240600911) relied on.

2. **The all-or-nothing recipe fix is real and correctly reasoned.** `agent-recipe-reconcile.ts:76-91` `resolveAllKeys` returns `null` (no plan) if ANY named key is absent from the live canvas — the header (`:12-25`) documents *why* partial-filtering was a trap: same-turn agent nodes materialize later than the part arrives, so a partial row would be frozen by the by-name dedupe and never self-heal. The part persists in history so the pass naturally retries. `a19aba67` also hardened the name cap to code points (`:137-144`) so a surrogate-split name can't break the dedupe forever, and sanitizes `sourceRef` to a plain record (`:95-102`). 109 test lines were added to `agent-recipe-reconcile.test.ts` in that commit.

3. **The publish port cannot blow the sharedState cap.** `projectForPublish` rejects wholesale at 8 KB after clamping (`canvas-publish.ts:71`) rather than truncating into junk, and the worker's server-side write re-enforces the SAME bound in SQL (`tasks.ts:358` `length(next_state::text) <= MAX_SHARED_STATE_SERIALIZED_CHARS`) — the two producers (client hook, worker task) share one ceiling. Keys cross FORBIDDEN_KEYS at the port AND again in the store's `mutate`.

4. **The neutrality law survived two new surfaces.** The SPEC predicted "someone will want to color a live edge green." Neither new surface took the bait: the wire keeps `CANVAS_EDGE_TIER.neutral` with the argument written into `data-edge.tsx:13-27`, and the recipe badge (`recipe-overlay.tsx:14-29`) explicitly cites and extends the same law — including the law-2 serif/sans call (chrome name = sans). Agent edges go through `toFlowEdge` verbatim; no styling exists at the wiring seam to audit.

5. **Migration 0061 supersedes rather than edits.** It `CREATE OR REPLACE`s the 0054 wrapper verbatim and only widens the allowlist (`0061:3-5`) — no in-place edit of applied migrations, the drizzle-journal gotcha this repo has been burned by before. The graphile-schema existence guard (`:24-29`) makes out-of-order application fail loudly instead of silently creating a broken function.

6. **Wave-C's own verify loop caught what drizzle-kit missed.** The 0058 migration as generated had NO RLS (drizzle-kit never emits policies); the round-3 adversarial verify flagged it as CONFIRMED-MED and the fix was hand-appended before merge, with the rationale left in the migration file (`0058:17-20`). That is the orchestrator-run equivalent of a RED proof — the gate demonstrably able to fail.

## Behavioral Spot-Checks (as recorded by the orchestrator ledger, not re-run here)

| Behavior | Gate | Result | Status |
|---|---|---|---|
| Worker tasks incl. recompute/dispatch | `apps/worker` vitest | 34 pass | ✓ (ledger, 2026-08-06) |
| MCP server | vitest | 32/32 | ✓ (ledger) |
| Web targeted (canvas/reconcile/publish/recipe) + typecheck | vitest + tsc | 461 pass | ✓ (ledger) |
| Drizzle journal/snapshot consistency | `drizzle-kit check` | clean | ✓ (ledger) |
| Listener targeted + mypy + import-linter | pytest / mypy 318 / lint-imports | green | ✓ (ledger) |
| FULL listener pytest + full TS matrix | — | **running at write time** | ⏳ assumed green per ledger; re-open on failure |

## Requirements Coverage

LCAN-01 ✓ · LCAN-02 ✓ · LCAN-03 ✓ · LCAN-04 ✓ · LCAN-05 ◐ live-seam · LCAN-06 ✓ · LCAN-07 ✓ (code; prod apply owed) · LCAN-08 ✓ · LCAN-09 ◐ code-✓/live-seam. No orphaned requirements: SPEC frontmatter lists exactly these nine.

## Gaps Summary — nothing failed; the remainder is live infrastructure, all Pedro-gated

1. **Prod migrations**: 0061 (and verify 0058–0060) via the MIGRATE-PROD pipeline once the 3 `PROD_*` secrets exist. Until 0058 lands, prod `canvas_recipes` reads degrade to render-nothing (graceful by design — `recipe-overlay.tsx:41-43`).
2. **Worker container provisioning**: not wired in `ecs.tf`; Terraform apply blocked behind the remote-state import runbook (SES-outage landmine). LCAN-09-live is unreachable until then.
3. **Flag flips**: `CANVAS_EMIT_TOOL_ENABLED` (listener) and `RECIPE_RECOMPUTE_ENABLED` (worker) both default OFF; the whole phase is byte-dark in prod until flipped.
4. **Live UAT**: LCAN-05 DB-row round-trip + LCAN-09-live + the real-browser screenshot pass (jsdom does no layout — the standing lesson). Compounded right now by the prod web DB being down (Supabase auto-pause, rotated passwords, stale Vercel/local env) — Pedro's reset unblocks it; `/api/dbcheck` stays on main until verified, then delete.

**Why `human_needed` and not `passed`:** the phase's banger claim — one sentence builds a graph that keeps itself alive — has never once run live. Every seam it needs is verified in code, several were adversarially broken and fixed on the way, and the SPEC itself named the two remaining legs as live-only. But this repo's own memory (four rendered-geometry bugs through green suites in one night) is the reason a green matrix does not round up to a living instrument. The first live turn with the flags on is the real verification — and it is an at-your-computer item, not a code item.

---

_Verified: 2026-08-06 — retroactive, goal-backward, adversarial stance_
_Verifier: Claude (wrap-up session) — evidence read from the tree at the listed SHAs, provenance from ORCHESTRATOR-STATE.md_
