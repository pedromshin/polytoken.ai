---
phase: 22-chat-spine-persistence-streaming
plan: 03
subsystem: chat-ui-markdown
tags: [markdown, syntax-highlighting, sanitization, react-markdown, chat-ui]

# Dependency graph
requires: []
provides:
  - MarkdownRenderer component (apps/web/src/app/chat/_components/markdown-renderer.tsx)
    — sanitized, syntax-highlighted assistant-markdown renderer (CHAT-07, D-28)
  - apps/web vitest + jsdom test infrastructure (none existed before this plan)
affects: [22-08 (message list — will consume MarkdownRenderer for assistant text parts)]

# Tech tracking
tech-stack:
  added:
    - react-markdown@10.1.0
    - remark-gfm@4.0.1
    - rehype-highlight@7.0.2
    - rehype-sanitize@6.0.0
    - highlight.js@11.11.1 (explicit direct dep, matches lowlight's internal ~11.11.0 range — needed to import a stylesheet theme)
    - vitest@2.1.9 + jsdom@29.1.1 (devDependencies, apps/web had no test runner before this plan)
  patterns:
    - "rehypePlugins=[rehypeSanitize, rehypeHighlight] order — sanitize runs on the
      raw parsed-markdown hast tree BEFORE rehype-highlight injects its own trusted
      hljs/hljs-* classNames, so the default sanitize schema (which disallows
      className on span) never strips the highlighter's own output"
    - "rehype-raw is never used — raw HTML in markdown source renders as inert
      escaped text by react-markdown's default behavior, never becomes a live DOM
      node; rehype-sanitize is layered as defense-in-depth on top of that"
    - "Heading-level collapse into the app's 2-weight system: h1..h6 all render
      text-base font-semibold via a per-tag factory (makeHeading), preserving
      semantic tag level for a11y outline while never introducing a third weight"
    - "Fenced vs. inline code distinguished by presence of a language-* className
      (added by remark-rehype for fenced blocks); fenced code preserves its
      className verbatim so hljs theme coloring applies, inline code gets its own
      compact bg-muted chip styling"

key-files:
  created:
    - apps/web/src/app/chat/_components/markdown-renderer.tsx
    - apps/web/src/app/chat/_components/__tests__/markdown-renderer.test.tsx
    - apps/web/vitest.config.ts
  modified:
    - apps/web/package.json
    - package-lock.json

key-decisions:
  - "Package-legitimacy checkpoint resolved by orchestrator-run npm-registry audit (2026-07-03) before this session started — see Package Legitimacy Audit table below. Treated as the plan's 'approved' resume-signal; no pause."
  - "Added highlight.js as an explicit direct dependency (not left as rehype-highlight's transitive lowlight dependency) so `import \"highlight.js/styles/github-dark.css\"` resolves reliably under npm workspace hoisting rather than depending on a nested node_modules path."
  - "Chose highlight.js's github-dark theme as the single syntax-highlight theme (not theme-toggled with next-themes) — code blocks carry their own fixed dark chrome regardless of app light/dark mode, matching the common chat-product convention (GitHub/ChatGPT/Notion all fix code-block coloring independent of site theme); the outer <pre> still uses the token-bound bg-muted/rounded per 22-UI-SPEC.md, the inner <code> displays the highlighter's own background on top of it."
  - "apps/web had no vitest/jsdom test infrastructure before this plan (only packages/api-client and packages/genui did). Added vitest.config.ts + devDependencies mirroring packages/genui's exact convention (jsdom environment, src/**/*.test.{ts,tsx} include glob) rather than inventing a new pattern."
  - "Fenced-vs-inline code distinction uses a `language-*` className heuristic rather than react-markdown's removed `inline` prop (react-markdown v9+ no longer passes it). Fenceless (unlabeled) code blocks fall back to the inline visual treatment — a known minor limitation, not exercised by 22-UI-SPEC.md's chat scope, and left as Claude's-discretion component detail per 22-CONTEXT.md."

requirements-completed: [CHAT-07]

# Metrics
duration: ~25min
completed: 2026-07-03
---

# Phase 22 Plan 03: Markdown + Code-Block Renderer Summary

**Sanitized `MarkdownRenderer` built on react-markdown + remark-gfm + rehype-sanitize + rehype-highlight, mapping all markdown heading levels into the app's existing 2-weight (400/600) type system — CHAT-07/D-28.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-03
- **Tasks:** 1/1 completed (plus one already-resolved package-legitimacy checkpoint)
- **Files created:** 3 (component, test, vitest config)
- **Files modified:** 2 (apps/web/package.json, package-lock.json)
- **New tests:** 5, all passing; `tsc --noEmit` clean

## Package Legitimacy Audit (checkpoint resolution)

No `RESEARCH.md` Package Legitimacy Audit table existed for this phase, so per the fallback policy these four packages were `[ASSUMED]` pending human verification. The orchestrator ran the npm-registry audit before this session started (2026-07-03) and approved installation:

| Package | Version | Weekly downloads | Repo (genuine org) |
|---------|---------|------------------|--------------------|
| react-markdown | 10.1.0 | 24,617,114 | github.com/remarkjs/react-markdown |
| remark-gfm | 4.0.1 | 23,209,501 | github.com/remarkjs/remark-gfm |
| rehype-highlight | 7.0.2 | 1,389,518 | github.com/rehypejs/rehype-highlight |
| rehype-sanitize | 6.0.0 | 6,447,428 | github.com/rehypejs/rehype-sanitize |

All four are the genuine unified/remark/rehype-ecosystem packages, permissive (MIT) licenses. This was treated as the plan's "approved" resume-signal — the checkpoint was not re-run interactively.

A fifth package, `highlight.js@11.11.1`, was added as an explicit direct dependency during implementation (see Decisions) — it is the well-known upstream dependency of `lowlight`, which `rehype-highlight@7` depends on internally; adding it explicitly only pins the version and exposes its `styles/*.css` assets for import, it does not expand the trust boundary beyond what `rehype-highlight` already brings in.

## Accomplishments

- **`MarkdownRenderer`** (`apps/web/src/app/chat/_components/markdown-renderer.tsx`): client component wrapping `ReactMarkdown` with `remarkPlugins=[remarkGfm]`, `rehypePlugins=[rehypeSanitize, rehypeHighlight]`. Custom `components` map binds `h1`–`h6` → `text-base font-semibold` (Heading role, 2-weight system per 22-UI-SPEC.md), `p` → `text-sm leading-relaxed`, `a` → `text-primary underline` (opens in new tab), `pre` → `bg-muted rounded-lg overflow-x-auto`, `code` → fenced code preserves its `language-*`/`hljs` className for highlighter coloring, inline code gets a compact `bg-muted` mono chip, plus `table`/`th`/`td` and `ul`/`ol` token-styled overrides for GFM content.
- **Security posture (T-22-10, T-22-11):** `rehype-raw` is never used, so raw HTML in model-generated markdown (e.g. `<img onerror=...>`) is rendered by react-markdown's default behavior as inert escaped text — it never becomes a live DOM element regardless of sanitize. `rehype-sanitize` is layered in as defense-in-depth and is deliberately ordered *before* `rehype-highlight` in the plugin array so the highlighter's own trusted classNames (added after sanitize runs) are never stripped by the sanitize schema. Fenced code content renders as inert highlighted text only — never evaluated. No raw-HTML-injection API appears anywhere in the file (verified via `grep -c "dangerouslySetInnerHTML"` = 0).
- **Dependency install:** `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-sanitize`, `highlight.js` added to `apps/web` via `npm install ... -w @nauta/web` (npm workspaces, `package-lock.json` canonical — no `pnpm-lock.yaml` created). `npm audit` after install shows only pre-existing, unrelated vulnerabilities (dompurify, drizzle-orm, esbuild/tsx, postcss/next) — none introduced by the new packages.
- **Test infrastructure:** `apps/web` had no test runner at all before this plan. Added `vitest.config.ts` (jsdom environment) and `vitest`/`jsdom` devDependencies, mirroring `packages/genui`'s existing convention exactly, plus `test`/`test:watch` scripts.
- **TDD cycle:** RED — `markdown-renderer.test.tsx` written first, confirmed failing (`Failed to resolve import "../markdown-renderer"`) before any implementation existed. GREEN — implementation added, all 5 tests pass; `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically (TDD RED/GREEN split within the single TDD-tagged task):

1. **RED — failing test + dependency install + vitest infra** - `ef64c4e` (test)
2. **GREEN — MarkdownRenderer implementation** - `1a78538` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/chat/_components/markdown-renderer.tsx` — `MarkdownRenderer` component (220 lines)
- `apps/web/src/app/chat/_components/__tests__/markdown-renderer.test.tsx` — 5 unit tests (heading weight + inline code, fenced-code highlighting, GFM table, raw-HTML neutralization, h1–h3 weight consistency)
- `apps/web/vitest.config.ts` — jsdom test environment config (new — apps/web had none)
- `apps/web/package.json` — added 5 runtime deps + vitest/jsdom devDeps + `test`/`test:watch` scripts
- `package-lock.json` — synced for the above

## Decisions Made

See `key-decisions` in frontmatter. Summarized:
1. Checkpoint already resolved by orchestrator's npm-registry audit — proceeded without re-pausing.
2. Added `highlight.js` as an explicit direct dependency to reliably import its stylesheet CSS (transitive-only would risk unresolved import paths under npm hoisting).
3. Fixed `github-dark.css` theme for code blocks regardless of app light/dark mode — matches common chat-product convention; outer `<pre>` still stays token-bound (`bg-muted`).
4. Built apps/web's first vitest/jsdom test infra, mirroring `packages/genui`'s established pattern rather than inventing a new one.
5. Fenced-vs-inline code distinguished via `language-*` className presence (react-markdown v9+ dropped the `inline` prop) — a pragmatic, widely-used heuristic; fenceless code blocks are a known minor edge-case gap, not exercised by this phase's UI spec.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] apps/web had no test runner; added vitest + jsdom test infrastructure**
- **Found during:** Task 1, before writing the RED test
- **Issue:** The plan's `<verify>` step (`cd apps/web && pnpm vitest run ...`) assumes a working vitest setup, but `apps/web/package.json` had no `vitest` devDependency, no `vitest.config.ts`, and no `test` script — unlike `packages/genui`/`packages/api-client` which already have both.
- **Fix:** Added `vitest.config.ts` (jsdom environment, `src/**/*.test.{ts,tsx}` include) and `vitest`/`jsdom` devDependencies + `test`/`test:watch` scripts to `apps/web/package.json`, mirroring `packages/genui`'s exact existing convention.
- **Files modified:** `apps/web/package.json`, new `apps/web/vitest.config.ts`
- **Commit:** `ef64c4e`

**2. [Rule 3 - Blocking issue] Plan's verify/tsc commands specify `pnpm`; repo is npm workspaces**
- **Found during:** Task 1 setup
- **Issue:** The plan's `<verify>`/`<acceptance_criteria>` literally say `pnpm vitest run ...` and `pnpm tsc --noEmit`, but this repo has no `pnpm-lock.yaml`/`pnpm-workspace.yaml` — it is an npm-workspaces monorepo with `package-lock.json` as the canonical lockfile (confirmed in root `package.json`'s `workspaces` field and orchestrator's checkpoint-resolution note).
- **Fix:** Ran the npm equivalents: `npm install ... -w @nauta/web` for install, `npx vitest run <path>` and `npx tsc --noEmit` (via `cd apps/web`) for verification. Same commands, same effect, correct package manager for this repo.
- **Verification:** All 5 tests pass; `tsc --noEmit` exits clean with no output.

**3. [Rule 1 - Bug] Source file had no explicit `React` import — JSX classic transform required it**
- **Found during:** first GREEN test run (`ReferenceError: React is not defined`)
- **Issue:** `apps/web`'s vitest setup (like `packages/genui`'s) has no `@vitejs/plugin-react`, so esbuild's default classic JSX transform expects `React` to be in scope in every file using JSX — an automatic-runtime assumption that doesn't hold here.
- **Fix:** Added `import React from "react";` to `markdown-renderer.tsx`, matching the established convention already used in `packages/genui/src/theme/themed-wrapper.tsx` and other genui source files.
- **Files modified:** `apps/web/src/app/chat/_components/markdown-renderer.tsx`
- **Commit:** `1a78538`

**4. [Rule 1 - Bug] Self-inflicted acceptance-criteria false positive from a doc comment**
- **Found during:** running the plan's own `grep -c "dangerouslySetInnerHTML"` acceptance check
- **Issue:** A security-rationale doc comment literally contained the string "dangerouslySetInnerHTML" (stating it is *not* used), which made the grep count return `1` instead of the required `0`.
- **Fix:** Reworded the comment to convey the same guarantee ("No raw-HTML-injection API is used...") without the literal trigger string.
- **Files modified:** `apps/web/src/app/chat/_components/markdown-renderer.tsx`
- **Commit:** `1a78538`

**Total deviations:** 4 auto-fixed (2 Rule 3 tooling/infra gaps, 2 Rule 1 bugs) — no architectural changes, no scope creep.

## Issues Encountered

None beyond the four items above. `npm audit` after the dependency install reports 12 pre-existing vulnerabilities (dompurify, drizzle-orm, esbuild via tsx, postcss/next) — confirmed unrelated to any of the 5 packages this plan installed (none of `react-markdown`/`remark-gfm`/`rehype-highlight`/`rehype-sanitize`/`highlight.js` or their transitive deps appear in the audit output). Out of scope per the executor's Scope Boundary rule; not fixed here.

## User Setup Required

None. No new environment variables, secrets, or external services — this is a pure client-side rendering component.

## Threat Flags

None beyond what the plan's `<threat_model>` already enumerated (T-22-10, T-22-11, T-22-SC) — all implemented exactly as dispositioned:
- T-22-10: `rehype-raw` never used (raw HTML → inert text); `rehype-sanitize` layered before `rehype-highlight` as defense-in-depth; zero raw-HTML-injection APIs in the file.
- T-22-11: fenced code renders as inert highlighted text only, never evaluated.
- T-22-SC: package-legitimacy checkpoint resolved via orchestrator's npm-registry audit before install (table above); `highlight.js` added explicitly is a pre-existing transitive dependency of the already-audited `rehype-highlight` chain, not new trust surface.

## Known Stubs

None. `MarkdownRenderer` is fully wired (no placeholder data, no hardcoded empty states) — it renders whatever `content: string` it is given. It is not yet consumed by any route (the message list that will call it lands in 22-08), but the component itself has no stubbed behavior.

## Next Phase Readiness

- `MarkdownRenderer({ content })` is a complete, tested, reusable primitive ready for 22-08 (message list) to import and render assistant text parts.
- `apps/web` now has a working vitest/jsdom test harness other chat-UI plans in this phase can reuse without re-deriving the setup.

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 3 created files confirmed present on disk; both task commits (`ef64c4e`, `1a78538`) confirmed present in `git log --oneline --all`.
