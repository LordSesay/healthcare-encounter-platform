variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "ecs_sg_id" { type = string }
variable "frontend_tg_arn" { type = string }
variable "backend_tg_arn" { type = string }
variable "execution_role_arn" { type = string }
variable "backend_image" { type = string }
variable "frontend_image" { type = string }
variable "alb_dns_name" { type = string }
variable "secret_arn" { type = string }
variable "desired_count" { type = number }
variable "cpu" { type = string }
variable "memory" { type = string }
variable "log_retention_days" { type = number }
variable "kms_key_arn" { type = string }

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.project_name}-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = { Environment = var.environment }
}

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}-cluster"

  tags = { Environment = var.environment }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.project_name}-${var.environment}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name  = "backend"
      image = var.backend_image
      portMappings = [{ containerPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "PORT", value = "8080" },
        { name = "CORS_ORIGIN", value = "http://${var.alb_dns_name}" },
        { name = "NODE_ENV", value = var.environment }
      ]
      secrets = [{ name = "DATABASE_URL", valueFrom = var.secret_arn }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "backend"
        }
      }
    },
    {
      name  = "frontend"
      image = var.frontend_image
      portMappings = [{ containerPort = 80, protocol = "tcp" }]
      environment = [
        { name = "REACT_APP_API_URL", value = "http://${var.alb_dns_name}" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "frontend"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name            = "${var.project_name}-${var.environment}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  desired_count   = var.desired_count

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [var.ecs_sg_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = var.frontend_tg_arn
    container_name   = "frontend"
    container_port   = 80
  }

  load_balancer {
    target_group_arn = var.backend_tg_arn
    container_name   = "backend"
    container_port   = 8080
  }
}

output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.app.name }
