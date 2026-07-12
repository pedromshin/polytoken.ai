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
