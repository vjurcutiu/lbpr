# --- Makefile (root) ---
# Use docker compose v2 syntax
COMPOSE := docker compose
BASE := -f docker-compose.yml
DEV := -f docker-compose.dev.yml
STACK := $(BASE) $(DEV)

export DOCKER_DEV=1

.PHONY: dev up down stop logs rebuild nuke sh-api sh-nginx ps lint

## Start dev stack (Nginx → Vite HMR, FastAPI --reload)
dev: ## same as `up` (alias)
	$(MAKE) up

up:
	$(COMPOSE) $(STACK) up --build

## Stop and remove dev containers (keep volumes & images)
down:
	$(COMPOSE) $(STACK) down

## Stop containers without removing
stop:
	$(COMPOSE) $(STACK) stop

## Follow logs for all services
logs:
	$(COMPOSE) $(STACK) logs -f

## Rebuild images without using cache and restart
rebuild:
	$(COMPOSE) $(STACK) build --no-cache
	$(COMPOSE) $(STACK) up -d
	$(COMPOSE) $(STACK) logs -f

## HARD RESET: stop and remove everything incl. volumes
nuke:
	$(COMPOSE) $(STACK) down -v --remove-orphans

## Shells inside containers
sh-api:
	$(COMPOSE) $(STACK) exec api sh

sh-nginx:
	$(COMPOSE) $(STACK) exec nginx sh

## Quick status
ps:
	$(COMPOSE) $(STACK) ps
