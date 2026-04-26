from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from .models import (
    WorkflowArtifact,
    WorkflowArtifactDownloadFormat,
    WorkflowManifest,
    WorkflowRun,
    WorkflowRunBranchRequest,
    WorkflowRunCreate,
    WorkflowRunList,
    WorkflowRunRefineRequest,
    WorkflowRunTitleUpdate,
    WorkflowRunVersionLabelUpdate,
    WorkflowRunVersionLayoutUpdate,
    WorkflowRunVersionList,
)
from . import service

router = APIRouter(prefix="/v1/workflows", tags=["workflows"])


@router.get("", response_model=list[WorkflowManifest])
def list_workflows(user: SessionOut = Depends(get_current_user)) -> list[WorkflowManifest]:
    return service.list_workflows()


@router.get("/runs", response_model=WorkflowRunList)
def list_workflow_runs(
    limit: int = Query(10, ge=1, le=50),
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRunList:
    return service.list_runs(user.uid, limit=limit)


@router.post("/runs", response_model=WorkflowRun, status_code=202)
def create_workflow_run(payload: WorkflowRunCreate, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.create_run(user.uid, payload)


@router.get("/runs/{run_id}", response_model=WorkflowRun)
def get_workflow_run(run_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.get_run(user.uid, run_id)


@router.patch("/runs/{run_id}/title", response_model=WorkflowRun)
def rename_workflow_run(run_id: str, payload: WorkflowRunTitleUpdate, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.rename_run(user.uid, run_id, payload)


@router.post("/runs/{run_id}/refine", response_model=WorkflowRun)
def refine_workflow_run(run_id: str, payload: WorkflowRunRefineRequest, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.refine_run(user.uid, run_id, payload)


@router.get("/runs/{run_id}/versions", response_model=WorkflowRunVersionList)
def list_workflow_run_versions(run_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowRunVersionList:
    return service.list_run_versions(user.uid, run_id)


@router.post("/runs/{run_id}/versions/{version_id}/select", response_model=WorkflowRun)
def select_workflow_run_version(run_id: str, version_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowRun:
    return service.select_run_version(user.uid, run_id, version_id)


@router.patch("/runs/{run_id}/versions/{version_id}/label", response_model=WorkflowRun)
def rename_workflow_run_version(
    run_id: str,
    version_id: str,
    payload: WorkflowRunVersionLabelUpdate,
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRun:
    return service.rename_run_version(user.uid, run_id, version_id, payload)


@router.patch("/runs/{run_id}/versions/{version_id}/layout", response_model=WorkflowRun)
def update_workflow_run_version_layout(
    run_id: str,
    version_id: str,
    payload: WorkflowRunVersionLayoutUpdate,
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRun:
    return service.update_run_version_layout(user.uid, run_id, version_id, payload)


@router.post("/runs/{run_id}/versions/layout/reset", response_model=WorkflowRun)
def reset_workflow_run_version_layout(
    run_id: str,
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRun:
    return service.reset_run_version_layout(user.uid, run_id)


@router.post("/runs/{run_id}/versions/{version_id}/branch", response_model=WorkflowRun)
def branch_workflow_run_version(
    run_id: str,
    version_id: str,
    payload: WorkflowRunBranchRequest,
    user: SessionOut = Depends(get_current_user),
) -> WorkflowRun:
    return service.branch_run_version(user.uid, run_id, version_id, payload)


@router.post("/runs/{run_id}/versions/{version_id}/artifact", response_model=WorkflowArtifact)
def save_workflow_version_artifact(
    run_id: str,
    version_id: str,
    user: SessionOut = Depends(get_current_user),
) -> WorkflowArtifact:
    return service.save_artifact_for_version(user.uid, run_id, version_id)


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_run(run_id: str, user: SessionOut = Depends(get_current_user)) -> Response:
    service.delete_run(user.uid, run_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/runs/{run_id}/artifact", response_model=WorkflowArtifact)
def save_workflow_artifact(run_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowArtifact:
    return service.save_artifact_for_run(user.uid, run_id)


@router.get("/artifacts/{artifact_id}", response_model=WorkflowArtifact)
def get_workflow_artifact(artifact_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowArtifact:
    return service.get_artifact(user.uid, artifact_id)


@router.get("/artifacts/{artifact_id}/download")
def download_workflow_artifact(
    artifact_id: str,
    format: WorkflowArtifactDownloadFormat = Query("markdown"),
    user: SessionOut = Depends(get_current_user),
) -> Response:
    exported = service.get_artifact_download(user.uid, artifact_id, target_format=format)
    return Response(
        content=exported.content,
        media_type=exported.content_type,
        headers={"Content-Disposition": f'attachment; filename="{exported.file_name}"'},
    )
