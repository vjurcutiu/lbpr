#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$ROOT_DIR"

echo "[deploy] Using project root: $ROOT_DIR"

if [[ -f .deploy.env ]]; then
  echo "[deploy] Loading .deploy.env"
  # shellcheck disable=SC1091
  source .deploy.env
fi

if [[ -z "${DOCKERHUB_USERNAME:-}" ]]; then
  echo "[deploy] DOCKERHUB_USERNAME not set; this is required for deploy.sh" >&2
  exit 1
fi

API_TAG="${API_TAG:-latest}"
SPA_TAG="${SPA_TAG:-latest}"

echo "[deploy] DOCKERHUB_USERNAME=$DOCKERHUB_USERNAME"
echo "[deploy] API_TAG=$API_TAG"
echo "[deploy] SPA_TAG=$SPA_TAG"

DOCKER_COMPOSE="docker compose"

SPACONTAINER="lbpr-spa-extract"

echo "[deploy] Preparing SPA static assets from image docker.io/${DOCKERHUB_USERNAME}/lbpr-spa:${SPA_TAG}"

if $DOCKER_COMPOSE ps -a --format '{{.Name}}' | grep -q "^${SPACONTAINER}$"; then
  echo "[deploy] Removing existing SPA extract container ${SPACONTAINER}"
  $DOCKER_COMPOSE rm -f "${SPACONTAINER}" || true
fi

mkdir -p static/spa

echo "[deploy] Running SPA extract container..."
docker run --name "${SPACONTAINER}" --rm   -v "$ROOT_DIR/static/spa:/opt/spa-output"   "docker.io/${DOCKERHUB_USERNAME}/lbpr-spa:${SPA_TAG}"   /bin/sh -lc 'cp -r /opt/spa/dist/* /opt/spa-output/'

echo "[deploy] SPA assets ready at static/spa/dist"

OVERRIDES="-f docker-compose.yml -f ops/deploy/docker-compose.deploy.yml"

if [[ -f docker-compose.ssl.yml ]]; then
  echo "[deploy] SSL override docker-compose.ssl.yml found; adding to OVERRIDES"
  OVERRIDES="$OVERRIDES -f docker-compose.ssl.yml"
fi

if [[ "${DOPPLER_ENABLED:-0}" == "1" ]]; then
  if [[ -f ops/deploy/docker-compose.doppler.yml ]]; then
    echo "[deploy] Enabling Doppler override (project=${DOPPLER_PROJECT:-}, config=${DOPPLER_CONFIG:-})."
    OVERRIDES="$OVERRIDES -f ops/deploy/docker-compose.doppler.yml"
  else
    echo "[deploy] WARNING: DOPPLER_ENABLED=1 but ops/deploy/docker-compose.doppler.yml not found; skipping Doppler override."
  fi
fi

echo "[deploy] Pulling images for api service"
API_IMAGE="docker.io/${DOCKERHUB_USERNAME}/lbpr-api:${API_TAG}"
docker pull "$API_IMAGE"

echo "[deploy] Using docker compose overrides: $OVERRIDES"
$DOCKER_COMPOSE $OVERRIDES up -d --remove-orphans

echo "[deploy] Done."
