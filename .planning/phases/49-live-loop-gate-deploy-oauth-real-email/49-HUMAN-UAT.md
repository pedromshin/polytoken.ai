---
status: partial
phase: 49-live-loop-gate-deploy-oauth-real-email
source: [49-VERIFICATION.md]
started: 2026-07-11T03:55:00Z
updated: 2026-07-11T03:55:00Z
---

## Current Test

[awaiting human testing — full runsheet: MORNING-CHECKLIST.md in this directory]

## Tests

### 1. OAuth gate — Google sign-in on the deployed app (LIVE-03)
expected: MORNING-CHECKLIST.md §A executed (console scopes, both redirect URIs, both dashboards, env vars); user signs in with real Google account at the deployed app; session persists across full reload; sign-out works; server-side check shows auth.identities gained a google row LINKED to the pre-created user (staging a829b79d-…, prod 179370cf-…) with NO duplicate user row
result: [pending]

### 2. Forwarding gate — SES apply + Gmail handshake + real message (LIVE-04)
expected: user reviews artifacts/forwarding-catchall-tfplan.txt (1 add/0 change/0 destroy) and runs `npm run infra:tf -- apply`; /settings/forwarding yields u-{token}@magnitudetech.com.br; Gmail verification code round-trips through the app inbox; a real forwarded message with attachment lands, threads group correctly, attachment stored (all confirmed by prod-DB queries, not logs)
result: [pending]

### 3. GitHub-rename decision (LIVE-07 final slice)
expected: user chooses Option 1 (rename + companion IAM terraform apply in the same sitting) or Option 2 (re-park, documented) — MORNING-CHECKLIST.md §C
result: [pending]

### 4. ECS deploy coverage-gate decision (LIVE-02 exception)
expected: user decides: approve documented ratchet of --cov-fail-under (80 → 65 with step-ups tracked in .planning/todos) or hold ECS image deploys until coverage recovers; lowering it was policy-denied for the autonomous run
result: [pending]

### 5. Hosted DB password refresh (housekeeping)
expected: .env.staging/.env.production POSTGRES_URL_NON_POOLING passwords refreshed from Supabase Dashboard → Database Settings; ten verify-00XX-live.ts scripts pass natively per host
result: [pending]

### 6. Brand-mark visual fit sign-off (BRND-01 / Phase 47 scenario 47.1)
expected: user looks at the real captured login-page pixels — `.planning/ui-reviews/2026-07-11T04-32-30-989Z/login-desktop.png` (or the live deployed/dev-server app) — and judges whether the rendered brand mark (sidebar slot, login card, favicon/browser tab) reads as a credible rounded "node/brain hybrid" (D-47-02) that fits the warm polytoken register and is an acceptable foundation for the re-skin. Routed here by Phase 50 Plan 04 (LIVE-05) because no DOM/CSS assertion can close a subjective aesthetic judgment — evidence is already captured, only the human call is outstanding. See MORNING-CHECKLIST.md §E.3.
result: [pending]

### 7. Gmail-forward fixture realism (THRD-02 / Phase 45 scenario 45.5)
expected: user forwards a real email to themselves via Gmail's UI, saves the raw message
(`Show original` → `Download original`), and confirms
`apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml` matches its header shape
(`References`/`In-Reply-To` stripped, `Fwd:` subject, embedded original headers in body);
replaces the constructed fixture with the real one if they differ and re-runs
`uv run pytest tests/domain/services/test_thread_grouping.py --no-cov`. Routed here by Phase 50
Plan 05 (LIVE-05) — a standalone manual confirmation step, not gated behind a tracked
deploy/OAuth gate (no cross-reference to items 1/2). See MORNING-CHECKLIST.md §F.1.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
