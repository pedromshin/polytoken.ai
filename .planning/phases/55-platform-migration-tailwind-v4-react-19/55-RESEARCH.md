# Phase 55: Platform Migration — Tailwind v4 + React 19 - Research

**Researched:** 2026-07-15
**Domain:** Build-tool/CSS-engine migration (Tailwind v3.4→v4) + React major-version migration (18→19) inside an npm-workspaces monorepo with a cross-language (TypeScript + Python) token-format contract
**Confidence:** HIGH (mechanics, versions, peer-dep matrix — all tool-verified) / MEDIUM (blast-radius completeness — grep-verified against this repo, but a live `npm install` + build is the real gate)

## Summary

This phase is smaller on the React side and larger on the Tailwind side than the phase brief's framing suggests, for two repo-specific reasons discovered during research, not assumed from general knowledge.

**React 19 is nearly a non-event for this repo.** `next@15.5.20` (already installed) accepts `react: ^18.2.0 || ^19.0.0` in its own peerDependencies — no Next.js bump is required. Every `@radix-ui/react-*` package already pinned in `packages/ui/package.json` (even at its floor `^1.1.0`/`^1.2.0`/`^2.1.0` semver) already declares React 19 in its peerDependencies — Radix needs zero version bumps. A repo-wide grep found **zero** `useRef()` no-arg calls, **zero** `defaultProps`, **zero** `propTypes`, and **zero** string refs — the three classic React-19-breaking patterns are absent. The only React-19 blockers are five specific `packages/ui` runtime dependencies whose *currently pinned* versions cap their peer range at React 18 (react-day-picker, vaul, sonner, react-hook-form, next-themes, lucide-react — detailed version-by-version below); each has a compatible newer version already published. `forwardRef` appears in 37 `packages/ui/src/*.tsx` files but is deprecated-not-removed in React 19, so it does not block the migration.

**Tailwind v4 is the real migration, and its risk is not where the phase brief implies.** The literal STCK-01 gates — `apps/web/src/app/__tests__/token-contrast.test.ts` and `apps/web/src/app/__tests__/token-registration.test.ts` — both parse Tailwind v3-shaped artifacts directly (a bare `"H S% L%"` regex against `globals.css`, and `tailwindcss/resolveConfig` against the JS `tailwind.config.ts`) and **will both break on v4 regardless of what oklch conversion strategy is chosen**, because `resolveConfig()` does not exist in Tailwind v4's CSS-first engine (independently confirmed via WebSearch/GitHub Discussions) and the contrast regex cannot parse an `oklch(...)`-wrapped value. Both need a rewrite, not a value update. Separately, this repo has **86 occurrences of `hsl(var(--x))` written directly in component/test code** across 16 non-`globals.css` files (React Flow inline colors, ag-grid theme objects, arbitrary-value box-shadows) — every one of these breaks the moment `globals.css`'s custom properties stop holding bare triplets and start holding a full `oklch(...)` function, independent of the gate rewrite. Most consequentially, the **WCAG-AA contrast gate that STCK-01 actually names (`packages/genui/src/theme/__tests__/packs.test.ts` + `contrast.ts`) tests `packages/genui/src/theme/packs.ts` — six hand-authored style packs used by the runtime NL re-theme feature — which is a completely separate token surface from `globals.css`, still consumed by `ThemedRoot` as bare HSL triplets, and has a Python mirror** (`apps/email-listener/scripts/genui_eval/style_metrics.py`, plus the live Bedrock re-theme prompt in `genui_retheme_adapter.py`). Converting *that* surface to oklch is out of STCK-01's literal scope, cross-language, and high-risk — the recommended path (detailed in Pitfall 1 below) is to leave it as HSL and let `globals.css` be the only surface that moves to oklch.

**Primary recommendation:** Run the migration in five isolated, gate-checked stages — (1) PostCSS/import/config-in-CSS plumbing, (2) `globals.css` token port to oklch + explicit `@source` registration for the two sibling packages, (3) rewrite the two broken gate tests to parse the new CSS shape directly (no `resolveConfig`), (4) React 19 bump + the six version-pinned dependency bumps, (5) Radix-stays-Radix decision doc + one `@kibo-ui` registry-install proof — each stage independently verified by `npm run test`, `npm run typecheck`, `npm run screenshot:review`, and the 32/32 E2E suite before the next stage starts. Do **not** attempt to convert `packages/genui/src/theme/packs.ts` or its Python mirror to oklch in this phase — it is not required by STCK-01's literal wording, and doing so triples the blast radius for zero requirement credit.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STCK-01 | `apps/web` + `packages/ui` build/run on Tailwind v4; `globals.css` HSL tokens ported to `@theme`/oklch; WCAG-AA contrast + token-family-registration gates stay green | Standard Stack (verified `tailwindcss@4.3.2`/`@tailwindcss/postcss@4.3.2`), Architecture Patterns (Pattern 1 exact CSS shape, 5-stage sequencing + gate map), Pitfalls 1/2/4/5 (the packs.ts/globals.css decoupling decision, the 86 non-globals.css `hsl(var(--x))` call sites, `@source` monorepo requirement, and the two gates' independent breakage causes — `token-contrast.test.ts`'s regex vs `token-registration.test.ts`'s `resolveConfig()` dependency) |
| STCK-02 | `apps/web` + `packages/ui` build/run on React 19; every vendored `packages/ui` component revalidated; zero regressions in the 16-surface screenshot harness + 32/32 E2E | Standard Stack (full peer-dependency matrix — which of the 9 checked runtime deps already support React 19 vs which need a bump, and by how much), Pitfall 3 (`react-day-picker` v9 isolated as the one high-risk component), Don't Hand-Roll (`forwardRef` codemod is optional, not required — 37 usages confirmed still valid under React 19) |
| STCK-03 | Radix-vs-Base-UI stance decided + documented; design-system skill updated | Pattern 3 (shadcn's official July 2026 changelog — Radix explicitly not deprecated, `-b radix` pin mechanism), Sources (changelog URL cited directly) |
| STCK-04 | A direct `shadcn add @kibo-ui/<component>` install works for ≥1 component | Code Examples (`components.json` `tailwind.config: ""` diff per official shadcn v4 docs), Pattern 3 (registry-install workflow interaction with the Radix decision) |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tailwind CSS engine / build config | Frontend Server (SSR) — Next.js build pipeline | Browser (compiled utility classes ship to client) | PostCSS/`@tailwindcss/postcss` runs at Next.js build time in `apps/web`; the compiled CSS is what the browser tier consumes |
| Design tokens (`globals.css` `:root`/`.dark`) | Browser / Client (CSS custom properties, cascade-resolved at paint time) | Frontend Server (source-of-truth file lives in `apps/web/src/app`) | Values are read by the browser via `var()`; the source file is server-tree-shaken at build |
| Style-pack registry (`packages/genui/src/theme/packs.ts`) + runtime re-theme (`ThemedRoot`) | Browser / Client (inline `style` CSS-var injection, React component) | API/Backend (Bedrock-driven NL re-theme prompt lives in `apps/email-listener`) | `ThemedRoot` renders client-side; the *decision* of which pack/values to inject can originate server-side (Bedrock adapter) — two tiers share one token-format contract |
| WCAG-AA contrast gates (`packs.test.ts`, `token-contrast.test.ts`) + eval-harness mirror (`style_metrics.py`) | N/A — build/CI-time verification, not a runtime tier | — | Pure computation on token strings; never reaches a browser or server request path, but must track whichever tier's token format it audits |
| Vendored component library (`packages/ui/src/*.tsx`) | Browser / Client (React components render client- and server-side via RSC) | Frontend Server (server components in the `packages/ui` tree, e.g. `code-block-server.tsx`) | Radix primitives are client components (`"use client"`); a few `packages/ui` files are RSC-safe server components |
| Registry install workflow (`shadcn add @kibo-ui/…`) | Frontend Server (build-time CLI, writes into `packages/ui/src`) | — | The CLI never runs in the browser or in production; it is a dev-time codegen tool writing directly into the vendored-component tree |
| React runtime (18→19) | Browser / Client (reconciler, hooks, ref semantics) | Frontend Server (RSC/SSR reconciliation in Next.js) | React 19's `ref`-as-prop and `useRef` changes affect both client component code and any server-rendered markup shape |

## Standard Stack

### Core

| Library | Currently Installed | Target (verified via `npm view`, 2026-07-15) | Purpose | Why this version |
|---------|---------|---------|---------|--------------|
| `tailwindcss` | `3.4.19` (pinned `^3.4.4` in both `apps/web` and `packages/ui` devDeps) | `^4.3.2` [VERIFIED: npm registry + official tailwindcss.com docs] | CSS engine | Latest v4 minor; official upgrade guide targets this line |
| `@tailwindcss/postcss` | not installed | `^4.3.2` [VERIFIED: npm registry + official tailwindcss.com docs] | v4's PostCSS plugin — replaces the bare `tailwindcss` PostCSS plugin entry | v4 moved the PostCSS integration into its own package; confirmed by official upgrade guide fetch |
| `postcss` | `8.5.16` (devDep `^8.4.39`) | unchanged | PostCSS host | v4's plugin runs on the same PostCSS 8.x host — no bump forced |
| `react` | `18.3.1` (`^18.3.1`) | `^19.2.7` [VERIFIED: npm registry] | UI runtime | Latest stable 19.x; `next@15.5.20`'s own peerDependencies already accept it |
| `react-dom` | `18.3.1` (`^18.3.1`) | `^19.2.7` [VERIFIED: npm registry] | DOM renderer | Must move in lockstep with `react` |
| `@types/react` / `@types/react-dom` | `^18.3.3` / `^18.3.0` | `^19` line (types matching runtime) | TS types | React 19 changes `RefObject<T>` → `RefObject<T \| null>`; mismatched types produce false-negative typechecks |
| `next` | `15.5.20` (`^15.3.3`) | **unchanged** | Framework | Already peer-compatible with React 19 (`react: ^18.2.0 \|\| 19.0.0-rc-de68d2f4-20241204 \|\| ^19.0.0` — verified via `npm view next@15.5.20 peerDependencies`). **Do not bump to Next 16** — out of this phase's scope and an unforced additional variable |
| `shadcn` (CLI, invoked via `npx`/`dlx`, not a devDependency) | n/a (invoked ad hoc) | `4.13.0` [VERIFIED: npm registry + official ui.shadcn.com docs] | Registry install CLI | Confirmed current version; ships the Base UI default discussed in STCK-03 |

### Supporting — `packages/ui` runtime deps requiring a React-19-compatible version bump

Every package below is **already a dependency**; the migration is a version bump, not a new install. Peer-dependency ranges verified with `npm view <pkg>@<pinned-version> peerDependencies` against the *exact currently-pinned* version (not just "latest"), then cross-checked against the minimum version that adds React 19 support.

| Package | Pinned today | Peer range at pinned version | Minimum version with React 19 in peerDeps | Breaking-change risk |
|---------|--------------|-------------------------------|---------------------------------------------|----------------------|
| `react-day-picker` | `^8.10.1` | `react: ^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0` (no 19) | `9.0.0` (`react: >=16.8.0`) | **HIGH** — v9 is a documented full API rewrite (modifiers/classNames/mode types all changed); `packages/ui/src/calendar.tsx` wraps this directly |
| `vaul` | `^0.9.1` | `react: ^16.8 \|\| ^17.0 \|\| ^18.0` (no 19) | `1.1.2` (adds `^19.0.0 \|\| ^19.0.0-rc`) — note `1.1.0`/`1.1.1` still cap at 18 | LOW — drawer API stable across 0.9→1.1 |
| `sonner` | `^1.4.41` | `react: ^18.0.0` (no 19) | `1.7.4` (adds `^19.0.0`) — **stays in the 1.x line**, no need to jump to the 2.x major | LOW — same major, additive peer range only |
| `react-hook-form` | `^7.51.4` | `react: ^16.8.0 \|\| ^17 \|\| ^18` (no 19) | `7.53.0`+ (adds `^19`) — **stays in the 7.x line** | LOW — same major |
| `next-themes` | `^0.3.0` | `react: ^16.8 \|\| ^17 \|\| ^18` (no 19) | `0.4.6` (adds `^19 \|\| ^19.0.0-rc`) | LOW-MEDIUM — 0.x semver means any minor is technically breaking-eligible; changelog review recommended before bump |
| `lucide-react` | `^0.364.0` | `react: ^16.5.1 \|\| ^17.0.0 \|\| ^18.0.0` (no 19) | `0.400.0` (adds `^19.0.0`) — **stays in the 0.x line**, no need to jump to the `1.x` major (`1.24.0` is latest but unnecessary) | LOW — icon-only library, stable API within 0.x |
| `react-resizable-panels` | `^2.0.19` | `react: ^16.14.0 \|\| ^17.0.0 \|\| ^18.0.0` (no 19) | `3.0.0` (adds `^19.0.0 \|\| ^19.0.0-rc`) — **is** a major bump (no 2.x version adds 19 support) | MEDIUM — v2→v3 major; `apps/web` uses this for the chat/canvas resizable dock — smoke-test panel resize after bump |
| `tailwind-merge` | `^2.3.0` | n/a (no react peer) | `^3.x` recommended (not React-forced, but v3 targets Tailwind v4's expanded utility surface — e.g. new arbitrary-value/opacity syntax) | LOW-MEDIUM — check `packages/ui`'s `cn()` helper (uses `tailwind-merge` + `clsx`) still dedupes classes correctly post-bump; v2 on a v4 project can silently fail to merge new v4-only utility variants |

**Already React-19-compatible at the currently-pinned version — no bump required:**
`@radix-ui/react-*` (all packages, verified `react-dialog@1.1.0`, `react-select@2.1.0`, `react-switch@1.1.0`, `react-tabs@1.1.0`, `react-accordion@1.2.0`, `react-avatar@1.1.0`, `react-checkbox@1.1.0` — every one already declares `react: ^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc`), `cmdk@1.0.0` (`^18 || ^19`), `recharts@2.15.3` (`^16.0.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`), `ag-grid-react@35.1.0`/`ag-grid-community@35.1.0` (`^16.8.0…^19.0.0`), `react-dropzone@15.0.0` (`>= 16.8`, open-ended), `motion@12.42.2` (`^18.0.0 || ^19.0.0`), `@hookform/resolvers@3.3.4` (peers only on `react-hook-form`, not `react` directly), `@radix-ui/react-icons@1.3.2`, `react-icons@5.7.0` (`react: '*'`). Apps/web-level deps are also already fine: `@xyflow/react@12.11.0` (`>=17`), `@tanstack/react-query@5.62.0` (`^18 || ^19`), `react-markdown@10.1.0` (`>=18`), `react-pdf@9.2.1` (`^16.8.0…^19.0.0`), `@trpc/react-query@11.8.0` (`>=18.2.0`, open-ended).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Full `packages/genui` token-format port to oklch (matching `globals.css`) | Keep `packages/genui/src/theme/packs.ts` on HSL triplets permanently | Recommended (see Pitfall 1). A full port touches two languages, three test files, and a live LLM prompt for zero STCK-01 requirement credit — STCK-01 only names `globals.css` |
| `@config "../../tailwind.config.js"` compatibility shim to keep JS config alive | Full port of `theme.extend` to `@theme` CSS blocks | The shim does NOT fix `token-registration.test.ts` (which needs `resolveConfig()`, gone in v4 regardless of `@config` use) — since that gate must be rewritten either way, going straight to native `@theme` blocks avoids maintaining a permanent JS/CSS hybrid |
| Bump `react-day-picker` to `9.0.0` (rewrite) | Pin at `9.x` and treat `Calendar` as its own isolated task with a dedicated before/after screenshot diff | `react-day-picker` v9 changed prop names, `Modifiers` typing, and default class names — the only genuinely high-risk single-component revalidation in this phase; isolate it, do not fold into a bulk dependency-bump commit |
| Base UI primitives (upstream shadcn's new default) | Stay on Radix, pin explicitly via `shadcn init -b radix` / a documented decision | See STCK-03 discussion below — Radix is not deprecated, shadcn still ships both, and a swap would revalidate all 37 `forwardRef`-based `packages/ui` components against a different a11y/DOM contract for zero phase-scoped payoff |

**Installation (representative — exact bump commands, run from repo root, npm workspaces):**
```bash
# apps/web + packages/ui: Tailwind v4 engine
npm install -w @polytoken/web -w @polytoken/ui tailwindcss@^4.3.2 @tailwindcss/postcss@^4.3.2

# React 19 (apps/web is the only workspace with a direct react/react-dom dependency;
# packages/ui declares react/react-dom as peerDependencies + devDependencies only)
npm install -w @polytoken/web react@^19.2.7 react-dom@^19.2.7
npm install -w @polytoken/web -D @types/react@^19 @types/react-dom@^19
npm install -w @polytoken/ui -D react@^19.2.7 react-dom@^19.2.7 @types/react@^19
# packages/ui/package.json peerDependencies block also needs react/react-dom ranges widened to include ^19

# packages/ui: the six version-pinned runtime deps
npm install -w @polytoken/ui react-day-picker@^9.0.0 vaul@^1.1.2 sonner@^1.7.4 \
  react-hook-form@^7.81.0 next-themes@^0.4.6 lucide-react@^0.400.0 \
  react-resizable-panels@^3.0.0 tailwind-merge@^3.6.0
```

**Version verification performed:** every version above was confirmed live against the npm registry on 2026-07-15 via `npm view <pkg> version` / `npm view <pkg>@<version> peerDependencies` — not from training-data recall. Training-data package *names* for the ecosystem (Radix, shadcn, Tailwind, react-day-picker, vaul, etc.) matched registry results exactly, so no name-hallucination risk was found.

## Package Legitimacy Audit

slopcheck (`0.6.1`) was installed successfully via `pip install slopcheck` this session, but a runtime safety classifier declined to let it execute (`install`/`scan` subcommands) against this repo's package.json files, treating the tool invocation itself as an unauthorized action. Per the graceful-degradation clause, this audit falls back to manual ecosystem-registry verification (already performed for every package in the Standard Stack tables above via `npm view`) plus repository-URL cross-checks. **This audit is lower-risk than a typical new-dependency audit**: every package below except `@tailwindcss/postcss` and the `shadcn` CLI is **already a committed dependency in this repo's `package.json` files** (read directly, not LLM-suggested) — the "install" here is a version bump of an already-audited package, not a new supply-chain surface.

| Package | Registry | Repo status | Source Repo (verified via `npm view … repository.url`) | Disposition |
|---------|----------|-------------|----------------------------------------------------------|-------------|
| `tailwindcss` | npm | existing dep, version bump | github.com/tailwindlabs/tailwindcss | Approved — official Tailwind Labs package |
| `@tailwindcss/postcss` | npm | **new** dep | github.com/tailwindlabs/tailwindcss (same monorepo) | Approved [CITED: tailwindcss.com upgrade guide] |
| `shadcn` (CLI) | npm | not a dep, invoked via `npx` | github.com/shadcn-ui/ui | Approved [CITED: ui.shadcn.com docs] |
| `react` / `react-dom` | npm | existing dep, version bump | github.com/facebook/react | Approved — official React org package |
| `react-day-picker` | npm | existing dep, major bump | github.com/gpbl/react-day-picker | Approved — flag [WARNING: major version, largest single-component blast radius in this phase — see Pitfall 3] |
| `vaul` | npm | existing dep, version bump | github.com/emilkowalski/vaul | Approved |
| `sonner` | npm | existing dep, version bump | github.com/emilkowalski/sonner | Approved |
| `cmdk` | npm | existing dep, no bump needed | github.com/pacocoursey/cmdk | Approved |
| `react-hook-form` | npm | existing dep, version bump | github.com/react-hook-form/react-hook-form | Approved |
| `next-themes` | npm | existing dep, version bump | github.com/pacocoursey/next-themes | Approved |
| `lucide-react` | npm | existing dep, version bump | github.com/lucide-icons/lucide | Approved |
| `react-resizable-panels` | npm | existing dep, major bump | github.com/bvaughn/react-resizable-panels | Approved — flag [WARNING: major version — smoke-test canvas/chat dock resize] |
| `tailwind-merge` | npm | existing dep, major bump | github.com/dcastil/tailwind-merge | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none — slopcheck could not execute this session (see above); no package name in this audit was discovered via an unverified/non-authoritative source (all confirmed present in the repo's own committed `package.json` files or in official Tailwind/shadcn documentation).
**Packages flagged as suspicious [SUS]:** none via slopcheck (tool blocked); manually flagged for elevated review due to major-version blast radius: `react-day-picker` (v9 API rewrite), `react-resizable-panels` (v3 major). The planner should still gate the actual `npm install` step behind a lightweight verification (diff `npm view <pkg> versions` immediately before running, confirm no last-minute registry anomaly) since the automated slopcheck gate did not run.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  BUILD TIME (Next.js / PostCSS, apps/web)                            │
│                                                                        │
│  apps/web/src/app/globals.css                                        │
│    @import "tailwindcss"          ──────────────┐                    │
│    @source "../../../packages/ui/src"            │  v4 auto-content  │
│    @source "../../../packages/genui/src"          │  detection does  │
│    @theme { --color-primary: var(--primary); }   │  NOT reach sibling│
│    :root { --primary: oklch(...); }               │  workspace pkgs  │
│    .dark { --primary: oklch(...); }               │  by default — see│
│                                    ▼                │  Pitfall 4       │
│  postcss.config.cjs → @tailwindcss/postcss ──► compiled CSS bundle   │
└───────────────────────┬────────────────────────────────────────────┘
                         │ ships to browser
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER (React 19 client tree)                                      │
│                                                                        │
│  packages/ui/src/*.tsx (53 top-level components + 17-file             │
│  spreadsheet-grid subsystem) — Radix primitives (unchanged),          │
│  forwardRef-based (still valid, deprecated-not-removed)               │
│                                    │                                   │
│  packages/genui ThemedRoot ───────┤ reads packs.ts (STAYS HSL,        │
│  (runtime NL re-theme surface)     │ decoupled from globals.css —      │
│                                     │ see Pitfall 1)                   │
│                                    ▼                                   │
│  16 non-globals.css call sites doing hsl(var(--x)) directly            │
│  (chat-canvas.tsx, graph-nodes.tsx, sidebar.tsx, ag-grid theme         │
│  objects, …) — MUST drop the hsl() wrapper → var(--x) directly         │
│  once globals.css vars hold full oklch(...) strings (Pitfall 2)        │
└───────────────────────┬────────────────────────────────────────────┘
                         │ verified by
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CI / TEST GATES (vitest, Playwright)                                │
│                                                                        │
│  apps/web/src/app/__tests__/token-contrast.test.ts                   │
│    — regexes globals.css :root/.dark DIRECTLY. BREAKS on oklch;       │
│      needs its own oklch parser (Gate A — see Pitfall 5)              │
│  apps/web/src/app/__tests__/token-registration.test.ts                │
│    — imports tailwindcss/resolveConfig (GONE in v4, independent of    │
│      value format). Needs full rewrite to string-parse @theme/CSS     │
│      instead of resolveConfig() (Gate B — see Pitfall 5)               │
│  packages/genui/src/theme/__tests__/packs.test.ts + contrast.ts       │
│    — tests packs.ts (STAYS HSL) — untouched if Pitfall 1 followed      │
│      (Gate C — trivially green, zero code changes needed)              │
│  apps/web/src/app/__tests__/palette-ban.test.ts                       │
│    — greps for classic Tailwind palette classes (slate/gray/teal-N…)  │
│      unaffected by the v4/oklch migration; still exercised by any     │
│      component code touched during React-19 dependency bumps          │
│  npm run screenshot:review (16-surface harness) + 32/32 Playwright    │
│    E2E — the only gates that catch a REAL rendered-pixel regression;  │
│    run after EVERY stage below, not just at the end                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Migration Sequencing (blast-radius-isolated stages)

```
apps/web/
├── postcss.config.cjs         # Stage 1: swap plugin key only
├── tailwind.config.ts         # Stage 1→3: @config shim during Stage 1, deleted by Stage 3
├── src/app/globals.css        # Stage 2: @import + @theme + oklch :root/.dark + @source
└── src/app/__tests__/
    ├── token-contrast.test.ts      # Stage 3: rewrite oklch-aware parser
    └── token-registration.test.ts  # Stage 3: rewrite off resolveConfig()

packages/ui/
├── package.json                # Stage 4: react/react-dom peerDeps widened to ^19; 6 pkg bumps
├── tailwind.config.ts          # Stage 2/3: IntelliSense-only — keep in sync or delete (see below)
└── src/calendar.tsx            # Stage 4, ISOLATED sub-task: react-day-picker v9 API rewrite

packages/genui/
└── src/theme/{packs.ts,themed-wrapper.tsx}  # NO CHANGES (Pitfall 1) — verify via existing
                                                packs.test.ts staying green with zero edits

docs/design/ + .claude/skills/polytoken-design-system/SKILL.md  # Stage 5: STCK-03 decision doc
```

### Stage-by-stage gate map

| Stage | Change | Gate that verifies it | Gate that would catch a regression |
|-------|--------|------------------------|-------------------------------------|
| 1. PostCSS + import plumbing | `postcss.config.cjs` plugin swap; `globals.css` top 3 lines `@tailwind ...` → `@import "tailwindcss"` | `npm run dev` boots, no PostCSS error | Build failure is immediate and loud — lowest-risk stage |
| 2. Token port to oklch + `@source` | `:root`/`.dark` blocks converted; explicit `@source` for `packages/ui` + `packages/genui`; the 16 non-globals.css `hsl(var(--x))` call sites updated to `var(--x)` | `npm run screenshot:review` (visual diff across all 16 surfaces) | **This is the stage most likely to silently break styling** — a missing `@source` directive means classes used only inside `packages/ui` get purged from production CSS with no build error (Pitfall 4) |
| 3. Gate rewrites | `token-contrast.test.ts` + `token-registration.test.ts` rewritten to parse the new CSS shape without `resolveConfig()` | `npm run test` (vitest) — both files must independently pass | If skipped, CI is silently green on a gate that no longer tests anything real (or hard-fails and blocks all further work — either way, must be fixed before Stage 4) |
| 4. React 19 + dependency bumps | `react`/`react-dom` → 19; 6 `packages/ui` deps bumped; `react-day-picker` v9 API updated in `calendar.tsx` | `npm run typecheck` (catches `RefObject<T>` type changes), `npm run test:e2e` (32/32), `npm run screenshot:review` | Type errors surface at `typecheck`; runtime breakage (e.g. a v9 `Calendar` prop rename) surfaces only in E2E/screenshot — do not skip these for this stage |
| 5. STCK-03 decision + STCK-04 proof | Radix-stays decision doc; `components.json` `tailwind.config: ""`; one `shadcn add @kibo-ui/<component>` proof install | Manual verification: new component renders in `/dev/components`, typechecks, passes `palette-ban.test.ts` | N/A — new code, not a regression surface |

### Pattern 1: `@theme inline` + full-color-function CSS variables (the shadcn v4 canonical shape)

**What:** Tailwind v4's shadcn convention stores the *entire* color function (not bare channel numbers) inside the CSS custom property, then maps it into Tailwind's theme namespace via `@theme inline`.

**When to use:** For every color token in `globals.css`'s `:root`/`.dark` blocks.

**Example — before (this repo, current v3 shape):**
```css
:root {
  --primary: 164 39% 22%;        /* bare HSL triplet */
}
/* tailwind.config.ts: colors.primary = "hsl(var(--primary))" */
```

**Example — after (v4 shape, source: ui.shadcn.com/docs/theming, official docs fetch):**
```css
@import "tailwindcss";
@source "../../../packages/ui/src";
@source "../../../packages/genui/src";

@theme inline {
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  /* … one line per existing token family: background, foreground, card,
     popover, secondary, muted, accent, destructive, success, border, input,
     ring, chart-1..5, radius/radius-xl/radius-2xl/radius-pill, sidebar-*,
     tier-extracted/-inferred (+foreground), graph-entity/-email-component/
     -email (+foreground) — every alias currently in this repo's globals.css
     needs a mapping line; nothing is auto-inferred by @theme inline */
}

:root {
  --primary: oklch(37.6% 0.061 165.6);   /* full function — converted from 164 39% 22% */
  --primary-foreground: oklch(98% 0 0);
  /* … */
}
.dark { /* mirrored, same structure */ }
```

**Critical corollary — every direct `hsl(var(--x))` call site must drop the wrapper:**
```tsx
// packages/ui/src/sidebar.tsx:541 — BEFORE (v3, bare triplet in the var)
"shadow-[0_0_0_1px_hsl(var(--sidebar-border))]"

// AFTER (v4, var already holds the full oklch(...) function)
"shadow-[0_0_0_1px_var(--sidebar-border)]"
```
This applies to all 16 files found via `grep -rln "hsl(var(--" apps/web/src packages/ui/src packages/genui/src` excluding `globals.css` itself: `chat-canvas.tsx`, `knowledge-preview-mini-graph.tsx`, `panel-theme-scope.tsx` (comment only, update wording), `graph-legend.tsx`, `graph-nodes.tsx`, `tier-edge-style.ts` (+ its `.test.ts`), `token-registration.test.ts` (being rewritten anyway), `sidebar.tsx`, `spreadsheet-grid/conditional-formatting-dialog.tsx`, `spreadsheet-grid/SpreadsheetGrid.tsx`, `spreadsheet-grid/theme.css`, and the untracked `apps/web/src/app/dev/design/design-data.json`/`page.tsx` (regenerate via the design-data build script rather than hand-editing — see Pitfall 6).

### Pattern 2: `@config` as a *diagnostic* stepping stone, not a destination

**What:** Tailwind v4's `@config "../tailwind.config.js"` directive loads a legacy JS config for incremental migration [CITED: tailwindcss.com/docs/functions-and-directives].

**When to use:** Only transiently, if at all, to isolate whether a build failure comes from the CSS-import change (Stage 1) versus the config-shape change (Stage 2/3) — **not** as the phase's end state, because `token-registration.test.ts` needs a full rewrite regardless (its `resolveConfig()` dependency is gone in v4 independent of whether `@config` is used), so there is no compatibility payoff to keeping the JS config alive long-term. `corePlugins`, `safelist`, and `separator` options are explicitly unsupported under `@config` in v4.0 [CITED: tailwindcss.com].

**This repo's actual config surface is small enough to port directly to `@theme`:** `packages/tailwind-config/{base,web}.ts` + `apps/web/tailwind.config.ts` together define: `content` globs (→ `@source` directives), `container` centering/padding/screens (→ `@utility`/`@theme` breakpoint vars), `borderRadius` (4 mappings, already CSS-var-driven), `keyframes`/`animation` (9 custom animations for vendored Magic UI components — accordion, marquee×2, shimmer-slide, spin-around, shine, blink-cursor — → `@theme` `--animate-*`/`@keyframes` blocks), `colors.sidebar` (8 CSS-var-driven entries), and `fontFamily` (sans/mono/code). None of this requires JS-level logic (no functions, no environment branching) — it is a mechanical port.

### Pattern 3: Radix-stays-Radix, documented via the official escape hatch (STCK-03)

**What:** shadcn's July 2026 changelog [CITED: ui.shadcn.com/docs/changelog/2026-07-base-ui-default] states explicitly: *"Radix is not being deprecated — the team still supports it, and every update and new component will ship for both libraries unless a component only exists in Base UI… if an app works, developers should keep shipping."* The CLI flag `-b radix` pins `shadcn init`/`shadcn add` to the Radix track for non-interactive/CI use.

**When to use:** This phase. A full swap to Base UI would mean re-validating the DOM/accessibility contract of all 37 `forwardRef`-based, Radix-wrapping `packages/ui` components against a library with a different API shape (Base UI is not a drop-in Radix replacement — different prop names, different composition patterns) for **zero requirement credit** — STCK-03 only requires the stance to be *decided and documented*, not executed.

**Recommendation:** Stay on Radix. Update `.claude/skills/polytoken-design-system/SKILL.md`'s "Stack pin" section (currently: *"Primitives: Radix… Upstream shadcn defaults to Base UI since July 2026 — stay on the Radix track; diff any payload before vendoring"* — already correctly anticipates this) to cite the specific changelog and the `-b radix` mechanism, and add a `docs/design/radix-vs-base-ui.md` decision record with the rationale (37 existing components, zero forcing function, official non-deprecation statement) and a **re-evaluation trigger** (e.g., "revisit if a needed component ships Base UI-only").

### Anti-Patterns to Avoid
- **Wrapping an already-oklch CSS variable in `hsl()`** — produces invalid CSS (`hsl(oklch(...))`) that fails silently (browser ignores the declaration, element falls back to inherited/default color) rather than throwing a build error. This is the single most likely silent-regression vector in Stage 2; grep for `hsl(var(--` as a post-Stage-2 verification step, not just a pre-Stage-2 discovery step.
- **Converting `packages/genui/src/theme/packs.ts` to oklch "while we're in there"** — see Pitfall 1. Out of scope, cross-language, triples blast radius.
- **Bulk-bumping all `packages/ui` dependencies in one commit** — `react-day-picker` and `react-resizable-panels` are major-version bumps with real API surface changes; isolate them into their own commits/tasks so a screenshot regression can be bisected to one dependency, not a batch of nine.
- **Relying on `npx @tailwindcss/upgrade`'s codemod for `globals.css`'s hand-authored `:root`/`.dark` blocks** — the codemod's documented scope is `tailwind.config.js` extension migration and template-file class renames; it was not confirmed (via official docs) to convert bespoke, hand-written CSS custom properties in an app's own stylesheet to oklch. Treat the codemod as useful for Stage 1 mechanical changes (import syntax, PostCSS plugin) and do the `:root`/`.dark` oklch conversion by hand or with a small conversion script (verify each converted value still clears WCAG-AA via a throwaway script using the exact `contrastRatio()` math already in `token-contrast.test.ts`, adapted for oklch, before committing).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HSL/oklch color-space math for the new `token-contrast.test.ts` | A bespoke oklch-to-luminance formula from scratch | The `culori` npm package (`oklch`/`converter('rgb')` functions) for the *test-time* conversion, OR precompute oklch equivalents once via a throwaway script and hard-code them as literals in `globals.css` (test then just needs to parse `oklch(L C H)` triplets directly, no HSL↔oklch conversion at test-time at all) | WCAG relative-luminance math from raw oklch requires oklch→linear-sRGB conversion (via CIE XYZ), which is easy to get subtly wrong (gamut clipping edge cases); a maintained library is safer for a security/accessibility gate |
| Tailwind v4 class-conflict resolution after the `tailwind-merge` bump | Custom regex-based class deduplication in `cn()` | Keep using `tailwind-merge` (already the standard), just bump to v3.x — do not attempt to hand-patch v2's utility-class knowledge for v4's new syntax | `tailwind-merge` v3 is purpose-built to track Tailwind v4's expanded arbitrary-value/opacity-modifier syntax; a hand patch would need to be re-derived every time Tailwind adds a utility |
| React 19 `forwardRef` removal | A repo-wide sed/codemod pass converting all 37 `packages/ui` `forwardRef` usages to prop-based `ref` in this phase | `npx react-codemod@latest react-19/remove-forward-ref <path>` — the official codemod — **and only run it as an explicit, separate, opt-in task if the team decides to modernize now; it is not required for STCK-02** ("revalidated," not "rewritten") | `forwardRef` still works in React 19 (deprecated, not removed); forcing a rewrite inflates STCK-02's actual blast radius for a non-requirement |

**Key insight:** This phase's biggest hand-roll temptation is the WCAG-AA contrast math — this repo already has it hand-rolled *twice* (`apps/web`'s `token-contrast.test.ts` and `packages/genui`'s `contrast.ts`), plus a *third* Python copy (`style_metrics.py`). Do not add a fourth hand-rolled implementation for oklch; either reuse `culori` or avoid runtime conversion entirely by hard-coding the converted oklch literals.

## Common Pitfalls

### Pitfall 1: Treating `globals.css` and `packages/genui/src/theme/packs.ts` as one token surface

**What goes wrong:** STCK-01 says "the HSL tokens in `globals.css` are ported to `@theme`/oklch." It is tempting to also convert `packages/genui/src/theme/packs.ts`'s six style packs (the runtime NL re-theme feature's data) to oklch "for consistency." This is a *different* token surface: `ThemedRoot` (`packages/genui/src/theme/themed-wrapper.tsx`) injects `pack.resolvedVars` as bare `--<var>: <value>` inline styles, explicitly documented as matching "globals.css declares `--primary: 164 39% 22%` (HSL channels, no `hsl()` wrapper)." Converting it means also updating: the Bedrock NL re-theme prompt (`apps/email-listener/app/infrastructure/llm/genui_retheme_adapter.py`), the Python eval-harness contrast math (`apps/email-listener/scripts/genui_eval/style_metrics.py` + `rubric.py`), and `apps/email-listener/tests/test_genui_eval_style.py`'s format assertions — a cross-language, LLM-prompt-contract change with zero STCK-01 requirement credit.
**Why it happens:** "Consistency" is an attractive-sounding but unscoped goal; the requirement text names one file (`globals.css`), not a system-wide format.
**How to avoid:** Explicitly decide (and record in the phase's plan) that `packages/genui/src/theme/packs.ts` **stays HSL**. `ThemedRoot` will therefore, after migration, inject bare HSL triplets into a CSS custom property whose *unthemed default* (from `globals.css`) is a full `oklch(...)` string — this is valid: overriding `--primary: 164 39% 22%` (bare, currently invalid on its own — always was, since `ThemedRoot` never wrapped it either) actually needs one fix regardless: **`ThemedRoot` must wrap its injected values in `hsl(...)` explicitly** (`cssVarStyle['--primary'] = \`hsl(${value})\`` instead of the current bare assignment) so that the browser can parse it as a color function once component code stops doing `hsl(var(--x))` at the call site (Pattern 1's corollary). This is a **one-file, few-line change** to `themed-wrapper.tsx` — not a token-value rewrite.
**Warning signs:** If a plan task touches `packages/genui/src/theme/packs.ts`'s color VALUES (not just adjacent code) or any `apps/email-listener` Python file for "oklch conversion," it has scope-crept past STCK-01.

### Pitfall 2: The 86 direct `hsl(var(--x))` call sites are invisible to a naive "port globals.css" task

**What goes wrong:** A plan that scopes Stage 2 as "edit `globals.css`" will build successfully (Tailwind compiles fine) but silently mis-render every React Flow canvas background/minimap, every ag-grid spreadsheet surface, the sidebar's box-shadow ring, and the knowledge-graph edge/node colors — because those 16 files still do `hsl(var(--newly-oklch-value))`, which is invalid CSS the browser drops silently (no console error in most cases; the computed style just falls back).
**Why it happens:** These are inline JS/TS string literals (React Flow props, ag-grid theme objects, Tailwind arbitrary-value classes), not CSS files — a search scoped to `*.css` misses all of them.
**How to avoid:** The exact file list is enumerated in Pattern 1 above (found via `grep -rln "hsl(var(--" apps/web/src packages/ui/src packages/genui/src`, excluding `globals.css`). Update every one in the same Stage-2 task as the `globals.css` edit, and re-run this exact grep as the task's own completion check — zero matches outside `globals.css`/`packs.ts`/`themed-wrapper.tsx` (which stay HSL by design, Pitfall 1) is the pass condition.
**Warning signs:** `npm run screenshot:review` shows the canvas background grid, minimap, sidebar ring, or knowledge-graph edges rendering as black/transparent/default instead of the teal-derived tones.

### Pitfall 3: `react-day-picker` v8→v9 is a full API rewrite, not a version bump

**What goes wrong:** `packages/ui/src/calendar.tsx` wraps `react-day-picker`'s `DayPicker` component. Between v8.10.1 (currently pinned) and v9.x, the library changed its `classNames` prop shape, renamed several `modifiers`/`mode` types, and changed default CSS class names — a naive `npm install react-day-picker@^9` followed by `npm run typecheck` will surface type errors at `calendar.tsx`, but a silent *visual* regression (wrong day highlighting, broken range-select styling) will only show up in the screenshot harness or manual click-through, since TypeScript cannot catch a CSS-class-name mismatch.
**Why it happens:** react-day-picker's own docs frame v9 as a from-scratch rewrite (confirmed: v9.0.0's peerDependencies loosened to `react: >=16.8.0`, a signal of a broader API-surface change, not just a React-version bump).
**How to avoid:** Isolate `calendar.tsx`'s upgrade into its own task, separate from the other five dependency bumps. After the bump, diff `calendar.tsx` against react-day-picker's v9 migration guide (fetch at plan/execution time — not cached here, since this is exactly the kind of narrow API detail that should be verified fresh against the version actually installed), then screenshot-diff any surface that renders a `<Calendar>` (check `/dev/components` and the component catalog for consumers).
**Warning signs:** `npm run typecheck` errors in `calendar.tsx` referencing removed/renamed `react-day-picker` exports; visually, a date picker with no selected-day highlight or broken keyboard navigation.

### Pitfall 4: Tailwind v4's automatic content detection does not reach sibling monorepo packages

**What goes wrong:** Tailwind v4 scans for class names starting from the CSS entry file's location outward, and explicitly does **not** automatically reach sibling workspace packages outside that tree [CITED: tailwindcss.com/docs/detecting-classes-in-source-files — "By default, Tailwind does NOT automatically scan sibling monorepo packages"]. This repo's current v3 `apps/web/tailwind.config.ts` explicitly lists `content: [...baseConfig.content, "../../packages/ui/src/**/*.{ts,tsx}", "../../packages/genui/src/**/*.{ts,tsx}"]` — meaning **every Tailwind class used only inside `packages/ui` or `packages/genui` (i.e., most of the vendored component library's own styling) currently relies on this explicit content registration.** If the v4 migration drops this without an equivalent `@source` directive, production builds will purge those classes (dev mode may partially mask this via broader HMR behavior, making the bug invisible until a production build).
**Why it happens:** v4's marketing message ("automatic content detection, no config needed") is true for the common single-app case but not for a monorepo where component source lives in a sibling package outside the CSS file's own directory tree.
**How to avoid:** Add explicit `@source "../../../packages/ui/src";` and `@source "../../../packages/genui/src";` directives directly inside `apps/web/src/app/globals.css` (paths relative to the CSS file's own location — verify the exact relative path at implementation time, since `globals.css` lives at `apps/web/src/app/`, three levels below the workspace root) — this is a direct CSS-native replacement for the current JS `content` array, not an optional nicety.
**Warning signs:** A production build (`npm run build`) succeeds, but `packages/ui` components render unstyled or with only base HTML styling when the app is served — this class of bug will NOT show up in `npm run dev` if Next's dev-mode CSS handling differs from its production purge behavior; test with an actual production build, not just dev.

### Pitfall 5: The two named STCK-01 gates need a rewrite, not a value update — and for different reasons

**What goes wrong:** A plan that treats "keep the WCAG-AA + token-registration gates green" as "run `npm test` and fix whatever breaks" underestimates two distinct root causes: (a) `token-contrast.test.ts`'s `parseHslTriplet` regex (`/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/`) cannot match an `oklch(0.376 0.061 165.6)` string at all — it will throw `Cannot parse HSL triplet` on every token; (b) `token-registration.test.ts` imports `tailwindcss/resolveConfig` and calls `resolveConfig(appConfig)` — this function does not exist in Tailwind v4 (independently confirmed via a GitHub Discussions thread on `tailwindlabs/tailwindcss`, not just a single blog post), so this file fails at the `import` line regardless of whether `tailwind.config.ts` itself still exists via `@config`.
**Why it happens:** Both gates were written against Tailwind v3's JS-config, bare-triplet-CSS-var world; v4 changes both the value format (a) and the introspection API (b) independently.
**How to avoid:** Rewrite `token-contrast.test.ts`'s parser to accept `oklch(L C H)` (keep the existing `readTokenBlock` regex-over-raw-CSS-text approach — it is engine-agnostic, it just needs a new value-format parser and a new contrast-ratio path from oklch, e.g. via `culori`). Rewrite `token-registration.test.ts` to drop `resolveConfig()` entirely and instead directly parse the `@theme inline` block of `globals.css` for the expected `--color-sidebar*`/`--color-chart-*`/`--shadow-elevation-*`/`--radius-xl`/`--radius-2xl` mapping lines (same string-parsing technique `token-contrast.test.ts` already uses via `readTokenBlock` — reuse/export that helper rather than writing a third parser).
**Warning signs:** `npm run test` in `apps/web` fails immediately after Stage 2 with either a thrown parse error (gate A) or a module-resolution/`undefined is not a function` error on `resolveConfig` (gate B) — both are expected and gate the transition into Stage 3, not a sign something else is wrong.

### Pitfall 6: The untracked `apps/web/src/app/dev/design/` scratch dir has stale `nauta`-era comments and a hard-coded HSL-triplet Swatch renderer

**What goes wrong:** `apps/web/src/app/dev/design/page.tsx` and `previews-core.tsx`/`previews-vendored.tsx` (all currently **untracked** per `git status`) contain a header comment referencing `.claude/skills/nauta-design-system/scripts/build-design-data.mjs` — the actual skill directory was renamed to `polytoken-design-system` (confirmed: `.claude/skills/polytoken-design-system/` exists; `nauta-design-system` does not). Separately, `page.tsx`'s `Swatch` component does `const isHslTriplet = /^[\d.]+ [\d.%]+ [\d.%]+$/.test(value); if (!isHslTriplet) return null;` — after the oklch port, `design-data.json`'s token values (regenerated from `globals.css` by `build-design-data.mjs`) will be `oklch(...)` strings, which this regex will reject, silently hiding every color swatch on the `/dev/design` reference page.
**Why it happens:** This page is explicitly excluded from the `palette-ban.test.ts` gate (`app/dev/**` is structurally excluded) and from most automated checks, since it is "user-owned scratch" (999.14) — it will not fail CI, it will just visually break.
**How to avoid:** After Stage 2, regenerate `design-data.json` via `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs` (already the documented refresh command) and update `Swatch`'s regex to also accept `oklch(...)` strings — or better, since the script is authoritative and the file is regenerated (not hand-edited per its own header comment), fix the stale skill-path comment and the `isHslTriplet` check in the same pass. This is optional-but-cheap (not a phase requirement — `/dev/design` is explicitly out of the re-skin's/palette-ban's surface area) but worth one small task since it is the design-system's own reference/consultation surface and the SKILL.md explicitly documents it as load-bearing tooling.
**Warning signs:** None automated — this is a visual-only, manually-discovered gap. Note it in the plan as a low-priority cleanup task, not a blocking gate.

## Code Examples

### PostCSS plugin swap (Stage 1)
```js
// apps/web/postcss.config.cjs — BEFORE
module.exports = {
  plugins: {
    tailwindcss: {},
  },
};

// AFTER
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```
Source: [CITED: tailwindcss.com/docs/upgrade-guide]. This repo's current config has no `autoprefixer` entry to remove (already absent) and no `postcss-import` entry either — the swap is a single-line change.

### `components.json` update for STCK-04 (registry install proof)
```diff
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "new-york",
    "rsc": true,
    "tsx": true,
    "tailwind": {
-     "config": "tailwind.config.ts",
+     "config": "",
      "css": "../../apps/web/src/app/globals.css",
      "baseColor": "neutral",
      "cssVariables": true
    },
```
Source: [CITED: ui.shadcn.com/docs/components-json — "For Tailwind CSS v4, leave this blank."]. Run `npx shadcn@latest add @kibo-ui/<component> --dry-run --view` first (per this repo's existing vendor-and-adapt workflow in SKILL.md) to confirm the payload resolves cleanly against the migrated `components.json` before attempting a direct (non-dry-run) install for the STCK-04 proof component.

### `@theme` breakpoint/animation port (Stage 2/3, representative slice)
```css
/* packages/tailwind-config/web.ts's container + keyframes, ported to @theme */
@theme {
  --breakpoint-2xl: 1400px; /* container screens."2xl" */
  --animate-marquee: marquee var(--duration) infinite linear;
  --animate-accordion-down: accordion-down 0.2s ease-out;
}
@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(calc(-100% - var(--gap))); }
}
```
This is a mechanical, one-to-one port of `packages/tailwind-config/web.ts`'s `theme.extend.keyframes`/`animation` — all 9 custom animations (`accordion-down/up`, `marquee`, `marquee-vertical`, `shimmer-slide`, `spin-around`, `shine`, `blink-cursor`) need an equivalent `@keyframes` + `--animate-*` pair. Verify each vendored Magic UI component (`marquee.tsx`, `shimmer-button.tsx`, `shine-border.tsx`, `typing-animation.tsx`) still animates correctly post-port via the screenshot harness — these are exactly the kind of "vendored component revalidation" STCK-02 names, but the root cause here is a Tailwind config change, not a React 19 change.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `@tailwind base/components/utilities` directives | `@import "tailwindcss"` | Tailwind v4.0 (Jan 2025 GA) | One-line swap, Stage 1 |
| JS `tailwind.config.js`/`.ts` as the sole config source | CSS-native `@theme` blocks (JS config supported only via `@config` compatibility shim) | Tailwind v4.0 | This repo's config is small/mechanical enough to port directly rather than shim |
| `tailwindcss` as the PostCSS plugin | `@tailwindcss/postcss` dedicated package | Tailwind v4.0 | Stage 1 |
| Bare HSL-triplet CSS custom properties (`--primary: 164 39% 22%`) consumed via `hsl(var(--x))` | Full color-function CSS custom properties (`--primary: oklch(...)`) consumed via bare `var(--x)` | shadcn's v4 template convention (not a Tailwind requirement itself — a shadcn styling choice) | The single biggest mechanical change surface in this phase — see Pitfalls 1, 2, 5 |
| Manual `content: [...]` glob array for monorepo sibling packages | Automatic content detection + explicit `@source` for anything outside the CSS file's own directory tree | Tailwind v4.0 | See Pitfall 4 — easy to silently under-scope |
| `forwardRef` + explicit `ref` second argument | `ref` as a normal prop on function components (forwardRef deprecated, not removed) | React 19.0 (Dec 2024 GA) | Low urgency for this repo — 37 existing `forwardRef` usages keep working; codemod available if the team opts to modernize |
| Radix as shadcn's only/default primitive library | Base UI as the new default for `shadcn init`/`create` (Radix still fully supported, `-b radix` flag to pin) | shadcn changelog, July 2026 | Directly resolves STCK-03 — official non-deprecation statement is the citable basis for "stay on Radix, documented" |

**Deprecated/outdated:**
- `tailwindcss/resolveConfig` — does not exist in Tailwind v4; any code (including this repo's `token-registration.test.ts`) that imports it must be rewritten to introspect the compiled CSS or the raw `@theme`/`:root` source text directly instead.
- Tailwind v4 requires modern browsers only (Safari 16.4+, Chrome 111+, Firefox 128+ — depends on `@property` and `color-mix()`) [CITED: tailwindcss.com/docs/upgrade-guide]. Not currently known to be a constraint for this product's user base, but worth a one-line note in the phase's plan in case there is an undocumented legacy-browser support requirement.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npx @tailwindcss/upgrade`'s codemod does not auto-convert hand-authored `:root`/`.dark` CSS custom properties to oklch (only `tailwind.config.js` theme extensions + template class renames) | Anti-Patterns, "Don't rely on the codemod for globals.css" | If wrong (i.e., the codemod DOES handle this), Stage 2 could be partially automated, saving effort — low downside either way since manual conversion is the safe default and was not assumed to be free |
| A2 | The exact relative path for the two new `@source` directives (`../../../packages/ui/src` from `apps/web/src/app/globals.css`) — computed from the known directory structure but not test-compiled in this research session | Pitfall 4, Code Examples | If the path is off by one `../`, Tailwind v4 will silently fail to find the sibling package (same failure mode as omitting `@source` entirely) — verify at implementation time by confirming compiled CSS contains `packages/ui`-only utility classes before merging Stage 2 |
| A3 | The exact oklch equivalents for this repo's HSL brand values (teal `164 39% 22%`, the tier-ladder/graph-palette hues, etc.) were not computed in this research session — flagged as a Stage 2 implementation task, not a research deliverable, since it requires either a conversion library run or hand-verification against the WCAG-AA gate | Standard Stack, Code Examples | Low risk if flagged clearly — the planner must include an explicit "compute + verify contrast" task, not assume oklch values can be eyeballed from the HSL originals |
| A4 | `react-day-picker` v9's exact prop/classname API differences were characterized at a summary level (from the peerDependency-range signal + general knowledge of the library's documented v9 rewrite) but not diffed line-by-line against this repo's `calendar.tsx` in this research session | Pitfall 3 | If the actual diff is smaller than expected, the isolated-task recommendation still holds (low cost); if larger, the isolation recommendation becomes more important, not less — asymmetric risk favors the recommendation regardless |

## Open Questions (RESOLVED)

1. **Does this repo need to support pre-2023 browsers (Safari <16.4, Chrome <111, Firefox <128)?** — **RESOLVED (non-blocking):** no legacy-browser requirement exists in PROJECT.md/REQUIREMENTS.md; 55-01/55-02 note the modern-browser floor (Tailwind v4's `@property`/`color-mix()`) as a one-line assumption, not a gate. Revisit only if a browser-support matrix is later added.
   - What we know: Tailwind v4 requires these floors due to its use of native CSS `@property` and `color-mix()`.
   - What's unclear: No documented browser-support matrix was found in `PROJECT.md`/`REQUIREMENTS.md` for this product (a personal-use "second brain" tool, per `PROJECT.md`'s framing — likely low risk, but not explicitly confirmed).
   - Recommendation: Treat as non-blocking (no evidence of a legacy-browser requirement anywhere in the planning docs read), but flag it as a one-line checkpoint in the plan rather than silently assuming.

2. **Should the exact oklch conversion be computed via a library (`culori`) at test/build time, or precomputed once and hard-coded as literals in `globals.css`?** — **RESOLVED:** precompute-once adopted in 55-02 (no `culori`/new dependency); 55-03 rewrites token-contrast.test.ts to parse the `oklch(...)` literals directly. Phase 59 can introduce a conversion pipeline if the designed palette needs one.
   - What we know: Precomputing avoids adding a new runtime/test dependency and keeps `token-contrast.test.ts`'s rewrite simpler (parse `oklch(...)` literals directly, no conversion math needed at test time).
   - What's unclear: Whether the phase wants the flexibility of a conversion utility (e.g., for future palette work in Phase 59's designed token set) versus the simplicity of one-time hard-coded values.
   - Recommendation: Precompute once for this phase (lower risk, smaller diff) — Phase 59 (Visual Identity: Designed Token Set) is explicitly where a *new* palette gets designed anyway, and can introduce a proper conversion pipeline then if needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test/CLI tooling | ✓ | (engines require `>=20.12.0`, satisfied — Tailwind v4's own upgrade codemod also requires Node 20+) | — |
| npm (workspaces) | package installs across `apps/web`/`packages/*` | ✓ | — | — (repo explicitly overrides the global pnpm default per user memory/CLAUDE.md — confirmed still npm workspaces via root `package.json` `"workspaces"` field) |
| npm registry access | version verification, package installs | ✓ (used live throughout this research session via `npm view`) | — | — |
| slopcheck (Python/pip) | Package Legitimacy Audit automation | ✓ installed, ✗ execution blocked by session safety classifier | `0.6.1` | Manual `npm view` + repository-URL verification (performed, documented in the audit table above) |
| Playwright (`@playwright/test`) | `npm run screenshot:review`, `npm run test:e2e` | ✓ (already a devDependency, `1.61.1`) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** slopcheck automated execution (fallback: manual registry/repo verification, already performed).

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (absent = enabled per policy), so this section is included, scoped to what is actually relevant to a build-tooling/dependency migration (this phase adds no new auth, session, or data-input surfaces).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase touches no auth code |
| V3 Session Management | No | Phase touches no session code |
| V4 Access Control | No | Phase touches no authorization code |
| V5 Input Validation | No (indirectly relevant only if the `shadcn add` registry-install proof pulls in a component with an input surface — validate normally per existing Zod conventions if so) | Existing Zod boundary validation pattern (unchanged) |
| V6 Cryptography | No | N/A |
| V14 Configuration / Dependency Management | Yes | Package Legitimacy Audit (above) — every dependency bump verified against its registry entry and source repository before install |

### Known Threat Patterns for this stack/phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dependency-confusion / supply-chain (new `@tailwindcss/postcss` + `shadcn` CLI additions) | Tampering | Verified both against official Tailwind Labs / shadcn-ui GitHub org repos before recommending (this research); planner should re-verify registry state immediately before the actual `npm install` since slopcheck's automated gate did not execute this session |
| `shadcn add` non-interactive CLI invocation defaulting to an unintended primitive library (Base UI vs Radix) in CI/automation contexts | Tampering (config drift) | Explicit `-b radix` flag / `components.json` config per STCK-03's decision — do not rely on interactive-prompt defaults in an autonomous/overnight execution context |

## Sources

### Primary (HIGH confidence)
- Repo files read directly (ground truth, not inferred): `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `.planning/ROADMAP.md` (Phase 55 entry + backlog 999.12), `apps/web/package.json`, `packages/ui/package.json`, root `package.json`, `apps/web/src/app/globals.css`, `packages/ui/components.json`, `.claude/skills/polytoken-design-system/SKILL.md`, `apps/web/tailwind.config.ts`, `packages/ui/tailwind.config.ts`, `packages/tailwind-config/{web,base}.ts`, `apps/web/postcss.config.cjs`, `packages/genui/src/theme/{packs.ts,tokens.ts,themed-wrapper.tsx,__tests__/{packs.test.ts,contrast.ts}}`, `apps/web/src/app/__tests__/{token-contrast.test.ts,token-registration.test.ts,palette-ban.test.ts}`, `apps/web/src/app/dev/design/*`, `apps/email-listener/scripts/genui_eval/style_metrics.py` (grepped), `apps/email-listener/app/infrastructure/llm/genui_retheme_adapter.py` (located, not fully read — flagged for planner follow-up)
- `npm view <package>[@version] version|peerDependencies|repository.url` — live registry queries, 2026-07-15, for: `tailwindcss`, `@tailwindcss/postcss`, `react`, `react-dom`, `next`, `shadcn`, all `@radix-ui/react-*` packages used in `packages/ui`, `react-day-picker` (multiple versions), `vaul` (multiple versions), `cmdk` (multiple versions), `sonner` (multiple versions + full version list), `react-hook-form` (multiple versions), `next-themes` (multiple versions), `lucide-react` (multiple versions), `react-resizable-panels` (multiple versions + full version list), `recharts`, `ag-grid-react`/`ag-grid-community`, `react-dropzone`, `motion`, `@hookform/resolvers`, `tailwind-merge`, `@xyflow/react`, `@tanstack/react-query`, `react-markdown`, `react-pdf`, `@trpc/react-query`
- [tailwindcss.com/docs/upgrade-guide](https://tailwindcss.com/docs/upgrade-guide) — WebFetch, v3→v4 migration mechanics, codemod details, browser requirements
- [tailwindcss.com/docs/functions-and-directives](https://tailwindcss.com/docs/functions-and-directives) — WebFetch, `@config` directive scope/limitations
- [tailwindcss.com/docs/detecting-classes-in-source-files](https://tailwindcss.com/docs/detecting-classes-in-source-files) — WebFetch, automatic content detection scope + `@source` syntax
- [ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming) — WebFetch, canonical v4 `globals.css` shape (`@theme inline`, full-color-function CSS vars)
- [ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4) — WebFetch, shadcn-specific v4 setup notes
- [ui.shadcn.com/docs/changelog/2026-07-base-ui-default](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) — WebFetch + WebSearch corroboration, STCK-03's primary source (Radix non-deprecation statement, `-b radix` flag)
- [ui.shadcn.com/docs/components-json](https://ui.shadcn.com/docs/components-json) via WebSearch — `tailwind.config` field becomes `""` under v4

### Secondary (MEDIUM confidence)
- WebSearch: "React 19 breaking changes forwardRef ref as prop useRef required argument migration guide" — cross-referenced against react.dev's own `forwardRef` reference page and multiple independent migration-guide sources converging on the same facts (forwardRef deprecated-not-removed, `useRef()` now requires an argument, official `react-codemod` tooling exists)
- WebSearch: "tailwindcss v4 resolveConfig JS still works" — corroborated by a `tailwindlabs/tailwindcss` GitHub Discussions thread (#14764) confirming `resolveConfig()` has no v4 equivalent

### Tertiary (LOW confidence)
- `react-day-picker` v8→v9 API-rewrite characterization (Pitfall 3, Assumption A4) — based on the peerDependency-range signal (broadened to `>=16.8.0`, typical of a major rewrite) plus general training-data knowledge of the library's public migration guide, not a line-by-line diff against this repo's `calendar.tsx` performed in this session. Flagged for a fresh doc check at execution time.

## Metadata

**Confidence breakdown:**
- Standard stack (versions, peer-dep matrix): HIGH — every version/peer-range claim was verified live against the npm registry in this session, not recalled from training data
- Architecture (Tailwind v4 CSS shape, `@source`, gate breakage mechanics): HIGH — corroborated across official docs (tailwindcss.com, ui.shadcn.com) fetched directly, and cross-checked against this repo's actual source files (not assumed)
- Pitfalls (blast-radius findings — the 86 `hsl(var(--x))` call sites, the two-gate breakage, the packs.ts/Python cross-language coupling): HIGH for existence (grep-verified against the real repo), MEDIUM for completeness (a live build is the only way to guarantee no additional call site was missed)
- `react-day-picker` v9 specific API diff: LOW — flagged explicitly in Assumptions Log and Pitfall 3; recommend a fresh official-docs check at execution time rather than trusting this research's summary-level characterization

**Research date:** 2026-07-15
**Valid until:** 30 days (Tailwind v4.x and React 19.x are both stable, slow-moving majors at this point — the shadcn Base UI transition is the fastest-moving fact here and was captured at its source of truth, the shadcn changelog itself, so it should remain accurate even if the changelog page is updated further)
