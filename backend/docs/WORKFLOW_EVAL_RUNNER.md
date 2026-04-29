# Internal Workflow Eval Runner

The workflow eval runner executes configured workflows against an existing uploaded document set and writes one JSON export that can be reviewed manually or sent for qualitative evaluation.

This is internal backend tooling only. It does not add product UI, does not create customer-facing workflow history, and skips workflow token billing while still recording usage estimates in the exported metadata.

## What it reuses

The runner calls the same workflow service pieces used by production workflow runs:

- workflow manifest validation
- source document loading
- workflow handler registry
- result metadata augmentation
- artifact formatting
- usage accounting estimates

## Run it

From the `backend/` directory:

```bash
python -m internal.evals.runner \
  --uid <USER_OR_EVAL_TENANT_UID> \
  --case internal/evals/cases/legal_pack_smoke.example.json \
  --out internal/evals/results
```

The command writes a JSON file like:

```text
backend/internal/evals/results/legal_pack_smoke_001__20260429T120000Z.json
```

## Eval case shape

```json
{
  "eval_id": "legal_pack_smoke_001",
  "description": "Smoke-test legal workflows.",
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

## JSON export contents

Each run includes:

- workflow ID, title, capability, status, and error if any
- inputs used for the workflow
- summary, bullets, next actions, and full markdown output
- structured metadata such as legal risks, clauses, obligations, approval notes, open questions, evidence highlights, and suggested actions when available
- source file metadata
- usage accounting estimates with `billing_skipped: true`

## Recommended workflow

1. Upload a stable set of eval documents to a dedicated internal/eval tenant.
2. Copy the real file IDs into an eval case JSON file.
3. Run the eval command after prompt, workflow, retrieval, or model changes.
4. Compare the exported JSON against previous runs and review failures/regressions.
