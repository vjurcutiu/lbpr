from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from features.files.schemas import FileItem
from features.workflows.models import WorkflowSelectionIn


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class InternalEvalCaseWorkflowSummary(BaseModel):
    key: str
    index: int
    workflow_id: str
    label: str | None = None
    modes: list[str] = Field(default_factory=list)


class InternalEvalCaseSummary(BaseModel):
    id: str
    path: str
    eval_id: str | None = None
    description: str = ""
    workflow_count: int = 0
    mode: str | None = None
    workflows: list[InternalEvalCaseWorkflowSummary] = Field(default_factory=list)
    modified_at: datetime | None = None


class InternalEvalResultSummary(BaseModel):
    id: str
    path: str
    eval_id: str
    description: str = ""
    mode: str = "full"
    created_at: datetime | None = None
    modified_at: datetime | None = None
    run_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    validation_error_count: int = 0
    validation_warning_count: int = 0
    has_review: bool = False


class InternalEvalFolderOption(BaseModel):
    path: str
    name: str
    parent_path: str | None = None
    direct_file_count: int = 0
    recursive_file_count: int = 0


class InternalEvalSelectionOptions(BaseModel):
    uid: str
    files: list[FileItem] = Field(default_factory=list)
    folders: list[InternalEvalFolderOption] = Field(default_factory=list)


class InternalEvalRunRequest(BaseModel):
    case_path: str = Field(default="internal/evals/cases/legal_pro_public_contracts_v2_regression.example.json")
    document_source: Literal["local", "app"] = "local"
    uid: str | None = None
    mode: str | None = "smoke"
    markdown: bool = True
    compare_to: str | None = None
    prompt_version: str | None = None
    workflow_version: str | None = None
    notes: str = ""
    selection: WorkflowSelectionIn | None = None
    manifest_paths: list[str] = Field(default_factory=list)
    apply_selection_to_workflows: bool = True
    workflow_id: str | None = None
    workflow_run_key: str | None = None
    ad_hoc_workflow_id: str | None = None
    ad_hoc_workflow_label: str | None = None
    ad_hoc_workflow_inputs: dict[str, Any] = Field(default_factory=dict)


class InternalEvalJobMessage(BaseModel):
    at: datetime = Field(default_factory=utc_now)
    level: Literal["info", "success", "warning", "error"] = "info"
    message: str
    run_key: str | None = None
    workflow_id: str | None = None
    label: str | None = None


class InternalEvalJob(BaseModel):
    id: str
    status: Literal["queued", "running", "completed", "failed"] = "queued"
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    requested_by_uid: str = ""
    requested_by_email: str | None = None
    request: InternalEvalRunRequest
    result_id: str | None = None
    export_path: str | None = None
    markdown_path: str | None = None
    comparison_path: str | None = None
    comparison_markdown_path: str | None = None
    error: str | None = None
    total_runs: int = 0
    completed_runs: int = 0
    failed_runs: int = 0
    skipped_runs: int = 0
    validation_error_count: int = 0
    validation_warning_count: int = 0
    current_run_key: str | None = None
    current_workflow_id: str | None = None
    current_label: str | None = None
    last_message: str | None = None
    messages: list[InternalEvalJobMessage] = Field(default_factory=list)


class InternalEvalRunResponse(BaseModel):
    job: InternalEvalJob


class InternalEvalReviewPayload(BaseModel):
    reviewer_notes: str = ""
    run_reviews: dict[str, Any] = Field(default_factory=dict)


class InternalEvalReviewRecord(BaseModel):
    result_id: str
    updated_at: datetime = Field(default_factory=utc_now)
    updated_by_uid: str = ""
    updated_by_email: str | None = None
    reviewer_notes: str = ""
    run_reviews: dict[str, Any] = Field(default_factory=dict)


class InternalEvalCompareRequest(BaseModel):
    baseline_result: str
    current_result: str
    write: bool = True


class InternalEvalCompareResponse(BaseModel):
    comparison: dict[str, Any]
    path: str | None = None
