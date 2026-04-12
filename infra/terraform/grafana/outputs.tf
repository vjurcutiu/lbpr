output "grafana_folder_uid" {
  description = "UID of the folder that contains the LBPR dashboards."
  value       = grafana_folder.lbpr.uid
}

output "dashboard_files" {
  description = "Dashboard JSON files applied by Terraform."
  value       = sort(tolist(local.dashboard_files))
}
