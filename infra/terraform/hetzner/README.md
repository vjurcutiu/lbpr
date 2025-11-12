# Hetzner Terraform starter (LBP-REACT)

This folder provisions a production-ready Ubuntu VM on Hetzner Cloud, attaches a firewall (22/80/443), and bootstraps Docker + Compose via **cloud-init**. It aligns with your current Docker-based deploy (`ops/deploy/docker-compose.deploy.yml`).

## What gets created

- `hcloud_server` with Ubuntu 24.04, Docker CE + docker compose plugin, and a non-root **deploy** user.
- `hcloud_firewall` allowing SSH, HTTP, HTTPS + ICMP (ping).
- Injected SSH key for access (either uploaded to Hetzner via Terraform or using an existing key).

## Prereqs

1. Create a Hetzner Cloud API token (project → *Security* → *API Tokens*, **Read & Write**).
2. Have a public SSH key ready (ed25519 preferred).
3. Terraform 1.6+ installed locally.

## How to use

```bash
cd infra/terraform/hetzner

# 1) Initialize
terraform init

# 2) Copy the example vars and edit
cp terraform.tfvars.example terraform.tfvars
# ... edit hcloud_token and ssh_public_key ...

# 3) Plan and apply
terraform plan
terraform apply -auto-approve
```

Outputs will include the server IPv4 and an SSH hint.

## Deploying the app

Your repo already includes Docker compose for deploy at `ops/deploy/docker-compose.deploy.yml`. After Terraform finishes, copy your application bundle to the server (we create `/opt/lbpr` and install Docker), then run:

```bash
ssh deploy@$(terraform output -raw server_ipv4)
# on the server:
cd /opt/lbpr
docker compose -f ops/deploy/docker-compose.deploy.yml pull
docker compose -f ops/deploy/docker-compose.deploy.yml up -d --remove-orphans
```

> Tip: Wire this into CI for full e2e deploy; see the provided GitHub Actions workflow under `.github/workflows/infra-hetzner-apply.yml`.

## Variables (most useful)

- `hcloud_token` (**required**): Hetzner Cloud API token.
- `ssh_public_key` (**required**): Your public key.
- `server_type` (default `cx22`), `location` (default `nbg1`), `image` (default `ubuntu-24.04`).
- `ssh_allowed_cidrs` (default `["0.0.0.0/0","::/0"]`) — tighten this to your IP(s) for better security.
- `deploy_user` (default `deploy`).

## Notes

- We use the official Hetzner provider (pinned to `~> 1.54`) and the HashiCorp `cloudinit` provider. Update as needed.
- The firewall allows 22/80/443; you can change the SSH port or restrict CIDRs in `variables.tf`.
- State is local by default. For team workflows, consider Terraform Cloud or an S3-compatible backend.