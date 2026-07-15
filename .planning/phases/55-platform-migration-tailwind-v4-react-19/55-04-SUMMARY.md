---
phase: 55-platform-migration-tailwind-v4-react-19
plan: 04
subsystem: frontend-react-runtime
tags: [react-19, dependency-bump, npm-workspaces, hoisting, jsx-types, tailwind-merge-v3]

# Dependency graph
requires: ["55-01", "55-02", "55-03"]
provides:
  - "apps/web + packages/ui + packages/genui run on a SINGLE unified react@19.2.7 / react-dom@19.2.7 instance across the entire npm-workspaces tree (root package.json overrides pin, needed because react-day-picker/react-resizable-panels are intentionally deferred to 55-05 and their pre-19 peerDependencies were causing npm to keep a stale react@18.3.1 hoisted at root)"
  - "packages/ui peerDependencies widened to `^18.3.1 || ^19.0.0` for react/react-dom so downstream consumers are not peer-warned"
  - "the six low-risk runtime deps (vaul, sonner, react-hook-form, next-themes, lucide-react, tailwind-merge) bumped to their React-19-compatible / v4-aware versions"
  - "React 19 type fallout fixed at the 6 call sites RESEARCH's blast-radius model actually undershot (JSX namespace no longer global; cloneElement's untyped ReactElement now defaults props to unknown, not any) — all fixed in place, no downgrades"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "npm workspaces + a deferred peer-dependency-capped-at-18 package (react-day-picker/react-resizable-panels, 55-05's scope) forces a root-level `overrides` pin to keep a SINGLE React instance tree-wide during an incremental major bump — without it, npm hoists the OLDER version to root (satisfying the capped peer) while nesting the newer version only in workspaces with a direct/dev dependency on it, producing two live React module instances and `Cannot read properties of null (reading 'useRef')` / \"React Element from an older version of React was rendered\" errors at render time. The `overrides` field alone is not sufficient against an EXISTING package-lock.json — npm's incremental resolver preserves prior lockfile placements even when overrides change; a full `rm -rf node_modules **/node_modules package-lock.json && npm install` was required to force re-resolution honoring the override"
    - "React 19's @types/react no longer declares a global `JSX` namespace by default — bare `JSX.Element` return-type annotations (no import) now fail with `TS2503: Cannot find namespace 'JSX'` in files that never imported React (relying on the automatic JSX runtime); fixed via `import type { JSX } from \"react\"`, not by importing all of React"
    - "React 19's `cloneElement<P>(element: ReactElement<P>, props: Partial<P> & Attributes)` defaults P to `unknown` (was `any` in React 18) when the ReactElement type parameter is omitted at the cast site — an untyped `as ReactElement` cast plus an arbitrary props object now fails to typecheck; fix by parameterizing the cast (`as ReactElement<{ onClick?: () => void }>`), not by widening back to `any`"

key-files:
  created: []
  modified:
    - apps/web/package.json
    - packages/ui/package.json
    - packages/genui/package.json
    - package.json
    - package-lock.json
    - packages/ui/src/code-block.tsx
    - packages/ui/src/spreadsheet-grid/cell-renderers/ArrayCellRenderer.tsx
    - packages/ui/src/spreadsheet-grid/cell-renderers/BooleanCellRenderer.tsx
    - packages/ui/src/spreadsheet-grid/cell-renderers/DateCellRenderer.tsx
    - packages/ui/src/spreadsheet-grid/cell-renderers/NumberCellRenderer.tsx
    - packages/ui/src/spreadsheet-grid/cell-renderers/UrlCellRenderer.tsx
    - .planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md

key-decisions:
  - "packages/genui (not in the plan's declared files_modified) was bumped to react@^19.2.7/@types/react@^19 in lockstep — Rule 3 (blocking issue): it depends on @polytoken/ui and carries its own direct (not just peer) react runtime dependency still pinned to 18, which produced duplicate @types/react copies in node_modules and nominal ReactNode type mismatches across every packages/ui file that returns JSX. The plan's own execution_rules explicitly require typecheck green for web AND ui AND genui, so this was in scope for the revalidation bar even though not named in files_modified"
  - "packages/genui also gained explicit react-dom + @types/react-dom devDependencies (previously undeclared) — its test files (form-render.test.tsx, catalog-example-render.test.tsx, themed-wrapper.test.tsx) import react-dom/server, react-dom/client, and react-dom/test-utils directly; this only ever worked via implicit hoisting from apps/web's own @types/react-dom, and stopped resolving once apps/web's copy became workspace-local rather than root-hoisted post-bump. Declaring the dependency explicitly is a correctness fix (Rule 2), not just a workaround"
  - "Added a root-level `overrides: { react: '^19.2.7', react-dom: '^19.2.7' }` pin — not in the plan's original file list, but required to prevent a genuine dual-React-instance runtime bug (react-day-picker@8.10.1/react-resizable-panels@2.0.19's still-capped-at-18 peerDependencies were keeping npm's root-hoisted react at 18.3.1 while apps/web/packages/ui/packages/genui each got their own nested 19.2.7 copy — two live React module instances broke ~30 vitest files with 'Cannot read properties of null (reading useRef)'). This is Rule 3 (blocking issue), confirmed safe: react-day-picker@8.10.2 and react-resizable-panels@2.1.9 (the versions actually resolved within their existing ^8.10.1/^2.0.19 ranges) both already declare React 19 in their OWN peerDependencies as of a later patch release than RESEARCH's audit captured — so forcing a single React 19 instance across the tree does not violate any currently-resolved package's stated compatibility, it just makes explicit what was already true"
  - "Diagnosed and confirmed the overrides field is ineffective against an existing package-lock.json under incremental `npm install` — even a `rm -rf node_modules` alone was insufficient; only deleting package-lock.json too and letting npm fully re-resolve honored the override. Verified this is not an npm-binary-level bug via a clean-room reproduction in a scratch directory (overrides worked immediately there with no pre-existing lockfile)"
  - "Did NOT attempt to fix the pre-existing app-sidebar pointer-events-interception bug (data-sidebar=\"menu\"/\"content\" under data-side=\"left\" intercepting clicks) surfaced by 3 of the E2E/screenshot gates — per SCOPE BOUNDARY, this predates the entire Tailwind v4 migration (root-caused in 55-02's deferred-items.md via a full revert-and-reproduce test) and this plan's commits never touch packages/ui/src/sidebar.tsx. Extended the existing deferred-items.md entry rather than treating it as a React-19 regression"
  - "Started the FastAPI listener (uv run uvicorn, apps/email-listener) as a one-time, read-only recovery attempt to unblock the two live-DB-backed E2E specs (live-loop-green, uat-39-tool-round) that structurally cannot pass without it (their own header comments document this as an operator prerequisite, not something the spec starts itself) — chosen because it is non-destructive (no file edits) and low-conflict-risk with the concurrent Python/uv executor also working in apps/email-listener tonight. Cleanly killed the process afterward so no server was left running past this session's verification"

patterns-established:
  - "Pattern: when bumping a monorepo's core runtime version (react 18->19) while intentionally deferring a subset of dependents still capped at the old peer range, add a root-level `overrides` pin for the runtime package(s) to force a single tree-wide instance — do not rely on npm's default hoisting to converge on the newer version, since npm's incremental resolver actively preserves the OLDER hoisted placement when it still satisfies every peer range in the tree"
  - "Pattern: when an E2E/screenshot regression surfaces during a dependency-bump plan, before treating it as a new regression, (1) re-run the specific failing test in isolation (--grep/single spec) to rule out parallel-execution resource-contention flakiness, and (2) check deferred-items.md / git blame for the touched files to rule out a pre-existing bug reproducing under new conditions. Both checks were needed this plan: 3 of 9 initial E2E failures were pure flakiness (passed cleanly in isolation), and the 1 deterministic failure was a pre-existing bug (zero overlap with this plan's touched files)"

requirements-completed: []  # STCK-02 NOT marked complete here — see Next Phase Readiness: react-day-picker/react-resizable-panels (the two genuinely-breaking majors) are still deferred to 55-05, and STCK-02's own wording ("every vendored packages/ui component is revalidated") is not yet fully satisfied until that plan lands

# Metrics
duration: ~90min
completed: 2026-07-15
---

# Phase 55 Plan 04: React 18->19 Core Bump + Six Low-Risk Dependency Bumps Summary

**apps/web, packages/ui, and packages/genui now run on a single, tree-wide-unified React 19.2.7 instance (react/react-dom, six low-risk runtime deps bumped, peerDependencies widened) — required a root-level `overrides` pin plus a full lockfile regeneration to defeat npm's default hoisting behavior, which otherwise kept a stale React 18.3.1 instance alive at the workspace root because react-day-picker/react-resizable-panels (correctly deferred to 55-05) still cap their peerDependencies at 18.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 2 (both `type="auto"`)
- **Files touched:** 11 modified across 2 commits

## Accomplishments

- **Task 1 — the bump itself:** Registry state + `repository.url` re-verified live for all 8 target packages immediately before install (all matched the RESEARCH audit exactly: facebook/react, emilkowalski/vaul, emilkowalski/sonner, react-hook-form/react-hook-form, pacocoursey/next-themes, lucide-icons/lucide, dcastil/tailwind-merge). Installed `react@^19.2.7`/`react-dom@^19.2.7` into `apps/web` (dependency) and `packages/ui` (devDependency); widened `packages/ui`'s `peerDependencies.react`/`.react-dom` to `^18.3.1 || ^19.0.0`; bumped `vaul@^1.1.2`, `sonner@^1.7.4`, `react-hook-form@^7.81.0`, `next-themes@^0.4.6`, `lucide-react@^0.400.0`, `tailwind-merge@^3.6.0` in `packages/ui`. `react-day-picker@^8.10.1` and `react-resizable-panels@^2.0.19` confirmed untouched; `next@^15.3.3` confirmed unchanged. next-themes 0.3->0.4 changelog reviewed live (GitHub Releases API) across all 0.4.0-0.4.6 entries: type fixes, optional `children`, multi-attribute support, minification — no breaking API removal affecting this repo's usage.
- **Task 2 — revalidation, and the fallout the plan's own blast-radius model undershot:**
  - Fixed a duplicate-`@types/react` problem: `packages/genui` (depends on `@polytoken/ui`, has its own direct `react` runtime dependency) was still pinned to React 18 devDependencies, producing two physically separate `@types/react` copies in `node_modules` and nominal `ReactNode` type mismatches (`Type 'React.ReactNode' is not assignable to type '...node_modules/@types/react/index').ReactNode'`) across `breadcrumb.tsx`, `button.tsx`, `code-block.tsx`, `sidebar.tsx` (5 sites), `spinner.tsx`, and a spreadsheet-grid cell renderer. Bumped genui's `react`/`@types/react` to 19 in lockstep (Rule 3).
  - Fixed a second, related gap: genui's test files (`form-render.test.tsx`, `catalog-example-render.test.tsx`, `themed-wrapper.test.tsx`) import `react-dom/server`/`react-dom/client`/`react-dom/test-utils` directly but never declared `react-dom`/`@types/react-dom` as dependencies — this only worked via implicit root-hoisting before, and broke once apps/web's own `@types/react-dom` became workspace-local. Declared both explicitly (Rule 2).
  - Fixed the genuine React-19 type fallout (5 files): React 19's `@types/react` no longer exposes a global `JSX` namespace — `ArrayCellRenderer.tsx`, `BooleanCellRenderer.tsx`, `DateCellRenderer.tsx`, `NumberCellRenderer.tsx`, `UrlCellRenderer.tsx` all used bare `JSX.Element` return types without importing React (relying on the automatic JSX runtime); fixed via `import type { JSX } from "react"` at each call site. `code-block.tsx`'s `cloneElement(children as ReactElement, { onClick: ... })` broke because React 19's `cloneElement` defaults the props type to `unknown` (was `any`) when the `ReactElement` cast omits its type parameter; fixed by parameterizing the cast (`ReactElement<{ onClick?: () => void }>`).
  - Diagnosed and fixed a genuine dual-React-instance runtime bug: after the above type fixes, `npm run test -w @polytoken/web` failed 145/464 tests with `TypeError: Cannot read properties of null (reading 'useRef')` and `Error: A React Element from an older version of React was rendered`. Root cause: `react-day-picker@8.10.1`/`react-resizable-panels@2.0.19` (intentionally left un-bumped, 55-05's scope) still declare peerDependencies capped at React 18 in the *currently installed* patch versions RESEARCH audited — but at their actually-*resolved* patch versions (`react-day-picker@8.10.2`, `react-resizable-panels@2.1.9`, both still within the existing `^8.10.1`/`^2.0.19` ranges), npm's default hoisting kept `react@18.3.1`/`react-dom@18.3.1` at the workspace root (satisfying every peer range including the 18-capped ones) while nesting fresh `19.2.7` copies only inside `apps/web`, `packages/ui`, and `packages/genui`'s own `node_modules` — meaning root-hoisted consumers like `zustand`, `@radix-ui/*`, `@xyflow/react`'s bundled `zustand`, etc. resolved to the OLD React while the app's own component tree and `react-dom` resolved to the NEW one. Fixed via a root `package.json` `overrides` pin (`react`/`react-dom` -> `^19.2.7`) — confirmed the override alone was ineffective against the existing lockfile (verified via a clean-room reproduction that the `overrides` mechanism itself works fine in isolation); a full `rm -rf node_modules **/node_modules package-lock.json && npm install` was required to force re-resolution. Post-fix: zero `18.3.1` instances anywhere in the tree (`npm ls react react-dom --all | grep -c 18.3.1` -> 0).
- **Full revalidation, post-fix:** `npm run typecheck -w @polytoken/web` / `-w @polytoken/ui` / `-w @polytoken/genui` all exit 0. `npm run test -w @polytoken/web` -> **64 files / 464 tests, 0 failed** (exact 55-03 baseline). `npm run test -w @polytoken/genui` -> 546/548 passing, 2 pre-existing failures (the already-documented `artifacts.test.ts` registryVersion hash drift from 55-02's `deferred-items.md`, unrelated to React). `cn()`/`tailwind-merge` v3 dedupe confirmed live (`twMerge("p-2","p-4")` -> `"p-4"`). `npm run web:build` -> exit 0, full 20/20-route production build (same pre-existing `.env.local`-must-be-exported-into-the-shell note as 55-01/55-02, since the plain `web:build` script has no `dotenv` wrapper — not a code change).

## Task Commits

1. **Task 1 (bump React 19 + widen peerDeps + bump six low-risk deps):** `6e35e53` (feat)
2. **Task 2 (revalidate: fix type/hoisting fallout, confirm no regression):** `4d4f881` (fix)

## Files Created/Modified

- `apps/web/package.json` — `react`/`react-dom` -> `^19.2.7`; `@types/react` -> `^19.2.17`; `@types/react-dom` -> `^19.2.3`
- `packages/ui/package.json` — devDep `react`/`react-dom` -> `^19.2.7`, `@types/react` -> `^19.2.17`; `peerDependencies.react`/`.react-dom` widened to `^18.3.1 || ^19.0.0`; `vaul`/`sonner`/`react-hook-form`/`next-themes`/`lucide-react`/`tailwind-merge` bumped; `react-day-picker`/`react-resizable-panels` untouched
- `packages/genui/package.json` — `dependencies.react` -> `^19.2.7`; `devDependencies.@types/react` -> `^19`; added `devDependencies.react-dom` (`^19.2.7`) and `.@types/react-dom` (`^19`, both previously undeclared); `peerDependencies.react` widened to `^18.3.1 || ^19.0.0`
- `package.json` (root) — added `overrides: { react: "^19.2.7", react-dom: "^19.2.7" }`
- `package-lock.json` — full regeneration (required for the override to take effect against the pre-existing lockfile)
- `packages/ui/src/code-block.tsx` — `cloneElement` cast parameterized (`ReactElement<{ onClick?: () => void }>`)
- `packages/ui/src/spreadsheet-grid/cell-renderers/{Array,Boolean,Date,Number,Url}CellRenderer.tsx` — `import type { JSX } from "react"` replacing bare global `JSX.Element` usage (and, for `ArrayCellRenderer.tsx`, replacing the now-unused `import * as React from "react"`)
- `.planning/phases/55-platform-migration-tailwind-v4-react-19/deferred-items.md` — extended the existing sidebar-pointer-events-interception entry with 2 new confirmed occurrences (`uat-48-token-surfaces.spec.ts` 48.1, `screenshot-review.spec.ts`'s Sandbox-tab alternate-pack capture step) plus the React-19 non-regression confirmation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] `packages/genui` still pinned to React 18, breaking `packages/ui`'s typecheck via duplicate `@types/react`**
- **Found during:** Task 2, first `npm run typecheck -w @polytoken/ui` after Task 1's bump
- **Issue:** `packages/genui` (not in this plan's `files_modified`, but a dependent of `@polytoken/ui` and a direct consumer of `react`) still declared `react@^18.3.1`/`@types/react@^18.3.3`, causing npm to install a second, workspace-local `@types/react` copy alongside the new tree-wide 19.x copy. TypeScript treats types imported from two physically different `node_modules/@types/react` directories as nominally distinct, producing `ReactNode` assignability errors across every `packages/ui` component returning JSX.
- **Fix:** Bumped `packages/genui`'s `react` dependency to `^19.2.7` and `@types/react` devDependency to `^19`, widened its `peerDependencies.react` to match `packages/ui`'s pattern. Confirmed zero React-19-breaking patterns (`useRef()` no-arg, `defaultProps`, `propTypes`) in `packages/genui/src` before bumping.
- **Files modified:** `packages/genui/package.json`
- **Commit:** `4d4f881`

**2. [Rule 2 - missing dependency declaration] `packages/genui`'s test files use `react-dom` subpaths without declaring `react-dom`**
- **Found during:** Task 2, `npm run typecheck -w @polytoken/genui` after fixing #1
- **Issue:** `form-render.test.tsx`, `catalog-example-render.test.tsx`, and `themed-wrapper.test.tsx` import `react-dom/server`, `react-dom/client`, and `react-dom/test-utils` directly, but `packages/genui/package.json` never declared `react-dom`/`@types/react-dom` — this only worked previously via implicit hoisting from `apps/web`'s own devDependency, which stopped resolving once the tree's hoisting shape changed post-bump.
- **Fix:** Added explicit `react-dom@^19.2.7` and `@types/react-dom@^19` devDependencies to `packages/genui/package.json`.
- **Files modified:** `packages/genui/package.json`
- **Commit:** `4d4f881`

**3. [Rule 1 - bug] React 19's `@types/react` drops the global `JSX` namespace**
- **Found during:** Task 2, `npm run typecheck -w @polytoken/ui`
- **Issue:** 5 `packages/ui/src/spreadsheet-grid/cell-renderers/*.tsx` files used bare `JSX.Element` return-type annotations without importing React (relying on the automatic JSX runtime, `tsconfig.json`'s `"jsx": "preserve"`) — React 19's types no longer expose `JSX` as a global ambient namespace, producing `TS2503: Cannot find namespace 'JSX'`.
- **Fix:** Added `import type { JSX } from "react"` to each file (the officially documented React 19 migration fix), preserving the `JSX.Element` return-type syntax rather than switching to `ReactElement` or downgrading types.
- **Files modified:** `ArrayCellRenderer.tsx`, `BooleanCellRenderer.tsx`, `DateCellRenderer.tsx`, `NumberCellRenderer.tsx`, `UrlCellRenderer.tsx`
- **Commit:** `4d4f881`

**4. [Rule 1 - bug] `cloneElement`'s untyped `ReactElement` cast broke under React 19's stricter prop typing**
- **Found during:** Task 2, `npm run typecheck -w @polytoken/ui`
- **Issue:** `code-block.tsx`'s `CodeBlockCopyButton` called `cloneElement(children as ReactElement, { onClick: copyToClipboard })` — React 19's `cloneElement` type signature defaults the element's prop type to `unknown` (was `any` in React 18) when the `ReactElement` cast omits an explicit type parameter, so passing an `onClick` prop no longer typechecked.
- **Fix:** Parameterized the cast: `children as ReactElement<{ onClick?: () => void }>`. Preserves the exact runtime behavior (still an untyped `asChild`-style clone), just gives TypeScript enough information at the cast site instead of relying on `any`'s implicit escape hatch.
- **Files modified:** `code-block.tsx`
- **Commit:** `4d4f881`

**5. [Rule 3 - blocking issue] Dual React instances tree-wide from npm's default hoisting**
- **Found during:** Task 2, `npm run test -w @polytoken/web` after fixing #1-4 (typecheck was clean, but 145/464 vitest tests failed at runtime)
- **Issue:** `react-day-picker`/`react-resizable-panels` (deliberately un-bumped, deferred to 55-05) still declare peerDependencies capped at React 18 in the RESEARCH-audited pinned versions. Because those peer ranges are satisfiable by either 18 or 19 for most OTHER transitive consumers too (`ag-grid-react`, `cmdk`, `@radix-ui/*`, `@tanstack/react-query`, `@xyflow/react`, `zustand` — all confirmed to already accept `^19` in their own peerDependencies via `npm explain`), npm's incremental resolver simply preserved the pre-existing lockfile placement (`react@18.3.1` hoisted at root) rather than converging on the newer version, since nothing forced a re-evaluation. This produced two live, separate React module instances in the same render tree — root-hoisted consumers (zustand, Radix, etc.) resolved `react@18.3.1` while `apps/web`/`packages/ui`/`packages/genui`'s own nested copies were `19.2.7` — causing `TypeError: Cannot read properties of null (reading 'useRef')` (React 18's dispatcher, called from a React-19-rendered tree) and `Error: A React Element from an older version of React was rendered`.
- **Fix:** Added `overrides: { "react": "^19.2.7", "react-dom": "^19.2.7" }` to the root `package.json`. Discovered (via a clean-room scratch-directory reproduction) that `overrides` works correctly in isolation but is NOT honored against a pre-existing `package-lock.json` under incremental `npm install` — a full `rm -rf node_modules apps/web/node_modules packages/*/node_modules package-lock.json && npm install` was required to force complete re-resolution. Verified: `npm ls react react-dom --all | grep -c 18.3.1` -> `0` post-fix; confirmed non-destructive to the two deferred packages' own compatibility, since their actually-*resolved* patch versions (`react-day-picker@8.10.2`, `react-resizable-panels@2.1.9`) both already declare React 19 support in their own peerDependencies as of a later patch than RESEARCH's 2026-07-15 audit captured — this override doesn't force anything they don't already claim to support.
- **Files modified:** `package.json` (root), `package-lock.json`
- **Commit:** `4d4f881`

### Deferred / Out-of-Scope

**Pre-existing sidebar pointer-events-interception bug — NOT fixed, confirmed pre-existing (2 additional occurrences logged)**
- Two E2E specs deterministically fail with the identical `data-sidebar="menu"`/`"content"` under `data-side="left"` "subtree intercepts pointer events" signature already root-caused in 55-02's `deferred-items.md` (proven via a full revert-and-reproduce test to predate the entire Tailwind v4 migration): `uat-48-token-surfaces.spec.ts`'s 48.1 sub-test (an `/emails/[id]` layers-panel treeitem click) and `token-render.spec.ts`'s `/knowledge` minimap sub-test (already documented). `npm run screenshot:review -w @polytoken/web` hit the same bug a third time (a `/studio` Sandbox-tab click during the alternate-pack capture sub-step) after successfully capturing 11 real screenshots first. This plan's commits never touch `packages/ui/src/sidebar.tsx`. Extended the existing `deferred-items.md` entry with both new occurrences rather than opening new ones or attempting a fix (out of scope, pre-existing, unrelated to React 19/the dependency bumps).

## Environment / Gate Results

- **Registry + repository.url re-verification (pre-install):** all 8 target packages (`react`, `react-dom`, `@types/react`, `@types/react-dom`, `vaul`, `sonner`, `react-hook-form`, `next-themes`, `lucide-react`, `tailwind-merge`) resolved live and matched RESEARCH's audited source repos exactly
- **`grep` acceptance criteria (Task 1):** all 5 grep checks passed — `apps/web` react/react-dom `^19.2.7`, `@types/react` `^19`; `packages/ui` peerDependencies include `19`; the six deps show their target versions; `react-day-picker`/`react-resizable-panels` untouched at `^8.10.1`/`^2.0.19`; `next` unchanged at `^15.3.3`
- **`npm run typecheck -w @polytoken/web`** -> exit 0
- **`npm run typecheck -w @polytoken/ui`** -> exit 0
- **`npm run typecheck -w @polytoken/genui`** -> exit 0 (not an explicit plan gate, but required by this plan's own execution_rules and fixed as part of the revalidation)
- **`npm run test -w @polytoken/web`** -> exit 0, **64 files / 464 tests, 0 failed** (exact 55-03 baseline, confirmed after the dual-React-instance fix)
- **`npm run test -w @polytoken/genui`** -> 546/548 passing; 2 pre-existing failures (`artifacts.test.ts` registryVersion hash drift, already documented in `deferred-items.md` from 55-02, unrelated to React)
- **`npm run test:e2e -w @polytoken/web`** -> 35-41/50 passing depending on run (parallel flakiness); with the FastAPI listener started as a one-time recovery, both live-DB-backed specs (`live-loop-green.spec.ts`, `uat-39-tool-round.spec.ts`) pass cleanly in both browsers; 3 other apparently-new failures (`uat-41.2`, `uat-41.4`, `uat-45.1`) each independently reproduced as PASS in isolation (confirmed flaky under `fullyParallel: true`, not React-19 regressions); the 1 remaining deterministic failure (`uat-48.1`, plus `token-render`'s pre-existing `/knowledge` case) is the pre-existing sidebar bug, confirmed unrelated (see Deviations)
- **`npm run web:build`** -> exit 0, full 20/20-route production build (ran with `.env.local` exported into the shell — same pre-existing no-dotenv-wrapper note as 55-01/55-02, not a code change)
- **`cn()`/tailwind-merge v3 dedupe:** `twMerge("p-2", "p-4")` -> `"p-4"` (confirmed live via node)
- **`npm run screenshot:review -w @polytoken/web`** -> ran, wrote `.planning/ui-reviews/2026-07-15T06-55-10-082Z/` with 11 real screenshots (5 of 6 base surfaces x mobile+desktop, plus one alternate-pack capture) before hitting the pre-existing sidebar bug on a later alternate-pack sub-step; spot-checked `chat-desktop.png` and `knowledge-desktop.png` visually — no rendering regression, colors/layout/React-Flow canvas all correct

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources introduced.

## Threat Flags

None. Per this plan's own `<threat_model>` (T-55-SC, T-55-04): all package bumps were re-verified live against the npm registry + repository.url immediately before install (no blocking-human checkpoint needed, matching the RESEARCH audit's "Approved for all" disposition); the full E2E suite + token-render guard + production build gate were all run before this plan closes. No new network endpoints, auth paths, or trust-boundary changes were introduced — this is purely a runtime version bump.

## Issues Encountered

- The dual-React-instance hoisting bug (Deviation #5) was the most significant unplanned issue — RESEARCH's blast-radius model (zero `useRef()` no-arg / `defaultProps` / `propTypes` / string-ref usages) correctly predicted no *source-code* breakage, but did not anticipate the *npm resolution* consequence of deferring two peer-capped packages to a later plan while bumping the core runtime in this one. Diagnosed via `npm explain react`/`npm ls react --all` tree inspection and a clean-room `overrides` reproduction; resolved via a root `overrides` pin + full lockfile regeneration.
- Confirmed (not fixed, out of scope) that the pre-existing sidebar pointer-events bug from 55-02 is more pervasive than previously known — it now has 3 independently-confirmed occurrences across unrelated pages/interactions (nav-rail label, layers-panel treeitem, Studio tab trigger), all sharing the identical `data-sidebar`/`data-side="left"` signature. Flagged in `deferred-items.md` for a future dedicated investigation.

## User Setup Required

None for this plan's own deliverable. The pre-existing sidebar-interception bug (documented in `deferred-items.md`) and the `packages/genui` `artifacts.test.ts` hash-drift (also pre-existing) remain open follow-up items, both explicitly out of this plan's scope.

## Next Phase Readiness

- 55-05 (the two genuinely-breaking majors — `react-day-picker` v8->v9, `react-resizable-panels` v2->v3, plus the STCK-03 Radix-decision doc and STCK-04 registry-install proof) is unblocked: the tree now runs a single, unified React 19 instance, `packages/ui`'s peerDependencies already accept `^19`, and both deferred packages are confirmed to already declare React 19 support in their own peerDependencies at their currently-resolved patch versions (`8.10.2`/`2.1.9`) — meaning 55-05's actual work is the documented API-shape migration (prop/type renames), not a fight with the dependency tree.
- `STCK-02` is intentionally left **Pending** in `REQUIREMENTS.md` (not marked complete by this plan) — its own wording ("every vendored `packages/ui` component is revalidated... no runtime regressions in the 16-surface screenshot harness") is not fully satisfiable until 55-05 lands, since `react-day-picker`'s `Calendar` component (one of the vendored components) is still on its pre-rewrite v8 API. 55-05's own SUMMARY should mark STCK-02 complete once the Calendar revalidation closes the loop.
- The root `package.json` `overrides` pin (`react`/`react-dom` -> `^19.2.7`) should be reviewed for removal once 55-05 lands and bumps `react-day-picker`/`react-resizable-panels` to their React-19-native majors — at that point every peer range in the tree will natively include 19 and the override becomes redundant (though harmless to leave).
- `deferred-items.md`'s sidebar pointer-events-interception entry now has 3 confirmed occurrences and is a good candidate for a dedicated investigation phase/plan, independent of the Tailwind v4/React 19 migration.

---
*Phase: 55-platform-migration-tailwind-v4-react-19*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 12 files listed under Files Created/Modified (plus this SUMMARY.md itself) confirmed present
on disk. Both commit hashes (`6e35e53` Task 1, `4d4f881` Task 2) confirmed present via
`git log --oneline --all`.
