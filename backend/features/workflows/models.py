from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


WorkflowCapability = Literal[
    "summarize",
    "compare",
    "extract",
    "draft",
    "report",
    "plan",
]
WorkflowStatus = Literal["queued", "running", "completed", "failed"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowSelectionRequirements(BaseModel):
    min_total_items: int = 1
    max_total_items: int | None = None
    exact_file_count: int | None = None
    allow_folders: bool = True


class WorkflowLauncherSchema(BaseModel):
    prompt_label: str = "Focus"
    prompt_placeholder: str = "What should this workflow focus on?"
    submit_label: str = "Run workflow"
    suggested_prompts: list[str] = Field(default_factory=list)


class WorkflowManifest(BaseModel):
    workflow_id: str
    title: str
    description: str
    capability: WorkflowCapability
    selection: WorkflowSelectionRequirements = Field(default_factory=WorkflowSelectionRequirements)
    launcher: WorkflowLauncherSchema = Field(default_factory=WorkflowLauncherSchema)
    tags: list[str] = Field(default_factory=list)


class WorkflowSelectionIn(BaseModel):
    file_ids: list[str] = Field(default_factory=list)
    folder_paths: list[str] = Field(default_factory=list)
    current_folder: str = ""

    @property
    def total_items(self) -> int:
        return len(self.file_ids) + len(self.folder_paths)


class WorkflowRunCreate(BaseModel):
    workflow_id: str
    selection: WorkflowSelectionIn = Field(default_factory=WorkflowSelectionIn)
    inputs: dict[str, Any] = Field(default_factory=dict)


class WorkflowResult(BaseModel):
    summary: str
    bullets: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    preview_markdown: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowRun(BaseModel):
    id: str = Field(default_factory=lambda: f"wf_run_{uuid4().hex[:12]}")
    workflow_id: str
    title: str
    capability: WorkflowCapability
    status: WorkflowStatus = "queued"
    selection: WorkflowSelectionIn
    inputs: dict[str, Any] = Field(default_factory=dict)
    result: WorkflowResult | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    def mark_running(self) -> None:
        self.status = "running"
        self.updated_at = utc_now()

    def mark_completed(self, result: WorkflowResult) -> None:
        self.status = "completed"
        self.result = result
        self.error = None
        self.updated_at = utc_now()

    def mark_failed(self, error: str) -> None:
        self.status = "failed"
        self.error = error
        self.updated_at = utc_now()


class WorkflowRunList(BaseModel):
    items: list[WorkflowRun] = Field(default_factory=list)
