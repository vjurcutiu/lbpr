# --- Makefile (root) ---
# Use docker compose v2 syntax
COMPOSE := docker compose
BASE := -f docker-compose.yml
DEV := -f docker-compose.dev.yml
STACK := $(BASE) $(DEV)

# Test stack file (lives in backend/)
TEST := -f backend/docker-compose.test.yml

export DOCKER_DEV=1

.PHONY: dev up down stop logs rebuild nuke sh-api sh-nginx ps \
        test test-build test-run test-down test-sh test-clean-build

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


# ===== Tests via docker compose =====
# backend/docker-compose.test.yml defines service: api-test

## Build the api-test image (builds Dockerfile --target test)
test-build:
	$(COMPOSE) $(TEST) build api-test

## Force a fresh rebuild of the test image (useful after Dockerfile/req changes)
test-clean-build:
	$(COMPOSE) $(TEST) build --no-cache --pull api-test

## Run tests (build first so we always have the test stage image)
## Add extra pytest args with ARGS="..."
## Example: make test ARGS="tests/api/test_sessions.py -k login -q"
test: test-build
	@if [ -z "$(ARGS)" ]; then \
	  $(COMPOSE) $(TEST) run --rm api-test ; \
	else \
	  $(COMPOSE) $(TEST) run --rm api-test sh -lc "pytest $(ARGS)"; \
	fi

## Run tests with a fully custom pytest invocation (always overrides CMD)
## Example: make test-run ARGS="-x -q tests/"
test-run: test-build
	$(COMPOSE) $(TEST) run --rm api-test sh -lc "pytest $(ARGS)"

## Open a shell in the test container (handy for debugging env/issues)
test-sh: test-build
	$(COMPOSE) $(TEST) run --rm api-test sh

## Clean up any test containers/networks/volumes created by the test stack
test-down:
	$(COMPOSE) $(TEST) down -v --remove-orphans

test-e2e:
	docker compose -f docker-compose.playwright.yml run --rm playwright