# --- Build SPA and publish artifacts as an OCI image layer ---
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

# Install dependencies (cached)
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch && pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Minimal image that carries only the built assets.
# This is NOT an nginx runtime — it just stores /srv/spa/dist
# so your deploy step can pull and copy the assets into the nginx container/volume.
FROM alpine:3.20
WORKDIR /srv/spa
COPY --from=build /app/dist ./dist
# Simple default cmd to show what's inside when running interactively
CMD ["sh", "-lc", "ls -la /srv/spa/dist && echo 'lbpr-spa image contains built assets under /srv/spa/dist'"]
