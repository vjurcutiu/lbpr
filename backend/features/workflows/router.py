from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from features.auth.deps import get_current_user
from features.auth.models import SessionOut

from .models import WorkflowArtifact, WorkflowManifest, WorkflowRun, WorkflowRunCreate, WorkflowRunList
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


@router.post("/runs/{run_id}/artifact", response_model=WorkflowArtifact)
def save_workflow_artifact(run_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowArtifact:
    return service.save_artifact_for_run(user.uid, run_id)


@router.get("/artifacts/{artifact_id}", response_model=WorkflowArtifact)
def get_workflow_artifact(artifact_id: str, user: SessionOut = Depends(get_current_user)) -> WorkflowArtifact:
    return service.get_artifact(user.uid, artifact_id)


@router.get("/artifacts/{artifact_id}/download")
def download_workflow_artifact(artifact_id: str, user: SessionOut = Depends(get_current_user)) -> Response:
    artifact = service.get_artifact(user.uid, artifact_id)
    return Response(
        content=artifact.content,
        media_type=artifact.content_type,
        headers={"Content-Disposition": f'attachment; filename="{artifact.file_name}"'},
    )
