# Redis start error: `Unknown command 'flushall' ... incr.aof` — Fix

**Why it happens**
- Your `ops/redis/redis.conf` disables `FLUSHALL/FLUSHDB` (good for prod).  
- An *older* AOF file recorded a `FLUSHALL`. During startup, Redis replays the AOF and now treats `FLUSHALL` as an *unknown* command → startup fails.

We fix this in two parts:

1) **Split configs**
   - `ops/redis/redis.dev.conf`: allows `FLUSH*` (dev-only) so old AOFs that contain it can still load.
   - `ops/redis/redis.prod.conf`: keeps `FLUSH*` disabled (safer for prod).

2) **Reset any bad AOF once**
   - If a volume already contains an AOF with `FLUSHALL`, wipe the Redis data volume once (dev or prod) and restart.

---

## Apply

### 1) Replace compose mounts
Use the updated `docker-compose.dev.yml` and `docker-compose.yml` in this zip.  
They mount the correct config for each env:

- Dev: `./ops/redis/redis.dev.conf -> /usr/local/etc/redis/redis.conf`
- Prod: `./ops/redis/redis.prod.conf -> /usr/local/etc/redis/redis.conf`

### 2) Reset the Redis volume **once** (only if startup still fails)
> This drops Redis data for the stack. Your app uses Redis for ephemeral usage/limits, so this is safe.

**Dev on your laptop**:
```bash
make nuke MODE=dev
make dev
```
**Prod on the server**:
```bash
make nuke MODE=prod
make up
```

(Your Makefile already defines `nuke` as `docker compose ... down -v --remove-orphans` per stack.)

### 3) Host kernel tune (warning you saw)
Redis warns:
```
WARNING Memory overcommit must be enabled! ...
To fix: add 'vm.overcommit_memory = 1' to /etc/sysctl.conf and reboot
or run: sysctl vm.overcommit_memory=1
```
Run on the **host** (not inside the container):

```bash
sudo sysctl -w vm.overcommit_memory=1
# optional quality-of-life for Redis
sudo sysctl -w net.core.somaxconn=1024
# ensure persistence
echo 'vm.overcommit_memory = 1' | sudo tee -a /etc/sysctl.conf
```

---

## Notes

- We also set `aof-load-truncated yes` in both configs for resilience.
- The app code does **not** call `FLUSHALL`/`FLUSHDB`; if you manually ran it in the past,
  that’s likely how it ended up in the AOF.
- Keep `FLUSH*` disabled in production. In dev, it’s allowed to avoid this exact AOF‑replay issue and for easier local resets.
