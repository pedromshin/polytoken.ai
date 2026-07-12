---
phase: 54-email-cluster-workflow-e3
plan: 07
subsystem: docs
tags: [runsheet, migration, live-acceptance, CLUS-07, morning-checklist]

# Dependency graph
requires:
  - phase: 54-01 (migration 0036 + thread-link seam)
    provides: "the unapplied 0036 SQL + journal entry this runsheet's apply commands and DB-verify queries target"
  - phase: 54-02 (web_search ToolExecutor)
    provides: "WEB_SEARCH_TOOL_ENABLED shipped state (True, adversarial suite passed) this runsheet's prerequisite section states"
  - phase: 54-03 (source capture -> INFERRED + promotion reuse)
    provides: "the exact knowledge_nodes/knowledge_node_edges literal contract (source='web_search_capture', scope_ref_type='web_source', target_ref_type='chat_conversation') this runsheet's capture/promote DB-verify queries check"
  - phase: 54-04 (EmailThreadNode + AddEmailThreadPopover)
    provides: "the real UI labels ('Add thread', 'Attach chat') this runsheet's scenario steps reference"
  - phase: 54-05 (thread+cluster context injection)
    provides: "the system-prompt injection this runsheet's step 3/6 verify indirectly via the agent's reply content"
  - phase: 54-06 (ThreadClusterIndicator + chat.clusterSummary)
    provides: "the header popover (aria-label='Linked thread: {subject}') this runsheet's step 2/6 reference"
  - phase: 49-06 (MORNING-CHECKLIST.md §A-§G)
    provides: "the OAuth/forwarding/Docker-recovery sections §H's prerequisites cross-reference rather than duplicate"
provides:
  - "MORNING-CHECKLIST.md §H — the complete, prerequisite-gated CLUS-07 live-acceptance runsheet (6 subsections: prerequisites, migration-0036 apply incl. Dashboard fallback + drizzle-migrations-table insert, Claude's resume-signal verification, the 6-leg scenario walkthrough each with a DB-verify query, the acceptance bar, and a cross-reference note superseding the six individual 'queued to §H' deferrals)"
affects: ["morning execution session (user-run)", "REQUIREMENTS.md CLUS-07 checkbox (flips only on the user's live 'CLUS-07 verified' resume signal, not by this plan)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runsheet-as-artifact: a doc-only plan whose deliverable is an executable checklist, not code — verified by grep-based structural assertions (section presence, absence of any [x] inside §H) rather than test execution"

key-files:
  created: []
  modified:
    - .planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md

key-decisions:
  - "Precomputed the exact sha256 hash (c294272d6d9c32dcda942231912cd72ef1cb6a966e16b850a410e5a342068554) and journal 'when' value (1784227200000) for migration 0036's Dashboard-SQL-Editor fallback path, so the runsheet's INSERT INTO drizzle.\"__drizzle_migrations\" statement is copy-paste-exact rather than 'compute this yourself' — verified by reading drizzle-orm's own migrator.cjs hashing algorithm (sha256 of the raw .sql file bytes) and the actual journal entry on disk, not assumed"
  - "Referenced the REAL shipped UI labels verbatim (grepped from the actual component source, not paraphrased from the plan) — 'Add thread' (aria-label/tooltip on AddEmailThreadPopover's trigger), 'Attach chat' (EmailThreadNode's button text), 'Linked thread: {subject}' (ThreadClusterIndicator's aria-label) — so the runsheet is directly actionable against tonight's actual build, not a generic paraphrase that might not match what's on screen"
  - "Gave BOTH the native db:migrate:staging/prod path AND the Supabase Dashboard SQL Editor fallback (the path that actually applied 0021-0035 tonight per artifacts/migration-verification.md, since .env.staging/.env.production passwords are documented-stale/28P01) rather than assuming the native path will work — the fallback includes the exact 0036 SQL and the drizzle-migrations-table bookkeeping insert so a later native db:migrate run won't try to reapply it"
  - "Did NOT mark CLUS-07 complete in REQUIREMENTS.md — it stays Pending. This plan's own must-have truth is explicit: the runsheet is authored, not executed; the checkbox flips only on the user's live 'CLUS-07 verified' resume signal in the morning session, which is genuinely outside this plan's scope tonight (Docker/WSL down, no OAuth session, no applied migration, no real inbox reachable)"

patterns-established:
  - "Pattern: a live-acceptance runsheet section states its own DB-verify query per scenario leg, inline, rather than deferring all verification to a separate 'what Claude checks' block at the end — makes each leg self-contained and lets the user (or Claude, resuming) check any single leg in isolation without re-reading the whole section"

requirements-completed: []  # CLUS-07 intentionally NOT marked complete -- runsheet authored, scenario user-executed live in the morning

# Metrics
duration: 20min
completed: 2026-07-12
---

# Phase 54 Plan 07: §H CLUS-07 Live-Acceptance Runsheet Summary

**Appended a 6-subsection §H to MORNING-CHECKLIST.md — prerequisites, exact migration-0036 apply commands (native + Dashboard-SQL-Editor fallback with a precomputed sha256 hash for the drizzle-migrations bookkeeping insert), the 6-leg CLUS-07 scenario walkthrough referencing the real shipped UI labels with a DB-verify query per leg, and an explicit acceptance bar — without executing or faking any of it tonight.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-12T14:20:00Z (approx, first Read call)
- **Completed:** 2026-07-12T14:40:00Z
- **Tasks:** 1/1 completed
- **Files modified:** 1 (MORNING-CHECKLIST.md, 207 lines appended)

## Accomplishments

- `## H. Phase-54 Email-Cluster Workflow — live acceptance scenario (CLUS-07)` appended to
  `MORNING-CHECKLIST.md`, matching the file's existing `## A.`–`## G.` heading/sub-step style
  (numbered `### H.N` subsections, a "What Claude verifies on your resume signal" block mirroring
  §A.7/§B.9's idiom).
- **H.1 Prerequisites:** §A OAuth, §B forwarding (a REAL thread, not a fixture), §G stack-up +
  Bedrock, migration 0036 applied, and the shipped `WEB_SEARCH_TOOL_ENABLED=True` state (from
  54-02) with a re-verify-the-suite-then-enable fallback if it's ever found `False`.
- **H.2 Migration 0036 apply:** exact `npm run db:migrate` / `db:migrate:staging` / `db:migrate:prod`
  commands, a verify query, AND a fully-worked Supabase Dashboard SQL Editor fallback (the actual
  path 0021–0035 used tonight per `artifacts/migration-verification.md`, since the hosted DB
  passwords are documented-stale) — including 0036's verbatim SQL and a precomputed, exact
  `INSERT INTO drizzle."__drizzle_migrations"` statement (sha256 hash + journal timestamp,
  independently verified against `drizzle-orm`'s own migrator source and the on-disk journal, not
  guessed).
- **H.3** states Claude's resume-signal verification (`information_schema`/`pg_constraint`/
  `pg_indexes`/journal-row-count checks, read-only, per environment).
- **H.4 Scenario:** all six legs (thread card → attach chat → web research with thread context →
  capture → promote → new chat sees cluster context), each referencing the REAL shipped UI text
  (grepped from source: "Add thread", "Attach chat", `aria-label="Linked thread: {subject}"`) and
  each with its own DB-verify query (or, for the context-injection leg, the correct non-DB
  verification method since that leg is a system-prompt injection, not a database write).
- **H.5 Acceptance** states the explicit pass bar and the exact resume phrase
  ("CLUS-07 verified") that flips the `REQUIREMENTS.md` checkbox.
- **H.6** cross-references and supersedes the six individual "queued to §H" deferral notes already
  present in `54-01-SUMMARY.md` through `54-06-SUMMARY.md`.
- No step in §H is marked passed/checked — confirmed via `awk`+`grep` scan (0 `[x]` occurrences
  within the §H block).

## Task Commits

1. **Task 1: Append the §H CLUS-07 live-acceptance runsheet** — `01c4b23` (docs)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md` — appended
  §H (207 lines): H.1 Prerequisites, H.2 Migration apply (native + Dashboard fallback), H.3
  Claude's resume-signal verification, H.4 the 6-leg scenario walkthrough, H.5 Acceptance, H.6
  cross-reference note. §A–§G unchanged (no renumbering, no edits beyond this appended section).

## Decisions Made

See `key-decisions` in the frontmatter for the four substantive choices (precomputed migration
hash/timestamp for the Dashboard fallback, verbatim real UI labels sourced from actual component
code rather than paraphrase, dual native+fallback migration-apply paths, and CLUS-07 intentionally
left Pending).

## Deviations from Plan

None — plan executed exactly as written. This was a doc-only, single-task plan; no code changes,
no auto-fixes, no architectural questions arose.

## Issues Encountered

None.

## Known Stubs

None — this plan produces documentation only, no UI/data surface.

## User Setup Required

**This entire plan's output IS the user setup runsheet.** The user must execute §H live in the
morning session: apply migration 0036 (local→staging→prod), then run the 6-leg CLUS-07 scenario
on their real inbox, then reply "CLUS-07 verified" (or describe what broke) so Claude can run the
resume-signal DB verification in H.3/H.5 and flip the `REQUIREMENTS.md` checkbox.

## Next Phase Readiness

- Phase 54 (Email-Cluster Workflow E3) now has all 7 plans with a SUMMARY.md — the phase's
  BUILD work is complete. CLUS-01 through CLUS-06 are Complete in `REQUIREMENTS.md`; CLUS-07
  stays Pending until the user runs §H live, per the depth-first mandate's own acceptance-gate
  design (this is by design, not a gap).
- This is the last plan of Phase 54. The v1.9 "Cloud Workspace" milestone's next live checkpoint
  is the combined morning session covering `MORNING-CHECKLIST.md` §A through §H in order.
- No blockers for anything downstream. §H itself is self-contained (all cross-references resolve
  to real, already-existing sections/artifacts: §A, §B, §G, `artifacts/migration-verification.md`,
  `docs/RUN-LOCAL.md` §6).

---
*Phase: 54-email-cluster-workflow-e3*
*Completed: 2026-07-12*

## Self-Check: PASSED

MORNING-CHECKLIST.md confirmed present on disk (§H appended, 207 lines). This SUMMARY.md
confirmed present on disk. Task commit hash `01c4b23` confirmed in `git log --oneline --all`.
