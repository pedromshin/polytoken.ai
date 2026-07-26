# IAM: ECS execution/task roles + GitHub Actions OIDC deploy role.

# --- ECS execution role (pull image, write logs, read secrets) ---

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.service_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      var.api_key_secret_arn_prod,
      var.api_key_secret_arn_staging,
      var.supabase_secret_key_arn_prod,
      var.supabase_secret_key_arn_staging,
    ])
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count = length(compact([
    var.api_key_secret_arn_prod,
    var.api_key_secret_arn_staging,
    var.supabase_secret_key_arn_prod,
    var.supabase_secret_key_arn_staging,
  ])) > 0 ? 1 : 0
  name   = "read-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# --- ECS task role (runtime AWS permissions) ---

resource "aws_iam_role" "ecs_task" {
  name               = "${local.service_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

# Bedrock InvokeModel — runtime call made by app code, so it lives on the TASK
# role (not the execution role). Scoped to Claude models only: both the
# foundation-model ARNs (account-less) and the cross-region inference-profile
# ARNs (account-scoped) used by the "us.anthropic.claude-*" model ids.
data "aws_iam_policy_document" "ecs_task_bedrock" {
  statement {
    sid = "InvokeClaudeOnBedrock"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    # Region wildcard: the "us.anthropic.claude-*" ids are CROSS-REGION inference
    # profiles that fan out to foundation-models in us-east-1/us-east-2/us-west-2,
    # so InvokeModel must be allowed on the model ARN in every routed region (a
    # single-region scope yields a 403 on us-east-2). Titan embed models are also
    # invoked by the retrieval/embedding adapter.
    resources = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-*",
      "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/*.anthropic.claude-*",
    ]
  }
}

resource "aws_iam_role_policy" "ecs_task_bedrock" {
  name   = "invoke-bedrock-claude"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_bedrock.json
}

# SES inbound raw MIME — app code fetches raw emails from the shared S3 bucket
# at ingestion time (S3RawEmailStore), so read access lives on the TASK role.
# DeleteObject is required by self-serve account deletion: DeleteImporterDataUseCase
# erases each user's raw MIME via S3RawEmailStore.delete_by_key. Without it the
# listener's delete_object returns AccessDenied, the deletion reports incomplete,
# and the whole account-deletion request 502s for any user who has received SES
# mail (the raw copies could never be erased — a right-to-erasure gap).
data "aws_iam_policy_document" "ecs_task_ses_inbound" {
  statement {
    sid       = "ReadWriteSesInboundEmails"
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.ses_inbound.arn}/inbound/*"]
  }
}

resource "aws_iam_role_policy" "ecs_task_ses_inbound" {
  name   = "read-ses-inbound-emails"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_ses_inbound.json
}

# --- GitHub Actions OIDC deploy role ---

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.service_name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.email_listener.arn]
  }

  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
    ]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid       = "EcsDescribeTaskDef"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-email-listener"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
