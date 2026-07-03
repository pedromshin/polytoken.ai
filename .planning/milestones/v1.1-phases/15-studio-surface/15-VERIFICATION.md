---
phase: 15-studio-surface
verified: 2026-06-27T12:00:00Z
status: human_needed
score: 4/4 must-haves verified (machine-verifiable portions)
overrides_applied: 0
human_verification:
  - test: "Catalog tab lists all whitelisted components"
    expected: "Every entry in NAUTA_CATALOG appears as a card — 10 cards if the registry has 10 entries; filter input narrows the list in real time; 'No components match' appears on zero results"
    why_human: "Object.values(NAUTA_CATALOG) wiring is correct in code but the actual count and visual correctness require eyeballing in the browser"
  - test: "Each catalog card renders a live example, prop table, and slot chips"
    expected: "Card shows: a rendered UI example via SpecRendererIsland (not a placeholder div); a prop table listing required/optional props derived from live Zod schema; slot chips if any slots are declared"
    why_human: "describePropsSchema and SpecRendererIsland are wired correctly in code; visual accuracy (column widths, no blank sections) requires a browser"
  - test: "Sandbox tab: intent input -> Generate button -> live preview + spec JSON"
    expected: "Typing intent text and clicking Generate triggers the tRPC genui.generate query; left panel shows rendered UI via SpecRendererIsland; right panel shows the raw spec JSON in a <pre> block; both panels are visible simultaneously in 55/45 split"
    why_human: "Wiring of refetch(), ResizablePanelGroup layout, and JSON display requires a running browser to confirm layout and actual data flow"
  - test: "Generation state chrome: in-progress indicator"
    expected: "While the request is in flight a spinning Loader2 icon and the text 'Generating...' (not 'Streaming') appear above the preview"
    why_human: "Requires triggering a live request to observe the loading state; cannot be simulated without a running backend"
  - test: "Generation state chrome: cache-hit badge"
    expected: "On a repeated identical intent a teal 'Cache hit · 0 LLM cost' badge replaces the loading indicator; no Loader2 visible"
    why_human: "Requires a FastAPI backend with a warm cache; cannot be exercised offline"
  - test: "Generation state chrome: fallback indicator"
    expected: "When the backend returns outcome='fallback' a red-tinted alert with AlertTriangle and 'Validation failed — showing a safe fallback' appears; the fallback spec is still rendered"
    why_human: "Requires a backend scenario that triggers fallback (malformed LLM output or forced fallback); cannot be triggered offline"
  - test: "Generation state chrome: cold generation badge"
    expected: "On a first-time intent a secondary 'Cold generation' badge appears; if outcome='escalated' the badge reads 'Cold · escalated to Sonnet'"
    why_human: "Requires a live backend cold-path response; cannot be simulated offline"
  - test: "Showcase link navigates to /studio/preview"
    expected: "Clicking the Showcase icon/link in the tab bar navigates to /studio/preview and renders the existing component showcase page"
    why_human: "Link presence is code-verified; actual navigation and target page require a running Next.js dev server"
  - test: "Dark mode and responsive layout"
    expected: "All four generation-state badges, catalog cards, and the sandbox split-panel render correctly in dark mode without hard-coded colors leaking through"
    why_human: "Uses only existing shadcn tokens in code; visual correctness in dark mode requires eyeballing"
---

# Phase 15: Studio Surface — Verification Report

**Phase Goal:** A developer can open /studio, browse the full component catalog, enter a natural-language intent, see the generated UI rendered live in a preview sandbox alongside the underlying spec JSON, and observe generation states (streaming, validation failure + fallback, cache-hit vs cold) — all in one surface.
**Verified:** 2026-06-27T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | /studio shows a browseable catalog of all whitelisted components, each with prop schema, slot rules, and a rendered example | VERIFIED | `CatalogBrowserIsland` imports `NAUTA_CATALOG` from `@nauta/genui/catalog`, iterates `Object.values(NAUTA_CATALOG)`, renders `CatalogEntryCard` with `SpecRendererIsland` (live example), `describePropsSchema` (prop table), and slot chips. No hardcoded array or stub. |
| 2 | The sandbox produces a live preview backed by the SAME SpecRenderer + COMPONENT_REGISTRY — NOT a stub/separate renderer | VERIFIED | Exactly one `dynamic(ssr: false)` wrapper at `apps/web/src/app/studio/_components/spec-renderer-island.tsx`. `studio/preview/_components/spec-renderer-island.tsx` is a pure re-export. Catalog and sandbox both import from `../../_components/spec-renderer-island`. SpecRenderer defaults to COMPONENT_REGISTRY (NAUTA_CATALOG) with no registry prop passed — drift-proof. |
| 3 | The spec JSON that produced the render is visible alongside the preview | VERIFIED | `GenerationSandboxIsland` renders a 55/45 `ResizablePanelGroup`: left panel = `<SpecRendererIsland spec={specToRender} actions={actions} />`, right panel = `<pre>{JSON.stringify(specToRender, null, 2)}</pre>`. Code is not a stub — the `specToRender` variable is derived from `lastResult?.spec ?? EMPTY_SPEC` and is the same object fed to both panels. |
| 4 | Studio visibly distinguishes four generation states: in-progress, validation-failure+fallback, cache-hit, cold | VERIFIED (machine-verifiable portion) | `deriveGenerationState` (pure, 9 unit tests all green) maps 5 input cases to 4 discriminated union states. `GenerationStateChrome` has four non-overlapping branches: `in_progress` → Loader2 + "Generating…"; `fallback` → `role="alert"` + destructive tint + "Validation failed — showing a safe fallback"; `cache_hit` → teal badge + "Cache hit · 0 LLM cost"; `cold` → secondary badge + "Cold generation" / "Cold · escalated to Sonnet". "Generating…" wording (not "Streaming") is honest per Phase 13 non-streaming design. Live visual confirmation requires a running backend (human item). |

**Score:** 4/4 truths verified (machine-verifiable portions)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/studio/derive-generation-state.ts` | Pure deterministic helper for 4-state mapping | VERIFIED | 5-case priority: isPending→in_progress, outcome=fallback→fallback, outcome=ok+cacheHit→cache_hit, outcome=escalated→cold(escalated:true), default→cold(escalated:false). Returns new object. No React import. 9/9 unit tests pass. |
| `packages/genui/src/studio/describe-props-schema.ts` | Live Zod introspection for prop table | VERIFIED | Reads `_def.shape()` via typeName string comparison, unwraps ZodOptional/ZodDefault, maps 8 Zod types to labels, returns `[]` on any failure (never throws). 18/18 unit tests pass. |
| `packages/api-client/src/router/genui/generate.ts` | Flat GenerateOutputSchema with outcome + cacheHit | VERIFIED | `GenerateOutputSchema = { outcome: z.enum(["ok","fallback","escalated"]), spec: SpecRootSchema, cacheHit: z.boolean(), reason: z.string().optional() }`. All fallback paths include `outcome: "fallback" as const` and `cacheHit: false`. SpecRootSchema.safeParse failure overrides to fallback (D-08/D-15). 16/16 generate tests pass. |
| `apps/email-listener/app/application/use_cases/generate_ui_spec.py` | GenerateUiSpecResult with outcome field | VERIFIED | Frozen dataclass with `outcome: Literal["ok","fallback","escalated"] = "ok"`. Cache-hit path hardcodes `outcome="ok"`. Cold path uses pre-computed `_determine_outcome(...)`. |
| `apps/email-listener/app/presentation/api/v1/genui.py` | GenerateUiSpecView Pydantic model exposing outcome | VERIFIED | `GenerateUiSpecView` has `outcome: Literal["ok","fallback","escalated"] = "ok"`. Endpoint maps `result.outcome` through directly. |
| `apps/web/src/app/studio/page.tsx` | Server shell with header and StudioTabs | VERIFIED | Server component. Imports REGISTRY_VERSION only in server context (T-12-15). Renders h-12 header with "Studio" h1 + version/hash Badge chips + `<StudioTabs />`. |
| `apps/web/src/app/studio/_components/spec-renderer-island.tsx` | Single shared dynamic(ssr:false) wrapper | VERIFIED | Only `dynamic(` definition in the entire studio tree. `actions` prop additive (15-03). |
| `apps/web/src/app/studio/_components/catalog-browser-island.tsx` | Browseable catalog with filter | VERIFIED | `useState("")` filter on type/description, `aria-live="polite"` on grid, no-results message. Imports NAUTA_CATALOG directly (D-10 — Zod schemas cannot serialize server→client). |
| `apps/web/src/app/studio/_components/generation-state-chrome.tsx` | Four-state chrome component | VERIFIED | Calls `deriveGenerationState(...)`, four early-return branches with correct copy and aria attributes. |
| `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` | Sandbox with tRPC query, split panel, and chrome | VERIFIED | `api.genui.generate.useQuery({ enabled: false })` + manual `await q.refetch()`. 55/45 `ResizablePanelGroup`. `GenerationStateChrome` shown when `q.isFetching || lastResult !== undefined`. tRPC alias corrected to `~/trpc/react` (fix commit c3c23d7). |
| `apps/web/src/app/studio/_components/studio-tabs.tsx` | Tabs wiring Catalog + Sandbox | VERIFIED | `TabsContent "catalog"` → `<CatalogBrowserIsland />`. `TabsContent "sandbox"` → `<GenerationSandboxIsland />`. Showcase is a Link (not TabsContent), per D-01. |
| `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx` | Re-export confirming shared renderer | VERIFIED | `export { SpecRendererIsland } from "../../_components/spec-renderer-island"` — no second `dynamic(` call. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `generate_ui_spec.py` (use case) | `GenerateUiSpecResult.outcome` | frozen dataclass field | WIRED | outcome field present, _determine_outcome() populates cold path |
| `genui.py` (FastAPI view) | `GenerateUiSpecView.outcome` | Pydantic model + endpoint mapping | WIRED | `outcome=result.outcome` in return statement |
| `generate.ts` (tRPC) | `GenerateOutputSchema.outcome` | Zod schema + response mapping | WIRED | `data.outcome` read with null-safe guard |
| `GenerationSandboxIsland` | `api.genui.generate` | `~/trpc/react` (corrected alias) | WIRED | `useQuery({ enabled: false })` + `q.refetch()` on click |
| `GenerationSandboxIsland` | `GenerationStateChrome` | JSX render, props forwarded | WIRED | `isPending=q.isFetching`, `outcome`, `cacheHit`, `reason` from lastResult |
| `GenerationStateChrome` | `deriveGenerationState` | `@nauta/genui/studio` import | WIRED | Imported and called with all four discriminating inputs |
| `CatalogBrowserIsland` | `describePropsSchema` | `@nauta/genui/studio` import | WIRED | Called per catalog entry inside CatalogEntryCard |
| `CatalogBrowserIsland` + `GenerationSandboxIsland` | `SpecRendererIsland` | `../../_components/spec-renderer-island` | WIRED | Both import from shared path |
| `studio-tabs.tsx` | `GenerationSandboxIsland` | `TabsContent value="sandbox"` | WIRED | Sandbox tab no longer a placeholder (verified by reading studio-tabs.tsx) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `GenerationSandboxIsland` | `lastResult` | `q.data` from tRPC `genui.generate` → FastAPI → LLM | Yes — FastAPI reads from Bedrock; fallback only when LLM output fails SpecRootSchema.safeParse | FLOWING (backend required for live execution) |
| `CatalogBrowserIsland` | `Object.values(NAUTA_CATALOG)` | `@nauta/genui/catalog` — static registry built into bundle | Yes — static but real; no hardcoded empty array | FLOWING |
| `GenerationStateChrome` | `state` | `deriveGenerationState({ isPending, outcome, cacheHit, reason })` | Yes — deterministic mapping of live tRPC query state | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| deriveGenerationState covers all 4 states | `npm run test -w @nauta/genui` (9 derive-generation-state tests) | 180/180 passed | PASS |
| describePropsSchema never throws, covers 8 Zod types | `npm run test -w @nauta/genui` (18 describe-props-schema tests) | 180/180 passed | PASS |
| generate.ts outcome/cacheHit contract | `npm run test -w @nauta/api-client` (16 generate tests) | 118/118 passed | PASS |
| /studio route compiles (static, no SSR errors) | `npm run web:build` | PASSED — /studio = Static, 14.6 kB first load JS | PASS |
| No second dynamic(ssr:false) in studio tree | `grep -rn "dynamic("` in `apps/web/src/app/studio/` | One definition at `_components/spec-renderer-island.tsx`; preview is re-export only | PASS |
| Sandbox tab not a placeholder | Read `studio-tabs.tsx` | `TabsContent "sandbox"` renders `<GenerationSandboxIsland />` (not placeholder text) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| STDO-01 | 15-02-PLAN.md | Browseable component catalog at /studio | SATISFIED | CatalogBrowserIsland + NAUTA_CATALOG + SpecRendererIsland examples + describePropsSchema prop tables |
| STDO-02 | 15-02-PLAN.md | Shared SpecRenderer (not a stub) in sandbox | SATISFIED | Single dynamic(ssr:false) wrapper; sandbox imports same shared island as catalog |
| STDO-03 | 15-03-PLAN.md | Spec JSON visible alongside preview | SATISFIED | 55/45 ResizablePanelGroup; `<pre>JSON.stringify</pre>` in right panel, same spec fed to left panel |
| STDO-04 | 15-03-PLAN.md | Four generation states visually distinguished | SATISFIED (machine portion) | deriveGenerationState + GenerationStateChrome implement all four branches; live visual deferred to human verification |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TBD/FIXME/XXX markers in phase-modified files | — | — |
| `studio-tabs.tsx` | (earlier, now replaced) | Placeholder "Sandbox coming in 15-03" was removed in 15-03 commits | — | Resolved — TabsContent now wires GenerationSandboxIsland |

No debt markers, no empty implementations, no hardcoded empty arrays feeding rendered output, no `dangerouslySetInnerHTML`, no `eval/Function` calls found in any phase-15 modified file.

---

### Human Verification Required

#### 1. Catalog visual — all entries, live renders, prop tables, filter

**Test:** Open /studio, click "Catalog" tab. Count the catalog cards rendered.
**Expected:** One card per NAUTA_CATALOG entry (e.g. 10 cards for a 10-entry registry). Each card shows a working rendered example (not a grey placeholder), a prop table with at least one row, and slot chips when slots exist. Typing in the filter input narrows results immediately; clearing it restores all cards; a zero-match input shows "No components match".
**Why human:** `Object.values(NAUTA_CATALOG)` is correctly wired in code; confirming actual card count, render completeness, and filter UX requires a browser.

#### 2. Sandbox — intent -> Generate -> split preview + JSON panel

**Test:** Open /studio, click "Sandbox" tab. Type an intent (e.g. "show a welcome card") and click Generate.
**Expected:** The spinner/loading indicator appears while the request is in flight. When complete, the left panel shows a rendered UI component; the right panel shows the raw spec JSON formatted with indentation. Both panels are visible simultaneously without scrolling on a 1280px+ screen.
**Why human:** `ResizablePanelGroup` layout and actual tRPC data flow to/from FastAPI+Bedrock require a live environment.

#### 3. Generation state — in-progress indicator

**Test:** Click Generate and immediately observe the chrome area above the preview.
**Expected:** A spinning icon and the exact text "Generating…" (not "Streaming", not "Loading") appear while the request is pending.
**Why human:** Requires observing a live in-flight request; cannot be frozen for inspection offline.

#### 4. Generation state — cache-hit badge

**Test:** Click Generate twice with the same intent (without changing the input between clicks).
**Expected:** The second response shows a teal "Cache hit · 0 LLM cost" badge instead of the loading state. Response time should also be noticeably faster.
**Why human:** Requires a warm backend cache; not exercisable offline.

#### 5. Generation state — validation-failure fallback indicator

**Test:** Use a contrived intent that the LLM historically returns a malformed spec for, or temporarily force a fallback at the backend level.
**Expected:** A red-tinted alert box with "Validation failed — showing a safe fallback" appears. The fallback spec is still rendered in the left panel (not an empty state).
**Why human:** Requires triggering a specific backend failure path; deterministic UI behavior already verified via deriveGenerationState unit tests.

#### 6. Generation state — cold generation badge

**Test:** Use a brand-new intent (one not previously cached) and observe the chrome after response.
**Expected:** A "Cold generation" badge (secondary variant). If the backend escalated to a more powerful model, the badge reads "Cold · escalated to Sonnet".
**Why human:** Requires a backend cold-path response; not exercisable offline.

#### 7. Showcase link

**Test:** In the /studio tab bar, click the Showcase icon or link.
**Expected:** Browser navigates to /studio/preview and the existing component showcase page renders correctly.
**Why human:** Link href is code-verified; actual navigation requires a running Next.js server.

#### 8. Dark mode

**Test:** Enable OS/browser dark mode, then visit /studio. Cycle through catalog and sandbox tabs. Trigger each generation state badge.
**Expected:** All UI elements (badges, alert, spinner, JSON panel, catalog cards) render correctly with no hard-coded colors bleeding through; shadcn token variables resolve correctly.
**Why human:** CSS variable resolution in dark mode requires a browser; no hardcoded hex colors were found in code review, but visual confirmation is needed.

---

## Gaps Summary

No gaps found. All four ROADMAP success criteria are materially satisfied in the codebase:

1. **SC1 (Catalog):** CatalogBrowserIsland wires NAUTA_CATALOG with four facets per entry — live example, prop table, slot chips, filter. No stub.
2. **SC2 (Shared renderer):** Exactly one `dynamic(ssr: false)` wrapper. Catalog, sandbox, and preview routes all use it. SpecRenderer defaults to COMPONENT_REGISTRY internally — cannot drift from production behavior.
3. **SC3 (Spec JSON):** `ResizablePanelGroup` 55/45 split with `<pre>JSON.stringify(specToRender, null, 2)</pre>` in right panel, fed the same `specToRender` variable as the left panel renderer.
4. **SC4 (Four states):** `deriveGenerationState` covers all 5 input cases → 4 output states. `GenerationStateChrome` renders all four correctly with proper aria labels, copy, and visual treatment. All 9 state-derivation unit tests pass. "Generating…" wording is deliberate (Phase 13 is non-streaming — documented judgment call, not a gap).

Visual browser confirmation of states 3-4 (requiring a live FastAPI+Bedrock backend) is deferred to human verification above.

---

_Verified: 2026-06-27T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
