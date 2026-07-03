---
phase: 15-studio-surface
reviewed: 2026-06-27T14:30:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - apps/email-listener/app/application/use_cases/generate_ui_spec.py
  - apps/email-listener/app/presentation/api/v1/genui.py
  - packages/api-client/src/router/genui/generate.ts
  - packages/genui/src/studio/derive-generation-state.ts
  - packages/genui/src/studio/describe-props-schema.ts
  - packages/genui/src/studio/index.ts
  - apps/web/src/app/studio/page.tsx
  - apps/web/src/app/studio/_components/studio-tabs.tsx
  - apps/web/src/app/studio/_components/spec-renderer-island.tsx
  - apps/web/src/app/studio/_components/catalog-browser-island.tsx
  - apps/web/src/app/studio/_components/generation-sandbox-island.tsx
  - apps/web/src/app/studio/_components/generation-state-chrome.tsx
  - apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx
  - apps/web/src/components/app-sidebar.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: fixed
---

# Phase 15: Code Review Report

**Reviewed:** 2026-06-27T14:30:00Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** fixed

## Summary

Phase 15 ships the Studio Surface — the /studio landing route, CatalogBrowserIsland, GenerationSandboxIsland, and GenerationStateChrome. The phase also threads the `outcome` signal from Python use-case through FastAPI and tRPC (D-05), and adds two pure helpers (`deriveGenerationState`, `describePropsSchema`) in `@nauta/genui/studio`.

**No CRITICAL/BLOCKER issues found.** The key guarantees verified clean:

- **STDO-02 (single renderer):** Confirmed. Exactly one `dynamic(ssr:false)` call exists in `apps/web/src/app/studio/_components/spec-renderer-island.tsx:38`. The `preview/_components/spec-renderer-island.tsx` is a pure re-export barrel with no second `dynamic()` call. No stub renderer anywhere.
- **D-15 (no eval):** Confirmed. `eval(`, `new Function`, and `dangerouslySetInnerHTML` appear only in comments in studio `_components/`. Zero functional matches.
- **STDO-04 (four-state derivation):** `deriveGenerationState` precedence is correct — `isPending` is checked first (highest priority), then `fallback`, then `cache_hit`, then `cold` (with `escalated` as a sub-flavor). No mis-precedence.
- **D-05 (additive only):** `outcome` is set on the cache-hit path by hardcoding `outcome="ok"` (line 144 in use_case) and on the cold path by reusing the already-computed `_determine_outcome()` variable (line 179, stored as `outcome`). The dataclass default `= "ok"` preserves backward compatibility. No new logic.
- **D-06 (no auto-fire):** `api.genui.generate.useQuery({ intent: ... }, { enabled: false })` confirmed in sandbox island. Manual `await q.refetch()` on Generate click only.
- **T-12-15 (REGISTRY_VERSION server-only):** `REGISTRY_VERSION` import appears only in `apps/web/src/app/studio/page.tsx` (server component) and `apps/web/src/app/studio/preview/page.tsx` (server component). No imports in any `"use client"` studio module.
- **Secrets:** `EMAIL_LISTENER_API_KEY` is consumed inside `getListenerConfig()` in the server-side tRPC procedure only. No `NEXT_PUBLIC_` usage in studio files.
- **SEAM-02:** `buildActionRegistry` is called with `declaredState: { state: {}, dispatch: () => undefined }` minimal seam. No `mutate` handler exposed.

Three warnings found, all quality/robustness gaps, no blockers.

---

## Warnings

### WR-01: Silent failure on first-generation network error leaves user with no feedback

**File:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx:107-119`

**Issue:** When `q.refetch()` completes with a tRPC-level error (e.g. network timeout, DNS failure — tRPC returns `{ data: undefined, error: TRPCClientError }` without throwing), the guard `if (result.data !== undefined)` does nothing: `lastResult` stays `undefined`, `showChrome` stays `false`, and the user returns to the empty state with no indication that generation failed. There is no `q.error` consumption anywhere in the component.

This is a correctness gap specifically for the **first** generation attempt: if the user clicks Generate and the backend is unreachable, the Generating spinner appears briefly and then disappears silently. Subsequent attempts after a prior successful result are partially masked by `lastResult` showing stale data with a stale chrome state.

**Fix:**
```tsx
// In generation-sandbox-island.tsx, add an error state and surface it

const [lastError, setLastError] = useState<string | undefined>(undefined);

const handleGenerate = useCallback(async (): Promise<void> => {
  const trimmed = intent.trim();
  if (trimmed.length === 0) return;
  setLastError(undefined);
  const result = await q.refetch();
  if (result.data !== undefined) {
    setLastError(undefined);
    setLastResult({ ... });
  } else if (result.error !== null && result.error !== undefined) {
    setLastError("Generation failed. Please try again.");
  }
}, [intent, q]);

// Render the error below the intent strip when showChrome is false and lastError is set:
{!showChrome && lastError !== undefined && (
  <div role="alert" className="px-4 pt-2 text-sm text-destructive">{lastError}</div>
)}
```

---

### WR-02: `specToRender` typed as `any` bypasses SpecRoot type safety at render time

**File:** `apps/web/src/app/studio/_components/generation-sandbox-island.tsx:136-137`

**Issue:** `lastResult.spec` is typed `unknown` (line 61 in the `GenerationResult` interface). The merge expression `(q.data?.spec ?? lastResult?.spec) as any` casts the result to `any` before passing it as `spec: SpecRoot` to `SpecRendererIsland`. The tRPC-validated `q.data.spec` is correct, but `lastResult.spec` (copied from `result.data.spec` in handleGenerate) carries no TS-level type guarantee at the merge site. TypeScript cannot prove the `any` is actually `SpecRoot`.

While there is no runtime risk (the data was validated at the tRPC schema boundary before being stored in `lastResult`), the cast creates a type hole that future authors can exploit: anyone who adds a code path that sets `lastResult.spec` from an unvalidated source will not get a compile-time error.

**Fix:**
```tsx
// Change GenerationResult.spec to SpecRoot:
import type { SpecRoot } from "@nauta/genui/schema";

interface GenerationResult {
  readonly outcome: "ok" | "fallback" | "escalated";
  readonly spec: SpecRoot;         // was: unknown
  readonly cacheHit: boolean;
  readonly reason?: string;
}

// In handleGenerate, assert at the assignment site (tRPC output is already SpecRoot):
setLastResult({
  outcome: result.data.outcome,
  spec: result.data.spec,           // SpecRoot — no cast needed
  cacheHit: result.data.cacheHit,
  ...(result.data.reason !== undefined && { reason: result.data.reason }),
});

// specToRender becomes typed without any cast:
const specToRender: SpecRoot | undefined = q.data?.spec ?? lastResult?.spec;
```

---

### WR-03: `console.error` used for server-side error logging in tRPC procedure — inconsistent with codebase pattern

**File:** `packages/api-client/src/router/genui/generate.ts:113,130,147,173,206`

**Issue:** The `generate.ts` tRPC procedure uses `console.error(...)` for all five error/fallback paths (network failure, non-2xx, JSON parse failure, missing `data.spec`, and SpecRootSchema re-validation failure). All other tRPC router files in `packages/api-client/src/router/` use zero `console.*` calls — they surface errors via tRPC's error propagation. The CLAUDE.md convention is "Log detailed errors server-side; show friendly messages client-side" without specifying `console` specifically, but the project-wide pattern in the api-client layer is to not use `console.*` at all.

`console.error` in a Next.js server context does reach server logs, so this is not a data-loss risk. However, it is inconsistent and makes structured log correlation impossible (no correlation ID, no trace context, no severity tagging). In a production outage, these errors will be harder to locate in aggregated logs.

**Fix:** Replace `console.error` with a structured logger. If the api-client package does not depend on a logger, at minimum standardise by using a thin wrapper or pino:
```typescript
// Option A: drop-in structured logging via pino (already in many Next.js projects)
import pino from "pino";
const logger = pino({ name: "genui.generate" });

logger.error({ err: networkErr }, "network error calling FastAPI");

// Option B: keep console.error but add consistent structure
console.error(JSON.stringify({
  procedure: "genui.generate",
  event: "network_error",
  err: String(networkErr),
  ts: new Date().toISOString(),
}));
```

---

## Info

### IN-01: Case-sensitive type match in CatalogBrowserIsland filter

**File:** `apps/web/src/app/studio/_components/catalog-browser-island.tsx:236`

**Issue:** The filter expression `e.type.includes(filter.toLowerCase())` normalises the filter string to lowercase but does NOT normalise `e.type` before comparison. All 10 NAUTA_CATALOG type keys are currently lowercase (`text`, `badge`, `button`, etc.), so in practice matching works correctly. However if a future entry uses mixed-case keys (e.g. `keyValueList`), a user searching "key-value" would fail to match because `"keyValueList".includes("key-value")` is `false`. The description branch (`e.description.toLowerCase().includes(filter.toLowerCase())`) is correctly normalised on both sides.

**Fix:**
```ts
e.type.toLowerCase().includes(filter.toLowerCase()) ||
e.description.toLowerCase().includes(filter.toLowerCase()),
```

---

### IN-02: `buildWrappedExample` uses `as unknown as SpecRoot` to bypass type checking

**File:** `apps/web/src/app/studio/_components/catalog-browser-island.tsx:54-63`

**Issue:** The function casts its return value with `as unknown as SpecRoot`. The built object is a valid `{ v: 1, root: { type, props: example, children: [] } }` structure and is accepted by the renderer at runtime because `SpecRenderer` dispatches on `root.type` without re-running `SpecRootSchema.safeParse`. However the forced cast means TypeScript will not catch future callers that construct an ill-shaped object here.

**Fix:** Either import `SpecRootSchema.parse` to validate the example at call time, or define a more precisely typed return:
```ts
// Use z.parse to validate (will throw on bad catalog examples — surfaced in tests):
import { SpecRootSchema } from "@nauta/genui/schema";

function buildWrappedExample(type: string, example: Record<string, unknown>): SpecRoot {
  return SpecRootSchema.parse({ v: 1, root: { type, props: example, children: [] } });
}
```
This would also serve as a catalog integrity gate — a malformed `example` field would be caught at render time.

---

### IN-03: `describePropsSchema` does not unwrap nested wrapper types (double-wrapped optional/default)

**File:** `packages/genui/src/studio/describe-props-schema.ts:63-78`

**Issue:** `unwrapOptional` peels only a single `ZodOptional` or `ZodDefault` layer. If a prop schema is double-wrapped (e.g. `z.string().optional().default("x")` which is `ZodDefault(ZodOptional(ZodString))`), the inner type after unwrapping is `ZodOptional`, not `ZodString`. `resolveTypeLabel` then returns `"unknown"` for that prop's type label.

All 10 current NAUTA_CATALOG entries use at most a single `.optional()` wrapper with no `.default()`, so this does not affect any currently displayed catalog entries. It would silently show wrong type labels if future catalog entries use `.default()`.

**Fix:**
```ts
const unwrapOptional = (
  schema: ZodTypeAny,
): { inner: ZodTypeAny; required: boolean } => {
  let inner = schema;
  let required = true;
  // peel all ZodOptional / ZodDefault layers
  while (true) {
    const typeName = (inner as { _def?: { typeName?: string } })._def?.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodDefault") {
      inner = (inner as { _def: { innerType: ZodTypeAny } })._def.innerType;
      required = false;
    } else {
      break;
    }
  }
  return { inner, required };
};
```

---

_Reviewed: 2026-06-27T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
