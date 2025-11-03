# Firebase Env SDK (SSOT)

A tiny toolkit to **export** your Firebase project's settings to a local *single source of truth* (SSOT) and **apply** them back to any project.

Targets covered:
- Authentication config (providers, password policy, templates — via Identity Platform Admin v2)
- Cloud Firestore & Cloud Storage **Security Rules** (via Firebase Rules API)
- Firebase **Extensions** (manifest + per-instance `.env` — via `firebase-tools ext:export`)
- Cloud Functions **runtime config** (legacy `functions:config` — optional)

> Default project in your repo: **`lexbot-pro`** (from your env files). You can pass another with `--project <id>`.

## Install
```bash
cd envs/firebase
pnpm i   # or npm i / yarn
```

Authenticate for Google APIs (one-time):
```bash
gcloud auth application-default login   # or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON
```

## Export to SSOT
```bash
pnpm export -- --project lexbot-pro
```
Outputs into `envs/firebase/ssot/`:
- `auth.config.json`
- `firestore.rules`
- `storage.rules`
- `firebase.json` (+ `extensions/*.env`) from extensions export
- `functions.config.json` (optional; if available)

## Apply from SSOT
```bash
pnpm apply -- --project lexbot-pro --all
# or selectively:
pnpm apply -- --project lexbot-pro --auth --rules --extensions --functions
```

### Notes & permissions
- **Auth** uses Identity Platform Admin v2 (`identitytoolkit.googleapis.com`). Scopes: `https://www.googleapis.com/auth/identitytoolkit`.
- **Rules** use Firebase Rules API (`firebaserules.googleapis.com`). We update the releases `cloud.firestore/(default)` and `firebase.storage`.
- **Extensions** rely on the Firebase CLI manifest. We run `firebase ext:export` and `firebase deploy --only extensions`.
- **Functions config** runs `firebase functions:config:get/set` for *Gen1-style* config. For Gen2, prefer env files, params, and Secret Manager.

See Google docs for API details:
- Identity Platform Admin v2 get/update config.  
- Firebase Rules API releases & rulesets.  
- Extensions manifest + export/deploy.

