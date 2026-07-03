---
phase: "12"
plan: "03"
subsystem: "genui/renderer"
tags: ["renderer", "trusted-interpreter", "security", "react", "tdd"]
dependency_graph:
  requires:
    - "12-01-SUMMARY.md"  # SpecRoot schema + StateDeclaration types
    - "12-02-SUMMARY.md"  # COMPONENT_REGISTRY + NAUTA_CATALOG manifest
  provides:
    - "renderNode recursive interpreter (SpecNode → React.Element)"
    - "resolveDataRef dotted-path resolver (no eval, prototype-pollution guard)"
    - "NodeErrorBoundary per-node error isolation (class component)"
    - "useDeclaredState useReducer (5-mutation enum)"
    - "SpecRenderer entry component with ActionRegistry seam"
    - "ActionRegistryContext (empty Phase 12 seam — Phase 14 fills)"
    - "src/index.ts package root barrel"
  affects:
    - "packages/genui — renderer export group now live"
tech_stack:
  added: []
  patterns:
    - "React.createElement only on render path — zero eval/Function/dangerouslySetInnerHTML (GR-01)"
    - "getDerivedStateFromError class component for per-node error isolation (D-14)"
    - "useReducer with 5-mutation enum (toggle/set/reset/increment/decrement, D-11)"
    - "Dotted-path walk via .split('.').reduce() — no eval (D-12)"
    - "Prototype-pollution guard: __proto__/constructor/prototype keys bail to undefined"
    - "safeParse-only render path — never .parse() during render (SPEC-03)"
    - "Structural-position keys: root, root-0, root-slot-header (D-15)"
    - "Named slots + positional children both supported (D-16)"
    - "Empty ActionRegistryContext seam wired as React.createContext<ActionRegistry>({}) (SEAM-02)"
key_files:
  created:
    - "packages/genui/src/renderer/error-boundary.tsx"
    - "packages/genui/src/renderer/use-declared-state.ts"
    - "packages/genui/src/renderer/render-node.tsx"
    - "packages/genui/src/renderer/spec-renderer.tsx"
    - "packages/genui/src/renderer/index.ts"
    - "packages/genui/src/index.ts"
    - "packages/genui/src/__tests__/render-node.test.tsx"
  modified: []
decisions:
  - "D-14: NodeErrorBoundary is a React class component — getDerivedStateFromError has no hooks equivalent"
  - "D-11: useDeclaredState uses useReducer, all reducer branches return new objects via spread"
  - "D-12: resolveDataRef is pure dotted-path walk with forbidden-key set guard (no eval)"
  - "D-15: Structural-position keys only — never read node.id/node.key from spec"
  - "D-16: Named slots (card.header/footer) and positional children[] both supported"
  - "SEAM-02: ActionRegistryContext default is {} — button.action is no-op in Phase 12"
  - "D-20: spec-renderer.tsx has 'use client' on line 1 (client island boundary)"
  - "GR-01: Security grep gate — zero functional eval/Function/dangerouslySetInnerHTML"
metrics:
  duration: "~11 minutes (05:54 → 06:05 UTC)"
  completed: "2026-06-27T06:05:37Z"
  tasks_completed: 3
  files_created: 7
  tests_added: 30
  tests_total: 60
---

# Phase 12 Plan 03: Trusted Interpreter Summary

Recursive `renderNode` dispatcher with no-eval guarantee, per-node `NodeErrorBoundary`, `useDeclaredState` useReducer with 5-mutation enum, safe `resolveDataRef` dotted-path resolver, `SpecRenderer` entry component, and empty `ActionRegistryContext` seam — all verified by 30 new tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for renderer, error boundary, declared state | 27a10d7 | `src/__tests__/render-node.test.tsx` |
| 2 (GREEN) | NodeErrorBoundary + useDeclaredState + renderNode + SpecRenderer + ActionRegistry seam | 76f13bd | `renderer/error-boundary.tsx`, `renderer/use-declared-state.ts`, `renderer/render-node.tsx`, `renderer/spec-renderer.tsx`, `renderer/index.ts`, `src/index.ts` |

## Implementation Details

### error-boundary.tsx
- `NodeErrorBoundary`: React class component using `getDerivedStateFromError()` — mandatory because hooks cannot implement this lifecycle (D-14)
- `NodeErrorFallback`: Inline fallback div with `role="alert"` — does NOT import `@nauta/ui/alert` to avoid circular dependency on the error path (UI-SPEC §5)
- Copy format: `[!] "${nodeType}" node — ${reason}`

### use-declared-state.ts
- `useDeclaredState(declarations)` hook materializes `SpecRoot.state[]` into a `useReducer` store
- 5-mutation enum: `toggle` (bool NOT), `set` (assign value), `reset` (restore initial), `increment` (+1), `decrement` (-1)
- All reducer branches return new objects via spread `{ ...s, [key]: next }` — immutable (CLAUDE.md)
- Unknown action name returns same state reference (no allocation, O(1) no-op)

### render-node.tsx
- `renderNode(node, ctx, keyPrefix)` dispatches SpecNode → React.createElement
- Interpreter primitives handled BEFORE registry dispatch: `conditional` (truthy/falsy/eq/neq/gt/lt) and `list` (emptyState fallback for empty arrays)
- `resolveDataRef(ref, ctx)`: pure dotted-path walk with prototype-pollution guard (`__proto__`, `constructor`, `prototype` → return undefined)
- `evaluateCondition(resolved, operator, value)`: 6-operator switch — no eval
- safeParse-only render path: `entry.propsSchema.safeParse(props)` → `NodeErrorFallback` on failure (SPEC-03)
- `NodeErrorBoundary` wraps every registry dispatch for per-node error isolation (SPEC-03)
- Structural-position keys: `"root"`, `"root-0"`, `"root-slot-header"`, `"root-0-then"` (D-15)
- Named slots (card.header/footer) passed as separate `slotChildren` props (D-16)
- Positional children[] rendered and passed as React children (D-16)

### spec-renderer.tsx
- `"use client"` on line 1 — client island boundary (D-20)
- `ActionRegistryContext = React.createContext<ActionRegistry>({})` — empty default (SEAM-02)
- `useActionRegistry(actionId?)` — returns registered handler or `_noop` (Phase 14 fills)
- `SpecRenderer({ spec, registry, data })` — calls `useDeclaredState`, builds `RenderContext`, calls `renderNode`

### src/index.ts
- Package root barrel re-exporting catalog, schema, registry, renderer

## Security Grep Gate (GR-01 / SPEC-02)

Zero functional matches:
```
grep -rnE "eval\(|new Function\(|dangerouslySetInnerHTML\s*:" \
  packages/genui/src/renderer/ \
  packages/genui/src/registry/ \
  packages/genui/src/catalog/
# → exit code 1 (no matches)
```

Comments mentioning these terms (documentation) did appear in the broader grep; zero executable uses exist.

## Test Results

```
Test Files: 2 passed (2)
Tests:      60 passed (60)
  - manifest.test.ts: 30 tests (Waves 1+2 — unchanged, still passing)
  - render-node.test.tsx: 30 tests (Wave 3 — all new)
```

Test blocks in `render-node.test.tsx`:
1. SPEC-02 happy path (3 tests)
2. SPEC-03 error isolation (2 tests)
3. SPEC-04/05 state + conditional + list emptyState (4 tests)
4. `resolveDataRef` unit (10 tests — includes prototype-pollution guard)
5. `useDeclaredState` all 5 mutations (6 tests via react-dom/client)
6. `NodeErrorBoundary` + `NodeErrorFallback` (4 tests)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript overload error on NodeErrorBoundary createElement call**
- **Found during:** Typecheck after Task 2
- **Issue:** `ErrorBoundaryProps.children` was typed as `readonly children: React.ReactNode` (required), causing TS2769 when calling `React.createElement(NodeErrorBoundary, { key, nodeType }, componentElement)` — TypeScript's createElement overloads require `children` in the props object when it's a required prop
- **Fix:** Changed `children` to optional (`children?: React.ReactNode`) — React passes children via the third createElement argument, not the props object, so optionality is correct
- **Files modified:** `packages/genui/src/renderer/error-boundary.tsx`
- **Commit:** 76f13bd (inline with GREEN commit)

**2. [Rule 1 - Bug] Test assertion: renderToStaticMarkup HTML-encodes quotes**
- **Found during:** First test run after Task 2
- **Issue:** `renderToStaticMarkup` encodes `"` → `&quot;` in text content. Tests asserting `'"widget" node'` in HTML output failed because the actual HTML contained `&quot;widget&quot;`
- **Fix:** Updated test assertions to expect `&quot;widget&quot;` and `&quot;card&quot;` in encoded form
- **Files modified:** `packages/genui/src/__tests__/render-node.test.tsx`
- **Commit:** 76f13bd (inline test fix before final GREEN commit)

**3. [Rule 1 - Bug] useDeclaredState test: useEffect does not run in renderToStaticMarkup**
- **Found during:** First test run after Task 2
- **Issue:** The initial state capture test used `useEffect` to capture state, but `renderToStaticMarkup` is synchronous (SSR) and never runs effects — `captured` remained `{}`
- **Fix:** Changed capture to happen synchronously during render phase instead of in `useEffect`
- **Files modified:** `packages/genui/src/__tests__/render-node.test.tsx`
- **Commit:** 76f13bd (inline test fix before final GREEN commit)

## TDD Gate Compliance

| Gate | Commit | Type |
|------|--------|------|
| RED | 27a10d7 | `test(12-03): add failing tests for renderer, error boundary, declared state` |
| GREEN | 76f13bd | `feat(12-03): trusted interpreter — renderNode + SpecRenderer + ActionRegistry seam` |

Note: RED commit was created with partial implementation present (error-boundary.tsx, use-declared-state.ts already written). The 3 failing tests in the RED commit covered the missing render-node.tsx and spec-renderer.tsx files, satisfying the RED gate intent.

## Known Stubs

None. All connections are live:
- `renderNode` dispatches to real `COMPONENT_REGISTRY` entries
- `ActionRegistryContext` default `{}` is intentional — Phase 14 fills handlers
- `useDeclaredState` materializes real state from spec declarations

## Threat Flags

No new threat surface beyond what the plan's threat model accounts for:
- `resolveDataRef` has prototype-pollution guard (D-12)
- No network endpoints introduced
- No new auth paths
- No schema changes at trust boundaries

## Self-Check: PASSED

Files created:
- packages/genui/src/renderer/error-boundary.tsx — FOUND
- packages/genui/src/renderer/use-declared-state.ts — FOUND
- packages/genui/src/renderer/render-node.tsx — FOUND
- packages/genui/src/renderer/spec-renderer.tsx — FOUND
- packages/genui/src/renderer/index.ts — FOUND
- packages/genui/src/index.ts — FOUND
- packages/genui/src/__tests__/render-node.test.tsx — FOUND

Commits verified:
- 27a10d7 — FOUND (test RED)
- 76f13bd — FOUND (feat GREEN)

Tests: 60/60 passing
Typecheck: clean (0 errors)
Security gate: 0 functional matches
