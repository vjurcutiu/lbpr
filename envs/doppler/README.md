
# doppler-sdk-exporter

Exports **Projects → Environments → Configs (root & branches)** and optionally **secret names** or **values** from your Doppler account to a single JSON.

> Default = names-only (safe for LLM ingestion). Use `--include-values` to include actual values.

### Auth
Use a **Personal Token** (`dp.pt...`) or **Service Account Token** (`dp.sa...`) with sufficient access. **Service Tokens** (`dp.st...`) are config-scoped and cannot list projects. citeturn0search2turn0search7

### Build & Run
```bash
npm i
npm run build
# provide token via env or --token
DOPPLER_TOKEN=dp.pt_xxx npx . doppler-dump --out snapshot.json
```

### CLI
```
--token <string>           overrides env DOPPLER_TOKEN / DOPPLER_API_TOKEN
--base-url <string>        default https://api.doppler.com/v3
--project <slug>           only export this project
--include-values           include secret values (default: false)
--include-dynamic          include dynamic secret values (if perms)
--include-managed          include managed secrets (if perms)
--stdout                   print JSON to stdout
--out <file>               output path (default doppler_export_<ts>.json)
--concurrency <n>          parallel secret fetches (default 5)
--per-page <n>             page size (default 200)
--max-pages <n>            max pages (default 10)
--verbose                  HTTP logging (429 retries honored)
```
