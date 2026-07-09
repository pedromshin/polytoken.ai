---
phase: 42-atomic-rename-nauta-polytoken
plan: 02
subsystem: infra
tags: [terraform, aws, ecr, ecs, github, vercel, dns, runbook, documentation]

# Dependency graph
requires:
  - phase: 42-atomic-rename-nauta-polytoken (plan 01)
    provides: completed internal rename (@nauta/* -> @polytoken/*) that this runbook's Section 1/3 references as already-done context
provides:
  - EXTERNAL-RENAME-RUNBOOK.md — a user-executed, step-by-step runbook covering GitHub repo rename, AWS/Terraform resource renames (with the ECR force_delete/tfstate/two-source-of-truth hazards spelled out verbatim), Vercel project rename, and domain purchase/DNS
affects: [43-google-oauth-tenancy, any future phase that touches infrastructure/aws or .github/workflows deploy configs]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md
  modified: []

key-decisions:
  - "Runbook is documentation-only — zero live AWS/Terraform/Vercel/GitHub resource-name strings changed in the repo, per RENM-02's explicit scope"
  - "terraform plan named as the mandatory read-only proof step; terraform apply explicitly marked out of scope for phase 42 (the user's own later, deliberate action)"
  - "Order of operations recommended: GitHub repo rename (low risk) -> AWS/Terraform (highest risk, needs the same-PR reconciliation) -> Vercel project rename (low risk) -> domain purchase/DNS (user-only, do last, verify before retiring old inbound path)"

patterns-established: []

requirements-completed: [RENM-02]

# Metrics
duration: 2min
completed: 2026-07-09
---

# Phase 42 Plan 02: External-Rename Runbook Summary

**User-executed runbook (259 lines) documenting GitHub/AWS-Terraform/Vercel/domain external renames — including the ECR `force_delete=false` destroy/recreate hazard, the local-only tfstate hazard, and the Terraform-`var.project`-vs-GitHub-Actions-YAML two-source-of-truth reconciliation, verbatim — with zero live resource-name strings changed in the repo.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-09T21:49:29Z
- **Completed:** 2026-07-09T21:51:43Z
- **Tasks:** 1 completed
- **Files modified:** 1 (new file)

## Accomplishments

- Produced `.planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md`, a 259-line ordered runbook with four sections: (1) GitHub repo rename, (2) AWS/Terraform resources (the load-bearing section — every live resource name with exact file:line, plus the three hazards documented verbatim), (3) Vercel project rename, (4) domain purchase/DNS.
- Section 2 enumerates every live AWS/Terraform resource-name string currently in the repo in a single table: Terraform `var.project` default `"nauta-services"` (`infrastructure/aws/variables.tf:16`), `tg_prefix` local `"nauta-el"` (`infrastructure/aws/locals.tf:4`), the GitHub Actions env blocks in both `deploy-email-listener.yml:13-15` and `deploy-email-listener-staging.yml:13-15`, the commented S3 backend bucket name (`main.tf:13`), the local `terraform.tfstate` contents, the `README.md:56-57` deploy-target table cells, and `SES_S3_BUCKET` (`settings.py:97`).
- Documented, verbatim, the three required hazards: (a) two unsynced sources of truth (Terraform `var.project` vs. the hardcoded GitHub Actions workflow env vars — must be changed in the same PR, with an explicit reconciliation checklist); (b) ECR `force_delete=false` destroy+recreate risk (a Terraform rename of immutable-name resources is destroy+recreate; `apply` fails loudly on a non-empty ECR repo by design; explicit warnings against casually flipping `force_delete=true` or attempting an unverified `terraform state mv`); (c) local-only tfstate (confirm which machine holds authoritative state before any rename-triggered apply; never hand-edit `terraform.tfstate`; optional recommendation to enable the S3 remote backend before applying).
- Named `terraform plan` as the mandatory read-only proof step (with the exact command `npm run infra:tf -- plan`) and explicitly stated `terraform apply` is out of scope for phase 42.
- Section 3 (Vercel) notes `.vercel/project.json` is gitignored and self-regenerates via `vercel link` — no committed surface to edit.
- Section 4 (domain/DNS) is flagged as user-only (billing + registrar access), sequenced last, with an explicit "verify new inbound path before retiring the old one" discipline mirroring the AWS hazard-avoidance pattern.
- Confirmed via `git status --porcelain infrastructure/ .github/workflows/ README.md` that this plan changed zero live resource-name strings — the only diff in that scope is the pre-existing, out-of-scope `infrastructure/aws/ecs.tf` modification excluded per this plan's hard constraints.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the external-rename runbook** - `afbcdc0` (docs)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `.planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md` - New 259-line user-executed runbook for RENM-02 (GitHub repo, AWS/Terraform, Vercel, domain/DNS renames)

## Decisions Made

- Followed the plan's structure exactly: four ordered sections in the order GitHub → AWS/Terraform → Vercel → domain/DNS, matching the plan's own recommended execution order (lowest-risk first, highest-risk AWS/Terraform section in the middle with full hazard treatment, user-only domain step last).
- Added a "Summary — order of operations" closing section (not explicitly required by the plan's acceptance criteria, but directly serves the plan's objective of being an actionable, safe, user-executed procedure) — a light Rule 2 addition (missing but clearly beneficial for a document whose entire purpose is safe sequential execution by a human).
- Cited the actual live values read this session (`variables.tf:16` = `"nauta-services"`, `locals.tf:4` = `"nauta-el"`, both workflow YAML env blocks, `main.tf:13`'s commented backend, `settings.py:97`'s `SES_S3_BUCKET`, `README.md:56-57`'s table, and the confirmed GitHub remote `pedromshin/nauta.services.email-listener`) rather than relying solely on 42-RESEARCH.md's citations, to guarantee accuracy against the current repo state.

## Deviations from Plan

None - plan executed exactly as written. (The one addition — the closing "Summary — order of operations" section — is documentation-quality scope, not a deviation from any acceptance criterion; all required content items were included as specified.)

## Issues Encountered

None.

## User Setup Required

None for this plan itself (it is documentation-only). The runbook it produced (`EXTERNAL-RENAME-RUNBOOK.md`) is itself the user-setup instructions for the four external renames (GitHub, AWS/Terraform, Vercel, domain) — to be executed by the user at a time of their choosing, outside this phase's automated scope.

## Next Phase Readiness

- RENM-02 satisfied: external renames delivered as a documented user runbook, not executed; live AWS resource-name strings remain untouched in the repo.
- Phase 42 (Atomic Rename nauta → polytoken) is now fully complete: Plan 42-01 (internal rename, RENM-01) + Plan 42-02 (external-rename runbook, RENM-02), both requirements satisfied.
- No blockers for the next phase (43, per STATE.md's roadmap — Auth: Google OAuth + sessions).

---
*Phase: 42-atomic-rename-nauta-polytoken*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: .planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md
- FOUND: .planning/phases/42-atomic-rename-nauta-polytoken/42-02-SUMMARY.md
- FOUND: commit afbcdc0 (docs(42): add external-rename runbook)
