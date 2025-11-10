# Firebase Env SDK (SSOT)

A tiny toolkit to **export** your Firebase project's settings to a local *single source of truth* (SSOT) and **apply** them back to any project.

Targets covered:
- Authentication config (providers, password policy, templates — via Identity Platform Admin v2)
- Cloud Firestore & Cloud Storage **Security Rules** (via Firebase Rules API)
- Firebase **Extensions** (manifest + per-instance `.env` — via `firebase-tools ext:export`)
- Cloud Functions **runtime config** (legacy `functions:config` — optional)

> Default project in your repo: **`lexbot-pro`** (from your env files). You can pass another with `--project <id>`.

## Export to SSOT
```bash
pnpm export -- --project lexbot-pro
```

## Apply from SSOT
```bash
pnpm apply -- --project lexbot-pro --all
# or selectively:
pnpm apply -- --project lexbot-pro --auth --rules --extensions --functions
```
