output "server_ipv4" {
  description = "Public IPv4 of the app server."
  value       = hcloud_server.app.ipv4_address
}

output "server_name" {
  value = hcloud_server.app.name
}

output "ssh_hint" {
  value = "ssh ${var.deploy_user}@${hcloud_server.app.ipv4_address}"
}