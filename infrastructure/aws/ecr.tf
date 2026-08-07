# ECR repository for the email-listener container image.
# Single repo, :latest (production) + :staging tags.

resource "aws_ecr_repository" "email_listener" {
  name                 = local.service_name
  image_tag_mutability = "MUTABLE" # allow :latest / :staging overwrite
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "email_listener" {
  repository = aws_ecr_repository.email_listener.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

# ECR repository for the co-located durable-ingest worker image (Track 3a,
# docs/DURABLE-WORKER-RUNBOOK.md §P4). The listener image is Python-only, so the
# Node graphile-worker ships as a DEDICATED image — same :latest (production) +
# :staging tag convention as the listener. Purely additive: creating the (empty)
# repo changes nothing about the running service; the task-def only references it
# once the worker container is enabled via the worker_db_url_secret_arn_* vars.

resource "aws_ecr_repository" "email_worker" {
  name                 = "${var.project}-email-worker"
  image_tag_mutability = "MUTABLE" # allow :latest / :staging overwrite
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "email_worker" {
  repository = aws_ecr_repository.email_worker.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
