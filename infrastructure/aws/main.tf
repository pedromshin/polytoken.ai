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

  # Shared remote state (Track 1, activated 2026-08-06): bucket + lock table created
  # per REMOTE-STATE-RUNBOOK.md, local state migrated via `terraform init -migrate-state`
  # after importing the 5 ses-forwarder.tf resources (IMPORT-RUNBOOK.md). Do NOT apply
  # unless `terraform plan` shows no create/replace/destroy for live mail resources.
  backend "s3" {
    bucket         = "nauta-services-terraform-state"
    key            = "email-listener/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "nauta-services-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
