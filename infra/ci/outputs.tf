output "jenkins_role_arn" {
  value = aws_iam_role.jenkins.arn
}

output "jenkins_instance_profile_name" {
  value       = aws_iam_instance_profile.jenkins.name
  description = "Attach this to the Jenkins EC2 instance."
}

output "terraform_role_arn" {
  value = aws_iam_role.terraform.arn
}
