data "aws_caller_identity" "current" {}

locals {
  name        = "${var.project_name}-${var.environment}"
  bucket_name = coalesce(var.artifact_bucket_name, "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-${var.aws_region}-releases")
  target_tags = merge({ Application = var.project_name, Environment = var.environment }, var.target_tags)
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = local.bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "expire-noncurrent-releases"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = var.noncurrent_version_expiration_days }
  }
}

resource "aws_iam_role" "codedeploy" {
  name               = "${local.name}-codedeploy-service"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "codedeploy.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy_attachment" "codedeploy" {
  role       = aws_iam_role.codedeploy.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole"
}

resource "aws_iam_role" "application" {
  name               = "${local.name}-application-ec2"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_instance_profile" "application" {
  name = "${local.name}-application-ec2"
  role = aws_iam_role.application.name
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.application.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "application_artifacts" {
  name   = "read-deployment-artifacts"
  role   = aws_iam_role.application.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.artifacts.arn}/releases/*" }, { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.artifacts.arn, Condition = { StringLike = { "s3:prefix" = ["releases/*"] } } }] })
}

resource "aws_iam_policy" "jenkins" {
  name   = "${local.name}-jenkins-codedeploy"
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.artifacts.arn}/releases/*" }, { Effect = "Allow", Action = ["s3:ListBucket", "s3:GetBucketVersioning"], Resource = aws_s3_bucket.artifacts.arn }, { Effect = "Allow", Action = ["codedeploy:CreateDeployment", "codedeploy:GetDeployment", "codedeploy:GetDeploymentConfig", "codedeploy:RegisterApplicationRevision"], Resource = "*" }] })
}

resource "aws_iam_role_policy_attachment" "jenkins" {
  count      = var.jenkins_role_name == null ? 0 : 1
  role       = var.jenkins_role_name
  policy_arn = aws_iam_policy.jenkins.arn
}

resource "aws_codedeploy_app" "this" {
  compute_platform = "Server"
  name             = local.name
}

resource "aws_codedeploy_deployment_group" "this" {
  app_name               = aws_codedeploy_app.this.name
  deployment_group_name  = "${local.name}-ec2"
  service_role_arn       = aws_iam_role.codedeploy.arn
  deployment_config_name = "CodeDeployDefault.OneAtATime"

  dynamic "ec2_tag_filter" {
    for_each = local.target_tags
    content {
      key   = ec2_tag_filter.key
      type  = "KEY_AND_VALUE"
      value = ec2_tag_filter.value
    }
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE"]
  }
}

resource "aws_ec2_tag" "target" {
  for_each    = var.target_instance_id == null ? {} : local.target_tags
  resource_id = var.target_instance_id
  key         = each.key
  value       = each.value
}
