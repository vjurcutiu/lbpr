# Hetzner CI/CD — Build, Push, Deploy

This wires your existing Docker builds to a **Hetzner** server. On pushes to `main`:
1) Build and push images to Docker Hub:
   - `docker.io/<DOCKERHUB_USERNAME>/lbpr-api:sha-<short>`
   - `docker.io/<DOCKERHUB_USERNAME>/lbpr-spa:sha-<short>`
2) SSH to the server, extract SPA assets from the `lbpr-spa` image into `./static/spa/dist`,
3) `docker compose up` with an override that points the API service to the built image.

## Required GitHub Secrets

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `HETZNER_HOST` (e.g., `95.***.***.***`)
- `HETZNER_USER` (e.g., `root` or your deploy user)
- `HETZNER_SSH_KEY` (private key contents for the user above)
- `HETZNER_SSH_PORT` (optional, default `22`)
- `REMOTE_DIR` (optional, default `/opt/lbpr` on the server)

### App secrets
These are *not* committed — CI writes them to the server on each deploy:

- `SERVER_ROOT_ENV` → becomes remote `./.env` (used by Redis service; must include `REDIS_PASSWORD` etc.).
- `SERVER_BACKEND_ENV` → becomes remote `./backend/.env` (FastAPI environment, Firebase/Pinecone/OpenAI config).
- `FIREBASE_SA_JSON_B64` → **base64-encoded** Firebase service account JSON, written as
  `./backend/lexbot-pro-firebase-adminsdk-fbsvc-40d434171d.json` on the server to match your compose mount.

> Tip to encode SA file locally:
> ```bash
> base64 -w0 backend/lexbot-pro-firebase-adminsdk-*.json
> ```

## Server prerequisites
- Docker Engine + the Compose plugin (`docker compose`). The script falls back to `docker-compose` if needed.
- The directory `REMOTE_DIR` (default `/opt/lbpr`) is writable by your `HETZNER_USER`.

## What gets uploaded
The workflow syncs these to the server **on each deploy**:
- `docker-compose.yml` (+ optional `docker-compose.ssl.yml` if present)
- `ops/deploy/docker-compose.deploy.yml` (the override that sets the API image)
- `ops/deploy/deploy.sh`
- `.env` and `backend/.env` populated from GitHub Secrets
- Firebase SA file from `FIREBASE_SA_JSON_B64`

## Rollbacks
To roll back to any commit, re-run the workflow on that SHA. It will use the
tag `sha-<short>` consistently for both images and re-deploy.

## Local test (optional)
On the server:
```bash
cd /opt/lbpr
export DOCKERHUB_USERNAME=you API_TAG=sha-deadbee SPA_TAG=sha-deadbee
bash ops/deploy/deploy.sh
```
