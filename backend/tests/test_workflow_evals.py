from __future__ import annotations

import json

from features.workflows import registry as workflow_registry
from features.workflows import service as workflow_service
from features.workflows.models import WorkflowSourceFile
from internal.evals.compare import compare_eval_exports
from internal.evals.runner import run_eval_case, write_eval_export
from internal.evals.schemas import EvalDocumentSet, EvalRubric, EvalRubricCriterion, EvalWorkflowSpec, WorkflowEvalCase


def _fake_source_loader(uid, selection, **kwargs):
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


def test_internal_eval_runner_exports_workflow_outputs(monkeypatch, tmp_path):
    workflow_registry.OpenAIChat = None
    monkeypatch.setattr(workflow_service, "_load_source_documents", _fake_source_loader)

    case = WorkflowEvalCase(
        eval_id="legal_pack_smoke_test",
        mode="smoke",
        default_prompt_version="prompt-v1",
        default_workflow_version="workflow-v1",
        document_set=EvalDocumentSet(
            name="contracts_batch",
            selection={"file_ids": ["file-1"], "folder_paths": [], "current_folder": "contracts"},
        ),
        default_inputs={"focus": "approval risks"},
        rubrics={
            "legal_contract_review": EvalRubric(
                rubric_id="legal/contract_review_test",
                required_metadata_keys=["risk_items"],
                required_metadata_min_items={"risk_items": 1},
                min_source_count=1,
                criteria=[
                    EvalRubricCriterion(
                        id="risk_quality",
                        label="Identifies useful risks",
                        weight=3,
                    )
                ],
            )
        },
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
                modes=["smoke", "full"],
            )
        ],
    )

    export = run_eval_case("u_eval", case)
    assert export.eval_id == "legal_pack_smoke_test"
    assert export.mode == "smoke"
    assert export.case_fingerprint
    assert len(export.runs) == 1

    run = export.runs[0]
    assert run.status == "completed"
    assert run.workflow_id == "legal_contract_review"
    assert run.run_key.startswith("legal_contract_review::")
    assert run.output_markdown
    assert run.output_fingerprint
    assert run.config_fingerprint
    assert run.prompt_version == "prompt-v1"
    assert run.workflow_version == "workflow-v1"
    assert run.structured_metadata["risk_items"]
    assert run.sources[0].name == "vendor-msa.txt"
    assert run.usage["billing_skipped"] is True
    assert run.usage["billing_skip_reason"] == "internal_eval"
    assert run.criterion_scores[0].criterion_id == "risk_quality"
    assert run.criterion_scores[0].score is None
    assert run.validation.status == "passed"

    path = write_eval_export(export, tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["eval_id"] == "legal_pack_smoke_test"
    assert payload["case_fingerprint"]
    assert payload["runs"][0]["status"] == "completed"
    assert payload["runs"][0]["output_markdown"]


def test_internal_eval_runner_skips_mode_mismatches(monkeypatch):
    workflow_registry.OpenAIChat = None
    monkeypatch.setattr(workflow_service, "_load_source_documents", _fake_source_loader)

    case = WorkflowEvalCase(
        eval_id="mode_test",
        mode="smoke",
        document_set=EvalDocumentSet(name="contracts_batch", selection={"file_ids": ["file-1"]}),
        workflows=[
            EvalWorkflowSpec(
                workflow_id="legal_contract_review",
                label="Full-only review",
                modes=["full"],
            )
        ],
    )

    export = run_eval_case("u_eval", case)
    assert export.runs[0].status == "skipped"
    assert "Skipped because mode" in (export.runs[0].error or "")


def test_internal_eval_comparison_tracks_output_and_status_changes(monkeypatch):
    workflow_registry.OpenAIChat = None
    monkeypatch.setattr(workflow_service, "_load_source_documents", _fake_source_loader)

    case = WorkflowEvalCase(
        eval_id="comparison_test",
        document_set=EvalDocumentSet(name="contracts_batch", selection={"file_ids": ["file-1"]}),
        workflows=[EvalWorkflowSpec(workflow_id="legal_contract_review", label="Contract review baseline")],
    )

    baseline = run_eval_case("u_eval", case)
    current = run_eval_case("u_eval", case)
    current.runs[0].output_markdown += "\n\nAdditional regression text."
    current.runs[0].output_fingerprint = "changed"

    comparison = compare_eval_exports(current, baseline)
    assert comparison.summary["compared_runs"] == 1
    assert comparison.summary["output_changes"] == 1
    assert comparison.runs[0].output_changed is True
    assert comparison.runs[0].output_similarity is not None
