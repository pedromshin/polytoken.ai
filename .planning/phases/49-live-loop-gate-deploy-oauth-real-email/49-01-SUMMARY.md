---
phase: 49-live-loop-gate-deploy-oauth-real-email
plan: 01
subsystem: infra
tags: [supabase, powershell, local-dev, drizzle, gotrue, postgrest]

# Dependency graph
requires: []
provides:
  - "docs/RUN-LOCAL.md — canonical cold-start procedure for the full local stack"
  - "scripts/preflight-local.ps1 — scripted zombie-kill + fresh-DB green preflight"
  - "Local Supabase project-id rename (nauta -> polytoken, LIVE-07) actualized in documentation"
affects: [49-03, 49-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-verified green assertion (has_table_privilege + table count) over trusting terminal/exit-code output"
    - "Idempotent grant-and-NOTIFY-pgrst remediation for Drizzle-owned tables piped via `docker exec -i`"

key-files:
  created:
    - docs/RUN-LOCAL.md
    - scripts/preflight-local.ps1
  modified: []

key-decisions:
  - "Encoded the seed-before-migrate ordering (0032 backfill precondition) as a scripted, idempotent step rather than a manual runbook line"
  - "Preflight kill step warns (non-fatal) on missing zombies/ports; sb:start/db:migrate/grant/assertion steps are fatal on failure"
  - "Added a non-blocking warning for missing SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/_SECRET in the process env (known config.toml env() gotcha) even though it wasn't in the plan's explicit step list — it directly supports LIVE-01's 'reproducibly green' bar for the Google sign-in path this same phase depends on"

requirements-completed: [LIVE-01, LIVE-07]

# Metrics
duration: 17min
completed: 2026-07-10
---

# Phase 49 Plan 01: Local Cold-Start Procedure + Preflight Script Summary

**Scripted, idempotent local-stack green path (docs/RUN-LOCAL.md + scripts/preflight-local.ps1) encoding the zombie-kill, env-file-split, seed-before-migrate, and grant/NOTIFY-pgrst gotchas this project has already paid for.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-07-10T21:53:00-03:00 (approx, first read after plan commit)
- **Completed:** 2026-07-10T22:01:00-03:00
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments
- `docs/RUN-LOCAL.md` (161 lines) is now the single documented, reproducible start procedure LIVE-01 requires: prerequisites, the env-file split (the #1 footgun, including the process-env-only Google OAuth `env()` resolution gotcha), one-command cold start, the WITHOUT-`--reload` zombie rule with "trust the DB not the terminal" guidance, the local `nauta` -> `polytoken` project-id rename note (LIVE-07), fresh-DB seed-before-migrate + grant/NOTIFY recovery, and DB-based verification.
- `scripts/preflight-local.ps1` (232 lines) automates the entire cold-start-to-green path in the exact required order: kill stale python/uvicorn/node processes (warn-only) -> ensure Supabase up under `project_id=polytoken` (stopping a stale `nauta` stack first if detected) -> seed exactly one `auth.users` row via the GoTrue admin API before migrating -> `npm run db:migrate` -> idempotent Supabase-role GRANTs + `NOTIFY pgrst` piped via `docker exec -i` -> DB-based PASS/FAIL assertion (`has_table_privilege` + table count), exiting nonzero on failure. No secret is ever echoed to stdout (the service_role key is parsed from `sb:status` output into a variable and referenced by name only); all script-emitted text is ASCII.
- Both files pass their plan-specified grep gates and contain no literal secrets (`GOCSPX-` / hardcoded `service_role...=...ey` patterns absent, verified with `grep -Ei`).
- PowerShell syntax validated with the `System.Management.Automation.Language.Parser` AST parser (no live Docker/Supabase execution attempted in this sandbox — see Issues Encountered).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write docs/RUN-LOCAL.md — the canonical cold-start procedure** - `10c846d` (docs)
2. **Task 2: Write scripts/preflight-local.ps1 — scripted zombie kill + fresh-DB green** - `5eadc02` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `docs/RUN-LOCAL.md` - Canonical 7-section local-run doc (prerequisites, env-file split, one-command start, zombie rule, project-id rename note, fresh-DB recovery, DB-based verification)
- `scripts/preflight-local.ps1` - PowerShell preflight script: kill -> sb:start(polytoken) -> seed -> migrate -> grant+NOTIFY -> DB-based PASS/FAIL gate

## Decisions Made
- Kill step (process/port checks) is intentionally non-fatal (warns only) per the plan's explicit instruction ("warn, do not hard-fail, if none found"); all subsequent steps (sb:start read, seed, migrate, grant, final assertion) are fatal on failure since a partial/broken DB state must not be reported as green.
- Parsed `service_role key` / `anon key` / `API URL` out of `npm run sb:status`'s human-readable text output via line-anchored regex rather than adding a JSON/`-o env` output mode dependency, matching the plan's interface note ("Capture `npm run sb:status` output to read the service_role key and API URL") without introducing a new CLI flag assumption.
- Added a non-blocking warning (not a plan-mandated step, but directly supports LIVE-01's "reproducibly green" bar and the phase's own OAuth checkpoint later in the phase) when `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` are absent from the process environment before `sb:start` — this is the exact gotcha `docs/RUN-LOCAL.md` section 2 documents (config.toml's `env()` refs resolve from process env, not `.env.local`). Kept non-fatal since it doesn't block the DB-green gate this plan's must-haves are scoped to.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's Task-1 automated verify command has a shell/grep quoting bug unrelated to doc content**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<automated>` verify block for Task 1 iterates a bash array including the literal string `'--reload'` and runs `grep -qi "$s" docs/RUN-LOCAL.md`. Because `--reload` begins with `--`, GNU grep interprets it as an (unrecognized) command-line option rather than a search pattern, so the command errors out (`grep: unknown option -- reload`) regardless of whether the text is present in the file.
- **Fix:** Verified the underlying intent manually with a dash-safe invocation (`grep -qi -- "--reload" docs/RUN-LOCAL.md`), confirmed the doc does contain `--reload` (used in the zombie-process rule section), and proceeded. No plan or script file needed changing — the bug is in the plan's verify-block invocation itself, not in the deliverable.
- **Files modified:** None (verification-only workaround; documented here for visibility to the phase verifier/auditor who may re-run the plan's literal verify block and see the same false failure).
- **Verification:** `grep -qi -- "--reload" docs/RUN-LOCAL.md` exits 0.
- **Committed in:** N/A (no code change required)

---

**Total deviations:** 1 auto-fixed (1 blocking — plan-authoring bug in an automated verify command, not a deliverable defect)
**Impact on plan:** None on scope or correctness of the two deliverables; both files satisfy every acceptance criterion and the semantic intent of every grep gate. Flagging this so a downstream verifier re-running the plan's literal `<automated>` block for Task 1 doesn't misread the grep tooling bug as a missing `--reload` mention.

## Issues Encountered
- This execution environment does not have Docker Desktop / a running local Supabase stack, so `scripts/preflight-local.ps1` could not be end-to-end exercised live in this session (no `supabase_db_polytoken` container to `docker exec` against, no `npm run sb:start` target). Static verification performed instead: PowerShell AST syntax parse (clean, no errors), all plan-specified grep gates, secret-leak grep, and manual step-order tracing (admin/users precedes db:migrate; grant+NOTIFY follow db:migrate; docker exec -i used exclusively, never plain docker exec). Live end-to-end exercise of this script against a real Docker/Supabase stack is exactly what plan 49-03 ("Plan 49-03 consumes it to run the DB-verified end-to-end green path") is scoped to do — no action needed here, noting for traceability.

## User Setup Required

None - no external service configuration required. This plan is documentation + local tooling only; it reads no secrets from disk and requires no new environment variables.

## Next Phase Readiness
- `docs/RUN-LOCAL.md` and `scripts/preflight-local.ps1` are ready for plan 49-03 to exercise live and produce the DB-verified end-to-end green path (login -> inbox -> thread -> email detail -> chat with tool rounds -> genui panel -> `/knowledge`).
- The local project-id rename outcome (LIVE-07, "RENAME now — local-only; accept fresh containers + re-run migrations; local data is disposable") is fully captured in `docs/RUN-LOCAL.md` section 5 for plan 49-05 to record in STATE.md.
- No blockers. The one open item is the live end-to-end exercise of the preflight script against a real Docker/Supabase instance, explicitly deferred to plan 49-03 by the plan's own objective.

---
*Phase: 49-live-loop-gate-deploy-oauth-real-email*
*Completed: 2026-07-10*
