module "vpc" {
  source       = "./modules/vpc"
  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
  aws_region   = var.aws_region
}

module "security" {
  source                  = "./modules/security"
  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.vpc.vpc_id
  backend_container_port  = var.backend_container_port
  frontend_container_port = var.frontend_container_port
  jenkins_private_ip      = var.jenkins_private_ip
}

module "ecr" {
  source       = "./modules/ecr"
  project_name = var.project_name
  environment  = var.environment
}

module "dns" {
  source       = "./modules/dns"
  project_name = var.project_name
  environment  = var.environment
  domain_name  = var.domain_name
}

module "alb" {
  source                  = "./modules/alb"
  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.vpc.vpc_id
  public_subnet_ids       = module.vpc.public_subnet_ids
  alb_sg_id               = module.security.alb_sg_id
  frontend_container_port = var.frontend_container_port
  backend_container_port  = var.backend_container_port
  certificate_arn         = module.dns.certificate_arn
  enable_https            = var.enable_https
}

# Route 53 A record pointing domain to ALB
resource "aws_route53_record" "app" {
  zone_id = module.dns.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}

module "rds" {
  source              = "./modules/rds"
  project_name        = var.project_name
  environment         = var.environment
  subnet_ids          = module.vpc.private_db_subnet_ids
  rds_sg_id           = module.security.rds_sg_id
  db_name             = var.db_name
  db_username         = var.db_username
  db_password         = var.db_password
  instance_class      = var.db_instance_class
  allocated_storage   = var.db_allocated_storage
  multi_az            = var.db_multi_az
  deletion_protection = var.db_deletion_protection
  backup_retention    = var.db_backup_retention
}

module "secrets" {
  source       = "./modules/secrets"
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
  database_url = module.rds.database_url
}

module "iam" {
  source       = "./modules/iam"
  project_name = var.project_name
  environment  = var.environment
  secrets_arn  = module.secrets.secret_arn
  kms_key_arn  = module.secrets.kms_key_arn
}

module "ecs" {
  source                 = "./modules/ecs"
  project_name           = var.project_name
  environment            = var.environment
  aws_region             = var.aws_region
  private_app_subnet_ids = module.vpc.private_app_subnet_ids
  ecs_sg_id              = module.security.ecs_sg_id
  frontend_tg_arn        = module.alb.frontend_tg_arn
  backend_tg_arn         = module.alb.backend_tg_arn
  execution_role_arn     = module.iam.execution_role_arn
  backend_image          = "${module.ecr.backend_repo_url}:latest"
  frontend_image         = "${module.ecr.frontend_repo_url}:latest"
  alb_dns_name           = module.alb.alb_dns_name
  secret_arn             = module.secrets.secret_arn
  desired_count          = var.ecs_desired_count
  cpu                    = var.ecs_cpu
  memory                 = var.ecs_memory
  log_retention_days     = var.log_retention_days
  kms_key_arn            = module.secrets.kms_key_arn
  min_capacity           = var.ecs_min_capacity
  max_capacity           = var.ecs_max_capacity
}
