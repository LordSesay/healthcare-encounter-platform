variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "fullstack-automation"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "public_subnet_1_cidr" {
  type    = string
  default = "10.0.1.0/24"
}

variable "public_subnet_2_cidr" {
  type    = string
  default = "10.0.2.0/24"
}

variable "backend_container_port" {
  type    = number
  default = 8080
}

variable "frontend_container_port" {
  type    = number
  default = 80
}

variable "db_username" {
  type      = string
  default   = "encounters_admin"
  sensitive = true
}

variable "db_password" {
  type      = string
  default   = "EncountersPass2025!"
  sensitive = true
}

variable "db_name" {
  type    = string
  default = "encounters"
}


variable "jenkins_sg_id" {
  type        = string
  description = "Security group ID of the Jenkins EC2 instance (for migration access to RDS)"
}
