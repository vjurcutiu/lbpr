from __future__ import annotations

import json

from features.workflows import registry as workflow_registry
from features.workflows import service as workflow_service
from features.workflows.models import WorkflowSourceFile
from internal.evals.runner import run_eval_case, write_eval_export
from internal.evals.schemas import EvalDocumentSet, EvalWorkflowSpec, WorkflowEvalCase


def test_internal_eval_runner_exports_workflow_outputs(monkeypatch, tmp_path):
    workflow_registry.OpenAIChat = None

    def _fake_loader(uid, selection, **kwargs):
        docs = [
            WorkflowSourceFile(
                file_id="file-1",
                name="vendor-msa.txt",
                folder_path="contracts",
                content_type="text/plain",
                excerpt="The agreement includes liability, indemnity, renewal, and payment obligations.",
                full_text_chars=78,
                excerpt_chars=78,
                truncated=False,
            )
        ]
        return docs, {
            "selected_files": 1,
            "used_source_files": 1,
            "warnings": [],
            "skipped_source_files": [],
            "truncated_source_files": [],
            "max_source_files": 8,
            "max_total_source_chars": 32000,
            "max_chars_per_file": 7000,
        }

    monkeypatch.setattr(workflow_service, "_load_source_documents", _fake_loader)

    case = WorkflowEvalCase(
        eval_id="legal_pack_smoke_test",
        document_set=EvalDocumentSet(
            name="contracts_batch",
            selection={"file_ids": ["file-1"], "folder_paths": [], "current_folder": "contracts"},
        ),
        default_inputs={"focus": "approval risks"},
        workflows=[
            EvalWorkflowSpec(
                workflow_id="legal_contract_review",
                label="Contract review baseline",
                inputs={
                    "document_type": "general_contract",
                    "review_mode": "approval",
                    "counterparty_position": "vendor",
                    "risk_tolerance": "balanced",
                },
            )
        ],
    )

    export = run_eval_case("u_eval", case)
    assert export.eval_id == "legal_pack_smoke_test"
    assert len(export.runs) == 1

    run = export.runs[0]
    assert run.status == "completed"
    assert run.workflow_id == "legal_contract_review"
    assert run.output_markdown
    assert run.structured_metadata["risk_items"]
    assert run.sources[0].name == "vendor-msa.txt"
    assert run.usage["billing_skipped"] is True
    assert run.usage["billing_skip_reason"] == "internal_eval"

    path = write_eval_export(export, tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["eval_id"] == "legal_pack_smoke_test"
    assert payload["runs"][0]["status"] == "completed"
    assert payload["runs"][0]["output_markdown"]
