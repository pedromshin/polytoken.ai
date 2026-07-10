---
phase: 45-email-threads-forwarding-seam
verified: 2026-07-10T09:55:00Z
status: human_needed
score: 10/13 must-haves verified (3 require human/live verification, none FAILED)
overrides_applied: 0
human_verification:
  - test: "Confirm the grouped inbox visually (4 sub-checks: thread entries replace flat rows, expand reveals members + reading preview/editor link unaffected, singleton emails list cleanly, styling stays minimal per 45-UI-SPEC.md)"
    expected: "Visiting / (signed in) shows thread entries with count badges; expanding a multi-message thread reveals members via InboxRow; a known 3-email reply chain shows as one entry with count > 1"
    why_human: "Blocked on live Google OAuth sign-in (43-HUMAN-UAT.md Test 1, still pending) — the auth middleware gates / for every signed-out visitor. Already tracked in 45-HUMAN-UAT.md (4 pending sub-items)."
  - test: "Validate the constructed gmail_forward_stripped.eml fixture's embedded-Message-ID assumption against a REAL Gmail-UI-forwarded email"
    expected: "A genuine Gmail forward's visible '---------- Forwarded message ----------' block embeds a 'Message-ID: <...>' line matching this fixture's assumed structure, so Tier 1 (not just the Tier 2 safety net) fires on real mail"
    why_human: "45-02's live-DB search for a real forwarded .eml was blocked by the execution sandbox; the fixture was constructed from documented Gmail structure instead (CONTEXT.md pre-approved this fallback + flagged it as manual UAT in tests/fixtures/threads/README.md and 45-02-SUMMARY.md). This item was never carried into 45-HUMAN-UAT.md — surfaced here so it isn't lost. Requires a real forwarded email, itself gated on the SES catch-all rule (Section 1 of FORWARDING-RUNBOOK.md) being applied."
  - test: "End-to-end forwarding round-trip (FORWARDING-RUNBOOK.md Sections 1, 5): apply the SES catch-all rule, get the address at /settings/forwarding, add it as a Gmail forwarding address, retrieve the verification code from the app's inbox, complete the handshake, then forward a real test email and confirm it lands in the inbox"
    expected: "The u-{token}@ address is live-routable; Gmail's verification email is ingested and readable; a subsequently forwarded email appears in the inbox under the correct account/importer"
    why_human: "Requires a live, deliberate `terraform apply` against SES (user-gated, explicitly NOT run autonomously per 45-USER-SETUP.md) plus a live Gmail account. FORWARDING-RUNBOOK.md Section 5 explicitly flags this as a MANUAL UAT item; not yet tracked in 45-HUMAN-UAT.md."
---

# Phase 45: Email Threads + Forwarding Seam Verification Report

**Phase Goal:** Emails group into threads at ingest — resilient to forwarded mail — and the personal-forwarding seam exists.
**Verified:** 2026-07-10T09:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Ingesting a reply chain yields exactly one thread via `ThreadResolver` (Union-Find over RFC headers) | ✓ VERIFIED | `SupabaseThreadRepository.resolve()` implements Tier 0 forward+backward header search; `IngestInboundEmailUseCase._resolve_thread` calls it post-importer-resolution; live DB has a real 3-email reply chain sharing one `thread_id` (SUMMARY-claimed, matches live query below) |
| 2 | Existing emails are backfilled into threads by an idempotent, re-runnable script | ✓ VERIFIED | Live DB query: `select count(*) from threads` = 9, `select count(*) from emails where thread_id is not null` = 16 of 16 total — matches 45-03-SUMMARY's claimed counts exactly; `tests/scripts/test_backfill_threads.py` proves a second run is a zero-net-change no-op |
| 3 | Thread resolution/backfill is scoped to the email's own importer — never cross-importer/cross-tenant | ✓ VERIFIED | Every query in `thread_repository.py` filters `.eq("importer_id", importer_id)`; `test_thread_repository.py` includes a dedicated cross-importer-isolation test |
| 4 | Conservative fallback tier (Tier 1 body-embedded Message-ID + Tier 2 subject/window) prevents forwarded-mail fragmentation; false-split beats false-merge | ✓ VERIFIED (mechanism) | `thread_grouping.py` implements both tiers; `SupabaseThreadRepository` reuses the identical tiers live; 20/20 unit tests including 3 negative Tier-2 cases (out-of-window, empty subject, ambiguous double-match) all correctly refuse to merge |
| 5 | The fallback tier is proven against a **REAL** Gmail-UI-forward `.eml` fixture (ROADMAP SC #2, REQUIREMENTS.md THRD-02 literal text) | ✗ NOT MET — see Human Verification | `tests/fixtures/threads/gmail_forward_stripped.eml` is explicitly a **CONSTRUCTED** fixture (README.md: "Provenance: CONSTRUCTED, not sourced from a real ingested Gmail forward") — the live-DB search for a genuine sample was blocked by the execution sandbox. REQUIREMENTS.md itself correctly keeps THRD-02 "Pending" (only requirement of 4 not marked Complete) |
| 6 | Inbox lists emails grouped by thread (subject + count + latest snippet/date), tenant-scoped | ✓ VERIFIED (code) / pending (visual) | `emails.listThreads` reuses `userOwnedImporterIds`+`resolveListScope` verbatim; 8/8 tests incl. 2 explicit cross-tenant-isolation tests; `InboxThreadGroup` renders subject+Badge+snippet+date per 45-UI-SPEC.md; visual confirmation blocked on Phase 43's pending live OAuth (tracked in 45-HUMAN-UAT.md) |
| 7 | A thread entry expands to its member emails; the existing email detail/editor view is untouched | ✓ VERIFIED | `InboxThreadGroup` expand toggle reveals members via unmodified `InboxRow`; `git log -- apps/web/src/app/emails` shows no commits since Phase 42's rename (confirmed directly) |
| 8 | A signed-in user can get-or-create their unique secret-token forwarding address, idempotently, with a copy affordance | ✓ VERIFIED | `forwardingRouter.getOrCreateMyAddress` — CSPRNG `randomBytes(32)`, `onConflictDoNothing({target:userId})` + re-select idempotency; 7/7 tests incl. idempotent-second-call and concurrent-insert-conflict; `forwarding-address-card.tsx` renders address + copy button |
| 9 | A recipient `u-{token}@<domain>` resolves to the owning user_id at ingest; unknown/malformed tokens fail-closed | ✓ VERIFIED | `token_from_recipient` + `SupabaseForwardingAddressRepository.resolve_recipients`; 15 repository tests incl. unknown-token→None, non-prefix-ignored, malformed, first-match-wins |
| 10 | A newly-created importer for forwarded mail anchors to the resolved user_id; the None-token path no longer risks a NOT-NULL violation | ✓ VERIFIED | `ImporterResolver.resolve(..., user_id=...)` additive param; `test_importer_repository.py` proves both the anchored-create and the None-fallback-no-row paths |
| 11 | Gmail's forwarding-verification email is ingested and NOT dropped | ✓ VERIFIED | `test_ingest_forwarding_resolution.py` asserts `email_repo.save` is called for the `forwarding-noreply@google.com` → `u-{token}@` case |
| 12 | A user onboarding runbook exists covering SES routing + Gmail's destination-verification handshake | ✓ VERIFIED | `FORWARDING-RUNBOOK.md` — 5 sections + troubleshooting, covers catch-all terraform draft, address retrieval, Gmail setup, code retrieval, e2e verification |
| 13 | New tables (`threads`, `forwarding_addresses`) carry RLS defense-in-depth (deny-anon + owner-authenticated) | ✓ VERIFIED | Live `pg_policies` query confirms all 4 policies present and correctly scoped (importer-join for threads, direct user_id for forwarding_addresses) |

**Score:** 10/13 truths fully VERIFIED; 3 require human/live action (none code-blocking — no FAILED truths, no missing/stub artifacts).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/threads.ts` | `Threads` table, importer-anchored | ✓ VERIFIED | Exists, matches spec exactly (importerId FK cascade + index, subject nullable, timestamps) |
| `packages/db/src/schema/forwarding-addresses.ts` | `ForwardingAddresses` table, direct user_id | ✓ VERIFIED | Exists; UNIQUE(token), UNIQUE(userId), FK cascade to AuthUsers |
| `packages/db/migrations/0035_threads_forwarding.sql` | CREATE TABLE + RLS | ✓ VERIFIED | Live-applied; `npm run check` reports "Everything's fine"; journal `when=1784140800000` correct |
| `packages/db/src/ownership.ts` | `assertThreadOwnership`/`assertForwardingAddressOwnership` | ✓ VERIFIED (orphaned — informational) | Both exist, tested (21/21 ownership tests pass); NOT yet called from any router (no current byId-style endpoint needs them — threads/forwarding_addresses are only reached via tenant-scoped projections). Not a gap: matches the plan's own "chokepoint for future use" framing, same as several Phase-44 helpers |
| `apps/email-listener/app/domain/services/thread_grouping.py` | Union-Find + Tier1/2 | ✓ VERIFIED | 182 lines, pure stdlib; 20/20 tests pass; mypy/ruff clean |
| `apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml` | Real/representative Gmail-forward fixture | ⚠️ CONSTRUCTED, not real | Self-documented in README.md; see Truth #5 |
| `apps/email-listener/app/domain/ports/thread_resolver.py` + `thread_repository.py` | `ThreadResolver` port + Supabase adapter | ✓ VERIFIED | Both exist; resolve/merge/create logic matches spec; 10/10 repository tests pass |
| `apps/email-listener/scripts/backfill_threads.py` | Idempotent backfill | ✓ VERIFIED | Live-executed (9 threads / 16 emails, confirmed via direct DB query); `--dry-run` supported; 5/5 tests pass |
| `packages/api-client/src/router/emails/index.ts` (+ `list-threads.ts`) | `emails.listThreads` | ✓ VERIFIED | Reuses scoping verbatim; 8/8 tests incl. tenancy isolation |
| `.planning/phases/45-email-threads-forwarding-seam/45-UI-SPEC.md` | Design contract | ✓ VERIFIED | Exists; thread-entry anatomy, expand interaction, minimal-styling rationale all present and match the actual implementation |
| `apps/web/src/app/_components/inbox-thread-group.tsx` | Expandable thread row | ✓ VERIFIED | Matches UI-SPEC exactly (Badge count, chevron, indented members via unmodified InboxRow) |
| `apps/email-listener/app/domain/ports/forwarding_address_resolver.py` + `forwarding_address_repository.py` | Token resolver | ✓ VERIFIED | Both exist; fail-closed, case-sensitive token extraction; 15/15 tests pass |
| `packages/api-client/src/router/forwarding/index.ts` | `forwarding.getOrCreateMyAddress` | ✓ VERIFIED | CSPRNG, idempotent, session-gated, no `.input()`; 7/7 tests pass |
| `apps/web/src/app/_components/forwarding-address-card.tsx` | Address + copy surface | ✓ VERIFIED | Renders address, copy button, loading/error states, runbook link |
| `.planning/phases/45-email-threads-forwarding-seam/FORWARDING-RUNBOOK.md` | Onboarding runbook | ✓ VERIFIED | 5 sections + troubleshooting, comprehensive |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `emails.ts` | `threads.id` | `thread_id` FK column | ✓ WIRED | `information_schema.columns`: `emails.thread_id` nullable uuid, live |
| `0035_threads_forwarding.sql` | `importers.user_id` | RLS owner-authenticated policy | ✓ WIRED | `pg_policies` confirms `threads_owner_authenticated` with the exact join predicate |
| `group_emails` | `normalize_subject`/`extract_embedded_message_ids` | Tier 1+2 inside grouping loop | ✓ WIRED | `_link_headers` and `_apply_subject_window_fallback` both call these helpers directly |
| `ingest_inbound_email.py` | `ThreadResolver.resolve` | `_resolve_thread` guarded helper | ✓ WIRED | Confirmed via grep; exception isolation tested (`test_ingest_thread_resolution.py`) |
| `thread_repository.py` | `thread_grouping` helpers | `normalize_subject`/`extract_embedded_message_ids` reused | ✓ WIRED | Imported directly, not re-implemented (`DEFAULT_TIER2_WINDOW` shared constant) |
| `apps/web/src/app/page.tsx` | thread-grouped query | `api.emails.listThreads.useQuery` | ✓ WIRED | Confirmed via grep in page.tsx |
| `packages/api-client/.../emails/index.ts` | `userOwnedImporterIds` | protectedProcedure scope | ✓ WIRED | `list-threads.ts` calls `userOwnedImporterIds` + `resolveListScope` identically to `list` |
| `sns_inbound.py` | `ingest.execute recipients` | recipients threaded through | ✓ WIRED | `meta["recipients"]` passed into `use_case.execute()`, confirmed via grep |
| `ingest_inbound_email.py` | `ImporterResolver.resolve(user_id=...)` | anchor importer to forwarding user | ✓ WIRED | `_resolve_forwarding_user` runs before `importer_resolver.resolve(sender_address, user_id=forwarding_user_id)` |
| `packages/api-client/src/root.ts` | `forwardingRouter` | appRouter registration | ✓ WIRED | `forwarding: forwardingRouter` present |
| `forwarding-address-card.tsx` | `forwarding.getOrCreateMyAddress` | `api.forwarding.getOrCreateMyAddress.useQuery()` | ✓ WIRED | Confirmed in component source |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `emails.listThreads` | `rows` (scoped email select) | Drizzle query against live `emails` table, `inArray(importerId, scope.importerIds)` | Yes — DB query, not static | ✓ FLOWING |
| `threads` table | `thread_id` on `emails` | `SupabaseThreadRepository.resolve()` writes live at ingest; `backfill_threads.py` executed live | Yes — verified via direct psql query (9 threads / 16 emails) | ✓ FLOWING |
| `forwarding.getOrCreateMyAddress` | `token`/`address` | Drizzle insert/select against live `forwarding_addresses` table | Yes — CSPRNG-generated, DB-persisted | ✓ FLOWING |
| `InboxThreadGroup` members | `members: InboxEmail[]` | `inbox-three-pane.tsx` supplemental `emails.list` fetch (`EMAIL_LOOKUP_LIMIT=100`) | Yes — bounded but real query, documented v1 limitation for >100-email mailboxes | ✓ FLOWING (bounded, documented) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `packages/db` typecheck | `cd packages/db && npx tsc --noEmit` | clean | ✓ PASS |
| `packages/db` ownership tests | `npm run test -- ownership` | 21/21 passed | ✓ PASS |
| Live migration state | `psql \d threads / \d forwarding_addresses / pg_policies` | tables + 4 RLS policies confirmed live | ✓ PASS |
| Live backfill counts | `psql select count(*) from threads/emails` | 9 threads, 16/16 emails with thread_id — matches SUMMARY claim exactly | ✓ PASS |
| `packages/db` drift check | `npm run check` | "Everything's fine 🐶🔥" | ✓ PASS |
| Python thread-grouping unit tests | `uv run pytest tests/domain/services/test_thread_grouping.py --no-cov` | 20/20 passed | ✓ PASS |
| Python thread+forwarding integration tests | `uv run pytest tests/infrastructure/.../test_thread_repository.py tests/application/test_ingest_thread_resolution.py tests/scripts/test_backfill_threads.py tests/infrastructure/.../test_forwarding_address_repository.py tests/application/test_ingest_forwarding_resolution.py --no-cov` | 40/40 passed | ✓ PASS |
| Full FastAPI suite (run once) | `uv run pytest --no-cov -q` | 1319 passed, 9 skipped (credential-gated only) — matches 45-05-SUMMARY's claimed baseline exactly | ✓ PASS |
| mypy on touched Python modules | `uv run mypy app/domain/services/thread_grouping.py app/domain/ports/thread_resolver.py app/infrastructure/supabase/thread_repository.py app/domain/ports/forwarding_address_resolver.py app/infrastructure/supabase/forwarding_address_repository.py app/application/use_cases/ingest_inbound_email.py` | "Success: no issues found in 6 source files" | ✓ PASS |
| `packages/api-client` typecheck + full suite | `npx tsc --noEmit && npx vitest run` | clean; 342/342 passed | ✓ PASS |
| `apps/web` typecheck | `npx tsc --noEmit` | clean outside pre-existing `src/app/dev/design` baseline (unrelated, per context notes) | ✓ PASS |
| `apps/web` full test suite | `npm run test` | 294/294 passed | ✓ PASS |
| Detail/editor view untouched | `git log -- apps/web/src/app/emails/[id]` | last commit = Phase 42's rename (82d3c8b) — zero Phase 45 commits touch this path | ✓ PASS |
| All commits referenced in SUMMARYs exist | `git cat-file -e <hash>` × 19 | all 19 FOUND | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` conventions or PLAN/SUMMARY-declared probes found for this phase (schema migration + domain-service + tRPC/UI phase, not a migration-tooling probe pattern).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| THRD-01 | 45-01, 45-02, 45-03 | Emails grouped into threads via RFC headers at ingest, existing emails backfilled | ✓ SATISFIED | Live DB (9 threads/16 emails), 60+ passing tests across schema/domain/ingest/backfill, REQUIREMENTS.md correctly marks Complete |
| THRD-02 | 45-02 | Forwarded mail does not fragment threads — conservative fallback tier ships with **real** Gmail-forward `.eml` fixtures | ? NEEDS HUMAN | Fallback-tier mechanism is code-complete, live-wired, and exhaustively tested (including negative cases) — but the fixture is self-documented as CONSTRUCTED, not real, per `tests/fixtures/threads/README.md`. REQUIREMENTS.md correctly keeps this "Pending" — this verifier concurs with that self-assessment rather than overriding it. See Human Verification item #2. |
| THRD-03 | 45-04 | User can see emails grouped by thread in the inbox list | ✓ SATISFIED (code) / ? NEEDS HUMAN (visual) | Query + UI fully implemented and tested; visual confirmation blocked on Phase 43's still-pending live Google OAuth (tracked in 45-HUMAN-UAT.md, consistent with the Phase-43-precedent of shipping Complete with deferred live-auth UAT) |
| THRD-04 | 45-01, 45-05, 45-06 | Unique secret-token forwarding-address seam exists, with onboarding runbook covering Gmail's verification handshake | ✓ SATISFIED | Both halves (generation + resolution) code-complete and tested; runbook comprehensive; "seam exists" (not "seam is live") is the phase goal's literal wording, and the live SES routing is correctly scoped as a separate user-gated follow-up (45-USER-SETUP.md) |

No orphaned requirements — REQUIREMENTS.md's Phase 45 traceability table (THRD-01..04) exactly matches the requirement IDs declared across all 6 plans' frontmatter.

### Anti-Patterns Found

None. Scanned all 21 files created/modified across the phase's 6 plans for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches.

### Human Verification Required

#### 1. Grouped-inbox visual confirmation (4 sub-items)

**Test:** Sign in via Google OAuth, visit `/`, confirm thread entries (not flat rows), expand a multi-message thread, confirm the reading preview + "Open editor →" link still work, confirm singleton emails render cleanly, confirm styling stays minimal per `45-UI-SPEC.md`.
**Expected:** All 4 sub-checks in `45-HUMAN-UAT.md` pass.
**Why human:** Blocked on live Google OAuth sign-in (Phase 43's `43-HUMAN-UAT.md` Test 1, still pending) — the auth middleware gates `/` for every signed-out visitor. Already tracked in `45-HUMAN-UAT.md`.

#### 2. Real Gmail-forward fixture validation

**Test:** Once a real email has been forwarded through the live seam, pull its raw `.eml` and diff its forwarded-block structure against `tests/fixtures/threads/gmail_forward_stripped.eml` — confirm a genuine Gmail forward actually embeds a `Message-ID:` line in the visible forward block as the constructed fixture assumes.
**Expected:** The real sample's structure matches the constructed fixture's assumption (Tier 1 fires as designed); if not, Tier 2 (already tested) is the documented safety net.
**Why human:** The autonomous run's live-DB search for a real forwarded email was blocked by the sandbox; CONTEXT.md pre-approved constructing the fixture with this validation flagged as manual UAT. **This item was documented in `45-02-SUMMARY.md` and `tests/fixtures/threads/README.md` but never carried into `45-HUMAN-UAT.md`** — surfaced here so it is not lost. Itself gated on a real forwarded email existing, which requires Human Verification Item #3 below to happen first.

#### 3. End-to-end forwarding round-trip

**Test:** Apply the SES catch-all rule (`FORWARDING-RUNBOOK.md` Section 1, currently NOT applied), get the address at `/settings/forwarding`, add it as a Gmail forwarding address, retrieve the numeric verification code from the app's own inbox, complete the handshake, then forward a real test email and confirm it lands in the inbox correctly attributed.
**Expected:** The full round-trip in `FORWARDING-RUNBOOK.md` Sections 1-5 completes; `45-USER-SETUP.md`'s checklist item is marked Complete.
**Why human:** Requires a live, deliberate `terraform apply` against AWS SES (explicitly user-gated, never run autonomously) and a live Gmail account. `FORWARDING-RUNBOOK.md` itself explicitly flags this as a MANUAL UAT item and says to "track it as a human_needed verification item" — but it was never added to `45-HUMAN-UAT.md`. Surfaced here.

### Gaps Summary

No BLOCKER-level gaps. The phase's engineering work is thoroughly implemented, live-verified against the local DB, and covered by 100+ passing automated tests across Python and TypeScript, with zero regressions against documented baselines (Python 1319/9, api-client 342/342, apps/web 294/294). The one WARNING-level item is that REQUIREMENTS.md's THRD-02 literal text ("real Gmail-forward .eml fixtures") is not yet met by a genuinely real fixture — the fallback-tier *mechanism* it describes is fully built and tested, but the fixture itself is constructed, and that was a pre-approved, well-documented contingency (not a shortcut). Additionally, three manual-UAT items documented across `45-02-SUMMARY.md`/`tests/fixtures/threads/README.md`/`FORWARDING-RUNBOOK.md`/`45-USER-SETUP.md` were never consolidated into `45-HUMAN-UAT.md` — this report surfaces all three so they are not lost. None of this blocks the phase from proceeding; it requires human/live-environment action outside what autonomous execution can perform (live Google OAuth, live SES `terraform apply`, and a genuine forwarded email).

---

*Verified: 2026-07-10T09:55:00Z*
*Verifier: Claude (gsd-verifier)*
