variable "project_name" {
  type = string
}
variable "environment" {
  type = string
}
variable "aws_region" {
  type = string
}
variable "artifact_bucket_name" {
  type    = string
  default = null
}
variable "target_instance_id" {
  type    = string
  default = null
}
variable "jenkins_role_name" {
  type    = string
  default = null
}
variable "target_tags" {
  type    = map(string)
  default = {}
}
variable "noncurrent_version_expiration_days" {
  type    = number
  default = 90
}
