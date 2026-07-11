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

resource "aws_ecs_task_definition" "service" {
  for_each = local.environments

  family                   = each.value.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
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

      environment = [
        { name = "ENVIRONMENT", value = each.value.environment },
        { name = "DEBUG", value = "false" },
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = tostring(var.service_port) },
        { name = "LOG_LEVEL", value = "INFO" },
        { name = "LOG_JSON", value = "true" },
        { name = "SUPABASE_URL", value = each.value.supabase_url },
        { name = "BEDROCK_REGION", value = each.value.bedrock_region },
      ]

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
  ])

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
