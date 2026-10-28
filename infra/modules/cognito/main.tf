variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "kms_key_arn" { type = string }
variable "secret_recovery_window_days" { type = number }

# HEP-SEC-001: machine-to-machine identity for integration engines.
# One confidential app client restricted to the client_credentials grant.

data "aws_caller_identity" "current" {}

resource "aws_cognito_user_pool" "m2m" {
  name                = "${var.project_name}-${var.environment}-m2m"
  deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  tags = { Environment = var.environment }
}

# Hosted domain is required for the /oauth2/token endpoint. The account ID
# keeps the prefix unique per region without an extra provider.
resource "aws_cognito_user_pool_domain" "m2m" {
  domain       = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.m2m.id
}

resource "aws_cognito_resource_server" "encounters" {
  identifier   = "encounters"
  name         = "Encounter API"
  user_pool_id = aws_cognito_user_pool.m2m.id

  scope {
    scope_name        = "read"
    scope_description = "Read encounters"
  }

  scope {
    scope_name        = "write"
    scope_description = "Create and change encounters"
  }
}

resource "aws_cognito_user_pool_client" "integration_engine" {
  name                                 = "${var.project_name}-${var.environment}-integration-engine"
  user_pool_id                         = aws_cognito_user_pool.m2m.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = aws_cognito_resource_server.encounters.scope_identifiers
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 60
  token_validity_units {
    access_token = "minutes"
  }
}

# Client credentials live server-side only; smoke tests and the integration
# engine read them from Secrets Manager. Never pass them to the browser build.
resource "aws_secretsmanager_secret" "m2m_client" {
  name                    = "${var.project_name}/${var.environment}/m2m-client"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_days

  tags = { Environment = var.environment }
}

resource "aws_secretsmanager_secret_version" "m2m_client" {
  secret_id = aws_secretsmanager_secret.m2m_client.id
  secret_string = jsonencode({
    client_id     = aws_cognito_user_pool_client.integration_engine.id
    client_secret = aws_cognito_user_pool_client.integration_engine.client_secret
    token_url     = "https://${aws_cognito_user_pool_domain.m2m.domain}.auth.${var.aws_region}.amazoncognito.com/oauth2/token"
    scope         = join(" ", aws_cognito_resource_server.encounters.scope_identifiers)
  })
}

output "user_pool_id" { value = aws_cognito_user_pool.m2m.id }
output "client_ids" { value = [aws_cognito_user_pool_client.integration_engine.id] }
output "read_scope" { value = "encounters/read" }
output "write_scope" { value = "encounters/write" }
output "m2m_secret_id" { value = aws_secretsmanager_secret.m2m_client.name }
