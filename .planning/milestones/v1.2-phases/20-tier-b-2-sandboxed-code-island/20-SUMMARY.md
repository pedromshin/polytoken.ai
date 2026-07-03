# Phase 20 — Tier B-2: Sandboxed Code-Island — FULL-PHASE SUMMARY

**Executed:** 2026-07-01 (autonomous run; user sign-off + reorder ahead of Phase 19).
**Status:** ✅ COMPLETE (functionally); connected-env items deferred (live Bedrock smoke, Playwright run,
eval-harness lift scoring) — same posture as DEF-17-05-01 / DEF-18-03-01.
**Path:** SPIKE ([20-SPIKE-SUMMARY.md](./20-SPIKE-SUMMARY.md)) → promoted to full phase. Research: [20-RESEARCH.md](./20-RESEARCH.md).

## What shipped
A **jailed-eval code-island**: the studio can turn a free-text intent into ARBITRARY sandboxed UI code
("raw JS → anything"), rendered jailed from the host, with a v0-style repair loop — the day-0 escape from
the catalog's fixed "natural design" the milestone north-star demanded. The reliable declarative core
(Phases 12–18) is untouched; this is a parallel, additive path (hybrid architecture).

### End-to-end vertical slice
`/studio` Code-Island tab → type intent → tRPC `genui.codeIslandGenerate` → FastAPI
`POST /v1/genui/code-island/generate` → dual-LLM (quarantine → Bedrock `emit_code_island` forced tool-use,
Haiku→Sonnet escalation) → code returned → **host-side AST allowlist** → **sandboxed opaque-origin iframe**
(`allow-scripts`, no same-origin; inline `<meta>` CSP `default-src 'none'; connect-src 'none'`) → run →
on runtime error, **live re-generate healer (≤2)** → **safe-placeholder** fallback. In-frame **axe-core**
a11y → nonce'd postMessage → impact-ranked surfacing.

### Components
- **`packages/genui/src/sandbox/`** (new `@nauta/genui/sandbox`): `validate-island-code` (hardened AST
  allowlist), `build-island-srcdoc` (jail + pinned targetOrigin + inlined axe), `island-message`
  (authenticated postMessage), `repair-loop` (pure state machine), `autofix`, `safe-placeholder`,
  `axe-source`, fixtures.
- **Python** (`apps/email-listener`): `GenuiCodeGeneratorAdapter`, `GenerateCodeIslandUseCase`,
  `POST /v1/genui/code-island/generate`, Dishka DI (2 providers), best-effort audit (reused
  `GenerationEvent`, `registry_version="code-island-v1"`, no migration). Declarative path untouched.
- **TS/web**: tRPC `genui.codeIslandGenerate` (proxy + friendly fallback), Code-Island tab with live
  "generate from intent" + preset fixtures + live healer.

## Adversarial review (ultracode)
Multi-agent review over 5 dimensions → **37 findings, 31 confirmed real, 5 high/critical — 0 that the
runtime jail does not already contain.** Applied defense-in-depth hardening for the confirmed
AST-allowlist bypass class (all runtime-mitigated): computed access `window["fetch"]`, template-literal
keys, forbidden computed keys on any object, window-object **aliasing** (`const w=window; w.fetch()`,
fixpoint), **destructuring** off a window receiver, **reflection** (`Reflect`/`Proxy`/`.constructor`/
`__proto__`), `document.defaultView`, and **fail-closed** dynamic computed access on window receivers.
Also pinned postMessage `targetOrigin` to the host origin (was `*`) and corrected the `csp=`-attribute
docs (the inline `<meta>` CSP is the sole enforcer, all engines).

## Gates (all green)
- genui `tsc` clean · genui vitest **438** (367 prior + 71 sandbox) · api-client vitest **44** (+5) ·
  web `tsc` clean · `next build` green (`/studio` 115 kB) · Python **27 new + 92 declarative regression**
  pytest, ruff/mypy/lint-imports clean · host code: no `eval`/`Function`/`dangerouslySetInnerHTML` calls.

## Commits
`9c6cf22` reorder+sign-off · `6c72e7a` spike · `f8ab67c` tRPC+live web · `2411900` Python service ·
`2aa0a07` adversarial-review hardening.

## Deferred (connected-env / non-blocking — established project pattern)
1. **Live Bedrock smoke** of the code-island endpoint (needs IAM creds) — offline-mocked here.
2. **Playwright cross-browser isolation run** (`apps/web/e2e/code-island-isolation.spec.ts`) — authored;
   no browser in the autonomous run.
3. **Phase-16 eval-harness lift scoring** of curveball vs baseline (EVAL-01 injection + EVAL-02 a11y
   integrated into the rubric) — needs live Bedrock + seeded DB (DEF-20-01).
4. **Future hardening (optional):** nonce-gated CSP (drop `'unsafe-inline'`) / Trusted Types; non-foldable
   string tricks (`"fe"+"tch"`) are contained by the runtime jail, flagged fail-closed on window receivers.

## Next
Milestone v1.2 not complete — **Phase 19** (declarative form engine) remains, deferred by the reorder with
its engine fork (JSONForms vs custom+AJV vs RJSF, or forms-inside-islands) left open pending this island.
