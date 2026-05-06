from __future__ import annotations

import json
from pathlib import Path

from features.workflows import registry as workflow_registry
from features.workflows import service as workflow_service
from features.workflows.models import WorkflowSourceFile
from internal.evals.compare import compare_eval_exports
from features.internal_evals.schemas import InternalEvalRunRequest
from features.internal_evals.service import _apply_request_overrides, _validate_app_document_selection
from internal.evals.runner import run_eval_case, write_eval_export
from internal.evals.schemas import EvalDocumentSet, EvalRubric, EvalRubricCriterion, EvalWorkflowSpec, WorkflowEvalCase
from features.files.schemas import FileItem
from fastapi import HTTPException


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


def test_internal_eval_app_document_source_records_metadata():
    case = WorkflowEvalCase(
        eval_id="app_docs_source_test",
        document_set=EvalDocumentSet(name="contracts_batch", selection={"file_ids": ["old-file"]}),
        workflows=[EvalWorkflowSpec(workflow_id="legal_contract_review", label="Review")],
    )
    request = InternalEvalRunRequest(
        document_source="app",
        selection={"file_ids": ["uploaded-file"], "folder_paths": [], "current_folder": ""},
        apply_selection_to_workflows=True,
    )

    updated = _apply_request_overrides(case, request)

    assert updated.metadata["document_source"] == "app"
    assert updated.document_set.selection.file_ids == ["uploaded-file"]
    assert updated.workflows[0].selection is not None
    assert updated.workflows[0].selection.file_ids == ["uploaded-file"]


def test_internal_eval_app_document_source_requires_chunk_artifacts(monkeypatch):
    from features.internal_evals import service as internal_eval_service

    monkeypatch.setattr(
        internal_eval_service.files_service,
        "list_files",
        lambda uid: [
            FileItem(
                id="file-1",
                name="contract.txt",
                size=100,
                content_type="text/plain",
                folder_path="contracts",
                original_name="contract.txt",
            )
        ],
    )
    monkeypatch.setattr(internal_eval_service.chunk_store, "load_chunk_artifact", lambda uid, file_item: None)

    request = InternalEvalRunRequest(
        document_source="app",
        selection={"file_ids": ["file-1"], "folder_paths": [], "current_folder": ""},
    )

    try:
        _validate_app_document_selection(request, uid="u_eval")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "Missing chunk artifacts" in str(exc.detail)
    else:
        raise AssertionError("Expected app document validation to reject files without chunk artifacts")


def test_internal_eval_request_selection_override_applies_to_case_and_workflows():
    case = WorkflowEvalCase(
        eval_id="selection_override_test",
        document_set=EvalDocumentSet(name="contracts_batch", selection={"file_ids": ["old-file"]}),
        workflows=[
            EvalWorkflowSpec(workflow_id="legal_contract_review", label="Review", selection={"file_ids": ["workflow-file"]}),
            EvalWorkflowSpec(workflow_id="legal_contract_risk_matrix", label="Risk matrix"),
        ],
    )
    request = InternalEvalRunRequest(
        selection={
            "file_ids": ["file-a", "file-b"],
            "folder_paths": ["contracts/nda"],
            "current_folder": "contracts",
        },
        apply_selection_to_workflows=True,
    )

    updated = _apply_request_overrides(case, request)

    assert updated.document_set.selection.file_ids == ["file-a", "file-b"]
    assert updated.document_set.selection.folder_paths == ["contracts/nda"]
    assert updated.document_set.selection.current_folder == "contracts"
    assert updated.workflows[0].selection is not None
    assert updated.workflows[0].selection.file_ids == ["file-a", "file-b"]
    assert updated.workflows[1].selection is not None
    assert updated.workflows[1].selection.folder_paths == ["contracts/nda"]
    assert updated.metadata["selection_override"]["file_count"] == 2
    assert updated.metadata["selection_override"]["folder_count"] == 1


def test_internal_eval_request_selection_override_can_leave_workflow_specific_selection():
    case = WorkflowEvalCase(
        eval_id="selection_override_scope_test",
        document_set=EvalDocumentSet(name="contracts_batch", selection={"file_ids": ["old-file"]}),
        workflows=[
            EvalWorkflowSpec(workflow_id="legal_contract_review", label="Review", selection={"file_ids": ["workflow-file"]}),
            EvalWorkflowSpec(workflow_id="legal_contract_risk_matrix", label="Risk matrix"),
        ],
    )
    request = InternalEvalRunRequest(
        selection={"file_ids": [], "folder_paths": ["contracts"], "current_folder": "contracts"},
        apply_selection_to_workflows=False,
    )

    updated = _apply_request_overrides(case, request)

    assert updated.document_set.selection.folder_paths == ["contracts"]
    assert updated.workflows[0].selection is not None
    assert updated.workflows[0].selection.file_ids == ["workflow-file"]
    assert updated.workflows[1].selection is None
    assert updated.metadata["selection_override"]["apply_selection_to_workflows"] is False


def test_legal_pro_public_contract_manifest_targets_each_workflow_three_times():
    manifest_path = Path(__file__).resolve().parents[1] / "internal" / "evals" / "cases" / "legal_pro_public_contracts.example.json"
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    case = WorkflowEvalCase.model_validate(raw)

    expected_workflows = {
        "legal_contract_review",
        "legal_contract_risk_matrix",
        "legal_nda_review",
        "legal_msa_review",
        "legal_clause_extraction",
        "legal_fallback_language",
        "legal_negotiation_brief",
        "legal_obligation_tracker",
        "legal_matter_handoff",
    }

    counts = {workflow_id: 0 for workflow_id in expected_workflows}
    for workflow in case.workflows:
        assert workflow.workflow_id in expected_workflows
        assert workflow.workflow_id != "legal_risk_matrix"
        assert workflow.selection is not None
        assert len(workflow.selection.file_paths) == 1
        assert workflow.selection.file_paths[0].startswith("public_contract_eval_seed/contracts/")
        assert workflow.selection.file_paths[0].endswith(".txt")
        assert workflow.inputs.get("target_contract_id")
        assert workflow.inputs.get("target_contract_path") == workflow.selection.file_paths[0]
        counts[workflow.workflow_id] += 1

    assert counts == {workflow_id: 3 for workflow_id in expected_workflows}
    assert len(case.workflows) == 27


def test_legal_pro_public_contract_manifest_fixture_paths_exist():
    manifest_path = Path(__file__).resolve().parents[1] / "internal" / "evals" / "cases" / "legal_pro_public_contracts.example.json"
    fixture_root = Path(__file__).resolve().parents[1] / "app" / "internal" / "evals" / "fixtures"
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))

    for workflow in raw["workflows"]:
        for file_path in workflow["selection"]["file_paths"]:
            assert (fixture_root / file_path).exists(), file_path


def test_legal_pro_public_contract_v2_regression_manifest_targets_only_warning_runs():
    manifest_path = (
        Path(__file__).resolve().parents[1]
        / "internal"
        / "evals"
        / "cases"
        / "legal_pro_public_contracts_v2_regression.example.json"
    )
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    case = WorkflowEvalCase.model_validate(raw)

    assert case.eval_id == "legal_pro_public_contracts_v2_regression"
    assert case.default_prompt_version == "legal-pack-public-contracts-v2"
    assert case.metadata["source_eval_id"] == "legal_pro_public_contracts_v1"
    assert case.metadata["workflow_count"] == 2
    assert case.metadata["run_count"] == 4
    assert case.metadata["selection_rule"] == "Include only runs that still had v2 validation warnings or v2 content-level issues after the prior regression pass."

    expected_targets = {
        "legal_contract_review": [
            "anthem_castlight_saas",
            "relativity_kldiscovery_master_terms_dpa",
            "indegene_cingulate_msa",
        ],
        "legal_fallback_language": ["proquest_ibm_msa"],
    }
    actual_targets: dict[str, list[str]] = {}
    for workflow in case.workflows:
        actual_targets.setdefault(workflow.workflow_id, []).append(str(workflow.inputs.get("target_contract_id")))
        assert workflow.workflow_id in expected_targets
        assert workflow.selection is not None
        assert len(workflow.selection.file_paths) == 1
        assert workflow.inputs.get("target_contract_path") == workflow.selection.file_paths[0]
        assert "Regression retest" in workflow.notes

    assert actual_targets == expected_targets
    assert case.metadata["workflow_target_map"] == expected_targets
    assert len(case.workflows) == 4


def test_legal_pro_public_contract_v2_regression_manifest_fixture_paths_exist():
    manifest_path = (
        Path(__file__).resolve().parents[1]
        / "internal"
        / "evals"
        / "cases"
        / "legal_pro_public_contracts_v2_regression.example.json"
    )
    fixture_root = Path(__file__).resolve().parents[1] / "app" / "internal" / "evals" / "fixtures"
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))

    for workflow in raw["workflows"]:
        for file_path in workflow["selection"]["file_paths"]:
            assert (fixture_root / file_path).exists(), file_path
