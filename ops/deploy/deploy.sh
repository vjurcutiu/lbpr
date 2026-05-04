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
SITE_TAG="${SITE_TAG:-latest}"
DOCKER_COMPOSE="docker compose"

echo "[deploy] DOCKERHUB_USERNAME=$DOCKERHUB_USERNAME"
echo "[deploy] API_TAG=$API_TAG"
echo "[deploy] SPA_TAG=$SPA_TAG"
echo "[deploy] SITE_TAG=$SITE_TAG"

# Ensure host artifact directories exist for the narrow eval bind mounts.
# The API image still owns /app/internal/evals Python modules.
mkdir -p backend/internal/evals/jobs backend/internal/evals/results backend/internal/evals/reviews

extract_static_assets() {
  local image_ref="$1"
  local container_name="$2"
  local destination_dir="$3"
  local source_dir_in_image="$4"
  local expected_file="$5"

  echo "[deploy] Preparing static assets from $image_ref"

  if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
    echo "[deploy] Removing existing extract container ${container_name}"
    docker rm -f "${container_name}" || true
  fi

  mkdir -p "$destination_dir"
  find "$destination_dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

  docker run --name "$container_name" --rm \
    -v "$ROOT_DIR/$destination_dir:/opt/static-output" \
    "$image_ref" \
    /bin/sh -lc "mkdir -p /opt/static-output && cp -r ${source_dir_in_image}/. /opt/static-output/"

  echo "[deploy] Static assets ready at $destination_dir"
  ls -la "$destination_dir" || true

  if [[ ! -f "$destination_dir/$expected_file" ]]; then
    echo "[deploy] ERROR: $destination_dir/$expected_file is missing after extraction." >&2
    exit 1
  fi
}

extract_static_assets \
  "docker.io/${DOCKERHUB_USERNAME}/lbpr-spa:${SPA_TAG}" \
  "lbpr-spa-extract" \
  "static/spa/dist" \
  "/srv/spa/dist" \
  "index.html"

extract_static_assets \
  "docker.io/${DOCKERHUB_USERNAME}/lbpr-site:${SITE_TAG}" \
  "lbpr-site-extract" \
  "static/marketing/dist" \
  "/srv/marketing/dist" \
  "index.html"

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

echo "[deploy] Pulling image for api service"
API_IMAGE="docker.io/${DOCKERHUB_USERNAME}/lbpr-api:${API_TAG}"
docker pull "$API_IMAGE"

echo "[deploy] Using docker compose overrides: $OVERRIDES"
$DOCKER_COMPOSE $OVERRIDES ps
$DOCKER_COMPOSE $OVERRIDES up -d --remove-orphans

echo "[deploy] Forcing nginx recreate to ensure fresh static mounts..."
$DOCKER_COMPOSE $OVERRIDES up -d --no-deps --force-recreate nginx

echo "[deploy] Verifying static assets inside nginx container..."
if ! $DOCKER_COMPOSE $OVERRIDES exec nginx sh -lc 'echo "[nginx] /srv:" && ls -la /srv || true; echo "[nginx] /srv/spa/dist:" && ls -la /srv/spa/dist || true; echo "[nginx] /srv/marketing/dist:" && ls -la /srv/marketing/dist || true'; then
  echo "[deploy] WARNING: Could not list static assets inside nginx container (container may be starting or unhealthy)." >&2
fi

echo "[deploy] Testing nginx config..."
if ! $DOCKER_COMPOSE $OVERRIDES exec nginx nginx -t; then
  echo "[deploy] ERROR: nginx -t failed, showing recent nginx logs" >&2
  $DOCKER_COMPOSE $OVERRIDES logs --tail=200 nginx || true
  exit 1
fi

echo "[deploy] Reloading nginx..."
$DOCKER_COMPOSE $OVERRIDES exec nginx nginx -s reload

echo "[deploy] Done."
