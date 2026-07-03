---
phase: 13
plan: "04"
subsystem: genui-web-boundary
tags: [tRPC, genui, web-boundary, action-registry, security, tdd]
dependency_graph:
  requires: [13-03-SUMMARY.md, 13-01-SUMMARY.md, 12-03-SUMMARY.md]
  provides: [genui.generate-procedure, buildActionRegistry, SpecRenderer-actions-prop]
  affects: [packages/api-client, packages/genui/renderer]
tech_stack:
  added: []
  patterns: [web-boundary-revalidation, discriminated-union-fallback, action-registry-pattern, tdd-red-green]
key_files:
  created:
    - packages/api-client/src/router/genui/generate.ts
    - packages/api-client/src/router/genui/index.ts
    - packages/api-client/src/router/genui/__tests__/generate.test.ts
    - packages/genui/src/renderer/action-handlers.ts
    - packages/genui/src/renderer/__tests__/action-handlers.test.ts
  modified:
    - packages/api-client/src/root.ts
    - packages/api-client/tsconfig.json
    - packages/api-client/vitest.config.ts
    - packages/genui/src/renderer/spec-renderer.tsx
    - packages/genui/src/renderer/index.ts
decisions:
  - "Web boundary re-validation: SpecRootSchema.safeParse at tRPC layer (D-08); NEVER trust model output blindly"
  - "SAFE_FALLBACK_SPEC returned on any Zod parse failure, non-2xx, or network error — detail logged server-side only"
  - "mutate intentionally absent from ActionRegistry (SEAM-02); ALLOWED_MUTATIONS=[] keeps the branch inert in v1.1"
  - "navigate runtime re-check (D-15) is independent from Zod schema check — defense-in-depth at handler layer"
  - "api-client tsconfig needs jsx:preserve + dom.iterable because workspace symlink to genui pulls React/JSX transitively"
  - "@nauta/genui/schema sub-path import preferred over root to avoid pulling renderer/catalog in server-only tests"
metrics:
  duration_minutes: 90
  completed_date: "2026-06-27"
  tasks_completed: 2
  files_changed: 10
  tests_added: 12
---

# Phase 13 Plan 04: Web Proxy + ActionRegistry Summary

**One-liner:** genui.generate tRPC procedure (D-08 SpecRoot re-validation + SAFE_FALLBACK_SPEC) and buildActionRegistry (navigate/setState/query-refresh, mutate SEAM-02 noop) via TDD RED/GREEN pairs.

## What Was Built

### Task 1 — genui.generate tRPC Procedure (RED `3109eae` / GREEN `01c5bb3`)

`packages/api-client/src/router/genui/generate.ts` — `publicProcedure` that:
- POSTs to `${url}/v1/genui/generate` with `X-API-Key` header (server-side only via `getListenerConfig()`)
- Buffers the full FastAPI response (GEN-04 non-streaming)
- Extracts `body.spec` from the `ApiResponse` envelope
- Re-validates with `SpecRootSchema.safeParse` at the web boundary (D-08)
- Returns `{ outcome: "ok", spec }` on success
- Returns `{ outcome: "fallback", spec: SAFE_FALLBACK_SPEC, reason }` on any failure (network error, non-2xx, JSON parse error, Zod re-validation failure)
- Logs full error server-side only — never leaks raw Bedrock error detail to caller (T-13-19)

Supporting files:
- `src/router/genui/index.ts` — `genuiRouter` via `createTRPCRouter`
- `src/root.ts` — `genui: genuiRouter` added to `appRouter`

**Tests (7 passing):**
- Valid spec → `outcome: "ok"`, validated spec returned, not SAFE_FALLBACK_SPEC
- POST issues to correct URL with X-API-Key + Content-Type headers
- Unregistered node type → `outcome: "fallback"`, raw invalid spec absent from response
- Non-relative navigate href → `outcome: "fallback"`, evil.com absent from response
- `javascript:` href → `outcome: "fallback"`, "javascript:" absent from response
- Non-2xx FastAPI → `outcome: "fallback"`, raw error detail absent from response
- Missing env vars → throws (getListenerConfig guard)

### Task 2 — buildActionRegistry + SpecRenderer actions prop (RED `c0d8e90` / GREEN `ef334d2`)

`packages/genui/src/renderer/action-handlers.ts` — `buildActionRegistry(deps)` that:
- Accepts `{ router: RouterLike, trpcUtils: TrpcUtilsLike, declaredState: DeclaredStateResult }`
- Returns a new frozen `ActionRegistry` object (CLAUDE.md immutability)
- **navigate handler**: D-15 runtime re-check (`isSafeRelativeHref`) before `router.push(href)` — absolute/protocol-relative URLs are a silent noop (logged server-side)
- **setState handler**: calls `declaredState.dispatch(key, value)` from `DeclaredStateResult`
- **query-refresh handler**: calls `void trpcUtils.invalidate()` (fire-and-forget)
- **mutate**: intentionally absent — SEAM-02, ALLOWED_MUTATIONS=[], no handler registered; button onClick for mutate actions resolve to the `_noop` default in `useActionRegistry`

`packages/genui/src/renderer/spec-renderer.tsx` — added optional `actions?: ActionRegistry` prop; when provided wraps tree in `<ActionRegistryContext.Provider value={actions}>`.

`packages/genui/src/renderer/index.ts` — exports `buildActionRegistry`, `ActionRegistryDeps`, `RouterLike`, `TrpcUtilsLike`.

**Tests (5 passing):**
- navigate with `/emails` → `router.push("/emails")` called
- navigate with `https://evil.com/phish` → noop, `router.push` NOT called (D-15)
- setState `showPanel=true` → `dispatch("showPanel", true)` called
- `registry["mutate"]` does not exist (SEAM-02)
- query-refresh → `trpcUtils.invalidate()` called

## Security Verification

- **D-08 (web boundary re-validation):** `SpecRootSchema.safeParse` runs at tRPC layer on every response; raw model output never returned on failure
- **T-13-19 (no detail leak):** FastAPI error body logged server-side; caller receives friendly string only
- **D-15 (runtime navigate re-check):** `isSafeRelativeHref` runs in handler independently of Zod schema check
- **SEAM-02 (mutate noop):** `buildActionRegistry` explicitly does not register a "mutate" key; `Object.prototype.hasOwnProperty.call(registry, "mutate") === false` verified by test
- **D-24 (no-eval gate):** grep over `packages/genui/src` — all matches are comments/documentation; zero functional `eval`/`new Function`/`dangerouslySetInnerHTML` on generation→render path — CLEAN

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript TS6059: File not under rootDir**
- **Found during:** Task 1 TypeScript check
- **Issue:** api-client tsconfig lacked `jsx: preserve` and `dom.iterable`; when the workspace symlink to genui was followed, TypeScript found JSX files in `registry/component-registry.ts` (via `schema/allowlists.ts` import chain) and rejected them
- **Fix:** Added `"jsx": "preserve"` and `"dom.iterable"` to api-client `tsconfig.json` lib array
- **Files modified:** `packages/api-client/tsconfig.json`
- **Commit:** `01c5bb3`

**2. [Rule 1 - Bug] Vitest vi.fn() generic type parameter syntax**
- **Found during:** Task 2 TypeScript check after GREEN implementation
- **Issue:** `vi.fn<[string], void>()` was the old vitest API; Vitest 2.x uses `vi.fn()` with cast or type annotation at the call-site. TypeScript reported TS2558 (wrong number of type arguments) and TS2322 (Mock assignability to function type)
- **Fix:** Rewrote stub factories to use `vi.fn()` with `as unknown as` casts to the interface types, extracting raw spy references for assertion
- **Files modified:** `packages/genui/src/renderer/__tests__/action-handlers.test.ts`
- **Commit:** `ef334d2`

## Known Stubs

None — all handlers are fully wired. The mutate branch is intentionally absent (SEAM-02), not a stub: the schema branch exists in `action-schema.ts` but `buildActionRegistry` omits it by design. Phase v1.2+ wires it when `ALLOWED_MUTATIONS` is populated.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covered. The `genui.generate` procedure is a server-side tRPC query (no new public route); `buildActionRegistry` is a pure client-side binding with no network access.

## Self-Check: PASSED

Files verified:
- `packages/api-client/src/router/genui/generate.ts` — FOUND
- `packages/api-client/src/router/genui/index.ts` — FOUND
- `packages/api-client/src/router/genui/__tests__/generate.test.ts` — FOUND
- `packages/genui/src/renderer/action-handlers.ts` — FOUND
- `packages/genui/src/renderer/__tests__/action-handlers.test.ts` — FOUND

Commits verified:
- `3109eae` — test(13-04): add failing tests for genui.generate tRPC procedure (RED Task 1)
- `01c5bb3` — feat(13-04): genui.generate tRPC procedure with Zod re-validation + fallback (GREEN Task 1)
- `c0d8e90` — test(13-04): add failing tests for buildActionRegistry (RED Task 2)
- `ef334d2` — feat(13-04): ActionRegistry binding layer — navigate/setState/query-refresh wired, mutate empty seam (GREEN Task 2)

Test counts:
- api-client: 109/109 PASSED
- genui: 153/153 PASSED
- tsc (api-client): clean
- tsc (genui): clean
- D-24 no-eval grep gate: clean
