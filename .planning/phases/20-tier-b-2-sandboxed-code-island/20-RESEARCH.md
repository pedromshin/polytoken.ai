# Phase 20 — Sandboxed Code-Island — RESEARCH SYNTHESIS

**Gathered:** 2026-07-01 (parallel deep-research, 5 tracks, web-sourced & verified)
**Status:** Feeds the SPIKE plan. Condensed; full citations inline.

> Context: reordered ahead of Phase 19 per user north-star ("any design from day 0, better than
> WordPress/Lovable"). Target = HYBRID: reliable declarative core (Phases 12–18) as fast-path +
> arbitrary **jailed-eval** code-island for the long tail. This doc = the architecture evidence base.

---

## 1. Sandbox mechanism — DECISION: native `<iframe sandbox="allow-scripts" srcdoc>` (NO `allow-same-origin`)

Compared iframe-srcdoc vs Sandpack vs WebContainer:

| Dimension | **iframe srcdoc (CHOSEN)** | Sandpack | WebContainer |
|---|---|---|---|
| Pkg / weight | native, ~0 host weight | `@codesandbox/sandpack-react` 2.20.0, ~1.2 MB | `@webcontainer/api` 1.6.4, ~180 KB + multi-MB WASM |
| License | n/a | Apache-2.0 | MIT client BUT **commercial license for for-profit prod**, 500 sess/mo cap |
| Needs COOP/COEP | **NO** | No (classic bundler) | **YES** (SharedArrayBuffer) — app-wide blast radius |
| Offline | Yes (self-host UMD assets) | Partial (bundler phones home to codesandbox by default) | No |
| Isolation | browser opaque/null origin | iframe bundler | virtualized Node (strongest) |
| Main risk | must NEVER add `allow-same-origin` | default remote bundler | COOP/COEP breaks OAuth/fonts/Stripe + paid license |

**Why iframe wins for this stack (local, safety-first, no header disruption):**
- `sandbox="allow-scripts"` WITHOUT `allow-same-origin` → content runs in an **opaque origin that serializes to `"null"`**; cannot read parent DOM, cookies, `localStorage`, IndexedDB. (MDN iframe; WHATWG HTML spec §sandboxing → forced unique opaque origin.)
- **No COOP/COEP needed** — that requirement is specific to `SharedArrayBuffer`/WebContainer, and enabling it app-wide breaks cross-origin fonts, images, OAuth/payment popups, third-party scripts (web.dev/coop-coep; Next.js #81384 Stripe breakage, #32069 fonts). Huge operational win to avoid.
- **Run React inside:** inline React + ReactDOM UMD + `@babel/standalone` (JSX transpile) via `<script>` in the `srcdoc` string; **self-host these assets for true offline** (srcdoc is a local string, no inherent network dep).
- **CRITICAL escape rule:** `allow-scripts` + `allow-same-origin` together lets framed JS reach `window.parent`, delete its own `sandbox` attr, and re-run unrestricted → full break-out. **Mitigation: never set `allow-same-origin`.** (MDN; W3C validator flags the combo as "Bad value".)
- **Defense-in-depth:** add `<meta http-equiv="Content-Security-Policy" content="… connect-src 'none' …">` inside srcdoc to block network egress (`fetch`/XHR exfil). Note: CSP `sandbox`/`frame-ancestors` directives are NOT valid in `<meta>` — pair meta-CSP with the iframe `sandbox` attribute (they solve different layers).

**Upgrade path (future, not spike):** Sandpack if we later need real npm-package imports + multi-file projects (self-host the bundler). WebContainer rejected (headers + licensing + overkill for UI rendering).

## 2. postMessage bridge — validate carefully (null-origin gotcha)

- Frame is null-origin → its messages arrive with `event.origin === "null"`. **A naive `event.origin === window.origin` check is defeatable** because two opaque origins both stringify to `"null"`. (whatwg/html#3585.)
- **Correct host-side validation:** check `event.source === iframe.contentWindow` (identity), and/or establish a dedicated `MessageChannel`/`MessagePort` handshake with a per-render nonce. Treat every payload as untrusted; validate shape (Zod) at the boundary.
- Post *to* the null-origin frame with `targetOrigin: "*"` (no concrete origin to match), but authenticate the sender by source/nonce, never by `"null"`.

## 3. Repair harness (v0/Bolt-style) — AST-validate → autofix → run → self-heal → fallback

**How the leaders do it:**
- **v0 (Vercel):** dynamic system prompt (embeddings-targeted knowledge) + streaming autofix ("LLM Suspense": fix bad imports, embedding-match nonexistent icon names <100ms, no extra model call) + **deterministic AST autofixers** (wrap hooks in providers, complete `package.json` deps by scanning code, repair common JSX/TS errors) + a small fine-tuned model, all **<250ms, only when needed**. LLM code errors ~10% of the time; pipeline gives "double-digit" success-rate lift. Characterized as PROACTIVE (fix-before-execute) more than post-hoc retry.
- **Bolt.diy:** stream artifacts → run in WebContainer → capture non-zero exit codes + terminal/preview errors → `ActionAlert{type,title,description,content}` → "fix this" re-prompts the LLM with serialized error.
- **Lovable:** "Try to Fix" button; reliability from a consistent stack (React+Supabase+Tailwind).
- **Canonical loop:** generate → parse/typecheck/lint/run → repair prompt = {original spec + previous code + error msg + "fix it"} → bounded retries → fallback.

**Library picks (verified current):**
- **AST validate → `@babel/parser` with `{ plugins:['jsx','typescript'], errorRecovery:true }`** — only mature JS-native parser with first-class TSX *and* tolerant recovery (returns partial AST + `.errors[]` for precise feedback). Runs in Node + browser. (Alt for throughput: `@oxc-parser/wasm` fastest; `@swc/wasm-web`. AVOID esprima=stale, acorn=no TS.)
- **Autofix → recast 0.23.x** with `parser: recast/parsers/babel-ts` — formatting-preserving AST-to-AST (reprints only changed nodes). Surgical fixes: rewrite bad imports, inject provider/`import React`, drop forbidden calls. (jscodeshift for multi-file.)
- **Import/API allowlist BEFORE execution → direct AST walk** (`@babel/parser` → `@babel/traverse` or estree-walker): iterate `ImportDeclaration` specifiers vs allowlist; reject blocklisted identifiers/`MemberExpression`. Cheap, embeddable. (Optionally `eslint-plugin-security` + core `no-eval`/`no-new-func` as baseline; not sufficient alone.)
  - Selectors to block: `eval`→`CallExpression[callee.name='eval']`; `Function`→`NewExpression[callee.name='Function']`; `fetch`/`XMLHttpRequest`; `window.parent`, `document.cookie`, `localStorage`.

**Runtime error capture (inside iframe):** install `window.onerror` + `window.addEventListener('unhandledrejection')` + a React error boundary (`componentDidCatch`/`getDerivedStateFromError`) → `parent.postMessage({type:'runtime-error', message, stack, componentStack}, '*')`. Sandboxed frame CANNOT reach `window.parent` directly (throws SecurityError) → postMessage is the only outbound channel.

**Self-heal budget:** **max 2 repair attempts** — research shows self-debugging decays exponentially; 1–2 iterations capture the bulk; diverse initial generations often beat deep repair chains. Wrap with retries + **circuit breaker** → after 2 fails, render a **safe placeholder fallback**, never loop unbounded.

## 4. a11y (axe-core) — axe CANNOT enter the null-origin sandbox from the parent

- axe auto-traverses **same-origin** iframes (injects itself + postMessages results) but **cannot enter cross-origin/sandboxed (opaque `"null"`) frames** — issue #3002 confirms it errors/flags `frame-tested` as *incomplete/review*. Do NOT add `allow-same-origin` just to let axe reach in (defeats the sandbox).
- **Pattern A (runtime, CHOSEN for the island):** bundle `axe-core` 4.12.1 INTO the srcdoc, run `axe.run(document)` inside the frame, `postMessage(violations)` out to the host, render impact-ranked list (critical>serious>moderate>minor, with `help`/`helpUrl`/`nodes[].target`). Only needs `allow-scripts`.
- **Pattern B (CI gating):** render generated code in a same-origin harness — `@axe-core/playwright` 4.12.1 (`AxeBuilder().include().withTags(['wcag2a','wcag2aa']).analyze()`), and `vitest-axe`/`jest-axe` (`toHaveNoViolations`) for component-level. jsdom lacks layout → use real browser for contrast/layout rules.

## 5. Security / injection fixtures (track 5 — verified)

**CSP inside the frame (defense-in-depth, EMPIRICALLY TESTED — simonw/research ran 63 escape attempts across Chromium+Firefox, all egress blocked):**
- Meta-CSP as first element of srcdoc: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';`
- `connect-src 'none'` is the network-egress kill switch — blocks `fetch`, XHR, `WebSocket`, `EventSource`/SSE, `sendBeacon`, `<a ping>`. Allowlist a single endpoint by replacing `'none'` with the URL.
- CSP **persists even when the frame navigates to `data:` URIs** and framed JS **cannot remove/disable the meta CSP**. `sandbox="allow-scripts"` ALONE is NOT enough — without CSP a `data:`-URI page can still reach the network (both engines). CSP + sandbox are complementary.
- **Cross-browser gap:** the `csp=` *attribute* on `<iframe>` works only in Chromium; **Firefox ignores it**. Use BOTH the `csp=` attribute (Chromium DiD) AND the `<meta>` CSP (the one that enforces in Firefox), meta first.
- Meta-CSP CANNOT carry `frame-ancestors`, `sandbox`, or `report-uri` (header-only) — fine, the iframe `sandbox` attr covers sandboxing.

**postMessage (null-origin adaptation — the generic "validate origin" advice misleads here):**
- Frame is opaque origin → `event.origin === "null"`, useless as identity (two opaque origins both stringify `"null"`). Correct receive-side check = **`event.source === iframeRef.contentWindow` AND `event.origin === "null"` AND Zod-validate the payload shape**. Never `eval`/`innerHTML` a payload.
- Post *to* the null-origin frame with `targetOrigin:"*"` (no addressable origin) — so sender-object validation on receive is essential.
- Robust channel = **`MessageChannel`**: transfer `port2` into the frame on the initial (validated) handshake; subsequent traffic bypasses the global `message` bus. Add a **nonce** to the schema for replay protection.
- Real-world stakes: MSRC 2025 documented token leaks from `postMessage(msg,'*')`; CVE-2024-49038 (Copilot Studio, CVSS 9.3) 0-click XSS via permissive postMessage.

**Host/credential access is already denied by the opaque origin (confirmed):** `localStorage`/`sessionStorage` throw `SecurityError` ("not available for opaque origins"); `document.cookie` empty; `window.parent.document` throws `SecurityError`; `location.origin === "null"`.

**Residual risks NOT covered by SOP+CSP:** (1) **DoS** — infinite loop / memory exhaustion (same-thread). Mitigate via a parent-side watchdog timeout + (future) Web Worker with `terminate()`. (2) top-nav/popups/forms/modals/downloads — leave ALL those sandbox tokens OFF. (3) clickjacking/timing side-channels — serve from a separate origin where it matters (future). `sendBeacon` returns `true` even when CSP-blocked → never assert on its return value; assert server/network-side.

**Regression fixtures — MUST use a real browser (Playwright), NOT jsdom** (jsdom doesn't enforce real sandbox/CSP/opaque-origin → tests pass vacuously). Run in **BOTH Chromium + Firefox** (Firefox ignores `csp=` attr, so this proves the meta tag enforces). Assertions (each an escape the jail must defeat), evaluated from INSIDE the frame via `frameLocator()`/`page.frames()` matched by URL not index:
1. `window.parent.document.body` → `SecurityError`
2. `document.cookie` → `""`
3. `localStorage.length` → `SecurityError`
4. `location.origin` → `"null"`
5. `fetch("https://attacker.example")` → rejected + `securitypolicyviolation` (assert event fired AND local test server saw zero requests)
6. `frameElement.removeAttribute("sandbox")` → throws/no-effect; #1 still throws after
7. `top.location = "..."` → no navigation (`page.url()` unchanged)
8. nested iframe without CSP → egress still blocked
9. `document.write` of permissive meta+script → injected script rejected
10. register `securitypolicyviolation` listener → assert `violatedDirective === 'connect-src'` after blocked fetch

**Belt-and-suspenders:** overriding `window.fetch`/`XMLHttpRequest` inside the frame is defeatable by untrusted code — never the only control; CSP is the enforcement layer. The **AST-allowlist gate (host-side, pre-execution)** is the cheapest deterministic place to stop `fetch`/`localStorage`/`eval`/`import` before code ever reaches the frame.

---

## Implications for the SPIKE (scope)

**Build (prove in isolation):**
1. `<iframe sandbox="allow-scripts" srcdoc>` island component (null-origin) + validated postMessage bridge (source/nonce identity, Zod payload) + self-hosted React/ReactDOM UMD + `@babel/standalone` + meta-CSP `connect-src 'none'`.
2. Repair harness: `@babel/parser` validate → AST-walk allowlist (reject imports/eval/fetch/parent/cookie) → recast autofix (inject React/default export) → run → in-frame error capture (onerror+unhandledrejection+error boundary) → **≤2** Bedrock self-heal retries → safe placeholder fallback.
3. Adversarial-injection regression fixtures (a–e above) — must all be BLOCKED.
4. a11y: axe-core inside the frame → postMessage violations (Pattern A) + a vitest-axe component check (Pattern B).
5. One **curveball** corpus prompt the declarative tiers cannot express renders a working interactive widget (candidates: #57 soundscape mixer, #54 collaborative whiteboard, #61 3D configurator — all self-contained, canvas/Web-Audio, offline).

**Defer to full phase:** npm-package imports (Sandpack upgrade), multi-file islands, eval-harness rubric scoring vs baseline, streaming autofix, fine-tuned fixer model, production hardening.
