output "environment" {
  value = var.environment
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "frontend_ecr_url" {
  value = module.ecr.frontend_repo_url
}

output "backend_ecr_url" {
  value = module.ecr.backend_repo_url
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_name" {
  value = module.ecs.service_name
}

output "rds_endpoint" {
  value = module.rds.endpoint
}
