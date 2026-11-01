terraform {
  required_version = ">= 1.5.0"

  # Same state bucket and lock table as the application stack, but its own key.
  # This root is applied by an administrator, never by Jenkins: a pipeline must
  # not be able to change its own permissions. The Terraform deployer role is
  # only granted state access under env/*, so it cannot read or rewrite this state.
  backend "s3" {
    bucket         = "lordsesay-fullstack-automation-artifacts-demo"
    key            = "ci/jenkins-iam/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "fullstack-automation-tf-lock"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      Component = "ci-iam"
      ManagedBy = "terraform"
    }
  }
}
