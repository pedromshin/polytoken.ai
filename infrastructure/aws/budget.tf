# Account-wide monthly cost budget + email alerts.
#
# Guards against runaway spend (e.g. Bedrock code-island generation, which is pay-per-use).
# This is an ALERT, not a hard shut-off: AWS Budgets emails the subscribers when actual or
# forecasted spend crosses the thresholds. It does not stop resources by itself. (A hard stop
# would require AWS Budget Actions attaching a deny policy — more complex/risky; add later if
# desired.) Applies to the WHOLE account, so it also covers ECS/S3/etc., not just Bedrock.

resource "aws_budgets_budget" "monthly_cost" {
  name         = "${var.project}-monthly-cost"
  budget_type  = "COST"
  limit_amount = var.budget_monthly_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Early warning at 80% of ACTUAL spend.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }

  # At/over budget on ACTUAL spend.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }

  # Forecasted to exceed the budget this month — catches a spend spike early.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}
