---
phase: 12-catalog-spec-schema-and-trusted-interpreter
verified: 2026-06-27T03:49:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open /studio/preview in a browser and confirm SHOWCASE_SPEC renders as real @nauta/ui components in the left pane — text, badge, button, card, table, grid, separator, alert, key-value-list, list items, and the conditional 'Click Toggle Section to expand' text are all visible."
    expected: "All 10 catalog types plus list/conditional node types render visually. The left pane shows styled components (teal badge, outline button, alert box with title, table with caption, card with footer). The JSON inspector in the right pane mirrors the spec. The version badge in the header reads 'Registry XXXXXXXX' (8-char SHA hex). No white screen, no 'Component not in registry' error visible."
    why_human: "Next.js production build passes (3.92 kB static) and SHOWCASE_SPEC validates against SpecRootSchema in CI (25 demo-spec tests pass), but actual on-screen rendering of the client island (ssr:false dynamic import) requires a browser. Static build success proves the module graph is valid, not that pixels appear."
  - test: "Click the 'Toggle Section' button and confirm the conditional node switches from 'Click Toggle Section above to expand' to 'Expanded section is now visible'."
    expected: "useDeclaredState fires a 'toggle' action, state.isExpanded flips true, the conditional node's then-branch renders the expanded text. Clicking again collapses it."
    why_human: "State materialization is implemented (useReducer with 5-mutation enum confirmed in code), and the toggle action + conditional node are present in SHOWCASE_SPEC, but the live state transition requires a browser to confirm the runtime wiring closes the loop."
  - test: "Verify the malformed node isolation visually. Temporarily substitute MALFORMED_SPEC for SHOWCASE_SPEC in page.tsx (or confirm via a separate /studio/preview-malformed route if one exists), confirm sibling text nodes render and the badge node shows '[!] \"badge\" node — prop validation failed'."
    expected: "Two valid text siblings render. The middle (badge missing label) shows the red NodeErrorFallback card with the [!] message. The page does not white-screen."
    why_human: "NodeErrorBoundary class component with getDerivedStateFromError is confirmed in code, and render-node.test.tsx has 30 tests covering the error isolation path (all pass), but the live visual of the error card in the browser context requires human confirmation."
---

# Phase 12: Catalog Spec Schema and Trusted Interpreter — Verification Report

**Phase Goal:** The vocabulary contract is established and a hardcoded spec renders live `@nauta/ui` components in `/studio` with zero eval — the first observable, demoable artifact before the generation layer is wired.
**Verified:** 2026-06-27T03:49:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | The `packages/genui` catalog manifest lists every whitelisted `@nauta/ui` component with Zod prop schema, slot rules, LLM-settable vs locked props, a11y-required marker — and every example passes CI validation | ✓ VERIFIED | `manifest.ts` (638 lines): 10 real entries with `.strict()` propsSchema, lockedProps, examples, a11y props required (button `aria-label`, alert `title`, table `caption`, key-value-list `label`, separator `aria-hidden: true`). manifest.test.ts: 30 tests, all pass |
| SC2 | A hardcoded sample spec renders as real `@nauta/ui` components in /studio/preview via `createElement` with NO eval/Function/dangerouslySetInnerHTML on the renderer path | ✓ VERIFIED (machine) / ? HUMAN (visual) | grep over renderer/registry/catalog returns ZERO matches for `eval(`, `new Function`, `Function(`, `dangerouslySetInnerHTML` — only comment-string occurrences. `renderNode` uses `React.createElement` exclusively. Build green, route static (3.92 kB). Visual confirmation pending |
| SC3 | One malformed node does not crash the surface — the error boundary isolates it; siblings keep rendering | ✓ VERIFIED (logic) / ? HUMAN (visual) | `NodeErrorBoundary` class component with `getDerivedStateFromError` confirmed in `error-boundary.tsx`. `renderNode` catches prop-validation failure via `safeParse` → `NodeErrorFallback` before even reaching the boundary. MALFORMED_SPEC confirmed as badge missing `label`. render-node.test.tsx: 30 tests all pass. Browser confirmation pending |
| SC4 | Declared state primitives are materialized into a store; dotted-path data references resolve via safe lookup — no executable code in spec | ✓ VERIFIED | `useDeclaredState` uses `useReducer` with 5-mutation switch (`toggle/set/reset/increment/decrement`), immutable spread returns. `resolveDataRef` is a pure dotted-path walk with FORBIDDEN_KEYS guard (`__proto__`, `constructor`, `prototype`). No eval on any code path. SHOWCASE_SPEC has `state[isExpanded, counter]` + `conditional.condition.dataRef: "state.isExpanded"` + `key-value-list.items[].valueRef` paths |
| SC5 | The registry exposes a version identifier; spec envelope carries a `v` field and per-catalog-id capability | ✓ VERIFIED | `REGISTRY_VERSION = { catalogId: "global", version: computeRegistryHash(COMPONENT_REGISTRY) }` in `registry-version.ts` using SHA-256 `createHash`. `SpecRootSchema` has `v: z.literal(1)`. `catalogId` field is the per-catalog-id seam (SEAM-03/D-21) |

**Score:** 5/5 truths machine-verified. 3 truths have a human visual confirmation pending (SC2 render, SC3 isolation card, SC4 state toggle).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/schema/spec-schema.ts` | Zod discriminated-union spec schema | ✓ VERIFIED | 403 lines; 12-node union; `SpecRootSchema` with `v:1`, `_plan`, bounds `.refine()`; `_specNodeSchemaRef` proxy for recursion; all `.strict()` |
| `packages/genui/src/catalog/types.ts` | Catalog types — ManifestEntry, ComponentRegistry | ✓ VERIFIED | 122 lines; `SpecNodeType` union (12 keys); `ManifestEntry<TProps>` with all required fields; typed fully |
| `packages/genui/src/catalog/manifest.ts` | 10-entry NAUTA_CATALOG with real components | ✓ VERIFIED | 638 lines; 10 real entries (text, badge, button, card, key-value-list, separator, alert, table, stack, grid); a11y props required; `compactEntry`/`toCompactCatalog` COST-03 seam; no `dangerouslySetInnerHTML` |
| `packages/genui/src/registry/component-registry.ts` | COMPONENT_REGISTRY, RegisteredTypeSchema, UnknownComponentPlaceholder | ✓ VERIFIED | 92 lines; `COMPONENT_REGISTRY = NAUTA_CATALOG`; `RegisteredTypeSchema = z.enum(Object.keys(...))` (auto-sync); `UnknownComponentPlaceholder` never throws |
| `packages/genui/src/registry/registry-version.ts` | SHA-256 hash, per-catalog-id shape | ✓ VERIFIED | 91 lines; `computeRegistryHash` with `createHash("sha256")`; `REGISTRY_VERSION: { catalogId: "global", version: sha256 }` |
| `packages/genui/src/renderer/render-node.tsx` | Recursive interpreter — createElement, no eval | ✓ VERIFIED | 368 lines; `renderNode` uses `React.createElement` exclusively; `resolveDataRef` pure dotted-path; `evaluateCondition` pure switch; `safeParse` before render; structural-position keys only (D-15) |
| `packages/genui/src/renderer/error-boundary.tsx` | `getDerivedStateFromError`, per-node isolation | ✓ VERIFIED | `NodeErrorBoundary` class with `getDerivedStateFromError`; `NodeErrorFallback` with `role="alert"`; does NOT import from `@nauta/ui/alert` |
| `packages/genui/src/renderer/use-declared-state.ts` | useReducer + 5-mutation enum, immutable | ✓ VERIFIED | `useReducer` with `stateReducer`; switch on `toggle/set/reset/increment/decrement`; all branches use spread `{ ...s, [decl.name]: next }` |
| `packages/genui/src/renderer/spec-renderer.tsx` | "use client" entry, ActionRegistryContext seam | ✓ VERIFIED | `"use client"` on line 1; `ActionRegistryContext` with empty default `{}`; `useDeclaredState` + `renderNode` wired; `registry = COMPONENT_REGISTRY` default |
| `packages/genui/src/demo/showcase-spec.ts` | All 12 node types + state/action + dataRef | ✓ VERIFIED | All 10 catalog types + list + conditional; `state: [isExpanded(boolean), counter(number)]`; `condition.dataRef: "state.isExpanded"`; `valueRef` dotted paths; `v: 1` |
| `packages/genui/src/demo/malformed-spec.ts` | Broken badge sibling among valid siblings | ✓ VERIFIED | Badge missing `label` (required field); valid text before/after; `as unknown as SpecRoot` cast; D-18 isolation pattern |
| `apps/web/src/app/studio/preview/page.tsx` | Server component — no "use client", version chips | ✓ VERIFIED | No "use client"; imports `SHOWCASE_SPEC`, `REGISTRY_VERSION`; renders `Badge` with `v{SHOWCASE_SPEC.v}` and `REGISTRY_VERSION.version.slice(0, 8)`; `SpecRendererIsland` client island |
| `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx` | "use client" + `dynamic(ssr:false)` | ✓ VERIFIED | `"use client"`; `dynamic(() => import("@nauta/genui/renderer")...`, `{ ssr: false, loading: () => null }`; no registry prop (avoids serialization issue) |
| `apps/web/src/components/app-sidebar.tsx` | `FlaskConical` + `/studio/preview` in LIVE_NAV_ITEMS | ✓ VERIFIED | `FlaskConical` imported from lucide-react; `LIVE_NAV_ITEMS` entry `{ href: "/studio/preview", label: "Studio", icon: FlaskConical }` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `page.tsx` | `SpecRendererIsland` | import + JSX `<SpecRendererIsland spec={SHOWCASE_SPEC} ...>` | ✓ WIRED | Server imports island, passes spec + data |
| `SpecRendererIsland` | `SpecRenderer` | `dynamic(() => import("@nauta/genui/renderer")`, ssr:false | ✓ WIRED | Dynamic client import, default = SpecRenderer |
| `SpecRenderer` | `useDeclaredState` | import + call `useDeclaredState(declarations)` | ✓ WIRED | State materialized per spec.state array |
| `SpecRenderer` | `renderNode` | import + call `renderNode(spec.root, ctx, "root")` | ✓ WIRED | Render context built from useDeclaredState result |
| `renderNode` | `COMPONENT_REGISTRY` | via `ctx.registry[node.type]` | ✓ WIRED | O(1) lookup, falls through to UnknownComponentPlaceholder on miss |
| `renderNode` | `NodeErrorBoundary` | wraps every component element via `React.createElement(NodeErrorBoundary, ...)` | ✓ WIRED | Every registry dispatch is wrapped |
| `renderNode` | `resolveDataRef` | calls for conditional.condition.dataRef, list.dataRef | ✓ WIRED | Pure function, no eval |
| `page.tsx` | `REGISTRY_VERSION` | import from `@nauta/genui/registry` | ✓ WIRED | Server-only; `version.slice(0,8)` in Badge |
| `COMPONENT_REGISTRY` | `NAUTA_CATALOG` | `= NAUTA_CATALOG` direct assignment | ✓ WIRED | Registry IS the catalog |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `SpecRenderer` | `spec.state` declarations | Static `SHOWCASE_SPEC.state` array passed as prop | Yes — 2 state declarations with real initial values | ✓ FLOWING |
| `SpecRenderer` | `data` | `SHOWCASE_SPEC.data` passed via page.tsx `data={SHOWCASE_SPEC.data}` | Yes — `demo.rows`, `demo.metadata` populated | ✓ FLOWING |
| `resolveDataRef` | `ctx.state.isExpanded` | `useDeclaredState` useReducer, initial false, toggled by dispatch | Yes — real React state | ✓ FLOWING |
| `page.tsx` | `REGISTRY_VERSION.version` | `computeRegistryHash` over `COMPONENT_REGISTRY` at module load | Yes — SHA-256 over real catalog | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 85 genui tests pass | `npm run test -w @nauta/genui` | 85 passed (3 files: 25 + 30 + 30) in 2.52s | ✓ PASS |
| genui typecheck clean | `npm run typecheck -w @nauta/genui` | No output (exit 0) | ✓ PASS |
| No eval on renderer path | `grep -rnE "eval\(|new Function|Function\(|dangerouslySetInnerHTML" packages/genui/src/renderer/ packages/genui/src/registry/ packages/genui/src/catalog/` | Only matches in JSDoc comment strings (GR-01 disclaimers), zero actual usage | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — no `probe-*.sh` files declared in PLAN files or present in `scripts/*/tests/`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTLG-01 | 12-02-PLAN | Machine-readable manifest with Zod prop schema, slot/children rules, LLM-settable vs locked | ✓ SATISFIED | `manifest.ts`: 10 entries, `propsSchema`, `lockedProps`, `llmSettable` implied by exclusion |
| CTLG-02 | 12-02-PLAN | A11y props marked required so spec omitting them fails validation | ✓ SATISFIED | `button["aria-label"]: z.string()`, `alert.title: z.string()`, `table.caption: z.string()`, `key-value-list.label: z.string()` — all required (not `.optional()`) |
| CTLG-03 | 12-02-PLAN | Static registry maps spec type-key to real React component | ✓ SATISFIED | `COMPONENT_REGISTRY = NAUTA_CATALOG`; `RegisteredTypeSchema` auto-derived from keys |
| CTLG-04 | 12-02-PLAN | Each manifest entry has an example CI-verified against its own prop schema | ✓ SATISFIED | `manifest.test.ts` 30 tests: all entries' `.examples` pass `.propsSchema.safeParse()` |
| CTLG-05 | 12-02-PLAN | Registry exposes version identifier for cache invalidation downstream | ✓ SATISFIED | `REGISTRY_VERSION = { catalogId: "global", version: sha256 }` |
| SPEC-01 | 12-01-PLAN | Typed Zod discriminated-union spec with v:1 root | ✓ SATISFIED | `SpecRootSchema` with `v: z.literal(1)`; `SpecNodeSchema = z.discriminatedUnion("type", [...])` |
| SPEC-02 | 12-03-PLAN | Recursive interpreter via createElement, no eval | ✓ SATISFIED | `renderNode` proven eval-free via grep; all `React.createElement` calls |
| SPEC-03 | 12-03-PLAN | Per-node error boundary — one malformed node cannot crash surface | ✓ SATISFIED | `NodeErrorBoundary` with `getDerivedStateFromError`; `safeParse` → `NodeErrorFallback` before boundary |
| SPEC-04 | 12-03-PLAN | Declared state materialized into store; no executable code | ✓ SATISFIED | `useDeclaredState` with `useReducer`, 5-mutation enum |
| SPEC-05 | 12-03-PLAN | Data/state references via safe dotted-path, no eval | ✓ SATISFIED | `resolveDataRef` pure walk with prototype-pollution guard |
| SPEC-06 | 12-04-PLAN | Hardcoded sample spec renders correctly end-to-end | ✓ SATISFIED (machine) / ? HUMAN (visual) | SHOWCASE_SPEC validates in CI (demo-specs.test.ts 25 pass); /studio/preview builds; visual browser confirmation pending |
| SEAM-01 | 12-01-PLAN | Spec envelope carries `v` field for grammar evolution | ✓ SATISFIED | `v: z.literal(1)` in `SpecRootSchema` |
| SEAM-03 | 12-02-PLAN | Catalog + cache key per-catalog-id capable | ✓ SATISFIED | `REGISTRY_VERSION.catalogId = "global"` — per-catalog-id shape present |
| COST-02 | 12-01-PLAN | Spec JSON schema stable (no recursion / external $ref) for Bedrock reuse | ✓ SATISFIED | `_specNodeSchemaRef` proxy + `z.lazy()` pattern avoids self-referencing the schema variable; `.strict()` throughout; no external `$ref` |
| COST-03 | 12-02-PLAN | Compact catalog encoding with subsetting seam | ✓ SATISFIED | `compactEntry`, `toCompactCatalog`, `// SEAM (COST-03/D-23)` comment in `manifest.ts` |

All 15 requirement IDs from PLAN frontmatter: SATISFIED. No orphaned requirements for this phase.

Note on SEAM-02: present in `spec-renderer.tsx` as `ActionRegistryContext` (empty default `{}`). SEAM-02 is not in the phase's declared requirement IDs but the seam is implemented.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `use-declared-state.ts` | 101, 111 | `eslint-disable-next-line react-hooks/exhaustive-deps` | ℹ Info | Intentional stability design — declarations are spec data; re-materializing on every parent render is wrong behavior. Comment explains rationale. Not a stub. |

No `TBD`, `FIXME`, `XXX` debt markers found in modified source files. No `return null` / `return {}` / `return []` stubs on render paths. `loading: () => null` in the dynamic import is intentional (imperceptible flash on static spec — documented in island file).

### Human Verification Required

These items require a running browser at `/studio/preview`. All automated checks (85 tests, typecheck, no-eval grep, build) pass.

#### 1. SHOWCASE_SPEC Live Render

**Test:** Open `/studio/preview` in a browser (local dev or staging deployment).
**Expected:** Left pane shows live rendered `@nauta/ui` components — styled text headings, a teal/secondary badge, outline button labeled "Toggle Section", alert box with "Showcase Alert" title, card with title + key-value-list inside + footer text, table with caption "Component catalog overview", 2-column grid, list items, and the conditional text "Click Toggle Section above to expand". Right pane shows raw JSON. Header badges show `v1` and `Registry XXXXXXXX` (8-char SHA). No white screen, no `[!]` error cards visible.
**Why human:** The client island uses `dynamic(ssr:false)` — the static build proves the module graph is valid (3.92 kB), but actual pixel rendering requires the React hydration lifecycle to execute in a browser.

#### 2. State Toggle (SC4 live closure)

**Test:** With the above page open, click the "Toggle Section" button.
**Expected:** The conditional text at the bottom changes from "Click Toggle Section above to expand. (state.isExpanded is false)" to "Expanded section is now visible. The conditional node resolved state.isExpanded = true." Clicking a second time reverts.
**Why human:** `useDeclaredState` reducer and `evaluateCondition` logic is code-verified, and the SHOWCASE_SPEC wiring of `action: "toggle"` on the button + `condition.dataRef: "state.isExpanded"` on the conditional is confirmed. The live state transition closure (button dispatch → React re-render → conditional switches branch) requires browser execution.

#### 3. Malformed Node Error Isolation (SC3 visual)

**Test:** The MALFORMED_SPEC fixture (`badge` missing `label`) is not exposed at a live route. Confirm by checking: does the render-node test `render-node.test.tsx` have a test for prop-validation-failure producing NodeErrorFallback? (It does — 30 tests pass.) The visual confirmation would require temporarily substituting MALFORMED_SPEC into page.tsx or adding a `/studio/preview-malformed` route.
**Expected:** Sibling text nodes render normally; the malformed badge node shows a red `[!] "badge" node — prop validation failed` card; no white-screen crash.
**Why human:** The code path is fully implemented and unit-tested (render-node.test.tsx: 30 tests pass), but the MALFORMED_SPEC has no live route. If the user considers the unit tests sufficient evidence for SC3, this can be accepted as machine-verified. If a visual browser confirmation is required, a temporary route or substitution is needed.

---

## Summary

**All 5 ROADMAP success criteria are materially implemented in the codebase.** The vocabulary contract (Zod discriminated-union schema, 10-entry catalog, registry version, zero-eval interpreter, error boundary, declared state, safe data refs) is fully wired and tested:

- 85/85 tests pass (`demo-specs.test.ts` 25 + `manifest.test.ts` 30 + `render-node.test.tsx` 30)
- TypeScript typecheck clean across `@nauta/genui`
- Zero eval/Function/dangerouslySetInnerHTML occurrences on the renderer path
- `/studio/preview` route builds successfully as a 3.92 kB Next.js static page
- All 15 requirement IDs (CTLG-01–05, SPEC-01–06, SEAM-01/03, COST-02/03) satisfied

**Status is `human_needed`** solely because Plan 12-04 contained a `checkpoint:human-verify` task that was intentionally deferred during the autonomous overnight run. Three visual items remain for browser confirmation: the live rendered output, the state toggle, and (optionally) the error isolation card. No implementation gaps were found.

---

_Verified: 2026-06-27T03:49:00Z_
_Verifier: Claude (gsd-verifier)_
