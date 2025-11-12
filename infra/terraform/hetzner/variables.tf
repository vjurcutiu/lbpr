variable "project_name" {
  description = "A short name prefix for all resources."
  type        = string
  default     = "lbpr"
}

variable "server_name" {
  description = "Server name (will be prefixed with project_name)."
  type        = string
  default     = "app-1"
}

variable "server_type" {
  description = "Hetzner server type (e.g., cx22, cx32, cax31)."
  type        = string
  default     = "cx22"
}

variable "location" {
  description = "Hetzner location (nbg1, fsn1, hel1 or ash)."
  type        = string
  default     = "nbg1"
}

variable "image" {
  description = "Base image to use."
  type        = string
  default     = "ubuntu-24.04"
}

variable "create_ssh_key" {
  description = "Upload the provided public key into the Hetzner project."
  type        = bool
  default     = true
}

variable "ssh_key_name" {
  description = "Name of the SSH key in Hetzner."
  type        = string
  default     = "lbpr-deploy"
}

variable "ssh_public_key" {
  description = "Public SSH key content (e.g., from id_rsa.pub or ed25519.pub)."
  type        = string
}

variable "deploy_user" {
  description = "Non-root user created on the VM with sudo & docker access."
  type        = string
  default     = "deploy"
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs allowed to reach SSH (22/tcp) on the Hetzner firewall."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "enable_ipv6" {
  description = "Enable IPv6 on the public interface."
  type        = bool
  default     = true
}