# Phase 50: Live-Loop Gate — UAT Burn-down & Screenshot Coverage - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning
**Mode:** Overnight autonomous run — grey-area answers are the recommended defaults,
auto-accepted per the user's explicit "do all phases autonomously, I'll go to bed"
directive (same defaults discipline the user accepted for Phase 49's four areas).

<domain>
## Phase Boundary

Every open scenario in 39/41/43/45/47/48-HUMAN-UAT.md is executed and closed or converted
to a tracked fix (LIVE-05), and the screenshot-review harness covers /emails/[id] and
captures authenticated surfaces via a seeded session (LIVE-06, closes todo W-1).

Out of scope: any re-skin work (Phase 51); building new features. Fixes discovered during
burn-down are executed if small, or tracked as explicit fix items if large.

OPERATIONAL REALITY (constrains everything): Phase 49's checkpoint is still pending —
there is NO live OAuth session on the deployed app yet. The 49-03 seeded-session helper
(apps/web/e2e/helpers/seed-session.ts) DOES exist and works on the LOCAL stack. Scenarios
runnable against the local seeded-session stack execute NOW; scenarios that genuinely need
the deployed app + real Google session are converted to tracked items appended to the
Phase 49 morning flow (49-HUMAN-UAT.md / MORNING-CHECKLIST.md), NOT silently parked.

</domain>

<decisions>
## Implementation Decisions

### Scenario Execution Method (LIVE-05)
- Burn down every open scenario in the six UAT files (39, 41, 43, 45, 47, 48) by driving
  the LOCAL stack (RUN-LOCAL procedure + preflight script + seeded session) with
  playwright-core, asserting against the DB per the project's verification discipline
- Each scenario's result is recorded in its UAT file (result: passed / issue: {desc}),
  frontmatter status updated, and failures become tracked fix items — small fixes
  (< ~30 min) are fixed in-phase; larger ones become explicit todos with repro steps
- Scenarios that REQUIRE the deployed app or a real Google session (true auth-gated
  remainder) are re-tagged to the Phase 49 morning checklist rather than faked locally —
  the burn-down report must show zero silently-parked scenarios

### Screenshot Harness Coverage (LIVE-06 / W-1)
- Extend the 47-05 screenshot harness SURFACES list to include /emails/[id] (with a
  seeded email fixture so the route renders real content)
- Wire the harness to use the 49-03 seeded-session helper so authenticated surfaces
  capture real pixels instead of textual before/after fallbacks
- Store captures under .planning/ui-reviews/<timestamp>/ per the existing convention

### Claude's Discretion
- Exact fixture seeding for /emails/[id]; scenario ordering; how per-scenario evidence is
  captured (screenshot vs DB row snippet) as long as it is DB-verified where applicable

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- apps/web/e2e/helpers/seed-session.ts + apps/web/e2e/live-loop-green.spec.ts (49-03) —
  seeded-session pattern with DB assertions, proven green on chromium+firefox tonight
- scripts/preflight-local.ps1 + docs/RUN-LOCAL.md (49-01) — deterministic local bring-up
- Screenshot harness from 47-05 (SURFACES list) — extend, don't rebuild
- .planning/ui-reviews/ convention with existing .gitignore

### Established Patterns
- Verify via DB, never terminal/logs; no --reload; kill zombies first
- UAT file format: ### N. scenario / expected / result + Summary counts + Gaps section

### Integration Points
- Six UAT files under .planning/milestones/v1.{6,7,8}-phases/*/NN-HUMAN-UAT.md
- 49-HUMAN-UAT.md + MORNING-CHECKLIST.md — where true auth-gated remainders get appended

</code_context>

<specifics>
## Specific Ideas

- The burn-down must produce a single roll-up artifact (50-UAT-BURNDOWN.md) listing every
  scenario, its disposition (passed / fixed / tracked-fix / moved-to-morning-checklist),
  and evidence pointer — "none remain silently parked" is the acceptance bar

</specifics>

<deferred>
## Deferred Ideas

- Re-running the deployed-app scenarios after the user completes the morning checklist —
  that is the Phase 49 checkpoint's completion, not new Phase 50 scope

</deferred>
