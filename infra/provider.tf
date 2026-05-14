terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "lordsesay-fullstack-automation-artifacts-demo"
    key            = "terraform/state/terraform.tfstate"
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
}
