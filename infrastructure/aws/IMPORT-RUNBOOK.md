# IMPORT-RUNBOOK — SES personal-mail forwarder drift codification

The resources declared in `ses-forwarder.tf` (plus the `after` re-point of
`forwarding-catchall` in `ses.tf`) codify infrastructure that **already exists
live** in account `271369143207` (us-east-1). They were created outside
Terraform and captured read-only. **You must import every one of them into
state before running any `terraform apply`.**

## WARNINGS — read before touching anything

1. **Do NOT `terraform apply` before ALL imports below succeed.** Un-imported
   resources will be treated as new: the IAM role, Lambda, and receipt rule
   creates will fail on name collisions (or worse, partially succeed), and the
   `forwarding-catchall` update could be applied against a rule set whose
   `personal-forward` rule Terraform does not yet know about.
2. **Rule-order change semantics.** SES evaluates receipt rules in chain order
   and a matched rule with a stop action ends evaluation. The live order is:

   `agent-local → agent-staging → agent-prod → personal-forward → forwarding-catchall`

   `personal-forward` (recipient `pedro@magnitudetech.com.br`) sits BETWEEN
   `agent-prod` and `forwarding-catchall`, and ends with `stop_action` scope
   `RuleSet` — that is what keeps pedro@ mail out of the prod agent pipeline
   (the catch-all writes to `inbound/prod/` + SNS-notifies the prod service).
   To match this, `forwarding-catchall`'s `after` in `ses.tf` was changed from
   `agent-prod` to `personal-forward`. After importing, `terraform plan` may
   still show an in-place update on `aws_ses_receipt_rule.forwarding_catchall`
   for the `after` attribute if your existing state predates this change —
   that update is a NO-OP against live (live already has this order), but
   verify the plan says exactly that and nothing else. **Live mail routing
   depends on this order; never apply a plan that reorders these rules unless
   you intend to.**
3. **Lambda env vars are managed as Terraform variables/expressions.** The
   live function's environment VALUES were intentionally never read during
   drift capture (only that env vars exist). The config asserts:
   - `BUCKET`     = `nauta-services-ses-inbound-emails` (from `aws_s3_bucket.ses_inbound`)
   - `PREFIX`     = `inbound/personal/` (matches the personal-forward S3 action
     prefix and the only S3 path the role's IAM policy can read)
   - `FORWARD_TO` = `var.forwarder_forward_to` (default `pedromaschio.shin@gmail.com`)
   - `MAIL_FROM`  = `var.forwarder_mail_from` (default `no-reply@magnitudetech.com.br`)

   **After importing, inspect the `environment` diff in `terraform plan` and
   confirm the values match live before any apply.** If plan shows an env
   change you did not expect, the live values differ — fix the variables (or
   the live config) first; applying blindly would break forwarding.
4. **Lambda code hash.** The vendored source
   (`lambda/ses-forwarder/lambda_function.py`) is byte-identical to the live
   function's single source file, but the zip produced by `archive_file` is
   not guaranteed to hash identically to the zip that was uploaded live
   (`CodeSha256: AxaiYB8r0bWtfMBiwHeoRbS+xek0ZK8uW5Bj7gBK/44=`). A
   `source_code_hash`-driven code update in the first plan is expected and
   safe (same source re-uploaded); anything else is not.

## Import commands

Run from `infrastructure/aws/` with credentials for account `271369143207`
(`terraform init` first if needed — the `archive` provider was added).

```sh
# 1. IAM role (import ID = role name)
terraform import aws_iam_role.ses_forwarder polytoken-ses-forwarder-role

# 2. IAM inline role policy (import ID = role-name:policy-name)
terraform import aws_iam_role_policy.ses_forwarder polytoken-ses-forwarder-role:forwarder-policy

# 3. Lambda function (import ID = function name)
terraform import aws_lambda_function.ses_forwarder polytoken-ses-forwarder

# 4. Lambda permission (import ID = function-name/statement-id)
terraform import aws_lambda_permission.ses_forwarder polytoken-ses-forwarder/ses-invoke

# 5. SES receipt rule (import ID = ruleset:rulename)
terraform import aws_ses_receipt_rule.personal_forward nauta-services-inbound:personal-forward
```

## Plan verification procedure

After all five imports:

```sh
terraform plan
```

Acceptable outcomes, in order of preference:

1. **No changes** for the five imported resources and no `after` diff on
   `forwarding-catchall` — done.
2. Diffs limited to:
   - `aws_lambda_function.ses_forwarder`: `source_code_hash` /
     `last_modified` / `filename`-related churn (see warning 4);
   - `aws_ses_receipt_rule.forwarding_catchall`: `after` changing
     `"agent-prod" → "personal-forward"` (only if state predates the re-point;
     see warning 2);
   - tag-only or provider-default noise.

   Read each diff line and confirm it is one of the above before applying.
3. **Anything touching the Lambda `environment` block, receipt-rule
   recipients/actions/order beyond the above, or IAM policy JSON: STOP.**
   The codified config diverges from live — reconcile the config (or
   deliberately accept the change) before apply.

Then `terraform apply` only the reviewed plan (`terraform plan -out=tfplan`
&& `terraform apply tfplan` is the safe pattern).

## Current SES account status (captured at drift-capture time)

- **Sandbox**: `ProductionAccessEnabled = false` — SES can only SEND to
  verified identities. Forwarding to `pedromaschio.shin@gmail.com` works only
  because that address is a verified identity (or must be made one). Keep
  this in mind before changing `forwarder_forward_to`.
- **Send quota**: max 200 sends / 24 h, max rate 1 msg/s (4 sent in the last
  24 h at capture time). Personal-mail volume must stay under this.
- **Sending enabled**: true.

## Documented-only option (NOT implemented): forwarding agent@ addresses

If you ever want copies of `agent@` / `agent-staging@` / `agent-local@` mail
forwarded to the personal mailbox as well, the pattern would be:

- Add a `lambda_action` (invocation_type `Event`) to the corresponding
  receipt rule(s) in `ses.tf`, positioned AFTER the existing `s3_action`, and
  do NOT add a stop action — the SNS-notified agent pipeline must keep
  receiving the mail unchanged.
- The current Lambda reads only `PREFIX = inbound/personal/`; per-rule
  prefixes differ (`inbound/local|staging|prod/`), so this would require
  either (a) one Lambda instance per prefix (separate functions or aliases
  with distinct env), or (b) changing the function to derive the S3 key
  prefix from the receipt-rule ARN in the event instead of env — plus
  widening the role's `s3:GetObject` resource beyond `inbound/personal/*`.
- Quota risk: every inbound agent mail would consume outbound sandbox quota
  (200/day). Do not do this while the account is in the SES sandbox without
  checking volume.

**None of this is implemented; the config forwards pedro@ only.**
