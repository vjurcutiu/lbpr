\
SHELL := /bin/bash
DC ?= docker compose
BASE := -f docker-compose.yml
SSL  := -f docker-compose.ssl.yml

.PHONY: help dev up-dev staging up-staging prod up-prod down logs reload-nginx cert-perms

help:
\t@echo "Targets:"
\t@echo "  dev / up-dev        - bring up stack (no SSL override)"
\t@echo "  staging / up-staging- bring up stack with Cloudflare SSL override"
\t@echo "  prod / up-prod      - bring up stack with Cloudflare SSL override"
\t@echo "  reload-nginx        - test & reload nginx with SSL override"
\t@echo "  logs                - follow logs (nginx, api)"
\t@echo "  down                - stop all containers"

dev up-dev:
\t$(DC) $(BASE) up -d --build

staging up-staging:
\t$(DC) $(BASE) $(SSL) up -d --build

prod up-prod:
\t$(DC) $(BASE) $(SSL) up -d --build

down:
\t$(DC) $(BASE) $(SSL) down

logs:
\t$(DC) $(BASE) $(SSL) logs -f nginx api || $(DC) $(BASE) logs -f nginx api

reload-nginx:
\t$(DC) $(BASE) $(SSL) exec nginx nginx -t && $(DC) $(BASE) $(SSL) exec nginx nginx -s reload

cert-perms:
\tchmod 600 ops/certs/cf-origin/*.key || true
