---
phase: 33-live-bindings-plumbing
verified: 2026-07-08T02:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 33: Live Bindings Plumbing Verification Report

**Phase Goal:** A genui canvas panel whose spec declares `bindings` renders live product data —
resolved ABOVE the renderer via a compile-time switch over the 5 already-allowlisted tRPC
procedures, staying fresh through TanStack staleTime tiers plus event-driven invalidation — with
zero edits to the locked renderer files.
**Verified:** 2026-07-08T02:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `use-data-bindings.ts` exports `useDataBindings` + `STALE_TIME_MS`, resolves exactly the 5 wired procedures via compile-time switch | VERIFIED | File read in full; `switch(procedure)` has exactly 5 named cases (`entities.byId`, `entities.list`, `emails.detail`, `knowledge.byId`, `knowledge.graph`) + `default: return []` runtime skip; `STALE_TIME_MS` exported as `Record<WiredProcedure, number>` |
| 2 | By-id procedures source id ONLY from panelData, never binding.params | VERIFIED | `readContextId(args.panelData, "selectedEntityId"/"selectedEmailId"/"selectedNodeId")` — no read of `binding.params` in any of the 3 by-id branches |
| 3 | staleTime tiers applied per procedure (10s knowledge.*, 30s entities.*, 60s emails.detail) | VERIFIED | `STALE_TIME_MS` literal: knowledge.byId/graph=10_000, entities.byId/list=30_000, emails.detail=60_000; no `setInterval`/polling found |
| 4 | Degrades to `{}` on parse/streaming/schema failure, never throws | VERIFIED | `parseJsonLenient` try/catch + `attemptRepairJson` fallback; `extractBindings` returns `{}` on any failure; `entries.length === 0` short-circuits to `{}` |
| 5 | `genui-panel-node.tsx` calls `useDataBindings` and merges result over panelData before non-interactive GenuiPartBoundary branch, live wins on collision | VERIFIED | Line 86: `useDataBindings({specJson, isStreaming, panelData})`; line 149: `data={{ ...panelData, ...liveBindingData }}` (live spread last = wins) |
| 6 | `knowledge-graph.tsx` invalidates `knowledge.byId`/`knowledge.graph` on successful promotion, NOT on failure | VERIFIED | `promoteEdge()`: invalidate calls at lines 181-182 strictly after the `if (!response.ok) return {...}` guard (line 167); confirmed by passing negative test |
| 7 | 3 locked renderer files byte-identical to pre-phase-33 state (SC2) | VERIFIED | `git diff --stat -- packages/genui/src/renderer/spec-renderer.tsx packages/genui/src/renderer/render-node.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx` → empty output; `git status --porcelain` on same paths → empty |
| 8 | `ALLOWED_PROCEDURES` unchanged, exactly its original 9 entries (SC5) | VERIFIED | File read: 9 entries (`emails.list`, `emails.byId`, `emails.detail`, `entities.list`, `entities.byId`, `entityTypes.list`, `knowledge.graph`, `knowledge.list`, `knowledge.byId`), matches plan interfaces doc verbatim, no git diff on this file |
| 9 | Phase-33 commits touch only `apps/web/**`/`packages/**`/`.planning/**` docs; zero new npm deps | VERIFIED | All 8 commits' `git show --name-only` enumerated; grep for `package.json\|package-lock\|apps/email-listener\|migrations\|\.sql$` across all 8 → zero matches |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/app/chat/_canvas/use-data-bindings.ts` | useDataBindings hook + STALE_TIME_MS | VERIFIED | Exists, substantive (324 lines), exports match, wired into genui-panel-node.tsx |
| `apps/web/src/app/chat/_canvas/__tests__/use-data-bindings.test.tsx` | 5-procedure/staleTime/degrade coverage | VERIFIED | Exists, 12 tests, all pass |
| `apps/web/src/app/chat/_canvas/genui-panel-node.tsx` | GenuiPanelNodeBody merges live data | VERIFIED | Modified, wired, tested |
| `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` | promoteEdge invalidation | VERIFIED | Modified, `promoteEdge` extracted+exported, wired into `handlePromote` |
| `apps/web/src/app/knowledge/_components/__tests__/knowledge-graph-invalidate.test.tsx` | invalidate-on-success, not-on-failure | VERIFIED | Exists, 3 tests, all pass (includes explicit `!ok` negative test) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `use-data-bindings.ts` | `genui-part-boundary.tsx` | `import { attemptRepairJson }` | WIRED | Line 47 |
| `use-data-bindings.ts` | `@nauta/genui/schema` | `DataBindingSchema`, `AllowedProcedure` | WIRED | Line 44-45 |
| `use-data-bindings.ts` | `~/trpc/react` | `api.useQueries` (cast to `useBindingQueries`) | WIRED | Line 48, 106-108 |
| `genui-panel-node.tsx` | `use-data-bindings.ts` | `import { useDataBindings }` | WIRED | Line 57, called line 86 |
| `genui-panel-node.tsx` | `genui-part-boundary.tsx` | `data={{...panelData, ...liveBindingData}}` | WIRED | Line 149, GenuiPartBoundary itself untouched |
| `knowledge-graph.tsx` | `~/trpc/react` | `api.useUtils()` → `promoteEdge(edgeId, importerId, utils)` | WIRED | Line 418 (existing), 561 (call site) |

### Behavioral Spot-Checks / Test Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| use-data-bindings hook tests | `npx vitest run .../use-data-bindings.test.tsx` | 12/12 passed | PASS |
| panel-data-flow integration tests | `npx vitest run .../panel-data-flow.test.tsx` | 3/3 passed | PASS |
| knowledge-graph-invalidate tests | `npx vitest run .../knowledge-graph-invalidate.test.tsx` | 3/3 passed | PASS |
| SC2 locked-file diff | `git diff --stat -- <3 locked files>` (repo root) | empty output | PASS |
| Commit scope audit | `git show --name-only` on all 8 commits, grepped for out-of-scope paths | zero matches | PASS |
| No new npm deps | grep for package.json/package-lock.json across 8 commits' file lists | zero matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BIND-01 | 33-01, 33-02 | Live data via compile-time allowlist switch, render-context params | SATISFIED | `use-data-bindings.ts` switch + `genui-panel-node.tsx` wiring |
| BIND-02 | 33-01, 33-02 | staleTime tiers + event-driven invalidation, no bespoke polling | SATISFIED | `STALE_TIME_MS` + `promoteEdge` invalidation, zero `setInterval` matches |

No orphaned requirements — REQUIREMENTS.md maps only BIND-01/BIND-02 to Phase 33, both claimed by the plans.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the 4 modified/created source files (`use-data-bindings.ts`, `genui-panel-node.tsx`, `knowledge-graph.tsx`, plus test files). The one `as unknown as` cast in `use-data-bindings.ts` is documented in-file with reasoning and scoped to a single declaration site — not a stub, a documented generic-variance workaround verified safe by 12 passing tests.

### Human Verification Required

None. All 5 ROADMAP success criteria and both requirements are verifiable via static code inspection, git diff, and automated test execution — no visual/real-time/external-service behavior requiring human judgment in this phase's scope.

### Gaps Summary

No gaps. All 9 observable truths verified, all artifacts exist/substantive/wired, all key links wired, all 18 relevant tests pass, SC2 locked-file diff is empty, SC5 ALLOWED_PROCEDURES unchanged, all 8 phase-33 commits stay within `apps/web/**`/`packages/**`/`.planning/**` docs scope with zero new npm dependencies. Phase goal achieved.

---

_Verified: 2026-07-08T02:00:00Z_
_Verifier: Claude (gsd-verifier)_
