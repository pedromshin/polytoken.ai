---
created: 2026-07-12
title: Step email-listener coverage floor back up 65 -> 80 as coverage recovers
area: apps/email-listener (pytest coverage gate)
files:
  - apps/email-listener/pyproject.toml
resolves_phase: null
---

## Context

User decision 2026-07-12 (MORNING-CHECKLIST §E.2, option a): `--cov-fail-under` was ratcheted
80 -> 65 in `apps/email-listener/pyproject.toml` to unblock ECS image deploys. At decision time
repo-wide coverage was **68.10%** (all 1312 tests pass; ruff + mypy green in CI). The 80% floor
is the user's stated quality bar — 65 is a temporary ratchet, not the new standard.

## Rules

- **Never lower the floor further.** 65 is the one-time unblock value.
- New code must still be well-covered (Phase-54 convention: the repo-wide number must move UP).
- Step the floor up opportunistically: whenever repo-wide coverage clears a rung with ~2%
  headroom, raise `--cov-fail-under` to that rung in the same PR.

## Step-up ladder

| Rung | Raise floor to | When repo-wide coverage ≥ |
|------|----------------|---------------------------|
| 1    | 70             | 72%                       |
| 2    | 75             | 77%                       |
| 3    | 80 (done)      | 82%                       |

## Where the uncovered mass is

Per the 49-04 deploy-gate run: mostly `app/infrastructure/` adapters (Supabase repositories,
Bedrock adapters) and `app/presentation/` wiring — integration-shaped code that was excluded
from the unit-test push. Targeted adapter tests with mocked clients are the cheapest wins.

## Resolution — 2026-07-20 (floor restored to 80)

Root cause was **not** thin tests. `pyproject.toml` set `testpaths = ["tests"]`, so plain
`uv run pytest` (what CI + the deploy gate run) never collected the 262 passing Phase-54
co-located `app/**/__tests__/` tests — yet `--cov=app` still counted their ~1,500 statements
as uncovered production code. That single misconfig depressed the repo-wide number from its
real value to ~67%. This is the deferred part-2 decision from
`todos/done/2026-07-13-stale-presentation-tests-not-collected-by-ci.md` ("Decide whether
`app/**/__tests__/` should be collected by default"); part 1 (the 9 stale 401 chat_widget
tests) was already fixed and now passes.

Fix (`apps/email-listener/pyproject.toml`):
- `testpaths = ["tests", "app"]` — collect both suites (adds 262 passing tests).
- `--cov-fail-under` 65 → **80** — ladder rung 3 (≥82%). Measured repo-wide coverage with
  the co-located suites collected: **91.02%** (1,729 passed, 6 skipped).

5 pre-existing `tests/` failures remain and are unrelated to this change / env-only in a
shallow clone: `test_promote_source_ledger_reuse` (git `bad revision 8bb10f4`) and 4
`TestImageOnlyOcrIntegration` live-OCR cases (need OCR credentials). They failed identically
before this change.
