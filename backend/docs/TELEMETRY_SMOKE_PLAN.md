# Telemetry smoke plan

This repo now has two layers of telemetry validation:

1. **Code-level smoke tests** in `backend/tests/test_telemetry_smoke.py`
2. **Grafana validation flows** you can run manually after deploy/dev startup

## Run the smoke tests

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

### 5) File upload success

Trigger:
- `POST /v1/files`

Expected metrics:
- `lbpr_file_upload_started_total{flow="upload"}` increments
- `lbpr_file_upload_completed_total{flow="upload"}` increments
- `lbpr_ingest_started_total{flow="upload"}` increments
- `lbpr_ingest_completed_total{flow="upload"}` increments
- `lbpr_ingest_duration_ms{flow="upload",status="ok"}` records

### 6) Plan/quota usage

Trigger:
- `add_message()` on an allowed request
- `add_upload_tokens()` on a blocked request

Expected metrics:
- `lbpr_messages_used_total{plan="pro|free|..."}` increments on success
- `lbpr_plan_limit_hit_total{metric="messages|upload_tokens",plan="..."}` increments on denial

## Manual Grafana smoke flow

Run these after starting the app with OTEL metrics+traces enabled:

1. Login / create session
2. Hit `/session`
3. Hit `/me`
4. Upload one small text file
5. Run one successful query
6. Force one limit-hit path if practical

Then confirm in Grafana Explore (metrics datasource) that these return data:

```promql
sum(rate(lbpr_auth_session_success_total[$__rate_interval]))
```

```promql
sum(rate(lbpr_chat_started_total[$__rate_interval])) by (flow)
```

```promql
sum(rate(lbpr_file_upload_completed_total[$__rate_interval])) by (flow)
```

## First 6 dashboard panels

These are the first six panels worth adding. Filter by:

- `job="my-application-group/lbpr-api"` if you want to scope to this service
- or leave unfiltered while you only have one backend service sending custom metrics

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
sum(rate(lbpr_plan_limit_hit_total[$__rate_interval])) by (metric, plan)
```

## Suggested rollout order

1. Keep the smoke tests green in CI
2. Verify metrics arrive in Grafana Explore
3. Add the six panels above
4. Only then add alerts or more detailed business slices
