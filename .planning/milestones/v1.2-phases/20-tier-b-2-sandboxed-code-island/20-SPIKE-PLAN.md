# Phase 20 — Sandboxed Code-Island — SPIKE PLAN

**Created:** 2026-07-01 · **Mode:** SPIKE (prove the risky core in isolation before the full phase)
**Sign-off:** GRANTED (jailed-eval). **Reorder:** ahead of Phase 19. **Research:** see [20-RESEARCH.md](./20-RESEARCH.md).

## Goal of the spike
Prove — offline, deterministically, and without disturbing the declarative core — that we can run **arbitrary
sandboxed code ("raw HTML → anything")** jailed from the host, with a v0-style **AST-validate → autofix → run →
self-heal → safe-placeholder** repair loop, plus **adversarial-injection** and **a11y** fixtures. This de-risks
the safety-model change (no-eval → jailed-eval) and gives a demoable Code-Island tab in `/studio`.

## Architecture (from research)
- **Jail:** `<iframe sandbox="allow-scripts" srcdoc>` **without `allow-same-origin`** → opaque/null origin;
  cannot touch host DOM/cookies/storage. **No COOP/COEP** needed (avoids app-wide breakage). Defense-in-depth:
  inline `<meta>` CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';`
  + the `csp=` attribute (Chromium). Island code is **vanilla HTML/CSS/JS** for the spike (truest "raw HTML →
  anything"; React-in-island deferred to full phase via inlined UMD+Babel or Sandpack).
- **Bridge:** `MessageChannel` + per-render **nonce**; host validates `event.source === frame.contentWindow`
  AND `event.origin === "null"` AND Zod-validates payload. Never eval/innerHTML a payload.
- **Repair loop (host-side, pre-execution gate is the primary safety layer):**
  `@babel/parser` (errorRecovery) → **AST-allowlist walk** (reject `import`/`require`, `eval`, `Function`,
  `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon`, `window.parent`/`top`/`opener`,
  `document.cookie`, `localStorage`/`sessionStorage`/`indexedDB`) → **recast** deterministic autofix →
  run in frame → capture (`onerror`+`unhandledrejection`+error-boundary → postMessage) → **≤2** heal attempts
  via injectable `heal()` seam → **safe-placeholder** fallback (circuit breaker). Security violations are
  REJECTED (never healed).
- **a11y:** inline `axe-core` (`axe.source`) into srcdoc → `axe.run(document)` inside → postMessage violations
  out (Pattern A). Impact-ranked surfacing.

## Deliverables

### `packages/genui/src/sandbox/` (framework-agnostic core — REAL, vitest-tested)
1. `validate-island-code.ts` — `validateIslandCode(code): { ok, violations[], syntaxErrors[] }` (AST allowlist).
2. `build-island-srcdoc.ts` — `buildIslandSrcdoc({ code, nonce, axeSource }): string` (CSP + sandbox bootstrap
   + error harness + axe). `ISLAND_SANDBOX_ATTR = "allow-scripts"` (asserted: no `allow-same-origin`).
3. `island-message.ts` — Zod schemas (`ready`, `runtime-error`, `a11y-result`) + `parseIslandMessage`.
4. `autofix-island-code.ts` — `autofixIslandCode(code)` (recast; ≥1 real deterministic fix).
5. `repair-loop.ts` — `planIslandRepair(code, { maxAttempts })` pure state machine + `IslandOutcome` type
   (`rendered` | `healed` | `rejected` | `fallback`).
6. `safe-placeholder.ts` — `SAFE_PLACEHOLDER_HTML` (frozen).
7. `fixtures/` — `curveball` (vanilla canvas "soundscape mixer"/interactive widget), `broken` (heals),
   `unrepairable` (fallback), `adversarial/*` (parent-DOM, cookie, localStorage, fetch-exfil, top-nav,
   sandbox-self-removal, nested-iframe, document.write).
8. `index.ts` barrel + `./sandbox` export in package.json.

### `apps/web/src/app/studio/_components/` (demo surface — REAL)
9. `code-island-frame.tsx` — ssr:false island: renders iframe, MessageChannel+nonce, drives repair loop,
   surfaces runtime errors + a11y + fallback state.
10. `code-sandbox-island.tsx` — Code-Island tab: fixture picker + textarea + Run → `CodeIslandFrame`.
    (Live-Bedrock code generation is the **seam** for the full phase; spike uses paste/fixtures.)
11. `studio-tabs.tsx` — add "Code-Island" tab.

### Tests / gates
12. vitest: allowlist blocks each adversarial fixture + accepts curveball; srcdoc jail construction
    (has meta-CSP `connect-src 'none'`, `sandbox="allow-scripts"`, NO `allow-same-origin`); message validation
    (rejects wrong-source/origin/shape); repair state machine (rendered/healed/rejected/fallback).
13. `apps/web/e2e/code-island-isolation.spec.ts` + minimal `playwright.config.ts` — the 10 runtime-isolation
    assertions in Chromium+Firefox. **Execution = connected-env verification** (no browser in this run).

## Seams / deferrals (honest)
- **Live Bedrock code generation** (intent → code) → full phase (Option A+B from recon: `GenuiCodeGeneratorAdapter`
  + `/v1/genui/code-island/generate` + tRPC `genui.codeIsland.generate`). Spike proves the render/jail/repair core.
- **Live Bedrock healer** → injectable `heal()` seam; spike uses a deterministic stub for offline tests.
- **Playwright cross-browser run** → connected-env (this project's established browser-verify deferral).
- **React-in-island, npm imports, multi-file** → full phase (Sandpack upgrade path).

## Non-negotiables (do not regress the declarative core)
- Zero changes to the declarative generate/cache/render path or its gates (D-24, D-08, SEAM-02, drift/parity).
- New code path is separate files + one new opt-in tab. The island's own no-eval note: the HOST does no eval;
  execution is jailed in the iframe (the deliberate jailed-eval boundary). Add a scoped grep note.

## Success (spike passes when)
- Curveball vanilla widget renders in the jailed frame (mechanism proven).
- Every adversarial fixture is BLOCKED by the AST allowlist (vitest) and the srcdoc is constructed with the
  correct jail (vitest).
- Broken fixture → heals (stub) → renders; unrepairable → safe placeholder (state machine vitest).
- a11y path returns violations from inside the frame.
- tsc + genui vitest + web build green. Playwright spec authored (run deferred).
