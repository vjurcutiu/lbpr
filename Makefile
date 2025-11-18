SHELL := /bin/bash
DC ?= docker compose
PROJECT ?= lbpr

BASE := -f docker-compose.yml
SSL  := -f docker-compose.ssl.yml
DEV  := -f docker-compose.dev.yml

NET  := $(PROJECT)_appnet

.PHONY: help dev dev-down dev-logs up-dev staging up-staging prod up-prod down down-all logs reload-nginx cert-perms

help:
	@echo "Targets:"
	@echo "  dev                  - bring up local dev stack (docker-compose.dev.yml, app.localhost)"
	@echo "  dev-down             - stop local dev stack"
	@echo "  dev-logs             - follow dev logs (nginx, spa, api)"
	@echo "  up-dev               - bring up base stack (docker-compose.yml, no SSL override)"
	@echo "  staging / up-staging - bring up stack with Cloudflare SSL override"
	@echo "  prod / up-prod       - bring up stack with Cloudflare SSL override"
	@echo "  reload-nginx         - test & reload nginx with SSL override"
	@echo "  logs                 - follow logs (nginx, api) for base/prod stack"
	@echo "  down                 - stop stack (with SSL override), remove orphans"
	@echo "  down-all             - extra-aggressive down (both combos) and remove network"

# ----- Local dev stack (docker-compose.dev.yml) -----

dev:
	$(DC) -p $(PROJECT)-dev $(DEV) up -d --build

dev-down:
	$(DC) -p $(PROJECT)-dev $(DEV) down --remove-orphans

dev-logs:
	$(DC) -p $(PROJECT)-dev $(DEV) logs -f nginx spa api

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
