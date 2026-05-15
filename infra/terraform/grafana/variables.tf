variable "grafana_url" {
  description = "Hosted Grafana URL, for example https://your-stack.grafana.net/."
  type        = string
}

variable "grafana_auth" {
  description = "Grafana service-account token or API token with permission to manage dashboards and folders."
  type        = string
  sensitive   = true
}

variable "grafana_folder_title" {
  description = "Grafana folder title that will hold the LBPR dashboards."
  type        = string
  default     = "LBPR"
}


variable "grafana_folder_uid" {
  description = "Stable Grafana folder UID for the LBPR dashboards. Keep this stable so Terraform can manage the same folder across CI runs."
  type        = string
  default     = "lbpr"
}
