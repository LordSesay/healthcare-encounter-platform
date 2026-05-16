variable "project_name" { type = string }
variable "environment" { type = string }

resource "aws_ecr_repository" "frontend" {
  name         = "${var.project_name}-${var.environment}-frontend"
  force_delete = true

  tags = { Environment = var.environment }
}

resource "aws_ecr_repository" "backend" {
  name         = "${var.project_name}-${var.environment}-backend"
  force_delete = true

  tags = { Environment = var.environment }
}

output "frontend_repo_url" { value = aws_ecr_repository.frontend.repository_url }
output "backend_repo_url" { value = aws_ecr_repository.backend.repository_url }
