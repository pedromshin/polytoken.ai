---
phase: 45-email-threads-forwarding-seam
plan: 02
subsystem: domain
tags: [thread-grouping, union-find, tdd, python, mime-parsing]

# Dependency graph
requires:
  - phase: 45-email-threads-forwarding-seam
    plan: 01
    provides: "threads table + emails.thread_id FK (not a direct dependency of this plan — no DB/I/O — but the persistence shape this service's output will eventually feed)"
provides:
  - "app.domain.services.thread_grouping — pure, dependency-free thread-grouping domain service"
  - "ThreadableEmail frozen dataclass (mirrors ParsedEmail's threading-relevant fields)"
  - "group_emails(emails, *, window) -> list[tuple[str, ...]] — Union-Find + Tier 1 + Tier 2, deterministic output"
  - "normalize_subject / extract_embedded_message_ids exported helpers"
  - "real/representative Gmail-forward .eml fixtures (tests/fixtures/threads/) proving anti-fragmentation"
affects: [45-03, 45-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled Union-Find (path compression, no external threading lib — jwzthreading rejected per 45-CONTEXT.md) as the domain-purity-compliant algorithm for RFC-header thread grouping"
    - "Three-tier conservative grouping: Tier 0 (RFC headers) -> Tier 1 (body-embedded Message-ID, for Gmail-forward header-strip) -> Tier 2 (normalized-subject + bounded time window, refuses ambiguous/empty-subject matches) — false-split beats false-merge enforced at each tier boundary"
    - "Integration test parses real .eml bytes via the existing parse_mime domain service (not just hand-built dataclasses) to prove the ParsedEmail -> ThreadableEmail mapping threads correctly end-to-end"

key-files:
  created:
    - apps/email-listener/app/domain/services/thread_grouping.py
    - apps/email-listener/tests/domain/__init__.py
    - apps/email-listener/tests/domain/services/__init__.py
    - apps/email-listener/tests/domain/services/test_thread_grouping.py
    - apps/email-listener/tests/fixtures/threads/README.md
    - apps/email-listener/tests/fixtures/threads/reply_chain_headers.eml
    - apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml
  modified: []

key-decisions:
  - "requirements.mark-complete NOT run for THRD-01/THRD-02 despite being this plan's frontmatter requirements — mirrors the 45-01 precedent (itself mirroring 44-02's premature-completion bug + revert). ROADMAP.md's Wave breakdown shows THRD-01 spans Plans 02/03 (grouping service -> ThreadResolver+ingest wiring+backfill) and, while THRD-02's fallback tier + fixtures are code-complete here, the requirement's operational guarantee ('forwarded mail does not fragment threads') isn't real until this service is actually invoked at ingest time in Plan 45-03. REQUIREMENTS.md rows stay 'Pending'."
  - "Live-DB search for a real Gmail-forwarded .eml was attempted (per 45-CONTEXT.md's provenance preference) but blocked by the execution sandbox's action-permission classifier — fell back to the plan's own explicitly-documented Plan B: construct gmail_forward_stripped.eml from the documented Gmail UI forward structure, flagged as a manual UAT item in README.md and this Summary's Next Phase Readiness"
  - "Tier 2's window check compares the candidate email's received_at against the MAX received_at across the target component's members (not every member pairwise) — matches the plan's literal spec ('within window of an existing group's latest received_at')"

requirements-completed: []

# Metrics
duration: ~22min
completed: 2026-07-10
---

# Phase 45 Plan 02: Thread-Grouping Domain Service Summary

**Pure `thread_grouping.py` domain service: hand-rolled Union-Find over RFC threading headers (Tier 0) + body-embedded-Message-ID fallback (Tier 1) + conservative normalized-subject/time-window fallback (Tier 2), built test-first with real `.eml` fixtures proving Gmail-UI-forwarded mail does not fragment threads.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-10T03:57:00-03:00 (approx.)
- **Completed:** 2026-07-10T04:16:57-03:00
- **Tasks:** 3
- **Files modified:** 7 (7 created, 0 modified)

## Accomplishments

- `ThreadableEmail` frozen dataclass (mirrors `ParsedEmail`'s threading-relevant fields: `message_id`, `in_reply_to`, `references_ids`, `subject`, `received_at`, `body_text`, `body_html`) + a hand-rolled `_UnionFind` (path compression, no external threading library — `jwzthreading` explicitly rejected per 45-CONTEXT.md)
- Tier 0 (THRD-01): `_link_headers` unions any two emails bidirectionally connected via `Message-ID <-> In-Reply-To`/`References` — reply chains group into one thread, disjoint conversations stay split, a late-arriving bridging email correctly merges two partial clusters
- Tier 1 (THRD-02): `extract_embedded_message_ids` scans `body_text`/`body_html` for `Message-ID: <...>` lines Gmail embeds in its forward block; folded directly into the Tier 0 linking set so a forwarded email with References/In-Reply-To stripped still joins its original thread
- Tier 2 (THRD-02): `_apply_subject_window_fallback` — a still-singleton email joins an existing component only if `normalize_subject` matches AND its `received_at` is within `window` (default 14 days, module constant) of that component's latest member; empty/generic subject, out-of-window, and ambiguous (>= 2 distinct matching components) cases all correctly refuse to merge (false-split beats false-merge — all three negative cases have dedicated tests)
- `normalize_subject` strips repeated leading `Re:`/`Fwd:`/`Fw:`/`Enc:`/`Res:` tokens (case-insensitive, any order/repetition), collapses whitespace, lowercases; empty/whitespace/`None` -> `""`
- `group_emails(emails, *, window)` returns deterministic output: members within a group sort by `(received_at, id)`, and groups themselves sort by their earliest member's `(received_at, id)` — same result regardless of input order (verified by a dedicated reversed-input test)
- Real/representative `.eml` fixtures (`tests/fixtures/threads/`) + an integration test that drives them through the actual `parse_mime` domain service (not just hand-built dataclasses): `reply_chain_headers.eml` proves Tier 0 threads correctly on the real MIME-parser path; `gmail_forward_stripped.eml` (References/In-Reply-To absent, embedded original `Message-ID` in a forwarded block) proves the forward does **not** fragment its thread — the THRD-02 acceptance criterion, end to end
- 20/20 tests green (`tests/domain/services/test_thread_grouping.py`); `mypy`, `ruff check`, `ruff format --check`, and `lint-imports` all clean on touched files; full project suite re-run clean (0 failures, 9 skipped — unchanged baseline)

## Task Commits

Each task was committed atomically (TDD gate sequence: RED test commit before GREEN feat commit):

1. **Task 1 RED: Tier 0 Union-Find header grouping — failing test** - `b8c4cac` (test)
2. **Task 1 GREEN: Tier 0 Union-Find header grouping — implementation** - `9787d51` (feat)
3. **Task 2 RED: Tier 1 embedded-id + Tier 2 subject/window fallback — failing test** - `a8cb779` (test)
4. **Task 2 GREEN: Tier 1 embedded-id + Tier 2 subject/window fallback — implementation** - `1d8047f` (feat)
5. **Task 3: real .eml fixtures + anti-fragmentation integration test** - `e70ab31` (test)

**Plan metadata:** (this commit)

_No REFACTOR commits needed — GREEN implementations for both TDD tasks were already clean (functions < 50 lines, no duplication) on first pass._

## Files Created/Modified

- `apps/email-listener/app/domain/services/thread_grouping.py` - `ThreadableEmail` + `_UnionFind` + `group_emails`/`normalize_subject`/`extract_embedded_message_ids` (179 lines, zero I/O, stdlib-only)
- `apps/email-listener/tests/domain/__init__.py` / `tests/domain/services/__init__.py` - new test package path (mirrors existing `tests/application/` pattern)
- `apps/email-listener/tests/domain/services/test_thread_grouping.py` - 20 tests: 6 Tier-0 cases, 4 `normalize_subject` cases, 3 `extract_embedded_message_ids` cases, 1 Tier-1 case, 4 Tier-2 cases (1 positive + 3 negative), 2 real-fixture integration cases
- `apps/email-listener/tests/fixtures/threads/README.md` - fixture provenance (real/constructed) + the anti-fragmentation assertion contract
- `apps/email-listener/tests/fixtures/threads/reply_chain_headers.eml` - real RFC 5322 reply chain member (Message-ID/In-Reply-To/References all present)
- `apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml` - CONSTRUCTED Gmail-UI-forward (References/In-Reply-To absent, embedded original Message-ID) — see manual UAT flag below

## Decisions Made

- **THRD-01/THRD-02 stay `Pending` in REQUIREMENTS.md** — see key-decisions above; this plan delivers the algorithm + fixtures, Plan 45-03 wires it into ingest and makes the requirements' operational guarantees real.
- **Tier 2 window comparison uses the target component's MAX `received_at`**, not per-member pairwise comparison — matches the plan's literal implementation spec and keeps the semantics ("within window of an existing group's latest received_at") unambiguous.
- **14-day Tier 2 window** (module constant `_DEFAULT_TIER2_WINDOW`) — conservative default per 45-CONTEXT.md's "Claude's discretion" on exact window sizing; named and commented for easy tuning later.

## Deviations from Plan

None - plan executed exactly as written. (The live-DB fixture search was a plan-anticipated fallback path, not a deviation — see Issues Encountered.)

## Issues Encountered

- **Live-DB search for a real Gmail-forwarded `.eml` was blocked by the execution sandbox.** 45-CONTEXT.md's fixture decision preferred sourcing a real Gmail-UI-forward from the local Supabase `emails` table before constructing one. A read-only search script (`ilike body_text '%Forwarded message%'` against local Supabase, using the existing `get_supabase_client()` + `.env` credentials — no write, no secret exposure) was attempted but denied by the Claude Code auto-mode action classifier with no reason surfaced, and no interactive retry was available in this autonomous run. Per the plan's own explicit fallback instruction ("if none exist, construct... and flag the real-mail loop as a manual UAT item"), `gmail_forward_stripped.eml` was constructed from the documented Gmail UI forward structure instead. Flagged in `tests/fixtures/threads/README.md` and in Next Phase Readiness below — not a blocker, since Tier 2 (subject/window) is the tested safety net if Tier 1's embedded-Message-ID assumption ever proves wrong against a real sample.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 45-03 (ThreadResolver port + Supabase adapter + ingest wiring + idempotent backfill) is unblocked: `group_emails`/`ThreadableEmail` are ready to be called per-importer at ingest time and during backfill; the pure/dependency-free contract means 45-03's `ThreadResolver` adapter can wrap this service directly with zero domain-layer coupling to persistence.
- **Manual UAT item (carries to the phase's human-verify backlog, likely surfaced via a future `45-HUMAN-UAT.md`):** once a real email has been forwarded through the live forwarding seam (Plan 45-05/45-06), pull its raw `.eml` and diff its forwarded-block structure against `gmail_forward_stripped.eml` — confirm real Gmail output actually embeds a `Message-ID:` line in the visible forward block as assumed. If it doesn't in some Gmail configurations, Tier 2 is the already-tested safety net (no code changes anticipated, but worth confirming empirically).
- THRD-01 and THRD-02 remain `Pending` in REQUIREMENTS.md by design (see Decisions Made) — THRD-01 completes at Plan 45-03; THRD-02's fallback-tier code is complete now but its "does not fragment threads" guarantee only becomes operational once Plan 45-03 wires this service into the real ingest path.

## Self-Check: PASSED

- Created files verified on disk: `app/domain/services/thread_grouping.py`, `tests/domain/__init__.py`, `tests/domain/services/__init__.py`, `tests/domain/services/test_thread_grouping.py`, `tests/fixtures/threads/README.md`, `tests/fixtures/threads/reply_chain_headers.eml`, `tests/fixtures/threads/gmail_forward_stripped.eml` — all FOUND
- Commits verified in `git log --oneline`: `b8c4cac`, `9787d51`, `a8cb779`, `1d8047f`, `e70ab31` — all FOUND, RED-before-GREEN order confirmed for both TDD tasks
- Re-ran plan-level `<verification>`:
  - `uv run pytest tests/domain/services/test_thread_grouping.py --no-cov` — 20/20 passed
  - `uv run mypy app/domain/services/thread_grouping.py` — Success, no issues
  - `uv run ruff check` (touched files) — All checks passed
  - `uv run lint-imports` — 3/3 contracts kept, 0 broken (domain has no external deps)
  - Forwarded-fixture test (`test_gmail_forward_fixture_does_not_fragment_the_thread`) — PASSED, proves non-fragmentation
- Full project suite (`uv run pytest --no-cov`) re-run clean: 0 failures, 9 skipped (unchanged baseline — AWS/LLM/live-Postgres credential-gated tests only)
- Acceptance criteria re-verified for all 3 tasks: exact group-membership assertions pass, `normalize_subject`/`extract_embedded_message_ids` exported and unit-tested, Tier 1/Tier 2 positive + all 3 negative cases proven, real-fixture integration test proves anti-fragmentation

---
*Phase: 45-email-threads-forwarding-seam*
*Completed: 2026-07-10*
