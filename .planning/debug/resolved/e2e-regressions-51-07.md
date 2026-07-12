---
status: resolved
trigger: "Root-cause and fix the 7 E2E regressions found by Phase 51-07 §G.3 regression run against live local stack, then re-run to green and commit."
created: 2026-07-12T00:00:00Z
updated: 2026-07-12T01:10:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    FOUR distinct root causes, none of them Phase 51/52/53/54 PRODUCT regressions:
    1. seed-session.ts's admin.generateLink+verifyOtp magic-link mint races across
       Playwright workers/files that ALL target the SAME hardcoded seed email —
       GoTrue invalidates a user's prior unconsumed magic link when a new one is
       minted, so two workers seeding concurrently can fail verifyOtp with "Email
       link is invalid or has expired". Existing file-level test.describe.configure
       serial mode (uat-41, uat-43, uat-48) only prevents INTRA-file races; it does
       NOT protect against INTER-file races, and this run bundles MORE files
       (including Phase 54's new uat-45-threads.spec.ts) than before, raising
       cross-file contention on the one shared seed user.
       Affects: live-loop-green chromium, uat-41.1 chromium, uat-43.2 chromium.
    2. live-loop-green.spec.ts's "thread -> email detail renders" step clicks the
       GLOBAL "Open editor" link without first explicitly selecting its own seeded
       thread row. InboxThreePane's default-select effect auto-picks "the latest
       member of the first visible thread" from page-load-time query data; under
       this run's added concurrency (uat-45-threads.spec.ts inserting ITS OWN
       received_at=now() fixture email on the SAME shared local DB), a sibling
       worker's fresher insert can win the "most recent" slot between this test's
       own insert and its own inbox page load.
       Affects: live-loop-green firefox (confirmed: wrongly-navigated URL
       /emails/50030001-... is EXACTLY uat-45-threads.spec.ts's own fixture email,
       "Re: Fwd: Packing List — UAT-45 Fixture Vessel BF-80").
    3. Dev-server/DB resource contention from running 6 heavy spec files (incl.
       live-loop-green's live-Bedrock 150s+ chat turn) concurrently against ONE
       shared Next dev server + local Supabase — a timing/load flake, not a code
       defect (the SAME openCanvasView() mechanism passed moments earlier as 41.1
       in the same serial run).
       Affects: uat-41.2 firefox ("Test timeout of 60000ms exceeded", "No
       conversations yet" in the DOM snapshot).
    4. GENUINE reproducible bug (confirmed via direct psql query on
       email_components): uat-48-token-surfaces.spec.ts's ON CONFLICT (id) DO
       UPDATE clause for FIXTURE_FIELD_COMPONENT_ID omits `role` from its SET
       list (only sets parent_component_id/entity_type_field_id/extraction_status).
       The row currently has role='entity' in the DB (stale from created_at
       2026-07-11, pre-dating this fix) even though the INSERT's VALUES clause
       literally says role='field' — the incomplete upsert can never self-correct
       a stale role. emails.detail's tRPC procedure resolves entityTypeLabel via
       EntityTypes.label JOINed through ExtractionRecords.entityTypeId (not
       EmailComponents.entityTypeId directly), and this FIELD row's seeded
       extraction record ALSO carries entity_type_id=FIXTURE_ENTITY_TYPE_ID (a
       legitimate "owning entity type" denormalization for FIELD records) — so
       with role stuck at 'entity', LayersPanel renders TWO top-level entity
       treeitems with the IDENTICAL resolved label "UAT-48 Fixture Type",
       producing the observed Playwright strict-mode violation. Ruled out the
       Phase-53 dual-tree (mobile Sheet + desktop persistent panel both mounting
       `layers`) as an alternative cause: the DOM snapshot shows exactly ONE
       `navigation "Regions layers"` landmark containing 2 sibling treeitems (not
       2 separate nav landmarks each with 1 treeitem), which only the DB-level
       duplicate-entity-row explanation produces.
       Affects: uat-48.1 chromium AND firefox (same root cause, deterministic).
  confirming_evidence:
    - "error-context.md for live-loop-green/uat-41.1/uat-43.2 all show the IDENTICAL stack trace: seed-session.ts:148, 'Email link is invalid or has expired'."
    - "live-loop-green firefox error-context.md shows expect(page).toHaveURL failed with Received='/emails/50030001-0000-4000-8000-000000000004' — cross-referenced against uat-45-threads.spec.ts fixtures, this is EXACTLY that file's own seeded email/subject ('UAT-45 Fixture Vessel BF-80'), proving cross-worker DB write interleaving."
    - "uat-41.2 firefox error-context.md shows a bare 'Test timeout of 60000ms exceeded' with the /chat rail showing 'No conversations yet' — no assertion-level error, consistent with slow page/query response under load, and 41.1 (identical mechanism) passed moments before in the same serial run."
    - "Direct psql query (node pg) against email_components WHERE email_id=ee000000-4800-4eee-8eee-0000000000ee returned 2 rows: c1 (role=entity, entity_type_id=e1, status=confirmed) and c2 (role=entity [SHOULD BE field], entity_type_id=NULL, status=candidate, content_text='UAT-48 fixture field region.') — c2's content_text and status prove it's FIXTURE_FIELD_COMPONENT_ID, yet role is stuck at 'entity'."
    - "Read packages/api-client/src/router/emails/detail.ts: entityTypeLabel resolves via EntityTypes.label LEFT JOINed through ExtractionRecords.entityTypeId, and the spec's own extraction_records INSERT sets entity_type_id=FIXTURE_ENTITY_TYPE_ID for the FIELD's extraction record too — confirming both rows resolve the SAME label string."
    - "Read the exact SQL in uat-48-token-surfaces.spec.ts: FIXTURE_FIELD_COMPONENT_ID's ON CONFLICT DO UPDATE SET list is `parent_component_id, entity_type_field_id, extraction_status` — role is absent, confirmed by direct file read."
  falsification_test: |
    For (4): re-run uat-48.1 after adding `role = 'field'` to the ON CONFLICT SET
    clause — the upsert should self-heal the stale row on next seed, and the
    strict-mode violation should disappear on both engines. If it persists, the
    duplicate-row theory is wrong and the Phase-53 dual-Sheet-mount theory needs
    re-examination (would require checking whether @polytoken/ui/sheet actually
    mounts SheetContent when closed).
    For (1)/(2)/(3): re-run the FULL 6-file command 1-2 times after the seed-
    session retry + explicit-row-select fixes — if failures persist with the SAME
    error signatures, the race-condition theory is wrong and something else (e.g.
    a genuine Phase 51-54 regression) needs investigating.
  fix_rationale: |
    (1) Bounded retry+jittered-backoff around generateLink+verifyOtp in
    seed-session.ts is the standard resilience pattern for a confirmed transient
    external-race condition — it does not mask a real auth bug (verifyOtp must
    still genuinely succeed), just tolerates GoTrue's single-active-link-per-user
    invalidation racing across concurrent callers. Fixing it centrally (the
    shared helper) protects every caller uniformly, unlike file-level serial mode
    which only prevents intra-file races.
    (2) Explicitly selecting the fixture's own thread row before clicking "Open
    editor" (matching the EXACT pattern uat-45-threads.spec.ts's own comments
    already establish for this exact class of race) makes the test's assertion
    target deterministic regardless of what other concurrent workers write to the
    shared local DB — addresses the root cause (implicit reliance on "most
    recent" ordering) rather than the symptom (wrong URL).
    (4) Adding `role = 'field'` to the ON CONFLICT SET list makes the upsert
    genuinely idempotent (matches the sibling entity-row upsert's own pattern,
    which DOES set `role = 'entity'` in its SET clause) — fixes the root cause
    (incomplete upsert) rather than manually patching the stale DB row (which
    would only mask the bug until the next re-run reintroduces it).
  blind_spots: |
    - Have not proven WHY c2's role was originally 'entity' on 2026-07-11 (no git
      blame done) — irrelevant to the fix (idempotent upsert self-heals regardless
      of how it got that way) but means the "why" of the historical drift is
      undocumented.
    - (3)'s fix is not yet applied — treating it as provisionally a load flake
      pending a clean re-run after (1)/(2)/(4) land; if it recurs identically,
      will need a targeted timeout/resilience fix in uat-41-knowledge-preview.spec.ts.
    - Have not exhaustively verified @polytoken/ui/sheet's mount behavior when
      closed (whether canvas-shell.tsx's dual layers/inspector slot rendering is a
      LATENT bug elsewhere) — deprioritized since it demonstrably does NOT explain
      uat-48's actual failure (DOM evidence rules it out for this case).
next_action: All fixes verified green across 2 consecutive full-suite runs (32/32 passed both times). Ready to commit.

## Evidence

- timestamp: 2026-07-12T00:20:00Z
  checked: psql (node pg) query on email_components WHERE email_id=ee000000-4800-4eee-8eee-0000000000ee
  found: 2 rows — c1 (role=entity, entity_type_id=e1, confirmed) and c2 (role=entity [should be field], entity_type_id=NULL, candidate, content_text matches FIXTURE_FIELD_COMPONENT_ID's seed text)
  implication: uat-48-token-surfaces.spec.ts's ON CONFLICT DO UPDATE for FIXTURE_FIELD_COMPONENT_ID omits `role` from SET — confirmed root cause of the strict-mode duplicate-treeitem failure (48.1b, both engines)

- timestamp: 2026-07-12T00:25:00Z
  checked: packages/api-client/src/router/emails/detail.ts entityTypeLabel resolution
  found: entityTypeLabel is joined via EntityTypes.label <- ExtractionRecords.entityTypeId (not EmailComponents.entityTypeId directly); the spec's extraction_records seed sets entity_type_id=FIXTURE_ENTITY_TYPE_ID on the FIELD's own extraction record too
  implication: confirms both the real entity row (c1) and the stale-role field row (c2) resolve the IDENTICAL "UAT-48 Fixture Type" label, matching the observed duplicate treeitem text exactly

- timestamp: 2026-07-12T00:30:00Z
  checked: all 7 error-context.md files under apps/web/test-results/
  found: live-loop-green(chromium)/uat-41.1(chromium)/uat-43.2(chromium) share the IDENTICAL "seed-session: verifyOtp failed... Email link is invalid or has expired" stack trace at seed-session.ts:148; live-loop-green(firefox) shows a wrong-URL navigation to uat-45-threads.spec.ts's own fixture email; uat-41.2(firefox) shows a bare test-level timeout with "No conversations yet"; uat-48.1(chromium+firefox) show the identical strict-mode-violation error
  implication: 3 failures share one root cause (magic-link race), 1 failure is a cross-worker DB-write race (inbox default-select), 1 is likely load-induced flake, 2 share the uat-48 upsert bug — 4 distinct root causes total, zero of which are Phase 51/52/53/54 product regressions

- timestamp: 2026-07-12T00:45:00Z
  checked: re-ran the full 6-file command after fixes 1/2/4 (seed-session retry, live-loop-green explicit select, uat-48 upsert role fix)
  found: down to 4 failures (from 7) — 22 passed. NEW failures surfaced that were previously masked: live-loop-green chromium now fails at the /knowledge step (redirected to /login, "not toHaveURL" — a session/cookie-invalid symptom, NOT the earlier seed-session error); live-loop-green firefox fails the SAME way; uat-41.2 chromium now fails cleanly (node never renders, "element(s) not found" instead of a bare timeout); uat-41.2 firefox fails on tooltip-not-dismissing
  implication: fixing the LOUDER race (seed-session magic-link) exposed a QUIETER downstream race that was previously hidden by the earlier failure — needed further investigation, not a new regression

- timestamp: 2026-07-12T00:50:00Z
  checked: docker logs supabase_auth_polytoken --since 30m | grep 403
  found: multiple "session_not_found" 403s on GET /user clustered within seconds of each other across DIFFERENT request_ids (i.e., different browser contexts/tests), plus residual "otp_expired" 403s on /verify (expected — some retry attempts still lose the race, that's fine, the retry wrapper absorbs it)
  implication: something is revoking sessions GLOBALLY for the shared seed user mid-run, affecting multiple concurrently-running tests simultaneously — not a token-expiry issue (jwt_expiry=3600s, sessions are only minutes old)

- timestamp: 2026-07-12T00:55:00Z
  checked: ran a standalone node script directly against local GoTrue: minted session A, then minted session B (fresh magic link) for the SAME user, then attempted to refresh session A's ORIGINAL refresh token
  found: session A's refresh succeeded — minting a new session for a user does NOT invalidate a sibling session's refresh token
  implication: ruled out "new sign-in revokes old sessions" as the cause — the collision must come from an explicit revocation call, not passive session-limit behavior

- timestamp: 2026-07-12T01:00:00Z
  checked: apps/web/src/app/auth/signout/route.ts
  found: "await supabase.auth.signOut();" with NO scope argument — the Supabase JS SDK's default scope is "global", which revokes ALL sessions for that user_id, not just the current browser context's
  implication: ROOT CAUSE of the NEW failures — uat-43-auth.spec.ts's 43.3 scenario exercises this REAL sign-out route against DEFAULT_SEED_EMAIL, and since EVERY other spec file in this run also seeds sessions for that SAME shared seed email concurrently, the instant 43.3's sign-out fires it globally revokes every sibling test's session mid-flight (explains the clustered session_not_found 403s across multiple concurrent tests, and explains why live-loop-green's LONG-running test — 300s timeout, spans a live 150s+ Bedrock call — was most likely to still be mid-flight when this happened)

## Resolution

root_cause: |
  Five independent root causes, ZERO of which are Phase 51/52/53/54 product regressions — all are e2e test-suite topology/infra issues exposed by this run bundling MORE spec files together than the 2026-07-11 baseline (notably Phase 54's new uat-45-threads.spec.ts, which adds 7 more seedAuthenticatedContext calls to the shared contention budget):
  1. seed-session.ts magic-link mint race across concurrent Playwright workers/files sharing one seed email (GoTrue invalidates a user's prior unconsumed magic-link token the moment a new one is minted; file-level `serial` mode only prevents INTRA-file races, not INTER-file ones).
  2. live-loop-green.spec.ts relied on inbox default-select ("most recent email") instead of explicitly selecting its own seeded thread, racing against sibling spec files' concurrent DB writes (confirmed: it landed on uat-45-threads.spec.ts's own fixture email).
  3. uat-48-token-surfaces.spec.ts's ON CONFLICT DO UPDATE for the FIELD fixture component omitted `role` from its SET list, leaving a stale role='entity' value from an earlier state (created_at 2026-07-11) that could never self-correct, producing a duplicate-labeled entity treeitem (confirmed via direct DB query + tRPC join-path read).
  4. uat-43-auth.spec.ts's 43.3 scenario exercises the app's REAL sign-out route, which calls `supabase.auth.signOut()` with the SDK's default `scope: "global"` — this revokes EVERY session for DEFAULT_SEED_EMAIL, not just its own browser context's, collateral-damaging every other concurrently-running spec file sharing that same seed user (confirmed via GoTrue auth logs showing clustered "session_not_found" 403s across multiple concurrent request_ids, and ruled out passive session-limiting via a direct refresh-token isolation test).
  5. uat-41.2's tooltip-dismiss-on-mouse-leave assertion (firefox) was intermittently flaky under heavy concurrent load in the SAME run as (1)-(4) — resolved once (1)-(4) were fixed and no longer needed a separate code change (2 consecutive clean full-suite runs, 32/32 both times).
fix: |
  (1) apps/web/e2e/helpers/seed-session.ts: added mintSession() with bounded retry (5 attempts, jittered backoff) around generateLink+verifyOtp — tolerates the transient magic-link race without masking a genuine auth failure.
  (2) apps/web/e2e/live-loop-green.spec.ts: explicitly click the fixture's own thread row (getByRole button matching FIXTURE_SUBJECT) before clicking "Open editor", mirroring uat-45-threads.spec.ts's already-established pattern for this exact race class.
  (3) apps/web/e2e/uat-48-token-surfaces.spec.ts: added `role = 'field'` to the ON CONFLICT DO UPDATE SET clause for FIXTURE_FIELD_COMPONENT_ID, making the upsert genuinely idempotent (mirrors the sibling entity-row upsert's own `role = 'entity'` SET clause).
  (4) apps/web/e2e/uat-43-auth.spec.ts: gave the 43.3 sign-out scenario its own dedicated seed email (`pedromaschio.shin+e2e-signout@gmail.com`) instead of sharing DEFAULT_SEED_EMAIL — isolates the blast radius of the real (and plausibly intentional) global sign-out without touching production sign-out semantics.
verification: |
  2 consecutive full-suite runs of the exact regression command, 32/32 passed both times (up from 15/32 passed + 7 failed + 10 cascaded-skip on the original run). No code was weakened to fake a pass — every fix addresses a confirmed root cause with direct evidence (DB queries, GoTrue auth logs, a standalone refresh-token isolation script, and cross-referencing wrongly-navigated URLs against sibling fixtures).
files_changed:
  - apps/web/e2e/helpers/seed-session.ts
  - apps/web/e2e/live-loop-green.spec.ts
  - apps/web/e2e/uat-48-token-surfaces.spec.ts
  - apps/web/e2e/uat-43-auth.spec.ts

## Symptoms

expected: |
  All specs green:
  - live-loop-green.spec.ts:149 (chromium, firefox)
  - uat-41-knowledge-preview.spec.ts 41.1 (chromium), 41.2 (firefox)
  - uat-43-auth.spec.ts 43.2 (chromium)
  - uat-48-token-surfaces.spec.ts 48.1 (chromium, firefox)
actual: |
  7 failed, 10 did-not-run (cascade), 15 passed.
  - live-loop-green.spec.ts:149 fails chromium+firefox — LIVE-01 green path
  - uat-41-knowledge-preview.spec.ts fails in openCanvasView() helper: click conversation title -> click "Canvas view" tab -> expect knowledge-preview node visible, 20s timeout. Fails at line 137 click() itself (per error context), cascading into 41.1 (chromium) / 41.2 (firefox), plus 41.3-41.5 don't run.
  - uat-43-auth.spec.ts 43.2 (chromium) fails — seeded session survives reload/new tab
  - uat-48-token-surfaces.spec.ts 48.1 (chromium+firefox) fails — citation chip pill radius + confirm/deny colors
errors: |
  openCanvasView failure at uat-41-knowledge-preview.spec.ts:137:6 (click on conversation title button) cascading to line 139 node visibility expect timeout.
  Full log: C:\Users\pc\AppData\Local\Temp\claude\c--Users-pc-Desktop-nauta-services-email-listener\ec110c79-3d44-49b0-adf4-10062f9a5dbe\tasks\bnz5z1uhg.output
  Per-test error contexts: apps/web/test-results/*/error-context.md
reproduction: |
  cd apps/web
  npx playwright test e2e/live-loop-green.spec.ts e2e/uat-39-tool-round.spec.ts e2e/uat-41-knowledge-preview.spec.ts e2e/uat-43-auth.spec.ts e2e/uat-45-threads.spec.ts e2e/uat-48-token-surfaces.spec.ts --reporter=line
  Local stack up: web 127.0.0.1:3000, listener :8000, local Supabase project_id=polytoken (Docker healthy). Migration 0036 applied locally.
started: |
  These specs were green 2026-07-11 BEFORE Phase 51 (token re-skin), 52 (canvas panel overlays + CanvasPersistenceProvider + new controls), 53 (mobile gating, dual DOM trees), 54 (email-thread node type + registry + thread_id) merged.

## Eliminated
