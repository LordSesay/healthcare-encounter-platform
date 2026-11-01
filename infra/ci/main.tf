data "aws_caller_identity" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = var.aws_region
  prefix  = var.project_name
}

# ── Jenkins EC2 instance role ────────────────────────────────────────────────
# Replaces the static `aws-credentials` access key. The AWS CLI inside the
# Jenkins container gets short-lived credentials from instance metadata.

data "aws_iam_policy_document" "jenkins_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "jenkins" {
  name                 = var.jenkins_role_name
  description          = "Jenkins EC2 host: app deploys to ECR/ECS and assuming the Terraform deployer role"
  assume_role_policy   = data.aws_iam_policy_document.jenkins_trust.json
  max_session_duration = 3600
}

resource "aws_iam_instance_profile" "jenkins" {
  name = var.jenkins_role_name
  role = aws_iam_role.jenkins.name
}

resource "aws_iam_role_policy" "jenkins_app_deploy" {
  name   = "app-deploy"
  role   = aws_iam_role.jenkins.id
  policy = data.aws_iam_policy_document.jenkins_app_deploy.json
}

# ── Terraform deployer role ──────────────────────────────────────────────────
# Only the Jenkins role can assume it, and Jenkinsfile.infra is the only
# pipeline that does. Keeping it separate means an app deploy never holds
# the broad permissions Terraform needs.

data "aws_iam_policy_document" "terraform_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.jenkins.arn]
    }
  }
}

resource "aws_iam_role" "terraform" {
  name                 = var.terraform_role_name
  description          = "Assumed by Jenkinsfile.infra to plan/apply the encounter platform stack"
  assume_role_policy   = data.aws_iam_policy_document.terraform_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "terraform_deploy" {
  name   = "terraform-deploy"
  role   = aws_iam_role.terraform.id
  policy = data.aws_iam_policy_document.terraform_deploy.json
}
