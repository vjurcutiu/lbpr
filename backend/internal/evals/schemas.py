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


class EvalWorkflowSpec(BaseModel):
    workflow_id: str = Field(..., min_length=1)
    label: str | None = None
    notes: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    selection: WorkflowSelectionIn | None = None


class WorkflowEvalCase(BaseModel):
    eval_id: str = Field(..., min_length=1)
    description: str = ""
    document_set: EvalDocumentSet
    default_inputs: dict[str, Any] = Field(default_factory=dict)
    workflows: list[EvalWorkflowSpec] = Field(default_factory=list)
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


class WorkflowEvalRunRecord(BaseModel):
    workflow_id: str
    label: str | None = None
    status: Literal["completed", "failed"]
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


class WorkflowEvalExport(BaseModel):
    eval_id: str
    description: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    app_git_commit: str | None = None
    uid: str
    document_set: EvalDocumentSet
    metadata: dict[str, Any] = Field(default_factory=dict)
    runs: list[WorkflowEvalRunRecord] = Field(default_factory=list)
