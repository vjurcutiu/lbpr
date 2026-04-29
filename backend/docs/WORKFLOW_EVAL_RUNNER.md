# Internal Workflow Eval Runner

The workflow eval runner executes configured workflows against an existing uploaded document set and writes eval artifacts for review. It is meant to track workflow and prompt quality over time.

This is internal backend tooling only. It does not add product UI, does not create customer-facing workflow history, and skips workflow token billing while still recording usage estimates in the exported metadata.

## What it reuses

The runner calls the same workflow service pieces used by production workflow runs:

- workflow manifest validation
- source document loading
- workflow handler registry
- result metadata augmentation
- artifact formatting
- usage accounting estimates

## Run it locally inside Docker Compose

For the dev stack:

```bash
make workflow-eval-dev \
  EVAL_UID=<USER_OR_EVAL_TENANT_UID> \
  CASE=internal/evals/cases/legal_pack_smoke.example.json \
  MODE=smoke \
  MARKDOWN=1
```

For the base Compose stack:

```bash
make workflow-eval \
  EVAL_UID=<USER_OR_EVAL_TENANT_UID> \
  CASE=internal/evals/cases/legal_pack_smoke.example.json \
  MODE=smoke \
  MARKDOWN=1
```

To compare against a previous run:

```bash
make workflow-eval-dev \
  EVAL_UID=<USER_OR_EVAL_TENANT_UID> \
  CASE=internal/evals/cases/legal_pack_smoke.example.json \
  MODE=smoke \
  MARKDOWN=1 \
  COMPARE_TO=internal/evals/results/legal_pack_smoke_001__20260429T120000Z.json
```

The Make targets run the command in the `api` container with `PYTHONPATH=/app`.

## Run it directly from backend

From the `backend/` directory:

```bash
python -m internal.evals.runner \
  --uid <USER_OR_EVAL_TENANT_UID> \
  --case internal/evals/cases/legal_pack_smoke.example.json \
  --out internal/evals/results \
  --mode smoke \
  --markdown
```

The command writes a JSON file like:

```text
backend/internal/evals/results/legal_pack_smoke_001__20260429T120000Z.json
```

With `--markdown`, it also writes a readable bundle:

```text
backend/internal/evals/results/legal_pack_smoke_001__20260429T120000Z/
  summary.md
  01-legal_contract_review.md
  02-legal_contract_risk_matrix.md
```

With `--compare-to`, it writes comparison JSON and markdown files.

## Eval case shape

```json
{
  "eval_id": "legal_pack_smoke_001",
  "description": "Smoke-test legal workflows.",
  "mode": "smoke",
  "default_prompt_version": "legal-pack-v1",
  "default_workflow_version": "workflow-engine-v1",
  "document_set": {
    "name": "sample_contracts_batch_1",
    "selection": {
      "file_ids": ["file_123"],
      "folder_paths": [],
      "current_folder": "contracts"
    }
  },
  "default_inputs": {
    "focus": "Identify risks, obligations, open questions, and practical next steps."
  },
  "workflows": [
    {
      "workflow_id": "legal_contract_review",
      "label": "Contract review baseline",
      "modes": ["smoke", "full"],
      "rubric_id": "legal/contract_review",
      "expected_sections": ["Risks", "Open questions"],
      "inputs": {
        "document_type": "general_contract",
        "review_mode": "approval",
        "counterparty_position": "vendor",
        "risk_tolerance": "balanced"
      }
    }
  ]
}
```

Each workflow can override the document set by adding its own `selection` object.

## Rubrics

Rubrics can be referenced by `rubric_id` from `backend/internal/evals/rubrics/`:

```json
{
  "rubric_id": "legal/contract_review",
  "workflow_id": "legal_contract_review",
  "min_source_count": 1,
  "required_metadata_keys": ["risk_items", "open_questions"],
  "required_metadata_min_items": {
    "risk_items": 1
  },
  "required_sections": ["Risks", "Open questions"],
  "criteria": [
    {
      "id": "identifies_material_risks",
      "label": "Identifies material legal and commercial risks from the source document",
      "weight": 5,
      "max_score": 5
    }
  ]
}
```

The runner does not auto-score criteria. It exports blank scoring fields so manual or assisted review can fill them consistently.

## JSON export contents

Each run includes:

- workflow ID, title, capability, status, and error if any
- prompt/workflow version fields from the eval case
- stable config, output, source, and structured metadata fingerprints
- inputs used for the workflow
- summary, bullets, next actions, and full markdown output
- structured metadata such as legal risks, clauses, obligations, approval notes, open questions, evidence highlights, and suggested actions when available
- source file metadata
- rubric criteria placeholders
- validation issues for missing sections, sources, or structured metadata
- usage accounting estimates with `billing_skipped: true`

## Baseline comparison

The comparison output tracks:

- status changes
- output fingerprint changes
- rough output similarity
- duration delta
- token delta when usage fields are available
- source count delta
- validation warning/error delta

This is intentionally lightweight. It tells you where to inspect after prompt, retrieval, workflow, or model changes.

## Recommended workflow

1. Upload a stable set of eval documents to a dedicated internal/eval tenant.
2. Copy the real file IDs into an eval case JSON file.
3. Set `default_prompt_version` and `default_workflow_version` before each meaningful prompt/workflow change.
4. Run the eval command after prompt, workflow, retrieval, or model changes.
5. Compare the exported JSON against a previous baseline.
6. Review markdown bundles and fill criterion scores in the JSON if needed.
