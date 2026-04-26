# Telemetry smoke plan

This repo now has three layers of telemetry validation:

1. **Code-level smoke tests** in `backend/tests/test_telemetry_smoke.py`
2. **One-command live seed flow** in `backend/scripts/seed_telemetry.py`
3. **Grafana validation queries** you can run in Explore or panels after the seed completes

## What each layer proves

### 1) Pytest smoke tests

From `backend/`:

```bash
pytest -q tests/test_telemetry_smoke.py
```

What these tests prove:

- auth success/error emits the expected counters
- RAG query success emits started/completed/duration metrics
- ingest limit path emits error/duration metrics
- file upload success emits upload + ingest metrics
- quota accounting emits usage and plan-limit counters

What these tests **do not** prove:

- that Grafana received any metrics
- that OTLP export is configured correctly
- that the current datasource labels match your PromQL filters

These tests replace the real business instruments with the fake test kit in `tests/telemetry_testkit.py`, and test startup disables OTEL exporting in `tests/conftest.py`. Keep them green, but do not expect them to populate Grafana.

### 2) One-command live seed flow

From the repo root, with the dev stack already running:

```bash
make telemetry-seed
```

That target runs:

```bash
docker compose -p lbpr-dev -f docker-compose.dev.yml exec api python scripts/seed_telemetry.py
```

The seed script runs the app **in-process** inside the api container, drives the golden flows through real FastAPI routes, and flushes telemetry on shutdown.

By default it uses deterministic fake auth (`AUTH_FAKE=1`) for the seed process only, so it can reliably hit:

- auth session success
- auth session failure
- `/session`
- `/me`
- `/limits/me`
- RAG ingest success
- RAG query success
- `/v1/chat`
- file upload success
- message limit hit
- upload-token limit hit

Useful flags:

```bash
python scripts/seed_telemetry.py --skip-upload
```

```bash
python scripts/seed_telemetry.py --skip-contracts-chat
```

```bash
SEED_USE_FAKE_AUTH=0 python scripts/seed_telemetry.py
```

The script prints a step-by-step result list and exits non-zero if any flow failed.

## Golden flows and expected metrics

### 1) Auth session success

Trigger:
- `POST /auth/session` with a valid token

Expected metrics:
- `lbpr_auth_session_success_total{method="id_token"}` increments

### 2) Auth session failure

Trigger:
- `POST /auth/session` with an invalid token

Expected metrics:
- `lbpr_auth_session_error_total{method="id_token",reason="invalid_id_token"}` increments

### 3) Query success

Trigger:
- `POST /features/rag/query`

Expected metrics:
- `lbpr_chat_started_total{flow="query"}` increments
- `lbpr_chat_completed_total{flow="query",with_sources="true|false"}` increments
- `lbpr_chat_duration_ms{flow="query",status="ok"}` records

### 4) Ingest blocked by limit

Trigger:
- `POST /features/rag/ingest` when upload-token quota is exhausted

Expected metrics:
- `lbpr_ingest_started_total{flow="api"}` increments
- `lbpr_ingest_error_total{flow="api",stage="limit"}` increments
- `lbpr_ingest_duration_ms{flow="api",status="error"}` records
- `lbpr_plan_limit_hit_total{metric="file_processing_tokens",plan="..."}` increments

### 5) File upload success

Trigger:
- `POST /v1/files`

Expected metrics:
- `lbpr_file_upload_started_total{flow="upload"}` increments
- `lbpr_file_upload_completed_total{flow="upload"}` increments
- `lbpr_ingest_started_total{flow="upload"}` increments
- `lbpr_ingest_completed_total{flow="upload"}` increments
- `lbpr_ingest_duration_ms{flow="upload",status="ok"}` records

### 6) Plan/quota usage and denial

Trigger:
- successful chat/query path
- successful ingest/upload path
- successful workflow path
- forced message-limit denial
- forced file-processing-token denial
- forced workflow-token denial

Expected metrics:
- `lbpr_messages_used_total{plan="pro|free|..."}` increments on success
- `lbpr_upload_tokens_used_total{plan="pro|free|..."}` increments on upload success
- `lbpr_file_processing_tokens_used_total{plan="pro|free|...",category="upload_ingest"}` increments on upload success
- `lbpr_workflow_tokens_used_total{plan="pro|free|...",category="workflow|workflow_refinement"}` increments on workflow success
- `lbpr_plan_limit_hit_total{metric="messages|file_processing_tokens|workflow_tokens",plan="..."}` increments on denial

## Grafana validation flow

Run these after `make telemetry-seed`.

### 1) Discover the actual service labels first

Do this **before** hard-coding a `job=` filter:

```promql
count by (job, service_name, deployment_environment, deployment_environment_name) (target_info)
```

Your local/dev service often ends up as something like:

- `job="my-application-group/lbpr-api-local"`

while prod may be:

- `job="my-application-group/lbpr-api"`

If you filter on the wrong `job`, your panels will show nothing even when the metrics exist.

### 2) Use `increase(...)` first, not `rate(...)`

For sparse manual seed traffic, `increase` is easier to validate than `rate`.

Start with these in Explore, with a 15m or 30m time range:

```promql
sum(increase(lbpr_auth_session_success_total[15m])) by (job)
```

```promql
sum(increase(lbpr_auth_session_error_total[15m])) by (job, reason)
```

```promql
sum(increase(lbpr_chat_started_total[15m])) by (job, flow)
```

```promql
sum(increase(lbpr_chat_completed_total[15m])) by (job, flow, with_sources)
```

```promql
sum(increase(lbpr_chat_error_total[15m])) by (job, flow, stage)
```

```promql
sum(increase(lbpr_ingest_started_total[15m])) by (job, flow)
```

```promql
sum(increase(lbpr_ingest_completed_total[15m])) by (job, flow, chunk_bucket)
```

```promql
sum(increase(lbpr_ingest_error_total[15m])) by (job, flow, stage)
```

```promql
sum(increase(lbpr_file_upload_completed_total[15m])) by (job, flow)
```

```promql
sum(increase(lbpr_messages_used_total[15m])) by (job, plan)
```

```promql
sum(increase(lbpr_upload_tokens_used_total[15m])) by (job, plan)
```

```promql
sum(increase(lbpr_workflow_tokens_used_total[15m])) by (job, plan, category)
```

```promql
sum(increase(lbpr_plan_limit_hit_total[15m])) by (job, metric, plan)
```

```promql
sum(increase(lbpr_openai_call_total[15m])) by (job, operation, status)
```

```promql
sum(increase(lbpr_pinecone_operation_total[15m])) by (job, operation, status)
```

### 3) Validate histograms exist before asking for p95

```promql
sum(increase(lbpr_chat_duration_ms_milliseconds_count[15m])) by (job, flow, status)
```

```promql
sum(increase(lbpr_ingest_duration_ms_milliseconds_count[15m])) by (job, flow, status)
```

```promql
sum(increase(lbpr_openai_duration_ms_milliseconds_count[15m])) by (job, operation, status)
```

```promql
sum(increase(lbpr_pinecone_duration_ms_milliseconds_count[15m])) by (job, operation, status)
```

Once those show data, use p95 queries for dashboards.

## First 6 dashboard panels

After the Explore checks above work, convert them into dashboard-style PromQL.

Filter by the real `job` label you discovered from `target_info`, or leave the filter off while only one backend is sending these custom metrics.

### 1) Auth sessions: success vs error

```promql
sum(rate(lbpr_auth_session_success_total[$__rate_interval]))
```

```promql
sum(rate(lbpr_auth_session_error_total[$__rate_interval])) by (reason)
```

### 2) Chat volume by flow

```promql
sum(rate(lbpr_chat_started_total[$__rate_interval])) by (flow)
```

### 3) Chat success vs error

```promql
sum(rate(lbpr_chat_completed_total[$__rate_interval])) by (flow)
```

```promql
sum(rate(lbpr_chat_error_total[$__rate_interval])) by (flow, stage)
```

### 4) Chat p95 latency

```promql
histogram_quantile(0.95, sum by (le, flow) (rate(lbpr_chat_duration_ms_bucket[$__rate_interval])))
```

### 5) Upload and ingest throughput

```promql
sum(rate(lbpr_file_upload_completed_total[$__rate_interval])) by (flow)
```

```promql
sum(rate(lbpr_ingest_completed_total[$__rate_interval])) by (flow)
```

### 6) Plan pressure / limits

```promql
sum(increase(lbpr_messages_used_total[$__range])) by (plan)
```

```promql
sum(increase(lbpr_upload_tokens_used_total[$__range])) by (plan)
```

```promql
sum(increase(lbpr_workflow_tokens_used_total[$__range])) by (plan, category)
```

```promql
sum(rate(lbpr_plan_limit_hit_total[$__rate_interval])) by (metric, plan)
```

## Suggested rollout order

1. Keep the pytest smoke tests green in CI
2. Run `make telemetry-seed`
3. Validate the series in Grafana Explore with `increase(...)`
4. Discover the real `job` label from `target_info`
5. Build dashboard panels only after the Explore queries work
6. Only then add alerts or more detailed business slices


## Dashboards as code

The repo also includes Grafana dashboards as code under `infra/terraform/grafana/`.

To provision them into Grafana Cloud:

```bash
cd infra/terraform/grafana
terraform init
terraform plan
terraform apply
```

Or use the root helpers:

```bash
make grafana-init
make grafana-plan
make grafana-apply
```

The dashboards included there are:

- `LBPR / API Health`
- `LBPR / RAG Pipeline`
- `LBPR / Dependency Health`
