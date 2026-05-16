variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "database_url" { type = string }

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "secrets" {
  description         = "KMS key for ${var.environment} secrets"
  enable_key_rotation = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowRootAccount"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.aws_region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"
          }
        }
      }
    ]
  })

  tags = { Name = "${var.project_name}-${var.environment}-kms", Environment = var.environment }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.project_name}-${var.environment}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.project_name}/${var.environment}/database-url"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 0

  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = var.database_url
}

output "secret_arn" { value = aws_secretsmanager_secret.database_url.arn }
output "kms_key_arn" { value = aws_kms_key.secrets.arn }
