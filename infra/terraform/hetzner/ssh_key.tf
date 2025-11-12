resource "hcloud_ssh_key" "deploy" {
  count      = var.create_ssh_key ? 1 : 0
  name       = var.ssh_key_name
  public_key = var.ssh_public_key
}