---
created: 2026-07-10
source: 46-VERIFICATION.md accepted override (HYGN-01 / DEF-20-01)
---

# Run Playwright code-island isolation spec on real browsers

**What:** Execute `apps/web/e2e/code-island-isolation.spec.ts` (and
`apps/web/e2e/auth-redirect.spec.ts` from 43-05) against chromium AND firefox.

**Why deferred:** Requires installing `@playwright/test` (+ firefox download) —
blocked during v1.7 by the milestone's locked "ONE new npm dependency
(`@supabase/ssr`)" guardrail, and earlier by the Phase-43 concurrency lock on
root `package.json`. The deterministic AST-allowlist vitest substitute is green
(39/39, independently reproduced by the Phase-46 verifier).

**Unblocks in:** v1.8 (dependency freeze lifts). Chromium builds are already in
`%LOCALAPPDATA%/ms-playwright`; firefox needs `npx playwright install firefox`.
