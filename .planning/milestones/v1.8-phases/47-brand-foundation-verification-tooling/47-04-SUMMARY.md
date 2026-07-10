---
phase: 47-brand-foundation-verification-tooling
plan: 04
subsystem: testing
tags: [playwright, e2e, chromium, firefox, code-island, sandbox, auth-redirect]

# Dependency graph
requires:
  - phase: 20-code-island-sandbox-spike
    provides: apps/web/e2e/code-island-isolation.spec.ts + packages/genui/src/sandbox (ISLAND_SANDBOX, buildIslandSrcdoc)
  - phase: 43-auth-google-oauth-sessions-supabase-auth
    provides: apps/web/e2e/auth-redirect.spec.ts + the route-guard middleware it exercises
provides:
  - "@playwright/test devDependency pinned exactly (1.61.1) in apps/web, chromium+firefox browser binaries installed"
  - "apps/web/playwright.config.ts: testDir ./e2e, chromium+firefox projects, baseURL, webServer(npm run dev, reuseExistingServer)"
  - "apps/web test:e2e script (playwright test)"
  - "First real browser run of both parked specs: 10/12 assertions pass on chromium+firefox; 1 pre-existing spec-authoring defect identified and documented (not fixed — out of this plan's edit boundary)"
affects: [48-design-token-system, 49-brand-reskin-application, any-future-e2e-work]

# Tech tracking
tech-stack:
  added: ["@playwright/test@1.61.1 (devDependency, apps/web)", "Playwright firefox browser binary (local, %LOCALAPPDATA%/ms-playwright)"]
  patterns: ["e2e specs live under apps/web/e2e/*.spec.ts, run via `npm run test:e2e` from apps/web", "webServer.reuseExistingServer:true so the harness works whether or not a dev server is already running on :3000"]

key-files:
  created: []
  modified:
    - apps/web/package.json
    - apps/web/playwright.config.ts
    - .gitignore
    - package-lock.json

key-decisions:
  - "T-47-SC supply-chain checkpoint pre-approved by orchestrator under standing autonomous mandate; verified independently via npm registry (microsoft/playwright org, 1.61.1 current stable, no typosquat)."
  - "Extended the pre-existing Phase-20 playwright.config.ts (baseURL + webServer + forbidOnly/retries) rather than replacing it, preserving its SPIKE-era chromium/firefox project definitions."
  - "VRFY-01 left Pending (NOT marked Complete): the requirement text demands the code-island spec runs green on chromium AND firefox, and one of its five assertions currently times out on both engines due to a pre-existing probe bug (see Deviations)."

patterns-established:
  - "e2e diagnostics: reproduce root-cause hypotheses with a throwaway, non-committed spec file inside e2e/ (deleted before finishing) rather than editing a protected spec under test."

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-07-10
---

# Phase 47 Plan 04: Playwright Toolchain + Parked Spec Runs Summary

**Installed the Playwright toolchain (chromium+firefox, pinned 1.61.1) and ran both long-parked e2e specs for the first time against real browsers — 10/12 assertions pass; the 1 failing code-island assertion is a pre-existing spec-authoring bug (unhandled `SecurityError` on opaque-origin `document.cookie` read), not an isolation weakness or a config gap.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-10T17:55:00Z (approx)
- **Completed:** 2026-07-10T18:10:00Z
- **Tasks:** 2 of 3 produced commits (Task 1 was a pre-approved checkpoint; Task 3 was a verification run with no file changes to commit)
- **Files modified:** 4

## Accomplishments
- `@playwright/test` installed as an exact-pinned (`1.61.1`, no caret) apps/web devDependency; package-lock.json integrity hash updated as the supply-chain provenance record
- Firefox browser binary installed locally (`firefox-1532`, chromium builds already present)
- `apps/web/playwright.config.ts` extended with `baseURL`, `webServer` (`npm run dev`, `reuseExistingServer: true`, 120s timeout), `forbidOnly`/`retries` — on top of the existing Phase-20 chromium+firefox project definitions
- `test:e2e` script added to apps/web/package.json
- Playwright artifact dirs (`test-results/`, `playwright-report/`) gitignored
- First real execution of both parked specs, confirmed reproducible: **10 of 12 assertions pass** (4 code-island assertions × 2 engines + auth-redirect × 2 engines); 1 code-island assertion fails identically on both engines for a documented, non-config reason (see below)

## Task Commits

1. **Task 1: Supply-chain legitimacy gate — @playwright/test (T-47-SC)** — pre-approved by orchestrator (see Checkpoint section below); no commit (gate-only task)
2. **Task 2: Install @playwright/test + firefox, write playwright.config.ts** - `e976660` (feat)
3. **Task 3: Run both parked specs on chromium + firefox** — verification-only task, no file changes produced (config from Task 2 needed no import-resolution fix); results documented below and in Deviations

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/package.json` - `@playwright/test` devDependency pinned exact `1.61.1`; added `test:e2e` script
- `apps/web/playwright.config.ts` - extended existing config with `baseURL`, `webServer`, `forbidOnly`, `retries`
- `.gitignore` - added `apps/web/test-results/` and `apps/web/playwright-report/`
- `package-lock.json` - lockfile entries for `@playwright/test@1.61.1` and its transitive deps

## Decisions Made

- **T-47-SC checkpoint:** pre-approved by the orchestrator under the user's standing autonomous mandate. Independently re-verified before install: `@playwright/test` is published by the `microsoft`/`playwright` npm org (github.com/microsoft/playwright), millions of weekly downloads, `1.61.1` was the current stable version at install time (confirmed via `npm view @playwright/test version`), no typosquat variant was considered. Installed as a devDependency only; no postinstall exfiltration risk (Playwright's postinstall only prints a CLI hint, browser binaries are pulled explicitly and separately via `npx playwright install`).
- **Config reuse over replacement:** `apps/web/playwright.config.ts` already existed (committed in Phase 20's SPIKE, `6c72e7a`/`2aa0a07`) with `testDir`, `testMatch`, and the two browser projects. Extended it in place with the `use.baseURL`/`webServer` block needed for `auth-redirect.spec.ts` rather than rewriting from scratch — preserves the Phase-20 authorship and its inline documentation of the CSP/opaque-origin threat model.
- **VRFY-01 left Pending.** The requirement's literal text ("the parked code-island isolation spec runs green on chromium AND firefox") is not met — 1 of its 5 assertions times out on both engines. Marking it Complete would misrepresent the state; see Deviations for the full root-cause and recommended fast-follow.

## Deviations from Plan

### Genuine Finding (not auto-fixed — spec file is out of this plan's edit boundary)

**1. [Task 3 acceptance not fully met] `code-island-isolation.spec.ts` "cannot read cookies / localStorage" assertion times out on BOTH chromium and firefox**

- **Found during:** Task 3 (first real run of both parked specs)
- **Symptom:** `await expect(body).toHaveAttribute("data-cookie", "")` times out after 5000ms waiting for an attribute that is never set, on both engines identically.
- **Root cause (confirmed empirically):** Per the HTML spec (`https://html.spec.whatwg.org/#dom-document-cookie`), reading `document.cookie` from a document with an **opaque origin** (exactly what `ISLAND_SANDBOX = "allow-scripts"` with no `allow-same-origin` produces — see `packages/genui/src/sandbox/build-island-srcdoc.ts`) throws a `SecurityError` DOMException **synchronously**, rather than returning `""`. The spec's probe (`document.body.dataset.cookie = String(document.cookie);`) has no try/catch of its own around that specific statement, so the throw propagates up to the code-island harness's own outer per-script try/catch (`build-island-srcdoc.ts` line 112), which catches it, posts an `island-runtime-error` postMessage, and returns — **never setting `data-cookie` or `data-ls`**. Reproduced this exact chain with a throwaway, uncommitted diagnostic spec (deleted before finishing) that ran the identical probe/harness pattern standalone: it printed `outerCatch="SecurityError"` on **both** chromium and firefox.
- **This is not an isolation weakness — it is stronger than the spec assumed.** The security property the test intends to prove (the code-island cannot read cookies) fully holds; cookie *access itself* is blocked at the engine level with a hard throw, not silently degraded to an empty read. The other 4 code-island assertions (opaque origin, parent-DOM SecurityError, CSP network egress block, top-nav block) all pass on both engines, confirming the sandbox is intact.
- **Why not fixed:** Task 3's acceptance criteria (automated, verbatim from the plan) requires `git diff apps/web/e2e/code-island-isolation.spec.ts` to be **empty** — the spec file is explicitly off-limits for edits in this plan (threat model T-47-08: "the sandbox checks cannot be weakened to make the run pass"). There is no config-layer or non-spec-file fix: this is inherent, spec-compliant browser behavior for opaque-origin documents, not a Playwright/webpack/esbuild resolution issue. Per the plan's own project_notes ("If the code-island spec fails for REAL isolation reasons (not config), that is a genuine finding — report it honestly, do not weaken the spec"), this is reported here rather than silently patched around.
- **Files touched:** none (diagnostic spec was created and deleted within `apps/web/e2e/`, never committed; confirmed via `git status --short apps/web/e2e/` showing clean).
- **Recommended fast-follow (out of scope for this plan):** wrap the cookie read in its own try/catch in a future micro-plan, e.g.:
  ```ts
  try { document.body.dataset.cookie = String(document.cookie); }
  catch (e) { document.body.dataset.cookie = (e as Error).name; }
  ```
  and update the assertion to expect `"SecurityError"` instead of `""`. This 2-line change would make the assertion match actual (stronger-than-assumed) browser behavior without touching `ISLAND_SANDBOX`/`buildIslandSrcdoc`.

---

**Total deviations:** 1 documented genuine finding (0 auto-fixed — the fix is explicitly out of this plan's edit boundary)
**Impact on plan:** Toolchain (Task 1+2) fully delivered and working. Task 3's verification run is complete and honest; 10/12 assertions pass, the 1 failure is a proven non-security, non-config, pre-existing test-authoring gap. VRFY-01 correctly left Pending rather than falsely marked Complete.

## Issues Encountered

- `npm run test:e2e` exits 1 (not 0) due to the finding above — documented rather than forced green. Re-run twice to confirm reproducibility (identical result both times).
- A dev server was already running on port 3000 (PID 20468) at execution time; `webServer.reuseExistingServer: true` picked it up correctly for the `auth-redirect.spec.ts` run without any port conflict or need to kill the user's process.

## User Setup Required

None — `npx playwright install firefox` was run automatically as part of Task 2 (project_notes explicitly allowed this ~90MB download). No dashboard configuration needed.

## Next Phase Readiness

- The Playwright toolchain is installed, pinned, and gitignored correctly — every later v1.8 phase (48, 49) can add new specs under `apps/web/e2e/` and run them with `npm run test:e2e` immediately, no further setup.
- `auth-redirect.spec.ts` is fully green on both engines — AUTH-02's route-guard middleware is proven end-to-end against a real running app.
- VRFY-02 (screenshot harness, 47-05) is unblocked and can proceed independently of this finding.
- **Blocker carried forward:** VRFY-01 stays Pending until a future micro-fix corrects the cookie-read probe in `code-island-isolation.spec.ts` (see recommended fast-follow above). This does not block Phase 48/49 — the underlying sandbox is proven sound; only the requirement's literal "green run" wording is unmet.

---
*Phase: 47-brand-foundation-verification-tooling*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: apps/web/package.json
- FOUND: apps/web/playwright.config.ts
- FOUND: .gitignore
- FOUND: package-lock.json
- FOUND: .planning/phases/47-brand-foundation-verification-tooling/47-04-SUMMARY.md
- FOUND: commit e976660 (feat(47-04): install @playwright/test + firefox, add playwright.config.ts)
