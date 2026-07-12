output "artifact_bucket_name" { value = aws_s3_bucket.artifacts.id }
output "application_name" { value = aws_codedeploy_app.this.name }
output "deployment_group_name" { value = aws_codedeploy_deployment_group.this.deployment_group_name }
output "application_instance_profile_name" { value = aws_iam_instance_profile.application.name }
output "application_role_arn" { value = aws_iam_role.application.arn }
output "jenkins_policy_arn" { value = aws_iam_policy.jenkins.arn }
