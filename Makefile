# --- Makefile (root) ---
# Nice, explicit variables
COMPOSE        ?= docker compose
BASE_YML       := -f docker-compose.yml
DEV_YML        := -f docker-compose.dev.yml
TEST_YML       := -f backend/docker-compose.test.yml

# MODE can be "prod" (default) or "dev"
MODE           ?= prod
ifeq ($(MODE),dev)
STACK          := $(BASE_YML) $(DEV_YML)
else
STACK          := $(BASE_YML)
endif

# Frontend build config (no Node needed on host)
SPA_DIR        := static/spa
NODE_IMAGE     ?= node:20-alpine
PNPM_FLAGS     ?= --frozen-lockfile

# Misc
.SILENT:
.PHONY: help up down stop logs rebuild nuke ps \
        dev prod-up prod-logs prod-down spa-build \
        sh-api sh-nginx test test-build test-run test-down test-clean-build test-e2e

help:
	echo ""
	echo "Targets:"
	echo "  up             Build SPA + bring stack up (default MODE=$(MODE))"
	echo "  down           Stop & remove stack (keeps volumes/images)"
	echo "  logs           Follow logs"
	echo "  rebuild        Rebuild images (no cache) and restart"
	echo "  nuke           HARD reset: down -v --remove-orphans"
	echo "  ps             Show status"
	echo "  dev            Alias for 'make up MODE=dev'"
	echo "  spa-build      Build SPA using $(NODE_IMAGE)"
	echo "  sh-api         Shell into API container"
	echo "  sh-nginx       Shell into Nginx container"
	echo ""
	echo "Environment:"
	echo "  MODE=prod|dev  (default prod)"
	echo ""

# ===== Core flows =====

# On servers: `make up` (MODE defaults to prod)
up: spa-build
	$(COMPOSE) $(STACK) up -d --build
	$(COMPOSE) $(STACK) ps

down:
	$(COMPOSE) $(STACK) down

stop:
	$(COMPOSE) $(STACK) stop

logs:
	$(COMPOSE) $(STACK) logs -f

rebuild:
	$(COMPOSE) $(STACK) build --no-cache --pull
	$(COMPOSE) $(STACK) up -d
	$(COMPOSE) $(STACK) logs -f

nuke:
	$(COMPOSE) $(STACK) down -v --remove-orphans

ps:
	$(COMPOSE) $(STACK) ps

# ===== SPA build (runs in container; no Node on host) =====
spa-build:
	# Build the SPA into $(SPA_DIR)/dist so Nginx can serve /srv/spa/dist
	# Run pnpm in CI mode to avoid TTY prompts
	docker run --rm \
	  -e CI=true \
	  -e NPM_CONFIG_FUND=false \
	  -e NPM_CONFIG_AUDIT=false \
	  -v "$$(pwd)/$(SPA_DIR):/app" \
	  -w /app $(NODE_IMAGE) \
	  -v "$$HOME/.pnpm-store:/root/.local/share/pnpm/store" \
	  sh -lc 'corepack enable && corepack prepare pnpm@latest --activate && pnpm install $(PNPM_FLAGS) --prefer-offline && pnpm build'
	# Sanity check: index.html must exist
	test -f "$(SPA_DIR)/dist/index.html" || (echo "ERROR: $(SPA_DIR)/dist/index.html not found"; exit 1)


# ===== Convenience aliases =====
dev:
	$(MAKE) up MODE=dev

prod-up:
	$(MAKE) up MODE=prod

prod-logs:
	$(MAKE) logs MODE=prod

prod-down:
	$(MAKE) down MODE=prod

# ===== Shells =====
sh-api:
	$(COMPOSE) $(STACK) exec api sh || true

sh-nginx:
	$(COMPOSE) $(STACK) exec nginx sh || true

# ===== Tests via compose (kept from your original workflow) =====
test-build:
	$(COMPOSE) $(TEST_YML) build api-test

test-clean-build:
	$(COMPOSE) $(TEST_YML) build --no-cache --pull api-test

test:
	$(MAKE) test-build
	if [ -z "$(ARGS)" ]; then \
	  $(COMPOSE) $(TEST_YML) run --rm api-test ; \
	else \
	  $(COMPOSE) $(TEST_YML) run --rm api-test sh -lc "pytest $(ARGS)"; \
	fi

test-run: test-build
	$(COMPOSE) $(TEST_YML) run --rm api-test sh -lc "pytest $(ARGS)"

test-down:
	$(COMPOSE) $(TEST_YML) down -v --remove-orphans

test-e2e:
	docker compose -f docker-compose.playwright.yml run --rm playwright
