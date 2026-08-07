output "ecr_repository_url" {
  description = "ECR repo for email-listener images"
  value       = aws_ecr_repository.email_listener.repository_url
}

output "ecr_worker_repository_url" {
  description = "ECR repo for the co-located durable-ingest worker images (Track 3a; push :latest / :staging here BEFORE enabling the worker container)"
  value       = aws_ecr_repository.email_worker.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS — production on :80, staging on :8080"
  value       = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name (used by CI deploys)"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_names" {
  description = "ECS service names per environment"
  value       = { for k, v in aws_ecs_service.service : k => v.name }
}

output "github_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN secret in GitHub"
  value       = aws_iam_role.github_deploy.arn
}

output "ses_inbound_topic_arns" {
  description = "SNS topic ARNs per environment (used by ops redrive script)"
  value       = { for k, v in aws_sns_topic.ses_inbound : k => v.arn }
}

output "ses_inbound_bucket" {
  description = "S3 bucket holding raw inbound MIME (30-day retention)"
  value       = aws_s3_bucket.ses_inbound.bucket
}
