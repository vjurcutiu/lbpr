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
WorkflowArtifactFormat = Literal["markdown", "txt", "docx", "pdf"]
WorkflowArtifactDownloadFormat = Literal["markdown", "txt", "docx", "pdf"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowSelectionRequirements(BaseModel):
    min_total_items: int = 1
    max_total_items: int | None = None
    exact_file_count: int | None = None
    allow_folders: bool = True


class WorkflowLauncherFieldOption(BaseModel):
    value: str
    label: str
    description: str | None = None


class WorkflowLauncherField(BaseModel):
    key: str
    label: str
    kind: Literal["select"] = "select"
    placeholder: str | None = None
    default_value: str | None = None
    options: list[WorkflowLauncherFieldOption] = Field(default_factory=list)


class WorkflowLauncherSchema(BaseModel):
    prompt_label: str = "Focus"
    prompt_placeholder: str = "What should this workflow focus on?"
    submit_label: str = "Run workflow"
    suggested_prompts: list[str] = Field(default_factory=list)
    fields: list[WorkflowLauncherField] = Field(default_factory=list)


class WorkflowManifest(BaseModel):
    workflow_id: str
    title: str
    description: str
    capability: WorkflowCapability
    tier: Literal["core", "pro"] = "core"
    pack_id: str | None = None
    pack_label: str | None = None
    pack_order: int = 0
    workflow_order: int = 0
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


class WorkflowRunTitleUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)

class WorkflowRunVersionLabelUpdate(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)


class WorkflowRunVersionEditRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=300_000)
    mode: Literal["new_version", "overwrite"] = "new_version"
    edit_source: Literal["manual", "ai_section"] = "manual"
    edit_prompt: str | None = Field(default=None, max_length=2000)


class WorkflowRunVersionPartialEditRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    content_before: str = Field(default="", max_length=300_000)
    selected_content: str = Field(..., min_length=1, max_length=120_000)
    content_after: str = Field(default="", max_length=300_000)


class WorkflowRunVersionPartialEditResponse(BaseModel):
    content: str
    replacement: str
    summary: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunVersionLayoutUpdate(BaseModel):
    x: float = Field(..., ge=-100_000, le=100_000)
    y: float = Field(..., ge=-100_000, le=100_000)


class WorkflowRunRefineRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    base_version_id: str | None = None


class WorkflowRunBranchRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


class WorkflowSourceFile(BaseModel):
    file_id: str
    name: str
    folder_path: str | None = None
    content_type: str | None = None
    excerpt: str
    full_text_chars: int = 0
    excerpt_chars: int = 0
    truncated: bool = False
    source_kind: Literal["excerpt", "coverage", "retrieved"] = "excerpt"
    chunk_ids: list[str] = Field(default_factory=list)
    chunk_count: int = 0




class WorkflowArtifactSummary(BaseModel):
    id: str
    run_id: str
    workflow_id: str
    title: str
    capability: WorkflowCapability
    file_name: str
    format: WorkflowArtifactFormat = "markdown"
    content_type: str = "text/markdown; charset=utf-8"
    byte_size: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkflowArtifact(WorkflowArtifactSummary):
    content: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowResult(BaseModel):
    summary: str
    bullets: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    preview_markdown: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunVersion(BaseModel):
    id: str = Field(default_factory=lambda: f"wf_ver_{uuid4().hex[:12]}")
    run_id: str
    parent_version_id: str | None = None
    version_number: int = 1
    title: str
    label: str | None = None
    layout_x: float | None = None
    layout_y: float | None = None
    kind: Literal["original", "refinement", "branch", "edit"] = "original"
    prompt: str | None = None
    result: WorkflowResult
    artifact: WorkflowArtifactSummary | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkflowRunVersionList(BaseModel):
    items: list[WorkflowRunVersion] = Field(default_factory=list)


class WorkflowRun(BaseModel):
    id: str = Field(default_factory=lambda: f"wf_run_{uuid4().hex[:12]}")
    workflow_id: str
    title: str
    capability: WorkflowCapability
    status: WorkflowStatus = "queued"
    selection: WorkflowSelectionIn
    inputs: dict[str, Any] = Field(default_factory=dict)
    result: WorkflowResult | None = None
    artifact: WorkflowArtifactSummary | None = None
    versions: list[WorkflowRunVersion] = Field(default_factory=list)
    active_version_id: str | None = None
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
