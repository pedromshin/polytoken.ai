# Phase 20 — Sandboxed Code-Island — SPIKE SUMMARY

**Executed:** 2026-07-01 (autonomous run, post user sign-off + reorder). **Outcome:** SPIKE PASSED.
**Inputs:** [20-RESEARCH.md](./20-RESEARCH.md) (5 web-research tracks), [20-SPIKE-PLAN.md](./20-SPIKE-PLAN.md), codebase recon.

## What the spike proves
The jailed-eval safety-model change is **de-risked and demoable**: arbitrary generated code ("raw JS →
anything") runs jailed from the host, with a v0-style repair loop and adversarial/a11y coverage — without
touching the declarative core or any of its gates.

## Deliverables (all REAL unless marked seam)

### `packages/genui/src/sandbox/` — framework-free core (new `@nauta/genui/sandbox` export)
| File | Role |
|---|---|
| `validate-island-code.ts` | AST allowlist via `@babel/parser` (errorRecovery) + hand-rolled name-position-aware walker. Rejects `import`/`require`/`import()`, `eval`/`Function`, `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon`, `window.parent`/`top`/`opener`/`frameElement`, `document.cookie`, `localStorage`/`sessionStorage`/`indexedDB`. **Primary deterministic safety layer.** |
| `build-island-srcdoc.ts` | Builds the frame document: `ISLAND_SANDBOX="allow-scripts"` (no `allow-same-origin`), inline `<meta>` CSP `default-src 'none'; connect-src 'none'`, error-capture harness (onerror+unhandledrejection+try/catch), optional inlined axe pass, nonce'd postMessage. `</script>` break-out neutralized. |
| `island-message.ts` | Zod postMessage contract (ready/runtime-error/a11y) + `isTrustedIslandMessage` (source identity **and** origin `"null"` **and** nonce). |
| `repair-loop.ts` | Pure state machine: `startIsland → onRunSuccess / onRuntimeError → onHealed`. Validates code (reject on violation, never run), autofixes, runs, heals ≤2 (re-validates healed code — a malicious heal is rejected), else safe-placeholder fallback. |
| `autofix-island-code.ts` | Deterministic pre-heal fixes (strip module-style `export`). |
| `safe-placeholder.ts` | Accessible `role=alert` fallback srcdoc. |
| `axe-source.ts` | `getAxeSource()` (axe-core 4.x `.source`) — separate subpath export so the ~500KB engine loads only inside the dynamically-imported frame. |
| `fixtures/` | curveball (VIBE #57 soundscape mixer, canvas+sliders+rAF), broken→heals, unrepairable→fallback, 18 adversarial escapes. |

### `apps/web/src/app/studio/_components/` — demo surface
- `code-island-frame.tsx` — ssr:false island: sandboxed `<iframe>`, message bridge (authenticated), drives the repair loop, surfaces phase/attempts/runtime-error + impact-ranked a11y findings + allowlist violations.
- `code-sandbox-island.tsx` — new "Code-Island" tab: preset picker + editable code + Run. **Live intent→code generation (Bedrock) is the documented full-phase seam** — spike is fixture/paste-driven (offline).
- `studio-tabs.tsx` — added the Code-Island tab.

### Tests / scaffold
- **49 vitest cases** across the sandbox core (allowlist blocks all 18 escapes; curveball + benign code accepted; no false positives on name positions; srcdoc jail construction; message auth; full repair state machine incl. malicious-heal re-rejection + circuit breaker).
- `apps/web/e2e/code-island-isolation.spec.ts` + `playwright.config.ts` — cross-browser (Chromium+Firefox) runtime-isolation spec. **Authored; execution = connected-env** (no browser in this run; excluded from web tsconfig so it never breaks the build).

## Gates (all green)
- genui `tsc` clean · genui vitest **416/416** (367 prior + 49 new, zero regressions) · web `tsc` clean · `next build` green (`/studio` 114 kB) · host code contains **no** `eval`/`Function`/`dangerouslySetInnerHTML` (only doc-comments).

## Declarative core untouched
No changes to the generate/cache/render path, spec schema, registry, ActionRegistry/SEAM-02, or the drift/parity gates. The code-island is additive: one new package subpath, one new opt-in studio tab, two touched files (`studio-tabs.tsx` +tab, `apps/web/tsconfig.json` exclude e2e).

## Seams / deferrals (honest)
1. **Live Bedrock intent→code generation** → full phase (recon Option A+B: `GenuiCodeGeneratorAdapter` + `POST /v1/genui/code-island/generate` + tRPC `genui.codeIsland.generate` + `code_generation_events` audit). Spike proves the render/jail/repair core it will feed.
2. **Live Bedrock healer** → injectable `heal()` seam; spike uses deterministic offline stubs.
3. **Playwright cross-browser run** → connected-env (authored, not executed here).
4. **React-in-island / npm imports / multi-file** → full phase (Sandpack upgrade path; iframe stays the jail).
5. **`csp=` iframe attribute (Chromium DiD)** → omitted (meta CSP enforces in all engines incl. Chromium); add in full phase for belt-and-suspenders.
6. **No-eval CI grep gate is comment-only today** → full phase should add a scoped lint asserting the HOST path stays eval-free while the island stays jailed.

## Recommendation
**Promote Phase 20 from SPIKE → full phase.** The high-risk core (isolation + repair loop + injection/a11y
coverage) is proven. Full-phase scope = wire live Bedrock code generation (Option A+B) into this surface, run
the eval harness (EVAL-01 injection + EVAL-02 axe) against baseline, execute the Playwright suite in a
connected env, and add React/npm island support via Sandpack if the corpus needs it. Then resume **Phase 19**
(declarative form engine) — now informed by the island: forms may compose inside islands or as the declarative
fast-path, revisit the JSONForms-vs-custom fork post-island.
