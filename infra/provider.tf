terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "lordsesay-fullstack-automation-artifacts-demo"
    region         = "us-east-1"
    dynamodb_table = "fullstack-automation-tf-lock"
    encrypt        = true
    # key is set dynamically via -backend-config="key=env/<environment>/terraform.tfstate"
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
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
