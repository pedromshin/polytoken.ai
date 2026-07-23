# ---------------------------------------------------------------------------
# SES personal-mail forwarder (pedro@ → operator Gmail)
#
# Codifies live drift found in account 271369143207 (us-east-1):
#   - Lambda function  polytoken-ses-forwarder
#   - IAM role         polytoken-ses-forwarder-role (+ inline forwarder-policy)
#   - Lambda permission ses-invoke (ses.amazonaws.com may invoke)
#   - SES receipt rule personal-forward, slotted BETWEEN agent-prod and
#     forwarding-catchall in the nauta-services-inbound rule set. The
#     forwarding-catchall rule's `after` in ses.tf was re-pointed to this
#     rule to match the live ordering — see the comment there and
#     IMPORT-RUNBOOK.md before touching anything.
#
# ALL resources below already exist. Import them (IMPORT-RUNBOOK.md) before
# running any apply, or Terraform will try to create duplicates / fail.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Variables
#
# NOTE: the live Lambda's environment VALUES were intentionally never read
# during drift capture (only the fact that env vars exist). The defaults
# below are the operator-confirmed intended values. After importing, run
# `terraform plan` and confirm that the environment block shows NO diff
# (or only expected diffs) before ever applying — see IMPORT-RUNBOOK.md.
# ---------------------------------------------------------------------------
variable "forwarder_forward_to" {
  description = "Destination mailbox for forwarded personal mail (Lambda env FORWARD_TO)"
  type        = string
  default     = "pedromaschio.shin@gmail.com"
}

variable "forwarder_mail_from" {
  description = "Verified-domain From address used when re-sending forwarded mail (Lambda env MAIL_FROM)"
  type        = string
  default     = "no-reply@magnitudetech.com.br"
}

# ---------------------------------------------------------------------------
# IAM role — trust policy verbatim from the live role
# ---------------------------------------------------------------------------
resource "aws_iam_role" "ses_forwarder" {
  name = "polytoken-ses-forwarder-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Inline policy verbatim from the live role (name: forwarder-policy).
resource "aws_iam_role_policy" "ses_forwarder" {
  name = "forwarder-policy"
  role = aws_iam_role.ses_forwarder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.ses_inbound.arn}/inbound/personal/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Lambda function — source vendored at lambda/ses-forwarder/lambda_function.py
# (single file; reads config exclusively from env vars, no secrets inside).
# ---------------------------------------------------------------------------
data "archive_file" "ses_forwarder" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/ses-forwarder"
  output_path = "${path.module}/lambda/ses-forwarder.zip"
}

resource "aws_lambda_function" "ses_forwarder" {
  function_name = "polytoken-ses-forwarder"
  role          = aws_iam_role.ses_forwarder.arn

  # Runtime facts verbatim from the live function.
  runtime       = "python3.12"
  handler       = "lambda_function.handler"
  timeout       = 30
  memory_size   = 256
  architectures = ["x86_64"]

  filename         = data.archive_file.ses_forwarder.output_path
  source_code_hash = data.archive_file.ses_forwarder.output_base64sha256

  # The live env VALUES were intentionally never read (drift capture was
  # read-only on config shape). BUCKET/PREFIX mirror the personal-forward
  # receipt rule's S3 action below (bucket + "inbound/personal/" — the only
  # prefix the IAM policy above can read); FORWARD_TO/MAIL_FROM come from
  # variables. Confirm all four match live via `terraform plan` after import,
  # BEFORE any apply.
  environment {
    variables = {
      BUCKET     = aws_s3_bucket.ses_inbound.bucket
      PREFIX     = "inbound/personal/"
      FORWARD_TO = var.forwarder_forward_to
      MAIL_FROM  = var.forwarder_mail_from
    }
  }
}

# Resource policy verbatim from the live function (Sid ses-invoke): SES may
# invoke, scoped to this account.
resource "aws_lambda_permission" "ses_forwarder" {
  statement_id   = "ses-invoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.ses_forwarder.function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

# ---------------------------------------------------------------------------
# Receipt rule — pedro@ personal forwarding
#
# ORDER IS LOAD-BEARING. Live chain (and this config, via `after`):
#   agent-local → agent-staging → agent-prod → personal-forward
#     → forwarding-catchall
# This rule MUST sit before forwarding-catchall: its stop_action ends rule-set
# evaluation for pedro@ so the catch-all never also dumps that mail into the
# prod agent pipeline. ses.tf's forwarding-catchall points `after` at this
# rule accordingly.
#
# Actions in live order: S3 write (no SNS topic), async Lambda invoke, stop.
# ---------------------------------------------------------------------------
resource "aws_ses_receipt_rule" "personal_forward" {
  name          = "personal-forward"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["pedro@magnitudetech.com.br"]
  enabled       = true
  scan_enabled  = false
  tls_policy    = "Optional"
  after         = aws_ses_receipt_rule.prod.name

  s3_action {
    bucket_name       = aws_s3_bucket.ses_inbound.bucket
    object_key_prefix = "inbound/personal/"
    position          = 1
  }

  lambda_action {
    function_arn    = aws_lambda_function.ses_forwarder.arn
    invocation_type = "Event"
    position        = 2
  }

  stop_action {
    scope    = "RuleSet"
    position = 3
  }

  depends_on = [
    aws_s3_bucket_policy.ses_inbound,
    aws_lambda_permission.ses_forwarder,
  ]
}
