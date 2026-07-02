variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile"
  type        = string
  default     = "default"
}

variable "project" {
  description = "Project prefix for resource names"
  type        = string
  default     = "nauta-services"
}

variable "service_port" {
  description = "Container port for the email-listener service"
  type        = number
  default     = 8000
}

variable "github_repository" {
  description = "GitHub repo (org/name) allowed to assume the deploy role via OIDC"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the service VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "prod_desired_count" {
  description = "Desired task count for the production service"
  type        = number
  default     = 1
}

variable "staging_desired_count" {
  description = "Desired task count for the staging service (0 = scaled down to save cost; scale up on demand when testing)"
  type        = number
  default     = 0
}

variable "api_key_secret_arn_prod" {
  description = "Secrets Manager ARN for the production API_KEY"
  type        = string
  default     = ""
}

variable "api_key_secret_arn_staging" {
  description = "Secrets Manager ARN for the staging API_KEY"
  type        = string
  default     = ""
}

variable "supabase_secret_key_arn_prod" {
  description = "Secrets Manager ARN for the production Supabase secret API key"
  type        = string
  default     = ""
}

variable "supabase_secret_key_arn_staging" {
  description = "Secrets Manager ARN for the staging Supabase secret API key"
  type        = string
  default     = ""
}

variable "bedrock_region" {
  description = "AWS region used for Bedrock InvokeModel calls (Claude transport)"
  type        = string
  default     = "us-east-1"
}

variable "alb_dns_name" {
  description = "ALB DNS name for SNS HTTP subscription"
  type        = string
}

variable "ngrok_url" {
  description = "ngrok HTTPS base URL for local dev SNS subscription (e.g. https://abc123.ngrok-free.app). Leave empty to skip creating the local subscription."
  type        = string
  default     = ""
}

variable "budget_monthly_limit_usd" {
  description = "Monthly account-wide AWS cost budget (USD). Alerts (not a hard stop) fire at 80%/100% actual + 100% forecasted."
  type        = string
  default     = "30"
}

variable "budget_alert_emails" {
  description = "Email addresses that receive AWS Budget alerts."
  type        = list(string)
  default     = ["pedro@magnitudetech.com.br"]
}
