terraform {
  required_version = ">= 1.6.0"

  backend "local" {}

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 4.29"
    }
  }
}
