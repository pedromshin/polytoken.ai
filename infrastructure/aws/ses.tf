# SES domain identity for magnitudetech.com.br
resource "aws_ses_domain_identity" "main" {
  domain = "magnitudetech.com.br"
}

output "ses_domain_verification_token" {
  value       = aws_ses_domain_identity.main.verification_token
  description = "Add as TXT record: _amazonses.magnitudetech.com.br"
}

# ---------------------------------------------------------------------------
# S3 bucket — shared raw email store (all three environments write here)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "ses_inbound" {
  bucket = "${var.project}-ses-inbound-emails"
}

resource "aws_s3_bucket_lifecycle_configuration" "ses_inbound" {
  bucket = aws_s3_bucket.ses_inbound.id
  rule {
    id     = "expire-raw-emails"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_policy" "ses_inbound" {
  bucket = aws_s3_bucket.ses_inbound.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.ses_inbound.arn}/*"
      Condition = {
        StringEquals = {
          "aws:Referer" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# SNS topics — one per environment
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "ses_inbound" {
  for_each = toset(["prod", "staging", "local"])
  name     = "${var.project}-ses-inbound-${each.key}"
}

resource "aws_sns_topic_policy" "ses_inbound" {
  for_each = aws_sns_topic.ses_inbound
  arn      = each.value.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPublish"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "SNS:Publish"
      Resource  = each.value.arn
    }]
  })
}

# ---------------------------------------------------------------------------
# SNS subscriptions
#   prod    → ALB port 80  (production ECS service)
#   staging → ALB port 8080 (staging ECS service)
#   local   → ngrok URL    (local dev server)
# ---------------------------------------------------------------------------
resource "aws_sns_topic_subscription" "prod" {
  topic_arn              = aws_sns_topic.ses_inbound["prod"].arn
  protocol               = "http"
  endpoint               = "http://${var.alb_dns_name}/v1/emails/inbound-sns"
  endpoint_auto_confirms = true
}

resource "aws_sns_topic_subscription" "staging" {
  topic_arn              = aws_sns_topic.ses_inbound["staging"].arn
  protocol               = "http"
  endpoint               = "http://${var.alb_dns_name}:8080/v1/emails/inbound-sns"
  endpoint_auto_confirms = true
}

resource "aws_sns_topic_subscription" "local" {
  count                  = var.ngrok_url != "" ? 1 : 0
  topic_arn              = aws_sns_topic.ses_inbound["local"].arn
  protocol               = "https"
  endpoint               = "${var.ngrok_url}/v1/emails/inbound-sns"
  endpoint_auto_confirms = true
}

# ---------------------------------------------------------------------------
# SES receipt rule set
# ---------------------------------------------------------------------------
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${var.project}-inbound"
}

resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# ---------------------------------------------------------------------------
# Receipt rules — specific recipients, evaluated in order (position matters)
# ---------------------------------------------------------------------------

# agent-local@  →  local SNS topic  (position 1 — checked first)
resource "aws_ses_receipt_rule" "local" {
  name          = "agent-local"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["agent-local@magnitudetech.com.br"]
  enabled       = true
  scan_enabled  = false

  s3_action {
    bucket_name       = aws_s3_bucket.ses_inbound.bucket
    object_key_prefix = "inbound/local/"
    topic_arn         = aws_sns_topic.ses_inbound["local"].arn
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.ses_inbound]
}

# agent-staging@  →  staging SNS topic  (position 2)
resource "aws_ses_receipt_rule" "staging" {
  name          = "agent-staging"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["agent-staging@magnitudetech.com.br"]
  enabled       = true
  scan_enabled  = false
  after         = aws_ses_receipt_rule.local.name

  s3_action {
    bucket_name       = aws_s3_bucket.ses_inbound.bucket
    object_key_prefix = "inbound/staging/"
    topic_arn         = aws_sns_topic.ses_inbound["staging"].arn
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.ses_inbound]
}

# agent@  →  prod SNS topic  (position 3 / catch-all for the domain)
resource "aws_ses_receipt_rule" "prod" {
  name          = "agent-prod"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["agent@magnitudetech.com.br"]
  enabled       = true
  scan_enabled  = false
  after         = aws_ses_receipt_rule.staging.name

  s3_action {
    bucket_name       = aws_s3_bucket.ses_inbound.bucket
    object_key_prefix = "inbound/prod/"
    topic_arn         = aws_sns_topic.ses_inbound["prod"].arn
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.ses_inbound]
}

# ---------------------------------------------------------------------------
# Domain-level catch-all — routes u-{token}@magnitudetech.com.br (any token,
# the personal-forwarding seam, THRD-04/LIVE-04) into the prod pipeline.
#
# SES evaluates receipt rules in the rule set's defined `after`-chain order
# and STOPS at the first match. This rule uses a bare domain as `recipients`
# (not an exact local-part) so it matches everything that the three
# exact-match rules above do NOT already claim. Because it is positioned
# `after = aws_ses_receipt_rule.prod.name` — i.e. LAST in the chain — it can
# never shadow agent-local@ / agent-staging@ / agent@: SES always tries those
# three exact matches first and only falls through to this catch-all when
# none of them match. Do not reorder this rule ahead of the exact-match
# rules; doing so would make it swallow all mail for the domain, including
# the three dedicated addresses.
# ---------------------------------------------------------------------------
resource "aws_ses_receipt_rule" "forwarding_catchall" {
  name          = "forwarding-catchall"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["magnitudetech.com.br"] # bare domain = catch-all
  enabled       = true
  scan_enabled  = false
  after         = aws_ses_receipt_rule.prod.name

  # Routed at the PROD pipeline: the forwarding user's account lives in the
  # prod database (single-operator personal-use seam), matching agent-prod's
  # own routing above.
  s3_action {
    bucket_name       = aws_s3_bucket.ses_inbound.bucket
    object_key_prefix = "inbound/prod/"
    topic_arn         = aws_sns_topic.ses_inbound["prod"].arn
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.ses_inbound]
}
