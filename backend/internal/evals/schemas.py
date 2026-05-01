from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from features.workflows.models import WorkflowSelectionIn


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EvalDocumentSet(BaseModel):
    name: str = Field(..., min_length=1)
    description: str = ""
    selection: WorkflowSelectionIn = Field(default_factory=WorkflowSelectionIn)


class EvalRubricCriterion(BaseModel):
    id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    weight: float = 1
    max_score: float = 5
    description: str = ""


class EvalRubric(BaseModel):
    rubric_id: str | None = None
    workflow_id: str | None = None
    description: str = ""
    criteria: list[EvalRubricCriterion] = Field(default_factory=list)
    required_sections: list[str] = Field(default_factory=list)
    required_metadata_keys: list[str] = Field(default_factory=list)
    required_metadata_min_items: dict[str, int] = Field(default_factory=dict)
    min_source_count: int | None = None
    min_llm_total_tokens: int | None = None


class EvalWorkflowSpec(BaseModel):
    workflow_id: str = Field(..., min_length=1)
    label: str | None = None
    notes: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    selection: WorkflowSelectionIn | None = None
    modes: list[str] = Field(default_factory=list)
    workflow_version: str | None = None
    prompt_version: str | None = None
    rubric_id: str | None = None
    rubric_path: str | None = None
    expected_sections: list[str] = Field(default_factory=list)
    required_metadata_keys: list[str] = Field(default_factory=list)
    required_metadata_min_items: dict[str, int] = Field(default_factory=dict)
    min_source_count: int | None = None
    min_llm_total_tokens: int | None = None


class WorkflowEvalCase(BaseModel):
    eval_id: str = Field(..., min_length=1)
    description: str = ""
    mode: str = "full"
    document_set: EvalDocumentSet
    default_inputs: dict[str, Any] = Field(default_factory=dict)
    default_workflow_version: str | None = None
    default_prompt_version: str | None = None
    workflows: list[EvalWorkflowSpec] = Field(default_factory=list)
    rubrics: dict[str, EvalRubric] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowEvalSourceRecord(BaseModel):
    file_id: str = ""
    name: str = ""
    folder_path: str | None = None
    content_type: str | None = None
    excerpt_chars: int | None = None
    full_text_chars: int | None = None
    truncated: bool | None = None
    source_kind: str | None = None
    chunk_count: int | None = None


class WorkflowEvalCriterionScore(BaseModel):
    criterion_id: str
    label: str
    weight: float = 1
    max_score: float = 5
    score: float | None = None
    notes: str = ""


class WorkflowEvalValidationIssue(BaseModel):
    severity: Literal["info", "warning", "error"] = "warning"
    code: str
    message: str
    path: str | None = None


class WorkflowEvalValidationSummary(BaseModel):
    status: Literal["passed", "warning", "failed"] = "passed"
    issues: list[WorkflowEvalValidationIssue] = Field(default_factory=list)


class WorkflowEvalRunRecord(BaseModel):
    workflow_id: str
    run_key: str = ""
    label: str | None = None
    status: Literal["completed", "failed", "skipped"]
    run_id: str | None = None
    title: str = ""
    capability: str = ""
    duration_ms: float = 0
    notes: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    summary: str = ""
    bullets: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    output_markdown: str = ""
    structured_metadata: dict[str, Any] = Field(default_factory=dict)
    sources: list[WorkflowEvalSourceRecord] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)
    workflow_version: str | None = None
    prompt_version: str | None = None
    rubric_id: str | None = None
    criterion_scores: list[WorkflowEvalCriterionScore] = Field(default_factory=list)
    validation: WorkflowEvalValidationSummary = Field(default_factory=WorkflowEvalValidationSummary)
    config_fingerprint: str = ""
    output_fingerprint: str = ""
    structured_metadata_fingerprint: str = ""
    source_fingerprint: str = ""


class WorkflowEvalExport(BaseModel):
    eval_id: str
    description: str = ""
    mode: str = "full"
    created_at: datetime = Field(default_factory=utc_now)
    app_git_commit: str | None = None
    uid: str
    document_set: EvalDocumentSet
    metadata: dict[str, Any] = Field(default_factory=dict)
    case_fingerprint: str = ""
    runs: list[WorkflowEvalRunRecord] = Field(default_factory=list)


class WorkflowEvalComparisonRun(BaseModel):
    run_key: str
    workflow_id: str
    label: str | None = None
    current_status: str | None = None
    baseline_status: str | None = None
    status_changed: bool = False
    output_changed: bool = False
    output_similarity: float | None = None
    duration_delta_ms: float | None = None
    source_count_delta: int | None = None
    validation_error_delta: int | None = None
    validation_warning_delta: int | None = None
    token_delta: int | None = None
    notes: list[str] = Field(default_factory=list)


class WorkflowEvalComparisonExport(BaseModel):
    current_eval_id: str
    baseline_eval_id: str
    created_at: datetime = Field(default_factory=utc_now)
    current_path: str | None = None
    baseline_path: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    runs: list[WorkflowEvalComparisonRun] = Field(default_factory=list)
