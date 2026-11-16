variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "state_bucket_name" {
  description = "Globally unique. Convention: <slug>-terraform-state-<aws-account-id>."
  type        = string
  default     = "leaco-terraform-state-851725317896"
}

variable "repository" {
  description = "Repository tag applied to the bucket."
  type        = string
  default     = "LeaCo-ai"
}
