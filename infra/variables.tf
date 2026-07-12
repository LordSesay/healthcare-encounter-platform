variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "encounter-platform"
}

variable "environment" {
  type        = string
  description = "Deployment environment (dev, staging, prod)"
}

# Networking
variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

# ECS
variable "ecs_desired_count" {
  type    = number
  default = 1
}

variable "ecs_cpu" {
  type    = string
  default = "512"
}

variable "ecs_memory" {
  type    = string
  default = "1024"
}

# Ports
variable "backend_container_port" {
  type    = number
  default = 8080
}

variable "frontend_container_port" {
  type    = number
  default = 80
}

# RDS
variable "db_username" {
  type      = string
  default   = "encounters_admin"
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "db_name" {
  type    = string
  default = "encounters"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = false
}

variable "db_backup_retention" {
  type    = number
  default = 7
}

# Logging
variable "log_retention_days" {
  type    = number
  default = 7
}

# Jenkins
variable "jenkins_private_ip" {
  type    = string
  default = "172.31.46.156"
}

# Auto Scaling
variable "ecs_min_capacity" {
  type    = number
  default = 1
}

variable "ecs_max_capacity" {
  type    = number
  default = 4
}

# Optional DNS / HTTPS
variable "enable_dns" {
  type        = bool
  default     = false
  description = "Create Route 53 hosted zone, ACM certificate, and app DNS record. Leave false to serve the app from the ALB DNS name."
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Root domain for optional Route 53 and ACM resources (e.g. encounters.example.com). Required only when enable_dns is true."
}

variable "enable_https" {
  type        = bool
  default     = false
  description = "Enable HTTPS listener with ACM certificate. Requires enable_dns to be true."
}

# Optional EC2/CodeDeploy release path. ECS remains the default architecture.
variable "enable_ec2_codedeploy" {
  type        = bool
  default     = false
  description = "Provision the S3 and CodeDeploy resources for the opt-in EC2 deployment workflow."
}

variable "codedeploy_artifact_bucket_name" {
  type        = string
  default     = null
  description = "Globally unique artifact bucket name. Null derives a name from project, environment, account, and region."
}

variable "codedeploy_target_instance_id" {
  type        = string
  default     = null
  description = "Existing application EC2 instance to tag as the CodeDeploy target. Attach the output instance profile separately."
}

variable "codedeploy_target_tags" {
  type        = map(string)
  default     = {}
  description = "Additional CodeDeploy target tags. Application and Environment tags are always included."
}

variable "jenkins_role_name" {
  type        = string
  default     = null
  description = "Existing Jenkins EC2 IAM role name to receive artifact-upload and CodeDeploy permissions."
}
