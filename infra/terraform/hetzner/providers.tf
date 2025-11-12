variable "hcloud_token" {
  description = "Hetzner Cloud API token with read/write permissions."
  type        = string
  sensitive   = true
}

provider "hcloud" {
  token = var.hcloud_token
}