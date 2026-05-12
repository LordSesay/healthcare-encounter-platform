resource "aws_kms_key" "secrets" {
  description         = "KMS key for encrypting secrets and logs"
  enable_key_rotation = true

  tags = {
    Name = "${var.project_name}-kms-key"
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.project_name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.project_name}/database-url"
  description = "PostgreSQL connection string for backend ECS tasks"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = {
    Name = "${var.project_name}-database-url"
  }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
}
