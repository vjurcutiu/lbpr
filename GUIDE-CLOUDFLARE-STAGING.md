# Staging SSL on Cloudflare (Origin Certificate) — Step-by-step

This config uses a **Cloudflare Origin Certificate** for `staging.lexbot.pro` (served behind Cloudflare's proxy).

## 1) In Cloudflare Dashboard
1. **DNS →** ensure `staging.lexbot.pro` points to your server and has the **orange cloud (Proxy)** enabled.
2. **SSL/TLS → Overview:** set mode to **Full (strict)**.
3. **SSL/TLS → Origin Server → Create Certificate:**
   - Hostnames: `staging.lexbot.pro`
   - Key type: **RSA**
   - Validity: keep default (e.g., 15 years) or your preference
   - Download **Certificate (PEM)** and **Private key**

## 2) Put the files in the repo (mounted into the container)
Save as:
```
ops/certs/cf-origin/staging.lexbot.pro.pem
ops/certs/cf-origin/staging.lexbot.pro.key
```
> ⚠️ Treat the **.key** as a secret. Do **NOT** commit it. Add `ops/certs/cf-origin/*.key` to `.gitignore`.

## 3) Update and restart nginx via compose
Use the provided override so nginx gets the certs mounted at `/etc/ssl/cf-origin`:

```bash
docker compose -f docker-compose.yml -f docker-compose.ssl.yml up -d --build
docker compose logs -f nginx
```

## 4) Verify
- Visit: `https://staging.lexbot.pro`
- You should no longer see “cannot load certificate … letsencrypt …/staging.lexbot.pro/fullchain.pem” errors.
- In `docker logs nginx`, the warning about `listen ... http2` will be gone (we now use `http2 on;`).

## Notes
- Production (`lexbot.pro`) still uses Let's Encrypt in `nginx.conf`. You can migrate prod to Cloudflare Origin certs later by switching the certificate paths similarly.
- Keep `cloudflare-real-ip.conf` mounted to restore real client IPs through Cloudflare.
- Optional Cloudflare toggles (Speed → Optimization): enable HTTP/2 and HTTP/3 (with quic). Nginx here serves HTTP/2; HTTP/3 would require a QUIC-enabled nginx build.
