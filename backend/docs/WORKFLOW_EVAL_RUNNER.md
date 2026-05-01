# Internal Workflow Eval Runner

The workflow eval runner executes configured workflows against an existing uploaded document set and writes eval artifacts for review. It is meant to track workflow and prompt quality over time.

This is internal backend tooling only. It does not add product UI, does not create customer-facing workflow history, and skips workflow token billing while still recording usage estimates in the exported metadata.


## Legal Pro public-contract manifests

The targeted v2 regression case is the default for the internal eval UI and Make targets:

```text
backend/internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json
```

It reruns only the v1 public-contract runs that produced validation warnings:

```text
3 workflows × 7 targeted public contract sources
```

Use it after workflow-output fixes to confirm the warnings are gone before spending time and tokens on the full suite.

The full baseline case is still available at:

```text
backend/internal/evals/cases/legal_pro_public_contracts.example.json
```

It runs 27 workflow executions:

```text
9 Legal Pro workflows × 3 targeted public contract sources
```

Both manifests intentionally use only bundled `.txt` fixtures, not the `.odt` or `.pdf` fixtures. Each workflow entry has its own `selection.file_paths` value so NDA Review receives NDA sources, MSA Review receives MSA/SaaS sources, Obligation Tracker receives obligation-heavy sources, and Fallback Language receives contracts with negotiable clause issues.

The internal eval UI can run either case directly. Leave the document manifest override blank unless you intentionally want to override the workflow-specific fixture selections.

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
  CASE=internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json \
  MODE=smoke \
  MARKDOWN=1
```

For the base Compose stack:

```bash
make workflow-eval \
  EVAL_UID=<USER_OR_EVAL_TENANT_UID> \
  CASE=internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json \
  MODE=smoke \
  MARKDOWN=1
```

To compare against a previous run:

```bash
make workflow-eval-dev \
  EVAL_UID=<USER_OR_EVAL_TENANT_UID> \
  CASE=internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json \
  MODE=smoke \
  MARKDOWN=1 \
  COMPARE_TO=internal/evals/results/legal_pro_public_contracts_v2_regression__20260501T120000Z.json
```

The Make targets run the command in the `api` container with `PYTHONPATH=/app`.

## Run it directly from backend

From the `backend/` directory:

```bash
python -m internal.evals.runner \
  --uid <USER_OR_EVAL_TENANT_UID> \
  --case internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json \
  --out internal/evals/results \
  --mode smoke \
  --markdown
```

The command writes a JSON file like:

```text
backend/internal/evals/results/legal_pro_public_contracts_v2_regression__20260501T120000Z.json
```

With `--markdown`, it also writes a readable bundle:

```text
backend/internal/evals/results/legal_pro_public_contracts_v2_regression__20260501T120000Z/
  summary.md
  01-legal_contract_review.md
  02-legal_contract_risk_matrix.md
```

With `--compare-to`, it writes comparison JSON and markdown files.

## Eval case shape

```json
{
  "eval_id": "legal_pro_public_contracts_v1",
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

## What should be committed

Commit eval **inputs and standards**, not generated eval **outputs**.

Commit:

- eval case files in `backend/internal/evals/cases/`
- rubric files in `backend/internal/evals/rubrics/`
- runner, comparison, validation, and UI code
- intentionally curated tiny fixture documents only if they are safe to keep in the repo

Do not commit:

- generated JSON exports in `backend/internal/evals/results/`
- generated markdown bundles in `backend/internal/evals/results/`
- generated job state in `backend/internal/evals/jobs/`
- manual review state in `backend/internal/evals/reviews/`, unless you intentionally decide a specific review file is a baseline artifact
- customer/private/source documents used for eval runs

Generated eval artifacts can contain source snippets, model outputs, file IDs, user IDs, and reviewer notes. Keep them local, attach them to an issue/PR only when needed, or store promoted baselines in a dedicated private artifact store. The repo `.gitignore` ignores the runtime artifact directories while keeping `.gitkeep` placeholders. If generated artifacts are already tracked, remove them from the index with `git rm --cached -r backend/internal/evals/results backend/internal/evals/jobs backend/internal/evals/reviews` before committing.

## Recommended workflow

1. Upload a stable set of eval documents to a dedicated internal/eval tenant.
2. Copy the real file IDs into an eval case JSON file.
3. Set `default_prompt_version` and `default_workflow_version` before each meaningful prompt/workflow change.
4. Run the eval command after prompt, workflow, retrieval, or model changes.
5. Compare the exported JSON against a previous baseline.
6. Review markdown bundles and fill criterion scores in the JSON if needed.


## Internal eval UI

The internal eval console is hidden and disabled by default. It is intended for local/admin workflow quality review, not customer-facing use.

### Start in Docker Compose dev

```bash
make workflow-eval-ui-dev INTERNAL_EVAL_ADMIN_EMAILS=you@example.com
```

This target exports the internal eval flags through Make instead of prefixing the Docker Compose command with POSIX-style environment assignments, so the same command works from PowerShell/Windows make and Unix shells.

Then open:

```text
http://app.localhost/internal/evals
```

For local dev only, if `INTERNAL_EVAL_ADMIN_EMAILS` is empty and `ENV=dev`, any authenticated session can access the internal eval API after `ENABLE_INTERNAL_EVAL_UI=1` is set. In staging/prod, set `INTERNAL_EVAL_ADMIN_EMAILS`.

### What the UI supports

- List eval cases from `backend/internal/evals/cases`
- Start a runner-backed eval job
- Track queued/running/completed/failed status
- Load result JSON exports
- Review workflow outputs, sources, validation warnings/errors, and rubric criteria
- Save manual review scores to `backend/internal/evals/reviews`
- Compare a current result against a baseline result
- Download the JSON export

The UI calls the existing eval runner/service path. It does not create a separate workflow execution implementation.

### Local file manifest picker

The internal eval UI can populate a document manifest from local file/folder picker selections. The browser only exposes the selected file names or folder-relative paths, not unrestricted absolute paths on the machine.

Those paths are sent as `manifest_paths` and as workflow `selection.file_paths`. During execution, the backend resolves each path against files already uploaded for the eval UID by matching:

1. the uploaded file display path, such as `contracts/nda/example.txt`
2. a unique suffix match, such as local `public_contract_eval_seed/contracts/nda/example.txt` matching uploaded `contracts/nda/example.txt`
3. a unique basename match when there is only one uploaded file with that name

This keeps the picker lightweight: it does not ingest local file bytes by itself. Upload/ingest the contracts into the app once, then use the picker to fill the same paths into the eval manifest and run repeatable selections without pasting IDs.

### Bundled internal fixture path resolution

For internal eval smoke tests, manifest paths can also resolve to files stored under the repo's internal fixture directories:

```text
backend/internal/evals/fixtures/
backend/app/internal/evals/fixtures/
```

This is useful for curated public-contract eval sets that are checked into or mounted with the dev repo. For example, a browser-selected folder path like `contracts/nda/example.txt` can resolve to `backend/app/internal/evals/fixtures/public_contract_eval_seed/contracts/nda/example.txt` when that suffix is unique. Folder selections are recursive when they resolve to an internal fixture folder.

The resolver still prefers already uploaded app files first. If no uploaded file matches, it falls back to internal fixture files only inside the safe fixture roots above. It does not read arbitrary absolute paths from the user's PC.
