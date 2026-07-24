# REMOTE-STATE-RUNBOOK — Track 1: shared Terraform state for the FULL stack

> **Scope.** This is the Track-1 runbook for putting the **entire** `infrastructure/aws`
> stack (46 resources) under a **shared S3 remote state** so any checkout can plan/apply
> safely. It is BROADER than [`IMPORT-RUNBOOK.md`](./IMPORT-RUNBOOK.md), which covers ONLY
> the 5 out-of-band `ses-forwarder.tf` resources (the personal-mail forwarder that was
> drift-codified). **Read that one too** — its forwarder imports + SES rule-order warnings
> still apply and are not repeated here.
>
> **Why this exists:** the S3 backend in `main.tf` is still commented out, so state lives
> **locally** on whoever last applied. A fresh checkout has NO state → `terraform apply`
> would try to **create** all 46 resources, and for the live SES receipt rules / SNS topics
> / S3 inbound bucket that means an **inbound-mail outage**. Nothing here is executed by the
> agent that wrote it — no `terraform` binary, no AWS creds in the build container. This is
> a runbook for a human with account `271369143207` (us-east-1) credentials.

## ⛔ The one rule that prevents a mail outage

**Never run `terraform apply` until `terraform plan` shows ZERO `create` or `replace`/
`destroy` for any live resource** — most critically the mail pipeline:
`aws_ses_receipt_rule_set.main`, `aws_ses_receipt_rule.{local,staging,prod}`,
`aws_ses_active_receipt_rule_set.main`, `aws_ses_domain_identity.main`,
`aws_sns_topic.ses_inbound[*]` + its policy/subscriptions, and `aws_s3_bucket.ses_inbound`
(+ its policy/lifecycle). A `create`/`replace` on any of those = mail routing is torn down
and rebuilt = lost inbound mail. `terraform plan` is the authoritative completeness gate —
trust it over any hand-written list, including this one.

## Step 1 — create the state backend infrastructure (one-time)

The backend block in `main.tf` already names the bucket (`nauta-services-terraform-state`,
key `email-listener/terraform.tfstate`, region `us-east-1`). Before uncommenting it:

```sh
# State bucket — versioned (state history / recovery) + encrypted + no public access.
aws s3api create-bucket --bucket nauta-services-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket nauta-services-terraform-state \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket nauta-services-terraform-state \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket nauta-services-terraform-state \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# RECOMMENDED — a DynamoDB lock table so two applies can't corrupt state.
aws dynamodb create-table --table-name nauta-services-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-east-1
```

Then uncomment the backend in `main.tf` and add the lock table:

```hcl
backend "s3" {
  bucket         = "nauta-services-terraform-state"
  key            = "email-listener/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "nauta-services-terraform-locks"  # add this line
  encrypt        = true
}
```

## Step 2 — choose the path: MIGRATE (almost always) vs RE-IMPORT (only if state is lost)

Run `terraform state list` in the checkout that has been applying (the one with the working
local `terraform.tfstate`).

- **If it lists ~46 resources → PATH A (migrate).** The stack is already in state; you only
  need to move that state into S3. **This imports nothing.**
- **If there is NO working local state anywhere → PATH B (re-import).** Every resource must be
  imported before the first apply.

> The forwarder's 5 resources are the known exception: even in the migrate case, confirm they
> are present in `state list`; if not, run [`IMPORT-RUNBOOK.md`](./IMPORT-RUNBOOK.md)'s imports first.

### PATH A — migrate the existing local state to S3 (primary path)

```sh
cd infrastructure/aws
terraform init -migrate-state    # copies local state → the S3 backend; answer "yes"
terraform plan                   # MUST be a clean/no-op plan — see the gate below
```

Done — no imports. Verify the plan per **Step 4**.

### PATH B — re-import every resource (fallback: local state lost/incomplete)

Import each address, then let `terraform plan` tell you what is still missing (any resource it
wants to `create` is not yet in state). Repeat import → plan until plan shows no creates for
live resources. **Two gotchas:**

1. **`for_each` / `count` resources need the indexed address.** In this stack:
   `aws_subnet.public[0]`/`[1]`, `aws_route_table_association.public[0]`/`[1]`,
   `aws_sns_topic.ses_inbound["prod"]`/`["staging"]`/`["local"]` (+ `_policy` / `_subscription`
   per key), and the ECS/log-group resources (`for_each` by environment) — use the exact keys
   from `terraform plan` output, not a bare address.
2. **Config-derivable IDs vs AWS-assigned IDs.** Names below are derivable from the config
   (`var.project = "nauta-services"`, `local.service_name = "nauta-services-email-listener"`).
   AWS-assigned IDs (`vpc-…`, `subnet-…`, `sg-…`, ALB/target-group ARNs, SNS subscription ARNs,
   the ECS task-definition revision ARN) must be fetched from the live account first
   (`aws ec2 describe-vpcs`, `aws elbv2 describe-load-balancers`, `aws sns list-subscriptions`, …).

**Mail pipeline — HIGHEST RISK, and every ID here IS config-derivable (do these carefully):**

```sh
terraform import aws_ses_domain_identity.main            magnitudetech.com.br
terraform import aws_ses_receipt_rule_set.main           nauta-services-inbound
terraform import aws_ses_active_receipt_rule_set.main    nauta-services-inbound
terraform import aws_ses_receipt_rule.local              nauta-services-inbound:agent-local
terraform import aws_ses_receipt_rule.staging            nauta-services-inbound:agent-staging
terraform import aws_ses_receipt_rule.prod               nauta-services-inbound:agent-prod
terraform import aws_s3_bucket.ses_inbound               nauta-services-ses-inbound-emails
terraform import aws_s3_bucket_policy.ses_inbound        nauta-services-ses-inbound-emails
terraform import aws_s3_bucket_lifecycle_configuration.ses_inbound nauta-services-ses-inbound-emails
# SNS topics (ARN = arn:aws:sns:us-east-1:271369143207:<name>):
terraform import 'aws_sns_topic.ses_inbound["prod"]'     arn:aws:sns:us-east-1:271369143207:nauta-services-ses-inbound-prod
terraform import 'aws_sns_topic.ses_inbound["staging"]'  arn:aws:sns:us-east-1:271369143207:nauta-services-ses-inbound-staging
terraform import 'aws_sns_topic.ses_inbound["local"]'    arn:aws:sns:us-east-1:271369143207:nauta-services-ses-inbound-local
terraform import 'aws_sns_topic_policy.ses_inbound["prod"]'    arn:aws:sns:us-east-1:271369143207:nauta-services-ses-inbound-prod
# … staging/local likewise. Subscriptions: aws sns list-subscriptions-by-topic --topic-arn <arn>
#    then: terraform import 'aws_sns_topic_subscription.prod' <subscription-arn>
```

**Compute / IAM / budget — config-derivable names** (ECS cluster/service/task-def may be
`for_each` by env — take the exact keys from `plan`):

```sh
terraform import aws_ecr_repository.email_listener       nauta-services-email-listener
terraform import aws_ecr_lifecycle_policy.email_listener nauta-services-email-listener
terraform import aws_ecs_cluster.main                    nauta-services-email-listener
# ECS service import ID = "<cluster>/<service>"; task-def = the versioned ARN (fetch).
terraform import aws_iam_role.ecs_execution              nauta-services-email-listener-ecs-execution
terraform import aws_iam_role.ecs_task                   nauta-services-email-listener-ecs-task
terraform import aws_iam_role.github_deploy              nauta-services-email-listener-github-deploy
# inline role policies: import ID = "<role-name>:<policy-name>" (e.g. …-ecs-execution:read-secrets,
#   …-ecs-task:invoke-bedrock-claude, …-ecs-task:read-ses-inbound-emails, …-github-deploy:deploy-email-listener)
# managed attachment: import ID = "<role-name>/<policy-arn>"
terraform import aws_budgets_budget.monthly_cost         271369143207:nauta-services-monthly-cost
```

**Network / ALB — AWS-assigned IDs, fetch first** (`aws_vpc.main`, `aws_subnet.public[0..1]`,
`aws_internet_gateway.main`, `aws_route_table.public`, `aws_route_table_association.public[0..1]`,
`aws_security_group.{alb,service}`, `aws_lb.main`, `aws_lb_listener.{http,staging}`,
`aws_lb_target_group.service`, `aws_cloudwatch_log_group.service[*]`). Use `terraform plan` to
enumerate exactly which remain, and the matching `aws … describe-*` call to get each id/ARN.

## Step 3 — the forwarder resources

Run the 5 imports in [`IMPORT-RUNBOOK.md`](./IMPORT-RUNBOOK.md) (IAM role + policy, Lambda +
permission, `aws_ses_receipt_rule.personal_forward`) if they are not already in state, and heed
its **SES rule-order** warning: the live chain is
`agent-local → agent-staging → agent-prod → personal-forward → forwarding-catchall`, and a plan
that reorders those rules is a mail-routing change — never apply it unintentionally.

## Step 4 — plan verification gate (the real completeness check)

```sh
terraform plan -out=tfplan
```

- **Acceptable:** no changes, OR only the known-safe churn documented in `IMPORT-RUNBOOK.md`
  (the Lambda `source_code_hash` re-upload; the `forwarding-catchall` `after` no-op).
- **STOP if plan shows any `create`, `replace`, or `destroy` on a live resource** — that
  resource is not in state (missed/mis-keyed import). Import it and re-plan. Do NOT apply.

Only `terraform apply tfplan` once the plan is clean and reviewed line by line.

## Serialized-behind note

Per the master plan, the ALB/Fargate **ingress teardown** (the Track-3a cost half — `alb.tf` /
`network.tf` / `ecs.tf`) is a SEPARATE infra project that must wait until this remote-state
migration is green and every live resource is confirmed in state. It is NOT part of Track 1's
"get to a shared, safe state" goal, and NOT on Track 3's critical path.
