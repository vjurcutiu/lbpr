data "cloudinit_config" "user_data" {
  gzip          = false
  base64_encode = false

  part {
    filename     = "cloud-init.yaml"
    content_type = "text/cloud-config"
    content = templatefile("${path.module}/cloud-init.yaml", {
      deploy_user         = var.deploy_user
      ssh_authorized_key  = var.ssh_public_key
    })
  }
}