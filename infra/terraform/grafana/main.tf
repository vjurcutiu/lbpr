locals {
  dashboard_files = fileset("${path.module}/dashboards", "*.json")
}

resource "grafana_folder" "lbpr" {
  uid   = var.grafana_folder_uid
  title = var.grafana_folder_title
}

resource "grafana_dashboard" "lbpr" {
  for_each = local.dashboard_files

  config_json = file("${path.module}/dashboards/${each.value}")
  folder      = grafana_folder.lbpr.id
  overwrite   = true
}
