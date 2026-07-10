---
phase: 45-email-threads-forwarding-seam
plan: 03
subsystem: email-threading
tags: [thread-resolver, union-find, supabase, dishka, ingest, backfill, python]

# Dependency graph
requires:
  - phase: 45-email-threads-forwarding-seam
    plan: 01
    provides: "threads table (importer-anchored) + emails.thread_id FK (SET NULL), migration 0035 applied locally"
  - phase: 45-email-threads-forwarding-seam
    plan: 02
    provides: "app.domain.services.thread_grouping — pure group_emails()/normalize_subject()/extract_embedded_message_ids() domain service"
provides:
  - "ThreadResolver domain port (app/domain/ports/thread_resolver.py) mirroring ImporterResolver"
  - "SupabaseThreadRepository adapter — Tier 0/1 forward+backward header-linked neighbor search, Tier 2 conservative subject+window fallback, deterministic min-id merge, all importer_id-scoped"
  - "Email.thread_id (nullable, default None) + email_repository round-trip"
  - "IngestInboundEmailUseCase resolves + persists thread_id at ingest time, best-effort/non-fatal (T-45-03-02)"
  - "container.py DI wiring: _provide_thread_resolver bound to ThreadResolver, threaded into the ingest use-case factory"
  - "scripts/backfill_threads.py — idempotent, re-runnable, importer-scoped thread backfill over pre-existing emails, executed live locally"
affects: [45-04, E3-next-epoch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-email incremental resolution (SupabaseThreadRepository.resolve) mirrors the batch Union-Find algorithm (45-02) but issues 3 scoped queries (forward header match, backward in_reply_to, backward references_ids .contains()) instead of one big OR filter — avoids raw-string PostgREST filter injection risk from unescaped Message-ID characters (<, >, @, commas)"
    - "Deterministic merge-to-min-id: when neighbors span multiple existing threads, canonical = min(thread_ids); losing threads' emails are bulk-reassigned, losing thread rows are left as harmless orphans (emails.thread_id is ON DELETE SET NULL, not a hard dependency)"
    - "Best-effort domain port failure isolation: ThreadResolver exceptions degrade to thread_id=None + logged warning inside a dedicated _resolve_thread helper, mirroring the existing propose_regions/suggest_entity_types try/except isolation already in IngestInboundEmailUseCase.execute()"
    - "Backfill reuses the exact same group_emails() batch algorithm as 45-02 (not a re-derivation) — the live ThreadResolver and the backfill script can never silently diverge in grouping logic"

key-files:
  created:
    - apps/email-listener/app/domain/ports/thread_resolver.py
    - apps/email-listener/app/infrastructure/supabase/thread_repository.py
    - apps/email-listener/scripts/backfill_threads.py
    - apps/email-listener/tests/infrastructure/supabase/test_thread_repository.py
    - apps/email-listener/tests/application/test_ingest_thread_resolution.py
    - apps/email-listener/tests/scripts/test_backfill_threads.py
  modified:
    - apps/email-listener/app/domain/entities/email.py
    - apps/email-listener/app/domain/services/thread_grouping.py
    - apps/email-listener/app/infrastructure/supabase/email_repository.py
    - apps/email-listener/app/application/use_cases/ingest_inbound_email.py
    - apps/email-listener/app/container.py
    - apps/email-listener/tests/test_ingest_use_case.py
    - apps/email-listener/tests/corpus/forwarding_harness.py

key-decisions:
  - "thread_grouping._DEFAULT_TIER2_WINDOW renamed to public DEFAULT_TIER2_WINDOW so the Supabase adapter and the backfill script both reuse the SAME Tier-2 fallback window constant as the pure grouping service, instead of duplicating the timedelta(days=14) literal"
  - "New threads.subject is stored as the RAW subject (not normalize_subject()'s lowercased/prefix-stripped form) — normalize_subject exists purely for matching, never for display; a future inbox (45-04) needs the original casing/Re:-Fwd: prefix intact. Reasonable interpretation of the plan's 'subject=normalize_subject(subject) or raw subject' phrasing, exercised under 45-CONTEXT.md's explicit 'Claude's Discretion: thread subject derivation'"
  - "SupabaseThreadRepository.resolve() issues 3 separate scoped queries (forward-by-message_id, backward-in_reply_to, backward-references_ids-contains) rather than one combined .or_() filter string — Message-IDs routinely contain '<', '>', '@' and can contain commas/parens, which would corrupt a raw PostgREST OR filter string; separate .eq()/.in_()/.contains() calls let postgrest-py encode values safely"
  - "requirements.mark-complete run for THRD-01 only (this plan's sole frontmatter requirement) — THRD-02's fallback-tier guarantee is now genuinely operational (wired into live ingest + backfill) but stays Pending in REQUIREMENTS.md since it is not this plan's frontmatter requirement; mirrors the exact precedent set by 45-01/45-02's decisions to avoid the premature-completion bug documented in 44-02-SUMMARY.md"

patterns-established:
  - "Domain port failure isolation for best-effort collaborators: wrap the resolve/lookup call in a private _resolve_x helper with try/except -> log warning -> return None, called from execute() rather than inlining try/except at the call site — keeps execute() readable as new best-effort collaborators are added"

requirements-completed: [THRD-01]

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 45 Plan 03: ThreadResolver + Ingest Wiring + Backfill Summary

**ThreadResolver domain port + SupabaseThreadRepository adapter (Tier 0/1 header-linked neighbor search, Tier 2 subject/window fallback, deterministic min-id merge) wired into live ingest as a best-effort collaborator, plus an idempotent backfill script executed against the local DB (16 emails -> 9 threads, re-run verified 0/0 net changes).**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T04:20:00-03:00 (approx.)
- **Completed:** 2026-07-10T05:05:00-03:00 (approx.)
- **Tasks:** 3
- **Files modified:** 13 (6 created, 7 modified)

## Accomplishments

- `ThreadResolver` Protocol port (mirrors `ImporterResolver`): `resolve(*, importer_id, message_id, in_reply_to, references_ids, subject, received_at, body_text, body_html) -> str`, documenting the same-importer scoping invariant and the false-split-beats-false-merge stance
- `SupabaseThreadRepository`: forward neighbor search (this email's in_reply_to/references/Tier-1-embedded ids match an existing email's message_id) + backward neighbor search (an already-ingested email's in_reply_to or references_ids already points at this email — out-of-order SNS delivery) + Tier 2 conservative normalized-subject/window fallback + deterministic lexicographically-min-id merge when neighbors span multiple threads — every query scoped `.eq("importer_id", ...)` (T-45-03-01)
- `Email.thread_id: str | None = None` + `email_repository._to_row`/`_from_row` round-trip; the default keeps every pre-existing `Email(...)` construction site (14 files) working unchanged
- `IngestInboundEmailUseCase._resolve_thread`: a guarded best-effort helper called after `importer_id`/`message_id` are known and before `Email(...)` is constructed — a `ThreadResolver` exception logs `thread_resolution_failed` and returns `None`, never failing ingestion (T-45-03-02, mirrors the existing `propose_regions`/`suggest_entity_types` isolation)
- `container.py`: `_provide_thread_resolver` binds `SupabaseThreadRepository` to the `ThreadResolver` port and is threaded into `_provide_ingest_use_case`, alongside the existing `importer_resolver` binding
- `scripts/backfill_threads.py`: for each importer, loads all its emails, maps to `ThreadableEmail`, and runs the SAME `group_emails()` (45-02) batch algorithm used conceptually by the live resolver; for each computed group, reuses the canonical (min) existing `thread_id` if any member already has one, else creates one new `threads` row (importer_id + the earliest member's raw subject) and bulk-assigns every member; `--dry-run` previews counts with zero writes
- **Executed live against the local DB** (migration 0035 already applied): 16 emails across 3 importers scanned, 9 threads created, 16 emails reassigned. Re-running immediately after confirmed **idempotency**: 0 threads created, 0 emails reassigned, DB state unchanged (still 9 threads / 16 emails-with-thread_id). Verified a real 3-email Gmail-forward reply chain (`Fwd: Packing List — Multi-Forming Machine BF-80 — vessel TOBA via Kobe`) collapsed into a single `thread_id` in the live table.
- 19 new tests (10 repository + 4 ingest-wiring + 5 backfill), all against mocks/in-memory fakes — no live-DB dependency in the automated suite. Full project suite re-run clean: 0 failures, 9 skipped (unchanged baseline)

## Task Commits

Each task was committed atomically:

1. **Task 1: ThreadResolver port + Supabase adapter + Email.thread_id** - `d5c9d83` (feat)
2. **Task 2: Wire ThreadResolver into the ingest pipeline + DI** - `c5fb29c` (feat)
3. **Task 3: Idempotent re-runnable thread backfill over existing emails** - `e909d13` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/email-listener/app/domain/ports/thread_resolver.py` - `ThreadResolver` Protocol
- `apps/email-listener/app/infrastructure/supabase/thread_repository.py` - `SupabaseThreadRepository` (resolve/merge/create/Tier-2-fallback)
- `apps/email-listener/app/domain/entities/email.py` - Adds `thread_id: str | None = None`
- `apps/email-listener/app/domain/services/thread_grouping.py` - `_DEFAULT_TIER2_WINDOW` -> public `DEFAULT_TIER2_WINDOW` (reused by the adapter + backfill)
- `apps/email-listener/app/infrastructure/supabase/email_repository.py` - `_to_row`/`_from_row` round-trip `thread_id`
- `apps/email-listener/app/application/use_cases/ingest_inbound_email.py` - `_resolve_thread` best-effort helper, `thread_resolver` collaborator, `thread_id` threaded into `Email(...)`
- `apps/email-listener/app/container.py` - `_provide_thread_resolver` binding + `_provide_ingest_use_case` wiring
- `apps/email-listener/scripts/backfill_threads.py` - per-importer idempotent backfill CLI (`--dry-run` supported)
- `apps/email-listener/tests/infrastructure/supabase/test_thread_repository.py` - 10 tests (reuse/create/merge/Tier-1/Tier-2/cross-importer)
- `apps/email-listener/tests/application/test_ingest_thread_resolution.py` - 4 tests (persisted thread_id, exception-safety, stable redelivery)
- `apps/email-listener/tests/scripts/test_backfill_threads.py` - 5 tests (reply-chain collapse, disjoint chains, idempotent re-run, dry-run, cross-importer isolation) against a stateful in-memory fake Client
- `apps/email-listener/tests/test_ingest_use_case.py` - `_make_use_case` fixture gets a default `thread_resolver` mock (constructor signature change)
- `apps/email-listener/tests/corpus/forwarding_harness.py` - `NullThreadResolver` fake added; harness's direct `IngestInboundEmailUseCase(...)` construction updated (Rule 1 fix, see Deviations)

## Decisions Made

See key-decisions in frontmatter. Summary: (1) publicized the Tier-2 window constant instead of duplicating it, (2) new threads store the raw (non-normalized) subject for display fidelity, (3) `resolve()` uses 3 separate scoped queries instead of one raw `.or_()` string to avoid Message-ID-character filter-injection risk, (4) `requirements.mark-complete` run for THRD-01 only, per this plan's own frontmatter and the established 45-01/45-02 precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/corpus/forwarding_harness.py`'s direct `IngestInboundEmailUseCase(...)` construction broke on the new required `thread_resolver` collaborator**
- **Found during:** Task 2, post-change regression sweep (`grep -rln "IngestInboundEmailUseCase("`)
- **Issue:** The corpus-fixture harness constructs `IngestInboundEmailUseCase` directly (bypassing `container.py`) for local/offline corpus-PDF ingestion tests. Adding `thread_resolver: ThreadResolver` as a required (no-default) keyword-only constructor param would raise `TypeError: missing required keyword-only argument 'thread_resolver'` the next time `forward_corpus_file` is invoked (currently only reachable from AWS-Textract/LLM-credential-gated tests that are skipped in this environment, but not skipped when those credentials ARE present, e.g. in CI).
- **Fix:** Added a `NullThreadResolver` fake (mirrors the existing `FixedImporterResolver` fake) that always resolves to `None`, and passed it into the harness's `IngestInboundEmailUseCase(...)` call.
- **Files modified:** `apps/email-listener/tests/corpus/forwarding_harness.py`
- **Verification:** `uv run pytest tests/test_corpus_pipeline.py --no-cov` — 26 passed / 5 skipped (unchanged), `ruff check`/`ruff format --check`/`mypy` clean on the file
- **Committed in:** `c5fb29c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug, a broken-by-signature-change downstream construction site)
**Impact on plan:** Necessary to avoid a latent runtime break in the corpus harness; caught by a full-repo grep for the changed constructor's call sites before considering Task 2 done. No scope creep — the fix is a single fake class + one wiring line.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required. The backfill was executed against the local DB directly in this session (no user action needed); staging/production backfills are a deploy-time follow-up (not required by this plan's scope, which is local-dev-verified per the phase's autonomous contract).

## Next Phase Readiness

- **Plan 45-04** (THRD-03, thread-grouped inbox UI) is unblocked: every email in the local DB now carries a real `thread_id`, and the `threads` table has 9 real rows with derived subjects to group by.
- **Plan 45-06** (THRD-04, forwarding seam web surface) has no dependency on this plan — already unblocked by 45-01's schema, executes independently in the same wave.
- `THRD-01` is now `Complete` in REQUIREMENTS.md (this plan's sole frontmatter requirement). `THRD-02` stays `Pending` by explicit decision (see key-decisions) — its guarantee is operationally proven live in this plan but it is not this plan's frontmatter requirement; a future plan (likely 45-04, when the inbox surfaces thread groups to a human) is the natural place to close it out, or it can be closed directly by `/gsd:verify-work` if the phase verifier judges the operational proof sufficient.
- Live-verified: a real 3-member Gmail-forward reply chain in the local DB now shares one `thread_id` — the phase's own success criterion #1 ("Ingesting a reply chain yields one thread... existing emails backfilled into threads") is demonstrably true against real local data, not just fixtures.
- Staging/production backfills are NOT run by this plan (local-dev-only per the phase's scope) — flagged as a deploy-time follow-up whenever 45-03's ingest changes reach those environments.

## Self-Check: PASSED

- Created files verified on disk: `app/domain/ports/thread_resolver.py`, `app/infrastructure/supabase/thread_repository.py`, `scripts/backfill_threads.py`, `tests/infrastructure/supabase/test_thread_repository.py`, `tests/application/test_ingest_thread_resolution.py`, `tests/scripts/test_backfill_threads.py` — all FOUND
- Commits verified in `git log --oneline`: `d5c9d83`, `c5fb29c`, `e909d13` — all FOUND
- Re-ran plan-level `<verification>`:
  - `uv run pytest tests/infrastructure/supabase/test_thread_repository.py tests/application/test_ingest_thread_resolution.py tests/scripts/test_backfill_threads.py --no-cov` — 19/19 passed
  - `uv run pytest --no-cov` (full suite) — 0 failures, 9 skipped (unchanged baseline)
  - `uv run mypy` / `uv run ruff check` / `uv run ruff format --check` / `uv run lint-imports` — all clean on every touched file (3/3 import-linter contracts kept)
  - Local backfill re-executed live: second run over the post-first-run DB state produced 0 threads created / 0 emails reassigned (idempotent); a real reply chain (`ac756e13.../df6f39d6.../94ba6b69...`) confirmed sharing one `thread_id` in `emails`
- Acceptance criteria re-verified for all 3 tasks: Email/repository round-trip, Protocol + adapter implementation, reuse/create/merge/cross-importer tests, ingest resolves+persists+degrades-safely, container bindings present, backfill idempotent/dry-run/importer-scoped with live counts recorded above

---
*Phase: 45-email-threads-forwarding-seam*
*Completed: 2026-07-10*
