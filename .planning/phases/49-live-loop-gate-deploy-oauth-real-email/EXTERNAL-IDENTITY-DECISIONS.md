# External-Identity Decisions — Phase 49 (LIVE-07)

**Recorded:** 2026-07-11 (Phase 49, Plan 05)
**Status:** Every leftover from `EXTERNAL-RENAME-RUNBOOK.md` (Phase 42) is DECIDED — executed,
attempted-and-deferred, or explicitly re-parked. Nothing is silently parked.

## Disposition table

| Item | Decision | Rationale | Executor | Status |
|---|---|---|---|---|
| GitHub repo rename (`pedromshin/nauta.services.email-listener` -> `polytoken.services.email-listener`) | **RE-PARK** (user decision 2026-07-12, MORNING-CHECKLIST §C Option 2) | Deploys keep working today; the rename requires the companion IAM trust-policy `terraform apply` in the same sitting (OIDC coupling below) — deferred until the user is ready to do both together | User (decided at the 49-06 checkpoint) | **DECIDED — re-parked** |
| Vercel project rename (`nauta-web` -> `polytoken-web`) | EXECUTE | Low risk — the git integration is repo-id-based and survives a project rename (runbook Sec 3) | Attempted autonomously this session (CLI present + authenticated) | **Blocked this session by the domain-change safety boundary** — deferred to 49-06 dashboard step (steps below) |
| AWS/Terraform resource renames (`var.project`, `tg_prefix`, ECR/ECS/ALB/CloudWatch/S3 names) | **RE-PARK** (explicit) | Hazard A (two unsynced sources of truth: Terraform vars vs hardcoded GitHub Actions env vars) + Hazard B (ECR `force_delete=false` destroy+recreate risk) + Hazard C (local-only, un-backed-up `terraform.tfstate`) — high blast-radius, zero user-facing value today (runbook Sec 2) | N/A — explicitly not scheduled this milestone | Re-parked; recorded in STATE.md |
| Local Supabase project-id (`nauta` -> `polytoken`) | RENAME (actualized) | Local-only; fresh containers + re-run migrations accepted; local data is disposable | Actualized in plan 49-01 (`supabase/config.toml` `project_id = "polytoken"`), confirmed live-running under `polytoken` by plan 49-03's DB-verified green-path run | **DONE** |
| Domain purchase / DNS (`polytoken.ai`) | User-only, out of scope | Requires registrar billing + DNS console access this agent does not have and should not be given (runbook Sec 4; REQUIREMENTS.md Out of Scope) | User only | Out of scope |

---

## GitHub rename <-> OIDC deploy-trust coupling (the reason GitHub rename is user-gated)

`infrastructure/aws/iam.tf:110-131` (`data.aws_iam_policy_document.github_assume`) grants the
GitHub Actions deploy role via `sts:AssumeRoleWithWebIdentity`, gated on a `StringLike` condition:

```
condition {
  test     = "StringLike"
  variable = "token.actions.githubusercontent.com:sub"
  values   = ["repo:${var.github_repository}:*"]
}
```

`infrastructure/aws/terraform.tfvars:4` currently pins:

```
github_repository = "pedromshin/nauta.services.email-listener"
```

**What breaks:** After a GitHub repo rename, every new CI run's OIDC token presents
`sub = repo:pedromshin/<new-repo-name>:...`, which no longer matches the
`repo:pedromshin/nauta.services.email-listener:*` pattern the trust policy still has. The
`sts:AssumeRoleWithWebIdentity` call then fails, `aws-actions/configure-aws-credentials` errors
out in the workflow, and **both ECS deploy pipelines (staging + prod) go red** — not because the
application broke, but because CI can no longer authenticate to AWS at all.

**The fix requires the re-parked AWS section:** repairing this means updating
`var.github_repository` in `terraform.tfvars` and running `terraform apply` on
`aws_iam_role_policy.github_deploy`'s parent role — which is exactly the kind of Terraform
`apply` the AWS/Terraform section above re-parks (Hazard A/B/C still apply generally to this
repo's Terraform surface, though this specific IAM-only change is lower-risk than the
ECR/ECS/ALB destroy+recreate hazards, since IAM role trust-policy JSON updates in place with no
`# forces replacement`). This is a narrower, safer apply than the full AWS rename, but it is
still a live IAM change gated on the user's own review — not something this plan performs
autonomously.

**Two safe options recorded for the user (surfaced again in the 49-06 checklist):**

1. **Rename the repo AND run the companion IAM `terraform apply` in the same sitting** — update
   `github_repository` in `terraform.tfvars` to the new `owner/repo-name`, run
   `terraform -chdir=infrastructure/aws plan` to confirm only the IAM trust-policy JSON shows a
   diff (no `# forces replacement` on unrelated resources), review it personally, then `apply`.
   Deploys stay green throughout because the fix lands before/with the rename.
2. **Accept that CI deploys pause** until both steps are done together — if the user renames the
   repo without immediately running the companion apply, `main`/`dev` pushes will fail at the
   `configure-aws-credentials` step until the fix lands. This is recoverable (not destructive) —
   the ECS services keep running the last successfully deployed image; only *new* deploys are
   blocked — but it should be a deliberate, informed choice, not a surprise.

Either way, **this plan does not rename the GitHub repo.** `gh auth status` in this session shows
a valid, active login (`pedromshin`, scopes `delete_repo, gist, read:org, repo, workflow`) —
contrary to the OIDC-analysis note carried over from planning that assumed `gh auth` was invalid
this run. That earlier assumption is now known to be stale, but it does not change the decision:
the rename is held for the 49-06 checkpoint because of the OIDC coupling above, which is
independent of whether `gh` happens to be authenticated on this machine. Renaming the repo without
its companion IAM apply — even though technically possible right now — would silently break both
deploy pipelines, which is exactly the landmine this plan exists to avoid stepping on.

---

## Vercel rename attempt (this session)

**CLI reality (verified live, this session):** `vercel` CLI 54.18.0 is installed at
`%APPDATA%/npm/vercel` and IS authenticated (`vercel whoami` returns `pedromshin`) — this
supersedes the "no Vercel CLI/token available" assumption carried into this session from earlier
planning; that assumption is stale.

**What was attempted:** `vercel project rename nauta-web polytoken-web --non-interactive --scope
team_V2cgPPeWDBTsSBVg3fwh1Jof` (project confirmed via `.vercel/project.json`:
`projectId=prj_70hRKIxh1giNAfzQvbrR1tX7pP2j`, `orgId=team_V2cgPPeWDBTsSBVg3fwh1Jof`,
`projectName=nauta-web`; prod URL `https://nauta-web.vercel.app` returned HTTP 200 earlier this
session).

**Outcome: BLOCKED, not executed.** The command was denied by this session's own auto-mode safety
classifier under a "DNS / Domain / Cert Changes" category — a project rename changes the live
`*.vercel.app` default domain, which was explicitly flagged this run as a boundary "do not attempt
it blindly" that is not lifted mid-session. **No mutation occurred**: `nauta-web` /
`prj_70hRKIxh1giNAfzQvbrR1tX7pP2j` is unchanged. This is the correct outcome per this plan's own
fallback branch ("if the CLI is unauthenticated or fails, do NOT block — record the exact
dashboard steps"), substituting "denied by the safety boundary" for "unauthenticated" as the
reason execution did not proceed.

**Blast-radius check performed before the attempt (still valid for 49-06):** grepped the full repo
for `nauta-web` and `vercel.app` — the only hits are in `.planning/` planning documents (this
runbook, research synthesis, migration-verification artifact); **zero hardcoded references exist
in application code** (env files, redirect-URI allowlists, CORS config). This means the rename is
genuinely low-risk from a code-reference standpoint, as the original runbook claimed — the only
open question is whether any *external* bookmark/link to `https://nauta-web.vercel.app` exists
outside this repo, which the user should confirm at 49-06 time.

**Exact dashboard steps for 49-06 (copy-paste ready):**

1. Go to <https://vercel.com/dashboard>, switch to the team scope
   `team_V2cgPPeWDBTsSBVg3fwh1Jof` if not already active.
2. Open project **nauta-web** -> **Settings** -> **General** -> **Project Name**.
3. Change the name to `polytoken-web` -> **Save**.
4. Confirm the git integration still auto-deploys on the next push to `main`/`dev` (it is
   repo-id-based, not name-based, so this should require no reconfiguration — runbook Sec 3).
5. Note the new default production URL becomes `https://polytoken-web.vercel.app`. Since no custom
   domain is currently attached and no application code hardcodes the old
   `https://nauta-web.vercel.app` URL (confirmed above), the only follow-up is updating any
   *external* bookmarks/links the user personally maintains.
6. CLI alternative if preferred interactively: `vercel project rename nauta-web polytoken-web`
   (run from the repo root so `.vercel/project.json` auto-resolves the project; the CLI may prompt
   for scope confirmation interactively — that is expected and safe to accept for this project).

---

## AWS / Terraform re-park (detail)

Re-parked in full per `EXTERNAL-RENAME-RUNBOOK.md` Section 2 — no changes made, no `terraform
plan`/`apply` run against `var.project`/`tg_prefix` this plan. The three hazards driving the
re-park (verbatim from the runbook, still current as of this session):

- **Hazard A — two unsynced sources of truth:** Terraform's `var.project`
  (`infrastructure/aws/variables.tf:16`) and the GitHub Actions workflow YAML's hardcoded
  `ECR_REPOSITORY`/`ECS_CLUSTER`/`ECS_SERVICE` env vars
  (`.github/workflows/deploy-email-listener.yml:13-15` and `deploy-email-listener-staging.yml:13-15`)
  are two independent strings — renaming one without the other in the same PR breaks the next
  deploy.
- **Hazard B — ECR `force_delete=false` destroy+recreate risk:** ECR/ECS/ALB resource names are
  immutable; a rename forces Terraform to plan a destroy+create, and the ECR repo's
  `force_delete=false` default means `apply` fails loudly (safe) unless the repo is empty — but
  flipping `force_delete=true` to force it through would silently delete every pushed image.
- **Hazard C — local-only tfstate:** `infrastructure/aws/terraform.tfstate` is gitignored and
  lives only on whichever machine last ran `apply`; a rename-triggered apply from the wrong
  machine risks creating duplicate resources or losing track of live ones.

This decision is recorded in `.planning/STATE.md` (Phase 49 — Plan 05 section) per this plan's
must-haves, not left as an implicit "not done this phase."

---

## Local Supabase project-id (detail)

Already actualized before this plan ran — `supabase/config.toml`'s `project_id = "polytoken"` was
in place prior to Phase 49, and plan 49-01 documented the decision (`docs/RUN-LOCAL.md` Section 5:
fresh containers accepted, migrations re-run, local data treated as disposable). Plan 49-03 then
proved the local stack runs live, DB-verified, under `project_id=polytoken`. Nothing further is
needed here; this row exists in the disposition table purely so LIVE-07's "every leftover decided"
bar has one row per leftover, including the ones already closed.

---

## Domain / DNS (detail)

Out of scope for autonomous execution — requires domain-registrar billing access and DNS console
access this agent does not have and should not be given (`EXTERNAL-RENAME-RUNBOOK.md` Section 4;
`REQUIREMENTS.md` Out of Scope). No action taken or attempted this plan.

---

## JWT signing-key audit — folded into the tracked tree

`JWT-SIGNING-KEY-AUDIT.md` (Phase 43, `.planning/milestones/v1.7-phases/43-auth-google-oauth-sessions-supabase-auth/`)
was untracked (`??` in `git status`) prior to this plan. Its recorded finding — staging
(`fyfwkjvbcrmjqjysdyqw`) and production (`dazyccjijdahxyciptkp`) both on asymmetric **ES256**, local
Supabase CLI defaulting to **HS256** — was confirmed still accurate this session and is unchanged.
It is now git-tracked (see this plan's Task 2 commit) with a one-line verification annotation
appended; the user will re-confirm it live in the Supabase Dashboard (Settings -> API -> JWT Keys)
during the 49-06 checkpoint, per `MORNING-CHECKLIST.md` Section A's JWT re-confirm step.
