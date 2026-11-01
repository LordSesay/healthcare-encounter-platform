variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type        = string
  default     = "encounter-platform"
  description = "Name prefix of every application resource (<project>-<env>-...). Permissions are scoped to this prefix."
}

variable "jenkins_role_name" {
  type        = string
  default     = "jenkins-encounter-platform-ci"
  description = "Instance role for the Jenkins EC2 host. Must NOT start with project_name, or the Terraform role could edit it."
}

variable "terraform_role_name" {
  type        = string
  default     = "terraform-encounter-platform-deployer"
  description = "Role Jenkinsfile.infra assumes to run Terraform. Must NOT start with project_name, or it could edit itself."
}

variable "state_bucket_name" {
  type    = string
  default = "lordsesay-fullstack-automation-artifacts-demo"
}

variable "lock_table_name" {
  type    = string
  default = "fullstack-automation-tf-lock"
}
