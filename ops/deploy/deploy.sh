#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:-$(pwd)}"
cd "$REMOTE_DIR"

mkdir -p static/spa backend ops/deploy

# Load deployment variables if present (.deploy.env written by CI)
if [ -f ".deploy.env" ]; then
  set -a; . ./.deploy.env; set +a
fi

# Also load root .env so things like REDIS_PASSWORD are in the shell too (nice for debugging)
if [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

: "${DOCKERHUB_USERNAME:?missing}"
: "${API_TAG:?missing}"
: "${SPA_TAG:?missing}"

API_IMAGE="docker.io/${DOCKERHUB_USERNAME}/lbpr-api:${API_TAG}"
SPA_IMAGE="docker.io/${DOCKERHUB_USERNAME}/lbpr-spa:${SPA_TAG}"

echo "[deploy] Using images:"
echo "  API: ${API_IMAGE}"
echo "  SPA: ${SPA_IMAGE}"

docker pull "${API_IMAGE}" || true
docker pull "${SPA_IMAGE}" || true

echo "[deploy] Extracting SPA assets..."
docker rm -f spa_extract >/dev/null 2>&1 || true
docker create --name spa_extract "${SPA_IMAGE}" >/dev/null
rm -rf static/spa/dist
mkdir -p static/spa
docker cp spa_extract:/srv/spa/dist ./static/spa/dist
docker rm -f spa_extract >/dev/null 2>&1 || true
echo "[deploy] SPA assets ready at static/spa/dist"

# Select compose
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

# Build override list
OVERRIDES="-f docker-compose.yml -f ops/deploy/docker-compose.deploy.yml"
if [ -f docker-compose.ssl.yml ]; then
  OVERRIDES="$OVERRIDES -f docker-compose.ssl.yml"
fi
if [ -f ops/deploy/docker-compose.doppler.yml ]; then
  OVERRIDES="$OVERRIDES -f ops/deploy/docker-compose.doppler.yml"
fi

# ✅ IMPORTANT CHANGE: drop --env-file so compose auto-loads .env (with REDIS_PASSWORD)
$DC $OVERRIDES up -d --remove-orphans

echo "[deploy] Done. Current services:"
$DC ps
