-include .ai-tools/ai-zip.mk

SHELL := /bin/bash
DC ?= docker compose
PROJECT ?= lbpr

BASE := -f docker-compose.yml
SSL  := -f docker-compose.ssl.yml
DEV  := -f docker-compose.dev.yml

NET  := $(PROJECT)_appnet

# Load local-only secrets/tokens (not committed)
# Create a .env.local file at repo root (gitignored) with:
#   DOPPLER_PROJECT=lbpr
#   DOPPLER_CONFIG=dev
#   DOPPLER_TOKEN_SPA=dp.st.dev.xxxxxx
#   DOPPLER_TOKEN_API=dp.st.dev.yyyyyy
-include .env.local
export

.PHONY: help dev dev-down dev-logs dev-logs-api dev-logs-spa dev-logs-nginx dev-magic-link up-dev staging up-staging prod up-prod down down-all logs reload-nginx cert-perms doppler-dev-env doppler-check synczip synczip-working telemetry-seed grafana-init grafana-plan grafana-apply git-hooks-install git-hooks-uninstall

help:
	@echo "Targets:"
	@echo "  dev                  - bring up local dev stack (docker-compose.dev.yml, app.localhost)"
	@echo "  dev-down             - stop local dev stack"
	@echo "  dev-logs             - follow dev logs (nginx, spa, api)"
	@echo "  dev-logs-api         - follow dev logs (api only)"
	@echo "  dev-logs-spa         - follow dev logs (spa only)"
	@echo "  dev-logs-nginx       - follow dev logs (nginx only)"
	@echo "  dev-magic-link       - generate a magic login link for a phone number (runs inside api container)"
	@echo "  up-dev               - bring up base stack (docker-compose.yml, no SSL override)"
	@echo "  staging / up-staging - bring up stack with Cloudflare SSL override"
	@echo "  prod / up-prod       - bring up stack with Cloudflare SSL override"
	@echo "  reload-nginx         - test & reload nginx with SSL override"
	@echo "  logs                 - follow logs (nginx, api) for base/prod stack"
	@echo "  down                 - stop stack (with SSL override), remove orphans"
	@echo "  down-all             - extra-aggressive down (both combos) and remove network"
	@echo ""
	@echo "Doppler:"
	@echo "  doppler-dev-env      - generate static/spa/.env + backend/.env from Doppler (dev)"
	@echo ""
	@echo "Local setup (once):"
	@echo "  1) Install Doppler CLI"
	@echo "  2) Create .env.local with DOPPLER_* values (see comment at top)"
	@echo ""
	@echo "Admin helpers (Option A):"
	@echo "  make dev-magic-link PHONE=+40712345678 [BASE_URL=http://app.localhost] [RETURN_TO=/files] [TTL_SECONDS=86400]"
	@echo ""
	@echo "Telemetry:"
	@echo "  make telemetry-seed       - drive in-process seed flows and flush business metrics to Grafana"
	@echo "  make grafana-init         - terraform init for Grafana dashboards as code"
	@echo "  make grafana-plan         - terraform plan for Grafana dashboards as code"
	@echo "  make grafana-apply        - terraform apply for Grafana dashboards as code"
	@echo ""
	@echo "Git hooks:"
	@echo "  make git-hooks-install    - enable repo-managed hooks from .githooks"
	@echo "  make git-hooks-uninstall  - stop using repo-managed hooks from .githooks"

# ----- Doppler (local dev) -----

doppler-check:
	@command -v doppler >/dev/null 2>&1 || (echo "ERROR: Doppler CLI not installed (install doppler and try again)"; exit 1)
	@test -n "$(DOPPLER_PROJECT)" || (echo "ERROR: DOPPLER_PROJECT missing (set in .env.local)"; exit 1)
	@test -n "$(DOPPLER_CONFIG)" || (echo "ERROR: DOPPLER_CONFIG missing (set in .env.local, e.g. dev)"; exit 1)
	@test -n "$(DOPPLER_TOKEN_SPA)" || (echo "ERROR: DOPPLER_TOKEN_SPA missing (set in .env.local)"; exit 1)
	@test -n "$(DOPPLER_TOKEN_API)" || (echo "ERROR: DOPPLER_TOKEN_API missing (set in .env.local)"; exit 1)

doppler-dev-env:
	powershell -ExecutionPolicy Bypass -File ops/doppler_dev.ps1


# ----- Local dev stack (docker-compose.dev.yml) -----

dev: doppler-dev-env
	$(DC) -p $(PROJECT)-dev $(DEV) up -d --build

dev-down:
	$(DC) -p $(PROJECT)-dev $(DEV) down --remove-orphans

dev-logs:
	$(DC) -p $(PROJECT)-dev $(DEV) logs -f nginx spa api

dev-logs-api:
	$(DC) -p $(PROJECT)-dev $(DEV) logs -f api

dev-logs-spa:
	$(DC) -p $(PROJECT)-dev $(DEV) logs -f spa

dev-logs-nginx:
	$(DC) -p $(PROJECT)-dev $(DEV) logs -f nginx

# ----- Admin: magic link provisioning (runs inside container) -----

dev-magic-link:
	@test -n "$(PHONE)" || (echo "Usage: make dev-magic-link PHONE=+40712345678 [BASE_URL=http://app.localhost] [RETURN_TO=/files] [TTL_SECONDS=86400]"; exit 1)
	$(DC) -p $(PROJECT)-dev $(DEV) exec api sh -lc 'python admin_magic_link.py --phone "$(PHONE)" $(if $(BASE_URL),--base-url "$(BASE_URL)",) $(if $(RETURN_TO),--return-to "$(RETURN_TO)",) $(if $(TTL_SECONDS),--ttl-seconds "$(TTL_SECONDS)",)'

telemetry-seed:
	$(DC) -p $(PROJECT)-dev $(DEV) exec api sh -lc 'PYTHONPATH=/app python scripts/seed_telemetry.py'

# ----- Base / prod-style stack (docker-compose.yml) -----

up-dev:
	$(DC) -p $(PROJECT) $(BASE) up -d --build

staging up-staging:
	$(DC) -p $(PROJECT) $(BASE) $(SSL) up -d --build

prod up-prod:
	$(DC) -p $(PROJECT) $(BASE) $(SSL) up -d --build

down:
	$(DC) -p $(PROJECT) $(BASE) $(SSL) down --remove-orphans

# In case the stack was started previously without the SSL override (or vice versa),
# this target brings both combos down and then removes the project network if it lingers.
down-all:
	-$(DC) -p $(PROJECT) $(BASE) $(SSL) down --remove-orphans
	-$(DC) -p $(PROJECT) $(BASE) down --remove-orphans
	-docker network rm $(NET)

logs:
	$(DC) -p $(PROJECT) $(BASE) $(SSL) logs -f nginx api || $(DC) -p $(PROJECT) $(BASE) logs -f nginx api

reload-nginx:
	$(DC) -p $(PROJECT) $(BASE) $(SSL) exec nginx nginx -t && $(DC) -p $(PROJECT) $(BASE) $(SSL) exec nginx nginx -s reload

cert-perms:
	chown root:root ops/certs/cf-origin/*.pem || true
	chmod 644      ops/certs/cf-origin/*.pem || true
	chown root:101 ops/certs/cf-origin/*.key || true
	chmod 640      ops/certs/cf-origin/*.key || true

synczip: ai-synczip

synczip-working: ai-synczip-working

grafana-init:
	cd infra/terraform/grafana && terraform init

grafana-plan:
	cd infra/terraform/grafana && terraform plan

grafana-apply:
	cd infra/terraform/grafana && terraform apply

git-hooks-install:
	@mkdir -p .githooks
	@chmod +x .githooks/post-commit 2>/dev/null || true
	@git config core.hooksPath .githooks
	@echo "Git hooks enabled via .githooks"

git-hooks-uninstall:
	@current_hooks_path="$$(git config --get core.hooksPath || true)"; \
	if [ "$$current_hooks_path" = ".githooks" ]; then \
		git config --unset core.hooksPath; \
		echo "Git hooks disabled for .githooks"; \
	else \
		echo "core.hooksPath is not set to .githooks; nothing changed"; \
	fi
