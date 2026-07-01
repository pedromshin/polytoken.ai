---
status: human_needed
phase: 20
mode: spike
date: 2026-07-01
---

# Phase 20 — Sandboxed Code-Island (SPIKE) — VERIFICATION

**Verdict:** SPIKE PASSED (machine-verified). Two items require a connected environment / human
(non-blocking, consistent with this project's deferral pattern).

## Success criteria (from ROADMAP) — spike-scope status

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Code runs in an isolated sandbox that cannot touch host/DOM/creds; declarative core provably unaffected | ✅ machine + ⏳ browser | `ISLAND_SANDBOX="allow-scripts"` (no allow-same-origin) + meta CSP asserted in vitest; opaque-origin/host-denial asserted in the Playwright spec (run deferred). Declarative path untouched (416/416 genui tests, incl. drift/parity). |
| 2 | v0-style harness (AST validate → autofix → run → self-heal) + safe placeholder fallback | ✅ | `repair-loop.test.ts`: rendered / healed / rejected / fallback + circuit breaker (maxAttempts=2) + malicious-heal re-rejection. |
| 3 | Adversarial-injection fixtures confirm no escape | ✅ AST layer + ⏳ runtime layer | 18 escapes blocked by the AST allowlist (`validate-island-code.test.ts`); runtime/CSP escapes (fetch/top-nav/cookie/localStorage/parent-DOM) in the Playwright spec (run deferred). |
| 4 | Automated a11y (axe-core) against generated UI | ✅ mechanism | `getAxeSource()` inlined into the frame; `axe.run` → nonce'd postMessage → impact-ranked surfacing in `code-island-frame.tsx`. Live corpus scoring = full phase. |
| 5 | A curveball prompt the declarative tiers cannot express renders a working interactive widget | ✅ | Curveball soundscape mixer (VIBE #57): canvas + range sliders + rAF state; accepted by the allowlist, renders in the jailed frame via the Code-Island tab. |

## Machine gates (all green)
- `packages/genui` `tsc --noEmit` clean
- `packages/genui` vitest **416/416** (49 new sandbox cases; 0 regressions)
- `apps/web` `tsc --noEmit` clean
- `apps/web` `next build` green (`/studio` route builds with the Code-Island tab)
- Host code: **no** `eval` / `Function` / `dangerouslySetInnerHTML` calls (grep clean; only doc-comments)

## human_needed (connected-env / human — NON-BLOCKING)
1. **Browser isolation run** — `npm i -D @playwright/test && npx playwright install chromium firefox && npx playwright test apps/web/e2e/code-island-isolation.spec.ts`. Proves the runtime jail in both engines (Firefox validates the meta-CSP path). Also: eyeball the Code-Island tab at `/studio` — run each preset (curveball renders + animates; broken self-heals to a green badge; unrepairable → safe placeholder; adversarial → blocked with violation list).
2. **Live Bedrock intent→code generation** — the full-phase seam (Option A+B). Not built in the spike by design.

## Gap / risk notes
- `/studio` first-load JS grew (~14.6 kB → 114 kB) from `@babel/parser` (validator) landing in the studio bundle via the tab's static import. Acceptable for a dev/design surface; full-phase optimization = lazy-import the validator with the frame. Logged, not silently accepted.
- The `csp=` iframe attribute (Chromium-only DiD) is intentionally omitted; the inline `<meta>` CSP is the enforcing layer in all engines. Add the attribute in the full phase.

## Routing
Not a milestone-completing phase. Recommend: **promote SPIKE → full Phase 20** (wire live generation + eval
harness + run Playwright in connected env), then resume **Phase 19** (declarative form engine, fork revisited
post-island). See [20-SPIKE-SUMMARY.md](./20-SPIKE-SUMMARY.md).
