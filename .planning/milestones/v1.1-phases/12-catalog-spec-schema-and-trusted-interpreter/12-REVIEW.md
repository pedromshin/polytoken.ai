---
phase: 12-catalog-spec-schema-and-trusted-interpreter
reviewed: 2026-06-27T03:53:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - packages/genui/src/schema/spec-schema.ts
  - packages/genui/src/catalog/manifest.ts
  - packages/genui/src/renderer/render-node.tsx
  - packages/genui/src/renderer/use-declared-state.ts
  - packages/genui/src/renderer/error-boundary.tsx
  - packages/genui/src/registry/component-registry.ts
  - packages/genui/src/demo/showcase-spec.ts
  - packages/genui/src/index.ts
  - apps/web/src/app/studio/page.tsx
  - apps/web/src/app/studio/preview/page.tsx
  - apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
  - apps/web/src/app/studio/preview/_components/preview-toolbar.tsx
  - apps/web/src/app/studio/preview/_components/preview-viewport.tsx
findings:
  critical: 3
  warning: 2
  info: 1
  total: 6
status: fixed
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-27T03:53:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 12 introduces the GenUI catalog, spec schema, trusted renderer, and studio preview surface. The threat-model mitigations for GR-01/SPEC-02 are real and correctly implemented: no `eval`, no `dangerouslySetInnerHTML`, no `new Function` anywhere in the renderer path. The prototype-pollution guard (`FORBIDDEN_KEYS`) is present and effective. The allowlist dispatch via `RegisteredTypeSchema = z.enum(REGISTERED_TYPES)` correctly blocks unknown component types. Per-node error isolation via `NodeErrorBoundary` prevents a single broken node from crashing the whole surface.

However, three spec-schema-to-propsSchema mismatches were confirmed via runtime verification. These are not theoretical: every `button`, `separator`, and `key-value-list` node in the system will silently render as `NodeErrorFallback` at runtime because `propsSchema.safeParse` rejects the props that `SpecRootSchema.safeParse` just accepted. The showcase spec itself documents the workaround (omitting `aria-label`) but that workaround is precisely what causes the render failure. The system ships broken for three of its catalogued component types.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: ButtonNodeSchema missing `"aria-label"` causes every button to render as error fallback

**File:** `packages/genui/src/schema/spec-schema.ts:81-92`

**Issue:** `ButtonNodeSchema` is defined as `.strict()` and does not include an `"aria-label"` field. The manifest's button `propsSchema` (in `packages/genui/src/catalog/manifest.ts`) declares `"aria-label": z.string()` as a **required, non-optional** field. The render pipeline in `render-node.tsx` extracts raw props from the validated spec node and runs them through `propsSchema.safeParse`. Because `ButtonNodeSchema` is `.strict()`, a spec author cannot include `"aria-label"` (it would be rejected at spec parse time). Because the propsSchema requires `"aria-label"`, any spec-valid button node will fail propsSchema validation and render as `NodeErrorFallback`. This was confirmed with runtime Node.js verification:

```
buttonPropsSchema.safeParse({ label: "Click", variant: "default", action: { type: "emit", event: "click" } })
→ success: false, errors: ["Required"] at path ["aria-label"]
```

The `showcase-spec.ts` explicitly acknowledges this at line 16: `// Removed: aria-label (not in StackNodeSchema/GridNodeSchema/ButtonNodeSchema)`. That comment proves the bug was known but the fix was deferred incorrectly — the comment documents the workaround (omitting `aria-label`) but the workaround causes the render failure.

**Fix — Option A (preferred):** Add the field to `ButtonNodeSchema` so the spec layer and props layer agree:
```typescript
// packages/genui/src/schema/spec-schema.ts
export const ButtonNodeSchema = z.object({
  type: z.literal("button"),
  label: z.string().min(1).max(200),
  "aria-label": z.string().min(1).max(200).optional(), // add: optional so existing specs aren't broken
  variant: z.enum(["default", "destructive", "outline", "ghost"]).optional(),
  size: z.enum(["default", "sm", "lg"]).optional(),
  action: ButtonActionSchema,
  disabled: z.boolean().optional(),
}).strict();
```

**Fix — Option B:** Change the manifest propsSchema to make `"aria-label"` optional:
```typescript
// packages/genui/src/catalog/manifest.ts — button propsSchema
"aria-label": z.string().optional(),
```

---

### CR-02: SeparatorNodeSchema missing `"aria-hidden"` causes every separator to render as error fallback

**File:** `packages/genui/src/schema/spec-schema.ts:94-99`

**Issue:** `SeparatorNodeSchema` has no `"aria-hidden"` field. The manifest separator `propsSchema` declares `"aria-hidden": z.literal(true)` as a required, non-optional field. Every spec-valid separator node will fail `propsSchema.safeParse` and render as `NodeErrorFallback`. Confirmed via runtime verification:

```
separatorPropsSchema.safeParse({ orientation: "horizontal" })
→ success: false, errors: ["Invalid literal value, expected true"] at path ["aria-hidden"]
```

**Fix — Option A (preferred):** Inject the locked value in the render pipeline before propsSchema validation, since `aria-hidden` is an implementation detail not a spec concept:
```typescript
// packages/genui/src/renderer/render-node.tsx — in the SeparatorNode render path
// Before propsSchema.safeParse, inject the required aria-hidden value:
const propsToValidate = node.type === "separator"
  ? { ...extractedProps, "aria-hidden": true as const }
  : extractedProps;
const propsResult = propsSchema.safeParse(propsToValidate);
```

**Fix — Option B:** Add `"aria-hidden": z.literal(true)` to `SeparatorNodeSchema` so spec authors must include it:
```typescript
export const SeparatorNodeSchema = z.object({
  type: z.literal("separator"),
  "aria-hidden": z.literal(true),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
}).strict();
```

---

### CR-03: KeyValueListNodeSchema uses `valueRef` but manifest propsSchema expects `value`; manifest also requires `label` not present in spec schema

**File:** `packages/genui/src/schema/spec-schema.ts:113-126` and `packages/genui/src/catalog/manifest.ts:460-482`

**Issue:** `KeyValueListNodeSchema` items are typed as `{ key: z.string(), valueRef: z.string() }` — the `valueRef` field signals dataRef resolution at render time. However, `render-node.tsx` does NOT resolve `valueRef` in items before running `propsSchema.safeParse`; it passes raw spec props to the propsSchema. The manifest propsSchema items are typed as `{ key: z.string(), value: z.string() }` with `.strict()`. The result is a three-way failure: (1) `valueRef` is rejected as an unrecognized key by `.strict()`, (2) `value` is missing so it fails Required, (3) the top-level manifest propsSchema requires `label: z.string()` which has no counterpart in `KeyValueListNodeSchema`.

Confirmed via runtime:
```
kvPropsSchema.safeParse({ items: [{ key: "Status", valueRef: "state.status" }] })
→ success: false
  errors:
    - "Required" at path ["label"]
    - "Required" at path ["items", 0, "value"]
    - "Unrecognized key(s) in object: 'valueRef'" at path ["items", 0]
```

This is a data-architecture conflict: the spec schema treats item values as dynamic dataRefs, but the propsSchema treats them as static strings. Neither side handles the other's format.

**Fix:** Decide on one model and make both schemas agree. The cleanest fix given the current renderer is to drop `valueRef` from items and use static strings at the spec layer (dataRef resolution for individual list-item values is not yet implemented in the renderer anyway):

```typescript
// packages/genui/src/schema/spec-schema.ts
export const KeyValueListNodeSchema = z.object({
  type: z.literal("key-value-list"),
  label: z.string().min(1).max(200),        // add: required to match propsSchema
  items: z.array(
    z.object({
      key: z.string().min(1).max(200),
      value: z.string().max(1000),           // rename: valueRef -> value
    }).strict()
  ).min(1).max(50),
}).strict();
```

Then update `showcase-spec.ts` to use `value` instead of `valueRef` and add `label`.

---

## Warnings

### WR-01: `React` namespace used as type without import in spec-renderer-island.tsx

**File:** `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx:45`

**Issue:** The function return type is annotated as `React.ReactElement | null` but there is no `import React from "react"` at the top of the file. Next.js's automatic JSX transform injects the JSX runtime without requiring `React` in scope for JSX expressions, but it does NOT inject the `React` namespace for use as a type reference. TypeScript resolves this only because the JSX transform happens to satisfy the compiler in certain tsconfig setups, but it is technically unsound and will fail if `isolatedModules` tightening or a tsconfig change removes the implicit reference.

**Fix:**
```typescript
// apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx — line 1
import React from "react";
```

Or change the return type annotation to use the explicit React import form from `react` types:
```typescript
import type { ReactElement } from "react";
// ...
export function SpecRendererIsland(...): ReactElement | null {
```

---

### WR-02: `NodeErrorBoundary` silently swallows render errors — no logging

**File:** `packages/genui/src/renderer/error-boundary.tsx:80-83`

**Issue:** `getDerivedStateFromError()` sets `{ hasError: true, nodeType }` but there is no `componentDidCatch` implementation. In production this means every broken spec node (including the ones broken by CR-01/CR-02/CR-03) produces zero log output. There is no way to detect at scale how many nodes are failing to render. Per project conventions (CLAUDE.md: "Log detailed errors server-side; show friendly messages client-side"), errors must be logged server-side even when showing a friendly fallback UI client-side.

`getDerivedStateFromError` is intentionally static and cannot perform side effects. The logging hook is `componentDidCatch`, which is the standard React lifecycle for this:

**Fix:**
```typescript
// packages/genui/src/renderer/error-boundary.tsx
componentDidCatch(error: Error, info: React.ErrorInfo): void {
  // Log detailed context server-side (or to monitoring sink)
  console.error(
    "[NodeErrorBoundary] node render failed",
    {
      nodeType: this.props.nodeType,
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    }
  );
}
```

In production, replace `console.error` with the application's monitoring integration (e.g., Sentry, Datadog).

---

## Info

### IN-01: `countNodes`/`specDepth` recursive walkers lack stack-depth guard in `.refine()`

**File:** `packages/genui/src/schema/spec-schema.ts:360-401`

**Issue:** `countNodes` and `specDepth` are recursive walkers called from `SpecRootSchema.refine()`. They are designed to enforce the `MAX_SPEC_NODES=200` and `MAX_SPEC_DEPTH=8` DoS bounds. However, a pathologically deep JSON payload reaches these walkers only AFTER Zod's own recursive `z.lazy()` parsing, which would also overflow first. More importantly, if a deeply nested input bypasses Zod's recursion limit (e.g., via custom deserializers), `countNodes`/`specDepth` themselves have no early-exit guard. A `RangeError: Maximum call stack size exceeded` inside `.refine()` propagates as an unhandled exception from `safeParse` rather than a structured Zod validation error, which breaks the caller's error-handling assumptions.

**Fix:** Add a depth parameter with a hard cap as a safety net:
```typescript
function countNodes(node: unknown, budget: number = MAX_SPEC_NODES + 1): number {
  if (budget <= 0) return MAX_SPEC_NODES + 1; // early exit: over budget
  // ... existing logic, pass reduced budget to recursive calls
}

function specDepth(node: unknown, limit: number = MAX_SPEC_DEPTH + 5): number {
  if (limit <= 0) return MAX_SPEC_DEPTH + 1; // early exit: over limit
  // ... existing logic, pass (limit - 1) to recursive calls
}
```

This ensures that even if called with pathological input, the walkers return a value that causes `.refine()` to emit a structured validation error rather than throwing.

---

_Reviewed: 2026-06-27T03:53:00Z_
_Reviewer: Claude (gsd-code-reviewer) — adversarial depth=deep_
_Depth: deep_
