# Grafana dashboards as code

This folder provisions the three LBPR telemetry dashboards in Grafana Cloud with Terraform:

- `LBPR / API Health`
- `LBPR / RAG Pipeline`
- `LBPR / Dependency Health`

The dashboard JSON lives in `dashboards/*.json` and is applied with the official Grafana Terraform provider.

## What the dashboards cover

### API Health

- auth successes and failures
- plan limit hits
- chat / ingest / upload completion rates
- chat and ingest failures by stage
- chat and ingest p95 latency

### RAG Pipeline

- chat started / completed totals
- chat completions by flow and with/without sources
- ingest completions by chunk bucket
- messages and upload-token usage by plan
- chat and ingest p95 latency

### Dependency Health

- OpenAI call volume and p95 latency by operation
- Pinecone operation volume and p95 latency by operation
- non-ok OpenAI and Pinecone operations
- mean latency trends for both dependencies

## Setup

1. Create a Grafana service-account token that can manage folders and dashboards.
2. Copy the example tfvars file and fill in your hosted Grafana URL and token:

```bash
cd infra/terraform/grafana
cp terraform.tfvars.example terraform.tfvars
```

3. Apply the dashboards:

```bash
terraform init
terraform plan
terraform apply
```

You can also use environment variables instead of `terraform.tfvars`:

```bash
export TF_VAR_grafana_url="https://your-stack.grafana.net/"
export TF_VAR_grafana_auth="glsa_replace_me"
```

## Notes

- The dashboards use a Prometheus datasource variable named `datasource`, so you can point them at any Prometheus-compatible metrics source inside Grafana.
- The dashboards also expose a `job` textbox variable. Leave it as `.*` to show all LBPR series, or set it to a tighter regex such as `my-application-group/lbpr-api`.
- The latency panels use the Prometheus-visible OpenTelemetry histogram names such as `lbpr_chat_duration_ms_milliseconds_bucket`.
