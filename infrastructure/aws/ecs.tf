# ECS Fargate: one cluster, two services (production :latest, staging :staging).

resource "aws_ecs_cluster" "main" {
  name = local.service_name

  # Container Insights publishes dozens of per-task custom metrics (~$5/mo for
  # 1-2 tasks) — disabled to cut the CloudWatch bill. Re-enable if you need
  # per-task CPU/mem/network dashboards.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = local.environments

  name              = "/ecs/${each.value.name}"
  retention_in_days = 7

  tags = local.tags
}

# --- Durable ingest worker (Track 3a) — co-located graphile-worker container ---
#
# The worker (apps/worker) rides in the SAME task as the listener (essential = false,
# shared awsvpc netns -> it reaches the listener over localhost:${var.service_port})
# per docs/DURABLE-WORKER-RUNBOOK.md §P4. Ship-dark: the container is only added to
# an environment's task definition once that env's secret ARN below is set — with
# the defaults ("") the rendered container_definitions are byte-identical to today's,
# so merging/applying this changes nothing about the live listener.
#
# These worker inputs are declared here (not variables.tf) so the whole Track 3a
# worker surface lands as one reviewable diff; Terraform loads variable blocks from
# any *.tf file — move them to variables.tf whenever convenient.

variable "worker_db_url_secret_arn_prod" {
  description = "Secrets Manager ARN for the production GRAPHILE_WORKER_CONNECTION_STRING — a SESSION-MODE (non-pooling/direct) Postgres URL; LISTEN/NOTIFY dies on the transaction pooler, so this must be the same non-pooling URL packages/db migrate uses. Empty = worker container not added (ship-dark)."
  type        = string
  default     = ""
}

variable "worker_db_url_secret_arn_staging" {
  description = "Secrets Manager ARN for the staging GRAPHILE_WORKER_CONNECTION_STRING (session-mode/non-pooling Postgres URL). Empty = worker container not added (ship-dark)."
  type        = string
  default     = ""
}

locals {
  # env key -> the worker's DB-URL secret ARN ("" = worker disabled for that env).
  worker_db_url_secret_arns = {
    production = var.worker_db_url_secret_arn_prod
    staging    = var.worker_db_url_secret_arn_staging
  }

  # env key -> Track 3a INGEST_ENQUEUE_ENABLED cutover flag (variables.tf).
  # false = the env entry is omitted from the listener container entirely; see
  # the listener `environment` concat below.
  ingest_enqueue_enabled = {
    production = var.ingest_enqueue_enabled_prod
    staging    = var.ingest_enqueue_enabled_staging
  }

  # env key -> BTAP-07 CANVAS_EMIT_TOOL_ENABLED flag (variables.tf). Same posture:
  # false = the entry is omitted from the listener container entirely.
  canvas_emit_tool_enabled = {
    production = var.canvas_emit_tool_enabled_prod
    staging    = var.canvas_emit_tool_enabled_staging
  }

  # env key -> INGEST_INLINE_RETRY_ON_FAILURE (variables.tf). Same ship-dark posture.
  # This is the ONLY anti-mail-loss control that does NOT require the worker.
  ingest_inline_retry_on_failure = {
    production = var.ingest_inline_retry_on_failure_prod
    staging    = var.ingest_inline_retry_on_failure_staging
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each = local.environments

  family                   = each.value.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode(concat([
    {
      name      = "email-listener"
      image     = "${aws_ecr_repository.email_listener.repository_url}:${each.value.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = var.service_port
          protocol      = "tcp"
        }
      ]

      environment = concat(
        [
          { name = "ENVIRONMENT", value = each.value.environment },
          { name = "DEBUG", value = "false" },
          { name = "HOST", value = "0.0.0.0" },
          { name = "PORT", value = tostring(var.service_port) },
          { name = "LOG_LEVEL", value = "INFO" },
          { name = "LOG_JSON", value = "true" },
          { name = "SUPABASE_URL", value = each.value.supabase_url },
          { name = "BEDROCK_REGION", value = each.value.bedrock_region },
        ],
        # Sanctioned CUT-06 (staging) / CUT-08 (prod) flip mechanism — the ONLY
        # way INGEST_ENQUEUE_ENABLED reaches the listener (flip = durable-path
        # cutover per docs/DURABLE-WORKER-RUNBOOK.md §P5; one-line tfvars change
        # + gated apply, never a console task-def hand-edit). While the env's
        # flag is false this arm contributes an empty list, so concat(...)
        # yields exactly the previous literal env list and the rendered task
        # definition stays byte-identical (ship-dark — mirrors the
        # worker_db_url_secret_arn_* gate on the worker container below).
        local.ingest_enqueue_enabled[each.key] ? [
          { name = "INGEST_ENQUEUE_ENABLED", value = "true" }
        ] : [],
        # BTAP-07 flip mechanism, added 2026-08-08 — before this the flag was wired
        # NOWHERE in the infrastructure, so CANVAS_EMIT_TOOL_ENABLED never reached a
        # deployed listener and the seam could not be executed by anyone. Identical
        # ship-dark posture: false contributes an empty list, rendered task definition
        # byte-identical, listener keeps its settings.py default (False).
        local.canvas_emit_tool_enabled[each.key] ? [
          { name = "CANVAS_EMIT_TOOL_ENABLED", value = "true" }
        ] : [],
        # INGEST_INLINE_RETRY_ON_FAILURE flip mechanism, added 2026-08-08 — the SECOND flag found
        # wired nowhere in the infrastructure. Until now it could never reach a deployed listener,
        # so prod ran the settings.py default False: a failed inline ingest returns 200, SNS never
        # retries, and the email is lost permanently and silently. This arm is what makes the
        # "stop losing mail" flip actually invokable, and unlike INGEST_ENQUEUE_ENABLED above it
        # needs NO worker to be running. Same ship-dark posture: false contributes an empty list.
        local.ingest_inline_retry_on_failure[each.key] ? [
          { name = "INGEST_INLINE_RETRY_ON_FAILURE", value = "true" }
        ] : [],
      )

      secrets = concat(
        each.value.api_key_arn != "" ? [
          { name = "API_KEY", valueFrom = each.value.api_key_arn }
        ] : [],
        each.value.supabase_secret_key_arn != "" ? [
          { name = "SUPABASE_SECRET_KEY", valueFrom = each.value.supabase_secret_key_arn }
        ] : [],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "email-listener"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import httpx; httpx.get('http://localhost:${var.service_port}/health', timeout=2.0)\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
    ],
    # Track 3a durable-ingest worker — appended ONLY when the env's DB-URL secret
    # ARN is set (ship-dark; see the worker inputs above). The worker image must
    # exist in ECR (:latest / :staging) BEFORE enabling, or every task start fails
    # on image pull — essential=false does NOT cover an unpullable image.
    local.worker_db_url_secret_arns[each.key] != "" ? [
      {
        name = "email-worker"
        # Dedicated Node image (the listener image is Python-only); same tag
        # convention as the listener (:latest prod, :staging staging).
        image = "${aws_ecr_repository.email_worker.repository_url}:${each.value.image_tag}"
        # essential=false: a worker crash/exit must never take down the SNS
        # receiver — the listener stays the only essential container (runbook §P4).
        essential = false

        environment = [
          # Co-located listener over the shared awsvpc netns (runbook §2).
          { name = "LISTENER_INTERNAL_URL", value = "http://localhost:${var.service_port}" },
          { name = "WORKER_CONCURRENCY", value = "3" },
          { name = "WORKER_POLL_INTERVAL_MS", value = "2000" },
          # Ship-dark crontab gates — explicitly OFF; flip via task-def env only
          # when those features cut over (never as a side effect of this deploy).
          { name = "MORNING_BOARD_ENABLED", value = "false" },
          { name = "RECIPE_RECOMPUTE_ENABLED", value = "false" },
        ]

        secrets = concat(
          [
            # Session-mode (non-pooling) Postgres URL — the LISTEN/NOTIFY loop
            # does not survive the transaction pooler.
            { name = "GRAPHILE_WORKER_CONNECTION_STRING", valueFrom = local.worker_db_url_secret_arns[each.key] }
          ],
          each.value.api_key_arn != "" ? [
            # SAME secret as the listener's API_KEY — sent as x-api-key to the
            # guarded localhost re-entry routes (/v1/emails/ingest-job etc.).
            { name = "API_KEY", valueFrom = each.value.api_key_arn }
          ] : [],
        )

        # Start draining only after the listener answers /health — avoids a boot
        # window of connection-refused job attempts against localhost.
        dependsOn = [
          { containerName = "email-listener", condition = "HEALTHY" }
        ]

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
            awslogs-region        = var.aws_region
            awslogs-stream-prefix = "email-worker"
          }
        }
      }
    ] : [],
  ))

  tags = local.tags
}

resource "aws_ecs_service" "service" {
  for_each = local.environments

  name            = each.value.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true # public subnets, no NAT — required for ECR pulls
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service[each.key].arn
    container_name   = "email-listener"
    container_port   = var.service_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI deploys by forcing a new deployment after pushing a new image tag;
  # task definition revisions only change via Terraform.
  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = local.tags
}
