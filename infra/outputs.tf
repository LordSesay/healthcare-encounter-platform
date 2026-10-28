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

output "ecs_task_definition_arn" {
  value = module.ecs.task_definition_arn
}

output "ecs_log_group_name" {
  value = module.ecs.log_group_name
}

output "ecs_network" {
  value = {
    subnets         = module.vpc.private_app_subnet_ids
    security_groups = [module.security.ecs_sg_id]
  }
}

output "m2m_secret_id" {
  value       = module.cognito.m2m_secret_id
  description = "Secrets Manager secret holding the integration-engine client credentials and token URL."
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "domain_nameservers" {
  value       = try(module.dns[0].nameservers, [])
  description = "Route 53 nameservers when optional DNS is enabled."
}

output "certificate_arn" {
  value       = try(module.dns[0].certificate_arn, null)
  description = "ACM certificate ARN when optional DNS/HTTPS is enabled."
}

output "codedeploy" {
  value = var.enable_ec2_codedeploy ? {
    artifact_bucket_name              = module.codedeploy[0].artifact_bucket_name
    application_name                  = module.codedeploy[0].application_name
    deployment_group_name             = module.codedeploy[0].deployment_group_name
    application_instance_profile_name = module.codedeploy[0].application_instance_profile_name
    jenkins_policy_arn                = module.codedeploy[0].jenkins_policy_arn
  } : null
}
