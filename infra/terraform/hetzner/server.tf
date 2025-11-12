resource "hcloud_server" "app" {
  name        = "${var.project_name}-${var.server_name}"
  image       = var.image
  server_type = var.server_type
  location    = var.location

  # Attach firewall
  firewall_ids = [hcloud_firewall.main.id]

  # Public networking (IPv4 + optional IPv6)
  public_net {
    ipv4_enabled = true
    ipv6_enabled = var.enable_ipv6
  }

  # Inject SSH keys (if created via Terraform)
  ssh_keys = var.create_ssh_key ? [hcloud_ssh_key.deploy[0].name] : []

  user_data = data.cloudinit_config.user_data.rendered
}