terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Uncomment once the state bucket + lock table exist — see REMOTE-STATE-RUNBOOK.md
  # (create bucket/lock, then `terraform init -migrate-state`). Do NOT apply before the
  # full stack is confirmed in state (`terraform plan` shows no creates for live resources).
  # backend "s3" {
  #   bucket         = "nauta-services-terraform-state"
  #   key            = "email-listener/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "nauta-services-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
