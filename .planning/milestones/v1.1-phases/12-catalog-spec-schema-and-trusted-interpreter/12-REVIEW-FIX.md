---
phase: 12-catalog-spec-schema-and-trusted-interpreter
fixed_at: 2026-06-27T04:17:00Z
review_path: .planning/phases/12-catalog-spec-schema-and-trusted-interpreter/12-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-06-27T04:17:00Z
**Source review:** `.planning/phases/12-catalog-spec-schema-and-trusted-interpreter/12-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, CR-02, CR-03, WR-01, WR-02, IN-01)
- Fixed: 6
- Skipped: 0

All fixes verified: typecheck clean (`@nauta/genui` + `@nauta/web`), web:build green (`/studio/preview` 3.92 kB), no-eval grep zero, 91 tests passed (5 pre-existing jsdom-environment failures unrelated to these changes).

---

## Fixed Issues

### CR-01: ButtonNodeSchema missing required `aria-label` field

**Files modified:** `packages/genui/src/schema/spec-schema.ts`, `packages/genui/src/demo/showcase-spec.ts`
**Commits:** `ca9020a` (schema), `d000cd3` (showcase)
**Applied fix:** Added `"aria-label": z.string()` as a required field to `ButtonNodeSchema` in spec-schema.ts (matching the manifest `propsSchema` which had `aria-label` required). Updated SHOWCASE_SPEC button node to include `"aria-label": "Toggle the expanded section"`.

---

### CR-02: SeparatorNodeSchema missing required `aria-hidden` field

**Files modified:** `packages/genui/src/schema/spec-schema.ts`, `packages/genui/src/demo/showcase-spec.ts`
**Commits:** `ca9020a` (schema), `d000cd3` (showcase)
**Applied fix:** Added `"aria-hidden": z.literal(true)` as a required field to `SeparatorNodeSchema` in spec-schema.ts (locked to `true` — decorative separator is always hidden from screen readers). Updated SHOWCASE_SPEC separator node to include `"aria-hidden": true`.

---

### CR-03: KeyValueListNodeSchema missing `label` field; uses `valueRef` instead of `value` in items

**Files modified:** `packages/genui/src/schema/spec-schema.ts`, `packages/genui/src/demo/showcase-spec.ts`, `packages/genui/src/__tests__/demo-specs.test.ts`
**Commits:** `ca9020a` (schema), `d000cd3` (showcase + test)
**Applied fix:**
- Added `label: z.string()` as required field to `KeyValueListNodeSchema` (a11y aria-label for the `<dl>` element)
- Changed item field from `valueRef: z.string()` to `value: z.string()` (static value per manifest propsSchema)
- Updated SHOWCASE_SPEC key-value-list to include `label: "Showcase metadata"` and static `value` strings instead of `valueRef`
- Removed dead `valueRef` branch from `collectDataRefs` walker in `demo-specs.test.ts`

---

### WR-01: Missing React import in spec-renderer-island.tsx

**Files modified:** `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx`
**Commit:** `bb4eb3e`
**Applied fix:** Added `import React from "react";` at line 22. Required because the file uses JSX (`return <SpecRendererDynamic ... />`) and the project's tsconfig targets `"jsx": "preserve"` without the new JSX transform's automatic React import for client components in Next.js 15 app-dir.

---

### WR-02: NodeErrorBoundary swallows render errors silently (no componentDidCatch)

**Files modified:** `packages/genui/src/renderer/error-boundary.tsx`
**Commit:** `3eed419`
**Applied fix:** Added `componentDidCatch(error: Error, info: React.ErrorInfo): void` method to `NodeErrorBoundary`. Logs `nodeType`, `error.message`, `error.stack`, and `info.componentStack` to `console.error`. Comment notes this is replaceable with Sentry/Datadog in production. Satisfies CLAUDE.md guardrail: "Log detailed errors server-side; show friendly messages client-side."

---

### IN-01: countNodes and specDepth walkers have no depth guard — can throw RangeError

**Files modified:** `packages/genui/src/schema/spec-schema.ts`
**Commit:** `ca9020a`
**Applied fix:**
- `countNodes(node, budget = MAX_SPEC_NODES + 1)`: if `budget <= 0`, returns `MAX_SPEC_NODES + 1` immediately (over-budget signal that triggers the `.refine()` rejection path cleanly)
- `specDepth(node, limit = MAX_SPEC_DEPTH + 5)`: if `limit <= 0`, returns `MAX_SPEC_DEPTH + 1` immediately
- Both walkers pass `budget - count` / `limit - 1` down each recursive call to bound total stack depth

---

### Block 7 (D-17): Round-trip regression tests for all 10 catalog types

**Files modified:** `packages/genui/src/__tests__/render-node.test.tsx`
**Commit:** `452f74a`
**Applied fix:** Added 11 new tests in describe block "Round-trip regression: all 10 catalog types render without NodeErrorFallback (D-17 / CR-01 / CR-02 / CR-03)":
1. `SHOWCASE_SPEC renders without any NodeErrorFallback ([!] marker)` — full spec round-trip
2. One minimal-props test per catalog type: text, badge, button, separator, key-value-list, alert, card, table, stack, grid

Key design decision: assertions use `expect(html).not.toContain("[!]")` (the unique NodeErrorFallback copy prefix), NOT `role="alert"`. The catalog `alert` component legitimately renders `<div role="alert">` as an ARIA landmark — using that attribute as the error marker causes false positives. The alert test additionally asserts `expect(html).toContain('role="alert"')` to verify the real Alert component rendered.

---

## Verification Results

| Check | Result |
|-------|--------|
| `@nauta/genui` typecheck | PASS (no errors) |
| `@nauta/web` typecheck | PASS (no errors) |
| `web:build` (`/studio/preview`) | PASS (3.92 kB, 8 static pages) |
| no-eval grep (renderer/registry/catalog) | PASS (zero real usages) |
| genui tests (91 passing) | PASS (5 pre-existing jsdom failures unchanged) |
| Block 7 tests (11 new) | ALL PASS |

Pre-existing test failures (unrelated, not introduced by these fixes):
- `useDeclaredState > toggle mutation: flips boolean value` — needs jsdom environment
- `useDeclaredState > set mutation: sets value from action value` — needs jsdom environment
- `useDeclaredState > reset mutation: restores initial value` — needs jsdom environment
- `useDeclaredState > increment mutation: numeric +1` — needs jsdom environment
- `useDeclaredState > decrement mutation: numeric -1` — needs jsdom environment

These 5 tests were failing before this fix run (confirmed by git stash + retest).

---

_Fixed: 2026-06-27T04:17:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
