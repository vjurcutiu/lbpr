# Doppler Runtime Secrets for API

This overlay injects all **API** environment variables from **Doppler** at container runtime.
It keeps local dev unchanged (still uses `backend/.env`) and only affects the server deploy.

## What changed

- **Dockerfile**: installs the Doppler CLI so the container can run `doppler run ...`.
- **ops/deploy/docker-compose.doppler.yml**: production-only override that replaces the API command with `doppler run`.
- **deploy script**: includes the doppler override if present.
- **GitHub secrets**: the workflow writes your Doppler details into `/.deploy.env` on the server:
  - `DOPPLER_TOKEN` (Service Token, read-only)
  - `DOPPLER_PROJECT` (e.g. `lbpr`)
  - `DOPPLER_CONFIG` (e.g. `prod`)

> Keep your Firebase Service Account file mount as-is (or store the JSON in Doppler as a base64 string and decode on start if you prefer).

## Doppler setup (once)

1. Create (or choose) a **Project** and **Config** in Doppler for the API.
2. Create a **Service Token** for that config (read-only is recommended).
3. In GitHub → your repo → **Settings → Secrets and Variables → Actions**, add:
   - `DOPPLER_TOKEN`
   - `DOPPLER_PROJECT`
   - `DOPPLER_CONFIG`
4. (Optional) For rollback safety offline, you can also generate a **secrets snapshot** during CI and run with `--fallback`, see Doppler docs.

## Deploy flow

- CI builds & pushes images.
- CI uploads `.deploy.env` containing:
  - `DOCKERHUB_USERNAME`, `API_TAG`, `SPA_TAG`
  - `DOPPLER_TOKEN`, `DOPPLER_PROJECT`, `DOPPLER_CONFIG`
- Server `deploy.sh` pulls images, extracts SPA assets, and runs compose with this overlay so the API starts under `doppler run`.

