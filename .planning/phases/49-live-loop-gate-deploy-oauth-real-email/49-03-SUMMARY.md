---
phase: 49-live-loop-gate-deploy-oauth-real-email
plan: 03
subsystem: testing
tags: [playwright, supabase-ssr, gotrue, bedrock, e2e, pg]

# Dependency graph
requires:
  - phase: 49-01
    provides: "docs/RUN-LOCAL.md cold-start procedure + scripts/preflight-local.ps1 preflight, which this plan exercised live"
provides:
  - "apps/web/e2e/helpers/seed-session.ts — reusable seeded-session Playwright helper (GoTrue admin magiclink + verifyOtp, exact @supabase/ssr cookie encoding)"
  - "apps/web/e2e/live-loop-green.spec.ts — DB-verified LIVE-01 green-path spec, autonomously repeatable"
  - "LIVE-01 requirement CLOSED — live, DB-verified proof captured"
affects: [49-05, 49-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seeded-session e2e auth via GoTrue admin generateLink(magiclink) + verifyOtp, cookie built with @supabase/ssr's OWN exported createChunks/stringToBase64URL primitives (never a hand-rolled re-implementation)"
    - "Deterministic DB-inserted fixture rows (own random id + unique marker text) instead of UI-created + 'most recent' polling, so parallel Playwright projects (chromium/firefox) sharing one local stack never race on the same user's rows"

key-files:
  created:
    - apps/web/e2e/helpers/seed-session.ts
    - apps/web/e2e/live-loop-green.spec.ts
    - .planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/local-green-db-verification.md
  modified: []

key-decisions:
  - "Cookie storageKey derived via the same hostname.split('.')[0] rule @supabase/supabase-js itself uses (sb-127-auth-token for http://127.0.0.1:54321) — reverse-engineered from the installed package source rather than guessed, and the chunking/encoding delegates to @supabase/ssr's own exported createChunks/stringToBase64URL so the cookie can never silently drift from what the app reads"
  - "search_emails/lookup_entity/search_knowledge all read CONFIRMED extracted data (find_similar_confirmed, entity_instances, knowledge_nodes) which a fresh local DB has none of by design — the spec accepts a genuine ZERO-result tool round as valid evidence (a real chat_run_events row, a real DB read) rather than seeding fake confirmed-extraction data just to force non-empty results"
  - "Chat conversation identification uses a spec-owned direct INSERT (random id + run-unique title) instead of clicking 'New chat' and polling 'most recent conversation for this user' — the polling approach raced against the OTHER Playwright project (chromium+firefox run concurrently against the SAME shared local stack/user) and could silently attribute one browser's evidence check to the other browser's conversation"

requirements-completed: [LIVE-01]

# Metrics
duration: ~50min
completed: 2026-07-11
---

# Phase 49 Plan 03: LIVE-01 DB-Verified Green-Path Summary

**Seeded-session Playwright spec (no interactive Google) drives login → inbox → thread → email detail → chat (real Bedrock Sonnet 4.6 tool round + genui card) → /knowledge against the live local stack, every step backed by a direct pg query — passed on both chromium and firefox.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-11T01:26:00Z (approx, immediately after 49-01/49-02 close)
- **Completed:** 2026-07-11T02:15:58Z
- **Tasks:** 2 completed
- **Files modified:** 3 (all new)

## Accomplishments
- `apps/web/e2e/helpers/seed-session.ts` (170 lines) mints a REAL Supabase session for the documented local seed user via GoTrue admin (`createUser` idempotent + `generateLink({type:'magiclink'})` + `verifyOtp`) — never clicking through interactive Google — and injects the resulting `sb-127-auth-token` cookie(s) into a Playwright `BrowserContext` using `@supabase/ssr`'s own exported `createChunks`/`stringToBase64URL` primitives, so the encoding can never drift from what `apps/web/src/lib/supabase/*` actually reads. Reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` from env only (loaded from root `.env.local` since Playwright's own test runner doesn't dotenv-wrap itself), throws a clear error if absent, never logs a secret or token.
- `apps/web/e2e/live-loop-green.spec.ts` (330 lines) drives the full green path live against the local stack: seeded login → `/` (inbox, DB-asserted against the seeded fixture thread) → "Open editor →" into `/emails/[id]` (DB-asserted email ownership) → `/chat` (a directly-inserted, uniquely-titled conversation; sends a prompt that reliably drives BOTH a `search_emails` tool_invocation and a rendered `emit_ui_spec` genui card; DB-asserted via `chat_run_events`/`chat_messages`) → `/knowledge` (DB-asserted `has_table_privilege('service_role', 'public.knowledge_nodes', 'SELECT')`). Never redirects to `/login` at any step (explicit `assertNotLoginUrl` after every navigation).
- **Ran live, twice** (chromium + firefox, the config's default two projects) against the actually-running local stack — Supabase (already up 6h under `project_id=polytoken`), the FastAPI listener (started fresh for this plan, `uv run uvicorn ... --host 127.0.0.1 --port 8000`, no `--reload`), and the already-running `npm run dev`. Both projects passed (37.5s total). The captured DB evidence shows a REAL `search_emails` tool call (query="invoice"), a REAL zero-result envelope (the fresh DB has no confirmed-extracted emails, exactly as expected), and a REAL rendered `genui_spec` card summarizing the search — proving the tool-loop → SSE → UI → DB round-trip is genuinely wired, not faked.
- Captured `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/local-green-db-verification.md` with the query + result for all four steps.
- **LIVE-01 marked Complete** in REQUIREMENTS.md — this plan is exactly the live execution 49-01's summary deferred to.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the seeded-session helper (no interactive Google)** - `3746676` (feat)
2. **Task 2: Write + run the DB-verified green-path spec, capture evidence** - `e4e3fbe` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `apps/web/e2e/helpers/seed-session.ts` - Programmatic authenticated-session seeding (GoTrue admin + `@supabase/ssr` cookie encoding)
- `apps/web/e2e/live-loop-green.spec.ts` - End-to-end green-path spec, DB-verified at every step
- `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/local-green-db-verification.md` - Captured evidence (query + result per step)

## Decisions Made
- Reverse-engineered the exact `@supabase/ssr` cookie scheme from the installed package source (`sb-${hostname.split('.')[0]}-auth-token`, `base64-` + base64url-encoded `JSON.stringify(session)`, chunked past 3180 chars) rather than guessing — and delegated the encoding itself to the library's own exported `createChunks`/`stringToBase64URL` so the helper can never silently drift from what the app reads.
- Accepted a genuine zero-result tool round as valid LIVE-01 evidence: `search_emails`/`lookup_entity`/`search_knowledge` all read CONFIRMED extracted data, which a fresh local DB has none of by design (no confirmed regions/entity instances/knowledge nodes exist without a full parse→extract→confirm cycle). Seeding fake "confirmed" data just to force non-empty results would have been a bigger deviation than the plan's own scope; a real DB read returning zero rows is still a real, DB-verified tool round.
- Switched the chat step from "click New chat → poll DB for most-recent conversation for this user" to "insert the conversation row directly with a run-unique title, then select it by that title" after discovering the polling approach is racy: `playwright.config.ts` runs BOTH chromium and firefox projects concurrently against the SAME shared local Supabase/dev-server/user, so "most recent conversation for user X" can return the OTHER browser's row mid-run.
- `Entity Type: Invoice` (the seeded system-default taxonomy) was already sufficient to satisfy "the tiered canvas renders nodes" for `/knowledge` — no `knowledge_nodes` seeding needed, since `knowledge.graph` ALWAYS returns `entity_type`/`entity_type_field` nodes regardless of instance data (D-02 "never-blank" taxonomy layer). The `has_table_privilege` assertion (the plan's literal LIVE-01 bar, and the exact check `scripts/preflight-local.ps1` already runs) was the correct thing to gate on, not node count.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `toHaveURL` default 5s timeout too tight for Next.js dev-mode on-demand route compilation under concurrent browser-project load**
- **Found during:** Task 2, first live run
- **Issue:** The first live run of both browser projects failed identically at "thread -> email detail renders": the "Open editor →" link's href was correct and a solo debug run of the identical click navigated fine in under 4s, but under concurrent chromium+firefox load against the SAME `npm run dev` process, the client-side navigation to `/emails/[id]` (its first compile this dev-server session) exceeded the assertion's default 5000ms timeout.
- **Fix:** Added an explicit `{ timeout: 20_000 }` to the `toHaveURL` assertion.
- **Files modified:** apps/web/e2e/live-loop-green.spec.ts
- **Verification:** Full spec reran clean on both projects after the fix (combined with deviation 2 below).
- **Committed in:** e4e3fbe (Task 2 commit — fixed before commit, no separate follow-up needed)

**2. [Rule 1 - Bug] Racy "click New chat + poll for most-recent conversation" cross-project collision**
- **Found during:** Task 2, second live run
- **Issue:** After fixing deviation 1, the chat step failed with a Playwright strict-mode violation: `getByRole("button", { name: "New chat" })` (before adding `.first()`) matched two elements (rail button + empty-state button). Investigating further surfaced the deeper issue this masked: identifying "the conversation I just created" via `SELECT ... ORDER BY created_at DESC LIMIT 1 WHERE user_id = $1` is inherently racy when two Playwright projects run concurrently against the same shared local stack and the SAME seeded user — one browser's DB evidence check could silently read the other browser's conversation.
- **Fix:** Replaced the "New chat" click + polling entirely with a spec-owned direct `INSERT INTO chat_conversations` (a fresh `randomUUID()` + a run-unique title `LIVE-01 fixture ${id.slice(0,8)}`), then selected that exact row in the UI via an anchored regex (`^${title}`, to disambiguate the row-select button from the sibling "More actions for {title}" overflow-menu button, which also substring-matched the bare title string).
- **Files modified:** apps/web/e2e/live-loop-green.spec.ts
- **Verification:** Full spec reran clean on both chromium and firefox (2 passed, 37.5s) with a genuine `search_emails` tool_invocation + `genui_spec` card verified in the DB for the exact conversation id the spec itself owns.
- **Committed in:** e4e3fbe (Task 2 commit — fixed before commit, no separate follow-up needed)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs discovered and fixed during the plan's own live-execution loop, both live in the final committed spec, no broken intermediate state committed)
**Impact on plan:** Both fixes were necessary for the spec to genuinely pass against the real concurrent two-browser-project stack the plan's own verify command (`npm run test:e2e -w @polytoken/web -- live-loop-green.spec.ts`, no `--project` filter) runs. No scope creep — both fixes are within `live-loop-green.spec.ts`, the exact file Task 2 specifies.

## Issues Encountered
- `apps/web/tsconfig.json` explicitly excludes `e2e/**` from `tsc`'s program (`"exclude": [..., "e2e", "playwright.config.ts"]`), so the plan's literal Task 1 verify command (`npm run -s typecheck -w @polytoken/web`) never actually type-checks either new e2e file — a pre-existing gap in the repo's typecheck coverage, not something this plan introduced or is scoped to fix. Verified both files' types manually instead: a scratch `tsconfig.e2e-check.json` (extends the real tsconfig, includes only `e2e/**/*.ts`, deleted before this commit — never part of the deliverable set) ran clean with zero errors on both files.
- `npm run -s typecheck -w @polytoken/web` (the plan's literal Task 1 verify command) itself fails today, but on PRE-EXISTING, unrelated errors: `src/app/dev/design/` (untracked scratch content already present in the working tree before this plan started — visible in `git status` at session start, and the tsconfig's own comment marks it a known Phase-42 hard-exclusion gap). Out of scope per the deviation rules' scope boundary (only auto-fix issues directly caused by this plan's changes); not touched.
- The local stack was already up and DB-verified green when this plan started (Supabase running 6h under `project_id=polytoken`, the seeded user already present) — `scripts/preflight-local.ps1` itself was not re-run in this session, only the FastAPI listener was freshly started (`uv run uvicorn app.main:app --host 127.0.0.1 --port 8000`, no `--reload`) since it was not yet running. This matches 49-01's own note that live exercise of the preflight script was deferred to this plan; the DB-based green assertion (`has_table_privilege` = true, 25 tables in `public`) was independently re-verified here before writing any fixture data.

## User Setup Required

None — this plan reads only already-present local env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POSTGRES_URL_NON_POOLING`, all already in root `.env.local` per 49-01`), and required no new secrets or external service configuration.

## Next Phase Readiness
- LIVE-01 is CLOSED — the local green loop is proven live and DB-verified, autonomously repeatable via `npm run test:e2e -w @polytoken/web -- live-loop-green.spec.ts` any time the local stack (Supabase + listener + web) is up per `docs/RUN-LOCAL.md`.
- `apps/web/e2e/helpers/seed-session.ts` is a reusable building block for any FUTURE local e2e spec that needs an authenticated context without interactive Google — plan 49-05/49-06 (staging/prod migrations, OAuth runbook) can reference it for local regression coverage, though it explicitly does NOT touch the deployed-app interactive Google flow (LIVE-03, user-gated, plan 49-06).
- Minor known side effect: each spec run inserts a fresh fixture email/thread pair (idempotent, fixed ids, upserted) plus one NEW chat_conversations/chat_messages/chat_runs row set per browser project (random id, never cleaned up) — harmless for a local dev DB, but repeated runs will accumulate chat history rows. Not addressed here; out of this plan's scope (no cleanup step was specified).
- The FastAPI listener process this plan started (background, PID via `uv run uvicorn`) is still running for any follow-up manual verification in this session; it was not part of this plan's deliverables and is not itself tracked by git.

---
*Phase: 49-live-loop-gate-deploy-oauth-real-email*
*Completed: 2026-07-11*

## Self-Check: PASSED

- FOUND: apps/web/e2e/helpers/seed-session.ts
- FOUND: apps/web/e2e/live-loop-green.spec.ts
- FOUND: .planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/local-green-db-verification.md
- FOUND: 3746676 (Task 1 commit)
- FOUND: e4e3fbe (Task 2 commit)
