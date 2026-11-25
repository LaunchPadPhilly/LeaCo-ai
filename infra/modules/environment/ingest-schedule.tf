# Hourly incremental document sync (Play 14 section L, ADR 0003).
#
# EventBridge Scheduler starts `scripts/ingest-documents.ts` as a one-off Fargate task in
# the mcp family. The task definition ARN has no revision, so every run uses the latest
# ACTIVE revision, which is the one CI registered on the last deploy. The schedule never
# passes --force, and the sync's own lock (a partial unique index) stops runs overlapping.
#
# Everything here exists only when ingest_schedule_enabled. The SNS topic and the three
# alarms exist only when ingest_alert_email is also set (never committed; export
# TF_VAR_ingest_alert_email before planning).

locals {
  ingest_enabled  = var.ingest_schedule_enabled
  ingest_alerting = var.ingest_schedule_enabled && var.ingest_alert_email != null && var.ingest_alert_email != ""
  ingest_name     = "${var.name_prefix}-ingest"

  # Family ARN without a revision: RunTask resolves it to the latest ACTIVE revision.
  mcp_family_arn = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.mcp_service_name}"

  ingest_metric_namespace = "${var.name_prefix}/ingest"
}

# ------------------------------------------------------------- dead-letter queue
# Receives the scheduler's RunTask call when it still fails after retries (for example
# a missing IAM permission or an exhausted Fargate capacity).
resource "aws_sqs_queue" "ingest_dlq" {
  count                     = local.ingest_enabled ? 1 : 0
  name                      = "${local.ingest_name}-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
  tags                      = local.common_tags
}

# ------------------------------------------------------------- scheduler role
resource "aws_iam_role" "ingest_scheduler" {
  count = local.ingest_enabled ? 1 : 0
  name  = "${local.ingest_name}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "ingest_scheduler" {
  count = local.ingest_enabled ? 1 : 0
  name  = "${local.ingest_name}-run-task"
  role  = aws_iam_role.ingest_scheduler[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunIngestTaskInThisCluster"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = [local.mcp_family_arn, "${local.mcp_family_arn}:*"]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        Sid      = "TagTheTask"
        Effect   = "Allow"
        Action   = ["ecs:TagResource"]
        Resource = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task/${local.cluster_name}/*"
        Condition = {
          StringEquals = { "ecs:CreateAction" = "RunTask" }
        }
      },
      {
        Sid      = "PassTheTaskRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = compact([aws_iam_role.execution.arn, var.create_task_role ? aws_iam_role.task[0].arn : ""])
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "DeadLetter"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.ingest_dlq[0].arn
      }
    ]
  })
}

# ------------------------------------------------------------------- schedule
resource "aws_scheduler_schedule" "ingest" {
  count       = local.ingest_enabled ? 1 : 0
  name        = local.ingest_name
  description = "Incremental Dropbox document sync (scripts/ingest-documents.ts) in the mcp family."

  schedule_expression          = var.ingest_schedule_expression
  schedule_expression_timezone = "UTC"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.this.arn
    role_arn = aws_iam_role.ingest_scheduler[0].arn

    ecs_parameters {
      task_definition_arn     = local.mcp_family_arn
      launch_type             = "FARGATE"
      task_count              = 1
      group                   = "scheduled-ingest"
      enable_ecs_managed_tags = true
      tags                    = { Purpose = "scheduled-ingest" }

      network_configuration {
        subnets          = var.service_subnet_ids
        security_groups  = [aws_security_group.mcp_task.id]
        assign_public_ip = true # no NAT: public IP reaches ECR, Secrets Manager and Dropbox
      }
    }

    # For an ECS target, the input is the RunTask overrides.
    input = jsonencode({
      containerOverrides = [{
        name    = "mcp"
        command = ["node_modules/.bin/tsx", "scripts/ingest-documents.ts"]
      }]
    })

    retry_policy {
      maximum_event_age_in_seconds = 1800
      maximum_retry_attempts       = 3
    }

    dead_letter_config {
      arn = aws_sqs_queue.ingest_dlq[0].arn
    }
  }
}

# ------------------------------------------------------------- run metrics
# Built from the one JSON line per run that scripts/ingest-documents.ts prints.
resource "aws_cloudwatch_log_metric_filter" "ingest_runs" {
  count          = local.ingest_enabled ? 1 : 0
  name           = "${local.ingest_name}-runs"
  log_group_name = aws_cloudwatch_log_group.mcp.name
  pattern        = "{ $.event = \"ingest.run\" }"

  metric_transformation {
    name      = "IngestRuns"
    namespace = local.ingest_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "ingest_failures" {
  count          = local.ingest_enabled ? 1 : 0
  name           = "${local.ingest_name}-failures"
  log_group_name = aws_cloudwatch_log_group.mcp.name
  pattern        = "{ $.event = \"ingest.run\" && ($.outcome = \"FAILED\" || $.outcome = \"PARTIAL\") }"

  metric_transformation {
    name      = "IngestFailures"
    namespace = local.ingest_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

# ------------------------------------------------------------------- alerts
resource "aws_sns_topic" "ingest_alerts" {
  count = local.ingest_alerting ? 1 : 0
  name  = "${local.ingest_name}-alerts"
  tags  = local.common_tags
}

resource "aws_sns_topic_subscription" "ingest_alerts_email" {
  count     = local.ingest_alerting ? 1 : 0
  topic_arn = aws_sns_topic.ingest_alerts[0].arn
  protocol  = "email"
  endpoint  = var.ingest_alert_email
}

resource "aws_cloudwatch_metric_alarm" "ingest_failed" {
  count               = local.ingest_alerting ? 1 : 0
  alarm_name          = "${local.ingest_name}-failed"
  alarm_description   = "A document sync failed, or some files could not be read. Play 14 section L."
  namespace           = local.ingest_metric_namespace
  metric_name         = "IngestFailures"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ingest_alerts[0].arn]
  ok_actions          = [aws_sns_topic.ingest_alerts[0].arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ingest_missed" {
  count               = local.ingest_alerting ? 1 : 0
  alarm_name          = "${local.ingest_name}-missed"
  alarm_description   = "No document sync has logged for three hours: the schedule is off or tasks are not starting. Play 14 section L."
  namespace           = local.ingest_metric_namespace
  metric_name         = "IngestRuns"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.ingest_alerts[0].arn]
  ok_actions          = [aws_sns_topic.ingest_alerts[0].arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ingest_dlq" {
  count               = local.ingest_alerting ? 1 : 0
  alarm_name          = "${local.ingest_name}-dlq"
  alarm_description   = "The scheduler could not start the document sync task after retries. Play 14 section L."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.ingest_dlq[0].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ingest_alerts[0].arn]
  ok_actions          = [aws_sns_topic.ingest_alerts[0].arn]
  tags                = local.common_tags
}
